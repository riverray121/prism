import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { SidecarEventSchema, type SidecarEvent } from "./messages";

// Send one command to the sidecar via the Rust shell, which writes it to the
// sidecar's stdin as a JSON line.
async function sendCommand(command: object): Promise<void> {
  await invoke("send_to_sidecar", { message: JSON.stringify(command) });
}

export function importFiles(paths: string[]): Promise<void> {
  return sendCommand({ type: "library.import", paths });
}

// Download a YouTube URL's audio (sidecar-side) and import it.
export function importYoutube(url: string): Promise<void> {
  return sendCommand({ type: "library.import_youtube", url });
}

// Remove a song: its library row and its whole on-disk folder.
export function deleteSong(songId: string): Promise<void> {
  return sendCommand({ type: "library.delete", song_id: songId });
}

export function listLibrary(): Promise<void> {
  return sendCommand({ type: "library.list" });
}

export function queueAnalysis(songIds: string[]): Promise<void> {
  return sendCommand({ type: "queue.add", song_ids: songIds });
}

export function cancelAnalysis(songId: string): Promise<void> {
  return sendCommand({ type: "queue.cancel", song_id: songId });
}

export function getProfile(songId: string): Promise<void> {
  return sendCommand({ type: "profile.get", song_id: songId });
}

export function getSettings(): Promise<void> {
  return sendCommand({ type: "settings.get" });
}

// Edit a song's user-facing metadata (DB row + profile.json when analyzed).
export function updateMetadata(
  songId: string,
  title: string,
  artist: string,
): Promise<void> {
  return sendCommand({
    type: "library.update_metadata",
    song_id: songId,
    title,
    artist,
  });
}

// Request a song's mapping doc (answered by a `mapping` event).
export function getMapping(songId: string): Promise<void> {
  return sendCommand({ type: "mapping.get", song_id: songId });
}

// Replace a song's mapping doc wholesale (the doc is small; saves are debounced).
export function updateMapping(songId: string, doc: object): Promise<void> {
  return sendCommand({ type: "mapping.update", song_id: songId, doc });
}

// Replace a song's full favorites list (dot-paths into its profile).
export function updateFavorites(
  songId: string,
  favorites: string[],
): Promise<void> {
  return sendCommand({ type: "favorites.update", song_id: songId, favorites });
}

export function updateSettings(update: {
  engines?: string[];
  drum_subsep?: boolean;
}): Promise<void> {
  return sendCommand({ type: "settings.update", ...update });
}

// Subscribe to validated sidecar events. Each stdout line is parsed and checked
// against the schema; malformed or unknown lines are logged and dropped.
// Resolves once the listener is attached, with an unsubscribe function — await
// it before issuing commands so no events emitted before attachment are dropped.
export async function onSidecarEvent(
  handler: (event: SidecarEvent) => void,
): Promise<() => void> {
  const unlisten = await listen<string>("sidecar-message", (event) => {
    let json: unknown;
    try {
      json = JSON.parse(event.payload);
    } catch {
      console.warn("non-JSON sidecar line", event.payload);
      return;
    }
    const result = SidecarEventSchema.safeParse(json);
    if (!result.success) {
      console.warn("unknown sidecar event", json, result.error);
      return;
    }
    handler(result.data);
  });
  return unlisten;
}
