'use client';

import { useState } from 'react';
import { getSocket } from '@/lib/socket-client';
import { TOPUP_PACKS, formatRiel, toRiel, RIEL_PER_POINT } from '@/lib/points';

// Buying points: the player scans the operator's KHQR, pays in their bank app,
// then submits the transaction reference. Points are credited only after the
// operator approves the request — no bank API can confirm it automatically.
export default function BuyPoints({ wallet, onDone, onClose, showToast }) {
  const [points, setPoints] = useState(TOPUP_PACKS[2]);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  const pending = (wallet.topups || []).filter((t) => t.status === 'pending');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/topups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points, reference }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send the request');
      setReference('');
      showToast('Sent — you will get your points once it is approved');
      // Balances update the moment the operator approves.
      getSocket().emit('wallet:refresh');
      onDone?.();
    } catch (err) {
      showToast(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="payment-overlay">
      <div className="panel payment-panel">
        <h2>💰 Buy points</h2>
        <p className="muted">
          {formatRiel(RIEL_PER_POINT)} = 1 point. Pay the exact amount to the KHQR below,
          then send the request.
        </p>

        <form onSubmit={submit} className="stack">
          <label>
            How many points?
            <select value={points} onChange={(e) => setPoints(Number(e.target.value))}>
              {TOPUP_PACKS.map((p) => (
                <option key={p} value={p}>
                  {p} pt — {formatRiel(toRiel(p))}
                </option>
              ))}
            </select>
          </label>

          <div className="buy-amount">
            Pay <strong>{formatRiel(toRiel(points))}</strong>
          </div>

          {wallet.khqrUrl ? (
            <div className="debt-qr">
              <img src={wallet.khqrUrl} alt="KHQR to pay for points" />
              <p className="hint">Scan with your bank app and send exactly {formatRiel(toRiel(points))}.</p>
            </div>
          ) : (
            <p className="warn">
              The operator has not set a payment KHQR yet — ask them to add one before paying.
            </p>
          )}

          <label>
            Transaction reference (optional)
            <input
              placeholder="e.g. the ref from your bank receipt"
              maxLength={120}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>

          <button className="btn primary big" disabled={busy || !wallet.khqrUrl}>
            {busy ? 'Sending…' : "I've paid — request my points"}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>Close</button>
        </form>

        {pending.length > 0 && (
          <div className="last-result">
            <h4>Waiting for approval</h4>
            <ul className="topup-list">
              {pending.map((t) => (
                <li key={t.id}>
                  {t.points} pt — {formatRiel(t.riel)}
                  <span className="chip">pending</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="hint">
          Points are credited manually once the operator sees your transfer, so there
          may be a short wait.
        </p>
      </div>
    </div>
  );
}