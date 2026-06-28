# Analysis Pipeline — Implementation

Thin vertical slices in build order. All shipped; `log.md` holds per-slice results and decisions. Each slice's sub-slices were the original build units.

## Slice 1 — Scaffold

- Goal: an empty window that talks to a Python process over JSON-line IPC.
- Sub-slices: Tauri (Svelte 5 + SvelteKit static SPA + Tailwind v4) shell · Python sidecar (uv, pydantic IPC models) · Rust spawns the sidecar with a ping/pong round-trip · tooling (pre-commit: ruff + prettier).
- Acceptance: frontend builds, Rust compiles, ping → pong end to end.

## Slice 2 — Magic moment

- Goal: import → analyze → play → a graph moves in sync.
- Sub-slices: SQLite + import (mutagen metadata, per-song folder) · worker + BPM stage · inspection view (text) · RMS line graph (uPlot) · playback + playhead (Web Audio).
- Acceptance: two features render; the playhead sweeps in sync; scrubbing is sample-accurate.

## Slice 3 — Mix-level DSP

- Goal: all cheap, dependency-light mix features across the scalar/continuous/event/heatmap render modes.
- Sub-slices: beats (event) · spectrogram/mfcc/chroma (heatmap `.npy` sidecar pipeline) · band energy (6 bands), spectral centroid/rolloff/flatness/flux, key (+confidence, tuning), LUFS, peak, dynamic range, ZCR, stereo width.
- Acceptance: 24 mix-level features render; every continuous feature aligns frame-for-frame.

## Slice 4 — Chords + downbeats (torch enters)

- Goal: the first trained model in the pipeline, de-risking torch on a light model before separation.
- Sub-slices: chords (vendored BTC transformer, download-on-first-run weights) · downbeats (librosa 4/4 heuristic off the beat grid).
- Acceptance: chords + downbeats render against playback; torch in the dependency set and de-risked.

## Slice 5 — Multi-engine stem separation + per-stem DSP

- Goal: the first long-running stage; the multi-stage worker; side-by-side engine comparison.
- Sub-slices: multi-stage worker (dsp-mix → separate → dsp-stem) · engine set (htdemucs_ft / htdemucs_6s / bs_roformer / mel_band_roformer) · per-stem catalog (energy, onsets, transients, centroid, mfcc; pitch + vibrato for melodic stems) · drum sub-separation (opt-in) · step-counter progress · queued-song cancellation · interrupt recovery + partial cleanup.
- Acceptance: every engine's stems + features render and are comparable; failure and cancel paths handled.

## Slice 6 — ML classification + structure

- Goal: the semantic/structural layer, the `segment` render mode (the last of five), and PANNs.
- Sub-slices: `segment` render mode + silence · sections / novelty / motifs (one shared hand-rolled SSM) · PANNs sound_tags (`tags` mode) + rhythmic_density · timbral_axes + numeric confidence rendering.
- Acceptance: all five render modes exist; the full stable feature catalog renders.

## Slice 7 — Code review + fixes

- Goal: review the accumulated M1 codebase and fix it before the UI rework, on a clean base.
- Sub-slices: 55-finding multi-agent review · high-severity fixes · medium/low/nit fixes · `deslop full` cleanup.
- Acceptance: ruff + `pnpm check` + `cargo check` clean; findings resolved or explicitly deferred to milestone 2.
