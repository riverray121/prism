// Simple-mode program edits for the Mapping tab: read and rewrite a program
// as one source + one style + color + range, using the same builders the
// show algorithms use. Pure: callers apply the results through the mapping
// store.

import { oklchToCss } from "$lib/color";
import type { Profile } from "$lib/ipc/messages";
import { frameIndexAt, type ProgramOutput } from "$lib/mapping/evaluate";
import type {
  Binding,
  ChannelValue,
  Derivation,
  Program,
  TransformStep,
} from "$lib/mapping/schema";
import { sourceLabel } from "$lib/mapping/labels";
import { MIX_CANDIDATES } from "$lib/showgen/candidates";
import { hueSaturation, resolvePalette } from "$lib/showgen/palettes";
import {
  chaseProgram,
  flashProgram,
  glowBrightness,
  onsetDerivation,
  strobeProgram,
} from "$lib/showgen/styles";
import type { PaletteRef, SelectionReport } from "$lib/showgen/types";

export const STYLES = ["glow", "pulse", "flash", "strobe", "chase"] as const;
export type Style = (typeof STYLES)[number];

export const STYLE_LABELS: Record<Style, string> = {
  glow: "Glow",
  pulse: "Pulse",
  flash: "Flash",
  strobe: "Strobe",
  chase: "Chase",
};

// Flash decay at or above this reads as a pulse (decay tied to the beat).
const PULSE_MIN_DECAY_S = 0.3;
const FLASH_DECAY_S = 0.25;

// The derivation a styled program owns for its hits.
export function hitsId(programId: string): string {
  return `${programId}_hits`;
}

function binding(v: ChannelValue | undefined): Binding | null {
  return typeof v === "object" && v !== null ? v : null;
}

// The track a program follows: its brightness (or motion) source, with a
// derived source resolved to the derivation's own source.
export function programSource(
  program: Program,
  derivations: Derivation[],
): string | null {
  const b =
    binding(program.channels.brightness) ?? binding(program.channels.motion);
  if (!b) return null;
  if (b.source.startsWith("derived.")) {
    const d = derivations.find(
      (x) => x.id === b.source.slice("derived.".length),
    );
    return d?.source ?? null;
  }
  return b.source;
}

// The simple-mode style a program matches, or null when it was hand-built
// in a way none of the styles describe.
export function detectStyle(program: Program): Style | null {
  const ch = program.channels;
  if (binding(ch.motion)) return "chase";
  const b = binding(ch.brightness);
  if (!b) return null;
  if (ch.strobe_rate !== undefined) return "strobe";
  if (b.source.startsWith("derived.")) {
    const env = b.transform.find(
      (s): s is Extract<TransformStep, { envelope: unknown }> =>
        "envelope" in s,
    );
    return env && env.envelope.decay_s >= PULSE_MIN_DECAY_S ? "pulse" : "flash";
  }
  return "glow";
}

function glowBinding(
  path: string,
  data: ArrayLike<number> | undefined,
): Binding {
  if (data && data.length > 0) return glowBrightness(path, data);
  return {
    source: path,
    transform: [
      { normalize: { min: null, max: null, curve: "gamma", gamma: 1.6 } },
      { smooth: { window_s: 0.15 } },
    ],
  };
}

export interface RestyleOptions {
  path: string;
  data?: ArrayLike<number>;
  beatPeriodS: number;
}

// Rebuild a program's motion channels for a style and source. Color
// channels (hue, saturation, color_temp), name and enabled are kept; the
// program's own hits derivation is added, replaced or dropped as needed.
export function restyle(
  program: Program,
  derivations: Derivation[],
  style: Style,
  opts: RestyleOptions,
): { program: Program; derivations: Derivation[] } {
  const keep: Program["channels"] = {};
  for (const k of ["hue", "saturation", "color_temp"] as const)
    if (program.channels[k] !== undefined) keep[k] = program.channels[k];
  const dId = hitsId(program.id);
  const others = derivations.filter((d) => d.id !== dId);
  const hasData = !!opts.data && opts.data.length > 0;
  let channels: Program["channels"];
  let next = others;
  if (style === "glow") {
    channels = { brightness: glowBinding(opts.path, opts.data) };
  } else if (style === "chase") {
    channels = hasData
      ? chaseProgram(program.id, "", opts.path, opts.data!).channels
      : {
          brightness: glowBinding(opts.path, undefined),
          motion: {
            source: opts.path,
            transform: [{ motion: { primitive: "chase", width: 0.2 } }],
          },
        };
  } else {
    const hits: Derivation = hasData
      ? onsetDerivation(dId, opts.path, opts.data!)
      : {
          id: dId,
          name: `${dId}`,
          source: opts.path,
          threshold: { cutoff: 0.4, max: 1, sensitivity: 0.6, mode: "events" },
        };
    next = [...others, hits];
    channels =
      style === "strobe"
        ? strobeProgram(program.id, "", dId).channels
        : flashProgram(
            program.id,
            "",
            dId,
            style === "pulse"
              ? Math.max(PULSE_MIN_DECAY_S, 0.6 * opts.beatPeriodS)
              : FLASH_DECAY_S,
          ).channels;
  }
  const out: Program = {
    id: program.id,
    enabled: program.enabled,
    channels: { ...channels, ...keep },
  };
  if (program.name !== undefined) out.name = program.name;
  return { program: out, derivations: next };
}

function normalizeStep(program: Program) {
  const b = binding(program.channels.brightness);
  if (!b || b.source.startsWith("derived.")) return null;
  return (
    b.transform.find(
      (s): s is Extract<TransformStep, { normalize: unknown }> =>
        "normalize" in s,
    ) ?? null
  );
}

// Floor and peak of a continuous brightness binding: the normalize input
// range, null when the binding has none (events, or auto range).
export function brightnessRange(
  program: Program,
): { floor: number; peak: number } | null {
  const step = normalizeStep(program);
  if (!step || step.normalize.min === null || step.normalize.max === null)
    return null;
  return { floor: step.normalize.min, peak: step.normalize.max };
}

// Whether the program's brightness follows a continuous source (so floor,
// peak and smoothing apply).
export function hasContinuousBrightness(program: Program): boolean {
  const b = binding(program.channels.brightness);
  return !!b && !b.source.startsWith("derived.");
}

function mapBrightness(program: Program, f: (b: Binding) => Binding): Program {
  const b = binding(program.channels.brightness);
  if (!b) return program;
  return { ...program, channels: { ...program.channels, brightness: f(b) } };
}

export function withRange(
  program: Program,
  floor: number,
  peak: number,
): Program {
  const lo = Math.min(floor, peak - 1e-3);
  return mapBrightness(program, (b) => {
    const has = b.transform.some((s) => "normalize" in s);
    const transform: TransformStep[] = has
      ? b.transform.map((s) =>
          "normalize" in s
            ? { normalize: { ...s.normalize, min: lo, max: peak } }
            : s,
        )
      : [
          { normalize: { min: lo, max: peak, curve: "gamma", gamma: 1.6 } },
          ...b.transform,
        ];
    return { ...b, transform };
  });
}

export function smoothing(program: Program): number | null {
  const b = binding(program.channels.brightness);
  const step = b?.transform.find(
    (s): s is Extract<TransformStep, { smooth: unknown }> => "smooth" in s,
  );
  return step ? step.smooth.window_s : null;
}

// Set the brightness smoothing window; 0 removes the step.
export function withSmoothing(program: Program, windowS: number): Program {
  return mapBrightness(program, (b) => {
    const rest = b.transform.filter((s) => !("smooth" in s));
    return windowS > 0
      ? { ...b, transform: [...rest, { smooth: { window_s: windowS } }] }
      : { ...b, transform: rest };
  });
}

// Constant hue and saturation from a hex color (replaces any color binding).
export function withColor(program: Program, hex: string): Program {
  const { hue, saturation } = hueSaturation(hex);
  const channels = { ...program.channels, hue, saturation };
  delete channels.color_temp;
  return { ...program, channels };
}

// The palette color a new program takes: the next base slot after the
// existing programs, so new programs continue the palette in order.
export function nextSlotColor(programCount: number, ref: PaletteRef): string {
  const p = resolvePalette(ref);
  const base = p.colors.filter((_, i) => i !== p.outlier);
  return base[programCount % base.length];
}

// A new glow program on a source, colored with the palette's next slot.
// The id derives from the source path's stem or feature name, made unique.
export function newGlowProgram(
  path: string,
  label: string,
  data: ArrayLike<number> | undefined,
  existing: Program[],
  palette: PaletteRef,
): Program {
  const parts = path.split(".");
  const sub = parts.indexOf("substems");
  const root =
    parts[0] === "mix"
      ? `mix_${parts[1]}`
      : sub >= 0
        ? parts[sub + 1]
        : (parts[2] ?? "program");
  const taken = new Set(existing.map((p) => p.id));
  let id = root;
  let n = 2;
  while (taken.has(id)) id = `${root}_${n++}`;
  const program: Program = {
    id,
    name: label,
    enabled: true,
    channels: { brightness: glowBinding(path, data) },
  };
  return withColor(program, nextSlotColor(existing.length, palette));
}

export interface SourceOption {
  path: string;
  label: string;
  score: number | null;
  picked: boolean;
  reason: string | null;
  measures: Record<string, number>;
}

// Sources for the simple editor's picker: the selection report's candidates
// by score when the doc has one; otherwise every stem energy and mix
// candidate the profile carries.
export function sourceOptions(
  profile: Profile,
  report: SelectionReport | null,
): SourceOption[] {
  if (report && report.candidates.length > 0)
    return [...report.candidates]
      .sort((a, b) => b.score - a.score)
      .map((c) => ({
        path: c.path,
        label: c.label,
        score: c.score,
        picked: c.picked,
        reason: c.reason,
        measures: c.measures,
      }));
  const out: SourceOption[] = [];
  const add = (path: string) =>
    out.push({
      path,
      label: sourceLabel(path),
      score: null,
      picked: false,
      reason: null,
      measures: {},
    });
  for (const [engine, stems] of Object.entries(profile.stems))
    for (const [stem, entry] of Object.entries(stems)) {
      if (entry.features.energy?.render === "continuous")
        add(`stems.${engine}.${stem}.features.energy`);
      for (const [sub, s] of Object.entries(entry.substems ?? {}))
        if (s.features.energy?.render === "continuous")
          add(`stems.${engine}.${stem}.substems.${sub}.features.energy`);
    }
  for (const name of MIX_CANDIDATES)
    if (profile.mix[name]?.render === "continuous") add(`mix.${name}`);
  return out;
}

// CSS color for a program's swatch: its constant hue and saturation, a
// multi-color conic gradient when hue follows a binding (section colors),
// else the neutral warm-white the evaluator falls back to.
export function swatchCss(program: Program): string {
  const { hue, saturation } = program.channels;
  const sat = typeof saturation === "number" ? saturation : 0.8;
  if (typeof hue === "number")
    return oklchToCss({ l: 0.72, c: sat * 0.32, h: hue });
  const b = binding(hue);
  if (b) {
    const map = b.transform.find(
      (s): s is Extract<TransformStep, { categorical: unknown }> =>
        "categorical" in s,
    );
    const hues = map ? Object.values(map.categorical.map) : [];
    if (hues.length > 0) {
      const stops = hues.map((h) => oklchToCss({ l: 0.72, c: 0.14, h }));
      return `conic-gradient(${[...stops, stops[0]].join(", ")})`;
    }
  }
  return oklchToCss({ l: 0.85, c: 0.02, h: 90 });
}

// A program output's light level at time t: brightness × gate, 0–1.
export function levelAt(
  output: ProgramOutput,
  t: number,
  hz: number,
  frameCount: number,
): number {
  const frame = frameIndexAt(t, hz, frameCount);
  const b = output.channels.brightness ? output.channels.brightness[frame] : 1;
  let gate = output.gate === null ? 1 : 0;
  if (output.gate)
    for (const seg of output.gate)
      if (t >= seg.start && t <= seg.end && seg.strength > gate)
        gate = seg.strength;
  return Math.max(0, Math.min(1, b * gate));
}

// The doc's selection report, when it carries a well-formed one.
export function docReport(
  generator: { report: unknown } | undefined,
): SelectionReport | null {
  const r = generator?.report as SelectionReport | undefined;
  return r && Array.isArray(r.candidates) && Array.isArray(r.picks) ? r : null;
}
