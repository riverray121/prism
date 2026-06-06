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

Design and process live in [`docs/`](./docs/):

- [`design-doc.md`](./docs/design-doc.md) — overall design
- [`feature-catalog.md`](./docs/feature-catalog.md) — every analyzed feature
- [`profile-schema.md`](./docs/profile-schema.md) — JSON profile spec
- [`build-order.md`](./docs/build-order.md) — milestones
- [`development.md`](./docs/development.md) — tooling and engineering practices
