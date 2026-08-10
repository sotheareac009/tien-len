'use client';

import { useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket-client';
import NameScreen from './NameScreen';
import Lobby from './Lobby';
import Room from './Room';
import SinglePlayer from './SinglePlayer';

export default function GameApp() {
  const [me, setMe] = useState(null); // { id, name }
  const [room, setRoom] = useState(null);
  const [mode, setMode] = useState(null); // null | 'single'
  const [toast, setToast] = useState(null);
  const [connected, setConnected] = useState(false);
  // Read inside the socket handlers, which are registered once on mount.
  const meRef = useRef(null);
  meRef.current = me;

  useEffect(() => {
    const socket = getSocket();
    const onConnect = () => {
      setConnected(true);
      // Re-claim the seat after a reload or a dropped connection. Seats are
      // keyed on the Google account, not the socket, so this drops the player
      // back into the same hand — the server replies with room:state, or
      // room:left if the table is gone.
      if (!meRef.current) return;
      socket.emit('player:join', { name: meRef.current.name }, (res) => {
        if (res?.error) return;
        setMe({ id: res.id, name: res.name, image: res.image || null });
      });
    };
    // Keep `me` and the room on a drop: the banner shows we are offline, and
    // the seat is held — a round in progress pauses until we are back.
    const onDisconnect = () => setConnected(false);
    const onState = (state) => setRoom(state);
    const onLeft = () => setRoom(null);
    const onToast = (msg) => {
      setToast(msg);
      clearTimeout(onToast._t);
      onToast._t = setTimeout(() => setToast(null), 3500);
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', onState);
    socket.on('room:left', onLeft);
    socket.on('toast', onToast);
    if (socket.connected) setConnected(true);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', onState);
      socket.off('room:left', onLeft);
      socket.off('toast', onToast);
    };
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  return (
    <div className="app">
      {!connected && (
        <div className="connect-banner">
          {me ? 'Reconnecting — your seat is held and the round is paused…' : 'Connecting to server…'}
        </div>
      )}
      {!me ? (
        <NameScreen onJoined={setMe} showToast={showToast} />
      ) : room ? (
        <Room me={me} room={room} showToast={showToast} />
      ) : mode === 'single' ? (
        <SinglePlayer me={me} onExit={() => setMode(null)} showToast={showToast} />
      ) : (
        <Lobby me={me} showToast={showToast} onSinglePlayer={() => setMode('single')} />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
