import { auth } from '@/auth';
import { dbEnabled, listTopups, approveTopup, rejectTopup } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

// The operator's review queue. Admins are listed in ADMIN_EMAILS and checked
// against the Auth.js session, never against anything the client sends.
async function requireAdmin() {
  if (!dbEnabled()) return null;
  const session = await auth();
  const user = session?.user;
  return user?.id && isAdmin(user.email) ? user : null;
}

export async function GET(req) {
  const admin = await requireAdmin();
  if (!admin) return Response.json({ error: 'Not authorised' }, { status: 403 });

  const status = new URL(req.url).searchParams.get('status') || 'pending';
  if (!['pending', 'approved', 'rejected', 'all'].includes(status)) {
    return Response.json({ error: 'Unknown status' }, { status: 400 });
  }
  return Response.json({ topups: await listTopups(status) });
}

export async function POST(req) {
  const admin = await requireAdmin();
  if (!admin) return Response.json({ error: 'Not authorised' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const id = body?.id;
  if (typeof id !== 'string' || !id) {
    return Response.json({ error: 'Missing top-up id' }, { status: 400 });
  }

  if (body.action === 'approve') {
    const balance = await approveTopup(id, admin.email);
    // null means the request was already approved or rejected — the RPC only
    // touches rows still pending, so the points can never be credited twice.
    if (balance === null) {
      return Response.json({ error: 'Already reviewed' }, { status: 409 });
    }
    return Response.json({ ok: true, balance });
  }

  if (body.action === 'reject') {
    const ok = await rejectTopup(id, admin.email, String(body.note || '').slice(0, 200));
    if (!ok) return Response.json({ error: 'Already reviewed' }, { status: 409 });
    return Response.json({ ok: true });
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 });
}