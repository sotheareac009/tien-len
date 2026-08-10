// Custom Next.js server with Socket.IO attached — one process serves both
// the web app and the real-time game.
import { createServer } from 'http';
import nextEnv from '@next/env';
import next from 'next';
import { Server } from 'socket.io';
import { attachGameServer } from './lib/socket-server.js';

// Load .env before anything reads process.env (the socket layer needs
// AUTH_SECRET to verify session cookies). @next/env is CommonJS.
nextEnv.loadEnvConfig(process.cwd());

// Auth.js builds the Google OAuth redirect_uri from AUTH_URL. Behind a reverse
// proxy the request headers carry the internal listen address, so without this
// the app cheerfully tells Google its callback is https://0.0.0.0:3000/... and
// every sign-in dies with "Error 400: invalid_request". Checked here at boot
// rather than in auth.js, which is also evaluated during `next build`.
function checkAuthUrl() {
  const raw = process.env.AUTH_URL;
  const fail = (why) => {
    console.error(`\n✗ AUTH_URL ${why}.`);
    console.error(`  Set it to your public origin, e.g. https://sotheareach.site`);
    console.error(`  Google will reject every sign-in until you do. See DEPLOY.md.\n`);
    process.exit(1);
  };
  if (!raw) fail('is not set');
  let url;
  try {
    url = new URL(raw);
  } catch {
    return fail(`is not a valid URL (${raw})`);
  }
  if (url.protocol !== 'https:') fail(`must use https (${raw})`);
  // Google only accepts a real registered domain: no IP literals, no localhost.
  const host = url.hostname;
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
  if (isIp || host === 'localhost' || !host.includes('.')) {
    fail(`must be a public domain, not ${host}`);
  }
}

const dev = process.env.NODE_ENV !== 'production';
if (!dev) checkAuthUrl();

// The host assigns the port in production (Hostinger, and most PaaS, set PORT).
const port = parseInt(process.env.PORT || '8090', 10);
// Bind every interface so a reverse proxy in front of the app can reach it.
const host = process.env.HOST || '0.0.0.0';

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));
  const io = new Server(httpServer, {
    // Long-polling first, upgrading to WebSocket where the host allows it.
    // Hostinger's Web/Cloud plans refuse incoming WebSocket connections, so
    // there the upgrade quietly fails and polling carries the game.
    transports: ['polling', 'websocket'],
    // Proxies in front of the app can be slow to flush; be patient before
    // declaring a player gone, since that pauses their round.
    pingTimeout: 25000,
    pingInterval: 20000,
  });
  attachGameServer(io);
  // Claim the server so pages/api/socket.js (the fallback for hosts that only
  // run `next start`) sees the game server is already running and stands down.
  httpServer.io = io;

  httpServer.listen(port, host, () => {
    console.log(`> Tien Len ready on http://${host}:${port}`);
  });
});
