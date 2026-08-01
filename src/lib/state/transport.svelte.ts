import { convertFileSrc } from "@tauri-apps/api/core";

import type { FollowMode, Win } from "$lib/graphs/axis";

// Global playback transport: one clock for the whole app. Playback uses the
// Web Audio API — files decode into AudioBuffers played through an
// AudioBufferSourceNode, and the playhead derives from AudioContext.currentTime
// (the clock that generates the sound), so audio and playhead can never drift.
// Components read `transport` and call the actions; no component owns audio.

export const transport = $state<{
  currentTime: number;
  playing: boolean;
  // Which audio source is audible: "mix" (the original) or a stem, keyed
  // `${engine}::${stem}` / `${engine}::${stem}::${substem}`. All graphs share
  // one playhead regardless of the source.
  activeKey: string;
  // Duration of the audible buffer (fallback: song metadata) — drives the
  // time display and scrub clamping.
  durationSec: number;
  // Playback speed multiplier (1 = normal). Rate changes pitch too — this is
  // resampling, not time-stretching.
  rate: number;
  // Surfaced when playback fails, so errors are visible instead of silent
  // (e.g. a missing stem file or a decode failure).
  error: string | null;
}>({
  currentTime: 0,
  playing: false,
  activeKey: "mix",
  durationSec: 0,
  rate: 1,
  error: null,
});

// Shared x-window over every synced lane: zoom/pan anywhere moves all lanes
// together. `null` = full extent (not zoomed). Overview lanes opt out by not
// subscribing. Lives here so the window survives tab switches.
export const view = $state<{
  window: Win | null;
  followMode: FollowMode;
}>({
  window: null,
  followMode: "center",
});

// Windows arrive once per lane per interaction tick; equal-value writes are
// dropped so one gesture doesn't cascade into redundant redraws.
export function setViewWindow(win: Win | null): void {
  const cur = view.window;
  if (cur === null && win === null) return;
  if (
    cur !== null &&
    win !== null &&
    Math.abs(cur.min - win.min) < 1e-9 &&
    Math.abs(cur.max - win.max) < 1e-9
  ) {
    return;
  }
  view.window = win;
}

export function setFollowMode(mode: FollowMode): void {
  view.followMode = mode;
}

// NOTE: every synced lane passes the same 8 sync props (playheadSec, follow,
// window, followMode + the four callbacks) explicitly at its call site. Do NOT
// bundle them into a spread object: reading a prop that arrives via a spread
// re-invokes the whole spread expression, so every lane effect would depend on
// transport.currentTime and re-run at tick rate — which visibly lags playback.

let ctx: AudioContext | undefined;
let source: AudioBufferSourceNode | undefined;
let startCtxTime = 0; // ctx.currentTime when the current source started
let startOffset = 0; // buffer offset the current source started from
let startRate = 1; // playback rate the current source started with
let raf: number | null = null;
let activeBuffer: AudioBuffer | null = null;
// Decoded buffers cached by file path, so switching sources doesn't re-decode.
let buffers = new Map<string, AudioBuffer>();
// Bumped on each song change to abandon decodes still in flight.
let loadToken = 0;
// Song-metadata duration, used until a buffer is decoded.
let fallbackDuration = 0;
// File path of the audible source, so scrub-resume can restart it.
let activePath: string | null = null;

function ensureCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

// Decode a file to an AudioBuffer, caching by path. Writes land in the cache
// captured at entry, so a decode that outlives a song reset cannot pollute the
// new song's cache.
async function loadBuffer(path: string): Promise<AudioBuffer> {
  const cache = buffers;
  const cached = cache.get(path);
  if (cached) return cached;
  const resp = await fetch(convertFileSrc(path));
  const bytes = await resp.arrayBuffer();
  const decoded = await ensureCtx().decodeAudioData(bytes);
  cache.set(path, decoded);
  return decoded;
}

function duration(): number {
  return activeBuffer?.duration ?? fallbackDuration;
}

// The audible buffer and the published duration change together; going through
// one setter keeps the TopBar clock and scrub clamp from ever reading stale.
function setActiveBuffer(buf: AudioBuffer | null) {
  activeBuffer = buf;
  transport.durationSec = duration();
}

// Current playback position from the audio clock while playing, else the held
// position. Elapsed wall time maps to buffer time through the playback rate.
function positionNow(): number {
  if (!ctx || !transport.playing) return transport.currentTime;
  return Math.min(
    startOffset + (ctx.currentTime - startCtxTime) * startRate,
    duration(),
  );
}

function startSource(offset: number) {
  const context = ensureCtx();
  const node = context.createBufferSource();
  node.buffer = activeBuffer;
  node.playbackRate.value = transport.rate;
  node.connect(context.destination);
  node.onended = onSourceEnded;
  startOffset = offset;
  startCtxTime = context.currentTime;
  startRate = transport.rate;
  node.start(0, offset);
  source = node;
}

function stopSource() {
  if (!source) return;
  source.onended = null;
  try {
    source.stop();
  } catch {
    // already stopped
  }
  source.disconnect();
  source = undefined;
}

function cancelRaf() {
  if (raf !== null) {
    cancelAnimationFrame(raf);
    raf = null;
  }
}

// Fires when a source finishes on its own (reached the end).
function onSourceEnded() {
  stopSource();
  cancelRaf();
  transport.playing = false;
  transport.currentTime = 0;
}

function tick() {
  transport.currentTime = positionNow();
  if (transport.currentTime >= duration()) {
    onSourceEnded();
    return;
  }
  raf = requestAnimationFrame(tick);
}

// Serial number of the latest play/pause intent. A play whose decode loses a
// race — to a newer play, a pause, or a song reset — must not touch playback
// state on either its success or failure path.
let playSeq = 0;

// Play a source (mix or stem) from the current playhead, switching the active
// buffer first. The playhead is preserved across switches, so soloing a stem
// mid-playback keeps it aligned to the graphs.
async function playKey(key: string, path: string | null) {
  if (!path) {
    transport.error = `No audio path for "${key}".`;
    return;
  }
  const token = loadToken;
  const seq = ++playSeq;
  try {
    const context = ensureCtx();
    await context.resume();
    const buf = await loadBuffer(path);
    if (token !== loadToken || seq !== playSeq) return; // superseded mid-decode
    stopSource();
    cancelRaf();
    transport.activeKey = key;
    activePath = path;
    setActiveBuffer(buf);
    if (transport.currentTime >= duration()) transport.currentTime = 0;
    startSource(transport.currentTime);
    transport.playing = true;
    transport.error = null;
    tick();
  } catch (e) {
    if (token !== loadToken || seq !== playSeq) return; // superseded mid-decode
    transport.playing = false;
    transport.error = `Playback failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

function pause() {
  playSeq++; // a pending play must not undo this pause when it resolves
  transport.currentTime = positionNow();
  stopSource();
  cancelRaf();
  transport.playing = false;
}

// Toggle playback of a specific source: pause if it's the one playing, else
// (re)start it — which also switches the audible source. The caller resolves
// the key to its file path (path resolution is inspection-domain).
export function toggleSource(key: string, path: string | null): void {
  if (transport.playing && transport.activeKey === key) pause();
  else void playKey(key, path);
}

// Scrubbing: while dragging, audio is silenced (no per-move source restarts,
// which would pop) and only the playhead moves; playback resumes from the
// final position on release if it was playing beforehand. The resume replays
// the active key from its last-known path (cached buffer, no re-resolve).
let resumeAfterScrub = false;

export function scrubStart(): void {
  resumeAfterScrub = transport.playing;
  if (transport.playing) pause();
}

export function scrub(sec: number): void {
  transport.currentTime = Math.max(0, Math.min(duration(), sec));
}

export function scrubEnd(): void {
  if (resumeAfterScrub) void playKey(transport.activeKey, activePath);
  resumeAfterScrub = false;
}

// Change playback speed; a playing source restarts at the current position so
// the new rate (and the playhead math) take effect immediately.
export function setRate(rate: number): void {
  transport.rate = rate;
  if (!transport.playing) return;
  transport.currentTime = positionNow();
  stopSource();
  startSource(transport.currentTime);
}

// Switch the audible source without disturbing the playhead: seamless swap
// while playing, or just re-target while paused (buffer resolves lazily).
export function switchSource(key: string, path: string | null): void {
  if (transport.playing) {
    void playKey(key, path);
    return;
  }
  const seq = ++playSeq;
  const token = loadToken;
  transport.activeKey = key;
  activePath = path;
  if (!path) return;
  void (async () => {
    try {
      const buf = await loadBuffer(path);
      if (token !== loadToken || seq !== playSeq) return;
      setActiveBuffer(buf);
    } catch {
      // Lazy retarget is best-effort; a real play attempt surfaces the error.
    }
  })();
}

// Reset for a song change: stop audio, drop caches, abandon in-flight decodes,
// and pre-decode the new song's mix (null path = no song). Called from the
// inspection state on open/close and from the profile event handler.
export function resetForSong(
  path: string | null,
  songDurationSec: number,
): void {
  loadToken++;
  playSeq++;
  resumeAfterScrub = false;
  stopSource();
  cancelRaf();
  transport.playing = false;
  transport.currentTime = 0;
  transport.activeKey = "mix";
  transport.error = null;
  view.window = null; // a new song has its own time extent
  activePath = path;
  buffers = new Map();
  fallbackDuration = songDurationSec;
  setActiveBuffer(null);
  if (!path) return;
  const token = loadToken;
  void (async () => {
    try {
      const buf = await loadBuffer(path);
      // Only adopt the pre-decoded mix if it is still the active source; a stem
      // soloed before this resolves must keep its own buffer.
      if (token === loadToken && transport.activeKey === "mix") {
        setActiveBuffer(buf);
      }
    } catch {
      // Pre-decode is opportunistic; a real play attempt surfaces the error.
    }
  })();
}
