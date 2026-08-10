'use client';

import { io } from 'socket.io-client';

let socket = null;

// Same-origin connection — the custom server hosts both Next.js and Socket.IO.
export function getSocket() {
  if (!socket) {
    socket = io();
  }
  return socket;
}
