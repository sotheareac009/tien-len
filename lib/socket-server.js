import { customAlphabet } from 'nanoid';
import { TienLenGame } from './game/TienLenGame.js';

const roomCodeGen = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 5);
const idGen = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 10);

// In-memory state (single server process). Player id = socket id.
const players = new Map(); // socketId -> { id, name, qrUrl, roomCode }
const rooms = new Map();   // code -> room

const DEFAULT_SETTINGS = { betWinner1: 1, betWinner2: 0.5, bombBonus: 0.5, catch2Price: 0.5, currency: 'USD' };

function makeRoom(hostId) {
  return {
    code: roomCodeGen(),
    hostId,
    status: 'waiting', // waiting | playing | catch2 | payment
    settings: { ...DEFAULT_SETTINGS },
    members: [hostId], // playerIds, also the seat order
    game: null,
    debts: [],         // { id, from, to, amount, currency, paidByPayer, confirmedByPayee }
    bombPayments: [],  // { from, to, amount } side payments earned by bomb chops this round
    catchPayment: null, // { from, to, amount } from the catch-the-2 gamble
    pendingRanks: null, // ranks held while waiting for the catch-2 decision
    tally: {},         // playerId -> net winnings across rounds
    lastRanks: null,   // playerIds in finish order of the last round
    autoMoveTimer: null,
    catchTimer: null,
  };
}

// Payout scheme:
//   last place pays the "Winner 1" prize to 1st place
//   3rd place pays the "Winner 2" prize to 2nd place (4 players)
//   with 3 players, last place pays both prizes
//   plus any bomb-chop bonuses collected during the round
function computeDebts(room, ranks) {
  const { betWinner1, betWinner2, currency } = room.settings;
  const debts = [];
  const n = ranks.length;
  const add = (from, to, amount) => {
    if (amount > 0 && from && to && from !== to) {
      debts.push({ id: idGen(), from, to, amount, currency, paidByPayer: false, confirmedByPayee: false });
    }
  };
  if (n >= 2) add(ranks[n - 1], ranks[0], betWinner1);
  if (n === 3) add(ranks[2], ranks[1], betWinner2);
  if (n >= 4) add(ranks[n - 2], ranks[1], betWinner2);
  for (const bp of room.bombPayments) add(bp.from, bp.to, bp.amount);
  if (room.catchPayment) add(room.catchPayment.from, room.catchPayment.to, room.catchPayment.amount);
  return debts;
}

function applyTally(room) {
  for (const d of room.debts) {
    room.tally[d.from] = (room.tally[d.from] || 0) - d.amount;
    room.tally[d.to] = (room.tally[d.to] || 0) + d.amount;
  }
}

export function attachGameServer(io) {
  function err(socket, message) {
    socket.emit('toast', message);
  }

  function getRoom(socket) {
    const p = players.get(socket.id);
    return p?.roomCode ? rooms.get(p.roomCode) : null;
  }

  function publicPlayer(room, id) {
    const p = players.get(id);
    const g = room.game;
    const rankIdx = g ? g.finished.indexOf(id) : -1;
    return {
      id,
      name: p?.name ?? 'Left',
      hasQR: !!p?.qrUrl,
      qrUrl: p?.qrUrl ?? null,
      connected: !!p,
      isHost: room.hostId === id,
      cardCount: g ? g.hand(id).length : 0,
      finishedRank: rankIdx === -1 ? null : rankIdx + 1,
      passed: g ? g.passed.has(id) : false,
      tally: room.tally[id] || 0,
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
      players: room.members.map((id) => publicPlayer(room, id)),
      table: g?.table ? { type: g.table.type, cards: g.table.cards, playerId: g.table.playerId } : null,
      currentTurnId: g && !g.over ? g.currentPlayerId() : null,
      yourHand: g ? g.hand(viewerId) : [],
      debts: room.debts,
      lastRanks: room.lastRanks,
      catch2:
        room.status === 'catch2' && room.pendingRanks
          ? {
              catcherId: room.pendingRanks[room.pendingRanks.length - 2],
              loserId: room.pendingRanks[room.pendingRanks.length - 1],
              loserCardCount: g ? g.hand(room.pendingRanks[room.pendingRanks.length - 1]).length : 0,
              price: room.settings.catch2Price,
            }
          : null,
    };
  }

  function broadcastRoom(room) {
    for (const id of room.members) {
      const sock = io.sockets.sockets.get(id);
      if (sock) sock.emit('room:state', stateFor(room, id));
    }
    scheduleAutoMove(room);
  }

  // Record a bomb chop's side payment and tell everyone to celebrate.
  // Chain chops (chopping a bomb, counter-chopping) pay multiplied bonuses.
  function handleBomb(room, result) {
    if (!result?.bomb) return;
    const multiplier = result.bomb.multiplier || 1;
    const amount = Math.round(room.settings.bombBonus * multiplier * 100) / 100;
    if (amount > 0) {
      room.bombPayments.push({ from: result.bomb.victim, to: result.bomb.by, amount });
    }
    const payload = {
      byName: players.get(result.bomb.by)?.name || '?',
      victimName: players.get(result.bomb.victim)?.name || '?',
      amount,
      multiplier,
      currency: room.settings.currency,
    };
    for (const id of room.members) {
      io.sockets.sockets.get(id)?.emit('game:bomb', payload);
    }
  }

  function finalizeRound(room) {
    room.debts = computeDebts(room, room.lastRanks);
    applyTally(room);
    // "Pay first, then start a new round": block the room in payment
    // status until every debt is confirmed by its receiver.
    room.status = room.debts.length > 0 ? 'payment' : 'waiting';
  }

  function handleGameResult(room, result) {
    if (!result?.roundOver) return;
    room.lastRanks = result.ranks;
    room.pendingRanks = result.ranks;
    // Catch-the-2: the last winner may gamble that the loser still holds a 2.
    const catcher = result.ranks[result.ranks.length - 2];
    if (room.settings.catch2Price > 0 && players.has(catcher)) {
      room.status = 'catch2';
      clearTimeout(room.catchTimer);
      room.catchTimer = setTimeout(() => resolveCatch2(room, false), 20000);
    } else {
      finalizeRound(room);
    }
  }

  function resolveCatch2(room, didCatch) {
    if (room.status !== 'catch2' || !room.pendingRanks) return;
    clearTimeout(room.catchTimer);
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
      const payload = {
        catcherName: players.get(catcher)?.name || '?',
        loserName: players.get(loser)?.name || '?',
        correct: hasTwo,
        amount,
        currency: room.settings.currency,
      };
      for (const id of room.members) {
        io.sockets.sockets.get(id)?.emit('game:catch2', payload);
      }
    }
    room.pendingRanks = null; // decision made — no further catch input
    if (didCatch) {
      // Hold the room on the table view so everyone can watch the reveal
      // banner before the payment panel appears.
      broadcastRoom(room);
      room.catchTimer = setTimeout(() => {
        room.catchTimer = null;
        finalizeRound(room);
        broadcastRoom(room);
      }, 3500);
    } else {
      finalizeRound(room);
      broadcastRoom(room);
    }
  }

  // Keep the round moving when the current player has disconnected.
  function scheduleAutoMove(room) {
    if (room.autoMoveTimer) {
      clearTimeout(room.autoMoveTimer);
      room.autoMoveTimer = null;
    }
    if (room.status !== 'playing' || !room.game || room.game.over) return;
    const current = room.game.currentPlayerId();
    if (players.has(current)) return; // still connected — let them play
    room.autoMoveTimer = setTimeout(() => {
      room.autoMoveTimer = null;
      if (room.status !== 'playing' || !room.game || room.game.over) return;
      const id = room.game.currentPlayerId();
      if (players.has(id)) return;
      const result = room.game.autoMove(id);
      handleBomb(room, result);
      handleGameResult(room, result);
      broadcastRoom(room);
    }, 1500);
  }

  io.on('connection', (socket) => {
    socket.on('player:join', ({ name } = {}, ack) => {
      const clean = String(name || '').trim().slice(0, 20);
      if (!clean) return ack?.({ error: 'Please enter a name' });
      players.set(socket.id, { id: socket.id, name: clean, qrUrl: null, roomCode: null });
      ack?.({ ok: true, id: socket.id });
    });

    socket.on('profile:setQR', ({ url } = {}) => {
      const p = players.get(socket.id);
      if (!p) return;
      if (typeof url !== 'string' || !url.startsWith('/uploads/')) return err(socket, 'Invalid QR image');
      p.qrUrl = url;
      const room = getRoom(socket);
      if (room) broadcastRoom(room);
      else socket.emit('toast', 'KHQR saved');
    });

    socket.on('room:create', (_payload, ack) => {
      const p = players.get(socket.id);
      if (!p) return;
      if (p.roomCode) return ack?.({ error: 'You are already in a room' });
      const room = makeRoom(socket.id);
      rooms.set(room.code, room);
      p.roomCode = room.code;
      ack?.({ ok: true, code: room.code });
      broadcastRoom(room);
    });

    socket.on('room:join', ({ code } = {}, ack) => {
      const p = players.get(socket.id);
      if (!p) return;
      if (p.roomCode) return ack?.({ error: 'You are already in a room' });
      const room = rooms.get(String(code || '').trim().toUpperCase());
      if (!room) return ack?.({ error: 'Room not found' });
      if (room.status !== 'waiting') return ack?.({ error: 'A round is in progress — try again after it ends' });
      if (room.members.length >= 4) return ack?.({ error: 'Room is full (4 players max)' });
      room.members.push(socket.id);
      p.roomCode = room.code;
      ack?.({ ok: true, code: room.code });
      broadcastRoom(room);
    });

    socket.on('room:leave', () => {
      const p = players.get(socket.id);
      const room = getRoom(socket);
      if (!p || !room) return;
      if (room.status !== 'waiting') return err(socket, 'You can only leave between rounds');
      p.roomCode = null;
      room.members = room.members.filter((id) => id !== socket.id);
      socket.emit('room:left');
      if (room.members.length === 0) {
        rooms.delete(room.code);
        return;
      }
      if (room.hostId === socket.id) room.hostId = room.members[0];
      broadcastRoom(room);
    });

    socket.on('room:updateSettings', (payload = {}) => {
      const room = getRoom(socket);
      if (!room) return;
      if (room.hostId !== socket.id) return err(socket, 'Only the host can change the stakes');
      if (room.status !== 'waiting') return err(socket, 'Stakes can only change between rounds');
      const s = room.settings;
      const num = (v) => {
        const x = Number(v);
        return Number.isFinite(x) && x >= 0 && x <= 1_000_000 ? Math.round(x * 100) / 100 : null;
      };
      if (payload.betWinner1 !== undefined) {
        const v = num(payload.betWinner1);
        if (v === null) return err(socket, 'Invalid Winner 1 amount');
        s.betWinner1 = v;
      }
      if (payload.betWinner2 !== undefined) {
        const v = num(payload.betWinner2);
        if (v === null) return err(socket, 'Invalid Winner 2 amount');
        s.betWinner2 = v;
      }
      if (payload.bombBonus !== undefined) {
        const v = num(payload.bombBonus);
        if (v === null) return err(socket, 'Invalid bomb bonus amount');
        s.bombBonus = v;
      }
      if (payload.catch2Price !== undefined) {
        const v = num(payload.catch2Price);
        if (v === null) return err(socket, 'Invalid catch-2 price');
        s.catch2Price = v;
      }
      if (payload.currency !== undefined) {
        if (!['USD', 'KHR'].includes(payload.currency)) return err(socket, 'Invalid currency');
        s.currency = payload.currency;
      }
      broadcastRoom(room);
    });

    socket.on('game:start', () => {
      const room = getRoom(socket);
      if (!room) return;
      if (room.hostId !== socket.id) return err(socket, 'Only the host can start the round');
      if (room.status === 'playing') return err(socket, 'A round is already in progress');
      if (room.status === 'catch2') return err(socket, 'Waiting for the catch-the-2 decision');
      if (room.status === 'payment') return err(socket, 'All payments must be confirmed before a new round');
      if (room.members.length < 2) return err(socket, 'Need at least 2 players');
      const missingQR = room.members.filter((id) => !players.get(id)?.qrUrl);
      if (missingQR.length > 0) {
        const names = missingQR.map((id) => players.get(id)?.name || '?').join(', ');
        return err(socket, `Everyone must upload their KHQR first (missing: ${names})`);
      }
      room.debts = [];
      room.lastRanks = null;
      room.bombPayments = [];
      room.catchPayment = null;
      room.pendingRanks = null;
      room.game = new TienLenGame(room.members);
      room.status = 'playing';
      broadcastRoom(room);
    });

    socket.on('game:play', ({ cardIds } = {}) => {
      const room = getRoom(socket);
      if (!room || room.status !== 'playing' || !room.game) return;
      const result = room.game.play(socket.id, cardIds);
      if (result.error) return err(socket, result.error);
      handleBomb(room, result);
      handleGameResult(room, result);
      broadcastRoom(room);
    });

    socket.on('game:pass', () => {
      const room = getRoom(socket);
      if (!room || room.status !== 'playing' || !room.game) return;
      const result = room.game.pass(socket.id);
      if (result.error) return err(socket, result.error);
      broadcastRoom(room);
    });

    socket.on('catch2:decide', ({ catch: doCatch } = {}) => {
      const room = getRoom(socket);
      if (!room || room.status !== 'catch2' || !room.pendingRanks) return;
      const catcher = room.pendingRanks[room.pendingRanks.length - 2];
      if (socket.id !== catcher) return err(socket, 'Only the last winner can catch the 2');
      resolveCatch2(room, !!doCatch);
    });

    socket.on('payment:markPaid', ({ debtId } = {}) => {
      const room = getRoom(socket);
      if (!room || room.status !== 'payment') return;
      const debt = room.debts.find((d) => d.id === debtId);
      if (!debt) return;
      if (debt.from !== socket.id) return err(socket, 'Only the payer can mark this as paid');
      debt.paidByPayer = true;
      broadcastRoom(room);
    });

    socket.on('payment:confirm', ({ debtId } = {}) => {
      const room = getRoom(socket);
      if (!room || room.status !== 'payment') return;
      const debt = room.debts.find((d) => d.id === debtId);
      if (!debt) return;
      if (debt.to !== socket.id) return err(socket, 'Only the receiver can confirm this payment');
      if (!debt.paidByPayer) return err(socket, 'Wait for the payer to mark it as paid first');
      debt.confirmedByPayee = true;
      if (room.debts.every((d) => d.confirmedByPayee)) {
        room.status = 'waiting'; // all settled — host may start the next round
      }
      broadcastRoom(room);
    });

    socket.on('disconnect', () => {
      const p = players.get(socket.id);
      players.delete(socket.id);
      if (!p?.roomCode) return;
      const room = rooms.get(p.roomCode);
      if (!room) return;
      if (room.status === 'waiting') {
        room.members = room.members.filter((id) => id !== socket.id);
        if (room.members.length === 0) {
          rooms.delete(room.code);
          return;
        }
        if (room.hostId === socket.id) room.hostId = room.members[0];
      }
      // During playing/payment the seat is kept so the round stays consistent;
      // auto-move plays for them while the round runs. A catcher who leaves
      // forfeits the catch-the-2 gamble.
      if (
        room.status === 'catch2' &&
        room.pendingRanks &&
        room.pendingRanks[room.pendingRanks.length - 2] === socket.id
      ) {
        resolveCatch2(room, false);
        return;
      }
      broadcastRoom(room);
    });
  });
}
