import { cardValue } from './cards.js';
import { detectCombo, beats } from './combos.js';

const byValue = (a, b) => cardValue(a) - cardValue(b);
// Only quads and 4+-pair sequences are bombs; 3-pair sequences are not.
const isBomb = (c) => c.type === 'quad' || (c.type === 'doubleSeq' && c.cards.length >= 8);

function combinations(arr, k) {
  if (k > arr.length) return [];
  if (k === 1) return arr.map((x) => [x]);
  const out = [];
  for (let i = 0; i <= arr.length - k; i++) {
    for (const rest of combinations(arr.slice(i + 1), k - 1)) {
      out.push([arr[i], ...rest]);
    }
  }
  return out;
}

// Enumerate every combo a hand can form. Strength-complete: a combo's
// strength is decided by its top card, so for straights/doubleSeqs we emit
// one variant per choice of top-rank card(s) — lower ranks always use the
// lowest suits. For pairs/triples all suit combinations are emitted.
export function generateCombos(hand) {
  const sorted = [...hand].sort(byValue);
  const combos = [];
  const push = (cards) => {
    const c = detectCombo(cards);
    if (c) combos.push(c);
  };

  for (const c of sorted) push([c]);

  const groups = new Map(); // rank -> cards (sorted low suit first)
  for (const c of sorted) {
    if (!groups.has(c.rank)) groups.set(c.rank, []);
    groups.get(c.rank).push(c);
  }
  for (const g of groups.values()) {
    if (g.length >= 2) for (const pair of combinations(g, 2)) push(pair);
    if (g.length >= 3) for (const triple of combinations(g, 3)) push(triple);
    if (g.length === 4) push(g);
  }

  // Straights (no 2s): every run of length >= 3 from every start rank,
  // with a variant for each possible top card.
  for (let start = 3; start <= 12; start++) {
    const run = [];
    for (let r = start; r <= 14; r++) {
      const g = groups.get(r);
      if (!g) break;
      run.push(g[0]);
      if (run.length >= 3) {
        for (const topCard of g) push([...run.slice(0, -1), topCard]);
      }
    }
  }

  // Straight flushes (5+ consecutive cards in one suit, no 2s) — these can
  // chop a single 2, so enumerate them even though they're also straights.
  const bySuit = [[], [], [], []];
  for (const c of sorted) if (c.rank < 15) bySuit[c.suit].push(c);
  for (const suitCards of bySuit) {
    const byRank = new Map(suitCards.map((c) => [c.rank, c]));
    for (let start = 3; start <= 10; start++) {
      const run = [];
      for (let r = start; r <= 14; r++) {
        const c = byRank.get(r);
        if (!c) break;
        run.push(c);
        if (run.length >= 5) push([...run]);
      }
    }
  }

  // Double sequences (2+ consecutive pairs, no 2s), with a variant for
  // each possible top pair.
  for (let start = 3; start <= 13; start++) {
    const run = [];
    for (let r = start; r <= 14; r++) {
      const g = groups.get(r);
      if (!g || g.length < 2) break;
      run.push(g[0], g[1]);
      if (run.length >= 4) {
        for (const topPair of combinations(g, 2)) push([...run.slice(0, -2), ...topPair]);
      }
    }
  }

  return combos;
}

// Decide the bot's move. Returns an array of card ids to play, or null to pass.
export function chooseMove(game, playerId) {
  const hand = game.hand(playerId);
  if (hand.length === 0) return null;
  const combos = generateCombos(hand);
  const table = game.table;

  if (!table) {
    // Leading: dump as many low cards as possible, anchored on the lowest
    // card in hand (which also satisfies the first-play 3♠ rule).
    const lowest = Math.min(...hand.map(cardValue));
    let candidates = combos.filter((c) => c.cards.some((card) => cardValue(card) === lowest));
    if (candidates.length === 0) candidates = combos;
    candidates.sort(
      (a, b) =>
        (isBomb(a) ? 1 : 0) - (isBomb(b) ? 1 : 0) ||
        b.cards.length - a.cards.length ||
        a.strength - b.strength
    );
    return candidates[0].cards.map((c) => c.id);
  }

  const noTwosLeft = game.noTwosLeftFor?.(playerId) ?? false;
  const beating = combos.filter((c) => beats(c, table, { noTwosLeft }));
  if (beating.length === 0) return null;
  beating.sort(
    (a, b) =>
      (isBomb(a) ? 1 : 0) - (isBomb(b) ? 1 : 0) ||
      a.strength - b.strength
  );
  const best = beating[0];
  // Don't waste a bomb on an ordinary combo — save it for 2s and other bombs.
  const tableTopRank = table.cards[table.cards.length - 1].rank;
  // Hold a bomb back for 2s and other bombs — unless the 2s are gone, when
  // there is nothing left to save it for.
  if (isBomb(best) && !isBomb(table) && tableTopRank !== 15 && !noTwosLeft) return null;
  return best.cards.map((c) => c.id);
}
