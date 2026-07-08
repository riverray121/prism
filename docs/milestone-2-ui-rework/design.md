# UI Overhaul — Design

## Summary

Complete overhaul of the frontend into a project-centric workspace: one song open at a time, worked through pipeline stages presented as tabs. Milestone 2 ships the workspace shell, a rebuilt Analysis tab at full parity with the current inspection view, and the full library experience. The mapping system is milestone 3; this milestone makes the architecture decisions that let it drop in cleanly. Subfeature background: [`ui/`](ui/overview.md), [`mapping/`](../milestone-4-mapping/overview.md) (now milestone 4), [`library/`](library/ideas.md), [`cleanup/`](cleanup/ideas.md).

## How it works

### Workspace

- One song open at a time — the project. Its title sits in the top bar.
- Four tabs across the top: **Analysis** (live in M2) · **Mapping** · **Sim** · **Hardware** (visible, stubbed until their milestones).
- **Split view:** any two tabs side by side; either pane can go fullscreen. Ships working in M2.
- **Global transport:** one play state, playhead, and zoom window owned by the app shell, in the top bar. Every pane renders against the same clock; scrubbing anywhere moves everything.

### Library sidebar

- **Collapsed (default):** a thin rail showing a progress ring per queued/analyzing song and the active song's indicator.
- **Expanded:** the full library — one row per song (title, artist, status), searchable, filterable (status, missing metadata).
- **Plus button:** import via file picker or YouTube URL (downloaded and converted, then the normal import flow).
- **Analyze:** starting analysis opens a configuration popup (engine selection and analysis options).
- Metadata editable from the library. Failed analyses show the error and offer retry.

### Analysis tab

- **Pinned strip (non-scrolling):** the transport's playhead over a song-level overview lane.
- **Below, scrolling:** every feature as a graph lane, locked to the global playhead/zoom. Grouped and collapsible (category → feature → subfeature); searchable by name across mix, stems, and engines.
- **Parity requirement:** every feature, render mode, stem, engine, and heatmap viewable today remains reachable and readable. Presentation changes; access and fidelity do not.
- **Onset lanes:** every continuous feature carries a default onset track, computed during analysis, rendered as a thin dots-on-a-line lane under its parent.
- **Favorites:** a star on every subfeature row, persisted per song. Favorites are the source set for the M3 mapping tab.

### Style

Zed-editor-inspired: minimal chrome that fades behind the content. Flat surfaces, thin borders, no gradients or glass, dense but calm, color reserved for data and status. Dark-first; the light theme derives from the same palette and follows the OS.

## Usage

The working loop: import → configure and analyze → open → review against playback → star. Everything happens against the single shell transport; the sidebar is the only navigation between songs.

## Scope

- In: workspace shell (tabs, split view, transport, sidebar); Analysis tab at full parity plus onset lanes and favorites; library (import incl. YouTube, analyze popup, metadata editing, filters, error/retry); dark-first restyle; structural cleanup of the frontend graph/state layers and sidecar boundaries; per-feature onset generation in the analysis pipeline.
- Out: the mapping system (derivations, programs, patching), Sim, and Hardware — M3+. M2's obligation to them is architectural only: graph rendering reusable beyond the Analysis tab, a global transport, a split-capable workspace, formats not blocked.
- Out: cancel of a running analysis (unchanged from M1).

## Open questions

None.
