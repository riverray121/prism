# Hardware — Implementation

Thin slices in build order. Each leaves the suite green. Bench steps (anything that lights the physical strip) are user-run. The repo-wide `/clean` deferred from M2 and M4 lands at the end of this milestone.

## Slice 0 — Rust network surface

- Goal: the shell can find hubs and light pixels; everything after this is plumbing to it.
- Touches: `src-tauri/src/hardware.rs` (`ddp_send` command: address + frame bytes → one UDP packet; mDNS browse thread for WLED's service type emitting `hardware-discovery` found/lost events), registration in `lib.rs`, `Cargo.toml` (`mdns-sd`) + `tauri-plugin-http` install, `lib/hardware/ddp.ts` (pure: DDP header + frame packing from a pixel matrix at a frame index).
- Acceptance: `ddp.test.ts` — header bytes match the DDP spec, packing extracts the right frame from a synthetic matrix; discovery events arrive in a frontend listener with the bench hub on the network; a hand-built solid-color frame through `ddp_send` lights the strip (bench, user-run).

## Slice 1 — Hub client + rig persistence

- Goal: a hub's identity and lights round-trip: read from the device, saved to disk, reloaded on launch.
- Touches: `lib/hardware/wled.ts` (fetch + parse `/json/info` and `/json/cfg` into `{mac, name, ip, lights: [{id, pixelCount}]}`), `sidecar/rig.py` (atomic read/write of `rig.json`) + `__main__` routing (`rig.get`, `rig.update`) + `ipc/messages.ts` (`rig` event), `lib/state/hardware.svelte.ts` (known hubs from rig, discovery merge by MAC with IP refresh, connect/forget actions, connection status).
- Acceptance: pytest covers rig round-trip/atomicity/missing-file; vitest covers WLED payload parsing (real captured JSON from the bench hub as fixture) and discovery-merge by MAC when the IP changed; hub config survives app relaunch.

## Slice 2 — Devices UI

- Goal: the Hardware tab replaces its stub: hubs listed, Connect new works, known hubs connect on their own.
- Touches: `components/hardware/` (HardwareView, device list with status badges, Connect new flow: pick a discovered hub → name it → saved to the rig; forget action), `TabContent.svelte` routing, auto-connect on discovery for known hubs.
- Acceptance: with the bench hub online the tab shows it found; naming it persists it; relaunching the app reconnects without interaction; unplugging the hub flips it to offline (bench, user-run).

## Slice 3 — Patch

- Goal: a program plays on a light, on paper: the link is authored and saved per song.
- Touches: `lib/mapping/schema.ts` (`patch` field, light id → program id, defaults empty, `schema_version` unchanged), `components/hardware/` two-column patch view (programs left from the mapping doc, connected lights right, click-to-link, one active program per light), patch actions in `state/hardware.svelte.ts` writing through the mapping doc's existing debounced save, warn-and-mute for offline lights and deleted programs.
- Acceptance: vitest covers patch defaults on existing docs, link/unlink actions, and muting on a dangling program id; a patch survives song switch and relaunch; docs written before the field existed load unchanged.

## Slice 4 — Evaluator at the light's pixel count

- Goal: the show is computed at the strip's real resolution.
- Touches: `lib/mapping/evaluate.ts` (`pixelCount` argument threaded through position/motion/pixel-matrix paths), `state/mapping.svelte.ts` (evaluation uses the patched light's count, preview default of 60 otherwise; re-evaluate on patch change), preview components render whatever count evaluation produced.
- Acceptance: evaluator tests pass at 60 and 300 (spread, zones, chase phase all scale); patching the 300-pixel light re-evaluates and the pixel lane/preview show 300 columns; unpatching returns to 60.

## Slice 5 — Streaming + off-on-stop

- Goal: press play, the strip plays the show in sync; stop, and it goes dark.
- Touches: `state/hardware.svelte.ts` streaming loop (rAF while `transport.playing`: sample the evaluated pixel matrix at the playhead, `ddp_send` to each patched light's hub), play/stop sequencing (play: WLED power on via JSON API, stream; stop/pause: one all-zeros frame, then power off — exact ordering bench-verified against WLED's realtime mode), loop teardown on tab switch/unmount/hub offline.
- Acceptance: vitest covers frame-index selection and the stop sequence's calls; on the bench (user-run): strip tracks playback and scrubbing with no visible lag against the on-screen preview, pause and stop both leave it dark, killing playback mid-song never leaves pixels stuck lit.
