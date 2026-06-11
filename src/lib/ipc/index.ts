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

export function updateSettings(update: {
  engines?: string[];
  drum_subsep?: boolean;
}): Promise<void> {
  return sendCommand({ type: "settings.update", ...update });
}

// Subscribe to validated sidecar events. Each stdout line is parsed and checked
// against the schema; malformed or unknown lines are logged and dropped.
// Returns an unsubscribe function.
export function onSidecarEvent(
  handler: (event: SidecarEvent) => void,
): () => void {
  let active = true;
  const unlisten = listen<string>("sidecar-message", (event) => {
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
  unlisten.then((fn) => {
    if (!active) fn();
  });
  return () => {
    active = false;
    unlisten.then((fn) => fn());
  };
}
