'use client';

import { useEffect } from 'react';
import { playChop, playCatch, playPenalty } from '@/lib/sounds';

// Full-screen celebration when a bomb chops — shows who chopped whom
// and the bonus they collect. Auto-dismissed by the parent.
export default function BombBanner({ event }) {
  // Keyed on event.key so a second chop in the same trick fires again.
  useEffect(() => {
    if (!event) return;
    if (event.sound === 'chop') playChop(event.multiplier);
    else if (event.sound === 'catch') playCatch(event.correct);
    else if (event.sound === 'penalty') playPenalty();
  }, [event?.key]);

  if (!event) return null;
  return (
    <div className="bomb-banner" key={event.key}>
      <div className="bomb-inner">
        <div className="bomb-emoji">
          {event.sound === 'catch' ? '🐷' : event.sound === 'penalty' ? '😱' : '💥'}
        </div>
        <div className="bomb-title">{event.title}</div>
        {event.amountText && <div className="bomb-amount">{event.amountText}</div>}
      </div>
    </div>
  );
}
