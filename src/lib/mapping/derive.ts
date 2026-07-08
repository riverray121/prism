// Client-side derivation engine: threshold a continuous envelope into events
// (peak-pick) or segments (hysteresis gate). Deliberately twinned with
// sidecar/features/derive.py — same min-max normalization, cutoff semantics,
// and peak separation — so cutoff sliders re-derive live over envelopes
// already in memory with no sidecar round-trip.

export interface DerivedEvent {
  t: number;
  strength: number; // normalized (0–1) peak height
}

export interface DerivedSegment {
  start: number;
  end: number;
  strength: number; // normalized peak within the segment
}

// Two peaks closer than this collapse into the higher one (sidecar's dense mode).
export const MIN_SEPARATION_SEC = 0.1;
// Segments release at this fraction of the cutoff: once on, the envelope must
// fall clearly below the trigger level to turn off, so wobble around the
// cutoff doesn't shred one sustained hit into many segments.
export const HYSTERESIS_RELEASE = 0.8;

// Min-max normalize to [0,1]; null for flat/degenerate signals (no derivation).
function normalized(data: ArrayLike<number>): Float64Array | null {
  const n = data.length;
  if (n < 3) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = data[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!(hi - lo > 0)) return null;
  const out = new Float64Array(n);
  const range = hi - lo;
  for (let i = 0; i < n; i++) out[i] = (data[i] - lo) / range;
  return out;
}

// Local maxima indices, plateaus collapsing to their midpoint (find_peaks
// semantics), so a drum roll's distinct crests each count once.
function localMaxima(norm: Float64Array): number[] {
  const peaks: number[] = [];
  let i = 1;
  const last = norm.length - 1;
  while (i < last) {
    if (norm[i] > norm[i - 1]) {
      let j = i;
      while (j < last && norm[j + 1] === norm[i]) j++;
      if (j < last && norm[j + 1] < norm[i])
        peaks.push(Math.floor((i + j) / 2));
      i = j + 1;
    } else {
      i++;
    }
  }
  return peaks;
}

// Enforce minimum separation, keeping higher peaks first (find_peaks distance).
function spaced(
  peaks: number[],
  norm: Float64Array,
  distance: number,
): number[] {
  const byHeight = [...peaks].sort((a, b) => norm[b] - norm[a]);
  const kept: number[] = [];
  for (const p of byHeight) {
    if (kept.every((k) => Math.abs(k - p) >= distance)) kept.push(p);
  }
  return kept.sort((a, b) => a - b);
}

// Peak-pick: local maxima at or above the cutoff, min separation apart.
// Distinct hits survive even when the envelope stays high between them.
export function deriveEvents(
  data: ArrayLike<number>,
  frameRateHz: number,
  cutoff: number,
): DerivedEvent[] {
  const norm = normalized(data);
  if (!norm) return [];
  const distance = Math.max(1, Math.round(MIN_SEPARATION_SEC * frameRateHz));
  const peaks = spaced(
    localMaxima(norm).filter((i) => norm[i] >= cutoff),
    norm,
    distance,
  );
  return peaks.map((i) => ({ t: i / frameRateHz, strength: norm[i] }));
}

// Hysteresis gate: on at cutoff, off below cutoff × HYSTERESIS_RELEASE.
// The rising edge is the onset; the segment length is the duration.
export function deriveSegments(
  data: ArrayLike<number>,
  frameRateHz: number,
  cutoff: number,
): DerivedSegment[] {
  const norm = normalized(data);
  if (!norm) return [];
  const release = cutoff * HYSTERESIS_RELEASE;
  const segments: DerivedSegment[] = [];
  let start = -1;
  let peak = 0;
  for (let i = 0; i < norm.length; i++) {
    if (start < 0) {
      if (norm[i] >= cutoff) {
        start = i;
        peak = norm[i];
      }
    } else if (norm[i] < release) {
      segments.push({
        start: start / frameRateHz,
        end: i / frameRateHz,
        strength: peak,
      });
      start = -1;
    } else if (norm[i] > peak) {
      peak = norm[i];
    }
  }
  // A segment still open at the end of the track closes at the last frame.
  if (start >= 0) {
    segments.push({
      start: start / frameRateHz,
      end: (norm.length - 1) / frameRateHz,
      strength: peak,
    });
  }
  return segments;
}
