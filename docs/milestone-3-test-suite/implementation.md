# Test Suite — Implementation

Thin slices in build order. Each leaves the suite green.

## Slice 1 — Harness

- Goal: `pytest` and `vitest` both run, each with one passing test, wired to run on `git push`.
- Touches: `pyproject.toml` (`[dependency-groups] dev`, `[tool.pytest.ini_options]` with `pythonpath`/`testpaths`), `tests/conftest.py` (synthetic-signal fixtures), `package.json` (`vitest` dev dep + `test` script), `vitest.config.ts`, `.pre-commit-config.yaml` (`pre-push` stage running both suites).
- Acceptance: `uv run pytest` and `pnpm test` both green; `pre-push` hook invokes them.

## Slice 2 — Sidecar pure functions

- Goal: cover every pure unit reachable on a synthetic signal, no models.
- Touches: `tests/test_schema.py`, `tests/test_amplitude.py`, `tests/test_frequency.py`, `tests/test_timbre.py`, `tests/test_tonal.py`, `tests/test_spatial.py`, `tests/test_pitch.py`, `tests/test_structure.py`, `tests/test_chords.py`, `tests/test_semantic.py`, `tests/test_worker.py`, `tests/test_separation.py`, `tests/test_ipc.py`.
- Acceptance: extractors assert output shape, value ranges, and each coded edge branch; `_best_key`/`_idx_to_chord`/`_axis_track`/structure helpers assert exact outputs on hand-built inputs.

## Slice 3 — Sidecar state

- Goal: filesystem and DB logic tested without touching real state.
- Touches: `tests/test_storage.py` (tmp_path + monkeypatched path globals), `tests/test_library.py` (in-memory SQLite from the real schema), `tests/test_metadata.py` (fake tag object + monkeypatched `mutagen.File`).
- Acceptance: profile round-trip, heatmap C-order/dtype, import path shape, cleanup idempotency; the full queue/claim/cancel state machine and settings resolution.

## Slice 4 — Frontend pure

- Goal: the two cleanest frontend targets covered under vitest.
- Touches: `src/lib/npy.test.ts`, `src/lib/ipc/messages.test.ts`.
- Acceptance: `parseNpy` covers every parse branch and edge error; the zod schemas cover discriminated-union routing, defaults, passthrough, and the drop-and-warn feature map.

## Slice 5 — Frontend runes reducers (deferred)

- Goal: `applySidecarEvent` (profile stale-guard) and `inspection.open/close` under test.
- Touches: Svelte–vitest plugin setup so `.svelte.ts` runes modules import; `src/lib/state/*.test.ts` with `$lib/ipc` mocked.
- Blocked on: deciding the vitest Svelte-plugin config; not required for the milestone's green bar.

## Slice 6 — Extract-then-test graph math (deferred)

- Goal: graph interaction math (`trackPlayhead`, wheel zoom/pan, colormap) and component formatters (`chordLabel`, `formatScalar`, `statusLabel`) lifted out of `.svelte` files into tested shared `.ts` modules.
- Note: overlaps the M2 graph-kit slices, which already plan to centralize interaction logic; land the tests with that extraction rather than duplicating it here.
