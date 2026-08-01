import { loadNpy } from "$lib/npy";

// Streamed continuous-feature tracks (the arrays live in .npy sidecars). A
// loaded track hydrates `data` onto the envelope passed in — plus an optional
// second envelope, because a $state proxy write never reaches the underlying
// object: the proxy envelope covers UI readers, its raw-profile counterpart
// covers the evaluator. Float32Arrays are never proxied, so reads stay
// trap-free either way. `version` ticks per arrival for raw-side consumers
// that can't observe the proxy write.
export const tracks = $state({ version: 0 });

let loading = new Set<string>();

export interface StreamableFeature {
  data?: ArrayLike<number>;
  sidecar?: string;
}

// Start fetching a feature's sidecar unless already loaded or in flight. The
// caller resolves the absolute path (path resolution is inspection-domain).
export function requestTrack(
  feature: StreamableFeature,
  absPath: string,
  also?: StreamableFeature,
): void {
  const rel = feature.sidecar;
  if (!rel || feature.data || loading.has(rel)) return;
  // Bookkeeping stays with the set captured at entry: relative paths repeat
  // across songs, so a load outliving a song switch must not delete the next
  // song's in-flight marker.
  const target = loading;
  target.add(rel);
  void loadNpy(absPath)
    .then((npy) => {
      feature.data = npy.data;
      if (also && !also.data) also.data = npy.data;
      tracks.version++;
    })
    .catch((e) => console.warn("track load failed", rel, e))
    .finally(() => target.delete(rel));
}

// Song switch: loaded data leaves with the old profile object; only the
// in-flight bookkeeping needs replacing (a late arrival hydrates a dead
// envelope, harmlessly).
export function resetTracks(): void {
  loading = new Set();
  tracks.version++;
}
