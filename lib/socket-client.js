'use client';

import { io } from 'socket.io-client';

let socket = null;

// Hostinger's Web and Cloud hosting plans reject incoming WebSocket
// connections, so set NEXT_PUBLIC_SOCKET_TRANSPORT=polling there: Socket.IO
// then talks over ordinary HTTP long-polling, which a turn-based card game
// handles comfortably. On a VPS (or locally) leave it unset and the client
// upgrades to a real WebSocket.
const transports =
  process.env.NEXT_PUBLIC_SOCKET_TRANSPORT === 'polling'
    ? ['polling']
    : ['polling', 'websocket'];

// Where the game server runs depends on how the app was started:
//   server.js      — attached at boot (local, VPS)
//   `next start`   — attached lazily by pages/api/socket.js on first request
// Pinging that route first covers both: it is a no-op when server.js already
// claimed the HTTP server, and starts the game server when nothing has.
let ready = null;
function ensureServer() {
  if (!ready) ready = fetch('/api/socket').catch(() => {});
  return ready;
}

// Same-origin connection — one process serves both Next.js and Socket.IO.
export function getSocket() {
  if (!socket) {
    socket = io({
      transports,
      // Connect only once the server is known to be listening, rather than
      // burning a failed attempt and waiting on the retry timer.
      autoConnect: false,
      // Keep trying after a drop: a seat is held and the round is paused
      // while a player is away, so reconnecting matters more than failing fast.
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });
    ensureServer().then(() => socket.connect());
  }
  return socket;
}
