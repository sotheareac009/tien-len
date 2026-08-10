'use client';

import { useEffect, useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import { getSocket } from '@/lib/socket-client';

// Sign-in screen. Google accounts are verified server-side from the session
// cookie; guests just pick a display name for this session.
export default function NameScreen({ onJoined, showToast }) {
  const { status } = useSession();
  const [name, setName] = useState('');
  const [guestMode, setGuestMode] = useState(false);

  // Once Google sign-in completes, join automatically — the server reads the
  // real identity from the cookie, so no name is sent.
  useEffect(() => {
    if (status !== 'authenticated') return;
    getSocket().emit('player:join', {}, (res) => {
      // The cookie says signed in but the server would not accept it — an old
      // session from before identities were pinned to the Google account id.
      // Clear it rather than leaving them stuck on a toast.
      if (res?.error || !res?.signedIn) {
        showToast('Your session expired — please sign in again');
        return signOut({ callbackUrl: '/' });
      }
      onJoined({ id: res.id, name: res.name, image: res.image || null });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const joinAsGuest = (e) => {
    e.preventDefault();
    getSocket().emit('player:join', { name }, (res) => {
      if (res?.error) return showToast(res.error);
      onJoined({ id: res.id, name: res.name, image: null });
    });
  };

  return (
    <div className="center-screen">
      <div className="panel">
        <h1 className="logo">🂡 Tien Len</h1>
        <p className="muted">Real-time online card game — play for points, or free vs bots</p>

        {status === 'loading' || status === 'authenticated' ? (
          <p className="muted" style={{ marginTop: 24 }}>
            {status === 'authenticated' ? 'Signing you in…' : 'Loading…'}
          </p>
        ) : guestMode ? (
          <form onSubmit={joinAsGuest} className="stack">
            <input
              autoFocus
              placeholder="Your name"
              maxLength={20}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="btn primary" disabled={!name.trim()}>Play as guest</button>
            <button type="button" className="btn ghost" onClick={() => setGuestMode(false)}>
              Back
            </button>
          </form>
        ) : (
          <div className="stack">
            <button className="btn google" onClick={() => signIn('google')}>
              <GoogleMark /> Sign in with Google
            </button>
            <div className="divider">or</div>
            <button className="btn ghost" onClick={() => setGuestMode(true)}>
              Play as guest
            </button>
            <p className="hint">
              Online rooms play for points and need a Google account. Guests can
              still play single player against bots for free.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.3z" />
      <path fill="#FBBC05" d="M10.4 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.7-3.7-13.6-9.0l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
