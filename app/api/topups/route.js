import { auth } from '@/auth';
import { dbEnabled, createTopup, listMyTopups, upsertProfile, getPoints } from '@/lib/db';
import { RIEL_PER_POINT, toRiel, cleanPoints } from '@/lib/points';

export const dynamic = 'force-dynamic';

const MAX_POINTS_PER_REQUEST = 10_000; // 10,000,000៛ — a typo guard, not a rule
const MAX_PENDING = 3;

async function requireUser() {
  if (!dbEnabled()) return null;
  const session = await auth();
  return session?.user?.id ? session.user : null;
}

export async function GET() {
  const user = await requireUser();
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 });
  return Response.json({ topups: await listMyTopups(user.id) });
}

// A player claims they have paid the operator; the points are credited only
// once an admin approves the request (see /api/admin/topups).
export async function POST(req) {
  const user = await requireUser();
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const points = cleanPoints(body?.points, { max: MAX_POINTS_PER_REQUEST });
  if (!points) {
    return Response.json(
      { error: `Choose between 1 and ${MAX_POINTS_PER_REQUEST.toLocaleString()} points` },
      { status: 400 }
    );
  }

  // Stop a queue of duplicate requests piling up while the operator is asleep.
  const mine = await listMyTopups(user.id);
  if (mine.filter((t) => t.status === 'pending').length >= MAX_PENDING) {
    return Response.json(
      { error: 'You already have top-ups waiting for approval' },
      { status: 409 }
    );
  }

  // The profile normally exists already (it is written on join), but a player
  // could buy points before ever entering a room.
  if ((await getPoints(user.id)) === null) {
    await upsertProfile({
      googleId: user.id,
      name: user.name || 'Player',
      email: user.email || null,
      image: user.image || null,
    });
  }

  const topup = await createTopup({
    googleId: user.id,
    points,
    riel: toRiel(points),
    reference: typeof body?.reference === 'string' ? body.reference.trim().slice(0, 120) : null,
    proofUrl: typeof body?.proofUrl === 'string' ? body.proofUrl.slice(0, 500) : null,
  });
  if (!topup) return Response.json({ error: 'Could not save your request' }, { status: 500 });

  return Response.json({ topup, rielPerPoint: RIEL_PER_POINT });
}