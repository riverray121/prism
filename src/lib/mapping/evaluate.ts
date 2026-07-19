// The evaluator: (profile data, mapping doc) → per-channel timelines on the
// profile's 100 Hz grid. Pure — no state, IPC, or DOM — because this same
// computation is the future cue-file bake; writing a cue file is serializing
// its output. Per-program outputs carry a cache key so edits re-evaluate only
// the touched program.

import { type Oklch, oklchToRgb, PALETTES } from "$lib/color";
import type { Profile } from "$lib/ipc/messages";
import {
  deriveEvents,
  deriveSegments,
  type DerivedEvent,
} from "$lib/mapping/derive";
import type {
  Binding,
  Channel,
  MappingDoc,
  Program,
  TransformStep,
} from "$lib/mapping/schema";
import { resolveFeature, resolveNode } from "$lib/mapping/sources";
import {
  applyColormap,
  applyEnvelope,
  applyNormalize,
  applySmooth,
  categoricalValues,
  type ColorComponent,
  colormapRgb,
} from "$lib/mapping/transforms";

export interface GateSegment {
  start: number;
  end: number;
  strength: number;
}

// The generic fixture's addressable strip.
export const DEFAULT_PIXELS = 60;

// A heatmap sidecar matrix, loaded by the caller (the evaluator stays pure
// and synchronous; .npy loading is async and lives in state).
export interface MatrixData {
  rows: number;
  cols: number;
  data: Float32Array;
}
export type Matrices = Record<string, MatrixData>;

// Per-frame RGB bytes for the pixel strip, frame-major:
// (frame * pixelCount + pixel) * 3.
export interface PixelMatrix {
  pixelCount: number;
  rgb: Uint8ClampedArray;
}

// One program rendered to channel timelines. `gate` null = no gate binding
// (the program is always lit); channels absent = not bound (or muted);
// `pixels` null = no position/motion binding.
export interface ProgramOutput {
  key: string;
  channels: Partial<Record<Channel, Float32Array>>;
  gate: GateSegment[] | null;
  pixels: PixelMatrix | null;
}

// Lit duration of a gate pulse synthesized from a point event.
export const GATE_PULSE_SEC = 0.12;
// Auto-threshold when a continuous source is bound straight to gate.
const GATE_AUTO_CUTOFF = 0.5;

// Point channels the evaluator renders in this slice; position/motion are the
// pixel dimension (slice 6).
const POINT_CHANNELS: Channel[] = [
  "brightness",
  "hue",
  "saturation",
  "color_temp",
  "strobe_rate",
];

// ── Source materialization ──────────────────────────────────────────────────

interface LabeledEvent extends DerivedEvent {
  label: string | null;
}
interface LabeledSegment {
  start: number;
  end: number;
  strength: number;
  label: string;
}

type Materialized =
  | { kind: "continuous"; data: ArrayLike<number> }
  | { kind: "events"; events: LabeledEvent[] }
  | { kind: "segments"; segments: LabeledSegment[] }
  | { kind: "scalar"; value: number | string };

// Resolve a binding source to time-shaped data. Returns null when the path
// doesn't resolve (warn-and-mute — never a hard failure) or the feature kind
// has no point-channel meaning (heatmaps/tags belong to the pixel dimension).
function materialize(
  profile: Profile,
  doc: MappingDoc,
  source: string,
): Materialized | null {
  const derivedRef = source.match(/^derived\.(.+)$/);
  if (derivedRef) {
    const derivation = doc.derivations.find((d) => d.id === derivedRef[1]);
    if (!derivation) return null;
    const feature = resolveFeature(profile, derivation.source);
    if (feature?.render !== "continuous") return null;
    const hz = profile.timeline.frame_rate_hz;
    const { cutoff, max, sensitivity } = derivation.threshold;
    if (derivation.threshold.mode === "events") {
      const events = deriveEvents(feature.data, hz, cutoff, {
        max,
        sensitivity,
      });
      return {
        kind: "events",
        events: events.map((e) => ({ ...e, label: null })),
      };
    }
    const segments = deriveSegments(feature.data, hz, cutoff, {
      max,
      sensitivity,
    });
    return {
      kind: "segments",
      segments: segments.map((s) => ({ ...s, label: "" })),
    };
  }

  const feature = resolveFeature(profile, source);
  if (!feature) return null;
  if (feature.render === "continuous")
    return { kind: "continuous", data: feature.data };
  if (feature.render === "scalar")
    return { kind: "scalar", value: feature.value };
  if (feature.render === "event") {
    return {
      kind: "events",
      events: feature.events.map((e) => {
        const extra = e as Record<string, unknown>;
        return {
          t: e.t,
          strength: typeof extra.strength === "number" ? extra.strength : 1,
          label:
            typeof extra.label === "string"
              ? extra.label
              : typeof extra.root === "string"
                ? extra.root
                : null,
        };
      }),
    };
  }
  if (feature.render === "segment") {
    return {
      kind: "segments",
      segments: feature.segments.map((s) => ({
        start: s.start,
        end: s.end,
        strength: typeof s.confidence === "number" ? s.confidence : 1,
        label: s.label,
      })),
    };
  }
  return null; // heatmap / tags: no point-channel meaning
}

// ── Continuous conversion ───────────────────────────────────────────────────

// Any materialized form as a per-frame track: events become impulses (the
// envelope transform gives them duration), segments become occupancy.
function toContinuous(
  m: Materialized,
  hz: number,
  frameCount: number,
): Float32Array {
  if (m.kind === "continuous") {
    const out = new Float32Array(frameCount);
    const n = Math.min(frameCount, m.data.length);
    for (let i = 0; i < n; i++) out[i] = m.data[i];
    return out;
  }
  const out = new Float32Array(frameCount);
  if (m.kind === "events") {
    for (const ev of m.events) {
      const i = Math.round(ev.t * hz);
      if (i >= 0 && i < frameCount && ev.strength > out[i])
        out[i] = ev.strength;
    }
  } else if (m.kind === "segments") {
    for (const seg of m.segments) {
      const a = Math.max(0, Math.round(seg.start * hz));
      const b = Math.min(frameCount - 1, Math.round(seg.end * hz));
      for (let i = a; i <= b; i++)
        if (seg.strength > out[i]) out[i] = seg.strength;
    }
  } else {
    out.fill(typeof m.value === "number" ? m.value : 0);
  }
  return out;
}

// Step function from labeled events/segments through the categorical map:
// an event's value holds until the next event; a segment's value holds inside
// it (0 outside).
function categoricalTrack(
  m: Materialized,
  map: Record<string, number>,
  hz: number,
  frameCount: number,
): Float32Array {
  const out = new Float32Array(frameCount);
  if (m.kind === "events") {
    const labels = m.events.map((e) => e.label ?? "");
    const values = categoricalValues(labels, map);
    for (let e = 0; e < m.events.length; e++) {
      const from = Math.max(0, Math.round(m.events[e].t * hz));
      const to =
        e + 1 < m.events.length
          ? Math.min(frameCount, Math.round(m.events[e + 1].t * hz))
          : frameCount;
      const v = values.get(m.events[e].label ?? "") ?? 0;
      for (let i = from; i < to; i++) out[i] = v;
    }
  } else if (m.kind === "segments") {
    const values = categoricalValues(
      m.segments.map((s) => s.label),
      map,
    );
    for (const seg of m.segments) {
      const a = Math.max(0, Math.round(seg.start * hz));
      const b = Math.min(frameCount - 1, Math.round(seg.end * hz));
      const v = values.get(seg.label) ?? 0;
      for (let i = a; i <= b; i++) out[i] = v;
    }
  } else if (m.kind === "scalar" && typeof m.value === "string") {
    out.fill(categoricalValues([m.value], map).get(m.value) ?? 0);
  }
  return out;
}

// ── Binding evaluation (continuous point channels) ──────────────────────────

function colorComponentFor(channel: Channel): ColorComponent {
  if (channel === "hue") return "hue";
  if (channel === "saturation") return "saturation";
  return "lightness";
}

// The silent default for continuous → brightness: normalize + smooth.
const DEFAULT_BRIGHTNESS_CHAIN: TransformStep[] = [
  { normalize: { min: null, max: null, curve: "linear", gamma: 2 } },
  { smooth: { window_s: 0.08 } },
];

function evaluateContinuousBinding(
  profile: Profile,
  doc: MappingDoc,
  binding: Binding,
  channel: Channel,
  hz: number,
  frameCount: number,
): Float32Array | null {
  const m = materialize(profile, doc, binding.source);
  if (!m) return null;

  let chain = binding.transform;
  if (
    chain.length === 0 &&
    channel === "brightness" &&
    m.kind === "continuous"
  ) {
    chain = DEFAULT_BRIGHTNESS_CHAIN;
  }

  let form: Materialized = m;
  let track: Float32Array | null = null;
  let hueInDegrees = false; // colormap emits degrees; plain 0-1 data scales ×360

  const ensureTrack = (): Float32Array => {
    if (track === null) track = toContinuous(form, hz, frameCount);
    return track;
  };

  for (const step of chain) {
    if ("envelope" in step) {
      // Envelope shapes point events; on anything already continuous it's a no-op.
      if (track === null && form.kind === "events") {
        track = applyEnvelope(form.events, step.envelope, hz, frameCount);
      }
    } else if ("categorical" in step) {
      if (track === null) {
        track = categoricalTrack(form, step.categorical.map, hz, frameCount);
      }
    } else if ("normalize" in step) {
      track = applyNormalize(ensureTrack(), step.normalize);
    } else if ("smooth" in step) {
      track = applySmooth(ensureTrack(), step.smooth.window_s, hz);
    } else if ("colormap" in step) {
      track = applyColormap(
        ensureTrack(),
        step.colormap.palette,
        colorComponentFor(channel),
      );
      if (channel === "hue") hueInDegrees = true;
    }
  }
  track = ensureTrack();

  // Channel semantics: hue is degrees (0-1 tracks scale up); the other point
  // channels clamp to their 0-1 range (strobe_rate only at 0).
  const out = new Float32Array(track.length);
  for (let i = 0; i < track.length; i++) {
    let v = track[i];
    if (channel === "hue") {
      if (!hueInDegrees) v *= 360;
      v = ((v % 360) + 360) % 360;
    } else if (channel === "strobe_rate") {
      v = Math.max(0, v);
    } else {
      v = v < 0 ? 0 : v > 1 ? 1 : v;
    }
    out[i] = v;
  }
  return out;
}

// ── Gate evaluation ─────────────────────────────────────────────────────────

function evaluateGate(
  profile: Profile,
  doc: MappingDoc,
  value: number | Binding,
  hz: number,
): GateSegment[] | null {
  if (typeof value === "number") return value >= 0.5 ? null : [];
  const m = materialize(profile, doc, value.source);
  if (!m) return null; // muted binding: no gate layer
  if (m.kind === "segments") {
    return m.segments.map((s) => ({
      start: s.start,
      end: s.end,
      strength: s.strength,
    }));
  }
  if (m.kind === "events") {
    // Point events become fixed pulses; an envelope step's span wins if given.
    const env = value.transform.find(
      (s): s is Extract<TransformStep, { envelope: unknown }> =>
        "envelope" in s,
    );
    const pulse = env
      ? env.envelope.attack_s + env.envelope.hold_s + env.envelope.decay_s
      : GATE_PULSE_SEC;
    return m.events.map((e) => ({
      start: e.t,
      end: e.t + pulse,
      strength: e.strength,
    }));
  }
  if (m.kind === "continuous") {
    // Straight continuous → gate: auto hysteresis threshold at mid-range.
    return deriveSegments(m.data, hz, GATE_AUTO_CUTOFF).map((s) => ({
      start: s.start,
      end: s.end,
      strength: s.strength,
    }));
  }
  return typeof m.value === "number" && m.value < 0.5 ? [] : null;
}

// Per-frame lit mask from gate segments (null gate = always lit). Shared by
// the ribbon renderer, the live preview, and the share-mode master.
export function litMask(
  gate: GateSegment[] | null,
  frameCount: number,
  frameRateHz: number,
): Float32Array {
  const mask = new Float32Array(frameCount);
  if (gate === null) {
    mask.fill(1);
    return mask;
  }
  for (const seg of gate) {
    const a = Math.max(0, Math.round(seg.start * frameRateHz));
    const b = Math.min(frameCount - 1, Math.round(seg.end * frameRateHz));
    for (let i = a; i <= b; i++)
      if (seg.strength > mask[i]) mask[i] = seg.strength;
  }
  return mask;
}

// ── Pixel dimension ─────────────────────────────────────────────────────────

// The one color-precedence rule for a program's evaluated point channels:
// hue (+saturation) → color_temp via the warm↔cool palette → neutral
// warm-white; brightness lifts lightness. Shared by the ribbon, the pixel
// row, and the live preview so they can never disagree.
export function channelColor(
  channels: Partial<Record<Channel, Float32Array>>,
  i: number,
): Oklch {
  const b = channels.brightness ? channels.brightness[i] : 1;
  if (channels.hue) {
    return {
      l: 0.5 + 0.42 * b,
      c: (channels.saturation ? channels.saturation[i] : 0.8) * 0.32,
      h: channels.hue[i],
    };
  }
  if (channels.color_temp) {
    const base = PALETTES.warm_cool(channels.color_temp[i]);
    return { l: 0.45 + 0.5 * b, c: base.c, h: base.h };
  }
  return { l: 0.5 + 0.48 * b, c: 0.02, h: 90 };
}

// Motion primitive intensity for one pixel at one instant. `phase` is
// accumulated cycles (the integral of the bound speed), so speed changes
// never make the animation jump. Pure and shared by the evaluator and the
// live preview.
export function motionPhase(
  primitive: "chase" | "sweep" | "pulse",
  pixel: number,
  pixelCount: number,
  phase: number,
  width: number,
): number {
  if (primitive === "pulse") return 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
  const w = Math.max(1e-6, width) * pixelCount;
  let head: number;
  if (primitive === "chase") {
    head = (phase - Math.floor(phase)) * pixelCount;
  } else {
    // Sweep: one cycle = a full there-and-back.
    const x = phase - Math.floor(phase);
    head = (x < 0.5 ? x * 2 : 2 - x * 2) * (pixelCount - 1);
  }
  let dist = Math.abs(pixel - head);
  if (primitive === "chase") dist = Math.min(dist, pixelCount - dist); // ring
  return Math.max(0, 1 - dist / w);
}

// Position → per-frame-per-pixel intensity. The mapping mode follows the
// source's kind: heatmap rows map onto pixels; a band_energy_* source stacks
// all its sibling bands as strip zones (chunky spectrum analyzer); any other
// continuous-ish source becomes a center-out spread (stereo width).
function positionIntensity(
  profile: Profile,
  doc: MappingDoc,
  binding: Binding,
  matrices: Matrices,
  frameCount: number,
  pixelCount: number,
): Float32Array | null {
  const source = binding.source;
  const feature = resolveFeature(profile, source);

  if (feature?.render === "heatmap") {
    const m = matrices[source];
    if (!m) return null; // sidecar not loaded (yet)
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < m.data.length; i++) {
      const v = m.data[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const span = hi - lo || 1;
    const out = new Float32Array(frameCount * pixelCount);
    for (let f = 0; f < frameCount; f++) {
      const c = Math.min(m.cols - 1, f);
      for (let p = 0; p < pixelCount; p++) {
        const r = Math.min(m.rows - 1, Math.floor((p * m.rows) / pixelCount));
        out[f * pixelCount + p] = (m.data[r * m.cols + c] - lo) / span;
      }
    }
    return out;
  }

  const parts = source.split(".");
  if (parts.at(-1)?.startsWith("band_energy")) {
    // Gather every sibling band in profile order; each is its own zone.
    const parent = resolveNode(profile, parts.slice(0, -1).join("."));
    if (typeof parent !== "object" || parent === null) return null;
    const bands: Float32Array[] = [];
    for (const [name, value] of Object.entries(parent)) {
      const f = value as { render?: string; data?: number[] };
      if (
        name.startsWith("band_energy") &&
        f.render === "continuous" &&
        f.data
      ) {
        bands.push(
          applyNormalize(f.data, {
            min: null,
            max: null,
            curve: "linear",
            gamma: 2,
          }),
        );
      }
    }
    if (bands.length === 0) return null;
    const out = new Float32Array(frameCount * pixelCount);
    for (let p = 0; p < pixelCount; p++) {
      const k = Math.min(
        bands.length - 1,
        Math.floor((p * bands.length) / pixelCount),
      );
      const band = bands[k];
      const n = Math.min(frameCount, band.length);
      for (let f = 0; f < n; f++) out[f * pixelCount + p] = band[f];
    }
    return out;
  }

  // Spread: value = how much of the strip is lit, growing from the center.
  const hz = profile.timeline.frame_rate_hz;
  const m = materialize(profile, doc, source);
  if (!m) return null;
  const track = applyNormalize(toContinuous(m, hz, frameCount), {
    min: null,
    max: null,
    curve: "linear",
    gamma: 2,
  });
  const center = (pixelCount - 1) / 2;
  const out = new Float32Array(frameCount * pixelCount);
  for (let f = 0; f < frameCount; f++) {
    const half = (track[f] * pixelCount) / 2;
    if (half <= 0) continue;
    for (let p = 0; p < pixelCount; p++) {
      if (Math.abs(p - center) <= half) out[f * pixelCount + p] = 1;
    }
  }
  return out;
}

// Speed track (cycles/sec) for the motion channel: constants pass through;
// a bpm scalar becomes cycles-per-beat; a continuous source's normalized
// value spans 0–4 cycles/sec.
const MOTION_MAX_SPEED = 4;

function motionSpeedTrack(
  profile: Profile,
  doc: MappingDoc,
  value: number | Binding,
  hz: number,
  frameCount: number,
): Float32Array | null {
  if (typeof value === "number")
    return new Float32Array(frameCount).fill(value);
  const feature = resolveFeature(profile, value.source);
  if (feature?.render === "scalar" && typeof feature.value === "number") {
    const v = feature.unit === "bpm" ? feature.value / 60 : feature.value;
    return new Float32Array(frameCount).fill(v);
  }
  const track = evaluateContinuousBinding(
    profile,
    doc,
    value,
    "motion",
    hz,
    frameCount,
  );
  if (!track) return null;
  for (let i = 0; i < track.length; i++) track[i] *= MOTION_MAX_SPEED;
  return track;
}

// Render the strip: position intensity × motion multiplier, colored by the
// position palette (colormap step, default heat) or — with motion only — by
// the program's own frame color.
function evaluatePixels(
  profile: Profile,
  doc: MappingDoc,
  program: Program,
  channels: Partial<Record<Channel, Float32Array>>,
  matrices: Matrices,
  hz: number,
  frameCount: number,
): PixelMatrix | null {
  const posValue = program.channels.position;
  const motValue = program.channels.motion;
  if (posValue === undefined && motValue === undefined) return null;
  const N = DEFAULT_PIXELS;

  let intensity: Float32Array | null = null;
  let palette = "heat";
  if (posValue !== undefined && typeof posValue === "object") {
    const cm = posValue.transform.find(
      (s): s is Extract<TransformStep, { colormap: unknown }> =>
        "colormap" in s,
    );
    if (cm) palette = cm.colormap.palette;
    intensity = positionIntensity(
      profile,
      doc,
      posValue,
      matrices,
      frameCount,
      N,
    );
  }

  let motion: {
    primitive: "chase" | "sweep" | "pulse";
    width: number;
    phase: Float32Array;
  } | null = null;
  if (motValue !== undefined) {
    const step =
      typeof motValue === "object"
        ? motValue.transform.find(
            (s): s is Extract<TransformStep, { motion: unknown }> =>
              "motion" in s,
          )
        : undefined;
    const speed = motionSpeedTrack(profile, doc, motValue, hz, frameCount);
    if (speed) {
      const phase = new Float32Array(frameCount);
      let acc = 0;
      for (let i = 0; i < frameCount; i++) {
        acc += speed[i] / hz;
        phase[i] = acc;
      }
      motion = {
        primitive: step?.motion.primitive ?? "chase",
        width: step?.motion.width ?? 0.15,
        phase,
      };
    }
  }
  if (!intensity && !motion) return null; // muted or matrix still loading

  // Palette LUT (256 steps) keeps the per-pixel loop allocation-free.
  let lut: Uint8ClampedArray | null = null;
  if (intensity) {
    const ramp = new Float32Array(256);
    for (let i = 0; i < 256; i++) ramp[i] = i / 255;
    const rgbF = colormapRgb(ramp, palette);
    lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < rgbF.length; i++) lut[i] = Math.round(rgbF[i] * 255);
  }

  const rgb = new Uint8ClampedArray(frameCount * N * 3);
  for (let f = 0; f < frameCount; f++) {
    let baseR = 0;
    let baseG = 0;
    let baseB = 0;
    if (!lut) {
      const c = oklchToRgb(channelColor(channels, f));
      baseR = c.r * 255;
      baseG = c.g * 255;
      baseB = c.b * 255;
    }
    for (let p = 0; p < N; p++) {
      let v = intensity ? intensity[f * N + p] : 1;
      if (motion)
        v *= motionPhase(motion.primitive, p, N, motion.phase[f], motion.width);
      const idx = (f * N + p) * 3;
      if (lut) {
        // Zero intensity is "off": black, not the palette's dark end.
        if (v <= 0.02) continue;
        const li = Math.min(255, Math.max(0, Math.round(v * 255))) * 3;
        rgb[idx] = lut[li];
        rgb[idx + 1] = lut[li + 1];
        rgb[idx + 2] = lut[li + 2];
      } else {
        rgb[idx] = baseR * v;
        rgb[idx + 1] = baseG * v;
        rgb[idx + 2] = baseB * v;
      }
    }
  }
  return { pixelCount: N, rgb };
}

// ── Program evaluation ──────────────────────────────────────────────────────

// Cache key: the program definition, every derivation it references, and
// which of its heatmap matrices are loaded — anything else unchanged, the
// previous output is reusable.
export function programKey(
  doc: MappingDoc,
  program: Program,
  matrices: Matrices = {},
): string {
  const derivedIds: string[] = [];
  const loaded: string[] = [];
  for (const value of Object.values(program.channels)) {
    if (typeof value !== "object") continue;
    if (value.source.startsWith("derived."))
      derivedIds.push(value.source.slice("derived.".length));
    if (matrices[value.source]) loaded.push(value.source);
  }
  const derivations = doc.derivations.filter((d) => derivedIds.includes(d.id));
  return JSON.stringify({ program, derivations, loaded });
}

export function evaluateProgram(
  profile: Profile,
  doc: MappingDoc,
  program: Program,
  matrices: Matrices = {},
): ProgramOutput {
  const hz = profile.timeline.frame_rate_hz;
  const frameCount = profile.timeline.frame_count;
  const channels: Partial<Record<Channel, Float32Array>> = {};
  let gate: GateSegment[] | null = null;

  for (const [channel, value] of Object.entries(program.channels) as [
    Channel,
    number | Binding,
  ][]) {
    if (value === undefined) continue;
    if (channel === "gate") {
      gate = evaluateGate(profile, doc, value, hz);
    } else if (POINT_CHANNELS.includes(channel)) {
      if (typeof value === "number") {
        // Constants pass through raw (hue constants are already degrees).
        channels[channel] = new Float32Array(frameCount).fill(value);
      } else {
        const track = evaluateContinuousBinding(
          profile,
          doc,
          value,
          channel,
          hz,
          frameCount,
        );
        if (track) channels[channel] = track; // unresolved source: muted
      }
    }
  }

  const pixels = evaluatePixels(
    profile,
    doc,
    program,
    channels,
    matrices,
    hz,
    frameCount,
  );

  return { key: programKey(doc, program, matrices), channels, gate, pixels };
}

// Evaluate every enabled program, reusing previous outputs whose key still
// matches — editing one program re-evaluates only it.
export function evaluateDoc(
  profile: Profile,
  doc: MappingDoc,
  previous: Record<string, ProgramOutput> = {},
  matrices: Matrices = {},
): Record<string, ProgramOutput> {
  const out: Record<string, ProgramOutput> = {};
  for (const program of doc.programs) {
    if (!program.enabled) continue;
    const key = programKey(doc, program, matrices);
    const prev = previous[program.id];
    out[program.id] =
      prev && prev.key === key
        ? prev
        : evaluateProgram(profile, doc, program, matrices);
  }
  return out;
}

// ── Macro layer ─────────────────────────────────────────────────────────────
// Layering order: program channels → scene enable/scale → adaptive master.
// `share` needs every active program's contribution, which fixes this
// ordering (and couples programs: any raw change re-derives every final).

// Below this, a "total brightness" is silence — the share master goes dark
// instead of amplifying noise.
const SHARE_EPSILON = 1e-3;

// Per-program scene factor per frame: 1 outside preset-labeled sections;
// inside one, the preset's master_scale for enabled programs and 0 for the
// rest. Section boundaries switch exactly at their frame.
function sceneFactors(
  profile: Profile,
  doc: MappingDoc,
  programIds: string[],
  frameCount: number,
  hz: number,
): Record<string, Float32Array> | null {
  const macro = doc.macro;
  if (macro.scenes_from === null) return null;
  const feature = resolveFeature(profile, macro.scenes_from);
  if (feature?.render !== "segment") return null;
  const factors: Record<string, Float32Array> = {};
  for (const id of programIds)
    factors[id] = new Float32Array(frameCount).fill(1);
  let any = false;
  for (const seg of feature.segments) {
    const preset = macro.scenes[seg.label];
    if (!preset) continue;
    any = true;
    const a = Math.max(0, Math.round(seg.start * hz));
    const b = Math.min(frameCount, Math.round(seg.end * hz));
    for (const id of programIds) {
      const factor = preset.programs.includes(id) ? preset.master_scale : 0;
      const track = factors[id];
      for (let i = a; i < b; i++) track[i] = factor;
    }
  }
  return any ? factors : null;
}

// Rolling trailing max via a monotonic deque — O(n) for any window size.
function rollingMax(data: Float32Array, window: number): Float32Array {
  const out = new Float32Array(data.length);
  const deque: number[] = [];
  for (let i = 0; i < data.length; i++) {
    while (deque.length && data[deque[deque.length - 1]] <= data[i])
      deque.pop();
    deque.push(i);
    if (deque[0] <= i - window) deque.shift();
    out[i] = data[deque[0]];
  }
  return out;
}

// The adaptive master track for absolute/windowed modes (share is computed
// from the programs themselves). Null = no master (unbound/unresolved).
function masterTrack(
  profile: Profile,
  doc: MappingDoc,
  frameCount: number,
  hz: number,
): Float32Array | null {
  const master = doc.macro.master;
  if (!master || master.adaptive.mode === "share") return null;
  const m = materialize(profile, doc, master.source);
  if (!m) return null;
  const track = toContinuous(m, hz, frameCount);
  const out = new Float32Array(frameCount);
  if (master.adaptive.mode === "absolute") {
    let hi = 0;
    for (let i = 0; i < frameCount; i++) if (track[i] > hi) hi = track[i];
    if (hi <= 0) return out; // silent song: master fully dark
    for (let i = 0; i < frameCount; i++)
      out[i] = Math.max(0, Math.min(1, track[i] / hi));
    return out;
  }
  const window = Math.max(1, Math.round(master.adaptive.window_s * hz));
  const ref = rollingMax(track, window);
  for (let i = 0; i < frameCount; i++) {
    out[i] =
      ref[i] > SHARE_EPSILON ? Math.max(0, Math.min(1, track[i] / ref[i])) : 0;
  }
  return out;
}

// Cut a gate down to the frames where the scene keeps the program enabled,
// so a scene-muted program reads as "off", not "lit but dark".
function gateWithin(
  gate: GateSegment[] | null,
  enabled: Float32Array,
  hz: number,
): GateSegment[] | null {
  let allOn = true;
  for (let i = 0; i < enabled.length; i++) {
    if (enabled[i] <= 0) {
      allOn = false;
      break;
    }
  }
  if (allOn) return gate;
  const base: GateSegment[] = gate ?? [
    { start: 0, end: (enabled.length - 1) / hz, strength: 1 },
  ];
  const out: GateSegment[] = [];
  for (const seg of base) {
    const a = Math.max(0, Math.round(seg.start * hz));
    const b = Math.min(enabled.length - 1, Math.round(seg.end * hz));
    let runStart = -1;
    for (let i = a; i <= b + 1; i++) {
      const on = i <= b && enabled[i] > 0;
      if (on && runStart < 0) runStart = i;
      if (!on && runStart >= 0) {
        out.push({
          start: runStart / hz,
          end: (i - 1) / hz,
          strength: seg.strength,
        });
        runStart = -1;
      }
    }
  }
  return out;
}

// Apply the macro layer over raw per-program outputs. Identity-preserving:
// with no scenes and no master the raw record is returned as-is, and per-
// program finals are reused when nothing feeding them changed.
export function applyMacro(
  profile: Profile,
  doc: MappingDoc,
  raw: Record<string, ProgramOutput>,
  previous: Record<string, ProgramOutput> = {},
): Record<string, ProgramOutput> {
  const macro = doc.macro;
  const hz = profile.timeline.frame_rate_hz;
  const frameCount = profile.timeline.frame_count;
  const ids = Object.keys(raw);

  const scenes = sceneFactors(profile, doc, ids, frameCount, hz);
  const share = macro.master?.adaptive.mode === "share";
  const master = masterTrack(profile, doc, frameCount, hz);
  if (!scenes && !share && !master) return raw;

  const macroJson = JSON.stringify(macro);
  // Share couples every program's output; its cache key must see all of them.
  const coupling = share ? ids.map((id) => raw[id].key).join("§") : "";

  // Scene-adjusted brightness contribution per program (share denominator).
  const contribution: Record<string, Float32Array> = {};
  for (const id of ids) {
    const output = raw[id];
    const b = new Float32Array(frameCount);
    const brightness = output.channels.brightness ?? null;
    const mask = litMask(output.gate, frameCount, hz);
    const factor = scenes?.[id] ?? null;
    for (let i = 0; i < frameCount; i++) {
      b[i] =
        (brightness ? brightness[i] : 1) * mask[i] * (factor ? factor[i] : 1);
    }
    contribution[id] = b;
  }
  let total: Float32Array | null = null;
  if (share) {
    total = new Float32Array(frameCount);
    for (const id of ids) {
      const c = contribution[id];
      for (let i = 0; i < frameCount; i++) total[i] += c[i];
    }
  }

  const out: Record<string, ProgramOutput> = {};
  for (const id of ids) {
    const rawOut = raw[id];
    const key = `${rawOut.key}§${macroJson}${coupling ? `§${coupling}` : ""}`;
    const prev = previous[id];
    if (prev && prev.key === key) {
      out[id] = prev;
      continue;
    }

    const factor = scenes?.[id] ?? null;
    // Final brightness: share replaces it with the program's share of the
    // total; otherwise scene factor × master scale the raw value.
    const brightness = new Float32Array(frameCount);
    const rawB = rawOut.channels.brightness ?? null;
    for (let i = 0; i < frameCount; i++) {
      if (share) {
        brightness[i] =
          total![i] > SHARE_EPSILON ? contribution[id][i] / total![i] : 0;
      } else {
        brightness[i] =
          (rawB ? rawB[i] : 1) *
          (factor ? factor[i] : 1) *
          (master ? master[i] : 1);
      }
    }

    // Overall dim per frame, for the pixel matrix.
    let pixels = rawOut.pixels;
    if (pixels && (factor || master || share)) {
      const rgb = new Uint8ClampedArray(pixels.rgb.length);
      const N = pixels.pixelCount;
      for (let f = 0; f < frameCount; f++) {
        const dim = share
          ? total![f] > SHARE_EPSILON
            ? contribution[id][f] / total![f]
            : 0
          : (factor ? factor[f] : 1) * (master ? master[f] : 1);
        if (dim <= 0) continue;
        const rowStart = f * N * 3;
        for (let k = 0; k < N * 3; k++) {
          rgb[rowStart + k] = pixels.rgb[rowStart + k] * dim;
        }
      }
      pixels = { pixelCount: N, rgb };
    }

    out[id] = {
      key,
      channels: { ...rawOut.channels, brightness },
      gate: factor ? gateWithin(rawOut.gate, factor, hz) : rawOut.gate,
      pixels,
    };
  }
  return out;
}
