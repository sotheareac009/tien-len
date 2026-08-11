'use client';

// Voice chat between the players at a table, over WebRTC.
//
// A full mesh: with at most four seats that is three connections each, well
// within what a browser handles, and it needs no media server — the audio goes
// straight between browsers. The Socket.IO connection is used only for the
// handshake (offers, answers, ICE candidates), so it works on hosts that will
// not carry a WebSocket, including Hostinger's Cloud plans.
//
// Microphone access needs a secure context: https in production, or localhost.

// STUN is enough for most home connections. Symmetric NAT (some mobile
// networks, strict corporate firewalls) needs a TURN relay — set the three
// NEXT_PUBLIC_TURN_* variables to point at one, and it is used automatically.
function iceServers() {
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const turn = process.env.NEXT_PUBLIC_TURN_URL;
  if (turn) {
    servers.push({
      urls: turn,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
  }
  return servers;
}

// Opus defaults to a thin, low-bitrate mode aimed at bad networks. Four people
// round a card game are on wifi, and the extra bandwidth is trivial (~64kbps
// each), so ask for something that actually sounds like a voice:
//   maxaveragebitrate — headroom for clarity, up from Opus's ~24-32kbps default
//   useinbandfec      — rebuild lost packets instead of glitching
//   usedtx=0          — do not cut the signal in pauses, which sounds choppy
//   stereo=0          — one channel; the second only halves the bitrate per ear
const OPUS_FMTP = 'stereo=0;sprop-stereo=0;useinbandfec=1;usedtx=0;maxaveragebitrate=64000';
const MAX_BITRATE = 64000;

function tuneOpus(sdp) {
  const pt = sdp.match(/a=rtpmap:(\d+) opus\/48000/i)?.[1];
  if (!pt) return sdp;
  const ours = new Set(OPUS_FMTP.split(';').map((kv) => kv.split('=')[0]));
  const fmtp = new RegExp(`a=fmtp:${pt} (.*)`);
  if (!fmtp.test(sdp)) {
    return sdp.replace(
      new RegExp(`(a=rtpmap:${pt} opus/48000.*\r\n)`),
      `$1a=fmtp:${pt} ${OPUS_FMTP}\r\n`
    );
  }
  // Drop any key we are about to set, so the line never carries the same
  // parameter twice — some stacks reject that outright.
  return sdp.replace(fmtp, (_m, params) => {
    const kept = params
      .split(';')
      .filter((kv) => kv && !ours.has(kv.split('=')[0]));
    return `a=fmtp:${pt} ${[...kept, OPUS_FMTP].join(';')}`;
  });
}

// The SDP sets the codec's ambitions; this lifts the cap the browser applies
// to what it actually sends.
async function tuneSender(pc) {
  const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
  if (!sender) return;
  try {
    const params = sender.getParameters();
    params.encodings = params.encodings?.length ? params.encodings : [{}];
    params.encodings[0].maxBitrate = MAX_BITRATE;
    params.encodings[0].networkPriority = 'high';
    params.encodings[0].priority = 'high';
    await sender.setParameters(params);
  } catch {
    // Older browsers reject some of these fields; the SDP settings still apply.
  }
}

export function createVoiceChat({ socket, selfId, onChange }) {
  const peers = new Map();   // seatId -> { pc, stream }
  let localStream = null;
  let active = false;
  let micMuted = false;

  const emitChange = () =>
    onChange?.({
      active,
      micMuted,
      streams: new Map([...peers].filter(([, p]) => p.stream).map(([id, p]) => [id, p.stream])),
    });

  // Both sides would otherwise offer at once and glare. The lower seat id
  // always makes the call; the other waits for it.
  const isCaller = (peerId) => String(selfId) < String(peerId);

  function connection(peerId) {
    if (peers.has(peerId)) return peers.get(peerId);

    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const entry = { pc, stream: null };
    peers.set(peerId, entry);

    for (const track of localStream?.getTracks() || []) pc.addTrack(track, localStream);

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('voice:signal', { to: peerId, data: { candidate: e.candidate } });
    };
    pc.ontrack = (e) => {
      entry.stream = e.streams[0];
      emitChange();
    };
    pc.onconnectionstatechange = () => {
      console.info(`[voice] ${peerId}: ${pc.connectionState}`);
      if (['failed', 'closed'].includes(pc.connectionState)) drop(peerId);
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        console.warn(
          `[voice] ${peerId}: ICE failed — this network needs a TURN relay ` +
            '(set NEXT_PUBLIC_TURN_URL)'
        );
      }
    };
    return entry;
  }

  async function call(peerId) {
    const { pc } = connection(peerId);
    const offer = await pc.createOffer();
    offer.sdp = tuneOpus(offer.sdp);
    await pc.setLocalDescription(offer);
    await tuneSender(pc);
    socket.emit('voice:signal', { to: peerId, data: { sdp: pc.localDescription } });
  }

  async function onSignal({ from, data }) {
    if (!active || !from) return;
    const { pc } = connection(from);
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        if (data.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          answer.sdp = tuneOpus(answer.sdp);
          await pc.setLocalDescription(answer);
          await tuneSender(pc);
          socket.emit('voice:signal', { to: from, data: { sdp: pc.localDescription } });
        }
      } else if (data.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    } catch {
      // A candidate arriving before its description is normal; the connection
      // recovers on the next one.
    }
  }

  function onPeerJoined({ id }) {
    if (!active || id === selfId) return;
    if (isCaller(id)) call(id);
    else connection(id); // be ready for their offer
  }

  function drop(peerId) {
    const entry = peers.get(peerId);
    if (!entry) return;
    try { entry.pc.close(); } catch {}
    peers.delete(peerId);
    emitChange();
  }

  const onPeerLeft = ({ id }) => drop(id);
  socket.on('voice:signal', onSignal);
  socket.on('voice:peer-joined', onPeerJoined);
  socket.on('voice:peer-left', onPeerLeft);

  return {
    async start() {
      if (active) return;
      // Ask for voice-shaped audio: the processing matters more than fidelity
      // when four people are talking over a card game.
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,   // essential when anyone plays through speakers
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,          // voice is mono; the second channel is waste
          sampleRate: 48000,        // match Opus, avoiding a resample
        },
        video: false,
      });
      active = true;
      micMuted = false;
      emitChange();

      // Wait for the server to accept before claiming to be live: without
      // this, a server that has no voice handler leaves the button showing
      // "On" while nobody can hear a thing.
      const res = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ error: 'timeout' }), 5000);
        socket.emit('voice:join', {}, (r) => {
          clearTimeout(timer);
          resolve(r || { error: 'no response' });
        });
      });
      if (res.error) {
        this.stop();
        throw new Error('unavailable');
      }
      // Call everyone already talking; they are waiting for us.
      for (const id of res.peers || []) {
        if (isCaller(id)) call(id);
        else connection(id);
      }
      emitChange();
    },

    stop() {
      active = false;
      socket.emit('voice:leave');
      for (const id of [...peers.keys()]) drop(id);
      for (const track of localStream?.getTracks() || []) track.stop();
      localStream = null;
      emitChange();
    },

    // Muting keeps the connection up and simply stops sending audio, so
    // unmuting is instant and nobody has to renegotiate.
    toggleMic() {
      micMuted = !micMuted;
      for (const track of localStream?.getAudioTracks() || []) track.enabled = !micMuted;
      emitChange();
      return micMuted;
    },

    destroy() {
      this.stop();
      socket.off('voice:signal', onSignal);
      socket.off('voice:peer-joined', onPeerJoined);
      socket.off('voice:peer-left', onPeerLeft);
    },
  };
}