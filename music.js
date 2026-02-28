// ─── AMBIENT MUSIC ENGINE ─────────────────────────────────────────────────────
// Procedural lo-fi ambient music using Web Audio API.
// No external files — entirely synthesized in-browser.

let audioCtx = null;
let masterGain = null;
let isPlaying = false;
let scheduleTimer = null;
let currentBeat = 0;
let reverbNode = null;

// ─── SCALES & CHORD PROGRESSIONS ─────────────────────────────────────────────
// C major pentatonic — warm, mellow, universally pleasant
const BASE_FREQ = 261.63; // C4
const PENTATONIC = [0, 2, 4, 7, 9]; // intervals in semitones (C D E G A)

// Lo-fi chord progression: Cmaj7 → Am7 → Fmaj7 → G7
// Expressed as root semitone offsets + chord intervals
const CHORD_PROGRESSION = [
  { root: 0,  intervals: [0, 4, 7, 11] }, // Cmaj7
  { root: 9,  intervals: [0, 3, 7, 10] }, // Am7
  { root: 5,  intervals: [0, 4, 7, 11] }, // Fmaj7
  { root: 7,  intervals: [0, 4, 7, 10] }, // G7
];

const BPM = 72;
const BEAT_S = 60 / BPM;
const BAR_S = BEAT_S * 4;

function midiToFreq(semitones) {
  return BASE_FREQ * Math.pow(2, semitones / 12);
}

// ─── REVERB (convolution approximation with feedback delay) ──────────────────
function createReverb(ctx) {
  const convolver = ctx.createConvolver();
  const length = ctx.sampleRate * 2.5;
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.2);
    }
  }
  convolver.buffer = buffer;
  return convolver;
}

// ─── SOFT PIANO TONE ─────────────────────────────────────────────────────────
function playPianoNote(freq, startTime, duration, gainVal = 0.12) {
  const ctx = audioCtx;

  // Main tone: triangle wave (soft, piano-like)
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, startTime);

  // Subtle second harmonic for warmth
  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(freq * 2, startTime);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, startTime);
  g.gain.linearRampToValueAtTime(gainVal, startTime + 0.015);
  g.gain.setTargetAtTime(gainVal * 0.6, startTime + 0.05, 0.12);
  g.gain.setTargetAtTime(0, startTime + duration * 0.5, duration * 0.35);

  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(gainVal * 0.18, startTime);
  g2.gain.setTargetAtTime(0, startTime + 0.08, 0.06);

  osc.connect(g);
  osc2.connect(g2);

  // Route through reverb
  g.connect(reverbNode);
  g2.connect(reverbNode);
  g.connect(masterGain);

  osc.start(startTime);
  osc2.start(startTime);
  osc.stop(startTime + duration + 0.5);
  osc2.stop(startTime + duration + 0.3);
}

// ─── SOFT PAD ────────────────────────────────────────────────────────────────
function playPad(freq, startTime, duration, gainVal = 0.04) {
  const ctx = audioCtx;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, startTime);

  // Slight detune for lushness
  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(freq * 1.003, startTime);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, startTime);
  g.gain.linearRampToValueAtTime(gainVal, startTime + BAR_S * 0.4);
  g.gain.setTargetAtTime(0, startTime + duration * 0.7, duration * 0.2);

  osc.connect(g);
  osc2.connect(g);
  g.connect(reverbNode);
  g.connect(masterGain);

  osc.start(startTime);
  osc2.start(startTime);
  osc.stop(startTime + duration + 1.2);
  osc2.stop(startTime + duration + 1.2);
}

// ─── BASS NOTE ───────────────────────────────────────────────────────────────
function playBass(freq, startTime, duration, gainVal = 0.09) {
  const ctx = audioCtx;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq / 2, startTime); // one octave down

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, startTime);
  g.gain.linearRampToValueAtTime(gainVal, startTime + 0.04);
  g.gain.setTargetAtTime(gainVal * 0.4, startTime + 0.12, 0.15);
  g.gain.setTargetAtTime(0, startTime + duration * 0.6, duration * 0.3);

  osc.connect(g);
  g.connect(masterGain);

  osc.start(startTime);
  osc.stop(startTime + duration + 0.4);
}

// ─── SUBTLE HI-HAT / TEXTURE ─────────────────────────────────────────────────
function playHiHat(startTime, gainVal = 0.018) {
  const ctx = audioCtx;
  const bufferSize = ctx.sampleRate * 0.08;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 8000;

  const g = ctx.createGain();
  g.gain.setValueAtTime(gainVal, startTime);
  g.gain.setTargetAtTime(0, startTime + 0.01, 0.025);

  source.connect(filter);
  filter.connect(g);
  g.connect(masterGain);
  source.start(startTime);
}

// ─── MELODY GENERATOR ─────────────────────────────────────────────────────────
// Sparse, wandering melody from pentatonic scale
let lastMelodyNote = 0;
function scheduleMelodyNote(startTime, chordIdx) {
  // ~50% chance of playing a melody note on any given beat
  if (Math.random() < 0.5) return;

  const chord = CHORD_PROGRESSION[chordIdx % 4];
  // Pick from chord tones + pentatonic, biased toward chord tones
  const choices = [
    chord.root, chord.root + chord.intervals[1],
    chord.root + chord.intervals[2], chord.root + chord.intervals[3],
    chord.root + 12
  ];

  let semitones = choices[Math.floor(Math.random() * choices.length)];
  // Keep melody in a comfortable upper register
  semitones += 12 + (Math.floor(Math.random() * 2) * 12);

  // Avoid jumping too far from last note
  while (Math.abs(semitones - lastMelodyNote) > 10 && Math.random() < 0.7) {
    semitones = choices[Math.floor(Math.random() * choices.length)] + 12;
  }
  lastMelodyNote = semitones;

  const freq = midiToFreq(semitones);
  const dur = BEAT_S * (Math.random() < 0.3 ? 2 : 1);
  playPianoNote(freq, startTime, dur, 0.07 + Math.random() * 0.04);
}

// ─── BAR SCHEDULER ────────────────────────────────────────────────────────────
let nextBarTime = 0;
let barIndex = 0;

function scheduleBar() {
  if (!isPlaying) return;

  const chordIdx = barIndex % 4;
  const chord = CHORD_PROGRESSION[chordIdx];
  const t = nextBarTime;

  // --- PAD: whole bar sustain (all chord tones) ---
  chord.intervals.forEach((interval, i) => {
    const freq = midiToFreq(chord.root + interval);
    playPad(freq, t, BAR_S, 0.03 + (i === 0 ? 0.01 : 0));
  });

  // --- BASS: on beat 1 ---
  playBass(midiToFreq(chord.root), t, BEAT_S * 1.5);

  // --- PIANO CHORD: arpeggiated on beats 1 & 3 ---
  const arpBeats = [0, 2]; // beat 1 and beat 3
  arpBeats.forEach(beat => {
    const beatTime = t + beat * BEAT_S;
    // Stagger chord tones slightly for arpeggiation
    chord.intervals.forEach((interval, i) => {
      const freq = midiToFreq(chord.root + interval + 12); // one octave up for piano
      const delay = i * 0.04 * (Math.random() * 0.5 + 0.75);
      playPianoNote(freq, beatTime + delay, BEAT_S * 1.8, 0.08);
    });
    // Root bass note on piano too
    playPianoNote(midiToFreq(chord.root + 12), beatTime, BEAT_S * 2, 0.06);
  });

  // --- MELODY: scattered across all 4 beats ---
  for (let beat = 0; beat < 4; beat++) {
    scheduleMelodyNote(t + beat * BEAT_S + Math.random() * 0.05, chordIdx);
  }

  // --- HI-HAT: soft on beats 2 & 4 ---
  [1, 3].forEach(beat => {
    if (Math.random() < 0.6) {
      playHiHat(t + beat * BEAT_S + (Math.random() * 0.03 - 0.015));
    }
  });

  nextBarTime += BAR_S;
  barIndex++;
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────
// Look-ahead scheduler: fire every 500ms, schedule 2 bars ahead
function tick() {
  if (!isPlaying) return;
  const lookAhead = audioCtx.currentTime + BAR_S * 2;
  while (nextBarTime < lookAhead) {
    scheduleBar();
  }
  scheduleTimer = setTimeout(tick, 500);
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────
export function startMusic() {
  if (isPlaying) return;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  masterGain = audioCtx.createGain();
  masterGain.gain.setValueAtTime(0, audioCtx.currentTime);
  masterGain.gain.linearRampToValueAtTime(0.55, audioCtx.currentTime + 3); // fade in
  masterGain.connect(audioCtx.destination);

  reverbNode = createReverb(audioCtx);
  const reverbGain = audioCtx.createGain();
  reverbGain.gain.value = 0.28;
  reverbNode.connect(reverbGain);
  reverbGain.connect(masterGain);

  isPlaying = true;
  nextBarTime = audioCtx.currentTime + 0.1;
  barIndex = 0;
  tick();
}

export function stopMusic() {
  if (!isPlaying) return;
  isPlaying = false;
  clearTimeout(scheduleTimer);
  if (masterGain) {
    masterGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.8);
  }
  setTimeout(() => {
    try { audioCtx?.close(); } catch (e) {}
    audioCtx = null;
    masterGain = null;
    reverbNode = null;
  }, 3000);
}

export function setVolume(v) {
  if (masterGain) {
    masterGain.gain.setTargetAtTime(Math.max(0, Math.min(1, v)) * 0.55, audioCtx.currentTime, 0.3);
  }
}

export function isMusicPlaying() { return isPlaying; }
