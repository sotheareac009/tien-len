'use client';

import { getSocket } from '@/lib/socket-client';
import { money, nameOf, RANK_LABELS } from './helpers';

// After a round ends the room is locked in "payment" status.
// Each loser scans the winner's KHQR with their bank app, pays, and taps
// "I've paid". The winner then taps "Confirm received". Only when every
// debt is confirmed can the host start the next round.
export default function PaymentPanel({ room }) {
  const socket = getSocket();

  return (
    <div className="payment-overlay">
      <div className="panel payment-panel">
        <h2>Round finished — settle up! 💸</h2>

        {room.lastRanks && (
          <ol className="result-list">
            {room.lastRanks.map((id, i) => (
              <li key={id}>
                {RANK_LABELS[i + 1] || `${i + 1}th`} — {nameOf(room, id)}
              </li>
            ))}
          </ol>
        )}

        <div className="debt-list">
          {room.debts.map((debt) => {
            const iAmPayer = debt.from === room.you;
            const iAmPayee = debt.to === room.you;
            const payee = room.players.find((p) => p.id === debt.to);
            const done = debt.confirmedByPayee;
            return (
              <div key={debt.id} className={`debt ${done ? 'done' : ''}`}>
                <div className="debt-line">
                  <strong>{nameOf(room, debt.from)}</strong> pays{' '}
                  <strong>{money(debt.amount, debt.currency)}</strong> to{' '}
                  <strong>{nameOf(room, debt.to)}</strong>
                </div>

                {iAmPayer && !done && payee?.qrUrl && (
                  <div className="debt-qr">
                    <img src={payee.qrUrl} alt={`KHQR of ${payee.name}`} />
                    <p className="hint">Scan this KHQR with your bank app and pay {money(debt.amount, debt.currency)}.</p>
                  </div>
                )}

                <div className="debt-status">
                  {done ? (
                    <span className="ok">✓ Paid &amp; confirmed</span>
                  ) : debt.paidByPayer ? (
                    <span className="warn">Paid — waiting for {nameOf(room, debt.to)} to confirm</span>
                  ) : (
                    <span className="muted">Waiting for payment</span>
                  )}
                </div>

                {iAmPayer && !debt.paidByPayer && (
                  <button className="btn primary" onClick={() => socket.emit('payment:markPaid', { debtId: debt.id })}>
                    I&apos;ve paid ✓
                  </button>
                )}
                {iAmPayee && debt.paidByPayer && !done && (
                  <button className="btn primary" onClick={() => socket.emit('payment:confirm', { debtId: debt.id })}>
                    Confirm received ✓
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <p className="hint">A new round can start only after every payment is confirmed by its receiver.</p>
      </div>
    </div>
  );
}
