# UI Overhaul — Dev Log

Development context for resuming work. Keep entries to one line. Not a changelog.

## Completed

- Slice 1 — Shell + theme tokens: workspace shell (top bar with tabs from a single TABS source + close-song control, collapsible sidebar hosting LibraryPanel/AnalysisSettings, stub tabs), dark-first `@theme` tokens (`app/surface/raised/edge/ink*/accent/danger` + `--spacing-bar`), bits-ui adopted (rail tooltip), A6 (`startSidecarSession`/`stopSidecarSession` with generation-token re-entrancy), InspectionView header/back removed (shell owns title/nav).

- Slice 2 — Global transport: Web Audio engine extracted from InspectionView into `lib/state/transport.svelte.ts` (module-scope runes state; race-guarded via loadToken + playSeq, generation-local buffer cache); `pathForKey`/`playToggle` in inspection state; transport UI (play/pause, clock, active-source, error) in the TopBar; song-change resets wired through open/close + the profile event; shared `formatTime` in `lib/format.ts`.

- Slice 3 — Graph kit core: `lib/graphs/` created — `axis.ts` (pure zoom/pan/follow window math, 19 vitest cases), `TimeAxis.svelte` (uPlot lifecycle, scrub/wheel/playhead/follow, footer — the one interaction implementation), `ContinuousLane`/`EventLane` renderers (ContinuousLane takes `data: number[]`, killing TagsGraph's fake-feature hack); `loadNpy` added to `npy.ts` (A5) and adopted by Heatmap/TagsGraph; legacy ContinuousGraph/EventGraph deleted.

- Slice 4 — Graph kit complete: SegmentLane/HeatmapLane/TagsLanes on the kit; pure helpers extracted (`graphs/heatmap.ts` colormap+offscreen, `graphs/tags.ts` presentRows, `lib/chords.ts` chordLabel — typed narrowing, no casts, L4); `sidecarPath` moved to inspection state (A2); all four legacy graph components deleted.

- Slice 5 — Analysis tab layout: InspectionView rebuilt as the Analysis tab — pinned strip (overview lane on the global playhead + feature search) above a scrolling grouped list; collapsible `Group` component (mix categories open by default, engines collapsed; collapsed = not rendered); search matches feature name + category/engine/stem context and forces matching groups open; unified `featureRow` snippet renders all five modes; tab owns its scroll (shell `main` is overflow-hidden).

- Slice 6 — Favorites: star on every feature row + scalar card (dot-paths per profile-schema); optimistic toggle in inspection state + `favorites.update` IPC; sidecar `write_favorites` (atomic rewrite) and `write_profile` now carries favorites through re-analysis; profile zod gains `favorites` (default []); stale paths warn on load, never fail; pytest coverage in test_storage.py.

- Slice 7 — Onset lanes: `sidecar/features/derive.py` (min-max normalize → scipy find_peaks, 0.3 cutoff, 100 ms separation; 6 pytest cases) attached to every continuous envelope in mix + stem passes; `schema_version` 0.2.0; zod `onsets` optional on continuous; `OnsetDots` kit sub-lane (dots on a baseline, strength → opacity; TimeAxis gained showXAxis/showControls); profile-schema.md updated. Old profiles render without lanes until re-analyzed. A4 deferred (heatmap-metadata relocation — pure cleanup, no functional pull).

## Todo

- [ ] Slice 8 — Analyze popup + engine capabilities
- [ ] Slice 9 — Library management
- [ ] Slice 10 — YouTube import
- [ ] Slice 11 — Split view

## Notes

- Mapping system, Sim, and Hardware are M3+; M2's obligation is architectural only (graph kit reusable for M3 ribbon lanes, global transport, split-capable workspace). Background in `mapping/`, `ui/`, `library/`, `cleanup/`.
- Test infra (vitest/pytest/pre-push hooks) landed via the parallel milestone-3-test-suite work, earlier than M2's plan assumed — slices 3/7 add coverage, not setup.
- ffmpeg is a required system dependency (yt-dlp); documented in README, checked at import.
- Switching off the Analysis tab unmounts InspectionView and stops playback (cleanup verified leak-free); playback surviving tab switches is slice 2 (transport in state).
- LibraryPanel in the 32rem sidebar scrolls horizontally as a stopgap; slice 9 rebuilds the rows for the sidebar for real.
- Graph x-extent (timeline frames) and transport seek clamp (audible buffer) are two deliberate durations; unify consideration belongs to slice 3's kit (`maxTimeSec`).
- Playback now survives tab switches (module-scope transport); the AudioContext is app-lifetime by design.
