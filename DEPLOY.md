# Deploying to Hostinger

## Read this first: WebSockets

Hostinger's **Web and Cloud hosting plans (including Cloud Startup) do not accept
incoming WebSocket connections** — only outgoing ones. Hostinger's own answer to
this is to move to a VPS.

That does **not** block this game. Socket.IO starts every connection with HTTP
long-polling and only *upgrades* to a WebSocket if the host allows it. On Cloud
Startup the upgrade fails and play continues over long-polling: each move costs
an extra HTTP round trip, which a turn-based card game absorbs without trouble.
Set `NEXT_PUBLIC_SOCKET_TRANSPORT=polling` so the client does not waste time
attempting an upgrade that cannot succeed.

If the table ever feels laggy, a Hostinger **VPS** (KVM 1 is enough) gives real
WebSockets — same code, just drop that variable. See the VPS section at the end.

## Deploying on Cloud Startup

### 1. Push the code to GitHub

```bash
git add -A
git commit -m "Tien Len — points wallet, saved rooms"
git push
```

`.env` is gitignored and must stay that way: the Supabase service role key in it
bypasses row-level security.

### 2. hPanel → Websites → Node.js app

- **Build command**: `npm run build`
- **Output directory**: `.next`
- **Node version**: 20.x or newer
- **Source**: your GitHub repository

Either framework preset works. Hostinger's Node.js apps run `next start`, which
never executes `server.js` — so the game server also knows how to attach itself
from inside the app, via `pages/api/socket.js`. The client pings that route
before opening its socket, so nothing extra is needed.

If the panel does let you set a custom entry file, `server.js` with framework
`Other` is the tidier setup: the game server starts at boot instead of on the
first visit. Both are supported and the code picks whichever ran first.

### 3. Environment variables

Set these in the Node.js app's **Environment variables** panel *before* the first
build — `next build` reads them.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `AUTH_URL` | `https://yourdomain.com` |
| `AUTH_TRUST_HOST` | `true` |
| `AUTH_SECRET` | `openssl rand -base64 32` — a **new** one, not the local value |
| `AUTH_GOOGLE_ID` | from Google Cloud console |
| `AUTH_GOOGLE_SECRET` | from Google Cloud console |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `SUPABASE_QR_BUCKET` | `khqr` |
| `ADMIN_EMAILS` | your Google account email |
| `NEXT_PUBLIC_SOCKET_TRANSPORT` | `polling` (Cloud Startup only — omit on a VPS) |

Do **not** set `PORT`: Hostinger assigns it, and `server.js` reads
`process.env.PORT`.

Using a fresh `AUTH_SECRET` in production means local and live sessions are
signed with different keys, so a cookie from one is worthless on the other.

`AUTH_URL` is the one that bites. Auth.js builds the OAuth `redirect_uri` from
it, and behind Hostinger's proxy the request headers carry the *internal* listen
address. Leave it unset and the app tells Google its callback is
`https://0.0.0.0:3000/api/auth/callback/google`, which Google refuses with:

> Error 400: invalid_request — this app doesn't comply with Google's OAuth 2.0
> policy for keeping apps secure

Check what the live app is advertising at any time:

```bash
curl -s https://yourdomain.com/api/auth/providers
```

`signinUrl` and `callbackUrl` must both start with your real https domain. The
app now refuses to boot in production if `AUTH_URL` is missing or is not an
https origin, so this cannot ship silently again.

### 4. Google OAuth redirect URI

Google Cloud console → Credentials → your OAuth client → **Authorized redirect
URIs**, add:

```
https://yourdomain.com/api/auth/callback/google
```

Keep the localhost one for development. `AUTH_URL` must match the origin exactly
— `https://` not `http://`, and the same host with or without `www.` as people
actually visit.

### 5. Supabase

Nothing to move: the same Supabase project serves local and production. Confirm
every migration has been run in the SQL Editor:

- `supabase/schema.sql` — profiles, rounds, coins, `khqr` bucket
- `supabase/migrations/002_points.sql` — points wallet, top-ups, settings
- `supabase/migrations/003_admin_points.sql` — hand-set balances + audit
- `supabase/migrations/004_one_row_per_account.sql` — one profile per account
- `supabase/migrations/005_saved_rooms.sql` — saved rooms

### 6. Deploy and check

After the first deploy:

1. Sign in with Google — a row should appear in `profiles`.
2. Open `/admin` with your `ADMIN_EMAILS` account and upload the payment KHQR.
3. Open a second browser, create and join a room, deal a round.
4. Reload mid-round: the round pauses and your hand comes back.

## Things to know about this host

**One process only.** Long-polling requires every request from a player to reach
the same process. Do not scale the app to multiple instances without adding a
Socket.IO adapter (Redis) and sticky sessions — with several processes, players
would land in different copies of the room and see the table disagree with
itself.

**Rooms live in memory.** A redeploy restarts the process and clears them. Hosts
should press **Save room** so the seats and the round in progress are stored in
`game_rooms` and reloaded on boot. Wallets and history are in Postgres and are
never affected by a restart.

**Uploads go to Supabase Storage,** not the container's disk, so KHQR images
survive redeploys. The `public/uploads/` fallback only applies when Supabase is
not configured — don't rely on it in production.

## If you move to a VPS instead

The same code, with real WebSockets:

```bash
git clone <repo> && cd tien-len-card-game
npm ci
cp .env.example .env   # fill it in; omit NEXT_PUBLIC_SOCKET_TRANSPORT
npm run build
npx pm2 start npm --name tien-len -- start
npx pm2 save && npx pm2 startup
```

Put Nginx in front and let it pass upgrade headers through, or Socket.IO drops
back to polling anyway:

```nginx
server {
  listen 80;
  server_name yourdomain.com;

  location / {
    proxy_pass         http://127.0.0.1:8090;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;   # WebSocket handshake
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host $host;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
  }
}
```

Then `certbot --nginx -d yourdomain.com` for TLS, and set `AUTH_URL` to the
`https://` address.