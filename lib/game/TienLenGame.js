import { makeDeck, shuffle, cardValue } from './cards.js';
import { detectCombo, beats, isStraightFlush } from './combos.js';

// One round of Tien Len for 2-4 players. Pure game state — no sockets in here.
// `riggedHands` (test/practice deals): { playerId: ['14-0', ...] } — the named
// cards go to that player, the rest of each hand is dealt randomly.
// `starterId` — the previous round's winner. They lead and may open with
// anything. Omit it (the very first round of a table) and the round opens
// itself: every 3 is discarded from every hand automatically, and whoever held
// the 3♠ leads with a free choice.
export class TienLenGame {
  constructor(playerIds, riggedHands = null, { starterId = null } = {}) {
    if (playerIds.length < 2 || playerIds.length > 4) {
      throw new Error('Tien Len needs 2-4 players');
    }
    const deck = shuffle(makeDeck());
    this.order = [...playerIds];
    this.hands = new Map();
    if (riggedHands) {
      const byId = new Map(deck.map((c) => [c.id, c]));
      const taken = new Set(Object.values(riggedHands).flat());
      const rest = deck.filter((c) => !taken.has(c.id));
      playerIds.forEach((id) => {
        const hand = (riggedHands[id] || []).map((cid) => byId.get(cid)).filter(Boolean);
        while (hand.length < 13) hand.push(rest.pop());
        this.hands.set(id, hand.sort((a, b) => cardValue(a) - cardValue(b)));
      });
    } else {
      playerIds.forEach((id, i) => {
        const hand = deck.slice(i * 13, i * 13 + 13).sort((a, b) => cardValue(a) - cardValue(b));
        this.hands.set(id, hand);
      });
    }

    // The holder of the lowest dealt card leads (3♠ in a 4-player game),
    // and their first play must include that card.
    let starter = playerIds[0];
    let lowest = Infinity;
    for (const id of playerIds) {
      const v = cardValue(this.hands.get(id)[0]);
      if (v < lowest) { lowest = v; starter = id; }
    }
    this.lowestCardValue = lowest;

    // Every round after the first: the previous winner takes the lead and
    // opens with whatever they like. `firstPlay` is what enforces the
    // lowest-card rule, so clearing it here lifts the restriction.
    const winnerLeads = !!starterId && playerIds.includes(starterId);
    if (winnerLeads) starter = starterId;
    this.turn = this.order.indexOf(starter);

    this.table = null;        // combo currently to beat: { type, cards, strength, playerId }
    this.prevTable = null;    // the combo this.table beat, shown under it on the table
    this.lastPlayerId = null; // who played this.table
    this.passed = new Set();  // players out of the current trick
    this.finished = [];       // playerIds in finishing order (1st, 2nd, ...)
    this.firstPlay = !winnerLeads; // only the opening round is restricted
    this.over = false;

    // Opening round: every 3 is discarded from every hand before play starts,
    // so nobody has to find and play them. The 3♠ holder then leads.
    this.discarded = [];
    if (!winnerLeads) this.discardThrees();

    // What each player holds once the round is under way. A player still on
    // this count when someone goes out never played at all — see the stuck-on-13
    // rule in play(). Counting it here keeps that correct even though the
    // discard leaves players holding different numbers of cards.
    this.startingSize = new Map(this.order.map((id) => [id, this.hands.get(id).length]));
  }

  // Pulls every 3 out of every hand and hands the lead to whoever held the 3♠.
  // If the 3♠ was not dealt (2- and 3-player games use only part of the deck)
  // the lead stays with the holder of the lowest card, as before.
  discardThrees() {
    let leader = null;
    for (const id of this.order) {
      const hand = this.hands.get(id);
      const threes = hand.filter((c) => c.rank === 3);
      if (!threes.length) continue;
      if (threes.some((c) => c.suit === 0)) leader = id; // 3♠
      this.hands.set(id, hand.filter((c) => c.rank !== 3));
      this.discarded.push(...threes);
    }
    if (leader) this.turn = this.order.indexOf(leader);
    this.openLeader = leader; // announced to the table: they hold the lead
    this.firstPlay = false;   // the lead is free — the 3s are already gone
  }

  currentPlayerId() { return this.order[this.turn]; }
  hand(id) { return this.hands.get(id) || []; }

  // A round in progress, as plain JSON — everything needed to carry on later.
  // Used to save a room so a server restart does not destroy a live hand.
  toJSON() {
    return {
      order: this.order,
      hands: Object.fromEntries(this.hands),
      lowestCardValue: this.lowestCardValue,
      turn: this.turn,
      table: this.table,
      prevTable: this.prevTable,
      discarded: this.discarded ?? [],
      openLeader: this.openLeader ?? null,
      startingSize: Object.fromEntries(this.startingSize ?? []),
      lastPlayerId: this.lastPlayerId,
      passed: [...this.passed],
      finished: this.finished,
      firstPlay: this.firstPlay,
      over: this.over,
    };
  }

  // Rebuilds a saved round. The constructor deals a fresh deck, so it is
  // bypassed deliberately: this restores state rather than starting a game.
  static fromJSON(data) {
    if (!data?.order) return null;
    const g = Object.create(TienLenGame.prototype);
    g.order = data.order;
    g.hands = new Map(Object.entries(data.hands || {}));
    g.lowestCardValue = data.lowestCardValue;
    g.turn = data.turn;
    g.table = data.table ?? null;
    g.prevTable = data.prevTable ?? null;
    g.discarded = data.discarded ?? [];
    g.openLeader = data.openLeader ?? null;
    g.startingSize = new Map(Object.entries(data.startingSize || {}));
    g.lastPlayerId = data.lastPlayerId ?? null;
    g.passed = new Set(data.passed || []);
    g.finished = data.finished || [];
    g.firstPlay = !!data.firstPlay;
    g.over = !!data.over;
    return g;
  }

  play(playerId, cardIds) {
    if (this.over) return { error: 'Round is over' };
    if (playerId !== this.currentPlayerId()) return { error: 'Not your turn' };
    if (!Array.isArray(cardIds) || cardIds.length === 0) return { error: 'Select some cards first' };
    if (new Set(cardIds).size !== cardIds.length) return { error: 'Invalid cards' };

    const hand = this.hands.get(playerId);
    const cards = cardIds.map((cid) => hand.find((c) => c.id === cid));
    if (cards.some((c) => !c)) return { error: 'Invalid cards' };

    const combo = detectCombo(cards);
    if (!combo) return { error: 'Not a valid combination' };
    if (this.firstPlay && !cards.some((c) => cardValue(c) === this.lowestCardValue)) {
      return { error: 'The first play of the round must include your lowest card' };
    }
    if (this.table && !beats(combo, this.table)) {
      return { error: 'That does not beat the current play' };
    }

    // Chop detection with an escalating chain. Every combo on the table
    // carries `chopMult`: the multiplier the NEXT chopper collects.
    //   chop a 2                → ×1 (then the chain holds ×2)
    //   chop a quad / bomb      → ×2
    //   counter-chop the chain  → double the previous profit (×4, ×8, …)
    // A chop is any cross-type beat, or a straight flush beating a straight
    // flush that itself chopped. The chain dies when the trick ends.
    let bomb = null;
    let chopMult = 1;
    if (this.table) {
      const prevMult = this.table.chopMult || 1;
      const sameShape =
        combo.type === this.table.type && combo.cards.length === this.table.cards.length;
      const counterSF =
        sameShape && prevMult >= 2 && isStraightFlush(combo) && isStraightFlush(this.table);
      if (!sameShape || counterSF) {
        bomb = { by: playerId, victim: this.table.playerId, multiplier: prevMult };
        chopMult = prevMult * 2;
      }
    }
    if (!bomb) {
      // A bomb played fresh (lead or normal beat) is worth double to whoever
      // chops it. A lone straight flush played as an ordinary straight is not.
      chopMult =
        combo.type === 'quad' || (combo.type === 'doubleSeq' && combo.cards.length >= 8) ? 2 : 1;
    }

    this.hands.set(playerId, hand.filter((c) => !cardIds.includes(c.id)));
    // The opening 3s are only shown until play actually starts — from the
    // first card onwards the table shows the current play and the one it beat.
    this.discarded = [];
    this.prevTable = this.table; // keep what was just beaten, to show underneath
    this.table = { ...combo, playerId, chopMult };
    this.lastPlayerId = playerId;
    this.firstPlay = false;

    if (this.hands.get(playerId).length === 0) {
      this.finished.push(playerId);

      // "Stuck on 13" (thối 13 lá): anyone still holding a full hand when the
      // winner goes out never got to play at all. The round stops dead — no
      // second or third place — and they pay the winner a penalty instead of
      // the usual placings. Checked before the normal end condition so it wins
      // in a two-player game too.
      const stuck = this.order.filter(
        (id) => id !== playerId && this.hands.get(id).length === this.startingSize.get(id)
      );
      if (stuck.length > 0) {
        this.over = true;
        return { ok: true, bomb, roundOver: true, ranks: [playerId], stuck };
      }
    }

    const remaining = this.order.filter((id) => this.hands.get(id).length > 0);
    if (remaining.length <= 1) {
      if (remaining.length === 1) this.finished.push(remaining[0]);
      this.over = true;
      return { ok: true, bomb, roundOver: true, ranks: [...this.finished] };
    }

    this.advance();
    return { ok: true, bomb };
  }

  pass(playerId) {
    if (this.over) return { error: 'Round is over' };
    if (playerId !== this.currentPlayerId()) return { error: 'Not your turn' };
    if (!this.table) return { error: 'You lead this trick — you must play' };
    this.passed.add(playerId);
    this.advance();
    return { ok: true };
  }

  // Move the turn to the next player still in the trick. If everyone else has
  // passed or finished, the trick is over and its winner leads a fresh one.
  advance() {
    const n = this.order.length;
    for (let step = 1; step <= n; step++) {
      const idx = (this.turn + step) % n;
      const id = this.order[idx];
      if (this.hands.get(id).length === 0) continue;
      if (this.passed.has(id)) continue;
      if (id === this.lastPlayerId) break; // came back around: trick over
      this.turn = idx;
      return;
    }
    this.newTrick();
  }

  newTrick() {
    this.table = null;
    this.prevTable = null; // nothing was beaten yet in a fresh trick
    this.passed.clear();
    // Trick winner leads again; if they already emptied their hand,
    // the lead moves to the next player after them who still has cards.
    const startIdx = Math.max(0, this.order.indexOf(this.lastPlayerId));
    for (let step = 0; step < this.order.length; step++) {
      const idx = (startIdx + step) % this.order.length;
      if (this.hands.get(this.order[idx]).length > 0) {
        this.turn = idx;
        this.lastPlayerId = null;
        return;
      }
    }
  }

  // Plays the safest legal move for a player: pass if possible, otherwise lead
  // with the lowest single. Online rooms pause instead of auto-playing, so this
  // is kept for tests and for driving a hand forward without a decision.
  autoMove(playerId) {
    if (this.over || playerId !== this.currentPlayerId()) return null;
    if (this.table) return this.pass(playerId);
    const hand = this.hands.get(playerId);
    return this.play(playerId, [hand[0].id]);
  }
}
