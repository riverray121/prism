# Deferred Structural Debt — RESOLVED

Carry-over from the milestone-1 code review / deslop. Every item below landed during M2 (A2/A5/L4 with the graph kit, A6 with the shell, A3/A7 with the analyze popup, A4 post-slice-13). Kept as a record; nothing remains.

Frontend layering (land with the [`../ui/`](../ui/overview.md) rework, since those components are rewritten anyway):

- A2 / L-FE1: move path resolution, audio/`.npy` loading, tag-matrix transforms, and chord-label formatting out of components into `lib/state` or pure helpers (components stay dumb).
- A5: dedupe the `convertFileSrc → fetch → parseNpy` sequence into a `loadNpy(url)` helper in `npy.ts`.
- L4: type the chord-event access in `InspectionView` (drop the cast) — do this with A2.

Sidecar / boundary (independent of the UI rework):

- A3: engine-selection resolution leaks into `library.py` (persistence) and is validated twice — move it to a settings/separation helper; `library.py` stores raw JSON only.
- A4: the worker hard-codes disk paths and holds per-feature heatmap metadata that belong in `storage.py` / the feature modules.
- A6: expose `startSidecarSession()` / `stopSidecarSession()` from `lib/state/sidecar.ts`; the route only calls them.
- A7: send engine labels/capabilities (e.g. which engines produce a drums stem) from the sidecar instead of hard-coding them in `AnalysisSettings`.
