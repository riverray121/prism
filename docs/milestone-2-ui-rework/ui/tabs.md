# The Four Tabs

Stages of working a song, left to right. Any single tab fullscreen, or any two split.

---

## Analysis

The song's extracted features, reviewed against playback. Successor to the milestone-1 inspection view.

**Layout**

- **Pinned strip (does not scroll):** the global transport's playhead rendered over a song-level overview lane (waveform or RMS). Always visible.
- **Below, scrolling:** the feature list — every graph locked to the global playhead/zoom, as today.

**Feature list**

- Features grouped and **collapsible** (category → feature → subfeatures); collapsed rows show just name + a sparkline-height preview.
- **Searchable**: filter the list by name across mix, stems, and engines.
- Expanding a feature reveals its subfeatures (per-stem variants, dimensions).
- **Favoriting** on every subfeature row (star). Favorites are the gateway to Mapping: only favorited subfeatures appear there as sources. The Analysis|Mapping split is the curation workflow — favorite left, source appears right.

**Graph system — modular, zero loss**

- The graph layer is rebuilt as a **modular kit**: one shared time-axis/zoom/scrub/playhead layer (the H-5/A1 consolidation, see [`../cleanup/ideas.md`](../cleanup/ideas.md)) with pluggable renderers per render mode — continuous, event, segment, heatmap, tags.
- **Parity requirement: nothing currently visualizable is lost.** Every feature, render mode, stem, engine, and heatmap available in the milestone-1 UI must be reachable and readable in the new Analysis tab. Presentation may change; access and fidelity may not.
- The same kit is consumed by Mapping (ribbon lanes) and by future tabs — build it as the product's graph library, not as Analysis-tab internals.

**Onset lanes**

- Every continuous feature carries a sidecar-computed default onset track (see `architecture.md`): rendered as a thin **dots-on-a-line lane** under the parent subfeature, sharing its playhead. Visually minimal — smaller than event tick lanes.

## Mapping

Authoring **programs** — fixture-agnostic mapping recipes — from favorited features. The interaction model realizes the [`mapping docs`](../../milestone-4-mapping/overview.md) doc set.

- **Sources:** the favorited subfeatures (plus saved derivations). Curated in Analysis; extendable live via split view.
- **Authoring:** create/edit programs (feature → transform → abstract channel), tune derivations (threshold cutoff, mode) with live re-derivation, manage versions/snapshots.
- **Preview:** lit-ribbon lanes per program (`../../milestone-4-mapping/visualization.md`) on the shared time axis, against the global transport.
- Programs bind to no light here — patching happens in Sim/Hardware.

## Sim

Simulated rig: patch programs onto virtual lights, position them in a room, and watch the show against playback. This is the Stage-3 controller, pointed at a simulator backend.

Two levels:

- **Fixture focus:** pick one simulated light from the rig list; audition programs on it; keep a **shortlist** of candidate programs per light (saved). Rapid what-if per fixture.
- **Room view:** all lights of a room, positionable (drag to arrange). Each light has a dropdown selecting its **active** program from the compatible set. Press play on the global transport → the room animates live with the song.

Rooms and their fixtures are app-level (reusable across songs); which program each light plays is per-song (the patch). See `architecture.md`.

## Hardware

Deliberately TBD. The tab exists as a stub: same patch model as Sim, pointed at real fixtures through a to-be-designed hardware interface (discover/connect real lights, map rig fixtures to device channels, play the cue file out). Designing the sim patch model to be backend-agnostic is what keeps this tab cheap later.
