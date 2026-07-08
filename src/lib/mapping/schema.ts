import { z } from "zod";

import type { Profile } from "$lib/ipc/messages";

// The mapping doc: derivations + programs + macro, per song. Small,
// declarative, hand-editable; persisted by the sidecar at
// songs/{uuid}/mapping/mapping.json. Zod fills defaults so older or
// hand-written docs load; unknown source paths are never a parse failure —
// resolution is checked separately and non-resolving bindings are muted.

export const MAPPING_SCHEMA_VERSION = "0.1.0";

// Channels of the generic fixture. Programs bind to these abstractly; future
// fixture types ignore channels they lack.
export const CHANNELS = [
  "gate",
  "brightness",
  "hue",
  "saturation",
  "color_temp",
  "strobe_rate",
  "position",
  "motion",
] as const;
export type Channel = (typeof CHANNELS)[number];

// ── Transforms ──────────────────────────────────────────────────────────────
// Each step is a single-key object ({ smooth: {...} }), matching the on-disk
// shape in formats.md. Parameters all default so hand-written docs stay terse.

export const NormalizeStepSchema = z.object({
  normalize: z.object({
    // Input range mapped to [0,1]; null = auto (the source's own min/max).
    min: z.number().nullable().default(null),
    max: z.number().nullable().default(null),
    curve: z.enum(["linear", "gamma", "log"]).default("linear"),
    // Exponent for curve="gamma".
    gamma: z.number().positive().default(2),
  }),
});

export const SmoothStepSchema = z.object({
  smooth: z.object({
    // Moving-average window; ~80 ms kills flicker without smearing hits.
    window_s: z.number().positive().default(0.08),
  }),
});

// Attack-hold-decay ramp fired per event: gives point onsets duration.
export const EnvelopeStepSchema = z.object({
  envelope: z.object({
    attack_s: z.number().min(0).default(0.005),
    hold_s: z.number().min(0).default(0.05),
    decay_s: z.number().min(0).default(0.15),
  }),
});

// Scalar → palette position (see lib/color.ts PALETTES).
export const ColormapStepSchema = z.object({
  colormap: z.object({
    palette: z.string().default("warm_cool"),
  }),
});

// Discrete label → fixed value (e.g. chord root → hue).
export const CategoricalStepSchema = z.object({
  categorical: z.object({
    // Explicit label → value map; unmapped labels spread evenly over [0,1].
    map: z.record(z.string(), z.number()).default({}),
  }),
});

export const TransformStepSchema = z.union([
  NormalizeStepSchema,
  SmoothStepSchema,
  EnvelopeStepSchema,
  ColormapStepSchema,
  CategoricalStepSchema,
]);
export type TransformStep = z.infer<typeof TransformStepSchema>;

// ── Bindings and programs ───────────────────────────────────────────────────

// A channel binds a source through transforms, or holds a constant.
// `source` is a dot-path into the profile ("mix.rms",
// "stems.htdemucs_ft.drums.features.drums_energy") or "derived.{id}".
export const BindingSchema = z.object({
  source: z.string(),
  transform: z.array(TransformStepSchema).default([]),
});
export type Binding = z.infer<typeof BindingSchema>;

export const ChannelValueSchema = z.union([z.number(), BindingSchema]);
export type ChannelValue = z.infer<typeof ChannelValueSchema>;

export const ProgramSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean().default(true),
  // partialRecord: a program binds only the channels it uses.
  channels: z.partialRecord(z.enum(CHANNELS), ChannelValueSchema).default({}),
});
export type Program = z.infer<typeof ProgramSchema>;

// ── Derivations ─────────────────────────────────────────────────────────────

// A named threshold result over a continuous source: events (peak-pick) or
// segments (hysteresis gate). Saved and independent — valid with zero
// consumers, deleted only explicitly.
export const DerivationSchema = z.object({
  id: z.string().min(1),
  source: z.string(),
  threshold: z.object({
    cutoff: z.number().min(0).max(1).default(0.4),
    mode: z.enum(["events", "segments"]).default("segments"),
  }),
});
export type Derivation = z.infer<typeof DerivationSchema>;

// ── Macro layer ─────────────────────────────────────────────────────────────

// Per-section-label preset: which programs are enabled plus a master scale.
export const SceneSchema = z.object({
  programs: z.array(z.string()).default([]),
  master_scale: z.number().min(0).default(1),
});
export type Scene = z.infer<typeof SceneSchema>;

export const MacroSchema = z.object({
  // Dot-path to the segment feature driving scene switches (e.g. "mix.sections");
  // null = no scene layer.
  scenes_from: z.string().nullable().default(null),
  // Scene preset per section label.
  scenes: z.record(z.string(), SceneSchema).default({}),
  // Adaptive master brightness over everything; null = no master layer.
  master: z
    .object({
      source: z.string(),
      adaptive: z.object({
        mode: z.enum(["absolute", "windowed", "share"]).default("windowed"),
        window_s: z.number().positive().default(4),
      }),
    })
    .nullable()
    .default(null),
});
export type Macro = z.infer<typeof MacroSchema>;

// ── The doc ─────────────────────────────────────────────────────────────────

export const MappingDocSchema = z.object({
  schema_version: z.string().default(MAPPING_SCHEMA_VERSION),
  song_id: z.string().optional(),
  derivations: z.array(DerivationSchema).default([]),
  programs: z.array(ProgramSchema).default([]),
  macro: MacroSchema.default({
    scenes_from: null,
    scenes: {},
    master: null,
  }),
});
export type MappingDoc = z.infer<typeof MappingDocSchema>;

// Songs open with an empty doc by design: hand authoring is the primary flow.
export function emptyMappingDoc(songId?: string): MappingDoc {
  return MappingDocSchema.parse(songId ? { song_id: songId } : {});
}

// Sidecar event carrying a song's mapping doc. The doc passes through the
// schema so defaults fill and a corrupt field fails at the IPC boundary.
export const MappingEventSchema = z.object({
  type: z.literal("mapping"),
  song_id: z.string(),
  doc: MappingDocSchema,
});

// ── Source resolution ───────────────────────────────────────────────────────

// Whether a binding source resolves: "derived.{id}" against the doc's
// derivations, anything else as a dot-path into the profile (the favorites
// addressing). Non-resolving sources warn and mute the binding — never a
// hard failure (e.g. re-analysis with a different engine).
export function sourceResolves(
  profile: Profile,
  doc: MappingDoc,
  source: string,
): boolean {
  const derived = source.match(/^derived\.(.+)$/);
  if (derived) return doc.derivations.some((d) => d.id === derived[1]);
  let node: unknown = profile;
  for (const part of source.split(".")) {
    if (typeof node !== "object" || node === null) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return node !== undefined;
}
