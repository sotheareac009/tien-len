'use client';

import { useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket-client';
import { createVoiceChat } from '@/lib/voice';

// Mic controls plus the hidden audio elements that play everyone else.
// Dropped into both the room and the table, so a conversation survives the
// switch between them.
export default function VoiceChat({ room, showToast, floating }) {
  const [state, setState] = useState({ active: false, micMuted: false, streams: new Map() });
  const [busy, setBusy] = useState(false);
  // Listening controls are purely local: deafening yourself or muting one
  // player changes nothing for anyone else, and never stops your own mic.
  const [deafened, setDeafened] = useState(false);
  const [mutedPeers, setMutedPeers] = useState(() => new Set());
  const voiceRef = useRef(null);
  const audiosRef = useRef(new Map());

  useEffect(() => {
    const chat = createVoiceChat({
      socket: getSocket(),
      selfId: room.you,
      onChange: setState,
    });
    voiceRef.current = chat;
    return () => chat.destroy();
    // Rebuilt only if the seat changes — a reconnect keeps the same seat id.
  }, [room.you]);

  // Attach each remote stream to its own audio element, and keep the mute
  // flags in step. Done imperatively because srcObject cannot be set in JSX.
  useEffect(() => {
    for (const [id, stream] of state.streams) {
      const el = audiosRef.current.get(id);
      if (!el) continue;
      if (el.srcObject !== stream) el.srcObject = stream;
      el.muted = deafened || mutedPeers.has(id);
    }
  }, [state.streams, deafened, mutedPeers]);

  const togglePeer = (id) =>
    setMutedPeers((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggle = async () => {
    const chat = voiceRef.current;
    if (!chat) return;
    if (state.active) return chat.stop();
    setBusy(true);
    try {
      await chat.start();
    } catch (err) {
      // Denied permission, no microphone, or an insecure origin.
      showToast?.(
        err?.name === 'NotAllowedError'
          ? 'Microphone blocked — allow it in your browser settings'
          : err?.message === 'unavailable'
            ? 'Voice chat is unavailable — the server did not accept the request'
            : 'Could not open your microphone'
      );
    } finally {
      setBusy(false);
    }
  };

  const talking = room.players.filter((p) => p.voice && p.id !== room.you);

  return (
    <div className={`voice-controls ${floating ? 'floating' : ''}`}>
      <button
        className={`btn tiny ${state.active ? 'primary' : ''}`}
        onClick={toggle}
        disabled={busy}
        title={state.active ? 'Leave voice chat' : 'Talk to the table'}
      >
        {busy ? '…' : state.active ? '🎙 On' : '🎙 Voice'}
      </button>

      {state.active && (
        <button
          className="btn tiny"
          onClick={() => voiceRef.current?.toggleMic()}
          title={state.micMuted ? 'Unmute your microphone' : 'Mute your microphone'}
        >
          {state.micMuted ? '🔇 Muted' : '🎤 Live'}
        </button>
      )}

      {state.active && (
        <button
          className="btn tiny"
          onClick={() => setDeafened((d) => !d)}
          title={deafened ? 'Turn the table back on' : 'Stop hearing everyone'}
        >
          {deafened ? '🔇 Deafened' : '🔊 Hearing'}
        </button>
      )}

      {/* Mute one person without leaving voice or muting the rest. */}
      {state.active && talking.map((p) => (
        <button
          key={p.id}
          className="btn tiny"
          onClick={() => togglePeer(p.id)}
          title={mutedPeers.has(p.id) ? `Unmute ${p.name}` : `Mute ${p.name}`}
        >
          {mutedPeers.has(p.id) ? '🔇' : '🔊'} {p.name.split(' ')[0]}
        </button>
      ))}

      {state.active && talking.length === 0 && (
        <span className="muted">Nobody else has joined voice yet</span>
      )}

      {[...state.streams.keys()].map((id) => (
        <audio
          key={id}
          autoPlay
          playsInline
          muted={deafened || mutedPeers.has(id)}
          ref={(el) => {
            if (el) audiosRef.current.set(id, el);
            else audiosRef.current.delete(id);
          }}
        />
      ))}
    </div>
  );
}