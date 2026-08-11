import { dbEnabled, getSetting } from '@/lib/db';

export const dynamic = 'force-dynamic';

// The sounds the operator has chosen, read by every player's browser. Public:
// these are just URLs to files in a public bucket, and the client needs them
// whether or not anyone is signed in.
export async function GET() {
  if (!dbEnabled()) return Response.json({ chop: null, catch: null, penalty: null });
  const [chop, catch_, penalty] = await Promise.all([
    getSetting('sound_chop_url'),
    getSetting('sound_catch_url'),
    getSetting('sound_penalty_url'),
  ]);
  return Response.json({ chop, catch: catch_, penalty });
}
