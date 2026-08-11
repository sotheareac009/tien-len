import { createClient } from '@supabase/supabase-js';

// Server-side Supabase access. The service role key bypasses row-level
// security, so this module must never be imported from a client component.
//
// Persistence is optional: with the env vars unset the game still runs
// entirely in memory and every helper below quietly does nothing. That keeps
// a missing/misconfigured database from ever breaking a round in progress.

// The client is built on first use, never at import time. server.js loads
// .env in its module body, but ES imports are evaluated before that runs — so
// anything reading process.env at the top level of this file would see nothing
// and silently disable the database for the whole socket server.
let client = null;

function db() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Deliberately not cached when the config is missing: .env may not be loaded
  // yet on the very first call, and caching the miss would disable the
  // database for the lifetime of the process.
  if (!url || !key) return null;
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export const qrBucket = () => process.env.SUPABASE_QR_BUCKET || 'khqr';

// For scripts and one-off queries that need raw table access.
export const getSupabase = db;

export const dbEnabled = () => !!db();

// Database trouble should never take the game down — log it and carry on.
function warn(what, error) {
  if (error) console.warn(`[db] ${what} failed:`, error.message || error);
}

// A client may only claim a QR image that this server actually produced:
// either a local upload or an object in our Supabase bucket.
export function isValidQRUrl(candidate) {
  if (typeof candidate !== 'string') return false;
  if (candidate.startsWith('/uploads/')) return true;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return !!db() && candidate.startsWith(`${url}/storage/v1/object/public/${qrBucket()}/`);
}

// --- profiles --------------------------------------------------------------

// Called when a signed-in player joins. Returns their stored profile (most
// usefully the KHQR they uploaded last time and their wallet) or null.
//
// googleId is Google's own account id (see auth.js), so one person is one row
// for the life of their account. A null return means the write failed — the
// caller must treat that as "no wallet", never as "empty wallet".
export async function upsertProfile({ googleId, name, email, image }) {
  if (!db() || !googleId) return null;
  const { data, error } = await db()
    .from('profiles')
    .upsert(
      { google_id: googleId, name, email, image, updated_at: new Date().toISOString() },
      { onConflict: 'google_id' }
    )
    .select('qr_url, coins, points')
    .single();
  warn('upsertProfile', error);
  return error ? null : data;
}

// --- single-player coins ---------------------------------------------------

// The coin balance of a signed-in player. Returns null when Supabase is off
// or the profile does not exist yet, so the caller can fall back.
export async function getCoins(googleId) {
  if (!db() || !googleId) return null;
  const { data, error } = await db()
    .from('profiles')
    .select('coins')
    .eq('google_id', googleId)
    .maybeSingle();
  warn('getCoins', error);
  return data?.coins ?? null;
}

// Applies a round's win/loss (or a free top-up) and returns the new balance.
// The add is done in Postgres (see add_coins in supabase/schema.sql) so
// concurrent tabs cannot overwrite each other's result.
export async function addCoins(googleId, delta) {
  if (!db() || !googleId) return null;
  const { data, error } = await db().rpc('add_coins', {
    p_google_id: googleId,
    p_delta: Math.trunc(delta),
  });
  warn('addCoins', error);
  return error ? null : data;
}

export async function saveProfileQR(googleId, qrUrl) {
  if (!db() || !googleId) return;
  const { error } = await db()
    .from('profiles')
    .update({ qr_url: qrUrl, updated_at: new Date().toISOString() })
    .eq('google_id', googleId);
  warn('saveProfileQR', error);
}

// --- online points wallet --------------------------------------------------

export async function getPoints(googleId) {
  if (!db() || !googleId) return null;
  const { data, error } = await db()
    .from('profiles')
    .select('points')
    .eq('google_id', googleId)
    .maybeSingle();
  warn('getPoints', error);
  return data?.points ?? null;
}

// Balances for a whole table, as { googleId: points }. Used to check everyone
// can cover the stakes before a round is dealt.
export async function getPointsFor(googleIds) {
  if (!db() || googleIds.length === 0) return {};
  const { data, error } = await db()
    .from('profiles')
    .select('google_id, points')
    .in('google_id', googleIds);
  warn('getPointsFor', error);
  return Object.fromEntries((data || []).map((r) => [r.google_id, r.points]));
}

// Settles a finished round: { googleId: delta } applied in one statement, so
// either every seat moves or none does. Returns false if it could not be
// written, which the caller reports rather than silently dropping the round.
export async function applyPointDeltas(deltas) {
  if (!db()) return false;
  const payload = Object.fromEntries(
    Object.entries(deltas).filter(([, v]) => Number.isFinite(v) && v !== 0)
  );
  if (Object.keys(payload).length === 0) return true;
  const { error } = await db().rpc('apply_point_deltas', { p_deltas: payload });
  warn('applyPointDeltas', error);
  return !error;
}

// --- top-ups ---------------------------------------------------------------

export async function createTopup({ googleId, points, riel, reference, proofUrl }) {
  if (!db()) return null;
  const { data, error } = await db()
    .from('topups')
    .insert({
      google_id: googleId,
      points,
      riel,
      reference: reference || null,
      proof_url: proofUrl || null,
    })
    .select('*')
    .single();
  warn('createTopup', error);
  return error ? null : data;
}

export async function listMyTopups(googleId, limit = 20) {
  if (!db() || !googleId) return [];
  const { data, error } = await db()
    .from('topups')
    .select('id, points, riel, reference, status, note, created_at, reviewed_at')
    .eq('google_id', googleId)
    .order('created_at', { ascending: false })
    .limit(limit);
  warn('listMyTopups', error);
  return data || [];
}

// The operator's review queue, newest last so the oldest request is handled
// first. Joined to the profile so the admin sees who is asking.
export async function listTopups(status = 'pending', limit = 100) {
  if (!db()) return [];
  let q = db()
    .from('topups')
    .select('id, google_id, points, riel, reference, proof_url, status, note, created_at, reviewed_at, reviewed_by, profiles(name, email, image)')
    .order('created_at', { ascending: status === 'pending' })
    .limit(limit);
  if (status !== 'all') q = q.eq('status', status);
  const { data, error } = await q;
  warn('listTopups', error);
  return data || [];
}

// Returns the buyer's new balance, or null when the request was already
// reviewed — the credit can never be applied twice.
export async function approveTopup(id, adminEmail) {
  if (!db()) return null;
  const { data, error } = await db().rpc('approve_topup', { p_id: id, p_admin: adminEmail });
  warn('approveTopup', error);
  return error ? null : data;
}

export async function rejectTopup(id, adminEmail, note) {
  if (!db()) return false;
  const { data, error } = await db()
    .from('topups')
    .update({
      status: 'rejected',
      note: note || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: adminEmail,
    })
    .eq('id', id)
    .eq('status', 'pending') // never re-review a decided request
    .select('id');
  warn('rejectTopup', error);
  return !error && (data?.length ?? 0) > 0;
}

// --- operator: players -----------------------------------------------------

// Every Google account that has ever signed in, for the operator's player
// list. `query` filters on name or email.
export async function listProfiles({ query = '', limit = 100 } = {}) {
  if (!db()) return [];
  let q = db()
    .from('profiles')
    .select('google_id, name, email, image, points, coins, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit);
  const term = query.trim();
  if (term) {
    const safe = term.replace(/[%,()]/g, ''); // keep the filter a plain substring
    q = q.or(`name.ilike.%${safe}%,email.ilike.%${safe}%`);
  }
  const { data, error } = await q;
  warn('listProfiles', error);
  return data || [];
}

// Writes a player's balance by hand, recording who did it and why. Returns
// { before, after }, or null if the player does not exist — a balance is never
// created for someone who has not signed in.
export async function adjustPoints({ googleId, points, adminEmail, note }) {
  if (!db()) return null;
  const { data, error } = await db().rpc('admin_adjust_points', {
    p_google_id: googleId,
    p_mode: 'set',
    p_amount: Math.trunc(points),
    p_admin: adminEmail,
    p_note: note || null,
  });
  warn('adjustPoints', error);
  return error ? null : data;
}

export async function listAdjustments(googleId, limit = 20) {
  if (!db()) return [];
  const { data, error } = await db()
    .from('point_adjustments')
    .select('id, mode, before_points, after_points, delta, note, admin_email, created_at')
    .eq('google_id', googleId)
    .order('created_at', { ascending: false })
    .limit(limit);
  warn('listAdjustments', error);
  return data || [];
}

// --- saved rooms -----------------------------------------------------------

// Stores a room so it survives a server restart, round included. Called on
// every meaningful change once the host has saved the room, so the snapshot
// never lags behind the table.
export async function saveRoom(room) {
  if (!db()) return false;
  const { error } = await db()
    .from('game_rooms')
    .upsert(
      {
        code: room.code,
        host_id: room.hostId,
        status: room.status,
        settings: room.settings,
        members: room.members,
        seats: room.seats,
        tally: room.tally,
        rounds_played: room.roundsPlayed,
        game: room.game ? room.game.toJSON() : null,
        last_ranks: room.lastRanks,
        last_deltas: room.lastDeltas,
        saved_by: room.savedBy || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'code' }
    );
  warn('saveRoom', error);
  return !error;
}

export async function loadRooms() {
  if (!db()) return [];
  const { data, error } = await db().from('game_rooms').select('*');
  warn('loadRooms', error);
  return data || [];
}

export async function deleteRoom(code) {
  if (!db()) return false;
  const { error } = await db().from('game_rooms').delete().eq('code', code);
  warn('deleteRoom', error);
  return !error;
}

// --- operator settings -----------------------------------------------------

export async function getSetting(key) {
  if (!db()) return null;
  const { data, error } = await db()
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  warn('getSetting', error);
  return data?.value ?? null;
}

export async function setSetting(key, value) {
  if (!db()) return false;
  const { error } = await db()
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  warn('setSetting', error);
  return !error;
}

// --- match history ---------------------------------------------------------

// Writes a finished round: the round itself, its finish order, and the debts
// it produced. `players` is [{ googleId, name, place, net }], `debts` is the
// room's debt list already resolved to names/google ids.
export async function recordRound({ roomCode, settings, players, debts }) {
  if (!db()) return null;
  const { data: round, error } = await db()
    .from('rounds')
    // `currency` predates the points wallet, when stakes were USD or KHR.
    // Everything is points now (1 pt = 1000 riel), and the column is NOT NULL,
    // so it is recorded as such rather than left to fail the whole insert.
    .insert({ room_code: roomCode, currency: 'POINTS', settings })
    .select('id')
    .single();
  warn('recordRound', error);
  if (error) return null;

  if (players.length > 0) {
    const { error: pErr } = await db().from('round_players').insert(
      players.map((p) => ({
        round_id: round.id,
        google_id: p.googleId,
        name: p.name,
        place: p.place,
        net: p.net,
      }))
    );
    warn('recordRound.players', pErr);
  }

  if (debts.length > 0) {
    const { error: dErr } = await db().from('debts').insert(
      debts.map((d) => ({
        id: d.id,
        round_id: round.id,
        from_name: d.fromName,
        from_google: d.fromGoogle,
        to_name: d.toName,
        to_google: d.toGoogle,
        amount: d.amount,
        currency: d.currency,
      }))
    );
    warn('recordRound.debts', dErr);
  }

  return round.id;
}

// The receiver confirmed the KHQR transfer landed.
export async function settleDebt(debtId) {
  if (!db()) return;
  const { error } = await db()
    .from('debts')
    .update({ settled: true, settled_at: new Date().toISOString() })
    .eq('id', debtId);
  warn('settleDebt', error);
}

// --- storage ---------------------------------------------------------------

// Uploads a KHQR image and returns its public URL, or null when Supabase is
// not configured (the caller then falls back to the local uploads folder).
export async function uploadQRImage(filename, buffer, contentType) {
  if (!db()) return null;
  const { error } = await db().storage
    .from(qrBucket())
    .upload(filename, buffer, { contentType, upsert: false });
  if (error) {
    warn('uploadQRImage', error);
    return null;
  }
  const { data } = db().storage.from(qrBucket()).getPublicUrl(filename);
  return data?.publicUrl ?? null;
}
