'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const KINDS = [
  ['chop', '💥 Bomb chop', 'Played when a bomb chops another play and the bonus is collected.'],
  ['catch', '🐷 Catch-the-2', 'Played on the catch-the-2 reveal.'],
  ['penalty', '😱 Stuck on 13', 'Played when someone is caught holding a full hand and pays double.'],
];

// Operator-chosen sound effects. Anything set here is used by every player,
// overriding the built-in synthesised effect.
export default function AdminSounds({ onNote }) {
  const [sounds, setSounds] = useState({});
  const [busy, setBusy] = useState(null);
  const refs = useRef({});

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/sound');
    const data = await res.json();
    if (res.ok) setSounds(data.sounds || {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const upload = async (kind, e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(kind);
    try {
      const form = new FormData();
      form.append('kind', kind);
      form.append('sound', file);
      const res = await fetch('/api/admin/sound', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      onNote('Sound updated — players hear it on their next page load');
      await load();
    } catch (err) {
      onNote(err.message);
    } finally {
      setBusy(null);
    }
  };

  const clear = async (kind) => {
    setBusy(kind);
    try {
      const res = await fetch(`/api/admin/sound?kind=${kind}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not clear');
      onNote('Reverted to the built-in sound');
      await load();
    } catch (err) {
      onNote(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h3>Sounds</h3>
      <p className="hint">
        Upload your own effects — MP3, OGG, WAV or WebM, up to 1MB. Keep them under a
        second. Leave one unset and the built-in synthesised sound is used instead.
      </p>

      <ul className="topup-list">
        {KINDS.map(([kind, label, description]) => (
          <li key={kind}>
            <div className="topup-head">
              <strong>{label}</strong>
              <span className="muted">{sounds[kind] ? 'custom' : 'built-in'}</span>
            </div>
            <div className="topup-body">
              <span className="muted">{description}</span>
            </div>

            {sounds[kind] && (
              // Lets you check the file actually plays before a round relies on it.
              <audio controls src={sounds[kind]} style={{ width: '100%', marginBottom: 10 }} />
            )}

            <div className="row">
              <button
                className="btn"
                disabled={busy === kind}
                onClick={() => refs.current[kind]?.click()}
              >
                {busy === kind ? 'Working…' : sounds[kind] ? 'Replace' : 'Upload sound'}
              </button>
              {sounds[kind] && (
                <button className="btn ghost" disabled={busy === kind} onClick={() => clear(kind)}>
                  Use built-in
                </button>
              )}
            </div>

            <input
              ref={(el) => { refs.current[kind] = el; }}
              type="file"
              accept="audio/mpeg,audio/ogg,audio/wav,audio/webm"
              hidden
              onChange={(e) => upload(kind, e)}
            />
          </li>
        ))}
      </ul>
    </>
  );
}