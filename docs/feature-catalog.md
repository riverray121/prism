# Feature Catalog

Canonical enumeration of every feature extracted by the analysis pipeline. The design doc (`design-doc.md`) references this file. For architecture and rationale, start there.

## Conventions

- **Name** — canonical identifier used in the JSON profile. Snake*case. The per-stem tables below use a `{stem}*`prefix as shorthand; in the profile these features live at`stems.{engine}.{stem}.features.{name}`(keyed by separation engine, then stem).`{stem}` is whatever the engine's model outputs — the stem set is engine-dependent, not fixed.
- **Render** — render mode for the dashboard; also constrains storage shape:
  - `scalar` — one value per song
  - `continuous` — sampled on the unified 100 Hz timeline
  - `event` — list of `{time, attrs}`
  - `segment` — list of `{start, end, label, attrs}`
  - `heatmap` — 2D matrix over time
- **Source** — library or model producing the feature.
- **Unit / Range** — native units; the dashboard may normalize for display.
- **Notes** — concise. `[WIP]` marks features that are aspirational, heuristic, or have an unresolved algorithm/model choice — implement a v1 proxy and refine later.

ML features carry a per-frame `confidence`. DSP features omit it.

---

## Mix-level features

### Rhythm

| Name               | Render     | Source              | Unit / Range        | Notes                                                     |
| ------------------ | ---------- | ------------------- | ------------------- | --------------------------------------------------------- |
| `bpm`              | scalar     | librosa.beat        | float, ~60–200      | global tempo                                              |
| `beats`            | event      | librosa.beat        | time                | beat positions                                            |
| `downbeats`        | event      | madmom              | time + bar position | bar boundaries                                            |
| `swing`            | scalar     | derived             | 0–1                 | [WIP] mean offset of off-beats from grid; proxy algorithm |
| `rhythmic_density` | continuous | derived from onsets | onsets/sec          | windowed onset rate                                       |
| `silence`          | segment    | librosa             | start/end           | regions below threshold                                   |

### Frequency

| Name                   | Render     | Source  | Unit / Range  | Notes                                   |
| ---------------------- | ---------- | ------- | ------------- | --------------------------------------- |
| `spectral_centroid`    | continuous | librosa | Hz            | brightness center                       |
| `spectral_flux`        | continuous | librosa | unitless      | rate of spectral change                 |
| `spectral_flatness`    | continuous | librosa | 0–1           | tonal (0) vs. noisy (1)                 |
| `spectral_rolloff`     | continuous | librosa | Hz            | freq below which 85% of energy sits     |
| `band_energy_sub`      | continuous | librosa | 0–1           | <60 Hz                                  |
| `band_energy_bass`     | continuous | librosa | 0–1           | 60–250 Hz                               |
| `band_energy_low_mid`  | continuous | librosa | 0–1           | 250–500 Hz                              |
| `band_energy_mid`      | continuous | librosa | 0–1           | 500–2k Hz                               |
| `band_energy_high_mid` | continuous | librosa | 0–1           | 2k–4k Hz                                |
| `band_energy_air`      | continuous | librosa | 0–1           | >4k Hz                                  |
| `spectrogram`          | heatmap    | librosa | freq×time, dB | dense — likely stored as a sidecar file |

### Amplitude

| Name            | Render     | Source     | Unit / Range | Notes                  |
| --------------- | ---------- | ---------- | ------------ | ---------------------- |
| `rms`           | continuous | librosa    | 0–1          | volume envelope        |
| `peak`          | continuous | numpy      | 0–1          | sample-peak envelope   |
| `loudness_lufs` | continuous | pyloudnorm | LUFS         | perceptual loudness    |
| `dynamic_range` | scalar     | derived    | dB           | crest factor over song |

### Tonal

| Name                  | Render     | Source              | Unit / Range             | Notes                                 |
| --------------------- | ---------- | ------------------- | ------------------------ | ------------------------------------- |
| `key`                 | scalar     | librosa \| essentia | string (e.g. `C major`)  | global key                            |
| `key_confidence`      | scalar     | same                | 0–1                      |                                       |
| `chords`              | event      | madmom \| essentia  | time + `{root, quality}` | chord change events                   |
| `chroma`              | heatmap    | librosa             | 12×time                  | pitch-class energy; sidecar candidate |
| `harmonic_complexity` | continuous | derived             | 0–1                      | [WIP] chord novelty / tension proxy   |
| `tuning_deviation`    | scalar     | librosa             | cents                    | deviation from A=440                  |

### Timbre

| Name                 | Render     | Source   | Unit / Range | Notes                                        |
| -------------------- | ---------- | -------- | ------------ | -------------------------------------------- |
| `mfcc`               | heatmap    | librosa  | 13×time      | timbre fingerprint; sidecar candidate        |
| `zero_crossing_rate` | continuous | librosa  | 0–1          | noisiness                                    |
| `roughness`          | continuous | essentia | 0–1          | dissonance; depends on essentia availability |

### Spatial

| Name            | Render     | Source            | Unit / Range | Notes                             |
| --------------- | ---------- | ----------------- | ------------ | --------------------------------- |
| `stereo_width`  | continuous | derived (L/R)     | 0–1          | inverse of L/R correlation        |
| `reverb_amount` | continuous | derived heuristic | 0–1          | [WIP] approximate; low confidence |

### Structure (ML)

| Name       | Render     | Source                     | Unit / Range                        | Notes                                             |
| ---------- | ---------- | -------------------------- | ----------------------------------- | ------------------------------------------------- |
| `sections` | segment    | hybrid (msaf + heuristics) | start/end + label + confidence      | intro / verse / chorus / drop / breakdown / outro |
| `motifs`   | segment    | self-similarity clustering | start/end + cluster_id + confidence | [WIP] recurring phrases; algorithm TBD            |
| `novelty`  | continuous | self-similarity matrix     | 0–1                                 | per-frame "how new is this?"                      |

### Sound-type classification (ML)

| Name           | Render     | Source             | Unit / Range               | Notes                                                        |
| -------------- | ---------- | ------------------ | -------------------------- | ------------------------------------------------------------ |
| `sound_tags`   | continuous | PANNs              | per-class probability, 0–1 | [WIP] top-K tags over time; class subset TBD                 |
| `timbral_axes` | continuous | derived from PANNs | 0–1 per axis               | [WIP] curated axes (synth↔organic, smooth↔harsh); design TBD |

### Emotional (ML)

| Name      | Render     | Source    | Unit / Range | Notes                                             |
| --------- | ---------- | --------- | ------------ | ------------------------------------------------- |
| `valence` | continuous | model TBD | 0–1          | [WIP] positive ↔ negative; no committed model     |
| `tension` | continuous | model TBD | 0–1          | [WIP] tension / release curve; no committed model |

---

## Per-stem features

Stems come from the multi-engine separation stage (see `design-doc.md` and `build-order.md`): a configured set of engines via `audio-separator`, each producing its native stem set. Every stem, for every engine, is written as a WAV and referenced from the JSON profile by path, and gets the full feature pass below — so the same features can be compared across engines for the same stem.

### Common — every stem

| Name                         | Render     | Source        | Unit / Range    | Notes                              |
| ---------------------------- | ---------- | ------------- | --------------- | ---------------------------------- |
| `{stem}_energy`              | continuous | librosa       | 0–1             | RMS of stem                        |
| `{stem}_onsets`              | event      | librosa.onset | time + strength |                                    |
| `{stem}_transient_sharpness` | continuous | derived       | 0–1             | attack speed                       |
| `{stem}_spectral_centroid`   | continuous | librosa       | Hz              | per-stem brightness                |
| `{stem}_mfcc`                | heatmap    | librosa       | 13×time         | per-stem timbre; sidecar candidate |

### Melodic stems only (e.g. `bass`, `vocals`, and any harmonic/instrumental stem an engine emits)

| Name                      | Render     | Source       | Unit / Range | Notes               |
| ------------------------- | ---------- | ------------ | ------------ | ------------------- |
| `{stem}_pitch`            | continuous | librosa.pyin | Hz           | f0 contour          |
| `{stem}_pitch_confidence` | continuous | librosa.pyin | 0–1          | voicing probability |

### Vocals only

| Name                   | Render     | Source             | Unit / Range | Notes |
| ---------------------- | ---------- | ------------------ | ------------ | ----- |
| `vocals_vibrato_rate`  | continuous | derived from pitch | Hz           |       |
| `vocals_vibrato_depth` | continuous | derived from pitch | cents        |       |

---

## Open items collected from above

- **PANNs class subset** — pick ~20–40 music-relevant classes from the 527 AudioSet labels. Configurable.
- **`timbral_axes` design** — concrete axis definitions and how they're computed from PANNs outputs.
- **`valence` / `tension` model** — no committed model. Likely derived from PANNs embeddings + a small mapping, or a separate pretrained model.
- **`essentia` availability** — pip-install on M-series Macs can be friction; if it blocks, drop `roughness` to [WIP] or substitute a librosa-based proxy.
