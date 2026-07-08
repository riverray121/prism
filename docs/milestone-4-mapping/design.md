# Mapping — Design

## Summary

The Mapping tab becomes real: author **derivations** and **programs** from favorited features, evaluate them live in the frontend, and confirm the result against playback as lit-ribbon lanes plus a live light preview. Everything targets one built-in **generic fixture** that implements every channel — programs stay fixture-agnostic per [`formats.md`](formats.md), but with a single all-channel light there is no rig, no patching, and no cue file yet. Opening a song starts from a working **auto-mapped show**, never a blank canvas. The macro layer ships: scenes driven by `sections` and the adaptive master.

Seed docs: [`overview.md`](overview.md), [`catalog.md`](catalog.md), [`formats.md`](formats.md), [`visualization.md`](visualization.md).

## How it works

### The generic fixture

One built-in fixture, always present, no rig UI:

- **Point channels:** `gate`, `brightness`, `hue`, `saturation`, `color_temp`, `strobe_rate`.
- **Pixel dimension:** the fixture is also an N-pixel strip (configurable count, default 60), so `position` mappings work — heatmaps (spectrogram/chroma/mfcc) map row → pixel, band energies map to zones, `stereo_width` maps to spread.
- **Motion:** `chase` / `sweep` / `pulse` primitives rendered over the pixel row; speed bindable (e.g. `bpm`, `rhythmic_density`).

Programs bind to abstract channels only; the generic fixture happens to implement all of them. Future fixture types ignore channels they lack (graceful degradation, unchanged from `formats.md`).

### Mapping tab

- **Sources panel:** favorited subfeatures (curated in Analysis; extendable live via the Analysis|Mapping split) plus saved derivations.
- **Program editor:** create/edit programs — pick source + channel, done; transform chains sit behind an advanced affordance with silent defaults (continuous → brightness gets `normalize` + `smooth`). Constants for static channels. `enabled` toggle per program.
- **Derivation editor:** threshold any continuous feature into `events` (peak-pick) or `segments` (hysteresis gate); cutoff slider re-derives live. Derivations are named, saved, valid with zero consumers, deleted only explicitly.
- **Preview — ribbon lanes:** one lit ribbon per program on the shared time axis against the global transport: lit runs = gate + duration, fill = hue/saturation, glow/opacity = brightness, thin exact-value overlay on demand. Pixel-dimension output renders as a 2-D lane (pixel × time) through the heatmap renderer.
- **Preview — live light:** a rendered generic light (glowing swatch + pixel row) animating at the transport clock. Ribbons diagnose; this confirms feel.

### Evaluation

Edit → re-evaluate → redraw, entirely in the frontend on profile data already in memory; the sidecar is not in the interactive loop. The evaluator renders `profile + mapping doc` to per-channel timelines on the profile's 100 Hz grid — the same computation a cue-file bake will run later, kept pure so the bake is a serialization step when Sim/Hardware need it.

### Transforms (v1)

`normalize` (min/max clamp + gamma/log curve), `smooth`, `threshold` (via derivations), `envelope` (attack-hold-decay giving onsets duration), `colormap` (scalar → palette), `categorical` (label → value; chord root → hue), `adaptive` (master modes). Deferred: `quantize`.

### Macro layer

- **Scenes from `sections`:** a scene is a per-section-label preset — which programs are enabled plus a master scale. Section boundaries switch presets; the auto-map seeds one scene per detected section label. Fuller palette-swap semantics come with multi-fixture shows.
- **Adaptive master:** one master brightness over everything, reference selectable — `absolute` / `windowed` (default, few-second window) / `share`.

### Auto-map

Opening a song with no mapping doc generates a working show: per-stem programs (`{stem}_energy` → brightness smoothed, drum onsets → gate, `spectral_centroid` → color_temp), a heatmap → pixel-row program, `sections` → scenes, adaptive master on. The user edits a working show.

### Persistence

Mapping doc per song at `library/songs/{uuid}/mapping/mapping.json` (`schema_version`, `derivations`, `programs`, `macro` — `formats.md` shape minus patch/cue). Zod-validated in the frontend; sidecar gains read/write commands with atomic rewrite, mirroring `favorites`.

### Prerequisite: shared zoom window (M2 debt)

M2 promised the zoom window and follow mode in the durable state layer; both live per-`TimeAxis` instance today. Ribbon-vs-source comparison needs every lane on one window, so slice 0 lifts the x-window + follow mode into shared state and converts `TimeAxis` to controlled-window props.

## Usage

Open an analyzed song → the auto-mapped show plays: ribbons under the transport, the light animating. Scrub, watch, then tune — drag a derivation cutoff, swap a source, tweak a colormap — and see ribbons and light update instantly. Star more features in the Analysis|Mapping split to widen the source palette.

## Scope

- In: generic fixture (all point channels + pixel dimension + motion primitives), derivations with live re-derivation, programs + v1 transform chains, frontend evaluator on the 100 Hz grid, ribbon lanes + 2-D pixel lane + live light preview, auto-map starter show, macro layer (scenes + adaptive master), mapping-doc persistence via sidecar, shared zoom window (slice 0).
- Out: rig/rooms and rig UI, patching, the Sim tab (the live preview lives in Mapping), Hardware, on-disk cue files + cue `.npy` sidecars, versioning/snapshots (`enabled` covers muting), additional fixture types, `quantize` transform, true note-duration extraction.

## Open questions

None. (Color model: OKLCH — decided in [`architecture.md`](architecture.md).)
