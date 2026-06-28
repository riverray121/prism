# Prism

A Mac-first desktop dashboard that imports audio files, runs a multi-layer DSP and ML pipeline to extract every viable musical feature, and presents the results as an interactive, time-aligned visualization synced to playback. Each analyzed song produces a machine-readable cue profile and a human-readable inspection view. Built as a Tauri app (Svelte frontend, Rust shell) driving a Python analysis sidecar.

## Getting started

Prerequisites: Rust, Node + pnpm, and uv.

```sh
pnpm install        # frontend deps
uv sync             # Python sidecar env (pins Python 3.12)
pnpm tauri dev      # run the app
```

## Documentation

Design and process live in [`docs/`](./docs/), organized by milestone:

- [`index.md`](./docs/index.md) — milestone list and status; start here
- [`milestone-1-analysis-pipeline/`](./docs/milestone-1-analysis-pipeline/) — the shipped analysis pipeline (`design.md`, `architecture.md`, `implementation.md`)
- [`feature-catalog.md`](./docs/feature-catalog.md) — every analyzed feature (cross-milestone reference)
- [`profile-schema.md`](./docs/profile-schema.md) — JSON profile spec (cross-milestone reference)
- [`ideas.md`](./docs/ideas.md) — unscoped backlog
