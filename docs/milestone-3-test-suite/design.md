# Test Suite — Design

## Goal

A fast, deterministic unit-test suite over the code Prism owns, runnable without the app, the library DB, real audio, or ML model weights. It gates code on `git push`, matching the "push only after tested" rule in `CLAUDE.md`.

## Principles

- **Test our code, not our dependencies.** Assert the behavior of our wrappers and transforms — shapes, value ranges, edge-case branches, serialization contracts — not librosa/torch/zod internals.
- **No heavy inputs.** Pure DSP functions run on short synthetic numpy signals (sine, noise) built in-test. No fixture audio is required for the first pass; the `tests/fixtures/` clip layout from M1's practice doc is deferred until an integration test needs it.
- **Never touch real state.** Filesystem tests use `tmp_path` with monkeypatched `storage` path globals. DB tests use an in-memory SQLite connection built from the real schema. No test reads or writes `library/` or `library.db`.
- **Exclude the model tier.** BTC (chords), PANNs (semantic), pYIN, separation backends, and the full SSM/structure pipeline load weights or are slow. Their _pure helpers_ are tested; their model-loading entry points are not.

## Layers

| Layer            | Runner   | Location               | Command         |
| ---------------- | -------- | ---------------------- | --------------- |
| Python sidecar   | `pytest` | `tests/`               | `uv run pytest` |
| TypeScript front | `vitest` | `src/lib/**/*.test.ts` | `pnpm test`     |
| Rust shell       | —        | (deferred)             | —               |

## Target inventory

Every unit below is a pure function or a state-machine reachable without models or real I/O. Grouped by how it is exercised.

### Sidecar — pure functions on synthetic signals

- **`schema.py`** — every pydantic model: required-field validation, `Literal` discriminator enforcement, optional-field defaults, `model_dump_json` round-trip.
- **`features/amplitude.py`** — `rms`, `peak` (incl. sub-hop empty branch), `loudness_lufs` (silence floors at −70), `silence` (a gap ≥ `MIN_SILENCE_SEC` yields a segment), `dynamic_range` (crest factor; zeros → 0 dB).
- **`features/frequency.py`** — `spectral_flatness` clamp to [0,1], `spectral_flux` leading-zero + frame-count alignment, `band_energies` per-band fractions and sub-band concentration, `_continuous` envelope shape.
- **`features/timbre.py`** — `zero_crossing_rate` (noise ≫ sine), `mfcc` matrix shape.
- **`features/tonal.py`** — `_best_key` (the `_MAJOR` profile returns "C major" at corr ≈ 1; constant chroma is NaN-guarded), `key` confidence clamped to [0,1], `tuning_deviation` ≈ 0 for an A440 sine.
- **`features/spatial.py`** — `stereo_width`: mono → all-zero, hard-panned stereo → > 0, sub-hop → empty.
- **`features/pitch.py`** — `vibrato` on a hand-built cents contour: unvoiced (NaN) frames zero out; a wobble yields non-zero rate/depth. (`pitch` itself runs pYIN — excluded as slow.)
- **`features/structure.py`** pure helpers — `_runs` (boolean run finder, edge cases), `_grid_times` (both the ≥32-beat and uniform branches), `_name_groups` (chorus = most energetic recurring; intro/outro at ends), `_novelty_curve` (block-diagonal SSM peaks at boundaries).
- **`features/chords.py`** — `_idx_to_chord` (168 → "X", 169 → "N", normal index → root/quality); `compute_chords` early-return on a sub-hop array (no model load).
- **`features/semantic.py`** — `_axis_track` (contrast in [0,1], 0.5 when neither pole present), `_load_labels` (reads the vendored AudioSet CSV).
- **`worker.py`** — `_heatmap_envelope` (shape/axes/category from `_HEATMAP_META`), `_now` (parseable ISO).
- **`separation.py`** — `_STEM_RE` label extraction; `ENGINES`/`DEFAULT_ENGINES` consistency.
- **`ipc.py`** — `emit` writes exactly one newline-terminated JSON line to the captured output handle.

### Sidecar — state, via tmp_path / in-memory DB

- **`storage.py`** — `write_profile`/`read_profile` round-trip (source_file is a basename, `stems` defaults to `{}`, NaN in `mix` raises under `allow_nan=False`), `write_heatmap` (C-order coercion, float32, relative path), `import_file` (suffix lowercased, relative path shape), `cleanup_partial` (idempotent when absent).
- **`library.py`** — `insert_song`/`list_songs`; the queue/claim/cancel state machine (`mark_queued`, `cancel_queued` restoring analyzed vs unanalyzed, `next_queued`, `mark_analyzing` claim race, `mark_analyzed`/`mark_failed`/`fail_interrupted`); `get_setting` malformed-value fallback; `get_engines` (default, invalid-id drop, empty = mix-only); `get_drum_subsep`.
- **`metadata.py`** — `_from_filename` (`Artist - Title` vs bare stem), `_first_tag` branches via a fake tag object, `extract` precedence via a monkeypatched `mutagen.File`.

### Frontend — pure

- **`npy.ts` `parseNpy`** — magic check, v1 (`uint16`) vs v2 (`uint32`) header-length branch, `descr` dtype rejection, fortran-order rejection, shape parsing (1-D, 2-D, trailing-comma), empty-shape rejection, truncated-buffer contextual error, and a value round-trip through the returned `Float32Array` view.
- **`ipc/messages.ts` zod schemas** — discriminated-union routing (`MixFeatureSchema` by `render`, `SidecarEventSchema` by `type`), `SongSchema` null defaults, `.passthrough()` on events/segments, `ScalarFeatureSchema` number|string value, `ProfileSchema.stems` default `{}`, and the drop-and-warn `FeatureMapSchema` (one bad envelope drops only itself).

## Out of scope (this milestone)

- Svelte component render tests and the `.svelte.ts` runes reducers (`applySidecarEvent`, `inspection.open/close`) — need the Svelte–vitest plugin; deferred to a follow-up slice.
- Graph interaction math and in-component formatters (`chordLabel`, `statusLabel`, wheel-zoom/track-playhead math) — pure but currently module-scoped inside `.svelte` files; require extraction to shared `.ts` modules first (a refactor tracked under the M2 graph-kit work).
- End-to-end pipeline tests, golden-file `profile.json` snapshots, and Rust `cargo test` — documented in M1's practice doc; left for when the surfaces stabilize.
