import { auth } from '@/auth';
import { dbEnabled, getPoints, listMyTopups, getSetting } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

// The player's online wallet: point balance, the operator's KHQR to pay into,
// and their own top-up history. Guests get a 401 — online play is
// Google-only, so there is no wallet to show them.
export async function GET() {
  if (!dbEnabled()) {
    return Response.json({ error: 'Wallet is not configured' }, { status: 503 });
  }
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return Response.json({ error: 'Not signed in' }, { status: 401 });

  const [points, topups, khqrUrl] = await Promise.all([
    getPoints(user.id),
    listMyTopups(user.id),
    getSetting('payment_khqr_url'),
  ]);

  return Response.json({
    points: points ?? 0,
    topups,
    khqrUrl,
    admin: isAdmin(user.email),
  });
}