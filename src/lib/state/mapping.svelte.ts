import { updateMapping } from "$lib/ipc";
import type { MappingDoc } from "$lib/mapping/schema";

// The open song's mapping doc. doc is null while the sidecar fetch is in
// flight; a song with no saved doc arrives as the empty doc (schema defaults).
// Components render the doc and call actions; every edit goes through
// touchDoc, which debounces a full-doc save through mapping.update.
export const mapping = $state<{
  songId: string | null;
  doc: MappingDoc | null;
}>({ songId: null, doc: null });

let saveTimer: ReturnType<typeof setTimeout> | null = null;
// Captured at schedule time so a song switch can flush to the right song.
let dirtySongId: string | null = null;

const SAVE_DEBOUNCE_MS = 400;

// Persist the current doc immediately if an edit is pending. Called before
// retargeting so a quick song switch can't drop the last edits.
export function flushMappingSave(): void {
  if (saveTimer === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  if (dirtySongId !== null && mapping.doc !== null) {
    void updateMapping(dirtySongId, $state.snapshot(mapping.doc));
  }
  dirtySongId = null;
}

// Retarget to a song (null = closed). The doc stays null until the `mapping`
// event lands; the caller issues the mapping.get alongside profile.get.
export function resetMappingForSong(songId: string | null): void {
  flushMappingSave();
  mapping.songId = songId;
  mapping.doc = null;
}

// Apply an inbound `mapping` event; stale responses (user navigated away
// before the reply) are dropped.
export function applyMappingEvent(songId: string, doc: MappingDoc): void {
  if (songId !== mapping.songId) return;
  doc.song_id = songId;
  mapping.doc = doc;
}

// Mutate the doc through an action, then debounce a save. All editing actions
// (derivation/program/macro CRUD) funnel through here.
export function touchDoc(mutate: (doc: MappingDoc) => void): void {
  if (mapping.doc === null || mapping.songId === null) return;
  mutate(mapping.doc);
  dirtySongId = mapping.songId;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (dirtySongId !== null && mapping.doc !== null) {
      void updateMapping(dirtySongId, $state.snapshot(mapping.doc));
    }
    dirtySongId = null;
  }, SAVE_DEBOUNCE_MS);
}
