# Mapping — Architecture

## Stack

Unchanged: Tauri 2 shell · Svelte 5 + SvelteKit (static SPA) · Tailwind v4 · uPlot · Python 3.12 sidecar with JSON-lines IPC and the snapshot model.

No new dependencies. OKLCH conversion is ~40 lines of pure math; the live preview is a plain 2-D canvas (one fixture — WebGL waits for the Sim room view).

## Key decisions

- **Shared zoom window lands in transport state (slice 0).** The x-window (`{min, max}` seconds) and follow mode move from per-`TimeAxis` instance into `lib/state/transport.svelte.ts` — finishing what M2's architecture promised. `TimeAxis` becomes a controlled component: `window` prop in, `onWindowChange` callback out; wheel zoom/pan updates shared state and every subscribed lane moves together. Overview lanes opt out (always full extent). The Follow/Reset controls move to the transport bar — one place, not per lane.
- **The evaluator is a pure module, and it is the bake.** `lib/mapping/evaluate.ts`: `(profile data, mapping doc) → per-channel timelines` on the profile's 100 Hz grid — `Float32Array` per continuous channel, segment lists for gates, a per-frame RGB matrix for the pixel row. No state imports, no IPC, no DOM: unit-testable, and writing a cue file later is serializing its output. Evaluation order: program channels → scene enable/scale → adaptive master (`share` mode needs every active program's contribution, which fixes this ordering). Edits re-evaluate only the affected program.
- **OKLCH is the color model.** `lib/color.ts` owns OKLCH→sRGB (with gamut clamping) and the palette definitions; colormaps interpolate in OKLCH so gradients and pitch-class wheels are perceptually even. The `hue` channel is OKLCH hue. RGB conversion happens at the edges only: canvas rendering and, later, hardware output. DOM styling can use CSS `oklch()` directly.
- **The derivation engine is twinned with `sidecar/features/derive.py` deliberately** (the M2 decision, now exercised): `lib/mapping/derive.ts` implements the same threshold primitive client-side — `events` (peak-pick above cutoff) and `segments` (hysteresis gate) — over envelopes already in memory, so cutoff sliders re-derive live with no sidecar round-trip.
- **Graph kit gains renderers, not forks.** `RibbonLane.svelte` is a new renderer over `TimeAxis` (custom draw: lit segments, OKLCH fill, glow-by-brightness, optional exact-value line). The pixel row's 2-D lane reuses the heatmap path via a `buildRgbCanvas` variant that takes the evaluator's RGB matrix instead of a `.npy`. The kit stays free of state and IPC imports.
- **Live preview is canvas + transport clock, outside uPlot.** `LightPreview.svelte` runs a `requestAnimationFrame` loop while playing, samples the evaluated timelines at the playhead time, and draws the swatch + pixel row. Motion primitives (`chase`/`sweep`/`pulse`) are evaluated here and in the pixel lane from the same phase function — parametric animations over pixel index and time, speed from a bound source.
- **Persistence fits the existing IPC model.** Two commands — `mapping.get`, `mapping.update` — and one `mapping` event carrying `{song_id, doc}` with the same stale-song guard the profile event uses. The sidecar writes `library/songs/{uuid}/mapping/mapping.json` atomically (temp + rename), mirroring favorites. No new event channels beyond `mapping`.
- **Schema: zod in front, permissive on sources.** `schema_version` 0.1.0; `derivations` / `programs` / `macro` per `formats.md` (patch and cue omitted — no rig yet). A source dot-path that no longer resolves (e.g. re-analysis with a different engine) warns and mutes that binding — the favorites rule, never a hard failure.
- **Auto-map is a pure function.** `lib/mapping/automap.ts`: profile → starter mapping doc (per-stem programs, heatmap → pixel row, sections → scenes, windowed master). Runs when `mapping.get` finds nothing; the result is saved immediately so the file always exists after first open.
- **State follows the house pattern.** `lib/state/mapping.svelte.ts` holds the doc plus evaluation results; components render state and call actions. Saves are debounced through `mapping.update` — the doc is small, so save-on-edit is cheap.

## Structure

Frontend (`src/lib/`):

- `color.ts` — OKLCH↔sRGB, gamut clamp, palettes. Pure.
- `mapping/` — the engine, all pure and vitest-covered: `schema.ts` (zod + types), `derive.ts` (threshold primitive), `transforms.ts` (normalize/smooth/envelope/colormap/categorical/adaptive), `evaluate.ts` (program → channel timelines, macro layering), `automap.ts` (starter show).
- `state/mapping.svelte.ts` — doc + evaluation cache, editing/persist actions.
- `graphs/RibbonLane.svelte`, `heatmap.ts` RGB-matrix variant — kit additions.
- `components/mapping/` — the tab: sources panel, program list/editor, derivation editor, ribbon stack, light preview, macro panel. Dumb: render state, call actions.

Sidecar (`sidecar/`):

- `mapping.py` — read/validate-lightly/write `mapping.json` (atomic); wired into `__main__` routing. No analysis-pipeline changes.

Tests: vitest over `color`, `derive`, `transforms`, `evaluate`, `automap`, and the mapping state reducers; pytest over `mapping.py` storage (tmp_path, same seams as `test_storage`).

## Breakouts

None.

## Risks / unknowns

- **Evaluation cost at full length.** A 5-minute song is 30k frames × (6 point channels + 60 pixels × RGB) ≈ 5.6 M floats per full evaluation. Typed arrays and per-program incremental re-evaluation should hold at 60 fps authoring; a web worker is the escape hatch if a full re-evaluate ever blocks the UI.
- **Ribbon draw cost.** Per-frame color fill along the time axis is the heatmap problem in one dimension — solved the same way: pre-render each ribbon to an offscreen canvas on evaluation, blit on redraw.
- **`share`-mode master interactions.** Share normalization couples every program's output; degenerate cases (all-quiet, one dominant source) need clamps chosen by ear during implementation.
- **Two render loops.** The rAF preview and uPlot playhead redraws run concurrently while playing; fine for one fixture, but worth measuring before Sim multiplies fixtures.
