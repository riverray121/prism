# Dev Log

## Completed

- Design phase: full design docs written — `design-doc.md`, `feature-catalog.md`, `profile-schema.md`, `build-order.md`, `development.md`.
- GitHub repo created: `riverray121/prism` (public), `origin` tracking `main`.
- **M0** — Tauri scaffold: Svelte 5 + SvelteKit (static SPA) + Tailwind v4 frontend, Rust shell. Frontend builds, Rust shell compiles. Demo page replaced with minimal placeholder.
- **M0** — Python sidecar: uv project (Python 3.12), `sidecar/` package with pydantic IPC models. `python -m sidecar` reads JSON-lines on stdin, echoes `pong`; logs to stderr to keep stdout clean.
- **M0** — Rust shell spawns sidecar (`uv run python -m sidecar`), forwards its stdout lines to the frontend as `sidecar-message` events, exposes `send_to_sidecar` command. Frontend sends ping, displays pong. End-to-end ping/pong round-trip (manually verified).
- **M0** — Tooling: pre-commit with ruff (Python) and Prettier + Svelte/Tailwind plugins (frontend); root README. **M0 complete.**

## Todo

- **M1 — Magic moment** (see `build-order.md`) — next: SQLite + import → worker + BPM → inspection view → RMS → playback + playhead
- **M2 — Mix-level DSP fill-out**
- **M3 — Demucs + per-stem DSP**
- **M4 — ML classification + structure**
- **M5 — Favorites, polish, aspirational**

## Notes

- **Sidecar launch: spawn from source.** Tauri's Rust shell spawns `uv run python -m sidecar` as a child process. Reproducibility comes from `uv.lock`, not freezing. Chosen over the Tauri "true sidecar" (frozen binary) because: (1) edit-test loop stays in seconds instead of requiring a PyInstaller rebuild on every Python change; (2) the hard part of freezing is torch/Demucs native libs, which don't land until M3 — so freezing early doesn't de-risk what it would seem to. Do a dedicated freeze spike at M3.
- **Python pinned to 3.12** via uv (not system 3.13). De-risks madmom and essentia, which lag new Python releases and have M-series build friction.
- **If we ever want to package/share the app:** the sidecar will need to be frozen into a single executable (PyInstaller or PyOxidizer). The hard part is bundling torch + Demucs native libs — PyInstaller needs manual hook config for those. Tauri then wraps that binary via its official sidecar mechanism (`src-tauri/binaries/sidecar-{target-triple}`). See Tauri docs on sidecar bundling. Plan for a multi-hour spike when this becomes a goal.
