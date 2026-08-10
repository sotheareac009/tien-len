'use client';

import { useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket-client';
import { money, RANK_LABELS } from './helpers';
import QRUpload from './QRUpload';
import SettingsEditor from './SettingsEditor';
import GameTable from './GameTable';
import PaymentPanel from './PaymentPanel';
import BombBanner from './BombBanner';
import Catch2Panel from './Catch2Panel';

export default function Room({ me, room, showToast }) {
  const socket = getSocket();
  const self = room.players.find((p) => p.id === room.you);
  const isHost = room.hostId === room.you;
  const [bombEvent, setBombEvent] = useState(null);
  const bombTimer = useRef(null);

  useEffect(() => {
    const onBomb = (e) => {
      clearTimeout(bombTimer.current);
      setBombEvent({
        key: Date.now(),
        title: `💣 ${e.byName} chopped ${e.victimName}!${e.multiplier > 1 ? ` ×${e.multiplier}` : ''}`,
        amountText: e.amount > 0 ? `+${money(e.amount, e.currency)}` : null,
      });
      bombTimer.current = setTimeout(() => setBombEvent(null), 5000);
    };
    const onCatch2 = (e) => {
      clearTimeout(bombTimer.current);
      setBombEvent({
        key: Date.now(),
        title: e.correct
          ? `🐷 ${e.catcherName} caught ${e.loserName}'s 2!`
          : `😅 No 2 — ${e.catcherName} pays ${e.loserName}`,
        amountText: e.amount > 0 ? `+${money(e.amount, e.currency)}` : null,
      });
      bombTimer.current = setTimeout(() => setBombEvent(null), 5000);
    };
    socket.on('game:bomb', onBomb);
    socket.on('game:catch2', onCatch2);
    return () => {
      clearTimeout(bombTimer.current);
      socket.off('game:bomb', onBomb);
      socket.off('game:catch2', onCatch2);
    };
  }, [socket]);

  if (room.status === 'playing') {
    return (
      <>
        <GameTable
          me={me}
          room={room}
          showToast={showToast}
          onPlay={(cardIds) => socket.emit('game:play', { cardIds })}
          onPass={() => socket.emit('game:pass')}
        />
        <BombBanner event={bombEvent} />
      </>
    );
  }

  const startRound = () => socket.emit('game:start');
  const leaveRoom = () => socket.emit('room:leave');

  return (
    <div className="room-screen">
      <header className="room-header">
        <h1 className="logo small">🂡 Tien Len</h1>
        <div className="room-code">
          Room <strong>{room.code}</strong>
          <button
            className="btn tiny"
            onClick={() => {
              navigator.clipboard?.writeText(room.code);
              showToast('Room code copied');
            }}
          >
            Copy
          </button>
        </div>
      </header>

      {room.status === 'payment' && <PaymentPanel room={room} />}
      {room.status === 'catch2' && room.catch2 && <Catch2Panel room={room} />}
      <BombBanner event={bombEvent} />

      <div className="room-grid">
        <section className="panel">
          <h3>Players ({room.players.length}/4)</h3>
          <ul className="player-list">
            {room.players.map((p) => (
              <li key={p.id} className={p.connected ? '' : 'offline'}>
                <span className="player-name">
                  <span className="avatar">{(p.name || '?').charAt(0).toUpperCase()}</span>
                  {p.name} {p.isHost && <span className="chip">host</span>}
                  {p.id === room.you && <span className="chip you">you</span>}
                </span>
                <span className="player-meta">
                  {p.hasQR ? <span className="ok">KHQR ✓</span> : <span className="warn">no KHQR</span>}
                  <span className={`tally ${p.tally > 0 ? 'pos' : p.tally < 0 ? 'neg' : ''}`}>
                    {p.tally > 0 ? '+' : p.tally < 0 ? '−' : ''}{money(Math.abs(p.tally), room.settings.currency)}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          {room.lastRanks && room.status === 'waiting' && (
            <div className="last-result">
              <h4>Last round</h4>
              <ol>
                {room.lastRanks.map((id, i) => (
                  <li key={id}>
                    {RANK_LABELS[i + 1] || `${i + 1}th`} — {room.players.find((p) => p.id === id)?.name || 'Left'}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {isHost ? (
            <button className="btn primary big" onClick={startRound} disabled={room.status !== 'waiting'}>
              {room.status === 'payment'
                ? 'Waiting for payments…'
                : room.status === 'catch2'
                  ? 'Waiting for catch-the-2…'
                  : room.lastRanks ? 'Start next round' : 'Start round'}
            </button>
          ) : (
            <p className="muted">
              {room.status === 'payment'
                ? 'Settle payments to unlock the next round.'
                : room.status === 'catch2'
                  ? 'Catch-the-2 in progress…'
                  : 'Waiting for the host to start…'}
            </p>
          )}
        </section>

        <section className="panel">
          <SettingsEditor room={room} isHost={isHost} />
        </section>

        <section className="panel">
          <QRUpload qrUrl={self?.qrUrl} showToast={showToast} />
        </section>
      </div>

      <footer className="room-footer">
        <button className="btn ghost" onClick={leaveRoom} disabled={room.status !== 'waiting'}>
          Leave room
        </button>
      </footer>
    </div>
  );
}
