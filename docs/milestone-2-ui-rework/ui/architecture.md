# UI Overhaul — Architecture Changes

Backend and format changes the workspace vision requires. Pre-`/spec`; the profile-schema and mapping-format specs are updated for real when this is planned.

---

## Sidecar: default onset generation (pipeline + schema change)

Analysis-tab onset lanes are **computed by the sidecar at analysis time** and persisted in the profile.

- A new extractor pass derives onsets from **every continuous feature** via the threshold primitive (peak-pick, default parameters).
- **Schema:** an optional `onsets` field on the continuous feature envelope — `[{t, strength}]` riding the parent feature, not a separate catalog entry per feature. Minor `schema_version` bump.
- **Migration:** already-analyzed songs lack the field until re-analyzed. The UI renders the lane only when present; no re-analysis is forced.
- Relation to derivations: these are fixed-default, sidecar-computed, per-feature. User-tuned, named, saved derivations (`../../milestone-4-mapping/formats.md`) remain a mapping-doc concept in the frontend. Same primitive, two products.

## Mapping format rework: programs + patching

Approved change to [`../../milestone-4-mapping/formats.md`](../../milestone-4-mapping/formats.md): mappings are authored **fixture-agnostic** and bound to lights separately.

- **Program** (per song, in the mapping doc): named recipe of channel bindings — feature/derivation → transform → abstract channel (`gate`, `brightness`, `hue`, …). No fixture reference.
- **Rig** (app-level, not per song): rooms and their fixtures — id, type, pixel count, position. Shared by Sim and, later, Hardware.
- **Patch** (per song): binds programs to rig fixtures — per light, an **active** program plus a saved **shortlist** of candidates.
- **Compatibility:** a fixture ignores channels its type lacks; any program is auditionable on any light (graceful degradation, maximum applicability).
- **Cue file:** baked from `profile + mapping doc + patch` — per-fixture channel timelines, unchanged in shape.
- **Versioning:** snapshots capture mapping doc + patch together (the whole show for a song).

## Persistence map

| Artifact                                      | Scope           | Location (proposed)                    |
| --------------------------------------------- | --------------- | -------------------------------------- |
| `profile.json` (+ onsets)                     | per song        | `library/songs/{uuid}/` (unchanged)    |
| Mapping doc (programs, derivations, versions) | per song        | `library/songs/{uuid}/mapping/`        |
| Patch (+ its versions)                        | per song        | `library/songs/{uuid}/mapping/`        |
| Cue file + `.npy` sidecars                    | per song, baked | `library/songs/{uuid}/cues/`           |
| Rig (rooms, fixtures)                         | app             | app data dir, `rig.json`               |
| Favorites                                     | per song        | `profile.json` `favorites` (as spec'd) |

## Frontend architecture

- **Global transport in `lib/state`:** one play state + playhead + zoom window, owned by the durable layer; all tabs subscribe. Playback stays Web Audio-driven as today.
- **Workspace state:** open song, active tab(s), split layout, sidebar state — `lib/state`, presentation-free.
- **Modular graph kit:** shared time-axis/zoom/scrub/playhead layer + pluggable renderers (continuous/event/segment/heatmap/tags), consumed by Analysis, Mapping ribbons, and future views. Absorbs the H-5/A1 consolidation and the frontend cleanup items (A2, A5, L4 — [`../cleanup/ideas.md`](../cleanup/ideas.md)).
- **Sim renderer:** real-time room view driven by baked cues (or live-evaluated programs) at the transport clock. Canvas/WebGL; choice made at implementation. Frame budget matters — this is the first real-time render surface in the app.
- **Bake/derive loop:** live threshold re-derivation and program re-baking run in the frontend on profile data already in memory; the sidecar is not in the interactive loop.
