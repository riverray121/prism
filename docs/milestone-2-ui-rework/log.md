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

- Slice 8 — Analyze popup + engine capabilities: `sidecar/settings.py` owns engine/drum-subsep resolution (single validation site; `library.py` stores raw JSON only — A3); `separation.ENGINE_INFO` (label + drums capability) rides the settings event (A7); bits-ui `AnalyzeDialog` opened per song from Analyze/Re-analyze/Retry buttons, confirms into the queue; standalone AnalysisSettings panel deleted; engine tests migrated to test_settings.py.

- Slice 9 — Library management: LibraryPanel rebuilt as compact two-line sidebar rows (status color, error message on failed, ✎ metadata edit, contextual Analyze/Retry/Cancel); search + status filter + missing-metadata filter; `MetadataDialog` + `library.update_metadata` IPC (DB row + profile.json mirror); `Song.error_message` in snapshot/zod; collapsed rail shows a `ProgressRing` per queued/analyzing song (engine-step fraction; static arc while queued) with title tooltips.

- Slice 10 — YouTube import: `sidecar/youtube.py` (yt-dlp → FLAC, `{uploader} - {title}` filename feeds the existing metadata heuristic; explicit ffmpeg-missing error); `library.import_youtube` command runs on a worker thread (downloads must not block the stdin loop); `ImportDialog` behind the sidebar + button (file picker or URL); `library.lastImportError` surfaces failures in the panel; README documents the ffmpeg prerequisite.

- Slice 11 — Split view: workspace state gains `splitTab` (primary + optional second pane); `TabContent` extracted as the host-agnostic tab renderer; `Pane` (slim per-pane tab picker + fullscreen ⤢) rendered in a two-column grid; ◫ toggle in the top bar (opens with the canonical companion tab); both panes read the one global transport. All 11 slices complete — awaiting user testing of the whole milestone.

- Slice 12 — Test suite landed + coverage review: the parallel milestone-3 suite (pytest harness, 16 sidecar modules, npy/messages vitest, pre-push wiring) committed together with gap-fills from review — `test_rhythm` (click-train onsets/density/beat grid), `test_stem` (stem-type routing + alignment over faked extractors), `test_models` (registry + download/verify/cache), and frontend `format`/`chords`/`graphs/tags`/`graphs/heatmap` tests. 99 pytest + 52 vitest green. Excluded by design: `__main__` IPC plumbing, model-loading E2E, runes/component tests (need a Svelte-plugin vitest config), `buildHeatmapCanvas` (DOM canvas).

- Slice 13 — Feedback pass: window launches maximized with 1100×700 min (no horizontal scrollbar state); lighter Zed-informed palette + blue accent; graphs full-width with bigger lanes (continuous 150, heatmap 190) and 13px axis text; scroll-over-graph fixed (wheel forwards to the nearest scrollable ancestor, not window); global `TransportBar` on every tab (overview lane + play + clock + speed 0.25–1× + "stem → mix" switch; playhead no longer clipped); top bar de-branded with centered stage tabs, hidden while split (stages shown in ≤2 places); split panes scroll (grid-rows minmax fix); Analysis stays mounted across tab switches (state preserved); stems default expanded; pb-32 scroll tail; delete song (confirm dialog, sidecar removes row + folder, refused mid-analysis); analyzed date on rows; import dialog shows an indeterminate download bar via `import_started/finished` events; dsp-mix emits 8 substeps and dsp-stem per-stem steps (rings actually move); `onsets_strict` (prominence-filtered maxima, schema 0.3.0) with a per-lane dense/maxima toggle; onset dot contrast raised (opacity+radius by strength); tooltips on all chrome buttons; bigger click targets. Observability design moved to milestone-4.

- A4 closed post-slice-13: heatmap display metadata moved to its producing feature modules (`frequency.SPECTROGRAM_HEATMAP` / `timbre.MFCC_HEATMAP` / `tonal.CHROMA_HEATMAP`), envelope + `heatmaps/{name}.npy` path convention centralized in `storage.heatmap_envelope`/`heatmap_rel`; the worker only wires producers. Every M1 structural-debt item (A1–A7, L4, L-FE1) is now resolved.

- SHIPPED: user tested the full milestone and approved. The repo-wide `/clean` pass was deliberately deferred to the start of the next milestone.

## Todo

(none — milestone shipped)

## Notes

- Mapping system, Sim, and Hardware are M3+; M2's obligation is architectural only (graph kit reusable for M3 ribbon lanes, global transport, split-capable workspace). Background in `mapping/`, `ui/`, `library/`, `cleanup/`.
- Test infra (vitest/pytest/pre-push hooks) landed via the parallel milestone-3-test-suite work, earlier than M2's plan assumed — slices 3/7 add coverage, not setup.
- ffmpeg is a required system dependency (yt-dlp); documented in README, checked at import.
- Switching off the Analysis tab unmounts InspectionView and stops playback (cleanup verified leak-free); playback surviving tab switches is slice 2 (transport in state).
- LibraryPanel in the 32rem sidebar scrolls horizontally as a stopgap; slice 9 rebuilds the rows for the sidebar for real.
- Graph x-extent (timeline frames) and transport seek clamp (audible buffer) are two deliberate durations; unify consideration belongs to slice 3's kit (`maxTimeSec`).
- Playback now survives tab switches (module-scope transport); the AudioContext is app-lifetime by design.
