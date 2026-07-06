# UI Overhaul — Implementation

Thin vertical slices in build order. Each is independently testable end-to-end.

## Slice 1 — Shell + theme tokens

- Goal: the workspace frame exists — dark-first look, tabs, sidebar shell — with current functionality intact inside it.
- Touches: `app.css` (tokens via `@theme`, dark-first + `light-dark()`), bits-ui added, new shell components (top bar with song title + four tabs, collapsible sidebar frame), route composition; A6 (sidecar session start/stop exposed from `lib/state`).
- Acceptance:
  - App boots into the new shell: top bar, tab row, sidebar rail.
  - Analysis tab hosts the existing inspection view, fully functional; Mapping/Sim/Hardware show stub states.
  - Sidebar expands/collapses; the existing library list and import live in the expanded state.
  - Dark theme applies app-wide; light mode still derives via the OS.
- Out of scope: transport, new graphs, split view, library polish.

## Slice 2 — Global transport

- Goal: one play state, playhead, zoom window, and follow mode owned by `lib/state`, controlled from the top bar.
- Touches: new `lib/state/transport`, top-bar transport controls, `InspectionView` (playback/audio ownership removed), graph components (fed from transport state).
- Acceptance:
  - Play/pause/seek from the top bar; playhead sweeps all graphs as today.
  - Scrubbing on any graph updates the shared playhead; zoom/follow behavior is at parity.
  - No component owns audio buffers or playback state.
- Out of scope: graph internals, pinned overview strip.

## Slice 3 — Graph kit core

- Goal: the shared time-axis interaction layer exists, with continuous and event renderers running on it.
- Touches: new `lib/graphs/` (interaction layer + continuous/event renderers), Analysis lanes for those modes switched to the kit, `loadNpy` helper (A5), vitest setup with tests for the interaction math.
- Acceptance:
  - Continuous and event features render via the kit with zoom/scrub/wheel/playhead at parity.
  - Interaction logic exists in exactly one place; renderers contain none.
  - `pnpm test` runs the kit's tests green.
- Out of scope: segment/heatmap/tags renderers, deleting old components.

## Slice 4 — Graph kit complete

- Goal: every render mode runs on the kit; the old graph components are gone.
- Touches: segment/heatmap/tags renderers in `lib/graphs/`, removal of the four legacy graph components, A2/L4 (path resolution, `.npy`/audio loading, tag-matrix transforms, chord-label formatting out of components; typed chord events).
- Acceptance:
  - All feature types render via the kit at parity (spot-check against an analyzed song: every mix feature, stems per engine, heatmaps, tags).
  - No legacy graph component remains; components contain no loading or transform logic.
- Out of scope: Analysis-tab layout changes.

## Slice 5 — Analysis tab layout

- Goal: the new Analysis tab structure — pinned strip, collapsible grouped lanes, search.
- Touches: Analysis tab components (pinned overview lane + playhead strip, category → feature → subfeature collapsible groups, name search across mix/stems/engines), lazy mounting of collapsed lanes.
- Acceptance:
  - Pinned strip stays fixed while the feature list scrolls; all lanes stay locked to the global playhead/zoom.
  - Groups collapse/expand; search filters the list; collapsed lanes cost no render time.
  - Parity audit passes: every feature reachable in the M1 UI is reachable here.
- Out of scope: favorites, onset lanes.

## Slice 6 — Favorites

- Goal: subfeatures can be starred; stars persist in the profile.
- Touches: star affordance on lane headers, favorites in `lib/state`, new IPC command for persisting favorites, sidecar write path into `profile.json` (`favorites` per `profile-schema.md`), zod/pydantic schemas.
- Acceptance:
  - Starring/unstarring updates immediately and survives app restart.
  - Broken favorite paths (removed feature) warn without breaking profile load.
- Out of scope: any mapping-tab consumption of favorites.

## Slice 7 — Onset lanes

- Goal: every continuous feature gets a sidecar-computed default onset track, rendered as a dots lane.
- Touches: `sidecar/features/derive.py` (threshold/peak-pick primitive + pass over continuous features), profile envelope + `schema_version` minor bump, `profile-schema.md`, zod schema, onset-dots renderer in the kit; A4 (worker paths/heatmap metadata into `storage.py`/feature modules); pytest setup with tests for the primitive.
- Acceptance:
  - Analyzing a song yields an onset lane under each continuous feature, dots at plausible peaks.
  - Profiles analyzed before the change load and render without lanes.
  - `uv run pytest` runs the derive tests green.
- Out of scope: user-tunable thresholds (M3 derivations).

## Slice 8 — Analyze popup + engine capabilities

- Goal: starting analysis opens a configuration dialog driven by sidecar-declared engine data.
- Touches: bits-ui dialog for analysis config, sidecar settings event extended with engine labels/capabilities (A7), engine-selection resolution moved out of `library.py` into a settings/separation helper (A3), removal of the standalone settings panel.
- Acceptance:
  - Clicking analyze opens the popup; engine list and options come from the sidecar, nothing hard-coded in the frontend.
  - Confirming queues analysis with the chosen configuration; current settings behavior is at parity.
- Out of scope: import flows.

## Slice 9 — Library management

- Goal: the expanded sidebar is a full library manager.
- Touches: library rows (status display, progress ring in the collapsed rail), search + filters (status, missing metadata), metadata edit dialog + IPC command, failed-analysis error display + retry command.
- Acceptance:
  - Collapsed rail shows a progress ring per queued/analyzing song.
  - Search and filters narrow the expanded list; metadata edits persist and reflect immediately.
  - A failed song shows its error and can be retried from the row.
- Out of scope: YouTube import.

## Slice 10 — YouTube import

- Goal: paste a URL, get an analyzed-ready song in the library.
- Touches: yt-dlp in the sidecar, download/convert path feeding the existing import flow, import dialog (file picker + URL field) behind the sidebar plus button, ffmpeg presence check with a clear error, README getting-started note.
- Acceptance:
  - A YouTube URL imports to a playable library song with metadata; the file path route still works.
  - Missing ffmpeg produces an actionable error, not a crash.
  - README documents the ffmpeg requirement.
- Out of scope: playlist import, other sites.

## Slice 11 — Split view

- Goal: any two tabs side by side, either fullscreenable.
- Touches: workspace state (tab layout single/pair), split host in the shell, split/fullscreen controls.
- Acceptance:
  - Two panes render two tabs simultaneously, both locked to the global transport (scrub in one, the other follows).
  - Either pane can go fullscreen and back; single-tab mode is unchanged.
- Out of scope: per-pane transports, remembering layouts per song.
