# Development Practices

How we build and maintain this project. Companion to `design-doc.md`.

## Testing

**Tools by layer:**
- **Python backend:** `pytest`
- **TypeScript frontend:** `vitest` (integrates with Vite, which Tauri uses)
- **Rust shell:** `cargo test`

**What to test:**
- Feature extractors as pure functions — input a short audio clip, assert output shape, sane value ranges, snapshot match against a fixture
- Schema serialization (golden-file tests) — analyze a fixture, compare the resulting `profile.json` to a checked-in expected output
- Frontend components — lightweight render tests for graphs and library views
- One or two end-to-end integration tests that spawn the sidecar and assert the full pipeline runs

**What not to test:**
- librosa / demucs / PANNs themselves — test our wrappers, not the libraries
- Every UI interaction — manual exploration is fine for a solo app
- The IPC plumbing exhaustively at unit-test granularity

**Fixtures:** `tests/fixtures/` holds ~3 short audio clips (≤30s, varied content — one EDM, one vocal-heavy, one ambient). Small enough to live in git.

## Dependency management

| Layer | Tool | Lockfile |
|---|---|---|
| Python (sidecar) | `uv` | `uv.lock` |
| JavaScript (frontend) | `pnpm` | `pnpm-lock.yaml` |
| Rust (shell) | `cargo` | `Cargo.lock` |

All lockfiles are committed.

**Not used: Docker.** Tauri apps run natively on the user's machine — there is no server to containerize. Docker would add a layer we'd then have to undo to ship.

**Sidecar launch (dev):** Tauri's Rust shell spawns `uv run python -m sidecar` as a child process. This is intentionally *not* Tauri's "true sidecar" (frozen binary) mechanism — the edit-test loop stays in seconds, and `uv.lock` provides the reproducibility that freezing would otherwise give. Python is pinned to **3.12** via uv to de-risk madmom and essentia.

**Bundling for distribution:** deferred. For personal use, run from source. When eventually shipping, the Python sidecar needs to be frozen (PyInstaller / PyOxidizer) and placed at `src-tauri/binaries/sidecar-{target-triple}` for Tauri's sidecar bundler to pick up. Non-trivial because of PyTorch/Demucs native libs — plan for a dedicated spike at M3 when torch first lands.

## CI/CD

**Currently: none.** A solo personal project doesn't need CI from day 1; tests run locally before commits.

Add CI when one of these becomes true:
- Sharing the app with others
- Developing from multiple machines
- A regression ships that tests would have caught

When added: GitHub Actions, minimal workflow running `pytest` + `vitest` on push.

CD is irrelevant until distribution becomes a goal. Tauri has GitHub Actions templates for signed cross-platform installers when that day comes.

## Pre-commit

Use the `pre-commit` framework. Run `pre-commit install` once after cloning; hooks run before each commit.

`.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.5.0     # update to current release at install time
    hooks:
      - id: ruff
      - id: ruff-format
  - repo: https://github.com/biomejs/pre-commit
    rev: v0.5.0     # update to current release at install time
    hooks:
      - id: biome-check
```

**Linters and formatters only — no tests.** Tests in pre-commit are annoying when slow and don't add safety that local test-runs don't already give.

## Type checking

Mandatory from day 1:
- **Frontend:** TypeScript `strict` mode in `tsconfig.json`
- **Backend:** `pyright` strict mode, integrated with the editor

Retrofitting types into untyped Python is painful; starting strict and staying strict is easy.

## Schema validation at IPC boundaries

- **Python:** `pydantic` models for incoming commands and outgoing events; pydantic model for the profile JSON
- **TypeScript:** `zod` schemas for the same messages; zod schema for the profile JSON

Validates at the boundary, so a schema mismatch surfaces immediately instead of as a confusing downstream error.

## Logging

- **Python:** stdlib `logging`. Write to a file under the app's data dir (`~/Library/Application Support/Prism/logs/` on macOS). INFO by default; DEBUG when debugging.
- **Rust shell:** `tracing` (de-facto standard).
- **Frontend:** `console.*` is fine.

Log generously around stage transitions and failures. When something fails at 2am, logs are how you find out why.

## Code organization

Resist abstraction. Solo projects rot fastest when the developer over-architects "for testability" or "for future flexibility."

**Backend layout (proposed):**

```
sidecar/
  ipc.py            # stdin/stdout JSON-lines reader/writer, command dispatch
  schema.py         # pydantic models for messages and profile
  worker.py         # queue worker loop
  library.py        # SQLite access for songs table
  features/
    rhythm.py
    frequency.py
    amplitude.py
    tonal.py
    timbre.py
    spatial.py
    stems.py        # Demucs separation + per-stem features
    ml.py           # PANNs, sections, motifs, novelty
  storage.py        # disk layout, sidecar files, profile writer
```

One module per feature category. Add abstractions only when there are two concrete implementations that need them.

**Frontend layout (proposed):**

```
src/
  components/
    LibraryPanel/
    InspectionView/
    Playback/
    FeatureGraph/   # builds out once 3 concrete graph types work
  ipc/              # send commands, subscribe to events
  state/            # app state (start simple)
```

Don't build a generic `FeatureGraph` abstraction until three concrete graph types are working. Design from the concrete, not the abstract.

## Documentation

- Design decisions live in the design docs (`design-doc.md` + companions). Update when decisions change.
- Don't write docstrings explaining *what* code does — well-named functions handle that. Comment only for non-obvious *why*.
- `README.md` at repo root: one paragraph + pointers to the design doc.
- Development log: `dev-log.md` — protocol in `CLAUDE.md`.
