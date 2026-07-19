// Pure window math for the shared time axis: zoom, pan, and playhead-follow.
// All functions return new windows clamped to [0, full]; interaction wiring
// lives in TimeAxis.svelte, so this math stays unit-testable.

export interface Win {
  min: number;
  max: number;
}

// How the view tracks the playhead when zoomed and playing:
//   center — keep the playhead centered, scrolling the data under it
//   page   — let the playhead sweep across, jumping the window when it exits
export type FollowMode = "center" | "page";

// Range multiplier per zoom-in step (deltaY < 0).
export const ZOOM_FACTOR = 0.75;

export function clamp(t: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, t));
}

// Normalize wheel deltas to pixels: line (deltaMode 1) and page (deltaMode 2)
// modes report coarse units rather than pixels.
export function wheelDeltaScale(deltaMode: number, pageHeight: number): number {
  return deltaMode === 1 ? 16 : deltaMode === 2 ? pageHeight : 1;
}

// Slide the window by dv seconds, clamped to the data extent.
export function panned(
  min: number,
  max: number,
  full: number,
  dv: number,
): Win {
  const range = max - min;
  let nmin = min + dv;
  let nmax = max + dv;
  if (nmin < 0) {
    nmin = 0;
    nmax = range;
  }
  if (nmax > full) {
    nmax = full;
    nmin = full - range;
  }
  return { min: nmin, max: nmax };
}

// Zoom centered on the cursor. Deltas vary by device (small for pinch, large
// for a mouse notch), so the step is scaled by |deltaY| and capped. The
// multiplier is tuned for trackpad pinches (per-event deltas of 1-10, dozens
// of events per gesture); mouse notches (~120) hit the cap either way.
export function zoomed(
  min: number,
  max: number,
  full: number,
  center: number,
  deltaY: number,
): Win {
  const range = max - min;
  const intensity = Math.min(Math.abs(deltaY) * 0.1, 2);
  const step = Math.pow(ZOOM_FACTOR, intensity);
  const nrange = deltaY < 0 ? range * step : range / step;
  const leftPct = range > 0 ? (center - min) / range : 0.5;
  let nmin = center - leftPct * nrange;
  let nmax = nmin + nrange;
  if (nmax - nmin >= full) {
    return { min: 0, max: full };
  } else if (nmin < 0) {
    nmin = 0;
    nmax = nrange;
  } else if (nmax > full) {
    nmax = full;
    nmin = full - nrange;
  }
  return { min: nmin, max: nmax };
}

// Keep the playhead visible while zoomed: center it when following (playing);
// otherwise only re-center once it has left the view (see FollowMode).
// Returns null when the window should not move.
export function followed(
  min: number,
  max: number,
  full: number,
  playhead: number,
  mode: FollowMode,
  following: boolean,
): Win | null {
  const range = max - min;
  if (range >= full - 1e-6) return null; // not zoomed
  const visible = playhead >= min && playhead <= max;
  if (!following && visible) return null; // paused and in view: leave it alone

  let nmin: number;
  let nmax: number;
  if (mode === "page") {
    if (visible) return null; // sweep until the playhead exits, then page
    nmin = playhead; // bring it to the left edge
    nmax = nmin + range;
  } else {
    nmin = playhead - range / 2; // keep it centered
    nmax = nmin + range;
  }
  if (nmin < 0) {
    nmin = 0;
    nmax = range;
  }
  if (nmax > full) {
    nmax = full;
    nmin = full - range;
  }
  if (Math.abs(nmin - min) < 1e-9 && Math.abs(nmax - max) < 1e-9) return null;
  return { min: nmin, max: nmax };
}
