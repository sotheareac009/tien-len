import { auth } from '@/auth';
import { dbEnabled, listProfiles, adjustPoints, listAdjustments } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

// Hand edits are for corrections, not for minting a fortune by typo.
const MAX_ABS = 100_000;

async function requireAdmin() {
  if (!dbEnabled()) return null;
  const session = await auth();
  const user = session?.user;
  return user?.id && isAdmin(user.email) ? user : null;
}

// GET ?q=search        — the player list
// GET ?history=<id>    — recent hand edits for one player
export async function GET(req) {
  const admin = await requireAdmin();
  if (!admin) return Response.json({ error: 'Not authorised' }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const history = params.get('history');
  if (history) return Response.json({ adjustments: await listAdjustments(history) });

  return Response.json({ players: await listProfiles({ query: params.get('q') || '' }) });
}

// POST { googleId, points, note } — `points` becomes the player's balance.
export async function POST(req) {
  const admin = await requireAdmin();
  if (!admin) return Response.json({ error: 'Not authorised' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const googleId = body?.googleId;
  const points = Number(body?.points);

  if (typeof googleId !== 'string' || !googleId) {
    return Response.json({ error: 'Missing player' }, { status: 400 });
  }
  if (!Number.isInteger(points) || points < 0 || points > MAX_ABS) {
    return Response.json(
      { error: `Use a whole number between 0 and ${MAX_ABS.toLocaleString()}` },
      { status: 400 }
    );
  }

  const result = await adjustPoints({
    googleId,
    points,
    adminEmail: admin.email,
    note: String(body?.note || '').slice(0, 200),
  });
  if (!result) return Response.json({ error: 'Player not found' }, { status: 404 });

  return Response.json({ ok: true, ...result });
}