// Pure transform kernels over per-frame timelines. The evaluator materializes
// a binding's source and runs its chain through these; each returns a new
// Float32Array on the profile's frame grid.

import { oklchToRgb, PALETTES } from "$lib/color";
import type { DerivedEvent } from "$lib/mapping/derive";

export interface NormalizeOpts {
  min: number | null; // null = the data's own min/max
  max: number | null;
  curve: "linear" | "gamma" | "log";
  gamma: number;
}

// Map a range onto [0,1] with clamping, then shape with a curve. gamma > 1
// darkens the low end; log lifts it (quiet detail stays visible).
export function applyNormalize(
  data: ArrayLike<number>,
  opts: NormalizeOpts,
): Float32Array {
  const n = data.length;
  let lo = opts.min;
  let hi = opts.max;
  if (lo === null || hi === null) {
    let dlo = Infinity;
    let dhi = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = data[i];
      if (v < dlo) dlo = v;
      if (v > dhi) dhi = v;
    }
    lo = lo ?? dlo;
    hi = hi ?? dhi;
  }
  const range = hi - lo;
  const out = new Float32Array(n);
  const LOG_DENOM = Math.log(10);
  for (let i = 0; i < n; i++) {
    let v = range > 0 ? (data[i] - lo) / range : 0;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    if (opts.curve === "gamma") v = Math.pow(v, opts.gamma);
    else if (opts.curve === "log") v = Math.log1p(9 * v) / LOG_DENOM;
    out[i] = v;
  }
  return out;
}

// Centered moving average — the anti-flicker low-pass for energy → brightness.
export function applySmooth(
  data: ArrayLike<number>,
  windowS: number,
  frameRateHz: number,
): Float32Array {
  const n = data.length;
  const half = Math.max(1, Math.round((windowS * frameRateHz) / 2));
  const out = new Float32Array(n);
  // Prefix sums make the box filter O(n) regardless of window size.
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + data[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n - 1, i + half);
    out[i] = (prefix[b + 1] - prefix[a]) / (b - a + 1);
  }
  return out;
}

export interface EnvelopeOpts {
  attack_s: number;
  hold_s: number;
  decay_s: number;
}

// Fire an attack-hold-decay ramp per event, scaled by its strength; where
// envelopes overlap the loudest wins (max), so a roll reads as sustained.
export function applyEnvelope(
  events: DerivedEvent[],
  opts: EnvelopeOpts,
  frameRateHz: number,
  frameCount: number,
): Float32Array {
  const out = new Float32Array(frameCount);
  const total = opts.attack_s + opts.hold_s + opts.decay_s;
  for (const ev of events) {
    const first = Math.max(0, Math.ceil(ev.t * frameRateHz));
    const last = Math.min(
      frameCount - 1,
      Math.floor((ev.t + total) * frameRateHz),
    );
    for (let i = first; i <= last; i++) {
      const dt = i / frameRateHz - ev.t;
      let v: number;
      if (dt < opts.attack_s) {
        v = opts.attack_s > 0 ? dt / opts.attack_s : 1;
      } else if (dt <= opts.attack_s + opts.hold_s) {
        v = 1;
      } else {
        v =
          opts.decay_s > 0
            ? 1 - (dt - opts.attack_s - opts.hold_s) / opts.decay_s
            : 0;
      }
      const scaled = v * ev.strength;
      if (scaled > out[i]) out[i] = scaled;
    }
  }
  return out;
}

// Which scalar a colormapped color contributes to a channel: hue takes the
// palette hue in degrees; saturation takes normalized chroma; anything else
// (brightness, color_temp) takes perceptual lightness.
export type ColorComponent = "hue" | "saturation" | "lightness";

// Practical ceiling of sRGB chroma, for normalizing chroma to a 0–1 channel.
const MAX_CHROMA = 0.32;

export function applyColormap(
  data: ArrayLike<number>,
  palette: string,
  component: ColorComponent,
): Float32Array {
  const fn = PALETTES[palette] ?? PALETTES.warm_cool;
  const n = data.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const color = fn(data[i]);
    if (component === "hue") out[i] = color.h;
    else if (component === "saturation")
      out[i] = Math.min(1, color.c / MAX_CHROMA);
    else out[i] = color.l;
  }
  return out;
}

// Colormapped RGB per frame — the pixel row consumes full colors, not one
// component (slice 6).
export function colormapRgb(
  data: ArrayLike<number>,
  palette: string,
): Float32Array {
  const fn = PALETTES[palette] ?? PALETTES.warm_cool;
  const n = data.length;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const { r, g, b } = oklchToRgb(fn(data[i]));
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
  return out;
}

// Label → value assignment for the categorical transform: explicit entries
// win; the rest spread evenly over [0,1] in first-seen order, so twelve chord
// roots land on twelve distinct values without hand-mapping.
export function categoricalValues(
  labels: Iterable<string>,
  map: Record<string, number>,
): Map<string, number> {
  const distinct: string[] = [];
  const seen = new Set<string>();
  for (const label of labels) {
    if (!seen.has(label)) {
      seen.add(label);
      distinct.push(label);
    }
  }
  const unmapped = distinct.filter((l) => !(l in map));
  const out = new Map<string, number>();
  for (const label of distinct) {
    if (label in map) {
      out.set(label, map[label]);
    } else {
      const i = unmapped.indexOf(label);
      out.set(label, unmapped.length > 1 ? i / (unmapped.length - 1) : 0);
    }
  }
  return out;
}
