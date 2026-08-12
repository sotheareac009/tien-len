'use client';

// Sound effects, synthesised with the Web Audio API rather than shipped as
// audio files — no assets to load, nothing to cache, and it works offline.
//
// Browsers refuse to start audio before the user has interacted with the page.
// The context is therefore created lazily and resumed on demand: by the time a
// bomb goes off, the player has already clicked something.

const MUTE_KEY = 'tienlen-muted';

// Drop your own audio into public/sounds/ and it is used instead of the
// synthesised effect — no code change needed:
//
//   public/sounds/chop.mp3    played when a bomb chops
//   public/sounds/catch.mp3   played on the catch-the-2 reveal
//
// Anything a browser can play works (.mp3, .ogg, .wav); keep them short and
// under ~100KB so they start instantly. Missing files fall back to the
// synthesised version, so you can add one, both or neither.
const FILES = {
  card: '/sounds/card.mp3',
  chop: '/sounds/chop.mp3',
  catch: '/sounds/catch.mp3',
  penalty: '/sounds/penalty.mp3',
};

// Sounds the operator uploaded in /admin take priority over the files above,
// which in turn take priority over the synthesised effects. Fetched once per
// page load; a failure just leaves the fallbacks in place.
let operatorSounds = null;
let asked = false;

export function loadOperatorSounds() {
  if (asked || typeof window === 'undefined') return;
  asked = true;
  fetch('/api/sounds')
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data) return;
      operatorSounds = data;
      // An operator sound is known to exist, so skip the file probe entirely.
      for (const kind of ['card', 'chop', 'catch', 'penalty']) if (data[kind]) available.set(kind, true);
    })
    .catch(() => {});
}

const urlFor = (name) => operatorSounds?.[name] || FILES[name];

// null = not checked yet, true/false = whether the file exists.
const available = new Map();

function probe(name) {
  if (available.has(name)) return;
  available.set(name, null);
  fetch(urlFor(name), { method: 'HEAD' })
    .then((r) => available.set(name, r.ok))
    .catch(() => available.set(name, false));
}

// Returns true if a custom file handled it. A fresh element per play means
// overlapping chops layer instead of cutting each other off.
function playFile(name, volume = 0.9) {
  if (operatorSounds?.[name] === 'off') return true; // silenced: handled, plays nothing
  if (available.get(name) !== true) {
    probe(name);
    return false;
  }
  try {
    const el = new Audio(urlFor(name));
    el.volume = volume;
    el.play().catch(() => available.set(name, false));
    return true;
  } catch {
    available.set(name, false);
    return false;
  }
}

let ctx = null;

// Set only while auditioning a sound from the operator console, so a preview
// is audible even to someone who has muted the game.
let forcePlay = false;

// An effect the operator switched off entirely, rather than replaced.
export const isSilenced = (kind) => operatorSounds?.[kind] === 'off';

export function isMuted() {
  if (forcePlay) return false;
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(MUTE_KEY) === '1';
}

export function setMuted(muted) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
}

function audio() {
  if (typeof window === 'undefined' || isMuted()) return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!ctx) ctx = new Ctx();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// White noise, shaped by an envelope — the body of an explosion.
function noiseBurst(ac, { duration, gain, from, to, when = 0 }) {
  const frames = Math.floor(ac.sampleRate * duration);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  const src = ac.createBufferSource();
  src.buffer = buffer;

  // Sweeping the filter down turns a hiss into a receding boom.
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(from, ac.currentTime + when);
  filter.frequency.exponentialRampToValueAtTime(to, ac.currentTime + when + duration);

  const env = ac.createGain();
  env.gain.setValueAtTime(gain, ac.currentTime + when);
  env.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + when + duration);

  src.connect(filter).connect(env).connect(ac.destination);
  src.start(ac.currentTime + when);
  src.stop(ac.currentTime + when + duration);
}

// A sine dropping in pitch — the thump you feel rather than hear.
function thump(ac, { from, to, duration, gain, when = 0 }) {
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(from, ac.currentTime + when);
  osc.frequency.exponentialRampToValueAtTime(to, ac.currentTime + when + duration);

  const env = ac.createGain();
  env.gain.setValueAtTime(gain, ac.currentTime + when);
  env.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + when + duration);

  osc.connect(env).connect(ac.destination);
  osc.start(ac.currentTime + when);
  osc.stop(ac.currentTime + when + duration);
}

// A chop. Bigger chops in the chain get a deeper, longer blast, so a ×4
// counter-chop sounds like more than the ×1 that started it.
export function playChop(multiplier = 1) {
  if (isMuted() || isSilenced('chop')) return;
  if (playFile('chop')) return; // your own sound wins
  const ac = audio();
  if (!ac) return;
  const size = Math.min(multiplier, 8);
  const weight = 1 + Math.log2(size) / 2; // 1 → 1.0, 2 → 1.5, 4 → 2.0
  noiseBurst(ac, { duration: 0.45 * weight, gain: 0.35, from: 1800, to: 120 });
  thump(ac, { from: 160 / weight, to: 30, duration: 0.5 * weight, gain: 0.5 });
  // A second, quieter crack a moment later gives it some depth.
  noiseBurst(ac, { duration: 0.25, gain: 0.12, from: 900, to: 200, when: 0.06 });
}

// The catch-the-2 reveal: two quick blips, up for a hit, down for a miss.
export function playCatch(correct) {
  if (isMuted() || isSilenced('catch')) return;
  if (playFile('catch')) return;
  const ac = audio();
  if (!ac) return;
  const [a, b] = correct ? [520, 780] : [520, 320];
  thump(ac, { from: a, to: a, duration: 0.12, gain: 0.25 });
  thump(ac, { from: b, to: b, duration: 0.18, gain: 0.25, when: 0.13 });
}

// Stuck on 13: a falling three-note groan, because somebody just paid double
// without playing a card.
export function playPenalty() {
  if (isMuted() || isSilenced('penalty')) return;
  if (playFile('penalty')) return;
  const ac = audio();
  if (!ac) return;
  [440, 349, 262].forEach((hz, i) => {
    thump(ac, { from: hz, to: hz * 0.94, duration: 0.26, gain: 0.3, when: i * 0.16 });
  });
  // A low tail underneath, so it lands rather than just stops.
  thump(ac, { from: 120, to: 60, duration: 0.7, gain: 0.35, when: 0.32 });
}

// A card landing on felt. Cards are soft: the flick carries mid frequencies,
// not a high click, and the cloth swallows the rest with no ring. The earlier
// version swept from 6kHz, which read as a digital tick rather than a card.
//
// Each play is jittered slightly, because a table where every card lands
// identically sounds like a machine dealing.
export function playCard() {
  if (isMuted() || isSilenced('card')) return;
  if (playFile('card', 0.5)) return;
  const ac = audio();
  if (!ac) return;
  const vary = 0.9 + Math.random() * 0.2; // ±10%
  // The flick of the card through the air, damped quickly.
  noiseBurst(ac, { duration: 0.06 * vary, gain: 0.09, from: 2400 * vary, to: 420 });
  // Felt absorbing the landing — low, short, no tail.
  thump(ac, { from: 185 * vary, to: 85, duration: 0.08 * vary, gain: 0.09, when: 0.012 });
}

// Plays one effect on demand — the operator's file if they set one, otherwise
// the built-in. Ignores the mute setting: you asked to hear it.
export function previewSound(kind) {
  const players = {
    card: () => playCard(),
    chop: () => playChop(2),      // a chain chop, so the scaling is audible
    catch: () => playCatch(true),
    penalty: () => playPenalty(),
  };
  if (!players[kind]) return;
  forcePlay = true;
  try {
    players[kind]();
  } finally {
    // The mute check happens synchronously inside each effect, so clearing it
    // straight away is safe even though the audio itself is still playing.
    forcePlay = false;
  }
}
