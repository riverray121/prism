import { getProfile } from "$lib/ipc";
import type { Profile } from "$lib/ipc/messages";

// The song currently open in the inspection view. profile/audioPath are null
// while the sidecar is fetching them. songId null means the library panel is
// shown instead. audioPath is the absolute source path for playback; songDir is
// the absolute song folder, used to resolve relative sidecar paths (heatmaps).
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
  getProfile(songId);
}

export function close(): void {
  inspection.songId = null;
  inspection.profile = null;
  inspection.audioPath = null;
  inspection.songDir = null;
}
