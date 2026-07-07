import { getProfile, updateFavorites } from "$lib/ipc";
import type { Profile } from "$lib/ipc/messages";
import {
  resetForSong,
  switchSource,
  toggleSource,
} from "$lib/state/transport.svelte";

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

// Return the audible source to the original mix (e.g. after soloing a stem),
// keeping the playhead where it is.
export function backToMix(): void {
  switchSource("mix", pathForKey("mix"));
}

// Resolve a relative sidecar path (heatmap/tags .npy) to its absolute path.
// Call sites gate on songDir being set.
export function sidecarPath(rel: string): string {
  return `${inspection.songDir}/${rel}`;
}

export function isFavorite(path: string): boolean {
  return inspection.profile?.favorites.includes(path) ?? false;
}

// Star/unstar a subfeature. Optimistic: the in-memory profile updates
// immediately and the sidecar persists the full list into profile.json.
export function toggleFavorite(path: string): void {
  const profile = inspection.profile;
  if (!profile || !inspection.songId) return;
  profile.favorites = profile.favorites.includes(path)
    ? profile.favorites.filter((p) => p !== path)
    : [...profile.favorites, path];
  void updateFavorites(inspection.songId, profile.favorites);
}

// Follow a favorites dot-path through the profile; used to warn on stale
// favorites when a profile loads (a removed feature must not kill the load).
export function favoriteResolves(profile: Profile, path: string): boolean {
  let node: unknown = profile;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return node !== undefined;
}
