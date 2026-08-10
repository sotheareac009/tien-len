import { Server } from 'socket.io';
import { attachGameServer } from '@/lib/socket-server';

// Starts the game server on the HTTP server Next.js is already running.
//
// server.js does the same thing and is the better setup — but hosts that only
// know how to run `next start` (Hostinger's Node.js apps among them) never
// execute it, leaving the site up with no real-time layer at all. A Pages
// Router API route is the one place Next hands you the underlying http.Server,
// via res.socket.server, so Socket.IO can attach to it from inside the app.
//
// The client pings this route once before connecting (see lib/socket-client.js).
// It is idempotent: whoever gets there first attaches, everyone else no-ops.

export const config = {
  api: { bodyParser: false },
};

export default function handler(req, res) {
  const httpServer = res.socket?.server;
  if (!httpServer) {
    // No underlying server to attach to — an edge/serverless runtime.
    res.status(500).json({ error: 'No HTTP server available for Socket.IO' });
    return;
  }

  if (httpServer.io) {
    res.status(200).json({ ok: true, started: false });
    return;
  }

  const io = new Server(httpServer, {
    // Long-polling first, upgrading to WebSocket where the host allows it.
    // Hostinger's Web/Cloud plans refuse incoming WebSocket connections, so
    // there the upgrade quietly fails and polling carries the game.
    transports: ['polling', 'websocket'],
    // Proxies can be slow to flush; be patient before declaring a player gone,
    // since that pauses their round.
    pingTimeout: 25000,
    pingInterval: 20000,
  });
  attachGameServer(io);
  // Marks the server as taken, so neither a second request here nor server.js
  // can attach a rival Socket.IO instance to the same port.
  httpServer.io = io;

  console.log('> Tien Len game server attached via /api/socket');
  res.status(200).json({ ok: true, started: true });
}