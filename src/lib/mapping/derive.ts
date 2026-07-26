// Client-side derivation engine: threshold a continuous envelope into events
// (peak-pick) or segments (hysteresis gate). Deliberately twinned with
// sidecar/features/derive.py — same min-max normalization, cutoff semantics,
// and peak separation — so cutoff sliders re-derive live over envelopes
// already in memory with no sidecar round-trip.

import { extent } from "$lib/extent";

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

// Optional band/sensitivity refinements on the threshold primitive.
export interface ThresholdOpts {
  // Upper bound of the considered band (normalized); values above are ignored.
  max?: number;
  // 1 (default) = every qualifying change counts. Lower values demand a
  // bigger swing: events need more peak prominence, segments a deeper dip
  // (wider hysteresis) before re-triggering.
  sensitivity?: number;
}

// Sensitivity 1 reproduces the classic release at 0.8 × cutoff; lower
// sensitivity pushes the release floor down so wobbles merge.
function releaseLevel(cutoff: number, sensitivity: number): number {
  return cutoff * (0.3 + 0.5 * sensitivity);
}

// Min-max normalize to [0,1]; null for flat/degenerate signals (no derivation).
function normalized(data: ArrayLike<number>): Float64Array | null {
  const n = data.length;
  if (n < 3) return null;
  const e = extent(data);
  if (!e || e.hi <= e.lo) return null;
  const out = new Float64Array(n);
  const range = e.hi - e.lo;
  for (let i = 0; i < n; i++) out[i] = (data[i] - e.lo) / range;
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

// Keep only peaks that rise at least `prominence` above the valley since the
// previously kept peak — as sensitivity drops, ripples riding a sustained
// level stop counting as separate hits.
function prominentOnly(
  peaks: number[],
  norm: Float64Array,
  prominence: number,
): number[] {
  const kept: number[] = [];
  let valley = Infinity;
  let from = 0;
  for (const p of peaks) {
    for (let i = from; i <= p; i++) if (norm[i] < valley) valley = norm[i];
    if (norm[p] - valley >= prominence) {
      kept.push(p);
      valley = norm[p]; // the next hit must dip and rise again
    }
    from = p + 1;
  }
  return kept;
}

// Peak-pick: local maxima within [cutoff, max], min separation apart.
// Distinct hits survive even when the envelope stays high between them.
export function deriveEvents(
  data: ArrayLike<number>,
  frameRateHz: number,
  cutoff: number,
  opts: ThresholdOpts = {},
): DerivedEvent[] {
  const norm = normalized(data);
  if (!norm) return [];
  const hi = opts.max ?? 1;
  const prominence = (1 - (opts.sensitivity ?? 1)) * 0.5;
  let peaks = localMaxima(norm).filter(
    (i) => norm[i] >= cutoff && norm[i] <= hi,
  );
  if (prominence > 0) peaks = prominentOnly(peaks, norm, prominence);
  const distance = Math.max(1, Math.round(MIN_SEPARATION_SEC * frameRateHz));
  return spaced(peaks, norm, distance).map((i) => ({
    t: i / frameRateHz,
    strength: norm[i],
  }));
}

// Hysteresis gate: on inside [cutoff, max], off below the release level (or
// above the band). The rising edge is the onset; the segment length is the
// duration.
export function deriveSegments(
  data: ArrayLike<number>,
  frameRateHz: number,
  cutoff: number,
  opts: ThresholdOpts = {},
): DerivedSegment[] {
  const norm = normalized(data);
  if (!norm) return [];
  const hi = opts.max ?? 1;
  const release = releaseLevel(cutoff, opts.sensitivity ?? 1);
  const segments: DerivedSegment[] = [];
  let start = -1;
  let peak = 0;
  for (let i = 0; i < norm.length; i++) {
    if (start < 0) {
      if (norm[i] >= cutoff && norm[i] <= hi) {
        start = i;
        peak = norm[i];
      }
    } else if (norm[i] < release || norm[i] > hi) {
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
