'use client';

import { useState } from 'react';
import { getSocket } from '@/lib/socket-client';

export default function NameScreen({ onJoined, showToast }) {
  const [name, setName] = useState('');

  const join = (e) => {
    e.preventDefault();
    const socket = getSocket();
    socket.emit('player:join', { name }, (res) => {
      if (res?.error) return showToast(res.error);
      onJoined({ id: res.id, name: name.trim() });
    });
  };

  return (
    <div className="center-screen">
      <div className="panel">
        <h1 className="logo">🂡 Tien Len</h1>
        <p className="muted">Real-time online card game with KHQR payouts</p>
        <form onSubmit={join} className="stack">
          <input
            autoFocus
            placeholder="Your name"
            maxLength={20}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn primary" disabled={!name.trim()}>Continue</button>
        </form>
      </div>
    </div>
  );
}
