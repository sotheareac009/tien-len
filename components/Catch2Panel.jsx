'use client';

import { getSocket } from '@/lib/socket-client';
import { money, nameOf } from './helpers';

// Catch-the-2 gamble, offered to the last winner after the round ends:
// guess that the loser is still holding a 2. Right → the loser pays the
// catch price; wrong → the catcher pays the loser.
export default function Catch2Panel({ room }) {
  const socket = getSocket();
  const { catcherId, loserId, loserCardCount, price } = room.catch2;
  const iAmCatcher = catcherId === room.you;
  const priceText = money(price, room.settings.currency);

  return (
    <div className="payment-overlay">
      <div className="panel payment-panel">
        <h2>🐷 Catch the 2?</h2>
        <p className="muted">
          {nameOf(room, loserId)} finished last, still holding{' '}
          <strong>{loserCardCount}</strong> hidden card{loserCardCount === 1 ? '' : 's'}.
        </p>
        {iAmCatcher ? (
          <>
            <p className="hint">
              If they hold a 2, {nameOf(room, loserId)} pays you {priceText}. If not, you pay them {priceText}.
            </p>
            <div className="stack">
              <button
                className="btn primary big"
                onClick={() => socket.emit('catch2:decide', { catch: true })}
              >
                Catch the 2! 🐷 ({priceText})
              </button>
              <button className="btn" onClick={() => socket.emit('catch2:decide', { catch: false })}>
                Skip
              </button>
            </div>
          </>
        ) : (
          <p className="muted">
            Waiting for {nameOf(room, catcherId)} (last winner) to decide whether to catch the 2…
          </p>
        )}
      </div>
    </div>
  );
}
