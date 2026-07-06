# UI Overhaul — Dev Log

Development context for resuming work. Keep entries to one line. Not a changelog.

## Completed

- Slice 1 — Shell + theme tokens: workspace shell (top bar with tabs from a single TABS source + close-song control, collapsible sidebar hosting LibraryPanel/AnalysisSettings, stub tabs), dark-first `@theme` tokens (`app/surface/raised/edge/ink*/accent/danger` + `--spacing-bar`), bits-ui adopted (rail tooltip), A6 (`startSidecarSession`/`stopSidecarSession` with generation-token re-entrancy), InspectionView header/back removed (shell owns title/nav).

## Todo

- [ ] Slice 2 — Global transport
- [ ] Slice 3 — Graph kit core
- [ ] Slice 4 — Graph kit complete
- [ ] Slice 5 — Analysis tab layout
- [ ] Slice 6 — Favorites
- [ ] Slice 7 — Onset lanes
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
