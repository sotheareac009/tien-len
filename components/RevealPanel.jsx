'use client';

import CardView from './CardView';

// The last player's hand, turned face-up for a few seconds after the
// catch-the-2 decision. Whether the catch was taken or skipped, everyone gets
// to see whether the 2 was really there before the round settles.
export default function RevealPanel({ reveal }) {
  const { name, catcherName, cards, hadTwo, caught } = reveal;

  const title = caught
    ? hadTwo
      ? `🐷 Caught! ${name} had a 2`
      : `😅 No 2 — ${catcherName} pays`
    : hadTwo
      ? `👀 ${name} was holding a 2`
      : `👀 ${name} had no 2`;

  return (
    <div className="payment-overlay">
      <div className="panel payment-panel reveal-panel">
        <h2>{title}</h2>
        <p className="muted">
          {name} finished with {cards.length} card{cards.length === 1 ? '' : 's'} left
          {!caught && ' — the catch was skipped'}
        </p>

        <div className={`table-combo ${cards.length >= 6 ? 'dense' : ''}`}>
          {cards.map((card) => (
            <CardView key={card.id} card={card} small />
          ))}
        </div>

        <p className="hint">The next round starts in a moment…</p>
      </div>
    </div>
  );
}