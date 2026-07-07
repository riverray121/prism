import { getProfile } from "$lib/ipc";
import type { Profile } from "$lib/ipc/messages";
import { resetForSong, toggleSource } from "$lib/state/transport.svelte";

// The song currently open in the inspection view. profile/audioPath are null
// while the sidecar is fetching them. songId null means no song is open.
// audioPath is the absolute source path for playback; songDir is the absolute
// song folder, used to resolve relative sidecar paths (heatmaps, stem audio).
export const inspection = $state<{
  songId: string | null;
  profile: Profile | null;
  audioPath: string | null;
  songDir: string | null;
}>({ songId: null, profile: null, audioPath: null, songDir: null });

export function open(songId: string): void {
  inspection.songId = songId;
  inspection.profile = null;
  inspection.audioPath = null;
  inspection.songDir = null;
  // Silence the previous song immediately; the profile event re-arms playback.
  resetForSong(null, 0);
  getProfile(songId);
}

export function close(): void {
  inspection.songId = null;
  inspection.profile = null;
  inspection.audioPath = null;
  inspection.songDir = null;
  resetForSong(null, 0);
}

// Resolve a source key to its absolute file path (null if unavailable). Keys:
// "mix", "{engine}::{stem}", or "{engine}::{stem}::{substem}" (drum sub-stems).
export function pathForKey(key: string): string | null {
  if (key === "mix") return inspection.audioPath;
  const prof = inspection.profile;
  if (!prof || !inspection.songDir) return null;
  const [engine, stem, sub] = key.split("::");
  const stemObj = prof.stems[engine]?.[stem];
  const audioFile = sub
    ? stemObj?.substems?.[sub]?.audio_file
    : stemObj?.audio_file;
  return audioFile ? `${inspection.songDir}/${audioFile}` : null;
}

// Play/pause a source of the open song — the one place key → path resolution
// meets the transport, so components never join the two.
export function playToggle(key: string): void {
  toggleSource(key, pathForKey(key));
}
