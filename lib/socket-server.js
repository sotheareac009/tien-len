import { customAlphabet } from 'nanoid';
import { TienLenGame } from './game/TienLenGame.js';
import { chooseMove } from './game/bot.js';
import { verifySocketUser } from './auth-socket.js';
import {
  upsertProfile,
  saveProfileQR,
  recordRound,
  isValidQRUrl,
  getPointsFor,
  applyPointDeltas,
  saveRoom,
  loadRooms,
  deleteRoom,
} from './db.js';
import { cleanPoints } from './points.js';

const roomCodeGen = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 5);

// Short tables are filled with bots so every round is played 4-handed. A bot
// holds no wallet, so it is skipped entirely when points are settled: the
// humans are ranked against each other and pay each other exactly as they
// would have without the bots. Nothing the bot wins or loses is real.
const BOT_PREFIX = 'bot:';
const BOT_NAMES = ['Bot Dara', 'Bot Sok', 'Bot Srey'];
// Visible thinking time before a bot plays; lowered in tests to run a full
// round quickly.
const BOT_DELAY_MS = Number(process.env.BOT_DELAY_MS) || 1200;
const TABLE_SEATS = 4;
// How long the loser's hand stays face-up after the catch-the-2 decision.
const REVEAL_MS = 5000;
const isBot = (seatId) => String(seatId).startsWith(BOT_PREFIX);
const humansIn = (ids) => (ids || []).filter((id) => !isBot(id));

// A seat belongs to a Google account, not to a socket. Reloading the page
// opens a new socket but keeps the same seat id, so the player drops straight
// back into their hand instead of losing it — see `restoreSeat` below.
//
// players: socketId -> { id: seatId, socketId, name, image, googleId, qrUrl, points, roomCode }
// sockets: seatId   -> socketId of that player's live connection
const players = new Map();
const sockets = new Map();
const rooms = new Map();

// A seat going offline mid-round freezes the table rather than letting the
// server play the hand. Nobody can act while paused, so a player who reloads
// cannot lose a trick — and nobody else can sneak a move in while they are
// away. The host resumes once everyone is back.

// Stakes are whole points; 1 point = 1000 riel (see lib/points.js).
const DEFAULT_SETTINGS = { betWinner1: 2, betWinner2: 1, bombBonus: 1, catch2Price: 1 };

function makeRoom(hostSeat) {
  return {
    code: roomCodeGen(),
    hostId: hostSeat,
    status: 'waiting', // waiting | playing | paused | catch2
    saved: false,      // host asked to keep this room across restarts
    savedBy: null,
    settings: { ...DEFAULT_SETTINGS },
    members: [hostSeat], // seat ids, also the seat order
    seats: {},           // seatId -> { name, image } — survives a disconnect
    game: null,
    bombPayments: [],    // { from, to, amount } chops earned this round
    catchPayment: null,  // { from, to, amount } from the catch-the-2 gamble
    pendingRanks: null,  // ranks held while waiting for the catch-2 decision
    tally: {},           // seatId -> net points across rounds in this room
    roundsPlayed: 0,
    history: [],       // [{ n, net }] one entry per finished round
    lastRanks: null,
    lastTransfers: null,
    lastDeltas: null,
    lastStuck: null,   // seats caught holding all 13 cards last round
    lastInstantWin: null, // { playerId, kind } when the deal decided the round
    tableSeats: null,  // seat order of the current deal: members plus any bots
    voice: new Set(),  // seats with their microphone open
    reveal: null,      // loser's hand shown face-up after a catch-the-2
    settleError: null,
    catchTimer: null,
  };
}

// A player left holding all 13 cards pays the winner double the Winner 1
// prize, and nothing else settles that round.
const STUCK_MULTIPLIER = 2;

// Four 2s or four 3s wins the round on the deal. The winner collects three
// times the Winner 1 prize in total, shared equally between the other players.
const INSTANT_WIN_MULTIPLIER = 3;

function computeTransfers(room, allRanks) {
  const { betWinner1, betWinner2 } = room.settings;
  const transfers = [];
  // Bots hold no wallet: rank the humans against each other and settle as if
  // the bots had not been at the table.
  const ranks = humansIn(allRanks);
  const n = ranks.length;
  const add = (from, to, amount) => {
    if (amount > 0 && from && to && from !== to && !isBot(from) && !isBot(to)) {
      transfers.push({ from, to, amount });
    }
  };

  // Instant win: one fixed pot, split evenly between everyone else. Any
  // remainder is spread over the first payers so the total lands exactly.
  if (room.lastInstantWin) {
    const winner = room.lastInstantWin.playerId;
    if (isBot(winner)) return transfers; // a bot collects nothing
    const payers = room.members.filter((id) => id !== winner);
    if (!payers.length) return transfers;
    const total = betWinner1 * INSTANT_WIN_MULTIPLIER;
    const each = Math.floor(total / payers.length);
    const extra = total - each * payers.length;
    payers.forEach((id, i) => add(id, winner, each + (i < extra ? 1 : 0)));
    return transfers;
  }

  // Stuck on 13: the penalty replaces the placings entirely. Stuck humans pay
  // the best-placed human — if a bot went out first, it collects nothing.
  if (room.lastStuck?.length) {
    const winner = ranks[0];
    if (!winner) return transfers; // no human placed: nothing to settle
    for (const id of humansIn(room.lastStuck)) add(id, winner, betWinner1 * STUCK_MULTIPLIER);
    return transfers;
  }

  if (n >= 2) add(ranks[n - 1], ranks[0], betWinner1);
  if (n === 3) add(ranks[2], ranks[1], betWinner2);
  if (n >= 4) add(ranks[n - 2], ranks[1], betWinner2);
  for (const bp of room.bombPayments) add(bp.from, bp.to, bp.amount);
  if (room.catchPayment) add(room.catchPayment.from, room.catchPayment.to, room.catchPayment.amount);
  return transfers;
}

// Net points per seat. Always sums to zero — points only move between the
// players at the table, the house takes nothing.
function netFrom(transfers) {
  const net = {};
  for (const t of transfers) {
    net[t.from] = (net[t.from] || 0) - t.amount;
    net[t.to] = (net[t.to] || 0) + t.amount;
  }
  return net;
}

// The most a seat can lose in one round before bomb chops: last place pays the
// Winner 1 prize, and with exactly 3 players it pays both prizes. Being caught
// stuck on 13 cards costs more than either, so that sets the floor.
function maxLossPerRound(settings, playerCount) {
  const { betWinner1, betWinner2 } = settings;
  const placings = playerCount === 3 ? betWinner1 + betWinner2 : Math.max(betWinner1, betWinner2);
  // Facing an instant win with only one other player at the table means paying
  // the whole pot, so that is the real worst case.
  return Math.max(
    placings,
    betWinner1 * STUCK_MULTIPLIER,
    betWinner1 * INSTANT_WIN_MULTIPLIER
  );
}

export function attachGameServer(io) {
  function err(socket, message) {
    socket.emit('toast', message);
  }

  const seatOf = (socket) => players.get(socket.id)?.id ?? null;
  const socketFor = (seatId) => io.sockets.sockets.get(sockets.get(seatId));
  const isOnline = (seatId) => sockets.has(seatId);

  function getRoom(socket) {
    const p = players.get(socket.id);
    return p?.roomCode ? rooms.get(p.roomCode) : null;
  }

  function roomOfSeat(seatId) {
    for (const room of rooms.values()) {
      if (room.members.includes(seatId)) return room;
    }
    return null;
  }

  function publicPlayer(room, id) {
    if (isBot(id)) {
      const g = room.game;
      const rankIdx = g ? g.finished.indexOf(id) : -1;
      return {
        id,
        name: room.seats[id]?.name || 'Bot',
        image: null,
        connected: true,
        isHost: false,
        isBot: true,
        points: null, // no wallet: bots never win or lose real points
        cardCount: g ? g.hand(id).length : 0,
        finishedRank: rankIdx === -1 ? null : rankIdx + 1,
        passed: g ? g.passed.has(id) : false,
        tally: 0,
        lastDelta: null,
      };
    }
    const p = players.get(sockets.get(id));
    const g = room.game;
    const rankIdx = g ? g.finished.indexOf(id) : -1;
    return {
      id,
      name: p?.name ?? room.seats[id]?.name ?? 'Left',
      image: p?.image ?? room.seats[id]?.image ?? null,
      connected: isOnline(id),
      isHost: room.hostId === id,
      points: p?.points ?? null,
      cardCount: g ? g.hand(id).length : 0,
      finishedRank: rankIdx === -1 ? null : rankIdx + 1,
      passed: g ? g.passed.has(id) : false,
      tally: room.tally[id] || 0,
      lastDelta: room.lastDeltas?.[id] ?? null,
      voice: room.voice?.has(id) ?? false,
    };
  }

  function stateFor(room, viewerId) {
    const g = room.game;
    return {
      code: room.code,
      status: room.status,
      hostId: room.hostId,
      you: viewerId,
      settings: room.settings,
      players: (room.tableSeats || room.members).map((id) => publicPlayer(room, id)),
      table: g?.table ? { type: g.table.type, cards: g.table.cards, playerId: g.table.playerId } : null,
      // The play the current one beat, shown faded underneath.
      prevTable: g?.prevTable
        ? { type: g.prevTable.type, cards: g.prevTable.cards, playerId: g.prevTable.playerId }
        : null,
      // The 3s pulled from every hand when the round opened.
      discarded: g?.discarded?.length ? g.discarded : null,
      openedBy: g?.openLeader ?? null, // who held the 3♠ and leads
      currentTurnId: g && !g.over ? g.currentPlayerId() : null,
      // Whether a bomb may be played on an ordinary single — the client cannot
      // work this out, since it never sees anyone else's hand.
      noTwosLeft: g ? g.noTwosLeftFor(viewerId) : false,
      yourHand: g ? g.hand(viewerId) : [],
      lastRanks: room.lastRanks,
      lastTransfers: room.lastTransfers,
      // Everything Catch2Panel needs to offer the gamble. Without this the
      // catcher is never shown the choice and the round just times out.
      catch2:
        room.status === 'catch2' && room.pendingRanks?.length >= 2
          ? {
              catcherId: room.pendingRanks[room.pendingRanks.length - 2],
              loserId: room.pendingRanks[room.pendingRanks.length - 1],
              loserCardCount: g ? g.hand(room.pendingRanks[room.pendingRanks.length - 1]).length : 0,
              price: room.settings.catch2Price,
            }
          : null,
      lastStuck: room.lastStuck,
      reveal: room.reveal,
      instantWin: room.lastInstantWin,
      roundsPlayed: room.roundsPlayed,
      history: room.history,
      settleError: room.settleError,
      minPoints: maxLossPerRound(room.settings, room.members.length),
      // How many bots will be dealt in if the round started now, so the room
      // can warn that points only move between the humans.
      botsNextRound: Math.max(0, TABLE_SEATS - room.members.length),
      saved: room.saved,
      // Who the table is waiting on, so the room can name them instead of
      // just saying "paused".
      offline: room.members.filter((id) => !isOnline(id)).map((id) => room.seats[id]?.name || '?'),
      canContinue: room.status === 'paused' && room.members.every(isOnline),
    };
  }

  function broadcastRoom(room) {
    for (const id of room.members) {
      socketFor(id)?.emit('room:state', stateFor(room, id));
    }
    if (room.saved) saveRoom(room); // keep the snapshot in step with the table
    scheduleBotMove(room);
  }

  // Play for a bot when the turn reaches it. Paused rooms are skipped, so a
  // bot never moves while a human is away.
  function scheduleBotMove(room) {
    clearTimeout(room.botTimer);
    room.botTimer = null;
    if (room.status !== 'playing' || !room.game || room.game.over) return;
    const id = room.game.currentPlayerId();
    if (!isBot(id)) return;
    room.botTimer = setTimeout(() => {
      room.botTimer = null;
      if (room.status !== 'playing' || !room.game || room.game.over) return;
      if (room.game.currentPlayerId() !== id) return;
      const move = chooseMove(room.game, id);
      let result = move ? room.game.play(id, move) : room.game.pass(id);
      if (result?.error) {
        // A bot must never stall the table: fall back to the safest legal move.
        result = room.game.autoMove(id);
      }
      handleBomb(room, result);
      handleGameResult(room, result);
      broadcastRoom(room);
    }, BOT_DELAY_MS);
  }

  // A seat dropped mid-round: freeze the table. The round is not abandoned —
  // hands, turn and tally all stay put until the host continues.
  function pauseRound(room) {
    if (room.status !== 'playing') return;
    room.status = 'paused';
  }

  function emitToRoom(room, event, payload) {
    for (const id of room.members) socketFor(id)?.emit(event, payload);
  }

  // Record a bomb chop's side payment and tell everyone to celebrate.
  function handleBomb(room, result) {
    if (!result?.bomb) return;
    const multiplier = result.bomb.multiplier || 1;
    const amount = room.settings.bombBonus * multiplier; // whole points
    if (amount > 0) {
      room.bombPayments.push({ from: result.bomb.victim, to: result.bomb.by, amount });
    }
    emitToRoom(room, 'game:bomb', {
      byName: room.seats[result.bomb.by]?.name || '?',
      victimName: room.seats[result.bomb.victim]?.name || '?',
      amount,
      multiplier,
    });
  }

  // Fire-and-forget history write. The round is already resolved in memory,
  // so a database hiccup must not delay or block the players.
  function persistRound(room, net) {
    recordRound({
      roomCode: room.code,
      settings: room.settings,
      players: room.members.map((id) => ({  // bots have no account to record
        googleId: id, // seat ids are Google account ids
        name: room.seats[id]?.name || 'Left',
        // 0 when the round ended before they placed (stuck on 13 cards).
        place: (room.lastRanks || []).indexOf(id) + 1,
        net: net[id] || 0,
      })),
      debts: [], // nobody owes anybody — the wallets already moved
    });
  }

  // Reloads wallet balances into the live player records, so the room always
  // shows what each seat can actually stake.
  async function refreshPoints(room) {
    const live = room.members.map((id) => players.get(sockets.get(id))).filter(Boolean);
    if (live.length === 0) return;
    const balances = await getPointsFor(live.map((p) => p.googleId));
    for (const p of live) {
      if (p.googleId in balances) p.points = balances[p.googleId];
    }
  }

  // Moves the round's points between wallets. Seat ids are Google account ids,
  // so a player who dropped mid-round is still settled correctly.
  async function settleWallets(room, net) {
    const deltas = {};
    for (const [seat, value] of Object.entries(net)) {
      if (value) deltas[seat] = (deltas[seat] || 0) + value;
    }
    const ok = await applyPointDeltas(deltas);
    room.settleError = ok ? null : 'Points could not be saved — check with the host before playing on.';
    await refreshPoints(room);
    broadcastRoom(room);
  }

  function finalizeRound(room) {
    const transfers = computeTransfers(room, room.lastRanks || []);
    const net = netFrom(transfers);
    room.lastTransfers = transfers;
    room.lastDeltas = net;
    for (const [id, v] of Object.entries(net)) room.tally[id] = (room.tally[id] || 0) + v;
    room.roundsPlayed += 1;
    // Keep a round-by-round record so the summary can show each result, not
    // just the running total. Bounded so a long session cannot grow unchecked.
    room.history.push({ n: room.roundsPlayed, net });
    if (room.history.length > 50) room.history.shift();
    // Wallets settle automatically — there is no peer-to-peer payment step.
    room.status = 'waiting';
    persistRound(room, net);
    settleWallets(room, net);
  }

  function handleGameResult(room, result) {
    if (!result?.roundOver) return;
    room.lastRanks = result.ranks;
    room.lastStuck = result.stuck || null;

    // Stuck on 13 ends the round outright: nobody placed below the winner, so
    // there is no last-winner to offer the catch-the-2 gamble to.
    if (room.lastStuck?.length) {
      emitToRoom(room, 'game:stuck', {
        winnerName: room.seats[result.ranks[0]]?.name || '?',
        stuckNames: room.lastStuck.map((id) => room.seats[id]?.name || '?'),
        amount: room.settings.betWinner1 * STUCK_MULTIPLIER,
      });
      finalizeRound(room);
      return;
    }

    // Catch-the-2 is settled in points, so it is offered between humans: the
    // last human to place may gamble on the human who placed below them.
    room.pendingRanks = humansIn(result.ranks);
    const catcher = room.pendingRanks[room.pendingRanks.length - 2];
    const loser = room.pendingRanks[room.pendingRanks.length - 1];
    // Only worth offering if that player actually still holds cards. When a bot
    // finishes last, the lowest-placed human went out with an empty hand — there
    // is no 2 to catch, and the gamble would be a guaranteed loss for the catcher.
    const loserHasCards = !!loser && !!room.game && room.game.hand(loser).length > 0;
    if (room.settings.catch2Price > 0 && catcher && loserHasCards) {
      room.status = 'catch2';
      clearTimeout(room.catchTimer);
      clearTimeout(room.botTimer);
      room.catchTimer = setTimeout(() => resolveCatch2(room, false), 20000);
    } else {
      finalizeRound(room);
    }
  }

  function resolveCatch2(room, didCatch) {
    if (room.status !== 'catch2' || !room.pendingRanks) return;
    clearTimeout(room.catchTimer);
    clearTimeout(room.botTimer);
    room.catchTimer = null;
    const ranks = room.pendingRanks;
    const catcher = ranks[ranks.length - 2];
    const loser = ranks[ranks.length - 1];
    if (didCatch && room.game) {
      const hasTwo = room.game.hand(loser).some((c) => c.rank === 15);
      const amount = room.settings.catch2Price;
      room.catchPayment = hasTwo
        ? { from: loser, to: catcher, amount }
        : { from: catcher, to: loser, amount };
      emitToRoom(room, 'game:catch2', {
        catcherName: room.seats[catcher]?.name || '?',
        loserName: room.seats[loser]?.name || '?',
        correct: hasTwo,
        amount,
      });
    }
    room.pendingRanks = null; // decision made — no further catch input

    // Turn the loser's remaining hand face-up for a few seconds, so everyone
    // can see for themselves whether the 2 was there. Shown whether or not the
    // catch was taken — skipping it is a decision worth seeing the answer to.
    const hand = room.game ? room.game.hand(loser) : [];
    room.reveal = {
      playerId: loser,
      name: room.seats[loser]?.name || '?',
      catcherName: room.seats[catcher]?.name || '?',
      cards: hand,
      hadTwo: hand.some((c) => c.rank === 15),
      caught: didCatch,
    };
    broadcastRoom(room);

    room.catchTimer = setTimeout(() => {
      room.catchTimer = null;
      room.reveal = null;
      finalizeRound(room);
      broadcastRoom(room);
    }, REVEAL_MS);
  }

  // Rooms the host saved are reloaded on boot, so a restart does not destroy a
  // live round. Everyone is offline at this point, so any round in progress
  // comes back paused and waits for the host to continue.
  async function restoreSavedRooms() {
    for (const r of await loadRooms()) {
      if (rooms.has(r.code)) continue;
      const game = TienLenGame.fromJSON(r.game);
      // Only a round still in play can be resumed. Anything else (including a
      // catch-the-2 that was mid-decision, whose pending state is not stored)
      // comes back between rounds — no points had moved, so nothing is lost.
      const inRound = !!game && !game.over && r.status !== 'waiting';
      const room = {
        ...makeRoom(r.host_id),
        code: r.code,
        hostId: r.host_id,
        status: inRound ? 'paused' : 'waiting',
        saved: true,
        savedBy: r.saved_by,
        settings: r.settings,
        members: r.members || [],
        seats: r.seats || {},
        tally: r.tally || {},
        roundsPlayed: r.rounds_played || 0,
        game: inRound ? game : null,
        lastRanks: r.last_ranks || null,
        lastDeltas: r.last_deltas || null,
      };
      rooms.set(room.code, room);
    }
  }
  restoreSavedRooms();

  io.on('connection', (socket) => {
    socket.on('player:join', async ({ name } = {}, ack) => {
      // A Google session is read from the handshake cookie, so a client can
      // never claim another person's name or account. Guests name themselves
      // and may only play single player.
      const account = await verifySocketUser(socket.handshake);
      const clean = account
        ? String(account.name).trim().slice(0, 20)
        : String(name || '').trim().slice(0, 20);
      if (!clean) return ack?.({ error: 'Please enter a name' });

      // The seat id is the Google account id for players, and the socket id
      // for guests (who never take a seat in an online room anyway).
      const seatId = account?.id ?? socket.id;

      // One connection per account: a second tab takes over the seat rather
      // than running two sockets against one hand.
      const previous = sockets.get(seatId);
      if (previous && previous !== socket.id) {
        players.delete(previous);
        io.sockets.sockets.get(previous)?.emit('toast', 'Your seat was opened in another tab');
      }

      const player = {
        id: seatId,
        socketId: socket.id,
        name: clean,
        image: account?.image ?? null,
        email: account?.email ?? null,
        googleId: account?.id ?? null,
        qrUrl: null,
        points: account ? 0 : null,
        roomCode: null,
      };
      players.set(socket.id, player);
      sockets.set(seatId, socket.id);

      ack?.({
        ok: true,
        id: seatId,
        name: clean,
        image: account?.image ?? null,
        signedIn: !!account,
      });

      if (!account) return;

      const profile = await upsertProfile({
        googleId: account.id,
        name: clean,
        email: account.email,
        image: account.image,
      });
      // Guard against a disconnect while the query was in flight.
      if (players.get(socket.id) !== player) return;
      if (!profile) {
        // The wallet could not be read. Say so rather than showing 0, which
        // would look like the player's points had vanished.
        player.points = null;
        err(socket, 'Could not load your account — your points are not shown');
      } else {
        if (profile.qr_url && !player.qrUrl) player.qrUrl = profile.qr_url;
        player.points = profile.points ?? 0;
      }

      restoreSeat(player);
    });

    // A reload, a dropped connection, or a phone waking up: the seat is still
    // in its room, so put the player straight back at the table with their
    // hand, rather than dumping them in the lobby while the server plays on.
    function restoreSeat(player) {
      const room = roomOfSeat(player.id);
      if (!room) {
        // Tell a reconnecting client its old room is gone (server restart, or
        // the table broke up while it was away) so it stops showing it.
        socket.emit('room:left');
        return;
      }
      player.roomCode = room.code;
      room.seats[player.id] = { name: player.name, image: player.image };
      broadcastRoom(room); // cancels any pending auto-move for this seat
      refreshPoints(room).then(() => broadcastRoom(room));
    }

    socket.on('profile:setQR', ({ url } = {}) => {
      const p = players.get(socket.id);
      if (!p) return;
      if (!isValidQRUrl(url)) return err(socket, 'Invalid QR image');
      p.qrUrl = url;
      if (p.googleId) saveProfileQR(p.googleId, url); // remembered for next time
      const room = getRoom(socket);
      if (room) broadcastRoom(room);
      else socket.emit('toast', 'KHQR saved');
    });

    // Online rooms are Google-only: a seat is tied to a points wallet, and a
    // guest has no account to hold one.
    const ONLINE_REQUIRES_ACCOUNT = 'Sign in with Google to play online';

    function takeSeat(room, p) {
      room.seats[p.id] = { name: p.name, image: p.image };
      p.roomCode = room.code;
    }

    socket.on('room:create', async (_payload, ack) => {
      const p = players.get(socket.id);
      if (!p) return;
      if (!p.googleId) return ack?.({ error: ONLINE_REQUIRES_ACCOUNT });
      if (p.roomCode) return ack?.({ error: 'You are already in a room' });
      const room = makeRoom(p.id);
      rooms.set(room.code, room);
      takeSeat(room, p);
      ack?.({ ok: true, code: room.code });
      await refreshPoints(room);
      broadcastRoom(room);
    });

    socket.on('room:join', async ({ code } = {}, ack) => {
      const p = players.get(socket.id);
      if (!p) return;
      if (!p.googleId) return ack?.({ error: ONLINE_REQUIRES_ACCOUNT });
      if (p.roomCode) return ack?.({ error: 'You are already in a room' });
      const room = rooms.get(String(code || '').trim().toUpperCase());
      if (!room) return ack?.({ error: 'Room not found' });
      if (room.members.includes(p.id)) return ack?.({ error: 'You are already in this room' });
      if (room.status !== 'waiting') return ack?.({ error: 'A round is in progress — try again after it ends' });
      if (room.members.length >= 4) return ack?.({ error: 'Room is full (4 players max)' });
      room.members.push(p.id);
      takeSeat(room, p);
      ack?.({ ok: true, code: room.code });
      await refreshPoints(room);
      broadcastRoom(room);
    });

    // After buying points (or an admin approving a top-up) the room should
    // show the new balance without anyone having to rejoin.
    socket.on('wallet:refresh', async () => {
      const p = players.get(socket.id);
      if (!p?.googleId) return;
      const room = getRoom(socket);
      if (room) {
        await refreshPoints(room);
        broadcastRoom(room);
      } else {
        const balances = await getPointsFor([p.googleId]);
        if (p.googleId in balances) p.points = balances[p.googleId];
      }
    });

    // --- voice chat -------------------------------------------------------
    // The server only carries the handshake: offers, answers and ICE
    // candidates, relayed between seats in the same room. Once connected the
    // audio flows directly between browsers.

    function announceVoice(room, seat, event) {
      for (const id of room.members) {
        if (id !== seat) socketFor(id)?.emit(event, { id: seat });
      }
    }

    socket.on('voice:join', (_payload, ack) => {
      const room = getRoom(socket);
      const seat = seatOf(socket);
      if (!room || !seat) return ack?.({ error: 'You are not in a room' });
      room.voice.add(seat);
      announceVoice(room, seat, 'voice:peer-joined');
      // The peers already talking, so the newcomer knows who to call.
      ack?.({ ok: true, peers: [...room.voice].filter((id) => id !== seat) });
      broadcastRoom(room);
    });

    socket.on('voice:leave', () => {
      const room = getRoom(socket);
      const seat = seatOf(socket);
      if (!room || !seat || !room.voice.delete(seat)) return;
      announceVoice(room, seat, 'voice:peer-left');
      broadcastRoom(room);
    });

    socket.on('voice:signal', ({ to, data } = {}) => {
      const room = getRoom(socket);
      const from = seatOf(socket);
      // Only ever between two seats of the same room — never a broadcast, and
      // never to someone at another table.
      if (!room || !from || !to || !room.members.includes(to)) return;
      socketFor(to)?.emit('voice:signal', { from, data });
    });

    socket.on('room:leave', () => {
      const p = players.get(socket.id);
      const room = getRoom(socket);
      if (!p || !room) return;
      if (room.status !== 'waiting') return err(socket, 'You can only leave between rounds');
      p.roomCode = null;
      room.members = room.members.filter((id) => id !== p.id);
      delete room.seats[p.id];
      room.voice.delete(p.id);
      socket.emit('room:left');
      if (room.members.length === 0) {
        clearTimeout(room.catchTimer);
        clearTimeout(room.botTimer);
        rooms.delete(room.code);
        if (room.saved) deleteRoom(room.code); // nothing left to come back to
        return;
      }
      if (room.hostId === p.id) room.hostId = room.members[0];
      broadcastRoom(room);
    });

    socket.on('room:updateSettings', (payload = {}) => {
      const room = getRoom(socket);
      if (!room) return;
      if (room.hostId !== seatOf(socket)) return err(socket, 'Only the host can change the stakes');
      if (room.status !== 'waiting') return err(socket, 'Stakes can only change between rounds');
      // Stakes are whole points — a fraction of a point has no riel value.
      const s = room.settings;
      const fields = {
        betWinner1: 'Winner 1 prize',
        betWinner2: 'Winner 2 prize',
        bombBonus: 'bomb bonus',
        catch2Price: 'catch-2 price',
      };
      for (const [key, label] of Object.entries(fields)) {
        if (payload[key] === undefined) continue;
        const v = cleanPoints(payload[key], { max: 10_000 });
        if (v === null) return err(socket, `Invalid ${label} — use whole points`);
        s[key] = v;
      }
      broadcastRoom(room);
    });

    socket.on('game:start', async () => {
      const room = getRoom(socket);
      if (!room) return;
      if (room.hostId !== seatOf(socket)) return err(socket, 'Only the host can start the round');
      if (room.status === 'playing') return err(socket, 'A round is already in progress');
      if (room.status === 'catch2') return err(socket, 'Waiting for the catch-the-2 decision');
      if (room.members.length < 2) return err(socket, 'Need at least 2 players');

      // Read balances straight from the wallet, not the cached copy, so a
      // stale broadcast can never let someone stake points they do not have.
      await refreshPoints(room);
      // The room can change while the database call is in flight — someone
      // leaves, or a second start slips through. Re-check before dealing:
      // TienLenGame throws on the wrong player count, and an uncaught throw in
      // a socket handler takes the whole server down.
      if (room.status !== 'waiting' || !rooms.has(room.code)) return;
      if (room.hostId !== seatOf(socket)) return;
      if (room.members.length < 2) return err(socket, 'Need at least 2 players');

      const needed = maxLossPerRound(room.settings, room.members.length);
      const broke = room.members.filter(
        (id) => (players.get(sockets.get(id))?.points ?? 0) < needed
      );
      if (broke.length > 0) {
        const names = broke.map((id) => room.seats[id]?.name || '?').join(', ');
        broadcastRoom(room);
        return err(socket, `Not enough points to cover ${needed} pt (short: ${names})`);
      }

      // The previous round's winner leads the next one and may open with
      // anything. A round that ended on the stuck-on-13 penalty is different:
      // it was cut short before most seats ever played, so the table resets —
      // the 3s are dropped again and the 3♠ leads, as at a fresh table.
      // Both are read before the reset below wipes them.
      const resetTable = !!room.lastStuck?.length;
      const starterId = resetTable ? null : (room.lastRanks?.[0] ?? null);

      room.lastRanks = null;
      room.lastTransfers = null;
      room.lastDeltas = null;
      room.lastStuck = null;
      room.lastInstantWin = null;
      room.reveal = null;
      room.settleError = null;
      room.bombPayments = [];
      room.catchPayment = null;
      room.pendingRanks = null;

      // Fill the empty seats so every round is played 4-handed: two humans get
      // two bots, three get one. Bots are seated for the deal only — they are
      // never room members, so they cannot host, vote or hold points.
      const bots = [];
      for (let i = 0; room.members.length + bots.length < TABLE_SEATS; i++) {
        const id = `${BOT_PREFIX}${i}`;
        room.seats[id] = { name: BOT_NAMES[i] || `Bot ${i + 1}`, image: null };
        bots.push(id);
      }
      room.tableSeats = [...room.members, ...bots];
      room.game = new TienLenGame(room.tableSeats, null, { starterId });
      room.status = 'playing';

      // Tell everyone how the round opened: either the 3♠ holder leads after
      // the discard, or the last winner carries the lead over.
      // Four 2s or four 3s ends the round on the deal, before anyone acts.
      const iw = room.game.instantWin;
      if (iw) {
        room.lastInstantWin = iw;
        room.lastRanks = [iw.playerId];
        emitToRoom(room, 'toast',
          `${iw.kind === 'four2s' ? '2️⃣2️⃣2️⃣2️⃣' : '3️⃣3️⃣3️⃣3️⃣'} ${room.seats[iw.playerId]?.name || '?'} was dealt four ${iw.kind === 'four2s' ? '2s' : '3s'} — instant win!`);
        finalizeRound(room);
        broadcastRoom(room);
        return;
      }

      const opener = room.game.openLeader;
      emitToRoom(
        room,
        'toast',
        opener
          ? `🂡 ${room.seats[opener]?.name || '?'} had the 3♠ — they lead the round`
          : `🏆 ${room.seats[starterId]?.name || '?'} won last round — they lead`
      );
      broadcastRoom(room);
    });

    // Resume a round frozen by a disconnect. Everyone must be back first, so
    // no hand is ever played while its owner is away.
    socket.on('room:continue', () => {
      const room = getRoom(socket);
      if (!room) return;
      if (room.status !== 'paused') return;
      if (room.hostId !== seatOf(socket)) return err(socket, 'Only the host can continue the round');
      const missing = room.members.filter((id) => !isOnline(id));
      if (missing.length > 0) {
        const names = missing.map((id) => room.seats[id]?.name || '?').join(', ');
        return err(socket, `Still waiting for ${names} to come back`);
      }
      room.status = 'playing';
      emitToRoom(room, 'toast', 'Round resumed');
      broadcastRoom(room);
    });

    // Keep this room across a server restart: members, stakes, tally and the
    // round in progress are stored, and reloaded on boot.
    socket.on('room:save', async (_payload, ack) => {
      const room = getRoom(socket);
      // Always answer: a caller waiting on the ack would hang otherwise.
      if (!room) return ack?.({ error: 'You are not in a room' });
      if (room.hostId !== seatOf(socket)) {
        err(socket, 'Only the host can save the room');
        return ack?.({ error: 'Only the host can save the room' });
      }
      room.saved = true;
      room.savedBy = seatOf(socket);
      const ok = await saveRoom(room);
      if (!ok) {
        room.saved = false;
        err(socket, 'Could not save the room');
        return ack?.({ error: 'Could not save the room' });
      }
      emitToRoom(room, 'toast', 'Room saved — it will survive a restart');
      broadcastRoom(room);
      ack?.({ ok: true });
    });

    // Close the room for everyone and forget the saved copy.
    socket.on('room:delete', async (_payload, ack) => {
      const room = getRoom(socket);
      if (!room) return ack?.({ error: 'You are not in a room' });
      if (room.hostId !== seatOf(socket)) {
        err(socket, 'Only the host can delete the room');
        return ack?.({ error: 'Only the host can delete the room' });
      }
      // A round in progress has not settled, so nothing is owed either way —
      // but say so plainly rather than letting points look lost.
      const midRound = room.status === 'playing' || room.status === 'paused';
      clearTimeout(room.catchTimer);
      clearTimeout(room.botTimer);
      for (const id of room.members) {
        const s = socketFor(id);
        const p = players.get(sockets.get(id));
        if (p) p.roomCode = null;
        s?.emit('toast', midRound ? 'The host closed the room — the round was not settled' : 'The host closed the room');
        s?.emit('room:left');
      }
      rooms.delete(room.code);
      await deleteRoom(room.code);
      ack?.({ ok: true });
    });

    socket.on('game:play', ({ cardIds } = {}) => {
      const room = getRoom(socket);
      if (!room || room.status !== 'playing' || !room.game) return;
      const result = room.game.play(seatOf(socket), cardIds);
      if (result.error) return err(socket, result.error);
      handleBomb(room, result);
      handleGameResult(room, result);
      broadcastRoom(room);
    });

    socket.on('game:pass', () => {
      const room = getRoom(socket);
      if (!room || room.status !== 'playing' || !room.game) return;
      const result = room.game.pass(seatOf(socket));
      if (result.error) return err(socket, result.error);
      broadcastRoom(room);
    });

    socket.on('catch2:decide', ({ catch: doCatch } = {}) => {
      const room = getRoom(socket);
      if (!room || room.status !== 'catch2' || !room.pendingRanks) return;
      const catcher = room.pendingRanks[room.pendingRanks.length - 2];
      if (seatOf(socket) !== catcher) return err(socket, 'Only the last winner can catch the 2');
      resolveCatch2(room, !!doCatch);
    });

    socket.on('disconnect', () => {
      const p = players.get(socket.id);
      players.delete(socket.id);
      if (!p) return;
      // Only clear the seat's live socket if this was still the current one —
      // a reconnect that already took over must not be undone by the old
      // socket's late disconnect event.
      if (sockets.get(p.id) === socket.id) sockets.delete(p.id);
      else return;

      if (!p.roomCode) return;
      const room = rooms.get(p.roomCode);
      if (!room) return;

      // A closed tab takes its microphone with it.
      if (room.voice.delete(p.id)) {
        for (const id of room.members) socketFor(id)?.emit('voice:peer-left', { id: p.id });
      }

      // Between rounds a disconnect gives up the seat — unless the host saved
      // the room, in which case the seat is held for them to come back to.
      if (room.status === 'waiting') {
        if (!room.saved) {
          room.members = room.members.filter((id) => id !== p.id);
          delete room.seats[p.id];
          if (room.members.length === 0) {
            clearTimeout(room.catchTimer);
            clearTimeout(room.botTimer);
            rooms.delete(room.code);
            return;
          }
          if (room.hostId === p.id) room.hostId = room.members[0];
        }
      }

      // Mid-round the seat is always kept, and the table freezes: nobody plays
      // on while a player is away, so a reload can never cost them a trick.
      pauseRound(room);

      // A catcher who leaves forfeits the catch-the-2 gamble.
      if (
        room.status === 'catch2' &&
        room.pendingRanks &&
        room.pendingRanks[room.pendingRanks.length - 2] === p.id
      ) {
        resolveCatch2(room, false);
        return;
      }
      broadcastRoom(room);
    });
  });
}