import { updateMapping } from "$lib/ipc";
import type { Derivation, MappingDoc } from "$lib/mapping/schema";

// The open song's mapping doc. doc is null while the sidecar fetch is in
// flight; a song with no saved doc arrives as the empty doc (schema defaults).
// Components render the doc and call actions; every edit goes through
// touchDoc, which debounces a full-doc save through mapping.update.
export const mapping = $state<{
  songId: string | null;
  doc: MappingDoc | null;
}>({ songId: null, doc: null });

// Mapping-tab UI selection. Lives here (not in a component) so it survives
// tab switches and pane remounts; never persisted.
export const mappingUi = $state<{
  // Derivation open in the editor; "new" = drafting a fresh one.
  editingDerivation: string | null;
}>({ editingDerivation: null });

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
  mappingUi.editingDerivation = null;
}

// Apply an inbound `mapping` event; stale responses (user navigated away
// before the reply) are dropped.
export function applyMappingEvent(songId: string, doc: MappingDoc): void {
  if (songId !== mapping.songId) return;
  doc.song_id = songId;
  mapping.doc = doc;
}

// ── Derivation actions ──────────────────────────────────────────────────────

export function addDerivation(derivation: Derivation): void {
  touchDoc((doc) => {
    doc.derivations.push(derivation);
  });
}

export function updateDerivation(
  id: string,
  patch: Partial<Omit<Derivation, "id">>,
): void {
  touchDoc((doc) => {
    const d = doc.derivations.find((x) => x.id === id);
    if (!d) return;
    if (patch.source !== undefined) d.source = patch.source;
    if (patch.threshold !== undefined) d.threshold = patch.threshold;
  });
}

// Deleting a derivation is always explicit — nothing calls this implicitly
// (removing a consuming program never cascades here).
export function removeDerivation(id: string): void {
  touchDoc((doc) => {
    doc.derivations = doc.derivations.filter((d) => d.id !== id);
  });
  if (mappingUi.editingDerivation === id) mappingUi.editingDerivation = null;
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
