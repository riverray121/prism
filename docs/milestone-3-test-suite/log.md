# Dev Log

## Completed

- **Slice 1 — Harness.** `pytest` wired via `pyproject.toml` (`[dependency-groups] dev`, `[tool.pytest.ini_options]` with `pythonpath=["."]`, `testpaths=["tests"]`); `tests/conftest.py` holds synthetic sine/noise fixtures. `vitest` added to `package.json` with a `test` script and `vitest.config.ts` (node env, `src/**/*.test.ts`). `.pre-commit-config.yaml` gains a `pre-push` stage running both suites, with `default_install_hook_types: [pre-commit, pre-push]` so `pre-commit install` wires both.
- **Slice 2 — Sidecar pure functions.** 13 test modules covering `schema`, `amplitude`, `frequency`, `timbre`, `tonal`, `spatial`, `pitch` (vibrato), `structure` helpers, `chords._idx_to_chord` + sub-hop early return, `semantic` helpers, `worker._heatmap_envelope`/`_now`, `separation._STEM_RE`, and `ipc.emit`. No models loaded; runs on synthetic arrays.
- **Slice 3 — Sidecar state.** `storage` (tmp_path + monkeypatched path globals: profile round-trip, NaN rejection, heatmap C-order/float32, import path shape, cleanup idempotency), `library` (in-memory SQLite from the real schema: full queue/claim/cancel machine, settings fallback, engine resolution), `metadata` (fake tag object + monkeypatched `mutagen.File`).
- **Slice 4 — Frontend pure.** `npy.test.ts` (every parse branch via a faithful `.npy` buffer builder) and `ipc/messages.test.ts` (discriminated-union routing, null defaults, passthrough, string|number value, `stems` default, drop-and-warn feature map).

Green as of landing: `uv run pytest` → 73 passed (~2.3s); `pnpm test` → 17 passed (~0.1s); `pnpm check` → 0 errors.

Slices 5–6 (runes reducers, extract-then-test graph math) remain deferred per `implementation.md` — except graph math, now covered by M2's `src/lib/graphs/axis.test.ts` (the extraction happened in the M2 graph kit).

Coverage review (M2 slice 12) added: `test_rhythm`, `test_stem` (wiring over faked extractors), `test_models`, and frontend `format`/`chords`/`graphs/tags`/`graphs/heatmap` tests; M2 slices had already added `test_derive`, `test_settings`, `test_youtube`, and favorites coverage in `test_storage`. 99 pytest + 52 vitest green.

- **Slice 5 — Frontend runes reducers.** `vitest.config.ts` gains `@sveltejs/vite-plugin-svelte` (node env → server transform, so `$state` stores compile to plain objects) plus a manual `$lib` alias. `src/lib/state/sidecar.test.ts` drives `applySidecarEvent` through the handler captured from a mocked `onSidecarEvent` (every event type, stale-profile drop, non-resolving-favorite warn) and the session start/stop generation races; `inspection.test.ts` covers open/close, `pathForKey` (mix/stem/sub-stem/misses), favorites toggle round-trip, and transport wiring over a mocked transport module; `transport.test.ts` runs the real transport against a fake `AudioContext` with hand-resolved decodes — pre-decode adopt/abandon, play/pause, superseded-play and reset-during-decode races, scrub clamp/silence/resume, rate changes, paused `switchSource`. 111 pytest + 89 vitest green.

- **Observability subfeature (moved in from its own milestone; design in `observability/design.md`).** O1 — `sidecar/logs.py`: rotated `sidecar.log` (5 MB × 3) beside stderr, `sys/threading.excepthook` CRITICAL tracebacks, `faulthandler` → `crash.log`, `PRISM_LOG_DIR`/`PRISM_LOG` overrides; covered in `tests/test_logs.py`. O2 — Rust `applog` module (rotated `app.log`, panic hook with backtrace, captured sidecar stderr, sidecar exit codes), `session.lock` unclean-exit marker + `startup_report`/`log_frontend_error` commands, frontend `health` state (window error forwarding, sidecar-death banner with exit code, dismissible unclean-exit notice, Open-logs via opener plugin).

## Todo

- [x] Slice 5 — Frontend runes reducers
- [x] Slice 6 — resolved by M2 (axis.ts + helper tests)
- [x] Slice 7 — Observability: sidecar logs (commit c47126e)
- [x] Slice 8 — Observability: shell crash detection + health surface (built + checks green; kill-the-sidecar / force-quit runtime verification pending)

## Notes

- Correction to the M1 practice doc: the pydantic models live in `sidecar/schema.py`, not `models.py`. `sidecar/models.py` is the weights download-on-first-run registry.
- Seams used by tests (so future changes know what tests patch): `storage.SONGS_DIR` / `storage.LIBRARY_ROOT` / `storage.DB_PATH` (module globals, monkeypatched to `tmp_path`); `ipc._OUT` (stdout captured at import); `library` state-machine functions take an explicit connection, so tests drive them against an in-memory SQLite built from `library._SCHEMA` + `_SETTINGS_SCHEMA`; `separation.ENGINES` / `DEFAULT_ENGINES` drive `library.get_engines`.
