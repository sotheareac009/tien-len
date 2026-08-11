'use client';

import { nameOf, RANK_LABELS } from './helpers';
import { formatRiel, toRiel } from '@/lib/points';

// Shown the moment a round ends: who came 1st through 4th, and what it cost or
// paid them. Points have already moved between wallets by this point — this is
// the receipt, not a step anyone has to act on.
export default function RoundResult({ room, isHost, onNext, onClose }) {
  const ranks = room.lastRanks || [];
  const deltaOf = (id) => room.players.find((p) => p.id === id)?.lastDelta ?? 0;
  const youWon = ranks[0] === room.you;
  const stuck = room.lastStuck || [];

  return (
    <div className="payment-overlay">
      <div className="panel payment-panel">
        <h2>{youWon ? '🏆 You won!' : 'Round finished'}</h2>

        {/* Caught on 13 cards: the round stopped the moment the winner went
            out, so only the winner placed. Say why, or the missing 2nd and
            3rd places look like a bug. */}
        {stuck.length > 0 && (
          <div className="banner warn">
            <strong>😱 Stuck on 13!</strong>{' '}
            {stuck.map((id) => nameOf(room, id)).join(', ')} never played a card, so the
            round ended at once and {stuck.length === 1 ? 'they pay' : 'each pays'} double
            to {nameOf(room, ranks[0])}.
          </div>
        )}

        <ol className="result-list">
          {ranks.map((id, i) => {
            const delta = deltaOf(id);
            return (
              <li key={id} className={id === room.you ? 'is-you' : ''}>
                <span>
                  {RANK_LABELS[i + 1] || `${i + 1}th`} — {nameOf(room, id)}
                </span>
                <span className={delta > 0 ? 'ok' : delta < 0 ? 'warn' : 'muted'}>
                  {delta > 0 ? '+' : delta < 0 ? '−' : ''}
                  {delta !== 0
                    ? `${Math.abs(delta)} pt · ${formatRiel(Math.abs(toRiel(delta)))}`
                    : '—'}
                </span>
              </li>
            );
          })}
        </ol>

        {room.lastTransfers?.length > 0 && (
          <div className="last-result">
            <h4>Who paid whom</h4>
            <ul className="transfer-list">
              {room.lastTransfers.map((t, i) => (
                <li key={i}>
                  {nameOf(room, t.from)} → {nameOf(room, t.to)}
                  <strong> {t.amount} pt</strong>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Explain the placings that cost or paid nothing, so a bot finishing
            above you doesn't look like points went missing. */}
        {room.players.some((p) => p.isBot) && (
          <p className="hint">
            🤖 {room.players.filter((p) => p.isBot).map((p) => p.name).join(' and ')}{' '}
            {room.players.filter((p) => p.isBot).length === 1 ? 'is a bot' : 'are bots'} and
            hold no wallet
            {ranks[0] && room.players.find((p) => p.id === ranks[0])?.isBot
              ? ' — winning the round earned them nothing, and cost you nothing.'
              : ' — nothing was won from them or paid to them.'}{' '}
            Only the players were ranked against each other.
          </p>
        )}

        <p className="hint">Points moved between wallets automatically.</p>

        <div className="stack">
          {isHost && (
            <button className="btn primary big" onClick={onNext}>
              Start next round
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {isHost ? 'Not yet' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}