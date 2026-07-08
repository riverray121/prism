// The evaluator: (profile data, mapping doc) → per-channel timelines on the
// profile's 100 Hz grid. Pure — no state, IPC, or DOM — because this same
// computation is the future cue-file bake; writing a cue file is serializing
// its output. Per-program outputs carry a cache key so edits re-evaluate only
// the touched program.

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
import { resolveFeature } from "$lib/mapping/sources";
import {
  applyColormap,
  applyEnvelope,
  applyNormalize,
  applySmooth,
  categoricalValues,
  type ColorComponent,
} from "$lib/mapping/transforms";

export interface GateSegment {
  start: number;
  end: number;
  strength: number;
}

// One program rendered to channel timelines. `gate` null = no gate binding
// (the program is always lit); channels absent = not bound (or muted).
export interface ProgramOutput {
  key: string;
  channels: Partial<Record<Channel, Float32Array>>;
  gate: GateSegment[] | null;
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
    if (derivation.threshold.mode === "events") {
      const events = deriveEvents(
        feature.data,
        hz,
        derivation.threshold.cutoff,
      );
      return {
        kind: "events",
        events: events.map((e) => ({ ...e, label: null })),
      };
    }
    const segments = deriveSegments(
      feature.data,
      hz,
      derivation.threshold.cutoff,
    );
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

// ── Program evaluation ──────────────────────────────────────────────────────

// Cache key: the program definition plus every derivation it references and
// the frame grid — anything else unchanged, the previous output is reusable.
export function programKey(doc: MappingDoc, program: Program): string {
  const derivedIds: string[] = [];
  for (const value of Object.values(program.channels)) {
    if (typeof value === "object" && value.source.startsWith("derived.")) {
      derivedIds.push(value.source.slice("derived.".length));
    }
  }
  const derivations = doc.derivations.filter((d) => derivedIds.includes(d.id));
  return JSON.stringify({ program, derivations });
}

export function evaluateProgram(
  profile: Profile,
  doc: MappingDoc,
  program: Program,
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
    // position/motion: the pixel dimension, evaluated in slice 6.
  }

  return { key: programKey(doc, program), channels, gate };
}

// Evaluate every enabled program, reusing previous outputs whose key still
// matches — editing one program re-evaluates only it.
export function evaluateDoc(
  profile: Profile,
  doc: MappingDoc,
  previous: Record<string, ProgramOutput> = {},
): Record<string, ProgramOutput> {
  const out: Record<string, ProgramOutput> = {};
  for (const program of doc.programs) {
    if (!program.enabled) continue;
    const key = programKey(doc, program);
    const prev = previous[program.id];
    out[program.id] =
      prev && prev.key === key ? prev : evaluateProgram(profile, doc, program);
  }
  return out;
}
