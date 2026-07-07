# Milestone 3 — Test Suite

Bootstrap the automated test suite the project has specified since M1 but never built. M1's [`architecture.md`](../milestone-1-analysis-pipeline/architecture.md) ("Development Practices") describes `pytest` + `vitest`, a fixture layout, and a `pre-push` hook — none of which existed. No test file was in the repo before this milestone.

Single subfeature: **coverage**. Establish the harness on both layers, then unit-test as much of the current codebase as is cleanly reachable — pure DSP extractors, schema/validation, storage and library state, and the frontend `.npy` parser and IPC schemas — without running the full analysis pipeline, touching `library.db`, or loading ML models.

| Subfeature | Contents                                                                                                                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coverage` | `pytest` + `vitest` harness, synthetic-signal fixtures, unit tests for every cleanly reachable pure unit across the sidecar and frontend, `pre-push` hook gating the suite before code leaves the machine |

Scope is unit-level by design. Component render tests, end-to-end pipeline runs, and Rust `cargo test` are documented as out of scope here and left to later work. See [`design.md`](design.md) for the target inventory and [`implementation.md`](implementation.md) for the slices.
