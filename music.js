// ─── MUSIC PLAYER ─────────────────────────────────────────────────────────────
// Two contexts: 'lobby' (atmospheric/ambient) and 'game' (lofi/downtempo beats)
// All streams from SomaFM — reliable HTTPS mp3, no CORS issues.

const TRACKS = {
  lobby: [
    'https://ice6.somafm.com/dronezone-128-mp3',   // Drone Zone: atmospheric textures, minimal beats
    'https://ice2.somafm.com/dronezone-128-mp3',
    'https://ice4.somafm.com/deepspaceone-128-mp3', // Deep Space One: deep ambient fallback
  ],
game: [
  'https://live.amperwave.net/direct/ppm-jazz24mp3-ibc1',  // Jazz24 — primary
  'https://tsfjazz.ice.infomaniak.ch/tsfjazz-high.mp3',    // TSF Jazz — fallback
  'https://east.jazzgroove.com:8003/stream',                // The Jazz Groove — last resort
],
};

const TARGET_VOL = 0.38;
const FADE_IN_MS  = 2500;
const FADE_OUT_MS = 1200;
const FADE_TICK   = 80;

let currentContext = null; // 'lobby' | 'game' | null
let audio = null;
let streamIdx = 0;
let _enabled = true; // user's toggle preference
let fadeTimer = null;

// ─── INTERNAL ────────────────────────────────────────────────────────────────

function clearFade() {
  clearInterval(fadeTimer);
  fadeTimer = null;
}

function fadeIn(el, cb) {
  clearFade();
  el.volume = 0;
  const step = TARGET_VOL / (FADE_IN_MS / FADE_TICK);
  fadeTimer = setInterval(() => {
    el.volume = Math.min(el.volume + step, TARGET_VOL);
    if (el.volume >= TARGET_VOL) { clearFade(); if (cb) cb(); }
  }, FADE_TICK);
}

function fadeOut(el, cb) {
  clearFade();
  const step = el.volume / (FADE_OUT_MS / FADE_TICK);
  fadeTimer = setInterval(() => {
    el.volume = Math.max(el.volume - step, 0);
    if (el.volume <= 0) {
      clearFade();
      el.pause();
      el.src = '';
      if (cb) cb();
    }
  }, FADE_TICK);
}

function buildAudio(context) {
  const streams = TRACKS[context];
  streamIdx = 0;
  const el = new Audio();
  el.preload = 'none';
  el.volume = 0;
  el.src = streams[streamIdx];

  el.addEventListener('error', () => {
    streamIdx = (streamIdx + 1) % streams.length;
    el.src = streams[streamIdx];
    el.load();
    el.play().catch(() => {});
  });

  return el;
}

function startContext(context) {
  if (!_enabled) return;
  if (currentContext === context && audio && !audio.paused) return;

  const doStart = () => {
    currentContext = context;
    audio = buildAudio(context);
    audio.play().then(() => {
      fadeIn(audio);
    }).catch(() => {
      // Autoplay blocked — nothing to do, user must interact first
    });
  };

  if (audio && !audio.paused) {
    // Crossfade: fade out current, then start new
    const old = audio;
    audio = null;
    currentContext = null;
    fadeOut(old, doStart);
  } else {
    if (audio) { audio.pause(); audio.src = ''; }
    doStart();
  }
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/** Call when entering lobby / waiting room */
export function playLobbyMusic() {
  startContext('lobby');
}

/** Call when game starts / player enters game screen */
export function playGameMusic() {
  startContext('game');
}

/** Stop all music (user toggle off) */
export function stopMusic() {
  _enabled = false;
  if (audio && !audio.paused) {
    fadeOut(audio, () => { audio = null; currentContext = null; });
  } else {
    if (audio) { audio.src = ''; audio = null; }
    currentContext = null;
  }
}

/** Resume music in the correct context (user toggle on) */
export function resumeMusic(context) {
  _enabled = true;
  if (context) startContext(context);
}

export function isMusicEnabled() { return _enabled; }
export function getCurrentContext() { return currentContext; }
