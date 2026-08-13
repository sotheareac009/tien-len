import { cardValue } from './cards.js';

function isConsecutive(ranks) {
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] !== ranks[i - 1] + 1) return false;
  }
  return true;
}

// Returns { type, cards, strength } or null if the cards are not a legal combination.
// Types: single, pair, triple, quad, straight (3+ run, no 2s),
//        doubleSeq (2+ consecutive pairs, no 2s).
export function detectCombo(cards) {
  if (!cards || cards.length === 0) return null;
  const sorted = [...cards].sort((a, b) => cardValue(a) - cardValue(b));
  const n = sorted.length;
  const ranks = sorted.map((c) => c.rank);
  const strength = cardValue(sorted[n - 1]);
  const allSameRank = ranks.every((r) => r === ranks[0]);

  if (n === 1) return { type: 'single', cards: sorted, strength };
  if (allSameRank && n === 2) return { type: 'pair', cards: sorted, strength };
  if (allSameRank && n === 3) return { type: 'triple', cards: sorted, strength };
  if (allSameRank && n === 4) return { type: 'quad', cards: sorted, strength };

  const noTwos = ranks[n - 1] < 15;

  if (n >= 3 && noTwos && isConsecutive(ranks)) {
    return { type: 'straight', cards: sorted, strength };
  }

  // Two consecutive pairs (5-5-6-6) count, not just three or more. Four of a
  // kind is caught above, so a 4-card hand reaching here is two distinct pairs.
  if (n >= 4 && n % 2 === 0 && noTwos) {
    let ok = true;
    for (let i = 0; i < n; i += 2) {
      if (ranks[i] !== ranks[i + 1]) ok = false;
      if (i >= 2 && ranks[i] !== ranks[i - 2] + 1) ok = false;
    }
    if (ok) return { type: 'doubleSeq', cards: sorted, strength };
  }

  return null;
}

// A straight played entirely in one suit, of any length.
export function isSameSuitStraight(combo) {
  return (
    combo.type === 'straight' &&
    combo.cards.every((c) => c.suit === combo.cards[0].suit)
  );
}

// A straight of 5+ cards all in the same suit — counts as a bomb vs a single 2.
export function isStraightFlush(combo) {
  return isSameSuitStraight(combo) && combo.cards.length >= 5;
}

// Can `play` beat the combo currently on the table?
//
// `noTwosLeft` — nobody else still holds a 2. Bombs exist to kill 2s, so once
// the last one is gone they would be dead weight; the house rule lets a quad or
// a straight flush be played on any single instead.
export function beats(play, table, { noTwosLeft = false } = {}) {
  if (!table) return true;

  // Normal case: same type and same size, higher top card wins.
  if (play.type === table.type && play.cards.length === table.cards.length) {
    // House rule: a straight played all in one suit can only be beaten by a
    // higher straight that is also all one suit. A mixed straight on the table
    // is still beaten by any higher straight, single-suit or not.
    if (isSameSuitStraight(table) && !isSameSuitStraight(play)) return false;
    return play.strength > table.strength;
  }

  // Bombs ("chặt") — house rules:
  //  - a single 2 is beaten ONLY by a quad or a 5-card straight flush
  //  - a pair of 2s is beaten ONLY by a 4-pair double sequence
  //  - a quad is beaten by a 4-pair double sequence or a straight flush
  //  - shorter double sequences (2- and 3-pair) are NOT bombs
  const tableIsSingleTwo = table.type === 'single' && table.cards[0].rank === 15;
  const tableIsPairOfTwos = table.type === 'pair' && table.cards[0].rank === 15;

  if (tableIsSingleTwo) {
    return play.type === 'quad' || isStraightFlush(play);
  }
  // No 2s left to chop: the same two bombs may take any single instead.
  if (noTwosLeft && table.type === 'single') {
    return play.type === 'quad' || isStraightFlush(play);
  }
  if (tableIsPairOfTwos) {
    return play.type === 'doubleSeq' && play.cards.length >= 8;
  }
  if (table.type === 'quad') {
    return (play.type === 'doubleSeq' && play.cards.length >= 8) || isStraightFlush(play);
  }
  return false;
}
