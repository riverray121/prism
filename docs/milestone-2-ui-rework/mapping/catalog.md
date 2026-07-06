# Mapping Catalog

Every viable feature → channel mapping, grounded in `../../feature-catalog.md`. Organized by target channel — the authoring question is "what should drive color?", not "where can RMS go?".

Pattern: **continuous → brightness / color / position; events → gates; segments → scenes; scalars → constants.**

---

## → `gate` / trigger

| Source               | Behavior                                                      |
| -------------------- | ------------------------------------------------------------- |
| `beats`, `downbeats` | pulse on beat; downbeat = bigger accent                       |
| `{stem}_onsets`      | per-stem trigger (kick → strobe, vocal phrase → flash)        |
| derivations          | trigger from any continuous feature via threshold (see below) |
| `silence`            | blackout regions                                              |
| `rhythmic_density`   | strobe rate / chase speed                                     |
| `novelty`            | accent flash on new material                                  |

## → `brightness`

| Source                         | Behavior                               |
| ------------------------------ | -------------------------------------- |
| `rms`, `peak`, `loudness_lufs` | master brightness                      |
| `{stem}_energy`                | per-fixture brightness (the workhorse) |
| `band_energy_*`                | brightness of band-assigned fixtures   |
| `dynamic_range` (scalar)       | show-wide contrast constant            |

## → `hue` / `saturation` / `color_temp`

| Source                          | Behavior                                                         |
| ------------------------------- | ---------------------------------------------------------------- |
| `spectral_centroid`             | timbral brightness → `color_temp` (dark sound warm, bright cool) |
| `{stem}_pitch`, `key`, `chords` | pitch class → `hue` (note → color wheel)                         |
| `spectral_flatness`             | tonal → saturated, noisy → washed out                            |
| `timbral_axes`                  | palette / hue family                                             |
| `sound_tags` (PANNs)            | detected instrument → categorical color                          |
| `chroma`                        | 12 pitch classes → 12 color zones                                |

## → `position` (addressable strip / mover)

| Source                          | Behavior                                          |
| ------------------------------- | ------------------------------------------------- |
| `spectrogram`, `chroma`, `mfcc` | heatmap → strip directly (row → pixel)            |
| `band_energy_*` (6 bands)       | 6 strip zones = chunky spectrum analyzer          |
| `stereo_width`                  | spread: narrow → center pixels, wide → full strip |

## → `motion` / shape modulation

One feature shaping another mapping's behavior.

| Source                       | Behavior                                                     |
| ---------------------------- | ------------------------------------------------------------ |
| `bpm`                        | base chase / strobe speed                                    |
| `spectral_flux`              | shimmer / motion amount                                      |
| `{stem}_transient_sharpness` | envelope attack: sharp transient → snappy flash, soft → fade |
| `confidence` (ML features)   | low confidence → fade the contribution out                   |
| `vocals_vibrato_*`           | subtle color / brightness wobble on sustained vocals         |

---

## Derivations (onset derivation, folded in)

The M2 "onset derivation from intensity features" idea is absorbed here — it is the `threshold` primitive plus persistence, not a separate feature.

A **derivation** applies `threshold` to any continuous feature (RMS, onset strength, transient sharpness, band energy, stem energy — mix or any engine's stem) and produces a discrete result. One primitive, two output modes:

- **`events`** — peak-pick: local maxima above the cutoff → `{t, strength}` onset events. Distinct hits survive even when the envelope stays high (a drum roll yields N onsets, not one).
- **`segments`** — hysteresis gate: envelope above the cutoff → `{start, end, strength}` segments. The onset is the rising edge; duration is the segment length.

The two modes are views of the same crossing analysis: `events` answers "when do hits happen", `segments` answers "how long does each stay on". `strength` (peak value within the hit/segment) is carried through in both modes so downstream mappings can scale by it (e.g. onset strength → flash brightness).

Derivations are **named, saved, and shared**: declared once in the mapping doc, referenced by any number of programs as a source, editable at any time, and never deleted implicitly (see `formats.md`). Any continuous feature is a valid source — maximum applicability is the guiding principle; prune what proves useless later.

## Onset duration

A light turned on at an onset needs to know when to turn off. Onset events are points; duration must come from somewhere. Options, simplest first:

1. **Gate on the envelope, not the point** _(recommended default)_. A `segments`-mode derivation on `{stem}_energy` (or onset strength): lit duration = however long energy stays above the cutoff. Duration falls out of the same primitive.
2. **Synthesize an envelope.** Each onset event fires an attack-hold-decay shape (e.g. 5 ms attack, 150 ms decay). Crisp triggers regardless of the source's natural tail.
3. **Extract true note duration** _(future feature)_. Measure how long energy stays above threshold after each onset → emit `{stem}_note_segments` (start + end + strength). Only if 1–2 prove insufficient.

---

## Complex data shapes

| Shape                    | Examples                                       | Mapping approach                                                                                                  |
| ------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| heatmap (2-D, freq×time) | `spectrogram`, `chroma`, `mfcc`                | addressable strip directly (row → pixel), or reduce to a scalar first (centroid, band sum) then map as continuous |
| segment (labeled spans)  | `sections`, `motifs`, `silence`                | scene / preset switch (macro layer), not a direct channel value                                                   |
| multi-dim event          | `chords` (root+quality), `downbeats` (bar pos) | categorical: root → `hue`, quality → `saturation`; bar position → accent size                                     |
| scalar (one per song)    | `bpm`, `key`, `dynamic_range`                  | show-wide constants (base speed, base palette, contrast), not time tracks                                         |

---

## Transforms

Each mapping carries a transform chain. Most use 1–2; `normalize` + `smooth` are near-universal on continuous sources and applied by default.

| Transform     | Purpose                                                                        |
| ------------- | ------------------------------------------------------------------------------ |
| `normalize`   | feature range → channel range; min/max clamp + curve (gamma / log)             |
| `threshold`   | continuous → events (peak-pick) or segments (hysteresis gate); see Derivations |
| `envelope`    | event → attack-hold-decay ramp; gives onsets duration                          |
| `smooth`      | low-pass so light doesn't flicker (essential for energy → brightness)          |
| `quantize`    | snap timing to the beat grid                                                   |
| `colormap`    | scalar → color via gradient / palette                                          |
| `categorical` | discrete label → fixed value (chord root → hue, section → palette)             |
| `adaptive`    | normalization modes `absolute` / `windowed` / `share` (see `overview.md`)      |
