process.env.BOT_DELAY_MS = '10';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
process.env.BOT_DELAY_MS = '10';
const { createServer } = await import('http');
const { Server } = await import('socket.io');
const { io: client } = await import('socket.io-client');
const db = await import('./lib/db.js');
const { encode } = await import('next-auth/jwt');
const { attachGameServer } = await import('./lib/socket-server.js');
const { TienLenGame } = await import('./lib/game/TienLenGame.js');

// Force the deal: patch detectInstantWin so Alice always holds four 2s.
const users = [
  { id: '900000000000000000001', name: 'Alice', email: 'a@t.local' },
  { id: '900000000000000000002', name: 'Bob', email: 'b@t.local' },
  { id: '900000000000000000003', name: 'Carol', email: 'c@t.local' },
];
for (const u of users) {
  await db.upsertProfile({ googleId: u.id, name: u.name, email: u.email, image: null });
  await db.getSupabase().from('profiles').update({ points: 5000 }).eq('google_id', u.id);
}
const real = TienLenGame.prototype.detectInstantWin;
TienLenGame.prototype.detectInstantWin = function (opening) {
  return { playerId: users[0].id, kind: 'four2s' };
};
const SALT = 'authjs.session-token';
const cookieFor = async (u) => `${SALT}=${encodeURIComponent(await encode({
  token: { sub: u.id, gid: u.id, name: u.name, email: u.email }, secret: process.env.AUTH_SECRET, salt: SALT }))}`;
const http = createServer(); const io = new Server(http); attachGameServer(io);
await new Promise((r) => http.listen(0, r));
const url = `http://localhost:${http.address().port}`;
const call = (s, ev, arg) => new Promise((r) => s.emit(ev, arg, r));
const conn = async (u) => { const s = client(url, { extraHeaders: { cookie: await cookieFor(u) } });
  await new Promise((r) => s.on('connect', r)); await call(s, 'player:join', {}); return s; };

const socks = []; for (const u of users) socks.push(await conn(u));
const toasts = []; socks[1].on('toast', (m) => toasts.push(m));
const { code } = await call(socks[0], 'room:create', {});
await call(socks[1], 'room:join', { code });
await call(socks[2], 'room:join', { code });
await call(socks[0], 'room:updateSettings', { betWinner1: 300 });
const done = new Promise((r) => socks[0].on('room:state', (st) => { if (st.status === 'waiting' && st.instantWin) r(st); }));
socks[0].emit('game:start');
const st = await Promise.race([done, new Promise((r) => setTimeout(() => r(null), 8000))]);
await new Promise((r) => setTimeout(r, 300));

if (!st) console.log('no instant win settled ✗');
else {
  const n = (id) => st.players.find((p) => p.id === id)?.name || id;
  console.log('Winner 1 prize: 300  |  3 humans + 1 bot at the table');
  console.log('instantWin:', JSON.stringify({ who: n(st.instantWin.playerId), kind: st.instantWin.kind }));
  console.log('transfers:', st.lastTransfers.map((t) => `${n(t.from)} pays ${t.amount} to ${n(t.to)}`).join(' | '));
  console.log('winner collects:', st.players.find((p) => p.id === st.instantWin.playerId).lastDelta, '(target 900 = 300 × 3)');
  console.log('nets sum to zero:', st.players.reduce((a, p) => a + (p.lastDelta || 0), 0) === 0);
  console.log('bot involved in any transfer?', st.lastTransfers.some((t) => `${t.from}${t.to}`.includes('bot:')));
  console.log('toast seen by Bob:', JSON.stringify(toasts.find((t) => t.includes('instant'))));
}
const bal = await db.getSupabase().from('profiles').select('name,points').in('google_id', users.map(u => u.id));
console.log('wallets:', JSON.stringify(bal.data), '(started 5000 each)');
TienLenGame.prototype.detectInstantWin = real;
socks.forEach((s) => s.disconnect()); io.close(); http.close();
await db.getSupabase().from('profiles').delete().in('google_id', users.map(u => u.id));
process.exit(0);
