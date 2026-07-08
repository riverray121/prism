# Mapping — Implementation

Thin slices in build order. Each leaves the suite green. The repo-wide `/clean` deferred from M2 runs before slice work begins.

## Slice 0 — Shared zoom window (M2 debt)

- Goal: every lane renders one shared time window; zoom/pan anywhere moves all lanes.
- Touches: `lib/state/transport.svelte.ts` (x-window `{min, max}` + follow mode + actions), `graphs/TimeAxis.svelte` (controlled: `window` prop + `onWindowChange`, follow logic reads shared mode; footer controls removed), `components/shell/TransportBar.svelte` (Follow/Reset controls; overview lane stays full-extent), Analysis tab lanes (pass the shared window).
- Acceptance: wheel-zoom on any Analysis lane moves every lane and survives tab switches; overview stays full-extent; double-click reset works from the transport bar; transport/axis vitest updated and green.

## Slice 1 — Color module

- Goal: OKLCH color math the rest of the milestone builds on.
- Touches: `lib/color.ts` — OKLCH→sRGB with gamut clamp, palette definitions (pitch wheel, warm↔cool ramp, section palettes), gradient interpolation in OKLCH; `color.test.ts`.
- Acceptance: known conversion values match reference (white/black/primaries within tolerance); out-of-gamut chroma clamps instead of overflowing; pitch wheel yields 12 distinct hues at equal lightness.

## Slice 2 — Mapping doc schema + persistence

- Goal: a mapping doc round-trips song ↔ disk through the sidecar.
- Touches: `lib/mapping/schema.ts` (zod: `schema_version` 0.1.0, `derivations`, `programs`, `macro`; source dot-path validation warn-and-mute on non-resolving paths), `sidecar/mapping.py` (read/write atomic under `songs/{uuid}/mapping/mapping.json`), `__main__` routing (`mapping.get`, `mapping.update`), `ipc/messages.ts` (`mapping` event with stale-song guard), `lib/state/mapping.svelte.ts` (load on song open, debounced save).
- Acceptance: pytest covers write/read/atomicity/missing-file; vitest covers schema defaults, bad-path muting, stale-event drop; a hand-written doc survives a full round-trip unchanged.

## Slice 3 — Derivations: engine + editor

- Goal: named derivations authored live from any continuous feature.
- Touches: `lib/mapping/derive.ts` (threshold primitive: `events` peak-pick / `segments` hysteresis, strength carried through; algorithm twinned with `sidecar/features/derive.py`), Mapping tab skeleton replacing the stub (`components/mapping/`: sources panel listing favorited subfeatures + derivations, derivation editor with cutoff slider + mode toggle), preview of a derivation through the existing event/segment lanes on the shared window.
- Acceptance: `derive.test.ts` — a drum-roll-like envelope yields N events not one, hysteresis produces stable segments, strengths are peak values; slider drag re-derives live against playback; derivations persist and reload; deleting is explicit (a consuming program never deletes one).

## Slice 4 — Transforms + evaluator (point channels)

- Goal: programs evaluate to point-channel timelines on the 100 Hz grid.
- Touches: `lib/mapping/transforms.ts` (`normalize` clamp+curve, `smooth`, `envelope` attack-hold-decay, `colormap` via `color.ts`, `categorical`), `lib/mapping/evaluate.ts` (bindings + constants → `Float32Array` per channel + gate segments; per-program incremental re-eval), program CRUD actions in mapping state.
- Acceptance: `transforms.test.ts` + `evaluate.test.ts` on synthetic envelopes — default `normalize`+`smooth` applied silently to continuous→brightness, envelope gives events duration, constants pass through, editing one program re-evaluates only it.

## Slice 5 — Program editor + ribbon preview

- Goal: the authoring loop is real: edit a program, see the ribbon change against playback.
- Touches: `graphs/RibbonLane.svelte` (lit segments from gate, OKLCH fill from hue/saturation, glow/opacity from brightness, toggleable exact-value line; pre-rendered offscreen, blitted per redraw), `components/mapping/` program list + editor (source + channel picker up front, transform chain behind an advanced disclosure, constants, `enabled` toggle), ribbon stack on the shared window + global transport.
- Acceptance: a kick-gate + energy-brightness program reads correctly as a ribbon (lit runs at hits, glow follows energy); edits update the ribbon without a reload; disabled programs dim in the list and drop from preview; scrubbing the ribbon drives the global playhead.

## Slice 6 — Pixel dimension + motion

- Goal: the generic light's 60-pixel strip works: spatial mappings and motion primitives.
- Touches: `evaluate.ts` (position mappings: heatmap row→pixel, `band_energy_*`→zones, `stereo_width`→spread; per-frame RGB matrix), motion primitives (`chase`/`sweep`/`pulse` as a pure phase function over pixel index + time, speed bindable), `graphs/heatmap.ts` `buildRgbCanvas` variant, 2-D pixel lane (pixel × time) in the preview stack.
- Acceptance: evaluator tests — a synthetic heatmap lands on the right pixels, spread widens with `stereo_width`, chase phase advances at bound speed; the pixel lane renders the evaluated matrix on the shared window.

## Slice 7 — Live light preview

- Goal: the "feel" check — a rendered generic light animating with playback.
- Touches: `components/mapping/LightPreview.svelte` (canvas: glowing swatch + pixel row; rAF loop while playing, samples evaluated timelines at the transport playhead, same motion phase function as slice 6), mounted in the Mapping tab beside the ribbon stack.
- Acceptance: preview tracks playback and scrubbing with no visible lag; strobe/gate flashes land on the audio; paused = static frame at playhead; no rAF leak on tab switch (loop stops when unmounted).

## Slice 8 — Macro layer

- Goal: scenes from `sections` and the adaptive master over everything.
- Touches: `evaluate.ts` (layering: programs → scene enable/scale → master; `adaptive` modes `absolute`/`windowed`/`share`), `schema.ts` (`macro` block), `components/mapping/` macro panel (scene presets per section label: program enables + master scale; master mode + window controls).
- Acceptance: evaluator tests — section boundary switches presets exactly at the boundary frame, `windowed` normalizes to a rolling max, `share` splits brightness across simultaneously active programs and clamps degenerate all-quiet cases; ribbons and preview reflect the macro result.

## Slice 9 — Auto-map

- Goal: opening a song never lands on a blank canvas.
- Touches: `lib/mapping/automap.ts` (profile → starter doc: per-stem energy→brightness + drum-onset→gate + centroid→color_temp programs, one heatmap→pixel-row program, sections→scenes, windowed master), mapping state (run when `mapping.get` returns nothing, save immediately).
- Acceptance: `automap.test.ts` over a synthetic profile — programs reference only paths that exist (missing stems/features skipped cleanly), output validates against the schema; first open of an analyzed song shows a working show; an existing `mapping.json` is never overwritten.
