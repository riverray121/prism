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

// Profile JSON (subset we consume). Grows as features are added; see
// docs/profile-schema.md.
export const ScalarFeatureSchema = z.object({
  render: z.literal("scalar"),
  category: z.string(),
  source: z.string(),
  unit: z.string(),
  value: z.number(),
});

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
  mix: z.object({
    bpm: ScalarFeatureSchema,
  }),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ProfileEventSchema = z.object({
  type: z.literal("profile"),
  song_id: z.string(),
  profile: ProfileSchema,
});

// All events the sidecar can send on stdout.
export const SidecarEventSchema = z.discriminatedUnion("type", [
  LibrarySongsEventSchema,
  ImportFailedEventSchema,
  ProfileEventSchema,
]);
export type SidecarEvent = z.infer<typeof SidecarEventSchema>;
