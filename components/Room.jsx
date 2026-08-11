'use client';

import { useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket-client';
import { RANK_LABELS, nameOf } from './helpers';
import { formatRiel, toRiel } from '@/lib/points';
import { useWallet } from './useWallet';
import BuyPoints from './BuyPoints';
import SettingsEditor from './SettingsEditor';
import GameTable from './GameTable';
import RoomSummary from './RoomSummary';
import RoundResult from './RoundResult';
import BombBanner from './BombBanner';
import Catch2Panel from './Catch2Panel';
import Avatar from './Avatar';

export default function Room({ me, room, showToast }) {
  const socket = getSocket();
  const self = room.players.find((p) => p.id === room.you);
  const isHost = room.hostId === room.you;
  const [bombEvent, setBombEvent] = useState(null);
  const [buying, setBuying] = useState(false);
  // The result screen shows once per round; closing it must not bring it back
  // on the next broadcast, so remember which round was dismissed.
  const [dismissedRound, setDismissedRound] = useState(null);
  const [wallet, refreshWallet] = useWallet(true);
  const bombTimer = useRef(null);

  useEffect(() => {
    const onBomb = (e) => {
      clearTimeout(bombTimer.current);
      setBombEvent({
        key: Date.now(),
        title: `💣 ${e.byName} chopped ${e.victimName}!${e.multiplier > 1 ? ` ×${e.multiplier}` : ''}`,
        amountText: e.amount > 0 ? `+${e.amount} pt` : null,
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
        amountText: e.amount > 0 ? `+${e.amount} pt` : null,
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

  // Balances change outside the room — an approved top-up, an operator edit.
  // Poll between rounds so the number people are staring at stays honest.
  // (The stake check at game:start always re-reads the wallet regardless.)
  useEffect(() => {
    if (room.status === 'playing') return;
    const t = setInterval(() => socket.emit('wallet:refresh'), 15000);
    return () => clearInterval(t);
  }, [socket, room.status]);

  const saveRoom = () =>
    socket.emit('room:save', {}, (res) => res?.error && showToast(res.error));

  if (room.status === 'playing') {
    return (
      <>
        <GameTable
          me={me}
          room={room}
          showToast={showToast}
          onPlay={(cardIds) => socket.emit('game:play', { cardIds })}
          onPass={() => socket.emit('game:pass')}
          headerRight={
            // The host can save mid-round: the hand itself is stored, so a
            // server restart resumes this deal rather than losing it.
            isHost ? (
              <button className="btn tiny" onClick={saveRoom} disabled={room.saved}>
                {room.saved ? 'Saved ✓' : '💾 Save game'}
              </button>
            ) : room.saved ? (
              <span className="chip">saved</span>
            ) : null
          }
        />
        <BombBanner event={bombEvent} />
      </>
    );
  }

  const startRound = () => socket.emit('game:start');
  const leaveRoom = () => socket.emit('room:leave');

  // Identifies one specific round, so the result screen appears once per round
  // and a new round brings it back.
  const roundKey = room.lastRanks ? `${room.roundsPlayed}:${room.lastRanks.join(',')}` : null;
  const showResult = !!roundKey && room.status === 'waiting' && dismissedRound !== roundKey;
  // Finishing position from the last round, shown beside each player's name.
  const placeOf = (id) => (room.lastRanks ? room.lastRanks.indexOf(id) + 1 : 0);
  const myPoints = self?.points ?? 0;
  const short = myPoints < (room.minPoints || 0);

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
        <div className="wallet-bar">
          <span className="coins-badge small">{myPoints.toLocaleString()} pt</span>
          <span className="muted">{formatRiel(toRiel(myPoints))}</span>
          <button className="btn tiny" onClick={() => setBuying(true)}>Buy points</button>
        </div>
      </header>

      {room.status === 'catch2' && room.catch2 && <Catch2Panel room={room} />}
      <BombBanner event={bombEvent} />

      {room.settleError && <div className="banner warn">{room.settleError}</div>}

      {/* A round frozen by someone dropping out. Nobody can play until the
          host continues, so a reload never costs anyone a trick. */}
      {room.status === 'paused' && (
        <div className="banner warn">
          <strong>⏸ Round paused.</strong>{' '}
          {room.offline.length > 0
            ? `Waiting for ${room.offline.join(', ')} to come back.`
            : 'Everyone is back — the round can continue.'}
          {isHost ? (
            <button
              className="btn primary"
              style={{ marginLeft: 12 }}
              disabled={!room.canContinue}
              onClick={() => socket.emit('room:continue')}
            >
              Continue round
            </button>
          ) : (
            <span className="muted"> Waiting for the host to continue.</span>
          )}
        </div>
      )}

      <div className="room-grid">
        <div className="room-col">
          <section className="panel">
            <h3>Players ({room.players.length}/4)</h3>
            <ul className="player-list">
              {room.players.map((p) => (
                <li key={p.id} className={p.connected ? '' : 'offline'}>
                  <span className="player-name">
                    <Avatar name={p.name} image={p.image} />
                    {p.name} {p.isHost && <span className="chip">host</span>}
                    {p.id === room.you && <span className="chip you">you</span>}
                    {/* Where they finished the last round */}
                    {placeOf(p.id) > 0 && (
                      <span className="chip rank">{RANK_LABELS[placeOf(p.id)]}</span>
                    )}
                  </span>
                  <span className="player-meta">
                    <span className={typeof p.points === 'number' && p.points < room.minPoints ? 'warn' : 'muted'}>
                      {typeof p.points === 'number' ? `${p.points.toLocaleString()} pt` : '—'}
                    </span>
                    <span className={`tally ${p.tally > 0 ? 'pos' : p.tally < 0 ? 'neg' : ''}`}>
                      {p.tally > 0 ? '+' : p.tally < 0 ? '−' : ''}{Math.abs(p.tally).toLocaleString()} pt
                    </span>
                  </span>
                </li>
              ))}
            </ul>

            {room.lastRanks && room.status === 'waiting' && (
              <div className="last-result">
                <h4>Last round</h4>
                <ol>
                  {room.lastRanks.map((id, i) => {
                    const delta = room.players.find((p) => p.id === id)?.lastDelta ?? 0;
                    return (
                      <li key={id}>
                        {RANK_LABELS[i + 1] || `${i + 1}th`} — {nameOf(room, id)}{' '}
                        <span className={delta > 0 ? 'ok' : delta < 0 ? 'warn' : 'muted'}>
                          {delta > 0 ? '+' : delta < 0 ? '−' : ''}
                          {delta !== 0 ? `${Math.abs(delta)} pt` : ''}
                        </span>
                      </li>
                    );
                  })}
                </ol>
                <p className="hint">Points moved between wallets automatically.</p>
              </div>
            )}

            {isHost ? (
              <button className="btn primary big" onClick={startRound} disabled={room.status !== 'waiting'}>
                {room.status === 'catch2'
                  ? 'Waiting for catch-the-2…'
                  : room.status === 'paused'
                    ? 'Round paused — continue it above'
                    : room.lastRanks ? 'Start next round' : 'Start round'}
              </button>
            ) : (
              <p className="muted">
                {room.status === 'catch2'
                  ? 'Catch-the-2 in progress…'
                  : room.status === 'paused'
                    ? 'Round paused — nobody can play until the host continues.'
                    : 'Waiting for the host to start…'}
              </p>
            )}

            {short && (
              <p className="warn">
                You need {room.minPoints} pt to cover this round — buy more points first.
              </p>
            )}
          </section>

          <section className="panel">
            <SettingsEditor room={room} isHost={isHost} />
          </section>
        </div>

        <section className="panel room-summary-panel">
          <RoomSummary room={room} />
        </section>
      </div>

      <footer className="room-footer">
        <button className="btn ghost" onClick={leaveRoom} disabled={room.status !== 'waiting'}>
          Leave room
        </button>
        {isHost && (
          <>
            <button className="btn" disabled={room.saved} onClick={saveRoom}>
              {room.saved ? 'Room saved ✓' : 'Save room'}
            </button>
            <button
              className="btn ghost danger"
              onClick={() => {
                if (!confirm('Close this room for everyone? A round in progress will not be settled.')) return;
                socket.emit('room:delete', {}, (res) => res?.error && showToast(res.error));
              }}
            >
              Delete room
            </button>
          </>
        )}
      </footer>
      {isHost && (
        <p className="hint" style={{ textAlign: 'center' }}>
          {room.saved
            ? 'This room and its seats are kept if the server restarts.'
            : 'Save the room to keep everyone’s seats and the current round across a restart.'}
        </p>
      )}

      {showResult && (
        <RoundResult
          room={room}
          isHost={isHost}
          onNext={() => {
            setDismissedRound(roundKey);
            startRound();
          }}
          onClose={() => setDismissedRound(roundKey)}
        />
      )}

      {buying && wallet && (
        <BuyPoints
          wallet={wallet}
          showToast={showToast}
          onDone={refreshWallet}
          onClose={() => setBuying(false)}
        />
      )}
    </div>
  );
}