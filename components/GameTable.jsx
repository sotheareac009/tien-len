'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import CardView from './CardView';
import Avatar from './Avatar';
import { nameOf, RANK_LABELS } from './helpers';
import { generateCombos } from '@/lib/game/bot';
import { beats, detectCombo } from '@/lib/game/combos';
import { cardValue } from '@/lib/game/cards';

const isBomb = (c) => c.type === 'quad' || (c.type === 'doubleSeq' && c.cards.length >= 8);

const COMBO_LABELS = {
  single: 'Single',
  pair: 'Pair',
  triple: 'Triple',
  quad: 'Four of a kind 💣',
  straight: 'Straight',
  doubleSeq: 'Double sequence 💣',
};

// Shared between online play (Room wires callbacks to the socket) and
// single-player (SinglePlayer wires them to a local game + bots).
export default function GameTable({ me, room, showToast, onPlay, onPass, title, headerRight }) {
  const [selected, setSelected] = useState([]);

  const myTurn = room.currentTurnId === room.you;
  const mustLead = myTurn && !room.table;

  // Seat everyone with yourself at the bottom.
  const youIdx = room.players.findIndex((p) => p.id === room.you);
  const others = [];
  for (let i = 1; i < room.players.length; i++) {
    others.push(room.players[(youIdx + i) % room.players.length]);
  }
  // Seat classes for 1-3 opponents. Play goes counter-clockwise (right to
  // left), so the next player in turn order sits to your right.
  const seatMap = {
    1: ['seat-top'],
    2: ['seat-right', 'seat-left'],
    3: ['seat-right', 'seat-top', 'seat-left'],
  }[others.length] || [];

  // Where each player sits, so a played combo can fly in from their side.
  const dirOf = (playerId) => {
    if (playerId === room.you) return 'bottom';
    const idx = others.findIndex((p) => p.id === playerId);
    if (idx === -1) return 'top';
    return seatMap[idx]?.replace('seat-', '') || 'top';
  };

  // Replay the fly-in whenever the combo on the table changes, and flash
  // the seat of whoever played it so everyone can see who moved.
  const tableSig = room.table ? room.table.cards.map((c) => c.id).join(',') : '';
  const [playAnim, setPlayAnim] = useState({ key: 0, dir: 'bottom', playerId: null });
  useEffect(() => {
    if (!room.table) {
      // Trick ended — drop the highlight so it can't stick on a seat.
      setPlayAnim((a) => (a.playerId ? { ...a, playerId: null } : a));
      return;
    }
    setPlayAnim({ key: Date.now(), dir: dirOf(room.table.playerId), playerId: room.table.playerId });
    const t = setTimeout(() => setPlayAnim((a) => ({ ...a, playerId: null })), 1300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableSig]);

  // Drag-select: press a card and slide across others to select (or
  // deselect, if the first card was already selected) them in one motion.
  const dragMode = useRef(null); // 'add' | 'remove' | null

  const applyDrag = (id) => {
    const mode = dragMode.current;
    if (!mode || !id) return;
    setSelected((sel) => {
      const has = sel.includes(id);
      if (mode === 'add' && !has) return [...sel, id];
      if (mode === 'remove' && has) return sel.filter((c) => c !== id);
      return sel;
    });
  };

  const beginDrag = (id) => {
    dragMode.current = selected.includes(id) ? 'remove' : 'add';
    applyDrag(id);
  };

  const onHandPointerMove = (e) => {
    if (!dragMode.current) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cardEl = el?.closest?.('[data-card-id]');
    if (cardEl) applyDrag(cardEl.dataset.cardId);
  };

  useEffect(() => {
    const endDrag = () => { dragMode.current = null; };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, []);

  // The state over the wire only carries the table's cards — rebuild the
  // full combo (with its strength) locally before any beats() comparison.
  const tableCombo = useMemo(
    () => (room.table ? detectCombo(room.table.cards) : null),
    [room.table]
  );

  // Cards that can be part of at least one combo beating the table.
  // null = no highlighting (not your turn, or you lead and anything goes).
  const playableIds = useMemo(() => {
    if (!myTurn || !tableCombo) return null;
    const ids = new Set();
    for (const combo of generateCombos(room.yourHand)) {
      if (beats(combo, tableCombo)) {
        for (const card of combo.cards) ids.add(card.id);
      }
    }
    return ids;
  }, [myTurn, tableCombo, room.yourHand]);

  // Best play right now, or null when nothing can beat the table.
  const computeSuggestion = () => {
    if (room.yourHand.length === 0) return null;
    const combos = generateCombos(room.yourHand);
    let candidates;
    if (tableCombo) {
      candidates = combos.filter((c) => beats(c, tableCombo));
      if (candidates.length === 0) return null;
      // Cheapest option first; keep bombs as a last resort.
      candidates.sort(
        (a, b) => ((isBomb(a) ? 1 : 0) - (isBomb(b) ? 1 : 0)) || a.strength - b.strength
      );
    } else {
      // Leading: dump as many low cards as possible, anchored on your lowest
      // card (which also satisfies the first-play rule).
      const lowest = Math.min(...room.yourHand.map(cardValue));
      candidates = combos.filter((c) => c.cards.some((card) => cardValue(card) === lowest));
      if (candidates.length === 0) candidates = combos;
      candidates.sort(
        (a, b) =>
          ((isBomb(a) ? 1 : 0) - (isBomb(b) ? 1 : 0)) ||
          b.cards.length - a.cards.length ||
          a.strength - b.strength
      );
    }
    return candidates[0].cards.map((c) => c.id);
  };

  // When your turn starts, pre-select the suggested play so the Play button
  // is one tap away; if nothing can beat, clear the selection (pass).
  useEffect(() => {
    if (!myTurn) return;
    setSelected(computeSuggestion() ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTurn, room.currentTurnId]);

  // Announce your turn with a short banner so it's impossible to miss.
  const [turnFlash, setTurnFlash] = useState(0);
  const hadTurn = useRef(false);
  useEffect(() => {
    const mine = myTurn && room.yourHand.length > 0;
    if (mine && !hadTurn.current) setTurnFlash(Date.now());
    hadTurn.current = mine;
  }, [myTurn, room.yourHand.length]);

  const suggest = () => {
    const suggestion = computeSuggestion();
    if (!suggestion) return showToast('Nothing can beat this — pass');
    setSelected(suggestion);
  };

  const play = () => {
    if (selected.length === 0) return showToast('Select cards first');
    onPlay(selected);
    setSelected([]);
  };

  const pass = () => {
    onPass();
    setSelected([]);
  };

  return (
    <div className={`game-screen ${myTurn ? 'my-turn' : ''}`}>
      {turnFlash > 0 && (
        <div key={turnFlash} className="turn-flash">
          <span>{mustLead ? 'Your turn — you lead' : 'Your turn!'}</span>
        </div>
      )}
      <header className="game-header">
        <span className="room-code">
          {room.code ? <>Room <strong>{room.code}</strong></> : title || 'Tien Len'}
        </span>
        <span className="muted">
          {myTurn
            ? mustLead ? 'Your turn — you lead' : 'Your turn'
            : `${nameOf(room, room.currentTurnId)}'s turn`}
        </span>
        {headerRight}
      </header>

      <div className="table-felt">
        {others.map((p, i) => (
          <OpponentSeat
            key={p.id}
            player={p}
            seatClass={seatMap[i]}
            isTurn={room.currentTurnId === p.id}
            justPlayed={playAnim.playerId === p.id}
          />
        ))}

        <div className="table-center">
          {room.table ? (
            <>
              <div
                key={playAnim.key}
                className={`table-combo fly-${playAnim.dir} ${room.table.cards.length >= 6 ? 'dense' : ''}`}
              >
                {room.table.cards.map((c) => (
                  <CardView key={c.id} card={c} small />
                ))}
              </div>
              <div key={`lbl-${playAnim.key}`} className="table-label pop">
                {COMBO_LABELS[room.table.type] || room.table.type} by {nameOf(room, room.table.playerId)}
              </div>
            </>
          ) : (
            <div className="table-label empty">New trick — leader plays anything</div>
          )}
        </div>
      </div>

      <div className="my-area">
        <div className={`my-status ${myTurn ? 'active' : ''}`}>
          <span className="player-name">{me.name}</span>
          {room.players[youIdx]?.finishedRank && (
            <span className="chip rank">{RANK_LABELS[room.players[youIdx].finishedRank]}</span>
          )}
          {room.players[youIdx]?.passed && <span className="chip pass">passed</span>}
        </div>

        <div className="hand" onPointerMove={onHandPointerMove}>
          {room.yourHand.map((c) => (
            <CardView
              key={c.id}
              card={c}
              selected={selected.includes(c.id)}
              hinted={playableIds ? playableIds.has(c.id) : false}
              onPointerDown={() => beginDrag(c.id)}
            />
          ))}
          {room.yourHand.length === 0 && <div className="muted">You finished! Waiting for the round to end…</div>}
        </div>

        <div className="actions">
          <button className="btn primary" onClick={play} disabled={!myTurn || selected.length === 0}>
            Play {selected.length > 0 ? `(${selected.length})` : ''}
          </button>
          <button className="btn" onClick={pass} disabled={!myTurn || mustLead}>
            Pass
          </button>
          <button className="btn" onClick={suggest} disabled={!myTurn}>
            💡 Suggest
          </button>
          <button className="btn ghost" onClick={() => setSelected([])} disabled={selected.length === 0}>
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

function OpponentSeat({ player, seatClass, isTurn, justPlayed }) {
  return (
    <div
      className={`seat ${seatClass} ${isTurn ? 'active' : ''} ${justPlayed ? 'just-played' : ''} ${player.connected ? '' : 'offline'}`}
    >
      <Avatar name={player.name} image={player.image} className="seat-avatar" />
      <div className="seat-body">
        <div className="seat-name">
          {player.name}
          {!player.connected && ' (offline)'}
        </div>
        <div className="seat-info">
          {player.finishedRank
            ? <span className="chip rank">{RANK_LABELS[player.finishedRank]}</span>
            : <span className="card-back-count">🂠 {player.cardCount}</span>}
          {player.passed && <span className="chip pass">passed</span>}
        </div>
      </div>
    </div>
  );
}
