import type { SidecarEvent } from "$lib/ipc/messages";
import { library } from "$lib/state/library.svelte";
import { inspection } from "$lib/state/inspection.svelte";
import { settings } from "$lib/state/settings.svelte";

// Reducer mapping inbound sidecar events onto the durable $state stores. The
// inbound counterpart to the command senders in lib/ipc; kept out of the route
// component so the dispatch (and its correctness guards) survives UI changes.
export function applySidecarEvent(event: SidecarEvent): void {
  if (event.type === "library.songs") {
    library.songs = event.songs;
  } else if (event.type === "library.import_failed") {
    console.error("import failed", event.path, event.error);
  } else if (event.type === "profile") {
    // Ignore stale responses if the user has since navigated away/elsewhere.
    if (event.song_id === inspection.songId) {
      inspection.profile = event.profile;
      inspection.audioPath = event.audio_path;
      inspection.songDir = event.song_dir;
    }
  } else if (event.type === "settings") {
    settings.engines = event.engines;
    settings.availableEngines = event.available_engines;
    settings.drumSubsep = event.drum_subsep;
    settings.loaded = true;
  }
}
