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

// Same-origin connection — the custom server hosts both Next.js and Socket.IO.
export function getSocket() {
  if (!socket) {
    socket = io({
      transports,
      // Keep trying after a drop: a seat is held and the round is paused
      // while a player is away, so reconnecting matters more than failing fast.
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });
  }
  return socket;
}
