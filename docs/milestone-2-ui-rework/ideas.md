# UI Rework — Ideas

Unrefined basis for a `/spec` run; not yet a plan. The milestone-1 walking-skeleton UI is intentionally minimal — every feature renders into a stacked-graph layout just enough to confirm the data. This milestone designs and builds the real frontend, adds favorites and library polish, and pays off the structural debt deferred from the milestone-1 code review.

## Dashboard + graph consolidation (headline)

- Write a dedicated UI/UX design doc first: visual language, layout, interaction model, component system. The current UI is a replaceable presentation layer, not the final design.
- Dashboard: stacked graphs on a shared time axis, shared zoom/playhead across all lanes, a per-feature Y-axis dropdown.
- Consolidate the zoom/scrub/playhead/wheel interaction code duplicated across `ContinuousGraph` / `EventGraph` / `SegmentGraph` / `HeatmapGraph` into one shared time-axis layer (review finding H-5 / A1).

## Onset derivation from intensity features

- Derive an `onsets` graph/table from any continuous intensity feature (RMS, onset strength, transient sharpness, band energy) via peak-picking, with a user-adjustable intensity cutoff controlling which peaks are recorded as onsets. Interactive: pick the source feature and threshold, regenerate the onsets view live.

## Favorites + library polish

- Favorites UI + persistence (`favorites` field in profile.json — documented in `profile-schema.md`, not yet implemented).
- Metadata editing in the library.
- Library filters (status, missing metadata).
- Better error / retry UX.
- YouTube import — paste a URL, `yt-dlp` → FLAC → the normal import flow.

## Deferred structural debt (from the milestone-1 code review / deslop)

- A2 / L-FE1: move path resolution, audio/`.npy` loading, tag-matrix transforms, and chord-label formatting out of components into `lib/state` or pure helpers (components stay dumb).
- A3: engine-selection resolution leaks into `library.py` (persistence) and is validated twice — move it to a settings/separation helper; `library.py` stores raw JSON only.
- A4: the worker hard-codes disk paths and holds per-feature heatmap metadata that belong in `storage.py` / the feature modules.
- A5: dedupe the `convertFileSrc → fetch → parseNpy` sequence into a `loadNpy(url)` helper in `npy.ts`.
- A6: expose `startSidecarSession()` / `stopSidecarSession()` from `lib/state/sidecar.ts`; the route only calls them.
- A7: send engine labels/capabilities (e.g. which engines produce a drums stem) from the sidecar instead of hard-coding them in `AnalysisSettings`.
- L4: type the chord-event access in `InspectionView` (drop the cast) — do this with A2.

## Also parked

- `docs/ideas.md` — unscoped feature backlog (ensemble separation; swing / harmonic_complexity / roughness / valence / tension WIP features).
