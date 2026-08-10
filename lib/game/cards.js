// Tien Len card model.
// rank: 3..15 where 11=J, 12=Q, 13=K, 14=A, 15=2  (2 is the highest rank)
// suit: 0=♠ (lowest), 1=♣, 2=♦, 3=♥ (highest)

export const SUIT_SYMBOLS = ['♠', '♣', '♦', '♥'];

export const RANK_NAMES = {
  3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2',
};

export function makeDeck() {
  const deck = [];
  for (let rank = 3; rank <= 15; rank++) {
    for (let suit = 0; suit < 4; suit++) {
      deck.push({ id: `${rank}-${suit}`, rank, suit });
    }
  }
  return deck;
}

// Total ordering of all 52 cards: 3♠ is lowest (value 12), 2♥ is highest.
export const cardValue = (c) => c.rank * 4 + c.suit;

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
