import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());

const { createServer } = await import('http');
const { Server } = await import('socket.io');
const { io: client } = await import('socket.io-client');
const db = await import('./lib/db.js');
const { encode } = await import('next-auth/jwt');

const SALT = 'authjs.session-token';
const A = { id: '900000000000000000001', name: 'Alice', email: 'alice@test.local' };
const B = { id: '900000000000000000002', name: 'Bob', email: 'bob@test.local' };
for (const u of [A, B]) {
  await db.upsertProfile({ googleId: u.id, name: u.name, email: u.email, image: null });
  await db.getSupabase().from('profiles').update({ points: 100 }).eq('google_id', u.id);
}
const cookieFor = async (u) => `${SALT}=${encodeURIComponent(await encode({
  token: { sub: u.id, gid: u.id, name: u.name, email: u.email },
  secret: process.env.AUTH_SECRET, salt: SALT }))}`;

// Boot a server; returns a stop() so we can simulate a restart.
async function boot() {
  const { attachGameServer } = await import(`./lib/socket-server.js?v=${Math.random()}`);
  const http = createServer();
  const io = new Server(http);
  attachGameServer(io);
  await new Promise((r) => http.listen(0, r));
  await new Promise((r) => setTimeout(r, 400)); // let restoreSavedRooms finish
  return { url: `http://localhost:${http.address().port}`, stop: () => { io.close(); http.close(); } };
}
const connect = async (url, u) => {
  const s = client(url, { extraHeaders: { cookie: await cookieFor(u) } });
  await new Promise((r) => s.on('connect', r));
  return s;
};
const call = (s, ev, arg) => new Promise((r) => s.emit(ev, arg, r));
const where = (s, fn) => new Promise((r) => {
  const h = (st) => { if (fn(st)) { s.off('room:state', h); r(st); } };
  s.on('room:state', h);
});

let srv = await boot();
let a = await connect(srv.url, A), b = await connect(srv.url, B);
await call(a, 'player:join', {}); await call(b, 'player:join', {});
const { code } = await call(a, 'room:create', {});
await call(b, 'room:join', { code });

let p = where(a, (s) => s.status === 'playing');
a.emit('game:start');
const started = await p;
const turnIsA = started.currentTurnId === A.id;
console.log(`room ${code} playing — turn: ${turnIsA ? 'Alice' : 'Bob'}`);

console.log('\n--- host saves the room ---');
console.log('save ack:', JSON.stringify(await call(a, 'room:save', {})));

console.log('\n--- Bob reloads mid-round ---');
let paused = where(a, (s) => s.status === 'paused');
b.disconnect();
const ps = await paused;
console.log('status:', ps.status, '| waiting for:', ps.offline, '| canContinue:', ps.canContinue);

// Alice tries to sneak a move while paused
const toast = new Promise((r) => a.once('toast', r));
a.emit('game:play', { cardIds: [started.yourHand[0].id] });
console.log('Alice plays while paused ->', await Promise.race([
  toast, new Promise((r) => setTimeout(() => r('(silently ignored — no state change)'), 400))]));

console.log('\n--- Bob comes back ---');
const b2 = await connect(srv.url, B);
const back = where(a, (s) => s.canContinue);
await call(b2, 'player:join', {});
const bs = await back;
console.log('canContinue now:', bs.canContinue, '| status still:', bs.status);

const resumed = where(a, (s) => s.status === 'playing');
a.emit('room:continue');
console.log('after Continue -> status:', (await resumed).status);

console.log('\n--- server restarts (saved room should come back) ---');
const handBefore = (await where(a, () => true, a.emit('wallet:refresh'))).yourHand.map(c => c.id).join(',');
a.disconnect(); b2.disconnect(); srv.stop();
await new Promise((r) => setTimeout(r, 300));

srv = await boot();
const a3 = await connect(srv.url, A);
const restored = where(a3, (s) => !!s.code);
await call(a3, 'player:join', {});
const rs = await Promise.race([restored, new Promise((r) => setTimeout(() => r(null), 1500))]);
if (!rs) console.log('room NOT restored (is migration 005 run?)');
else console.log('restored room:', rs.code, '| status:', rs.status,
                 '| same hand:', rs.yourHand.map(c => c.id).join(',') === handBefore,
                 '| members:', rs.players.length);

console.log('\n--- host deletes the room ---');
const b3 = await connect(srv.url, B); await call(b3, 'player:join', {});
const left = new Promise((r) => b3.once('room:left', () => r('Bob was kicked out')));
console.log('delete ack:', JSON.stringify(await call(a3, 'room:delete', {})));
console.log(await Promise.race([left, new Promise((r) => setTimeout(() => r('(no room:left)'), 800))]));
const rowsLeft = await db.getSupabase().from('game_rooms').select('code');
console.log('game_rooms rows left:', rowsLeft.error ? 'table missing' : rowsLeft.data.length);

a3.disconnect(); b3.disconnect(); srv.stop();
await db.getSupabase().from('profiles').delete().in('google_id', [A.id, B.id]);
console.log('\ncleaned up');
process.exit(0);
