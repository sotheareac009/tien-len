'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatRiel } from '@/lib/points';
import AdminPlayers from './AdminPlayers';
import AdminSounds from './AdminSounds';

// Top-level sections. One is shown at a time so each gets the full width —
// the players table and the top-up queue were cramped side by side.
const SECTIONS = [
  ['khqr', '💳 Payment KHQR'],
  ['topups', '🧾 Top-up requests'],
  ['sounds', '🔊 Sounds'],
  ['players', '👤 Players'],
];

const STATUS_TABS = [
  ['pending', 'Pending'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
];

export default function AdminPanel({ initialKhqrUrl, adminName }) {
  const [section, setSection] = useState('khqr');
  const [khqrUrl, setKhqrUrl] = useState(initialKhqrUrl || null);
  const [status, setStatus] = useState('pending');
  const [topups, setTopups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [note, setNote] = useState('');
  const fileRef = useRef(null);

  const load = useCallback(async (which) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/topups?status=${which}`);
      const data = await res.json();
      setTopups(res.ok ? data.topups : []);
      if (!res.ok) setNote(data.error || 'Could not load requests');
    } finally {
      setLoading(false);
    }
  }, []);

  // Only fetch the queue while it is on screen.
  useEffect(() => {
    if (section === 'topups') load(status);
  }, [section, status, load]);

  const review = async (id, action) => {
    setBusyId(id);
    try {
      const res = await fetch('/api/admin/topups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, note: action === 'reject' ? note : undefined }),
      });
      const data = await res.json();
      // A 409 means someone (or another tab) already decided this one — reload
      // rather than pretend it worked.
      setNote(res.ok ? '' : data.error || 'Failed');
      await load(status);
    } finally {
      setBusyId(null);
    }
  };

  const uploadKhqr = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setNote('Uploading…');
    try {
      const form = new FormData();
      form.append('qr', file);
      const up = await fetch('/api/upload-qr', { method: 'POST', body: form });
      const upData = await up.json();
      if (!up.ok) throw new Error(upData.error || 'Upload failed');

      const save = await fetch('/api/admin/khqr', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: upData.url }),
      });
      const saved = await save.json();
      if (!save.ok) throw new Error(saved.error || 'Could not save');
      setKhqrUrl(saved.url);
      setNote('Payment KHQR updated ✓');
    } catch (err) {
      setNote(err.message);
    }
  };

  return (
    <div className="room-screen">
      <header className="room-header">
        <h1 className="logo small">🔑 Operator</h1>
        <span className="muted">{adminName}</span>
        <a className="btn tiny" href="/">Back to the game</a>
      </header>

      <nav className="admin-tabs">
        {SECTIONS.map(([key, label]) => (
          <button
            key={key}
            className={`btn ${section === key ? 'primary' : ''}`}
            onClick={() => { setSection(key); setNote(''); }}
          >
            {label}
          </button>
        ))}
      </nav>

      {note && <div className="banner">{note}</div>}

      <section className="panel admin-section">
        {section === 'khqr' && (
          <>
            <h3>Payment KHQR</h3>
            <p className="hint">Players scan this to buy points. 1 pt = {formatRiel(1000)}.</p>
            {khqrUrl ? (
              <img src={khqrUrl} alt="Payment KHQR" className="qr-preview" />
            ) : (
              <div className="qr-placeholder">No KHQR set — players cannot buy points yet</div>
            )}
            <button className="btn" onClick={() => fileRef.current?.click()}>
              {khqrUrl ? 'Replace KHQR' : 'Upload KHQR'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={uploadKhqr}
            />
          </>
        )}

        {section === 'topups' && (
          <>
            <h3>Top-up requests</h3>
            <div className="row tabs">
              {STATUS_TABS.map(([key, label]) => (
                <button
                  key={key}
                  className={`btn tiny ${status === key ? 'primary' : ''}`}
                  onClick={() => setStatus(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {loading ? (
              <p className="muted">Loading…</p>
            ) : topups.length === 0 ? (
              <p className="muted">Nothing here.</p>
            ) : (
              <ul className="topup-list">
                {topups.map((t) => (
                  <li key={t.id}>
                    <div className="topup-head">
                      <strong>{t.profiles?.name || t.google_id}</strong>
                      <span className="muted">{t.profiles?.email}</span>
                    </div>
                    <div className="topup-body">
                      <strong>{t.points} pt</strong> — {formatRiel(t.riel)}
                      {t.reference && <span className="muted"> · ref {t.reference}</span>}
                      <span className="muted"> · {new Date(t.created_at).toLocaleString()}</span>
                    </div>
                    {t.status === 'pending' ? (
                      <div className="row">
                        <button
                          className="btn primary"
                          disabled={busyId === t.id}
                          onClick={() => review(t.id, 'approve')}
                        >
                          {busyId === t.id ? '…' : `Approve +${t.points} pt`}
                        </button>
                        <button
                          className="btn"
                          disabled={busyId === t.id}
                          onClick={() => review(t.id, 'reject')}
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <div className="muted">
                        {t.status} by {t.reviewed_by || '—'}
                        {t.note ? ` · ${t.note}` : ''}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="hint">
              Approve only after you see the riel land in your bank app. Approving credits the
              points immediately, and each request can only be credited once.
            </p>
          </>
        )}

        {section === 'sounds' && <AdminSounds onNote={setNote} />}
        {section === 'players' && <AdminPlayers onNote={setNote} />}
      </section>
    </div>
  );
}