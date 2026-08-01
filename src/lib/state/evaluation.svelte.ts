import { untrack } from "svelte";

import { patchedPixelCount } from "$lib/hardware/patch";
import type { MixFeature, Profile } from "$lib/ipc/messages";
import {
  applyMacro,
  evaluateDoc,
  type Matrices,
  type ProgramOutput,
} from "$lib/mapping/evaluate";
import type { MappingDoc } from "$lib/mapping/schema";
import { resolveFeature, resolveNode } from "$lib/mapping/sources";
import { loadNpy } from "$lib/npy";
import { hardware } from "$lib/state/hardware.svelte";
import {
  getRawProfile,
  inspection,
  requestFeatureTrack,
  sidecarPath,
} from "$lib/state/inspection.svelte";
import { mapping } from "$lib/state/mapping.svelte";
import { tracks } from "$lib/state/tracks.svelte";

// Evaluated show state: the doc from mapping, the profile from inspection,
// the strip resolution from hardware, rendered into per-program outputs.
// Downstream of all three stores by design — the state modules must stay a
// DAG (no import cycles), or Vite's hot updates resolve modules to undefined
// and the whole reactive graph wedges.

// Evaluated program outputs, keyed by program id. Replaced wholesale on each
// re-evaluation, but evaluateDoc reuses per-program outputs whose cache key
// is unchanged — editing one program recomputes only it. Float32Arrays stay
// unproxied ($state only wraps plain objects/arrays).
export const evaluation = $state<{
  outputs: Record<string, ProgramOutput>;
}>({ outputs: {} });

// Heatmap sidecar matrices for position bindings, keyed by source path.
// Loaded on demand (loadNpy is async; the evaluator is synchronous); the
// version counter is the reactive signal that a load landed.
let matrices: Matrices = {};
let loadingMatrices = new Set<string>();
const matrixVersion = $state({ n: 0 });

function ensureMatrix(source: string, absPath: string): void {
  if (matrices[source] || loadingMatrices.has(source)) return;
  // Writes land in the containers captured at entry: source paths repeat
  // across songs, so a load outliving a song switch must not populate (or
  // un-mark) the next song's caches.
  const targetMatrices = matrices;
  const targetLoading = loadingMatrices;
  targetLoading.add(source);
  void loadNpy(absPath)
    .then((npy) => {
      targetMatrices[source] = {
        rows: npy.shape[0],
        cols: npy.shape[1],
        data: npy.data,
      };
      if (targetMatrices === matrices) matrixVersion.n++;
    })
    .catch((e) => {
      console.warn("pixel matrix load failed", source, e);
    })
    .finally(() => {
      targetLoading.delete(source);
    });
}

// Raw (pre-macro) outputs, cached per program so an edit re-evaluates only
// its program; the macro layer applies on top with its own reuse.
let rawOutputs: Record<string, ProgramOutput> = {};

// Cache identity: the song and raw-profile object the caches were built
// against. Output cache keys don't include profile identity, so a song
// switch or a profile replacement (re-analysis) must drop everything here.
// Checked inline rather than via external reset calls, so upstream stores
// never need to import this module.
let cachedSongId: string | null = null;
let cachedProfile: Profile | null = null;

function invalidateIfStale(profile: Profile | null): void {
  if (mapping.songId === cachedSongId && profile === cachedProfile) return;
  cachedSongId = mapping.songId;
  cachedProfile = profile;
  // Fresh containers (not clears): loads still in flight hold the old ones.
  matrices = {};
  loadingMatrices = new Set();
  rawOutputs = {};
  // applyMacro's reuse cache keys on the doc, not profile identity — stale
  // finals sized for the old timeline must not survive the switch.
  evaluation.outputs = {};
}

// Re-render every enabled program against the current profile. Runs inside a
// $effect: reading the doc via snapshot registers deep dependencies; the
// previous outputs are read untracked so writing the new ones can't loop.
function reevaluate(profile: Profile | null): void {
  const doc =
    mapping.doc === null ? null : ($state.snapshot(mapping.doc) as MappingDoc);
  if (!profile || !doc) {
    rawOutputs = {};
    evaluation.outputs = {};
    return;
  }
  // A patched light sets the strip resolution (its real pixel count); reading
  // the rig here makes patch/rig changes re-trigger the callers' $effect.
  const pixelCount = patchedPixelCount(doc, hardware.rig.hubs);
  rawOutputs = evaluateDoc(profile, doc, rawOutputs, matrices, pixelCount);
  const previous = untrack(() => evaluation.outputs);
  evaluation.outputs = applyMacro(profile, doc, rawOutputs, previous);
}

// Every continuous source the doc references, streamed on demand (0.4.0
// profiles keep arrays in .npy sidecars). Requests go through the proxy
// features so hydration is reactive; band sources pull every sibling.
function requestSourceTracks(): void {
  const proxy = inspection.profile;
  const doc = mapping.doc;
  if (!proxy || !doc) return;
  const wanted = new Set<string>();
  const add = (source: string) => {
    if (source.startsWith("derived.")) {
      const d = doc.derivations.find(
        (x) => x.id === source.slice("derived.".length),
      );
      if (d) wanted.add(d.source);
    } else wanted.add(source);
  };
  for (const d of doc.derivations) wanted.add(d.source);
  for (const p of doc.programs)
    for (const v of Object.values(p.channels))
      if (typeof v === "object") add(v.source);
  if (doc.macro.master) add(doc.macro.master.source);
  for (const source of wanted) {
    const parts = source.split(".");
    if (parts.at(-1)?.startsWith("band_energy")) {
      const parent = resolveNode(proxy, parts.slice(0, -1).join("."));
      if (typeof parent !== "object" || parent === null) continue;
      for (const [name, v] of Object.entries(parent)) {
        const f = v as MixFeature;
        if (name.startsWith("band_energy") && f.render === "continuous")
          requestFeatureTrack(f);
      }
      continue;
    }
    const f = resolveFeature(proxy, source);
    if (f?.render === "continuous") requestFeatureTrack(f);
  }
}

// The one evaluation-refresh routine, called from a $effect in any tab that
// consumes outputs (Mapping's previews, Hardware's streamer). Registers deep
// dependencies on the doc, profile proxy, matrix/track versions, and the rig,
// requests missing .npy matrices and continuous tracks, and re-evaluates.
export function ensureEvaluationCurrent(): void {
  inspection.profile;
  matrixVersion.n;
  tracks.version;
  const profile = getRawProfile();
  invalidateIfStale(profile);
  // Heatmap position bindings need their .npy matrices; request any missing.
  if (profile && mapping.doc && inspection.songDir) {
    for (const p of mapping.doc.programs) {
      const pos = p.channels.position;
      if (pos === undefined || typeof pos === "number") continue;
      const feature = resolveFeature(profile, pos.source);
      if (feature?.render === "heatmap")
        ensureMatrix(pos.source, sidecarPath(feature.sidecar));
    }
    requestSourceTracks();
  }
  reevaluate(profile);
}
