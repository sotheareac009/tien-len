'use client';

import { useState } from 'react';
import { getSocket } from '@/lib/socket-client';

export default function Lobby({ me, showToast, onSinglePlayer }) {
  const [code, setCode] = useState('');

  const createRoom = () => {
    getSocket().emit('room:create', {}, (res) => {
      if (res?.error) showToast(res.error);
    });
  };

  const joinRoom = (e) => {
    e.preventDefault();
    getSocket().emit('room:join', { code }, (res) => {
      if (res?.error) showToast(res.error);
    });
  };

  return (
    <div className="center-screen">
      <div className="panel">
        <h1 className="logo">🂡 Tien Len</h1>
        <p className="muted">Welcome, <strong>{me.name}</strong></p>
        <div className="stack">
          <button className="btn primary" onClick={onSinglePlayer}>
            🎮 Single player — vs bots, free coins
          </button>
          <div className="divider">or play online with KHQR stakes</div>
          <button className="btn primary" onClick={createRoom}>Create a room</button>
          <div className="divider">or</div>
          <form onSubmit={joinRoom} className="row">
            <input
              placeholder="Room code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={5}
              style={{ textTransform: 'uppercase' }}
            />
            <button className="btn" disabled={code.trim().length < 5}>Join</button>
          </form>
        </div>
      </div>
    </div>
  );
}
