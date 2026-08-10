# Tien Len — Online Card Game 🂡

Real-time multiplayer Tien Len (Tiến Lên / ទាញឡេន) built with **Next.js + Socket.IO**, with **KHQR payouts** settled between players after every round.

## Features

- **Two game modes**:
  - **Online multiplayer** with real KHQR stakes (below).
  - **Single player vs bots** — free, played with app coins (like Tien Len – Southern Poker). Pick 1–3 bot opponents, set the coin stakes per round, and your balance is saved in the browser. Broke? Grab a free coin top-up. No KHQR, no real money.
- **Real-time multiplayer** (2–4 players) over Socket.IO — create a room, share the 5-letter code, play.
- **Full Tien Len rules**: singles, pairs, triples, four-of-a-kind, straights, double sequences; 2s are highest; bombs chop 2s; lowest card (3♠) leads the first trick.
- **Stakes per round**: the host sets the **Winner 1** and **Winner 2** prize amounts and currency (USD or KHR).
- **KHQR payments**: every player uploads a screenshot of their own bank-app KHQR. When a round ends:
  - last place pays the Winner 1 prize to 1st place
  - 3rd place pays the Winner 2 prize to 2nd place (with 3 players, last place pays both)
- **Pay before you play again**: after a round the room is locked in a payment phase. Each payer scans the winner's KHQR, pays in their bank app, and taps **"I've paid"**; the winner taps **"Confirm received"**. Only when every debt is confirmed can the host start the next round.
- **Catch-the-2** 🐷 (configurable price): after the round, the last winner may gamble that the loser is still holding a 2 — right, the loser pays the price; wrong, the catcher pays the loser. Settled through the same KHQR debt flow (or coins in single player).
- Running win/loss tally per player across rounds.

## Run it

```bash
npm install
npm run dev          # http://localhost:3080
```

Production:

```bash
npm run build
npm start
```

Open the URL in multiple browser windows (or share your LAN/deployed URL) to play together.

## How it works

- `server.js` — custom Next.js server; one process serves the web app and Socket.IO.
- `lib/game/` — pure Tien Len engine (`cards.js`, `combos.js`, `TienLenGame.js`), no I/O. `bot.js` is the single-player AI. Because the engine is pure JS, single-player mode runs entirely in the browser (`components/SinglePlayer.jsx`) with no server round-trips.
- `lib/socket-server.js` — rooms, seats, stakes, the round lifecycle, and the payment/confirmation flow. All state is in memory.
- `app/api/upload-qr/route.js` — KHQR image upload (PNG/JPG/WebP, max 5MB) saved to `public/uploads/`.
- `components/` — React client: lobby, waiting room, game table, payment overlay.

## Rules implemented

- 13 cards each; rank order `3 < 4 < … < K < A < 2`, suit order `♠ < ♣ < ♦ < ♥`.
- Holder of the lowest dealt card leads the round and must include it in the first play.
- A play must match the type and size of the combo on the table and be higher.
- Bombs (house rules): a single 2 is beaten only by a quad or a 5-card straight flush (5+ consecutive cards in one suit); a pair of 2s is beaten only by a 4-pair double sequence; a quad is beaten by a 4-pair double sequence or a straight flush. Double sequences never chop a single 2, and 3-pair double sequences are not bombs at all. Chopping pays the configurable bomb bonus, with an escalating chain: chopping a 2 pays ×1, chopping a quad/bomb pays ×2, and each counter-chop (e.g. a higher straight flush over a chopping straight flush) doubles the previous profit (×4, ×8, …). The chain resets when the trick ends.
- When everyone else passes, the trick winner leads a fresh trick.
- Play continues until only one player has cards, producing a full 1st→last ranking.

## Notes & limitations

- Payments are **person-to-person via KHQR** — the app never touches money. "Paid" / "confirm" are honor-system buttons; there is no bank verification.
- State is in memory: restarting the server clears rooms; a player who disconnects mid-round is auto-played (pass, or lowest card when leading).
- The win/loss tally assumes the room keeps one currency.
- Please check the laws in your jurisdiction before playing for real money.

## Ideas for later

- Persist accounts/rooms in a database (e.g. Postgres + Prisma) and support reconnection.
- Instant-win hands (four 2s, dragon straight), turn timers, spectators, chat.
- Generate KHQR from account data (EMVCo payload) instead of image upload.
