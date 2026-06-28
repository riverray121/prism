# Development Practices

How we build and maintain this project. Companion to `design.md`.

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

**When tests run:** the full suite runs automatically on `git push` via a `pre-push` hook, not on every commit. This keeps commits fast (test startup is slow once librosa/torch are imported) while gating code before it leaves the machine — matching the "push only after tested" rule in `CLAUDE.md`. Wired in M1, when the first tests exist (an empty `pytest` run fails with exit code 5, so the hook can't be added before then).

## Dependency management

| Layer                 | Tool    | Lockfile         |
| --------------------- | ------- | ---------------- |
| Python (sidecar)      | `uv`    | `uv.lock`        |
| JavaScript (frontend) | `pnpm`  | `pnpm-lock.yaml` |
| Rust (shell)          | `cargo` | `Cargo.lock`     |

All lockfiles are committed.

**Not used: Docker.** Tauri apps run natively on the user's machine — there is no server to containerize. Docker would add a layer we'd then have to undo to ship.

**Sidecar launch (dev):** Tauri's Rust shell spawns `uv run python -m sidecar` as a child process. This is intentionally _not_ Tauri's "true sidecar" (frozen binary) mechanism — the edit-test loop stays in seconds, and `uv.lock` provides the reproducibility that freezing would otherwise give. Python is pinned to **3.12** via uv to de-risk madmom and essentia.

**Bundling for distribution:** deferred. For personal use, run from source. When eventually shipping, the Python sidecar needs to be frozen (PyInstaller / PyOxidizer) and placed at `src-tauri/binaries/sidecar-{target-triple}` for Tauri's sidecar bundler to pick up. Non-trivial because of PyTorch/Demucs native libs. Not part of development — only if/when distribution becomes a goal.

## CI/CD

**Currently: none.** A solo personal project doesn't need CI from day 1; tests run locally before commits.

Add CI when one of these becomes true:

- Sharing the app with others
- Developing from multiple machines
- A regression ships that tests would have caught

When added: GitHub Actions, minimal workflow running `pytest` + `vitest` on push.

CD is irrelevant until distribution becomes a goal. Tauri has GitHub Actions templates for signed cross-platform installers when that day comes.

## Pre-commit

Use the `pre-commit` framework. Run `pre-commit install` once after cloning. Fast linters and formatters run on every commit; the test suite runs on `git push` (see [Testing](#testing) for the `pre-push` rationale).

Python uses `ruff` (lint + format). The frontend uses **Prettier** with `prettier-plugin-svelte` and `prettier-plugin-tailwindcss`, run as a local hook so it picks up the project's plugins from `node_modules`. Prettier replaces the originally-planned Biome because Biome does not format `.svelte` files, which is where most frontend code lives; Prettier covers Svelte, TS/JS, CSS, JSON, and Markdown, and auto-sorts Tailwind classes. Prettier is formatter-only — JS linting (ESLint) can be added later if real gaps appear; type diagnostics already come from `svelte-check` (`pnpm check`).

See `.pre-commit-config.yaml` for the current hooks and pinned revisions.

**Commit stage: linters and formatters only.** Tests on the commit stage are annoying when slow and don't add safety that the `pre-push` run doesn't already give.

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

**Frontend layering contract (keep the UI replaceable).** The milestone-1 UI is intentionally minimal; a UI/UX design doc and reskin land in milestone 2 (see `../milestone-2-ui-rework/ideas.md`). To make that rework clean, keep a hard split between durable and disposable layers:

- **Durable, presentation-free** — survives a reskin untouched: `lib/ipc` (commands + event stream), `lib/ipc/messages.ts` (zod schemas + types), `lib/state` (reactive stores and the actions that mutate them, e.g. `open`/`close`/queueing).
- **Disposable presentation** — what the milestone-2 rework replaces: `lib/components` (the `.svelte` views) and all Tailwind/styling.

Rules that preserve the split:

- Components are dumb: they render state and call actions. No IPC calls, disk access, or domain logic buried in markup — only presentational helpers (formatting) and event handlers that delegate to `state`/`ipc`.
- Logic and side effects live in `state` or `ipc`, never in a component.
- A component reskin must require zero changes to `ipc`/`state`/`messages.ts`. If a UI change forces edits there, the split has leaked — fix the layering, not the symptom.

When shadcn-svelte is adopted (lazily; see the design doc) it formalizes the component layer without touching the durable layers.

## Documentation

- Design decisions live in the design docs (`design.md` + companions). Update when decisions change.
- Don't write docstrings explaining _what_ code does — well-named functions handle that. Comment only for non-obvious _why_.
- `README.md` at repo root: one paragraph + pointers to the design doc.
- Development log: `log.md`.
