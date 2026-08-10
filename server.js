// Custom Next.js server with Socket.IO attached — one process serves both
// the web app and the real-time game.
import { createServer } from 'http';
import next from 'next';
import { Server } from 'socket.io';
import { attachGameServer } from './lib/socket-server.js';

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));
  const io = new Server(httpServer);
  attachGameServer(io);

  httpServer.listen(port, () => {
    console.log(`> Tien Len ready on http://localhost:${port}`);
  });
});
