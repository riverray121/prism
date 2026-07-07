import { z } from "zod";

// Mirror of the sidecar's pydantic models. Validated at the IPC boundary so a
// schema mismatch surfaces here, not as a confusing downstream error.

export const SongSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  duration_sec: z.number().nullable(),
  sample_rate: z.number().nullable(),
  source_path: z.string(),
  status: z.string(),
  imported_at: z.string(),
  // Multi-stage analysis progress; null unless status is 'analyzing'.
  current_stage: z.string().nullable().default(null),
  // Separation engine currently running, during the separate/dsp-stem stages.
  current_engine: z.string().nullable().default(null),
  // Discrete progress: engine current_step of total_steps (no percentage).
  current_step: z.number().nullable().default(null),
  total_steps: z.number().nullable().default(null),
});
export type Song = z.infer<typeof SongSchema>;

export const LibrarySongsEventSchema = z.object({
  type: z.literal("library.songs"),
  songs: z.array(SongSchema),
});

export const ImportFailedEventSchema = z.object({
  type: z.literal("library.import_failed"),
  path: z.string(),
  error: z.string(),
});

// Profile JSON (subset we consume). The mix is a keyed map of feature
// envelopes, discriminated by render mode; see docs/profile-schema.md.
export const ScalarFeatureSchema = z.object({
  render: z.literal("scalar"),
  category: z.string(),
  source: z.string(),
  unit: z.string(),
  // Scalars are mostly numeric, but some (e.g. key) carry a string value.
  value: z.union([z.number(), z.string()]),
});
export type ScalarFeature = z.infer<typeof ScalarFeatureSchema>;

export const ContinuousFeatureSchema = z.object({
  render: z.literal("continuous"),
  category: z.string(),
  source: z.string(),
  unit: z.string(),
  range: z.tuple([z.number(), z.number()]).optional(),
  // Present (="wip") on provisional ML features, e.g. the timbral axes.
  status: z.string().optional(),
  data: z.array(z.number()),
  // Default onset track derived at analysis time (schema 0.2.0); absent on
  // profiles analyzed before then.
  onsets: z.array(z.object({ t: z.number(), strength: z.number() })).optional(),
});
export type ContinuousFeature = z.infer<typeof ContinuousFeatureSchema>;

// Event: a list of timestamped points. ML event features (e.g. chords) carry
// extra attrs per event, so unknown keys pass through.
export const EventSchema = z.object({ t: z.number() }).passthrough();
export const EventFeatureSchema = z.object({
  render: z.literal("event"),
  category: z.string(),
  source: z.string(),
  events: z.array(EventSchema),
});
export type EventFeature = z.infer<typeof EventFeatureSchema>;

// Segment: labeled time spans. ML segment features (e.g. sections) carry
// confidence and other extra attrs per segment, so unknown keys pass through.
export const SegmentSchema = z
  .object({
    start: z.number(),
    end: z.number(),
    label: z.string(),
    confidence: z.number().optional(),
  })
  .passthrough();
export const SegmentFeatureSchema = z.object({
  render: z.literal("segment"),
  category: z.string(),
  source: z.string(),
  // Present (="wip") on provisional segment features, e.g. motifs.
  status: z.string().optional(),
  segments: z.array(SegmentSchema),
});
export type SegmentFeature = z.infer<typeof SegmentFeatureSchema>;

// Heatmap: a 2D matrix stored in a .npy sidecar; the JSON holds only the
// reference and shape. shape is [rows, cols], axes names each dimension.
export const HeatmapFeatureSchema = z.object({
  render: z.literal("heatmap"),
  category: z.string(),
  source: z.string(),
  unit: z.string(),
  sidecar: z.string(),
  shape: z.array(z.number()),
  axes: z.array(z.string()),
});
export type HeatmapFeature = z.infer<typeof HeatmapFeatureSchema>;

// Tags: many named per-frame probability tracks in one .npy matrix
// ([rows, frames], 0-1). One row per labels[i]; rendered as one line per row.
// status "wip" flags the feature as provisional (see profile-schema.md).
export const TagsFeatureSchema = z.object({
  render: z.literal("tags"),
  category: z.string(),
  source: z.string(),
  unit: z.string(),
  status: z.string().optional(),
  sidecar: z.string(),
  labels: z.array(z.string()),
  shape: z.array(z.number()),
});
export type TagsFeature = z.infer<typeof TagsFeatureSchema>;

// One mix feature, discriminated by render mode.
export const MixFeatureSchema = z.discriminatedUnion("render", [
  ScalarFeatureSchema,
  ContinuousFeatureSchema,
  EventFeatureSchema,
  SegmentFeatureSchema,
  HeatmapFeatureSchema,
  TagsFeatureSchema,
]);
export type MixFeature = z.infer<typeof MixFeatureSchema>;

// A keyed map of feature envelopes parsed entry-by-entry: an unmodeled render
// mode, a new sidecar field, or a single feature missing a required field drops
// only that feature (logged), not the whole profile. A strict
// z.record(MixFeatureSchema) would fail the entire record — and so the whole
// inspection view — on any one bad envelope.
const FeatureMapSchema = z.record(z.string(), z.unknown()).transform((raw) => {
  const out: Record<string, MixFeature> = {};
  for (const [key, value] of Object.entries(raw)) {
    const parsed = MixFeatureSchema.safeParse(value);
    if (parsed.success) {
      out[key] = parsed.data;
    } else {
      console.warn(`dropping unparseable feature '${key}'`, parsed.error);
    }
  }
  return out;
});

// One separated stem: its audio file (relative to profile.json) plus the same
// keyed feature map as the mix, so per-stem features render through the same
// components. Keyed by engine, then stem (see docs/profile-schema.md).
// A drum sub-stem (kick/snare/etc.): same shape as a stem, but never nested further.
export const SubStemSchema = z.object({
  audio_file: z.string(),
  features: FeatureMapSchema,
});
export type SubStem = z.infer<typeof SubStemSchema>;

export const StemSchema = z.object({
  audio_file: z.string(),
  features: FeatureMapSchema,
  // Present on a drums stem when drum sub-separation ran.
  substems: z.record(z.string(), SubStemSchema).optional(),
});
export type Stem = z.infer<typeof StemSchema>;

export const ProfileSchema = z.object({
  schema_version: z.string(),
  song: z.object({
    id: z.string(),
    title: z.string(),
    artist: z.string(),
    duration_sec: z.number().nullable(),
    sample_rate: z.number().nullable(),
    source_file: z.string(),
    imported_at: z.string(),
    analyzed_at: z.string(),
  }),
  timeline: z.object({
    frame_rate_hz: z.number(),
    frame_count: z.number(),
  }),
  mix: FeatureMapSchema,
  // engine -> stem -> Stem. Absent on pre-M4 profiles, so defaults to empty.
  stems: z.record(z.string(), z.record(z.string(), StemSchema)).default({}),
  // Dot-paths to starred subfeatures (e.g. "mix.beats",
  // "stems.htdemucs_ft.bass.features.pitch"). Absent on older profiles.
  favorites: z.array(z.string()).default([]),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ProfileEventSchema = z.object({
  type: z.literal("profile"),
  song_id: z.string(),
  profile: ProfileSchema,
  audio_path: z.string(),
  song_dir: z.string(),
});

// Analysis settings: which separation engines are selected, and the full set the
// sidecar can run (so the UI renders the complete toggle list).
export const SettingsEventSchema = z.object({
  type: z.literal("settings"),
  engines: z.array(z.string()),
  available_engines: z.array(z.string()),
  drum_subsep: z.boolean(),
});

// All events the sidecar can send on stdout.
export const SidecarEventSchema = z.discriminatedUnion("type", [
  LibrarySongsEventSchema,
  ImportFailedEventSchema,
  ProfileEventSchema,
  SettingsEventSchema,
]);
export type SidecarEvent = z.infer<typeof SidecarEventSchema>;
