# Dev Log

## Completed

- Design phase: full design docs written — `music-analysis-design-doc.md`, `feature-catalog.md`, `profile-schema.md`, `build-order.md`, `development.md`.

## Todo

- **M0 — Scaffolding**
  - Tauri project scaffold (TypeScript frontend, Rust shell)
  - Python sidecar spawned via Tauri's built-in sidecar mechanism
  - stdin/stdout JSON-line ping/pong round-trip
  - Python deps managed with `uv`
  - Initial `pre-commit` config installed
  - `README.md` at repo root with one-paragraph project description + links to design docs

- **M1 — Magic moment** (see `build-order.md`)
- **M2 — Mix-level DSP fill-out**
- **M3 — Demucs + per-stem DSP**
- **M4 — ML classification + structure**
- **M5 — Favorites, polish, aspirational**

## Notes

- **Sidecar launch: spawn from source.** Tauri's Rust shell spawns `uv run python -m sidecar` as a child process. Reproducibility comes from `uv.lock`, not freezing. Chosen over the Tauri "true sidecar" (frozen binary) because: (1) edit-test loop stays in seconds instead of requiring a PyInstaller rebuild on every Python change; (2) the hard part of freezing is torch/Demucs native libs, which don't land until M3 — so freezing early doesn't de-risk what it would seem to. Do a dedicated freeze spike at M3.
- **Python pinned to 3.12** via uv (not system 3.13). De-risks madmom and essentia, which lag new Python releases and have M-series build friction.
- **If we ever want to package/share the app:** the sidecar will need to be frozen into a single executable (PyInstaller or PyOxidizer). The hard part is bundling torch + Demucs native libs — PyInstaller needs manual hook config for those. Tauri then wraps that binary via its official sidecar mechanism (`src-tauri/binaries/sidecar-{target-triple}`). See Tauri docs on sidecar bundling. Plan for a multi-hour spike when this becomes a goal.
