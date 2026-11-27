# Show Lab — Ranking

The candidate set, measures, score and selection used by `v2-ranked` and `v3-roles`. All measures are computed in `src/lib/showgen/measures.ts` from a candidate's 100 Hz envelope and the song's mix data. Each one is a plain number in the selection report.

## Candidates

A candidate is one continuous feature track that can drive a light's intensity:

| Root                                  | Features                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `stems.{engine}.{stem}`               | `energy`                                                                              |
| `stems.{engine}.drums.substems.{sub}` | `energy`                                                                              |
| `mix`                                 | `rms`, `band_energy_*`, `novelty`, `rhythmic_density`, `spectral_flux` (when present) |

Features that describe color rather than intensity (`spectral_centroid`, pitch, chroma, PANNs axes) are not candidates. Algorithms may use them to modulate color.

Each candidate has a **family**:

- For a stem or sub-stem, the family is its name (`bass`, `kick`, `vocals`, ...), with engine aliases folded: `instrumental` maps to `other`.
- For a mix feature, the family is the feature name.

Candidates of the same family from different engines are near-duplicates by definition.

## Measures

`x` is the envelope at 100 Hz. `p_k` is its k-th percentile. Beats and sections come from the mix.

| Measure            | Definition                                                                                                                                 | Purpose                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `presence`         | fraction of frames with `x > 0.1 · p99`                                                                                                    | rejects silent stems and stems that exist for a few seconds            |
| `level`            | median of `x / mix.rms` over frames where the mix is above its p20, energy candidates only                                                 | flags stems louder than their mix (`level > 1.05` = bleed or artifact) |
| `motion`           | share of the envelope's modulation spectrum (power spectrum of `x - mean(x)`, 0.25–20 Hz) that sits in 0.5–8 Hz                            | beat- and phrase-scale movement versus static pads                     |
| `flicker`          | modulation power above 10 Hz divided by power in 1–8 Hz                                                                                    | noise the eye reads as flicker                                         |
| `pulse`            | max normalized autocorrelation of the onset curve (half-wave rectified first difference of `x`) at lags of 0.5, 1 and 2 beat periods, ±3 % | pulse clarity (Lartillot et al. 2008, `mirpulseclarity`)               |
| `alignment`        | fraction of `onsets_strict` within 50 ms of a beat or half-beat                                                                            | real rhythmic parts sit on the grid; artifacts do not                  |
| `onset_rate`       | strict onsets per second                                                                                                                   | event density, used for role choice                                    |
| `contrast`         | `(p90 - p10) / p90`                                                                                                                        | visible dynamic range                                                  |
| `section_contrast` | std / mean of the per-section mean of `x`                                                                                                  | loud versus quiet sections                                             |
| `leak`             | max Pearson correlation of `x` (10 Hz, log-compressed) with any other stem of the same engine, excluding the same family                   | bleed of one stem into another (ISMIR 2023 stem-leakage study)         |

## Score

A candidate is rejected (score 0, reason recorded) when any of these holds:

- `presence < 0.2`
- `level > 1.05`
- `contrast < 0.15`
- `flicker > 1.5`

Otherwise:

```
score = 0.30·motion + 0.20·pulse + 0.15·alignment + 0.15·contrast
      + 0.10·min(1, section_contrast / 0.5) + 0.10·presence
      - 0.20·max(0, leak - 0.8) / 0.2
```

Every term is in [0, 1], so the score is too, before the leak penalty. The weights are the `v2` constants. A later version changes them by adding a new algorithm file.

## Selection

Picks are made by maximal marginal relevance (MMR). Each step picks the candidate maximizing:

```
score(c) - 0.7 · max_{p in picked} sim(c, p)
```

`sim(a, b)` is the larger of:

- the Pearson correlation of their 10 Hz log-compressed envelopes, floored at 0
- 0.9 when the two candidates have the same family

Selection stops at N picks (N = number of lights). It also stops early when the best remaining value is below 0.05, or when the remaining candidates are all rejected.

## Fewer picks than lights

`v2-ranked`: each extra light gets a copy of a pick, in score order, as its own program, so it takes the next palette slot.

`v3-roles`: each extra light plays a pick, in score order, in the other motion: a pulse or accent source as a swell, a swell source with `pulse >= 0.2` as a pulse, in the next color. No two lights show the same frames.

## Roles (`v3-roles`)

v3 adds one measure to v2's:

- `visible`: the fraction of 1 s windows in which the envelope, mapped through the swell transform (`p5..p98` to 0..1, gamma 1.6), moves by more than 0.15.
- A candidate with `visible < 0.2` is rejected.
- Every other candidate's score is multiplied by `0.5 + 0.5 · visible`, so every light changes noticeably over the song.

Each pick gets one role:

- **pulse**: `pulse >= 0.35` and `alignment >= 0.5`. Program: a derivation peak-picks the envelope at its p70 (clamped to 0.15..0.8, sensitivity 0.6); brightness flashes per event with a 20 ms attack, 30 ms hold and a decay of 0.6 beat periods (at least 120 ms).
- **accent**: `onset_rate < 0.5` per second and `contrast >= 0.6`. Program: the same event flash with a 250 ms decay, in the palette's outlier color (or its first color) at saturation 0.3.
- **swell**: everything else. Program: brightness from the envelope, normalized to `p5..p98` with gamma 1.6, smoothed 150 ms.

Every lit light has the evaluator's 12 % floor (`solidFrame`).

Light assignment by fixture kind:

| Role   | Lights, in order of preference                       |
| ------ | ---------------------------------------------------- |
| pulse  | strobe, PAR spot, moving head, LED tube              |
| accent | strobe, moving head, PAR spot                        |
| swell  | wall washer, lamp, LED strip, curved strip, LED tube |

Picks go in score order to the first free light their role prefers. Remaining lights take the remaining picks in order.

Color: pulse and swell programs bind hue and saturation to `mix.sections` through a categorical map. Each section label, in order of first appearance, takes the next base palette color, starting at the program's own offset. Colors therefore change at section boundaries, and programs differ from each other.

Level: `macro.scenes_from = mix.sections`. Each label's scene keeps every program and sets `master_scale` to the label's mean mix loudness over the loudest label's, floored at 0.5.
