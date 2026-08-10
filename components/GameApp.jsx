'use client';

import { useEffect, useState } from 'react';
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

  useEffect(() => {
    const socket = getSocket();
    const onConnect = () => setConnected(true);
    const onDisconnect = () => {
      // Socket id is the player identity — a drop means rejoining fresh.
      setConnected(false);
      setMe(null);
      setRoom(null);
    };
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
      {!connected && <div className="connect-banner">Connecting to server…</div>}
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
