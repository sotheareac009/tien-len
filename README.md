# Tien Len — Online Card Game 🂡

Real-time multiplayer Tien Len (Tiến Lên / ទាញឡេន) built with **Next.js + Socket.IO**. Online rooms are played for **points bought with KHQR** — **1 point = 1,000៛** — and settle automatically out of each player's wallet.

## Features

- **Google sign-in** (NextAuth / Auth.js) — your Google name and profile photo carry into rooms; identity is verified server-side from the session cookie, so nobody can play under someone else's name. **Online rooms are sign-in only**: a seat holds real points, so it needs an account to belong to.
- **Two game modes**:
  - **Online multiplayer** for points (below).
  - **Single player vs bots** — free, played with app coins. Pick 1–3 bot opponents, set the coin stakes per round. Signed-in players keep their balance on their account (Supabase), so it follows them to any device; guests keep theirs in the browser. Broke? Grab a free coin top-up. Guests are welcome here — no account, no real money.
- **Points wallet**: players buy points from the operator by scanning **one KHQR you upload**, then submitting the transfer. Points are credited only once you approve the request in the operator console — there is no bank API that can confirm it automatically.
- **Real-time multiplayer** (2–4 players) over Socket.IO — create a room, share the 5-letter code, play.
- **Bots fill the empty seats**: every round is played 4-handed, so two people get two bots and three get one. Bots hold no wallet — the humans are ranked against each other and pay each other exactly as they would have on their own, so a round stays zero-sum and the house never funds a payout.
- **Full Tien Len rules**: singles, pairs, triples, four-of-a-kind, straights, double sequences (2+ consecutive pairs); 2s are highest; bombs chop 2s; lowest card (3♠) leads the first trick.
- **Stakes per round in points**: the host sets the **Winner 1** and **Winner 2** prizes, the bomb bonus, and the catch-2 price. Nobody is dealt in until their wallet covers the most they could lose.
- **Automatic settlement**: when a round ends, points move straight between the players' wallets in a single database statement — last place pays the Winner 1 prize to 1st place, 3rd place pays the Winner 2 prize to 2nd (with 3 players, last place pays both). No "I've paid / confirm received" step, and no peer-to-peer transfers.
- **Catch-the-2** 🐷 (configurable price): after the round, the last winner may gamble that the loser is still holding a 2 — right, the loser pays the price; wrong, the catcher pays the loser.
- **Room summary**: running net per player in points *and* riel, plus how much changed hands. The house takes no cut, so the net column always sums to zero.
- **Operator console** (`/admin`): upload the payment KHQR and approve or reject top-ups.

## Run it

```bash
npm install
cp .env.example .env   # then fill in your Google OAuth credentials
npm run dev            # http://localhost:8090
```

### Google sign-in setup

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials) create an **OAuth 2.0 Client ID** (type: Web application).
2. Add an **Authorized redirect URI**: `http://localhost:8090/api/auth/callback/google` (and the same path on your deployed domain).
3. Put the client ID/secret in `.env` as `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`, and generate `AUTH_SECRET` with `openssl rand -base64 32`.
4. `AUTH_URL` must match the origin you serve from, or the callback will be rejected.

### Database setup (Supabase — optional)

The game runs fine without a database (everything stays in memory). Adding
Supabase gets you saved KHQR images, remembered profiles, and match history.

1. Create a project at [supabase.com](https://supabase.com).
2. Copy the **Project URL** and **service role key** (Project Settings → API)
   into `.env` as `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.
3. Open the SQL Editor and run, in order:
   [`supabase/schema.sql`](supabase/schema.sql) — profiles, match history,
   single-player coins, and the public `khqr` storage bucket — then
   [`supabase/migrations/002_points.sql`](supabase/migrations/002_points.sql) —
   the points wallet, top-up requests, and operator settings.
4. Put your own Google account email in `ADMIN_EMAILS`, restart, and open
   `/admin` to upload the KHQR players will pay into.

The service role key bypasses row-level security, so it is only ever read on
the server (`lib/db.js`) — never import that module from a client component.

`.env` is gitignored — never commit it.

Production:

```bash
npm run build
npm start
```

Open the URL in multiple browser windows (or share your LAN/deployed URL) to play together.

To put it online, see [DEPLOY.md](DEPLOY.md) — Hostinger Cloud Startup (and the
WebSocket caveat that comes with it), or a VPS.

## How it works

- `server.js` — custom Next.js server; one process serves the web app and Socket.IO.
- `lib/game/` — pure Tien Len engine (`cards.js`, `combos.js`, `TienLenGame.js`), no I/O. `bot.js` is the single-player AI. Because the engine is pure JS, single-player mode runs entirely in the browser (`components/SinglePlayer.jsx`) with no server round-trips.
- `lib/socket-server.js` — rooms, seats, point stakes, the round lifecycle, and wallet settlement. Room state is in memory; wallets are not.
- `lib/points.js` — the one place the 1 pt = 1,000៛ rate lives, shared by client and server.
- `auth.js` + `app/api/auth/[...nextauth]/route.js` — NextAuth (Google provider, JWT sessions).
- `lib/auth-socket.js` — decodes the Auth.js session cookie during the Socket.IO handshake so the server trusts its own identity, not client-supplied names.
- `app/api/upload-qr/route.js` — KHQR image upload (PNG/JPG/WebP, max 5MB), stored in the Supabase `khqr` bucket, or `public/uploads/` when Supabase is not configured.
- `app/api/coins/route.js` — single-player coin balance for signed-in players, read from the Auth.js session (never a client-supplied id). Guests get a 401 and the client keeps using `localStorage`.
- `app/api/wallet/route.js` + `app/api/topups/route.js` — the player's point balance, the operator's KHQR, and their purchase requests.
- `app/api/admin/*` + `app/admin/page.jsx` — operator console, gated on `ADMIN_EMAILS` against the session, checked again on every write.
- `lib/db.js` — server-only Supabase access: profiles (name/photo/KHQR/coins/points), the points wallet, top-ups, round history, QR storage. Every helper no-ops when the env vars are unset, so a database outage can never interrupt a round.
- `components/` — React client: lobby, waiting room, game table, buy-points and room-summary panels.

## Rules implemented

- 13 cards each; rank order `3 < 4 < … < K < A < 2`, suit order `♠ < ♣ < ♦ < ♥`.
- **Opening round of a table**: every 3 is discarded from every hand automatically, and whoever held the 3♠ leads with a free choice. Later rounds are led by the previous round's winner, who also opens with anything.
- Holder of the lowest dealt card leads only when the 3♠ was not dealt (2- and 3-player games use part of the deck).
- A play must match the type and size of the combo on the table and be higher.
- **Single-suit straights**: a straight played entirely in one suit can only be beaten by a higher straight that is also all one suit, at any length. A mixed straight on the table is still beaten by any higher straight.
- Bombs (house rules): a single 2 is beaten only by a quad or a 5-card straight flush (5+ consecutive cards in one suit); a pair of 2s is beaten only by a 4-pair double sequence; a quad is beaten by a 4-pair double sequence or a straight flush. Double sequences never chop a single 2, and 2- and 3-pair double sequences are not bombs at all. Chopping pays the configurable bomb bonus, with an escalating chain: chopping a 2 pays ×1, chopping a quad/bomb pays ×2, and each counter-chop (e.g. a higher straight flush over a chopping straight flush) doubles the previous profit (×4, ×8, …). The chain resets when the trick ends.
- **Instant wins**: a hand dealt **four 2s** or **four 3s** wins the round outright, with no cards played. The winner collects **three times the Winner 1 prize in total**, shared equally between the other players. If both hands appear in the same deal — to one player or two — the opening round (a new table, or the one after a penalty) is won by the four 3s, and any other round by the four 2s.
- **Stuck on 13 (thối 13 lá)**: if the winner goes out while anyone still holds all 13 cards, the round ends immediately — nobody else places. Each player caught on a full hand pays the winner **double the Winner 1 prize**, and nothing else settles that round. With a 300 prize and three players stuck, the winner collects 1,800.
- When everyone else passes, the trick winner leads a fresh trick.
- Play continues until only one player has cards, producing a full 1st→last ranking.

## Notes & limitations

- **Top-ups are approved by hand.** No Cambodian bank exposes an API this app could use to verify a transfer, so the operator checks their own bank app and clicks Approve. A player who claims a payment they never made simply does not get approved.
- **Points are one-way.** There is no cash-out flow: points are bought and spent in the game. Adding withdrawals would mean a payout queue and a second admin screen.
- **A wallet can go negative** if a chain of bomb chops costs more than the entry check reserved. The player must top up before they can be dealt in again — the ledger stays exact rather than quietly writing off the difference.
- Room state is in memory: restarting the server clears rooms (wallets and history survive, they are in Postgres). A player who disconnects mid-round is auto-played (pass, or lowest card when leading), and their seat is still settled.
- Please check the laws in your jurisdiction before playing for real money.

## Ideas for later

- Persist live rooms (not just profiles and finished rounds) so players can reconnect after a server restart.
- Surface the stored match history in the UI — lifetime win/loss per player across all rooms.
- Cash-out requests, if points ever need to flow back to riel.
- Instant-win hands (four 2s, dragon straight), turn timers, spectators, chat.
- Generate KHQR from account data (EMVCo payload) instead of image upload.
