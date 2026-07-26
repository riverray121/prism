import { getMapping, getProfile, updateFavorites } from "$lib/ipc";
import type { Profile } from "$lib/ipc/messages";
import { resolveNode } from "$lib/mapping/sources";
import { resetMappingForSong } from "$lib/state/mapping.svelte";
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

// The profile as a plain object, alongside the reactive proxy. The mapping
// evaluator loops over full-length feature arrays; reading them through the
// $state proxy would cost a proxy trap per frame, so it gets the raw object.
let rawProfile: Profile | null = null;

export function setProfile(profile: Profile | null): void {
  rawProfile = profile;
  inspection.profile = profile;
}

export function getRawProfile(): Profile | null {
  return rawProfile;
}

export function open(songId: string): void {
  inspection.songId = songId;
  setProfile(null);
  inspection.audioPath = null;
  inspection.songDir = null;
  // Silence the previous song immediately; the profile event re-arms playback.
  resetForSong(null, 0);
  resetMappingForSong(songId);
  getProfile(songId);
  getMapping(songId);
}

export function close(): void {
  inspection.songId = null;
  setProfile(null);
  inspection.audioPath = null;
  inspection.songDir = null;
  resetForSong(null, 0);
  resetMappingForSong(null);
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

// Switch the audible source to a stem without toggling play/pause — the solo
// affordances' half of the toggle (backToMix is the other half).
export function soloSource(key: string): void {
  switchSource(key, pathForKey(key));
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

// Whether a favorites dot-path still resolves; used to warn on stale
// favorites when a profile loads (a removed feature must not kill the load).
export function favoriteResolves(profile: Profile, path: string): boolean {
  return resolveNode(profile, path) !== undefined;
}
