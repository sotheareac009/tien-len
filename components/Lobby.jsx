'use client';

import { useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import { getSocket } from '@/lib/socket-client';
import { formatRiel, toRiel } from '@/lib/points';
import { useWallet } from './useWallet';
import BuyPoints from './BuyPoints';
import Avatar from './Avatar';

export default function Lobby({ me, showToast, onSinglePlayer }) {
  const [code, setCode] = useState('');
  const [buying, setBuying] = useState(false);
  const { status } = useSession();
  const signedIn = status === 'authenticated';
  const [wallet, refreshWallet] = useWallet(signedIn);

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
        <div className="welcome">
          <Avatar name={me.name} image={me.image} />
          <span className="muted">Welcome, <strong>{me.name}</strong></span>
        </div>

        {signedIn && wallet && (
          <div className="wallet-bar">
            <span className="coins-badge">{wallet.points.toLocaleString()} pt</span>
            <span className="muted">{formatRiel(toRiel(wallet.points))}</span>
            <button className="btn tiny" onClick={() => setBuying(true)}>Buy points</button>
            {wallet.admin && (
              <a className="btn tiny" href="/admin">Admin</a>
            )}
          </div>
        )}

        <div className="stack">
          <button className="btn primary" onClick={onSinglePlayer}>
            🎮 Single player — vs bots, free coins
          </button>

          <div className="divider">or play online for points</div>

          {signedIn ? (
            <>
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
              <button className="btn ghost" onClick={() => signOut()}>Sign out</button>
            </>
          ) : (
            // Online seats hold real points, so they need an account to belong to.
            <>
              <p className="hint">
                Online rooms play for points bought with riel, so they need a Google
                account. Single player stays free for guests.
              </p>
              <button className="btn google" onClick={() => signIn('google')}>
                Sign in with Google to play online
              </button>
            </>
          )}
        </div>
      </div>

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