'use client';

// Full-screen celebration when a bomb chops — shows who chopped whom
// and the bonus they collect. Purely visual; auto-dismissed by the parent.
export default function BombBanner({ event }) {
  if (!event) return null;
  return (
    <div className="bomb-banner" key={event.key}>
      <div className="bomb-inner">
        <div className="bomb-emoji">💥</div>
        <div className="bomb-title">{event.title}</div>
        {event.amountText && <div className="bomb-amount">{event.amountText}</div>}
      </div>
    </div>
  );
}
