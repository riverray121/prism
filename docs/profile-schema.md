# Profile Schema

JSON serialization of a single song's analysis. Consumed by the dashboard and by Stage 2 (the mapping tool). Versioned; major-version bumps are breaking.

The design doc (`design-doc.md`) and feature catalog (`feature-catalog.md`) are companions to this file.

---

## Disk layout

One folder per song. Sidecar paths in `profile.json` are relative to the profile itself.

```
library/
  library.db                 # SQLite index of all songs
  songs/
    {uuid}/
      profile.json
      source.flac            # or .wav / .mp3 / .m4a
      stems/
        htdemucs_ft/         # one subfolder per separation engine
          vocals.wav
          drums.wav
          bass.wav
          other.wav
        bs_roformer/
          vocals.wav
          drums.wav
          bass.wav
          other.wav
      heatmaps/
        spectrogram.npy
        chroma.npy
        mfcc.npy
        htdemucs_ft/         # per-stem heatmaps nested by engine
          vocals_mfcc.npy
          drums_mfcc.npy
          bass_mfcc.npy
          other_mfcc.npy
        bs_roformer/
          vocals_mfcc.npy
          drums_mfcc.npy
          bass_mfcc.npy
          other_mfcc.npy
```

`{uuid}` is UUIDv4, assigned at import.

Stems are nested one level by **separation engine**. M4 runs a set of engines per song (see `build-order.md`); each engine writes the stem set its model produces — the stem names vary by model (e.g. Demucs `htdemucs` → drums/bass/other/vocals; a 6-stem model adds guitar/piano). Every engine's output is kept on disk; there is no v1 cleanup pass.

---

## Top-level structure

```json
{
  "schema_version": "0.1.0",
  "song": {
    "id": "f3a1c2b4-...",
    "title": "Idol",
    "artist": "Yeat",
    "duration_sec": 234.52,
    "sample_rate": 44100,
    "source_file": "source.flac",
    "imported_at": "2026-05-30T12:34:56Z",
    "analyzed_at": "2026-05-30T13:00:00Z"
  },
  "timeline": {
    "frame_rate_hz": 100,
    "frame_count": 23452
  },
  "mix": {
    "bpm": { ... },
    "beats": { ... },
    "spectrogram": { ... },
    ...
  },
  "stems": {
    "htdemucs_ft": {
      "vocals": { "audio_file": "stems/htdemucs_ft/vocals.wav", "features": { ... } },
      "drums":  { "audio_file": "stems/htdemucs_ft/drums.wav",  "features": { ... } },
      "bass":   { "audio_file": "stems/htdemucs_ft/bass.wav",   "features": { ... } },
      "other":  { "audio_file": "stems/htdemucs_ft/other.wav",  "features": { ... } }
    },
    "bs_roformer": {
      "vocals": { "audio_file": "stems/bs_roformer/vocals.wav", "features": { ... } },
      "drums":  { "audio_file": "stems/bs_roformer/drums.wav",  "features": { ... } },
      "bass":   { "audio_file": "stems/bs_roformer/bass.wav",   "features": { ... } },
      "other":  { "audio_file": "stems/bs_roformer/other.wav",  "features": { ... } }
    }
  },
  "favorites": [
    "mix.beats",
    "stems.htdemucs_ft.bass.features.pitch"
  ]
}
```

`mix` is flat; features are keyed by their catalog name. The `category` field on each feature is the only grouping signal — there is no nesting by category.

`stems` is keyed first by **separation engine**, then by **stem**. Each engine's id matches its `audio-separator` model (e.g. `htdemucs_ft`, `bs_roformer`, `mdx23c`); the stem set under each engine is whatever that model outputs. The same per-stem feature set (see `feature-catalog.md`) is computed for every engine's stems, so analyses are directly comparable across engines.

---

## Per-feature envelope

Every feature entry carries the same metadata fields (`render`, `category`, `source`, `unit`) plus a payload that varies by render mode. Optional fields: `range`, `status`, `confidence`.

### scalar

```json
"bpm": {
  "render": "scalar",
  "category": "rhythm",
  "source": "librosa.beat",
  "unit": "bpm",
  "value": 128.0
}
```

### continuous

Sampled on the implicit 100 Hz timeline. `data` length equals `timeline.frame_count`. No timestamps stored.

```json
"rms": {
  "render": "continuous",
  "category": "amplitude",
  "source": "librosa",
  "unit": "normalized",
  "range": [0, 1],
  "data": [0.12, 0.15, 0.18, /* ... 23452 values ... */]
}
```

ML continuous features may add a parallel `confidence` array of equal length (planned — no extractor emits one yet; `pitch_confidence` is a separate feature, not a sibling array, and the zod loader does not model it). WIP features add `"status": "wip"`.

`timbral_axes` is realized as three separate continuous features, each a 0–1 per-frame contrast between two groups of PANNs class probabilities (0.5 = balanced / nothing detected): `electronic_organic`, `percussive_tonal`, `instrumental_vocal` (value → 1 favors the second pole). v1 omits the confidence array.

```json
"electronic_organic": {
  "render": "continuous",
  "category": "timbre",
  "source": "panns",
  "unit": "normalized",
  "range": [0, 1],
  "status": "wip",
  "data": [/* ... frame_count values ... */]
}
```

### event

```json
"beats": {
  "render": "event",
  "category": "rhythm",
  "source": "librosa.beat",
  "events": [
    {"t": 0.234},
    {"t": 0.703}
  ]
}

"chords": {
  "render": "event",
  "category": "tonal",
  "source": "madmom",
  "events": [
    {"t": 0.0,  "root": "C",  "quality": "maj", "confidence": 0.91},
    {"t": 4.12, "root": "Am", "quality": "min", "confidence": 0.84}
  ]
}
```

For ML event features, `confidence` is a field on each event.

### segment

```json
"sections": {
  "render": "segment",
  "category": "structure",
  "source": "msaf",
  "segments": [
    {"start": 0.0,  "end": 16.2, "label": "intro", "confidence": 0.87},
    {"start": 16.2, "end": 48.4, "label": "verse", "confidence": 0.79},
    {"start": 48.4, "end": 80.0, "label": "drop",  "confidence": 0.92}
  ]
}
```

### heatmap

Payload lives in a sidecar `.npy` file. The JSON entry contains only the reference and shape metadata.

```json
"spectrogram": {
  "render": "heatmap",
  "category": "frequency",
  "source": "librosa",
  "unit": "dB",
  "sidecar": "heatmaps/spectrogram.npy",
  "shape": [513, 23452],
  "axes": ["freq_hz", "time_frame"]
}
```

`axes` names the meaning of each matrix dimension in order.

### tags

Many named per-frame probability tracks in one `.npy` matrix (`[rows, frames]`, 0–1), rendered as one line graph per row. Used by `sound_tags` (PANNs): `labels[i]` names row `i`, in row order. `shape` is `[rows, frame_count]`.

```json
"sound_tags": {
  "render": "tags",
  "category": "semantic",
  "source": "panns",
  "status": "wip",
  "unit": "probability",
  "sidecar": "heatmaps/sound_tags.npy",
  "labels": ["Guitar", "Piano", "Singing", "Electronic music"],
  "shape": [4, 23452]
}
```

---

## Sidecar files

- **Format:** NumPy `.npy`, uncompressed. One matrix per file.
- **Path:** relative to `profile.json`, written in the feature's `sidecar` field.
- **Required:** if a feature declares `sidecar`, the file must exist. Loader fails fast on missing sidecars (a half-loaded profile is worse than a clear error).

Stem WAVs are referenced from `stems.{engine}.{stem}.audio_file`, same rules apply.

---

## Versioning

- `schema_version` follows semver.
- **Minor bumps:** backward-compatible additions — new optional fields, new features in the catalog.
- **Major bumps:** breaking changes — renamed/removed fields, changed semantics, changed sidecar conventions.
- Intended: loaders check the major version on load and refuse unknown majors. **Not yet enforced** — the sidecar `read_profile` and the frontend zod loader currently parse `schema_version` as a plain string without a major-version gate. Add the check at the load boundary when schema migrations become real.
- Current: `0.1.0`.

---

## Confidence

> Status: the per-entry `confidence` on `event`/`segment`/`scalar` features is emitted today; the parallel `confidence` array on `continuous` features is planned but not yet produced by any extractor.

- **DSP features:** omit `confidence` entirely.
- **ML `continuous` features:** parallel `confidence` array, same length as `data`.
- **ML `event` / `segment` features:** `confidence` field on each entry.
- **ML `scalar` features:** `confidence` as a sibling field (e.g. `key_confidence` in the catalog).

---

## Status

Features marked `[WIP]` in the catalog carry `"status": "wip"` in the profile. Loaders may render these with reduced emphasis or filter them out entirely. Absence of `status` means the feature is stable.

---

## Favorites

> **Not yet implemented** (an M6 deliverable). No code emits or models a top-level `favorites` array yet; the example above shows the planned shape.

- Array of dot-path strings referencing canonical feature locations.
- Examples: `"mix.beats"`, `"stems.htdemucs_ft.bass.features.pitch"`, `"mix.sections"`.
- Loader validates that each path resolves at load time; broken favorites trigger a warning, not a load failure (a removed feature shouldn't kill the profile).
