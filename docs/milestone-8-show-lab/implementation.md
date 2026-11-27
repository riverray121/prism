# Show Lab — Implementation

Thin vertical slices in build order. Each is independently testable end-to-end.

## Slice 0 — Models

- Goal: beats and downbeats come from Beat This!, BS-Roformer-SW is an engine, and songs can be fetched and analyzed headlessly into a separate library.
- Touches: `sidecar/features/rhythm.py`, `sidecar/models.py`, `sidecar/separation.py`, `sidecar/lab.py`, `storage.set_library_root`.
- Acceptance: pytest on an accented click train gives 120 BPM and bar starts every 2 s; `python -m sidecar.lab --library eval-library list` runs without touching `library/`.
- Out of scope: any frontend change.

## Slice 1 — Algorithm contract and v1

- Goal: auto-map runs through a registry of versioned algorithms, and automatic mode uses the `show_algorithm` setting.
- Touches: `showgen/types.ts`, `registry.ts`, `algorithms/v1-baseline.ts`, `lightstate.ts`, `sidecar/settings.py` (`show_algorithm`), `state/companion.svelte.ts` `processSong`.
- Acceptance: vitest shows that `v1-baseline` on a fixture profile gives the same programs and patch as `autoMap` + `roundRobinPatch`; `sampleLights` matches `solidFrame` and pixel rows at a given time; the setting round-trips in pytest.
- Out of scope: ranking, palettes.

## Slice 2 — Palettes

- Goal: mappings carry a palette that colors their programs, and new docs start on blue.
- Touches: `showgen/palettes.ts`, `color.ts` (hex/RGB → OKLCH), `mapping/schema.ts` (`palette`, `generator`, schema 0.2.0), `sidecar/mapping.py` default doc.
- Acceptance: vitest shows that hex → OKLCH → hex round-trips within 1/255; `applyPalette` gives program i slot i mod n, with the outlier on the accent program; a 0.1.0 doc parses with `palette` absent; a new doc has `{ id: "blue" }`.
- Out of scope: UI.

## Slice 3 — Ranking and v2

- Goal: `v2-ranked` scores candidates, picks N distinct tracks, and builds one program per pick.
- Touches: `showgen/candidates.ts`, `measures.ts`, `select.ts`, `styles.ts`, `algorithms/v2-ranked.ts`.
- Acceptance (vitest, synthetic envelopes):
  - Silence and a 5 s burst are rejected for presence.
  - White noise is rejected for flicker.
  - A 120 BPM click envelope scores pulse > 0.6 and alignment > 0.9; a steady pad scores motion < a bassline's.
  - A scaled copy of a picked stem is never picked.
  - Same-family candidates from two engines yield one pick.
  - The report lists every candidate with every measure.
- Out of scope: roles, fixture kinds.

## Slice 4 — Lab generate and report

- Goal: `pnpm lab generate` and `pnpm lab report` run algorithms over a library and write an HTML comparison.
- Touches: `lab/cli.mjs`, `lab/generate.ts`, `lab/metrics.ts`, `lab/report.ts`, `lab/rooms/demo-room.json`, `package.json` script.
- Acceptance: a run over `eval-library` writes `eval-runs/{name}/{song}/{algorithm}.json` and `index.html`; the drums-only fixture's bleed vocals stem is rejected in the v2 report; metrics are unit-tested on synthetic light outputs.
- Out of scope: video.

## Slice 5 — Simulator core and Sim tab

- Goal: the Sim tab edits saved rooms and plays the open song's room show.
- Touches: `three` dependency, `src/lib/sim/`, `components/sim/`, `sidecar/rooms.py`, sidecar commands `rooms.*` and `sim.get`/`sim.update`, `TabContent.svelte`.
- Acceptance: drag each item kind from the panel into the room and move it; save, rename, duplicate and delete rooms; on a song's first open the room show is generated for the room's lights; reassigning a light persists across reopen; playback lights fixtures in sync with the transport; pytest covers room and sim.json storage.
- Out of scope: video rendering.

## Slice 6 — Headless render

- Goal: `pnpm lab render` writes per-algorithm and 2×2 comparison MP4s with audio.
- Touches: `lab/render/` page, `lab/render.ts`, `playwright-core` dev dependency.
- Acceptance: a 10 s render produces a 30 fps MP4 whose frame count matches; the comparison tile labels name the algorithm; rendering twice gives identical frames.
- Out of scope: in-app recording.

## Slice 7 — v3 roles

- Goal: `v3-roles` assigns pulse, swell and accent roles and places them on suitable fixture kinds, with section-driven color.
- Touches: `algorithms/v3-roles.ts`, `styles.ts`.
- Acceptance: vitest shows that a click-like pick becomes pulse and goes to the strobe when present; a pad becomes swell on a wall washer; the hue binding changes at section boundaries; the mix rms pick becomes the macro master.
- Out of scope: new measures.

## Slice 8 — Mapping refresh

- Goal: the Mapping tab is built around generating a show and adjusting program cards.
- Touches: `components/mapping/` (ShowToolbar, ProgramCard, ProgramSimpleEditor, CandidatesPanel, MappingView), `state/mapping.svelte.ts` (generate with undo, patch from cards).
- Acceptance: Generate replaces the show and Undo restores it; changing a card's style rewrites its bindings; patching from a card updates the Hardware patch; the candidates panel lists the report; the existing editor is under Advanced.
- Out of scope: Hardware tab changes beyond reading the same patch.

## Slice 9 — Corpus comparison

- Goal: comparison videos for 10 songs × 3 algorithms in the demo room.
- Touches: `eval-library` corpus, `eval-runs/`, docs.
- Acceptance: 10 comparison MP4s plus the report exist; feature catalog, profile schema and index docs reflect the milestone.
- Out of scope: picking the default algorithm.
