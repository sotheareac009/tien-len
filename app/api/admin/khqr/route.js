import { auth } from '@/auth';
import { dbEnabled, getSetting, setSetting, isValidQRUrl } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

const KEY = 'payment_khqr_url';

// The single KHQR every player pays into when buying points. Uploaded through
// /api/upload-qr like any other QR image, then stored here by the operator.
export async function GET() {
  if (!dbEnabled()) return Response.json({ url: null });
  return Response.json({ url: await getSetting(KEY) });
}

export async function PUT(req) {
  if (!dbEnabled()) return Response.json({ error: 'Not configured' }, { status: 503 });
  const session = await auth();
  if (!session?.user?.id || !isAdmin(session.user.email)) {
    return Response.json({ error: 'Not authorised' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const url = body?.url;
  // Only an image this server produced — never an arbitrary link that could
  // point players' bank apps at someone else's QR.
  if (!isValidQRUrl(url)) return Response.json({ error: 'Invalid QR image' }, { status: 400 });

  if (!(await setSetting(KEY, url))) {
    return Response.json({ error: 'Could not save' }, { status: 500 });
  }
  return Response.json({ ok: true, url });
}