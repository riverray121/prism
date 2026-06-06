# Prism — Design Doc

## Overview

A desktop dashboard that imports audio files, runs a multi-layer pipeline to extract every viable musical feature, and presents the results as an interactive, time-aligned visualization. Users review the analysis against playback, favorite the features that matter, and export a structured profile for downstream use (hardware, simulation, or a future visualization-mapping stage).

**Scope:** Analysis layer only. Hardware, DMX, light mapping, and licensing are out of scope.

**Target platform:** Mac-first (developed on M3 Pro, Demucs on Metal/MPS — tens of seconds per song), but built portable so development can move to another OS later. Avoid Mac-only dependencies where a cross-platform equivalent exists; isolate platform-specific code (GPU backend selection, audio device access) behind a thin abstraction.

**Target genres:** EDM, psychedelic trap (Yeat, Fred Again, Slayyter, Joji).

---

## Goals

- Extract the maximum set of meaningful features from a song
- Let the user visually verify each feature against the actual audio
- Produce two outputs per song: a machine-readable cue profile and a human-readable inspection view
- Persist analyzed songs for reload and reuse

---

## Architecture

```
Input Handler            Import audio → managed library
      |
      v
Processing Core
  ├── DSP layer           librosa / Essentia — deterministic features
  └── ML layer            Demucs (stems) + PANNs (classification)
      |
      v
Aggregation / Normalize   unify timescales + units onto one timeline
      |
      v
Output Formatter
  ├── JSON cue profile    machine-readable, for next pipeline stage
  └── Dashboard view      human-readable inspection
```

---

## Tech Stack

- **Shell:** Tauri (Rust + system WebView). Lightweight desktop wrapper; cross-platform so the portability goal holds.
- **UI:** **Svelte 5 + SvelteKit** (TypeScript), configured as a static SPA via `adapter-static` (SSR off — Tauri has no Node server). Chosen over React/vanilla because the reactive surface (live library status, controls) is real but bounded, while the heavy visualization is imperative regardless of framework; Svelte's stores model IPC-derived state cleanly and bridge to imperative uPlot with less ceremony than React's render cycle. **Tailwind CSS v4** (via `@tailwindcss/vite`, no config file) for styling. **uPlot** for stacked time-series and event/segment overlays — small (~40KB), fast at high point counts, simple array-based API; it owns its canvas, so the framework only provides the surrounding DOM. Spectrogram heatmap may use a custom Canvas2D pass rather than a uPlot plugin; decided when implemented. **UI primitives:** **shadcn-svelte** (copy-in components on bits-ui + Tailwind; supports Svelte 5 + Tailwind v4) for the fiddly interactive controls — selects/dropdowns, sliders, dialogs, tooltips, tabs. Adopted lazily, component by component, starting at the first such control (playback slider, per-feature Y-axis dropdown); trivial layout stays hand-rolled Tailwind. Its CSS-variable theme tokens will also own light/dark theming. The app surface already follows the OS light/dark theme via `color-scheme` + `light-dark()`.
- **Analysis backend:** Python sidecar process launched and managed by Tauri. Hosts librosa / Essentia / Demucs / PANNs.
- **IPC (frontend ↔ sidecar):** stdin/stdout JSON-lines. Tauri spawns the Python sidecar and pipes messages in both directions; the Tauri Rust shell relays between WebView and pipes. No HTTP server, no port.
- **Audio playback:** Web Audio API in the frontend. Playhead is driven from playback time, not from the sidecar.

---

## Component 1 — Input Handler & Library

- Import audio files: FLAC, WAV, 320kbps MP3/AAC
- Each song gets a **UUIDv4** assigned at import; folder layout is `library/songs/{uuid}/` (see [`profile-schema.md`](./profile-schema.md) for the full on-disk layout). UUIDs decouple folder identity from editable metadata.
- **Metadata extraction** on import (mutagen), with this precedence: file tags → filename heuristic (`"Artist - Title.ext"`) → fall back to filename + "Unknown". No blocking prompt during import. The library view exposes a "missing metadata" filter so gaps can be reviewed in batch. All fields editable from the dashboard at any time.
- **Library index:** `library.db` (SQLite) with one row per song — `id`, `title`, `artist`, `duration_sec`, `sample_rate`, `source_path`, `imported_at`, `queued_at`, `status`, `current_stage`, `current_stage_progress`, `analyzed_at`, `error_message`. SQLite is the standard for desktop apps of this shape (Mail, Photos, Lightroom, Firefox, Chrome all use it). Accessed via stdlib `sqlite3`, all queries isolated in `library.py`; **no ORM** — `library.db` is a single index table (the analysis data lives in `profile.json`), so an ORM would be ceremony over a handful of statements. Revisit (SQLModel, since pydantic is already in use) only if multiple related tables/joins appear or the app ships and needs migrations against users' existing databases.
- `status` values: `unanalyzed` / `queued` / `analyzing` / `analyzed` / `failed`. Library view filters and live-updates on this column.
- Select one or many songs and start analysis. Songs are queued and processed one at a time (see [Analysis Pipeline](#analysis-pipeline)).
- Reload analyzed songs from cache (skips reprocessing).

---

## Analysis Pipeline

Songs are analyzed sequentially by a single worker in the Python sidecar. No cross-song parallelism, no concurrency caps.

### Stages

Each song passes through four stages in order:

1. **DSP-mix** — librosa/Essentia features on the full mix
2. **Demucs separation** — write the 6 stem WAVs to disk
3. **DSP-per-stem** — librosa features on each separated stem
4. **ML classification** — PANNs, section detection, motif recurrence, novelty, valence/tension

### Queue

There is no separate queue data structure. The "queue" is the set of `songs` rows with `status='queued'`, ordered by `queued_at`. The worker loops:

```
while True:
    song = SELECT one row WHERE status='queued' ORDER BY queued_at LIMIT 1
    mark status='analyzing'
    run all four stages, updating current_stage / current_stage_progress
    mark status='analyzed'  (or 'failed' with error_message on exception)
```

### Startup

On app start, any row left in `status='analyzing'` is marked `failed` with `error_message='Analysis interrupted'`. This avoids crash loops on a song that crashed the sidecar mid-analysis. Queued songs are picked up automatically — no explicit "resume" action.

### Cancellation (v1)

- **Queued songs:** removable; status returns to `unanalyzed`.
- **Running song:** must finish or fail. Cancel-in-progress is a v2 feature (clean teardown of partial Demucs output is non-trivial).

### Failure handling

Mark `status='failed'` with `error_message`. Delete the partial folder under `library/songs/{uuid}/`. User retries from the library view (re-queues from scratch).

### No pause/resume

Omitted in v1. Escape valve is cancelling queued songs, or quitting the app (which interrupts the running song via the startup logic above).

### IPC protocol (stdin/stdout JSON-lines)

One JSON message per line.

**Frontend → backend commands:**

```json
{ "type": "library.import", "paths": ["/abs/path/song.flac"] }
{ "type": "library.list" }
{ "type": "profile.get",  "song_id": "..." }
{ "type": "queue.add",    "song_ids": ["..."] }
{ "type": "queue.cancel", "song_id": "..." }
```

**Backend → frontend events:**

```json
{ "type": "library.songs", "songs": [ /* full library snapshot, see below */ ] }
{ "type": "library.import_failed", "path": "...", "error": "..." }
{ "type": "profile", "song_id": "...", "profile": { /* profile.json contents */ } }
{ "type": "job.started",         "song_id": "..." }
{ "type": "job.stage_started",   "song_id": "...", "stage": "demucs" }
{ "type": "job.stage_progress",  "song_id": "...", "stage": "demucs", "progress": 0.42 }
{ "type": "job.stage_completed", "song_id": "...", "stage": "demucs" }
{ "type": "job.completed",       "song_id": "..." }
{ "type": "job.failed",          "song_id": "...", "stage": "demucs", "error": "..." }
{ "type": "job.cancelled",       "song_id": "..." }
```

`library.import` copies each file into the managed library and assigns a UUID; `library.list` requests the current state. Both reply with a `library.songs` snapshot — the full song list, not a delta — which the frontend renders wholesale. Per-song fields: `id`, `title`, `artist`, `duration_sec`, `sample_rate`, `source_path` (relative to the library root), `status`, `imported_at`. There is no request/response correlation; the snapshot model keeps the UI a pure function of the latest event. `profile.get` reads an analyzed song's `profile.json` and replies with a `profile` event carrying the parsed contents; the frontend owns no disk access.

`stage_progress` is meaningful primarily for Demucs (which exposes a progress callback). DSP and ML stages emit only `stage_started` / `stage_completed`.

---

## Component 2 — Processing Core

Canonical feature list lives in [`feature-catalog.md`](./feature-catalog.md), with render mode, source, unit/range, scope (mix vs. per-stem), and `[WIP]` markers for aspirational or heuristic features. Summary below.

### DSP layer (deterministic — librosa / Essentia)

- **Rhythm:** BPM, beat grid, downbeats, swing, rhythmic density, silence
- **Frequency:** per-band energy (6 bands), spectral centroid / flux / flatness / rolloff, spectrogram
- **Amplitude:** RMS, peak, LUFS loudness, dynamic range
- **Tonal:** key, chord events, chroma, harmonic complexity, tuning deviation
- **Timbre:** MFCCs, zero-crossing rate, roughness
- **Spatial:** stereo width, reverb amount

### ML layer (pretrained, runs locally)

- **Stem separation (Demucs):** kick, snare, hats, bass, synth, vocals — written to disk as WAVs; each stem then gets its own DSP feature pass (energy, onsets, transients, brightness, MFCC; pitch for melodic stems; vibrato for vocals)
- **Sound-type classification (PANNs):** per-frame tag probabilities + curated timbral axes
- **Section detection** (hybrid heuristics + ML): intro / verse / chorus / drop / breakdown / outro
- **Motif / phrase recurrence**
- **Novelty score** (per-frame, self-similarity)
- **Emotional valence, tension/release** _(aspirational — no committed model yet)_

No models trained from scratch — all pretrained, all run locally.

---

## Component 3 — Aggregation / Normalization

Reconciles raw outputs that arrive at incompatible timescales (onsets per-ms, sections per-minute, energy continuous) and units.

- Resample all features onto a unified timeline (common frame rate, e.g. 100 Hz)
- Normalize value ranges to 0–1 per feature for consistent display
- Resolve conflicts (e.g. ML section boundary vs DSP energy drop)
- Tag each feature with: type, available dimensions, value range, confidence (esp. ML outputs)

---

## Component 4 — Output Formatter

### Machine-readable — JSON cue profile

Full spec lives in [`profile-schema.md`](./profile-schema.md). Summary:

- **Disk unit:** one folder per song under `library/songs/{uuid}/`, containing `profile.json`, source audio, stem WAVs, and `.npy` sidecars for heatmaps.
- **Top-level structure:** `schema_version`, `song` metadata, `timeline` (frame rate + count), `mix` (flat feature map), `stems` (per-stem audio + features), `favorites`.
- **Per-feature envelope:** every feature self-describes with `render` mode, `category`, `source`, `unit`, and a render-specific payload (`value`, `data`, `events`, `segments`, or `sidecar`).
- **Heatmaps stored as uncompressed `.npy` sidecars**, referenced by relative path; JSON keeps only shape and axis metadata.
- **Versioning:** `schema_version` is semver; major-version bumps are breaking. Stage 2 checks the major on load.
- **Favorites:** dot-paths into the profile (e.g. `"stems.bass.features.pitch"`).

### Human-readable — Dashboard (below)

---

## Dashboard Spec

### Library panel

- View all imported songs with live status
- Select one or many → start analysis (queued, run concurrently up to the limit)
- Import new files
- Click an analyzed song to open its inspection view

### Feature inspection view

Each feature gets its own graph, stacked vertically on a shared time (X) axis. Render mode is auto-selected by feature type:

- **Line graph** — continuous features (energy, pitch, brightness)
- **Event markers** (vertical ticks) — discrete features (beats, onsets, chord changes, section boundaries)
- **Spectrogram heatmap** (color = intensity) — frequency-over-time

A per-feature **Y-axis dropdown** switches between that feature's dimensions (e.g. bass → energy / pitch / transient sharpness).

### Playback + tracker

- Play the song
- A vertical playhead sweeps across all graphs in sync on the shared time axis
- Lets the user confirm a given spike corresponds to the sound they hear at that moment

### Favoriting

- Mark features (or specific dimensions) as favorited
- Favorited set is emphasized/flagged in the exported profile

### Save / Load

- Save analyzed profile to file (full analysis + favorites)
- Load previously analyzed songs back into the dashboard without reprocessing

---

## DSP vs ML Summary

| Deterministic (DSP)      | Requires ML (pretrained)          |
| ------------------------ | --------------------------------- |
| BPM, beats, onsets       | Stem separation (Demucs)          |
| All spectral features    | Sound-type classification (PANNs) |
| Volume, ADSR, transients | Section detection (hybrid)        |
| MFCC, ZCR, flatness      | Motif recurrence                  |
| Key/chord (mostly)       | Novel vs repeated sounds (hybrid) |
| Stereo width, reverb     | Emotional valence                 |

---

## Companion Docs

- [`feature-catalog.md`](./feature-catalog.md) — canonical list of every feature extracted, with render mode, source, units, scope
- [`profile-schema.md`](./profile-schema.md) — JSON profile spec, disk layout, sidecar conventions, versioning
- [`build-order.md`](./build-order.md) — milestones from scaffolding to v1

## Open Decisions

All major design decisions resolved. Remaining choices are local and made during implementation (e.g. PANNs class subset, spectrogram render approach).

---

## Next Steps / Future Pipeline Stages

The analysis layer feeds two downstream stages, both out of scope for this doc but constraining its outputs.

### Stage 2 — Mapping tool (sound → visual)

Consumes the JSON cue profile and produces a hardware/sim control file bound to a specific song.

- Authoring environment for mapping analyzed features to visual parameters (color, intensity, position, motion, etc.)
- Supports creative prototyping: chain, condition, and transform features into visual events. Example: detect a recurring sound, track its pitch, map pitch range → color.
- Must allow rapid iteration — swap mappings, audition against playback, branch versions
- Output: a control file (timeline of visual cues) paired 1:1 with the source song

This stage drives the **stable JSON schema** requirement on the analysis profile.

### Stage 3 — Hardware / sim controller

Plays the song and the control file together, in sync, against a target output device.

- Pluggable backend: render to an on-screen simulator or drive physical hardware (lights at minimum)
- Mapping from control-file channels to device channels is dynamic and configurable — same control file runs across different rigs without re-authoring
- Scales from a handful of lights to larger fixture sets
- Handles audio + visual synchronization (latency compensation, transport control)
