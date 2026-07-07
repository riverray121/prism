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

## Slice 5 — Frontend runes reducers

- Goal: `applySidecarEvent` (snapshot/profile stale-guard/import lifecycle), `inspection.open/close/toggleFavorite`, and `transport` reset/race guards under test.
- Touches: vitest config gains `@sveltejs/vite-plugin-svelte` so `.svelte.ts` runes modules compile; `src/lib/state/*.test.ts` with `$lib/ipc` (and Web Audio, for transport) mocked.
- Acceptance: reducer routes every event type onto the right store; stale profile events are dropped; favorites toggle round-trips; `pnpm test` green.
- Out of scope: `.svelte` component rendering tests.

## Slice 6 — Extract-then-test graph math (RESOLVED by M2)

- The M2 graph kit extracted the interaction math into `src/lib/graphs/axis.ts` (tested: `axis.test.ts`) and the formatters into `lib/format.ts` / `lib/chords.ts` / `graphs/tags.ts` / `graphs/heatmap.ts` (tested in M2 slice 12). Nothing remains here.

## Slice 7 — Observability: sidecar logs (IMPLEMENTED)

- Landed ahead of this spec (commit `c47126e`): `sidecar/logs.py` — rotated `sidecar.log` (5 MB × 3) beside stderr, `sys`/`threading` excepthooks logging CRITICAL tracebacks, `faulthandler` → `crash.log`, `PRISM_LOG_DIR`/`PRISM_LOG=debug` overrides; wired in `__main__`; covered by `tests/test_logs.py`.

## Slice 8 — Observability: shell crash detection + health surface (IMPLEMENTED — runtime verification pending)

- Goal: the app-shell half of `observability/design.md` — a dead app or sidecar always leaves an artifact and the UI says so.
- Touches: `src-tauri/src/applog.rs` (rotated `app.log`, panic hook + backtrace, `chrono` timestamps; no tracing dep — the shell logs a handful of event kinds, not spans), `lib.rs` (log sidecar stderr/exit codes, `session.lock` written at startup + removed on `RunEvent::Exit`, `startup_report` + `log_frontend_error` commands), `capabilities` (`opener:allow-open-path`), `src/lib/state/health.svelte.ts` (window error forwarding, `sidecar-exited` listener, startup report), shell banners in `+page.svelte` (sidecar-death with exit code + Open logs; dismissible unclean-exit notice).
- Acceptance: kill the sidecar process → red banner with exit code appears and `app.log` records it; force-quit the app → next launch shows the unclean-exit notice; a thrown frontend error lands in `app.log`; "Open logs" opens the log folder; `cargo check` + `pnpm check` clean.
- Out of scope: sidecar auto-restart, telemetry, in-app log viewer.
