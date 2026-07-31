# Hardware — Design

## Summary

The Hardware tab becomes real: discover ESP32 hubs running WLED on the local network, connect to them, patch a song's mapping programs onto the physical lights they drive, and press play to watch the show on real fixtures in sync with playback. This milestone targets exactly the hardware that exists (one ESP32 hub driving one 300-pixel strip), but hubs and lights are modeled as lists from day one so future hardware (Dig-Quad, more strips, DMX nodes) slots in without rework.

Groundwork: [`../hardware/rig.md`](../hardware/rig.md) (the bench rig), milestone-4 [`overview.md`](../milestone-4-mapping/overview.md) (fixture/patch model this fulfills).

## How it works

### Hubs own their light config

A hub is an ESP32 running stock WLED. No custom firmware: WLED already stores its own light setup on the device (pixel count, GPIO pin, color order) and reports it over its JSON API. Prism never configures strips; it asks the hub what is attached. Auto-detecting attached lights electrically is not possible (the strip data line is one-way), so config-on-the-hub is the model, and it is already done once in WLED's own web UI.

### Devices

- The tab opens on a device list. Prism scans the LAN via mDNS (WLED advertises itself), so no typed IPs and no stale-DHCP addresses.
- Known hubs connect automatically when found. Unknown hubs appear under **Connect new**: pick one, name it, Prism saves it to the app-level rig.
- On connect, Prism reads the hub's config; each configured output becomes a named **light** with a pixel count (today: one WS2812B strip, 300 pixels).
- Each hub shows its connection status; a hub that drops off the network shows as offline, and its patches simply stop streaming.

### Patch

- Two columns: the song's mapping programs on the left, connected lights on the right, with a click-to-link connection between them. Linking a program to a light means that program plays on that light.
- One active program per light. Shortlists and layering come later.
- The patch is saved per song, alongside the rest of the mapping doc.

### Play

- The mapping evaluator already precomputes each program's per-pixel color frames across the whole song on the 100 Hz grid. It computes at the patched light's pixel count (300 for the bench strip) instead of the current fixed 60.
- A streamer in the Rust shell reads the playback clock, picks the current frame, and sends it to the hub as a DDP packet (plain UDP, WLED's preferred realtime input). Same sampling pattern as the on-screen light preview, UDP instead of canvas.
- Whole-strip brightness/color/gate is the floor; per-pixel output costs nothing extra since the frames are already per-pixel, so programs that produce spatial output just work.
- When playback stops or pauses, the strip turns off. No fallback look, no WLED preset, nothing: playing means light, not playing means off.

## Usage

Open a song, switch to Hardware. Your hub is found and connected automatically (first time: Connect new, give it a name). The strip appears as a light on the right, the song's programs on the left. Click program, click light, press play. The strip plays the show in sync. Stop, and it goes dark.

## Scope

- In: mDNS hub discovery, app-level rig store (hubs + lights), auto-connect + Connect new flow, connection status, hub config read over WLED's JSON API, two-column patch UI saved per song, evaluator at the patched light's pixel count, Rust-shell DDP streamer synced to the transport clock, off-on-stop.
- Out: custom ESP32 firmware, multiple simultaneous hubs in the UI (the model supports it; the UI is built against one), DMX/sACN/Art-Net, fixture types beyond addressable strips, program shortlists or layering per light, master brightness or live tweak controls during playback, cue files on disk, Sim tab.

## Open questions

None at the design level. Where frames cross from the frontend into Rust, and which discovery/UDP crates to use, are architecture decisions.
