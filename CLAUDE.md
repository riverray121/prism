# Prism

Desktop audio-analysis dashboard: import a track, analyze it (mix-level DSP + multi-engine stem separation + ML), and explore the features against synced playback. Tauri shell, Svelte 5 frontend, Python analysis sidecar.

Design and process live in `docs/`. Read them before starting work.

## Session start

Read `docs/index.md`, then the ACTIVE milestone's `log.md` → `implementation.md`, then `design.md` / `architecture.md` as the task needs. Only the ACTIVE milestone is current — ignore shipped ones unless asked. Cross-milestone references: `docs/feature-catalog.md` (every analyzed feature), `docs/profile-schema.md` (profile.json spec).

Workflow skills: `/spec` plans a milestone's docs through conversation, `/slice` builds one vertical slice end to end, `/clean` runs the end-of-milestone repo pass.

## Stack

- Tauri 2 (Rust shell) — spawns the sidecar, owns the window.
- Svelte 5 + SvelteKit (static SPA) + Tailwind v4 — frontend; uPlot for graphs.
- Python 3.12 sidecar (uv) — librosa / torch / PANNs / audio-separator; JSON-line IPC over stdin/stdout.

## Commands

- Test: `uv run pytest` · `pnpm test`
- Lint: `uvx ruff check sidecar/` · `pnpm format:check`
- Typecheck: `pnpm check`
- Run: `pnpm tauri dev`

## Git

- Remote: `origin` (github.com/riverray121/prism)
- Push: only after the user has tested and confirmed a feature works.

## Standing rules

- **The user tests features, not Claude.** Do not run the analysis pipeline on library songs, regenerate `profile.json`, or modify `library.db` to demonstrate or verify a feature. Verify your own code only with isolated, unit-level checks (pure extractor calls on a signal, type checks, lint) that never touch the library. Only modify library data when **explicitly** asked.
- **The sidecar is not hot-reloaded.** Tauri spawns it once at launch and restarts it only on Rust changes — after editing any sidecar code, the app must be relaunched before its analysis reflects the change.
- **Launch the app yourself** after changes the user needs to test, so a fresh sidecar with the current code is running. Just launch it — do not import or analyze anything.
