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
  current_stage_progress: z.number().nullable().default(null),
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
  data: z.array(z.number()),
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

// One mix feature. Grows with new render modes (segment).
export const MixFeatureSchema = z.discriminatedUnion("render", [
  ScalarFeatureSchema,
  ContinuousFeatureSchema,
  EventFeatureSchema,
  HeatmapFeatureSchema,
]);
export type MixFeature = z.infer<typeof MixFeatureSchema>;

// One separated stem: its audio file (relative to profile.json) plus the same
// keyed feature map as the mix, so per-stem features render through the same
// components. Keyed by engine, then stem (see docs/profile-schema.md).
export const StemSchema = z.object({
  audio_file: z.string(),
  features: z.record(z.string(), MixFeatureSchema),
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
  mix: z.record(z.string(), MixFeatureSchema),
  // engine -> stem -> Stem. Absent on pre-M4 profiles, so defaults to empty.
  stems: z.record(z.string(), z.record(z.string(), StemSchema)).default({}),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ProfileEventSchema = z.object({
  type: z.literal("profile"),
  song_id: z.string(),
  profile: ProfileSchema,
  audio_path: z.string(),
  song_dir: z.string(),
});

// All events the sidecar can send on stdout.
export const SidecarEventSchema = z.discriminatedUnion("type", [
  LibrarySongsEventSchema,
  ImportFailedEventSchema,
  ProfileEventSchema,
]);
export type SidecarEvent = z.infer<typeof SidecarEventSchema>;
