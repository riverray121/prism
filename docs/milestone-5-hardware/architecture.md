# Hardware — Architecture

## Stack

Unchanged core: Tauri 2 shell · Svelte 5 + SvelteKit (static SPA) · Tailwind v4 · uPlot · Python 3.12 sidecar with JSON-lines IPC.

New dependencies, both standard picks:

- `mdns-sd` (Rust crate): LAN discovery. mDNS is the protocol devices use to announce themselves; WLED broadcasts on it.
- `tauri-plugin-http` (official Tauri plugin): lets the frontend fetch WLED's JSON API directly, without browser cross-origin blocks.

UDP sending uses the Rust standard library; the DDP header is 10 bytes written by hand. No other additions.

## Key decisions

- **Rust does only the network; the frontend keeps the brains.** Three shell surfaces: a background discovery task (mDNS browse, found/lost hubs emitted as `hardware-discovery` events, same pattern as `sidecar-message`), a `ddp_send` command (frame bytes + address in, one UDP packet out), and the HTTP plugin for WLED's JSON API. All hub logic (config parsing, connection state, patching) lives in frontend state modules per the house pattern.
- **Frame flow: the webview render loop pushes, Rust sends.** While playing, the same `requestAnimationFrame` loop the light preview uses samples the evaluated pixel frames at the playhead and invokes `ddp_send` with the raw bytes (~900 bytes at ~60 Hz over IPC; negligible). One clock, no duplication. Known limitation: browsers throttle this loop when the window is hidden, so lights stall if the app is minimized during playback. The fix (sampler in Rust, show shipped to the shell, transport mirrored) is milestone 6 (`rust-sampler` in [`../index.md`](../index.md)).
- **A hub is its MAC address.** Read from WLED's `/json/info` on first contact. The IP is a mutable attribute refreshed by discovery, so DHCP reassignment never orphans a hub. A light's id is `{hub MAC}:{output index}`.
- **The sidecar owns `rig.json`.** App-level file (known hubs, their named lights) beside the library, read/written through two IPC commands (`rig.get`, `rig.update`) with atomic rewrite, mirroring settings and favorites. Discovery results are runtime state; only names and identities persist.
- **The patch lives in the mapping doc.** New `patch` field: light id → program id, defaulting to empty so existing docs load unchanged. `schema_version` stays 0.1.0; no bump, no migration machinery — the app is pre-release and the schema just changes in place. A patch entry referencing a light that is offline or a program that was deleted warns and mutes, never a hard failure (the favorites rule).
- **The evaluator takes a pixel count.** `evaluateDoc` gains a `pixelCount` argument. When the song has a patched light, evaluation runs at that light's count (300 on the bench strip); otherwise the preview default of 60. One evaluation feeds both the on-screen preview and the hardware stream.
- **Off means off, in two steps.** On stop or pause: send one all-zeros frame (instant dark, since the strip otherwise holds the last frame), then set WLED power off over the JSON API so it never falls back to its own saved mode. On play: power on, stream. The exact interaction between WLED's realtime mode and its power state gets verified on the bench in the first slice.
- **State follows the house pattern.** `lib/state/hardware.svelte.ts`: discovered and known hubs, connection status, lights, patch actions, streaming on/off. Components render state and call actions. The streaming loop reads `transport.currentTime` inside its own tick, never through props (hot-path rule).

## Structure

Frontend (`src/lib/`):

- `hardware/` — pure, vitest-covered: `ddp.ts` (frame bytes from the evaluator's pixel matrix at a given frame index), `wled.ts` (parse `/json/info` + `/json/cfg` into hub/light shapes).
- `state/hardware.svelte.ts` — rig + discovery + connection + patch state, streaming loop, persist actions.
- `mapping/schema.ts` — `patch` field + version bump; `evaluate.ts` — `pixelCount` argument.
- `components/hardware/` — the tab: device list with status, Connect new flow, two-column patch view. Dumb: render state, call actions.

Shell (`src-tauri/src/`):

- `hardware.rs` — mdns browse thread emitting `hardware-discovery` events; `ddp_send` command. Registered in `lib.rs` alongside the existing commands.

Sidecar (`sidecar/`):

- `rig.py` — read/write `rig.json` (atomic), wired into `__main__` routing. No analysis-pipeline changes.

Tests: vitest over `ddp`, `wled`, patch schema defaults, and patch state actions; pytest over `rig.py` storage (tmp_path, same seams as `test_storage`).

## Breakouts

None.

## Risks / unknowns

- **mDNS on the LAN.** Some routers block multicast between Wi-Fi clients, which would make discovery find nothing. Fallback if hit: manual IP entry in the Connect new flow (small, and worth having anyway).
- **WLED power-off vs realtime.** Whether a powered-off WLED still displays incoming DDP frames decides the exact play/stop sequencing. Bench-verify in slice 1; the design outcome (dark when stopped, lit when playing) is fixed either way.
- **Wi-Fi jitter.** DDP is fire-and-forget UDP; a lost packet is one skipped frame at 60 Hz, invisible in practice. If sustained jitter shows on the bench, the Ethernet node (`../hardware/shopping-list.md`) is the planned cure, not app-side buffering.
- **Evaluation memory at 300 px.** A 5-minute song at 100 Hz × 300 px × RGB is ~27 MB per pixel program (vs ~5.4 MB at 60). Typed arrays hold; watch it if programs multiply.
