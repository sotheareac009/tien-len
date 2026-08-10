import { auth } from '@/auth';
import { dbEnabled, getCoins, addCoins, upsertProfile } from '@/lib/db';

// Single-player coin balance for signed-in players. Guests get a 401 and the
// client keeps using localStorage instead.
//
// Coins are play money with no cash value, and single player runs entirely in
// the browser, so the server takes the client's word for a round's result. The
// cap below just stops a typo (or a stray script) writing an absurd balance.
const MAX_DELTA = 1_000_000;
const START_COINS = 1000;

async function requireUser() {
  if (!dbEnabled()) return null;
  const session = await auth();
  return session?.user?.id ? session.user : null;
}

export async function GET() {
  const user = await requireUser();
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 });

  let coins = await getCoins(user.id);
  if (coins === null) {
    // First visit on a device that never opened a room — create the profile.
    await upsertProfile({
      googleId: user.id,
      name: user.name || 'Player',
      email: user.email || null,
      image: user.image || null,
    });
    coins = (await getCoins(user.id)) ?? START_COINS;
  }
  return Response.json({ coins });
}

export async function POST(req) {
  const user = await requireUser();
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const delta = Number(body?.delta);
  if (!Number.isInteger(delta) || Math.abs(delta) > MAX_DELTA) {
    return Response.json({ error: 'Invalid delta' }, { status: 400 });
  }

  const coins = await addCoins(user.id, delta);
  if (coins === null) return Response.json({ error: 'Could not save coins' }, { status: 500 });
  return Response.json({ coins });
}