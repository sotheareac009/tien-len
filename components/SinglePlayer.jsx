'use client';

import { useEffect, useRef, useState } from 'react';
import { TienLenGame } from '@/lib/game/TienLenGame';
import { chooseMove } from '@/lib/game/bot';
import GameTable from './GameTable';
import BombBanner from './BombBanner';
import { RANK_LABELS } from './helpers';

const YOU = 'you';
const BOT_NAMES = ['Bot Dara', 'Bot Sok', 'Bot Srey'];
const COINS_KEY = 'tienlen-coins';
const START_COINS = 1000;
const REFILL = 1000;
// Caught holding all 13 cards costs double the Winner 1 prize.
const STUCK_MULTIPLIER = 2;
const BOT_DELAY_MS = 1000;

const coins = (n) => `${Number(n).toLocaleString()} 🪙`;

// Single-player Tien Len vs bots. Runs fully in the browser with the same
// engine as online play — no server, no KHQR, just app coins.
export default function SinglePlayer({ me, onExit, showToast }) {
  const [balance, setBalance] = useState(START_COINS);
  // Where the balance lives: 'db' for signed-in players (kept on their
  // account, so it follows them across devices), 'local' for guests.
  // null while we are still finding out.
  const [store, setStore] = useState(null);
  const storeRef = useRef(null);
  const [bets, setBets] = useState({ w1: 100, w2: 50, bomb: 100, catch2: 50 });
  const [numBots, setNumBots] = useState(3);
  const [practiceMode, setPracticeMode] = useState('none'); // none | bombs | counter
  const [phase, setPhase] = useState('setup'); // setup | playing | catch2 | result
  const [result, setResult] = useState(null);  // { ranks, deltas, bombs, catch }
  const [bombEvent, setBombEvent] = useState(null);
  const [catchInfo, setCatchInfo] = useState(null); // { catcher, loser, loserCount }
  const [, setTick] = useState(0);
  const gameRef = useRef(null);
  const namesRef = useRef({});
  const tallyRef = useRef({ [YOU]: 0 });
  const bombsRef = useRef([]); // { from, to, amount } chops this round
  const pendingRanksRef = useRef(null);
  const bombTimer = useRef(null);
  const catchTimer = useRef(null);

  const useStore = (kind) => {
    storeRef.current = kind;
    setStore(kind);
  };

  useEffect(() => {
    let cancelled = false;
    const fromLocal = () => {
      const saved = Number(localStorage.getItem(COINS_KEY));
      if (Number.isFinite(saved) && saved >= 0) setBalance(saved);
      else localStorage.setItem(COINS_KEY, String(START_COINS));
      useStore('local');
    };
    (async () => {
      try {
        // 401 = guest (or persistence switched off) — fall back to the browser.
        const res = await fetch('/api/coins');
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setBalance(data.coins);
          useStore('db');
          return;
        }
      } catch {
        // Offline or server error — the local balance still lets them play.
      }
      if (!cancelled) fromLocal();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every balance change is a delta (a round's win/loss, or a free top-up).
  // Sending the delta rather than the total lets Postgres do the arithmetic,
  // so two open tabs can't overwrite each other's result.
  const adjustCoins = (delta) => {
    setBalance((b) => {
      const next = Math.max(0, b + delta);
      if (storeRef.current === 'local') localStorage.setItem(COINS_KEY, String(next));
      return next;
    });
    if (storeRef.current !== 'db' || delta === 0) return;
    fetch('/api/coins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta: Math.trunc(delta) }),
    })
      .then((res) => (res.ok ? res.json() : null))
      // The stored total is authoritative — adopt it in case a write was lost.
      .then((data) => {
        if (typeof data?.coins === 'number') setBalance(data.coins);
      })
      .catch(() => showToast('Could not save your coins — check your connection'));
  };

  const rerender = () => setTick((t) => t + 1);

  // Worst case you can lose in one round: last place pays Winner 1's prize,
  // and with exactly 3 players last place pays both prizes. Being caught on 13
  // cards costs double the Winner 1 prize, which is more than either.
  const players = numBots + 1;
  const placings = players === 3 ? bets.w1 + bets.w2 : bets.w1;
  const maxLoss = Math.max(placings, bets.w1 * STUCK_MULTIPLIER);
  const canAfford = balance >= maxLoss;
  const ready = store !== null; // balance loaded — don't deal against a guess

  const startRound = () => {
    if (!ready) return;
    if (!canAfford) return showToast('Not enough coins for these stakes');
    const ids = [YOU, ...BOT_NAMES.slice(0, numBots).map((_, i) => `bot${i}`)];
    namesRef.current = { [YOU]: me.name };
    BOT_NAMES.slice(0, numBots).forEach((n, i) => { namesRef.current[`bot${i}`] = n; });
    for (const id of ids) tallyRef.current[id] = tallyRef.current[id] || 0;
    // Practice deals:
    //  bombs   — you get 3♠ (the lead), A-A-A-A, the 3♥-7♥ straight flush and
    //            K♥ (the bait — only a 2 beats it, you hold every ace);
    //            a bot gets the 2s to chop.
    //  counter — Bot Sok gets A-A-A-A; you get 2♥ (bait the quad out) and the
    //            9♥-K♥ straight flush to counter-chop it for double.
    //  stuck   — you hold every card you need to go out in two tricks without
    //            anyone else getting a play: lead the 3-to-A straight, everyone
    //            passes, then lead 2♥. All three bots end on 13 cards.
    const sokId = numBots >= 2 ? 'bot1' : 'bot0';
    const rigged =
      practiceMode === 'bombs'
        ? {
            [YOU]: ['3-0', '14-0', '14-1', '14-2', '14-3', '13-3', '3-3', '4-3', '5-3', '6-3', '7-3'],
            bot0: ['15-0', '15-3'],
          }
        : practiceMode === 'counter'
          ? {
              [YOU]: ['15-3', '9-3', '10-3', '11-3', '12-3', '13-3'],
              [sokId]: ['14-0', '14-1', '14-2', '14-3'],
            }
          // stuck — you hold 3♠ (so you lead) plus a 3-to-A straight topping at
          // A♥, the highest card any straight can hold, so nothing beats it and
          // straights cannot be chopped. Everyone passes, you lead 2♥ last, and
          // the bots go out on a full hand: thối 13 lá.
          : practiceMode === 'stuck'
            ? {
                [YOU]: [
                  '3-0', '4-0', '5-0', '6-0', '7-0', '8-0', '9-0',
                  '10-0', '11-0', '12-0', '13-0', '14-3', '15-3',
                ],
              }
            : null;
    gameRef.current = new TienLenGame(ids, rigged);
    bombsRef.current = [];
    setResult(null);
    setPhase('playing');
  };

  const completeRound = (ranks, catchPay, stuck) => {
    const n = ranks.length;
    const ids = gameRef.current ? gameRef.current.order : ranks;
    const deltas = Object.fromEntries(ids.map((id) => [id, 0]));

    // Stuck on 13 (thoi 13 la): everyone still holding a full hand pays the
    // winner double the Winner 1 prize, and nothing else settles.
    if (stuck?.length) {
      for (const id of stuck) {
        deltas[id] -= bets.w1 * STUCK_MULTIPLIER;
        deltas[ranks[0]] += bets.w1 * STUCK_MULTIPLIER;
      }
      for (const id of ids) tallyRef.current[id] = (tallyRef.current[id] || 0) + deltas[id];
      adjustCoins(deltas[YOU]);
      setResult({ ranks, deltas, bombs: [], catch: null, stuck });
      setCatchInfo(null);
      setPhase('result');
      return;
    }

    deltas[ranks[n - 1]] -= bets.w1;
    deltas[ranks[0]] += bets.w1;
    if (bets.w2 > 0 && n >= 3) {
      const payer = n === 3 ? ranks[2] : ranks[n - 2];
      deltas[payer] -= bets.w2;
      deltas[ranks[1]] += bets.w2;
    }
    for (const bp of bombsRef.current) {
      deltas[bp.from] -= bp.amount;
      deltas[bp.to] += bp.amount;
    }
    if (catchPay) {
      deltas[catchPay.from] -= catchPay.amount;
      deltas[catchPay.to] += catchPay.amount;
    }
    for (const id of ranks) tallyRef.current[id] += deltas[id];
    adjustCoins(deltas[YOU]);
    setResult({ ranks, deltas, bombs: [...bombsRef.current], catch: catchPay || null, stuck: null });
    setCatchInfo(null);
    setPhase('result');
  };

  // Round over → offer the catch-the-2 gamble to the last winner first.
  const finishRound = (ranks, stuck) => {
    if (stuck?.length) return completeRound(ranks, null, stuck);
    if (bets.catch2 > 0 && ranks.length >= 2) {
      pendingRanksRef.current = ranks;
      const catcher = ranks[ranks.length - 2];
      const loser = ranks[ranks.length - 1];
      setCatchInfo({ catcher, loser, loserCount: gameRef.current.hand(loser).length });
      setPhase('catch2');
      if (catcher !== YOU) {
        // Bots take the gamble half the time; give them visible thinking time.
        clearTimeout(catchTimer.current);
        catchTimer.current = setTimeout(() => decideCatch(Math.random() < 0.5), 2500);
      }
    } else {
      completeRound(ranks, null);
    }
  };

  const decideCatch = (didCatch) => {
    const ranks = pendingRanksRef.current;
    if (!ranks || !gameRef.current) return;
    pendingRanksRef.current = null;
    const catcher = ranks[ranks.length - 2];
    const loser = ranks[ranks.length - 1];
    if (!didCatch) {
      if (catcher !== YOU) showToast(`${namesRef.current[catcher]} skipped the catch`);
      completeRound(ranks, null);
      return;
    }
    const hasTwo = gameRef.current.hand(loser).some((c) => c.rank === 15);
    const catchPay = hasTwo
      ? { from: loser, to: catcher, amount: bets.catch2, correct: true }
      : { from: catcher, to: loser, amount: bets.catch2, correct: false };
    clearTimeout(bombTimer.current);
    setBombEvent({
      key: Date.now(),
      title: hasTwo
        ? `🐷 ${namesRef.current[catcher]} caught ${namesRef.current[loser]}'s 2!`
        : `😅 No 2 — ${namesRef.current[catcher]} pays ${namesRef.current[loser]}`,
      amountText: bets.catch2 > 0 ? `+${bets.catch2} 🪙` : null,
    });
    bombTimer.current = setTimeout(() => setBombEvent(null), 5000);
    // Close the catch modal and let the reveal play on the table before
    // the result screen covers it.
    setCatchInfo(null);
    clearTimeout(catchTimer.current);
    catchTimer.current = setTimeout(() => completeRound(ranks, catchPay), 3500);
  };

  const afterMove = (res) => {
    if (res?.bomb) {
      const multiplier = res.bomb.multiplier || 1;
      const amount = bets.bomb * multiplier;
      if (amount > 0) {
        bombsRef.current.push({ from: res.bomb.victim, to: res.bomb.by, amount });
      }
      clearTimeout(bombTimer.current);
      setBombEvent({
        key: Date.now(),
        title: `💣 ${namesRef.current[res.bomb.by]} chopped ${namesRef.current[res.bomb.victim]}!${multiplier > 1 ? ` ×${multiplier}` : ''}`,
        amountText: amount > 0 ? `+${amount} 🪙` : null,
      });
      bombTimer.current = setTimeout(() => setBombEvent(null), 5000);
    }
    if (res?.roundOver) finishRound(res.ranks, res.stuck);
    else rerender();
  };

  // Bot turns.
  useEffect(() => {
    if (phase !== 'playing') return;
    const g = gameRef.current;
    if (!g || g.over) return;
    const current = g.currentPlayerId();
    if (current === YOU) return;
    const t = setTimeout(() => {
      const move = chooseMove(g, current);
      let res = move ? g.play(current, move) : g.pass(current);
      if (res?.error) {
        // Fallback so a bot can never stall the round.
        res = g.table ? g.pass(current) : g.play(current, [g.hand(current)[0].id]);
      }
      afterMove(res);
    }, BOT_DELAY_MS);
    return () => clearTimeout(t);
  });

  const onPlay = (cardIds) => {
    const res = gameRef.current.play(YOU, cardIds);
    if (res.error) return showToast(res.error);
    afterMove(res);
  };

  const onPass = () => {
    const res = gameRef.current.pass(YOU);
    if (res.error) return showToast(res.error);
    afterMove(res);
  };

  const buildRoomState = () => {
    const g = gameRef.current;
    return {
      code: null,
      status: 'playing',
      you: YOU,
      players: g.order.map((id) => {
        const rankIdx = g.finished.indexOf(id);
        return {
          id,
          name: namesRef.current[id],
          connected: true,
          isHost: id === YOU,
          cardCount: g.hand(id).length,
          finishedRank: rankIdx === -1 ? null : rankIdx + 1,
          passed: g.passed.has(id),
          tally: tallyRef.current[id] || 0,
        };
      }),
      table: g.table ? { type: g.table.type, cards: g.table.cards, playerId: g.table.playerId } : null,
      prevTable: g.prevTable
        ? { type: g.prevTable.type, cards: g.prevTable.cards, playerId: g.prevTable.playerId }
        : null,
      currentTurnId: g.over ? null : g.currentPlayerId(),
      yourHand: g.hand(YOU),
      debts: [],
      lastRanks: null,
    };
  };

  if (phase === 'setup') {
    return (
      <div className="center-screen">
        <div className="panel">
          <h1 className="logo">🎮 Single Player</h1>
          <p className="muted">Play vs bots — free, with app coins</p>
          <div className="coins-badge">{ready ? coins(balance) : '… 🪙'}</div>
          {ready && (
            <p className="hint">
              {store === 'db'
                ? 'Saved to your Google account — your coins follow you to any device.'
                : 'Saved in this browser. Sign in with Google to keep your coins.'}
            </p>
          )}
          <div className="settings" style={{ textAlign: 'left' }}>
            <label>
              Winner 1 prize (coins)
              <input
                type="number" min="0" step="50" value={bets.w1}
                onChange={(e) => setBets((b) => ({ ...b, w1: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
              />
            </label>
            <label>
              Winner 2 prize (coins)
              <input
                type="number" min="0" step="50" value={bets.w2}
                onChange={(e) => setBets((b) => ({ ...b, w2: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
              />
            </label>
            <label>
              Bomb bonus (chop a 2, coins)
              <input
                type="number" min="0" step="50" value={bets.bomb}
                onChange={(e) => setBets((b) => ({ ...b, bomb: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
              />
            </label>
            <label>
              Catch-the-2 price (coins)
              <input
                type="number" min="0" step="50" value={bets.catch2}
                onChange={(e) => setBets((b) => ({ ...b, catch2: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
              />
            </label>
            <label>
              Opponents
              <select value={numBots} onChange={(e) => setNumBots(Number(e.target.value))}>
                <option value={1}>1 bot (2 players)</option>
                <option value={2}>2 bots (3 players)</option>
                <option value={3}>3 bots (4 players)</option>
              </select>
            </label>
            <label>
              🧪 Practice deal
              <select value={practiceMode} onChange={(e) => setPracticeMode(e.target.value)}>
                <option value="none">Off — random deal</option>
                <option value="bombs">You get A-A-A-A + 3♥-7♥ flush, a bot gets 2s</option>
                <option value="counter">Bot Sok gets A-A-A-A, you get 2♥ + 9♥-K♥ flush</option>
                <option value="stuck">😱 Stuck on 13 — you get 3♠-A♥ straight + 2♥, bots never play</option>
              </select>
            </label>
            <p className="hint">
              Last place pays {bets.w1} 🪙 to 1st place.
              {bets.w2 > 0 && players >= 3 && <> {players === 3 ? 'Last place' : '3rd place'} pays {bets.w2} 🪙 to 2nd place.</>}
              {bets.bomb > 0 && <> Chopping with a bomb 💣 collects {bets.bomb} 🪙 from the chopped player.</>}
              {bets.catch2 > 0 && <> The last winner may catch the loser&apos;s 2 🐷 for {bets.catch2} 🪙 — right, the loser pays; wrong, the catcher pays.</>}
            </p>
          </div>
          <div className="stack">
            <button className="btn primary big" onClick={startRound} disabled={!ready || !canAfford}>
              {!ready ? 'Loading coins…' : canAfford ? 'Deal cards' : `Need ${coins(maxLoss)} to play`}
            </button>
            {ready && !canAfford && (
              <button className="btn" onClick={() => adjustCoins(REFILL)}>
                Get {coins(REFILL)} free
              </button>
            )}
            <button className="btn ghost" onClick={onExit}>Back to menu</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <GameTable
        me={me}
        room={buildRoomState()}
        showToast={showToast}
        onPlay={onPlay}
        onPass={onPass}
        title="🎮 Single Player"
        headerRight={
          <span className="header-right">
            <span className="coins-badge small">{coins(balance)}</span>
            <button
              className="btn tiny"
              onClick={() => {
                clearTimeout(catchTimer.current);
                pendingRanksRef.current = null;
                gameRef.current = null;
                setCatchInfo(null);
                setPhase('setup');
              }}
            >
              Quit
            </button>
          </span>
        }
      />
      <BombBanner event={bombEvent} />
      {phase === 'catch2' && catchInfo && (
        <div className="payment-overlay">
          <div className="panel payment-panel">
            <h2>🐷 Catch the 2?</h2>
            <p className="muted">
              {namesRef.current[catchInfo.loser]} finished last, still holding{' '}
              <strong>{catchInfo.loserCount}</strong> hidden card{catchInfo.loserCount === 1 ? '' : 's'}.
            </p>
            {catchInfo.catcher === YOU ? (
              <>
                <p className="hint">
                  If they hold a 2, you win {bets.catch2} 🪙 from {namesRef.current[catchInfo.loser]}.
                  If not, you pay {bets.catch2} 🪙.
                </p>
                <div className="stack">
                  <button className="btn primary big" onClick={() => decideCatch(true)}>
                    Catch the 2! 🐷 ({bets.catch2} 🪙)
                  </button>
                  <button className="btn" onClick={() => decideCatch(false)}>Skip</button>
                </div>
              </>
            ) : (
              <p className="muted">Waiting for {namesRef.current[catchInfo.catcher]} to decide…</p>
            )}
          </div>
        </div>
      )}
      {phase === 'result' && result && (
        <div className="payment-overlay">
          <div className="panel payment-panel">
            <h2>{result.ranks[0] === YOU ? '🏆 You won!' : 'Round finished'}</h2>
            {result.stuck?.length > 0 && (
              <div className="banner warn">
                <strong>😱 Stuck on 13!</strong>{' '}
                {result.stuck.map((id) => namesRef.current[id]).join(', ')} never played a
                card, so the round ended at once and{' '}
                {result.stuck.length === 1 ? 'pays' : 'each pays'} double to{' '}
                {namesRef.current[result.ranks[0]]}.
              </div>
            )}
            <ol className="result-list">
              {result.ranks.map((id, i) => (
                <li key={id}>
                  {RANK_LABELS[i + 1] || `${i + 1}th`} — {namesRef.current[id]}{' '}
                  <span className={result.deltas[id] > 0 ? 'ok' : result.deltas[id] < 0 ? 'warn' : 'muted'}>
                    {result.deltas[id] > 0 ? '+' : ''}{result.deltas[id] !== 0 ? `${result.deltas[id]} 🪙` : ''}
                  </span>
                </li>
              ))}
            </ol>
            {result.catch && (
              <p className="muted">
                🐷 {result.catch.correct ? 'Caught the 2:' : 'Missed the catch:'}{' '}
                {namesRef.current[result.catch.to]} collected {result.catch.amount} 🪙 from{' '}
                {namesRef.current[result.catch.from]}
              </p>
            )}
            {result.bombs.length > 0 && (
              <p className="muted">
                {result.bombs.map((b, i) => (
                  <span key={i}>
                    💣 {namesRef.current[b.to]} collected {b.amount} 🪙 from {namesRef.current[b.from]}
                    <br />
                  </span>
                ))}
              </p>
            )}
            <p className="muted">Your balance: <strong>{coins(balance)}</strong></p>
            <div className="stack">
              <button className="btn primary big" onClick={startRound} disabled={!canAfford}>
                {canAfford ? 'Play again' : `Need ${coins(maxLoss)} to play`}
              </button>
              {!canAfford && (
                <button className="btn" onClick={() => adjustCoins(REFILL)}>
                  Get {coins(REFILL)} free
                </button>
              )}
              <button className="btn" onClick={() => setPhase('setup')}>Change stakes</button>
              <button className="btn ghost" onClick={onExit}>Back to menu</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
