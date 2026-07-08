# Dev Log

## Completed

- [x] Slice 0 — Shared zoom window (M2 debt): x-window + follow mode lifted into `transport.svelte.ts` (`view` state), `TimeAxis` converted to a controlled component (`window` prop in, `onWindowChange` out, footer controls removed), all lane renderers thread the shared window, Follow/Reset moved to the transport bar, overview lane opts out (full extent).

- [x] Slice 1 — Color module: `lib/color.ts` — OKLCH→sRGB with chroma-bisect gamut clamp, `mixOklch`/`gradient` interpolating in OKLCH (shortest-path hue), pitch wheel + warm↔cool + section palettes, named `PALETTES` for the colormap transform.

- [x] Slice 2 — Mapping doc schema + persistence: `lib/mapping/schema.ts` (zod 0.1.0: derivations/programs/macro with defaults, `sourceResolves` warn-and-mute helper), `sidecar/mapping.py` (atomic read/write under `songs/{uuid}/mapping/mapping.json`; `storage.write_json_atomic` made public), `mapping.get`/`mapping.update` commands + `mapping` event with the profile-style stale guard, `lib/state/mapping.svelte.ts` (load on song open via `inspection.open`, debounced full-doc saves through `touchDoc`, flush on song switch).

- [x] Slice 3 — Derivations: engine + editor: `lib/mapping/derive.ts` (events peak-pick with plateau/min-separation semantics twinned with `sidecar/features/derive.py`, segments hysteresis gate releasing at 0.8×cutoff, strengths carried through), `lib/mapping/sources.ts` (dot-path resolution + favorite listing + labels), Mapping tab replaces the stub (`components/mapping/`: MappingView, SourcesPanel with favorites + derivations, DerivationEditor with cutoff slider/mode toggle/live preview through Continuous+Onset/Segment lanes on the shared window), derivation CRUD actions + `mappingUi` selection state.

- [x] Slice 4 — Transforms + evaluator (point channels): `lib/mapping/transforms.ts` (normalize clamp+gamma/log, O(n) box smooth, per-event attack-hold-decay envelope with max-combine, colormap component extraction + RGB variant, categorical label spreading), `lib/mapping/evaluate.ts` (source materialization incl. `derived.*`, silent normalize+smooth on continuous→brightness, hue degree semantics, gate from segments/event-pulses/auto-threshold, per-program cache keys with `evaluateDoc` reuse so one edit re-evaluates one program), program CRUD actions + `evaluation` output store in mapping state.

- [x] Slice 5 — Program editor + ribbon preview: `graphs/ribbon.ts` + `RibbonLane.svelte` (lit runs from gate, OKLCH fill from hue/saturation or color_temp, brightness as glow/alpha, toggleable exact-value line; frameCount×1 offscreen strip blitted like heatmaps), `components/mapping/` ProgramList (enabled toggles, dim when muted) + ProgramEditor (per-channel source/constant rows, transform chains behind a disclosure via TransformEditor) + ribbon Preview stack in MappingView on the shared window/transport, re-evaluation `$effect` (doc snapshot deps + raw-profile seam so the evaluator skips $state proxy overhead).

- [x] Slice 6 — Pixel dimension + motion: evaluator position mappings (heatmap row→pixel via caller-provided matrices, `band_energy_*` sibling stacking into zones, continuous→center-out spread), motion primitives (`chase`/`sweep`/`pulse` as the pure `motionPhase` over accumulated cycles; speed from constants, bpm scalars, or normalized continuous sources), per-frame RGB pixel matrix (palette LUT for position, program `channelColor` for motion-only), `buildRgbCanvas` heatmap variant + `PixelLane.svelte` (pixel × time) in the preview stack, on-demand .npy matrix loading in mapping state (cache keys include loaded matrices), position/motion rows + motion transform step in the editors, `channelColor` shared with the ribbon.

- [x] Slice 7 — Live light preview: `components/mapping/LightPreview.svelte` — canvas swatch (glow scales with composite intensity, strobe as a square wave) + pixel row (additive blend of pixel matrices, swatch mirror when none), all enabled programs blended additively, rAF loop only while playing with effect-cleanup on unmount/pause, static frame at the playhead when paused (redraws on scrub and re-evaluation); mounted beside the editor in the Mapping tab.

- [x] Slice 8 — Macro layer: `applyMacro` in the evaluator (order: programs → scene enable/scale → adaptive master; scene presets per section label with exact boundary frames and gate cutting so a scene-muted program reads as off; `absolute` = song max, `windowed` = O(n) rolling-max deque, `share` = per-program brightness ÷ total with an all-quiet clamp; pixel matrices dimmed too; identity-preserving with per-program final reuse — share couples all keys), two-level cache in mapping state (raw per-program + macro finals), `MacroPanel.svelte` behind a disclosure (scenes-from picker over segment favorites, per-label presets with program checkboxes + scale, master mode/source/window controls).

## Todo

- [ ] Slice 9 — Auto-map (on demand)

## Notes

- The repo-wide `/clean` deferred from M2 is deferred again to M5 (user call at slice-0 time); M4 is slice work only.
- Decisions made at spec time: generic fixture includes the pixel dimension and motion primitives; mini live preview lives in the Mapping tab; full macro layer in; OKLCH color model; `quantize` transform deferred; cue files deferred (the evaluator is the bake).
- Sources are favorites-only everywhere — programs, derivations, and auto-map all draw from the starred subfeatures. Auto-map is strictly on-demand (Generate button): hand authoring is the primary flow, songs open with an empty doc, and a generate never removes or rewrites existing entries.
