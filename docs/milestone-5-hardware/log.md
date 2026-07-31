# Dev Log

## Completed

- Slice 0 — Rust network surface: `hardware.rs` (`ddp_send` over one shared UDP socket, mDNS browse thread → `hardware-discovery` events), `tauri-plugin-http` + `http://*:*` capability, pure `lib/hardware/ddp.ts` (spec header, >480 px frames split with PUSH on the last packet, blackout frame) with vitest. Bench check (solid frame lights the strip) pending user run.

- Slice 1 — Hub client + rig persistence: `wled.ts` (zod rig schema + `/json/info`+`/json/cfg` parse into rig-shaped hubs, light id `{mac}:{index}`, `fetchHub` over tauri-plugin-http), `sidecar/rig.py` (atomic `library/rig.json`, `rig.get`/`rig.update` routing, `rig` event), `state/hardware.svelte.ts` (rig + discovered + online, MAC merge with IP refresh + light refresh preserving user names, connect/forget, discovery listener wired in `+page.svelte`). Bench hub was unreachable at build time, so the WLED fixtures are hand-built to the JSON API shape — swap in a real capture if bench parsing disagrees.

- Slice 2 — Devices UI: `components/hardware/HardwareView.svelte` mirrors the Mapping layout — Devices in a left `ResizablePanel` (saved hubs with status dot + lights + hover Forget; Connect new rows with name input), patch in the main column; song-open gated in `TabContent` like the other tabs (stub otherwise; discovery still runs app-level in state). Auto-connect is the slice-1 MAC merge. Bench checks (found/naming/relaunch/unplug) pending user run.

- Slice 3 — Patch: `patch` field on the mapping doc (light id → program id, defaults empty, version unchanged), `lib/hardware/patch.ts` (`activePatch` resolves entries against rig + online map; offline/dangling/disabled mute), `setPatch` action riding the doc's debounced save, `PatchPanel.svelte` two-column click-to-link view inside HardwareView. Vitest: legacy-doc defaults, link/unlink, muting.

- Slice 4 — Evaluator at the light's pixel count: `pixelCount` argument through `evaluatePixels`/`evaluateProgram`/`evaluateDoc` and into `programKey` (patch change = new key = re-evaluate), `patchedPixelCount` in patch.ts (largest patched light in the rig, offline hubs still count; else 60), `reevaluate` reads it from the rig so patch/rig edits re-trigger, LightPreview renders each output's own count (`setPatch` moved into `mapping.svelte.ts` beside the other doc-edit actions — it edits the doc, and it un-cycles hardware↔mapping imports). Vitest at 60 and 300: spread, zones, chase, cache-key.

- Slice 5 — Streaming + off-on-stop: `streamTick`/`stopStream` in hardware state (per-target DDP frames at the playhead via shared `frameIndexAt`; solid whole-strip frames mirror the preview's swatch math when a program has no pixel matrix; stale-resolution matrices skip; first frame powers the hub on; stop = blackout frame then power off, offline hubs skipped), `ddpSend` in ipc, `setHubPower` in wled.ts, rAF loop hosted by HardwareView (`$effect` while `transport.playing`, cleanup on pause/stop/tab switch/unmount). The Mapping evaluation effect moved to `ensureEvaluationCurrent()` in mapping state so HardwareView keeps outputs fresh without Mapping open. Vitest: frame selection, power-on-once, solid fallback, stale skip, stop ordering, offline skip. Bench sync test pending user run.

## Todo

- [ ] Bench pass over slices 0–5 (user): solid frame lights strip, discovery/naming/relaunch/unplug, patch survives relaunch, 300-px re-evaluation, sync + scrub + dark-on-stop
- [ ] Repo-wide `/clean` (deferred from M2 and M4) — after the bench pass

## Notes

- Spec-time decisions: hubs own their light config (stock WLED, no custom firmware); hub identity is the MAC address; patch is per-song in the mapping doc; no schema version bumps — the schema changes in place while the app is pre-release; stopped playback means the strip is off, no fallback looks.
- The frame sampler runs in the webview render loop this milestone; moving it into the Rust shell (show shipped to Rust, transport mirrored) is milestone 6 (`rust-sampler` in `../index.md`). Lights stall if the window is minimized during playback until then.
- Bench rig this milestone builds against: `../hardware/rig.md` (ESP32 + WLED 16.0.1, WS2812B 300 px, DDP on port 4048).
- `setPatch` lives in `mapping.svelte.ts` (it edits the mapping doc; also keeps hardware→mapping imports one-directional for state init), not hardware state as implementation.md sketched.
- Rig light entries store `pixel_count` but not WLED's output `start` offset; a multi-output hub would need it for DDP buffer addressing. Single-strip milestone — deferred.
- Streaming runs only while the Hardware tab is visible (the rAF loop is hosted by HardwareView, which also owns evaluation refresh when Mapping is closed). The M6 Rust sampler lifts both limits.
- Discovery races the webview: mDNS resolves land within the first second of app startup, before the frontend's event listener attaches, and WLED re-announces on hour-scale TTLs. The shell keeps a found-hubs map and exposes `discovery_snapshot`; the frontend pulls it right after attaching. Verified on the bench log (`mdns found wled-bbc85c` at startup).
- Connect new has a manual Add-by-IP fallback (`probeAddress` in hardware state) for networks where multicast is blocked, with checking/failed feedback in the panel. Scanning is a 15 s UI window (`scan`/`startScan`): spinner (ProgressRing quarter-arc + `animate-spin`) while open, a Scan again button after — the shell's mDNS browse itself never stops; Scan again just re-pulls the snapshot.
- Patch renders as aligned full-width rows (`grid-cols-[1fr_3rem_1fr]`): linked program–light pairs sorted first and joined by an accent string across the gutter; unlinked programs/lights fill the remaining rows side by side.
- The unclean-exit banner is release-only (`!cfg!(debug_assertions)` in lib.rs): dev-watcher rebuilds SIGKILL the app, stranding `session.lock`, which made every Rust edit masquerade as a crash. The stale-marker log line still records in both build types.
- `uvx ruff check sidecar/` reports 10 pre-existing errors (newer ruff rules, `datetime.UTC` etc.) untouched by this milestone; fold into the repo-wide `/clean`.
