'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatRiel, toRiel } from '@/lib/points';
import Avatar from './Avatar';

// Player list with hand editing of point balances. Every edit is recorded
// server-side with who made it, and the history is one click away.
export default function AdminPlayers({ onNote }) {
  const [query, setQuery] = useState('');
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // google_id being edited
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(null); // { googleId, rows }

  const load = useCallback(async (q) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/players?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setPlayers(res.ok ? data.players : []);
      if (!res.ok) onNote(data.error || 'Could not load players');
    } finally {
      setLoading(false);
    }
  }, [onNote]);

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => load(query), 250);
    return () => clearTimeout(t);
  }, [query, load]);

  const startEdit = (p) => {
    setEditing(p.google_id);
    setAmount(String(p.points));
    setNote('');
    setHistory(null);
  };

  const apply = async (googleId) => {
    const value = Number(amount);
    if (!Number.isInteger(value)) return onNote('Enter a whole number of points');
    setBusy(true);
    try {
      const res = await fetch('/api/admin/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ googleId, points: value, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      onNote(`Balance ${data.before} → ${data.after} pt`);
      setEditing(null);
      await load(query);
    } catch (err) {
      onNote(err.message);
    } finally {
      setBusy(false);
    }
  };

  const showHistory = async (googleId) => {
    if (history?.googleId === googleId) return setHistory(null);
    const res = await fetch(`/api/admin/players?history=${encodeURIComponent(googleId)}`);
    const data = await res.json();
    setHistory({ googleId, rows: res.ok ? data.adjustments : [] });
  };

  return (
    <>
      <h3>Players</h3>
      <p className="hint">
        Type the balance the player should have and save — that number becomes their
        points. Every edit is recorded against your account.
      </p>

      <input
        placeholder="Search by name or email"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginTop: 12 }}
      />

      {loading ? (
        <p className="muted">Loading…</p>
      ) : players.length === 0 ? (
        <p className="muted">No players yet — they appear here after their first sign-in.</p>
      ) : (
        <ul className="topup-list">
          {players.map((p) => (
            <li key={p.google_id}>
              <div className="topup-head">
                <Avatar name={p.name} image={p.image} />
                <strong>{p.name}</strong>
                <span className="muted">{p.email}</span>
              </div>
              <div className="topup-body">
                <strong className={p.points < 0 ? 'warn' : ''}>{p.points.toLocaleString()} pt</strong>
                <span className="muted"> · {formatRiel(toRiel(p.points))}</span>
                <span className="muted"> · {p.coins.toLocaleString()} 🪙 single player</span>
              </div>

              {editing === p.google_id ? (
                <div className="stack" style={{ marginTop: 0 }}>
                  <div className="row">
                    <input
                      type="number"
                      step="1"
                      min="0"
                      autoFocus
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && apply(p.google_id)}
                    />
                    <button className="btn primary" disabled={busy} onClick={() => apply(p.google_id)}>
                      {busy ? 'Saving…' : 'Save points'}
                    </button>
                  </div>
                  <input
                    placeholder="Reason (optional) — e.g. cash paid in person"
                    maxLength={200}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              ) : (
                <div className="row">
                  <button className="btn" onClick={() => startEdit(p)}>Edit points</button>
                  <button className="btn ghost" onClick={() => showHistory(p.google_id)}>
                    {history?.googleId === p.google_id ? 'Hide history' : 'History'}
                  </button>
                </div>
              )}

              {history?.googleId === p.google_id && (
                <div className="last-result">
                  <h4>Hand edits</h4>
                  {history.rows.length === 0 ? (
                    <p className="muted">None yet.</p>
                  ) : (
                    <ol>
                      {history.rows.map((a) => (
                        <li key={a.id}>
                          {a.before_points} → {a.after_points} pt
                          <span className={a.delta > 0 ? 'ok' : 'warn'}>
                            {' '}({a.delta > 0 ? '+' : ''}{a.delta})
                          </span>
                          <span className="muted">
                            {' '}· {a.admin_email} · {new Date(a.created_at).toLocaleString()}
                            {a.note ? ` · ${a.note}` : ''}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}