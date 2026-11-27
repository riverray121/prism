import { updateMapping } from "$lib/ipc";
import type { ProgramOutput } from "$lib/mapping/evaluate";
import type {
  Channel,
  ChannelValue,
  Derivation,
  Macro,
  MappingDoc,
  Program,
  Scene,
} from "$lib/mapping/schema";
import type { PaletteRef, ShowResult } from "$lib/showgen/types";

// This store owns the doc and its persistence only. Rendering the doc into
// program outputs lives downstream in state/evaluation.svelte.ts — the state
// modules must stay a DAG (no import cycles), or Vite's hot updates resolve
// modules to undefined and the whole reactive graph wedges.

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

// Transient audition layer: the derivation editor mirrors its current
// threshold result here so the live light fires while tuning, even when no
// program consumes the derivation yet. Never persisted.
export const audition = $state<{ output: ProgramOutput | null }>({
  output: null,
});

let saveTimer: ReturnType<typeof setTimeout> | null = null;
// Captured at schedule time so a song switch can flush to the right song.
let dirtySongId: string | null = null;

const SAVE_DEBOUNCE_MS = 400;

// The one save path: send the current doc for the dirty song, then clear the
// dirty mark. Shared by the debounce timer and the explicit flush.
function commitSave(): void {
  if (dirtySongId !== null && mapping.doc !== null) {
    void updateMapping(dirtySongId, $state.snapshot(mapping.doc));
  }
  dirtySongId = null;
}

// Persist the current doc immediately if an edit is pending. Called before
// retargeting so a quick song switch can't drop the last edits.
export function flushMappingSave(): void {
  if (saveTimer === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  commitSave();
}

// Retarget to a song (null = closed). The doc stays null until the `mapping`
// event lands; the caller issues the mapping.get alongside profile.get.
export function resetMappingForSong(songId: string | null): void {
  flushMappingSave();
  mapping.songId = songId;
  mapping.doc = null;
  mappingUi.editingDerivation = null;
  mappingUi.editingProgram = null;
  audition.output = null;
  showHistory.before = null;
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

// Set a derivation's display name; empty clears back to the humanized id.
export function renameDerivation(id: string, name: string): void {
  touchDoc((doc) => {
    const d = doc.derivations.find((x) => x.id === id);
    if (!d) return;
    const trimmed = name.trim();
    if (trimmed === "") delete d.name;
    else d.name = trimmed;
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

// Set a program's display name; empty clears back to the humanized id.
export function renameProgram(id: string, name: string): void {
  touchDoc((doc) => {
    const p = doc.programs.find((x) => x.id === id);
    if (!p) return;
    const trimmed = name.trim();
    if (trimmed === "") delete p.name;
    else p.name = trimmed;
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

// ── Generated shows ──────────────────────────────────────────────────────────

// A doc with nothing authored yet: automatic mode may fill it silently.
export function docIsEmpty(doc: MappingDoc): boolean {
  return (
    doc.programs.length === 0 &&
    doc.derivations.length === 0 &&
    doc.macro.scenes_from === null &&
    doc.macro.master === null
  );
}

// Replace the doc's show with a generated one: programs, derivations, macro
// and patch from the algorithm, plus the palette and selection report.
export function applyShowResult(
  result: ShowResult,
  algorithm: string,
  palette: PaletteRef,
): void {
  touchDoc((doc) => {
    doc.programs = result.programs;
    doc.derivations = result.derivations;
    doc.macro = result.macro;
    doc.patch = result.patch;
    doc.palette = palette;
    doc.generator = { algorithm, report: result.report };
  });
}

// One level of undo for Generate: the doc as it was before the last
// generated show replaced it. Cleared on song switch.
export const showHistory = $state<{ before: MappingDoc | null }>({
  before: null,
});

// Generate from the Mapping tab: snapshot the current doc for Undo, then
// replace the show.
export function generateWithUndo(
  result: ShowResult,
  algorithm: string,
  palette: PaletteRef,
): void {
  if (mapping.doc === null) return;
  showHistory.before = $state.snapshot(mapping.doc) as MappingDoc;
  applyShowResult(result, algorithm, palette);
  mappingUi.editingProgram = result.programs[0]?.id ?? null;
  mappingUi.editingDerivation = null;
}

// Restore the doc from before the last Generate.
export function undoGenerate(): void {
  const before = showHistory.before;
  if (before === null) return;
  showHistory.before = null;
  touchDoc((doc) => {
    doc.programs = before.programs;
    doc.derivations = before.derivations;
    doc.macro = before.macro;
    doc.patch = before.patch;
    doc.palette = before.palette;
    if (before.generator === undefined) delete doc.generator;
    else doc.generator = before.generator;
  });
  if (!before.programs.some((p) => p.id === mappingUi.editingProgram))
    mappingUi.editingProgram = null;
}

// Replace one program and the doc's derivation list together (simple-mode
// style and source edits own the program's hits derivation).
export function replaceProgram(
  program: Program,
  derivations?: Derivation[],
): void {
  touchDoc((doc) => {
    const i = doc.programs.findIndex((p) => p.id === program.id);
    if (i >= 0) doc.programs[i] = program;
    if (derivations) doc.derivations = derivations;
  });
}

// Choose the doc's palette and recolor its programs from it.
export function setPalette(palette: PaletteRef, programs: Program[]): void {
  touchDoc((doc) => {
    doc.palette = palette;
    doc.programs = programs;
  });
}

// ── Patch actions ───────────────────────────────────────────────────────────

// Link (or with null, unlink) a light to a program. The patch lives in the
// mapping doc, so edits ride the debounced save like any other doc edit.
export function setPatch(lightId: string, programId: string | null): void {
  touchDoc((doc) => {
    if (programId === null) delete doc.patch[lightId];
    else doc.patch[lightId] = programId;
  });
}

// ── Macro actions ───────────────────────────────────────────────────────────

export function setScenesFrom(source: string | null): void {
  touchDoc((doc) => {
    doc.macro.scenes_from = source;
  });
}

// Set (or clear, with null) the preset for one section label.
export function setScene(label: string, scene: Scene | null): void {
  touchDoc((doc) => {
    if (scene === null) delete doc.macro.scenes[label];
    else doc.macro.scenes[label] = scene;
  });
}

export function setMaster(master: Macro["master"]): void {
  touchDoc((doc) => {
    doc.macro.master = master;
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
    commitSave();
  }, SAVE_DEBOUNCE_MS);
}
