'use client';

const SUIT_SYMBOLS = ['♠', '♣', '♦', '♥'];
const RANK_NAMES = {
  3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2',
};

export default function CardView({ card, selected, onClick, onPointerDown, small, hinted }) {
  const red = card.suit >= 2;
  return (
    <div
      className={`card ${red ? 'red' : 'black'} ${hinted ? 'hinted' : ''} ${selected ? 'selected' : ''} ${small ? 'small' : ''} ${onClick || onPointerDown ? 'clickable' : ''}`}
      data-card-id={card.id}
      onClick={onClick}
      onPointerDown={onPointerDown}
    >
      <span className="card-corner">
        <span className="card-rank">{RANK_NAMES[card.rank]}</span>
        <span className="card-pip">{SUIT_SYMBOLS[card.suit]}</span>
      </span>
      <span className="card-suit">{SUIT_SYMBOLS[card.suit]}</span>
      <span className="card-corner flip">
        <span className="card-rank">{RANK_NAMES[card.rank]}</span>
        <span className="card-pip">{SUIT_SYMBOLS[card.suit]}</span>
      </span>
    </div>
  );
}
