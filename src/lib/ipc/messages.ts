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

// One mix feature. Grows with new render modes (event, segment, heatmap).
export const MixFeatureSchema = z.discriminatedUnion("render", [
  ScalarFeatureSchema,
  ContinuousFeatureSchema,
]);
export type MixFeature = z.infer<typeof MixFeatureSchema>;

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
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ProfileEventSchema = z.object({
  type: z.literal("profile"),
  song_id: z.string(),
  profile: ProfileSchema,
  audio_path: z.string(),
});

// All events the sidecar can send on stdout.
export const SidecarEventSchema = z.discriminatedUnion("type", [
  LibrarySongsEventSchema,
  ImportFailedEventSchema,
  ProfileEventSchema,
]);
export type SidecarEvent = z.infer<typeof SidecarEventSchema>;
