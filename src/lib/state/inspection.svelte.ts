import { getProfile } from "$lib/ipc";
import type { Profile } from "$lib/ipc/messages";

// The song currently open in the inspection view. profile is null while the
// sidecar is fetching it. songId null means the library panel is shown instead.
export const inspection = $state<{
  songId: string | null;
  profile: Profile | null;
}>({ songId: null, profile: null });

export function open(songId: string): void {
  inspection.songId = songId;
  inspection.profile = null;
  getProfile(songId);
}

export function close(): void {
  inspection.songId = null;
  inspection.profile = null;
}
