import { untrack } from "svelte";

import { updateMapping } from "$lib/ipc";
import type { Profile } from "$lib/ipc/messages";
import { evaluateDoc, type ProgramOutput } from "$lib/mapping/evaluate";
import type {
  Channel,
  ChannelValue,
  Derivation,
  MappingDoc,
  Program,
} from "$lib/mapping/schema";

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
  // Program open in the editor. Mutually exclusive with editingDerivation.
  editingProgram: string | null;
}>({ editingDerivation: null, editingProgram: null });

// Evaluated program outputs, keyed by program id. Replaced wholesale on each
// re-evaluation, but evaluateDoc reuses per-program outputs whose cache key
// is unchanged — editing one program recomputes only it. Float32Arrays stay
// unproxied ($state only wraps plain objects/arrays).
export const evaluation = $state<{
  outputs: Record<string, ProgramOutput>;
}>({ outputs: {} });

// Re-render every enabled program against the current profile. Runs inside a
// $effect in the Mapping tab: reading the doc via snapshot registers deep
// dependencies; the previous outputs are read untracked so writing the new
// ones can't loop the effect.
export function reevaluate(profile: Profile | null): void {
  const doc =
    mapping.doc === null ? null : ($state.snapshot(mapping.doc) as MappingDoc);
  if (!profile || !doc) {
    evaluation.outputs = {};
    return;
  }
  const previous = untrack(() => evaluation.outputs);
  evaluation.outputs = evaluateDoc(profile, doc, previous);
}

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
  mappingUi.editingProgram = null;
}

// Apply an inbound `mapping` event; stale responses (user navigated away
// before the reply) are dropped.
export function applyMappingEvent(songId: string, doc: MappingDoc): void {
  if (songId !== mapping.songId) return;
  doc.song_id = songId;
  mapping.doc = doc;
}

// Editor selection — one editor open at a time.
export function editDerivation(id: string | null): void {
  mappingUi.editingDerivation = id;
  if (id !== null) mappingUi.editingProgram = null;
}

export function editProgram(id: string | null): void {
  mappingUi.editingProgram = id;
  if (id !== null) mappingUi.editingDerivation = null;
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

// ── Program actions ─────────────────────────────────────────────────────────

export function addProgram(program: Program): void {
  touchDoc((doc) => {
    doc.programs.push(program);
  });
}

export function removeProgram(id: string): void {
  // Removing a program never cascades into derivations it consumed.
  touchDoc((doc) => {
    doc.programs = doc.programs.filter((p) => p.id !== id);
  });
  if (mappingUi.editingProgram === id) mappingUi.editingProgram = null;
}

export function setProgramEnabled(id: string, enabled: boolean): void {
  touchDoc((doc) => {
    const p = doc.programs.find((x) => x.id === id);
    if (p) p.enabled = enabled;
  });
}

// Bind or rebind one channel of a program; value null removes the binding.
export function setProgramChannel(
  id: string,
  channel: Channel,
  value: ChannelValue | null,
): void {
  touchDoc((doc) => {
    const p = doc.programs.find((x) => x.id === id);
    if (!p) return;
    if (value === null) delete p.channels[channel];
    else p.channels[channel] = value;
  });
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
