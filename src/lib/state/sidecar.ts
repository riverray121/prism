import { getSettings, listLibrary, onSidecarEvent } from "$lib/ipc";
import type { SidecarEvent } from "$lib/ipc/messages";
import { library } from "$lib/state/library.svelte";
import { favoriteResolves, inspection } from "$lib/state/inspection.svelte";
import { settings } from "$lib/state/settings.svelte";
import { resetForSong } from "$lib/state/transport.svelte";

// Reducer mapping inbound sidecar events onto the durable $state stores. The
// inbound counterpart to the command senders in lib/ipc; kept out of the route
// component so the dispatch (and its correctness guards) survives UI changes.
function applySidecarEvent(event: SidecarEvent): void {
  if (event.type === "library.songs") {
    library.songs = event.songs;
  } else if (event.type === "library.import_failed") {
    console.error("import failed", event.path, event.error);
    library.lastImportError = { path: event.path, error: event.error };
  } else if (event.type === "profile") {
    // Ignore stale responses if the user has since navigated away/elsewhere.
    if (event.song_id === inspection.songId) {
      inspection.profile = event.profile;
      inspection.audioPath = event.audio_path;
      inspection.songDir = event.song_dir;
      // Arm the transport for the newly loaded song (pre-decodes the mix).
      resetForSong(event.audio_path, event.profile.song.duration_sec ?? 0);
      // Stale favorites (feature removed by a re-analysis) warn, never fail.
      for (const fav of event.profile.favorites) {
        if (!favoriteResolves(event.profile, fav))
          console.warn("favorite no longer resolves:", fav);
      }
    }
  } else if (event.type === "settings") {
    settings.engines = event.engines;
    settings.availableEngines = event.available_engines;
    settings.engineInfo = event.engine_info;
    settings.drumSubsep = event.drum_subsep;
    settings.loaded = true;
  }
}

// Session lifecycle: attach the sidecar-event listener, then request the
// current library + settings. The listener is awaited first so no reply
// emitted before it is attached can be dropped. The generation token makes
// start/stop re-entrant: a start superseded (by stop or a newer start) while
// still awaiting detaches itself instead of leaking into the live session.
let off: (() => void) | undefined;
let generation = 0;

export function startSidecarSession(): void {
  const gen = ++generation;
  void (async () => {
    const detach = await onSidecarEvent(applySidecarEvent);
    if (gen !== generation) {
      detach();
      return;
    }
    off?.();
    off = detach;
    listLibrary();
    getSettings();
  })();
}

export function stopSidecarSession(): void {
  generation++;
  off?.();
  off = undefined;
}
