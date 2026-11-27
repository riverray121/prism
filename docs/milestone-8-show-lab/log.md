# Show Lab — Dev Log

Development context for resuming work. Keep entries to one line. Not a changelog.

## Completed

- Slice 0 — Models: Beat This! beats/downbeats (CPU, ~1.5 s per song, checkpoint in the model registry), `bs_roformer_sw` engine, `sidecar/lab.py` fetch/add/analyze/list on `--library`, `storage.set_library_root`, RMS envelopes carry `scale` (raw peak), drum sub-separation once per song on the first drums engine.
- Slice 1 — Algorithm contract and v1: `showgen/types.ts`, `registry.ts`, `algorithms/v1-baseline.ts` (autoMap + round-robin + palette), `lightstate.ts` (`evaluateForLights`, `sampleLights`), `rig.ts`; `show_algorithm` setting (sidecar + companion dialog select); `processSong` loads every candidate track (`requestCandidateTracks`) and calls `generateShow`.
- Slice 2 — Palettes: `showgen/palettes.ts` (12 palettes + single color, hex→OKLCH, `applyPalette` with outlier on the accent program), `MappingDoc.palette` (default blue) and `generator`, schema 0.2.0.
- Slice 3 — Ranking and v2: `candidates.ts`, `measures.ts` (FFT modulation spectrum, pulse clarity, alignment, contrast, section contrast, level, leak, flicker), `select.ts` (score, MMR), `styles.ts`, `algorithms/v2-ranked.ts`; synthetic tests.
- Slice 4 — Lab generate and report: `lab/cli.mjs` (Vite `ssrLoadModule`), `lab/library.ts`, `generate.ts`, `metrics.ts` (visible change, distinctness, beat alignment, dark time, per light), `report.ts` (HTML), `pnpm lab`.
- Slice 5 — Simulator core and Sim tab: `src/lib/sim/` (room schema, fixtures, furniture, scene with bloom + area/spot lights, editor with Orbit/TransformControls, placement and wall snap, room shows), `sidecar/rooms.py` (`rooms.*`, `sim.get`/`sim.update`), Sim tab components, `lab/rooms/demo-room.json`.
- Slice 6 — Headless render: `lab/render.ts` (Vite server + playwright-core on system Chrome, ANGLE Metal, stepped 30 fps, JPEG pipe to ffmpeg with the audio excerpt), `lab/render/` page (one scene per algorithm, 2×2 grid with an info panel). About 45 rendered frames per second at 1920×1080.
- Slice 7 — v3 roles: `algorithms/v3-roles.ts` (visible measure, roles, fixture placement, section-stepped hue via categorical on `mix.sections`, section loudness scenes).
- Slice 8 — Mapping refresh: ShowToolbar (algorithm, palette popover, Generate with one-level Undo), ProgramCards (swatch, style chip, role, light chips, level bar), ProgramSimpleEditor (source by score, style, color, floor/peak/smoothing, Advanced = ProgramEditor), CandidatesPanel, `showgen/edit.ts`; AutoMapButton and ProgramList removed.

- Lab findings: v3 put a sparse accent (mix air band) on the TV backlight, which stayed dark (v4 adds the output check); the drums-only song's htdemucs "vocals" passed v2-v4 because it is −68 dB bleed normalized to full scale (v5 adds the level floor); v4's check measured palette brightness until it ran in neutral white.
- Live palette and algorithm changes: `recolorPrograms` keeps section-bound hue maps and assignments; the Sim tab recolors or regenerates the room show on change.

## Todo

- [x] Slice 0 — Models
- [x] Slice 1 — Algorithm contract and v1
- [x] Slice 2 — Palettes
- [x] Slice 3 — Ranking and v2
- [x] Slice 4 — Lab generate and report
- [x] Slice 5 — Simulator core and Sim tab
- [x] Slice 6 — Headless render
- [x] Slice 7 — v3 roles
- [x] Slice 8 — Mapping refresh
- [ ] Slice 9 — Corpus comparison

## Notes

- prism-player recolors shows on playlists that declare a palette (`palettes.py`, indie-dusk). Its recolor keeps each pixel's value and replaces the color, so a Prism palette on such a show is overridden on the Pi.
- The lab corpus lives in `eval-library/` (gitignored), analyzed with every engine plus drum sub-separation.
- Profiles analyzed before `scale` existed cannot be checked for stems louder than the mix (`level`), so bleed detection on them relies on `leak` only.
- A bound hue track is 0–1 of a turn (the evaluator multiplies by 360); only hue constants are degrees.
- The Sim tab's drag uses mouse events, not HTML5 drag-and-drop, because Tauri's file-drop handling intercepts the latter. It is untested in the Tauri window.
- Changing the palette from the Mapping toolbar replaces v3's section-stepped hue bindings with fixed colors.
