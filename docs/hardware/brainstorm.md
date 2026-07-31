# Hardware — Brainstorm

Pre-`/spec` notes on physical hardware for Prism's output stage. Goal: pick a controller path and a first set of lights to experiment with. Fixture types this must eventually serve: `led_strip`, `led_strip_addressable`, `strobe`, `wash`, `mover` (milestone-4 `overview.md`).

Status: options explored; first-order decisions made — see `shopping-list.md`.

---

## Reframe: the network is the controller

The instinct "one controller with lots of I/O" points at a single big box. The lighting world solved this differently: the PC emits a network protocol, and small **nodes** convert it to wire signals. Prism (Rust shell or sidecar) sends UDP packets; each node drives its lights. Scaling = adding nodes, not outgrowing a box.

Two wire worlds, two node kinds:

| World              | Signal                      | Fixtures                      | Node                                               |
| ------------------ | --------------------------- | ----------------------------- | -------------------------------------------------- |
| Addressable pixels | WS281x data line            | LED strips, matrices          | ESP32 running WLED (or dedicated pixel controller) |
| DMX512             | RS-485 bus, 512 ch/universe | pars, washes, movers, strobes | Art-Net/sACN→DMX node, or USB DMX interface        |

Protocols Prism would emit, all plain UDP, all with Rust crates available:

- **sACN (E1.31)** — industry standard, multicast, universe = 512 channels. Works for both worlds.
- **Art-Net** — older equivalent, equally universal.
- **DDP** — simpler pixel-oriented protocol, WLED's preferred realtime input; lowest overhead for strips.

Latency: all are fire-and-forget UDP on the LAN — ~1 ms wired, ~5–30 ms on decent Wi-Fi. Fine for music sync (cloud APIs like Hue are not).

---

## Controller candidates

### Pixel side (the must-buy)

| Option                            | ~Price | Notes                                                                             |
| --------------------------------- | ------ | --------------------------------------------------------------------------------- |
| Bare ESP32 devkit + level shifter | $15    | Cheapest; breadboard wiring, no fuses; fine for a first strip                     |
| Athom / GLEDOPTO WLED controller  | $20–25 | Pre-flashed WLED, cased, 1–2 outputs; zero soldering                              |
| **QuinLED Dig-Uno**               | ~$30   | Purpose-built WLED board: level shifter, fuse, screw terminals; 1–2 outputs       |
| **QuinLED Dig-Quad**              | ~$50   | Same, 4 fused outputs, up to ~1000+ pixels comfortably; Ethernet add-on available |
| Falcon F16v4 / Advatek PixLite    | $200+  | Holiday-light scale (10k+ pixels); overkill now, the ceiling if ever needed       |

WLED itself matters as much as the board: it accepts DDP/sACN/Art-Net realtime streams, handles RGB and RGBW, and gives a web UI for testing strips without Prism in the loop.

### DMX side (when pars/movers arrive)

| Option                      | ~Price | Notes                                                           |
| --------------------------- | ------ | --------------------------------------------------------------- |
| DMXking eDMX1 PRO           | ~$100  | Ethernet Art-Net/sACN → 1 DMX universe; rock solid              |
| Enttec ODE Mk3              | ~$180  | Same category, the classic name                                 |
| Enttec DMX USB Pro          | ~$150  | USB instead of network; ties DMX to the app host, less flexible |
| Cheap USB "Open DMX" (FTDI) | ~$20   | No frame buffer, timing done host-side; usable for experiments  |

Direction: network nodes over USB — same protocol stack as the pixel side, so Prism's output code is one sACN/DDP emitter regardless of wire world.

---

## Lights

### Addressable strips (first buy)

Chip choice:

| Chip            | V    | Why / why not                                                                           |
| --------------- | ---- | --------------------------------------------------------------------------------------- |
| WS2812B         | 5 V  | The default; ubiquitous, cheapest; voltage drop limits runs to ~2–3 m without injection |
| **WS2815**      | 12 V | Much less voltage drop (5 m runs fine), backup data line; RGB only                      |
| **SK6812 RGBW** | 5 V  | Adds a true white channel — maps directly to `color_temp`/`saturation` channels         |

60 LEDs/m is the sweet spot for density vs power. A 5 m 60/m strip ≈ 300 pixels ≈ 18 A at 5 V full white — power is the real constraint, not the controller.

Supporting gear: Mean Well PSU (LRS-350-12 for WS2815, ~$35), 3-pin JST pigtails, power-injection wire, inline fuses, aluminum diffuser channel (makes strips look dramatically better).

### DMX experiment pack (optional now, natural second wave)

Covers the remaining fixture types cheaply:

- 2× LED par / wash (RGBW, DMX) — $25–40 each (Betopper and similar budget brands are fine for experiments)
- 1× small moving head (e.g. Betopper LM70) — ~$100–130; exercises `position` pan/tilt + `motion`
- 1× strobe or derby effect — ~$30; exercises `strobe_rate`
- DMX cables + terminator

### Other paths considered

- **Hue / LIFX smart bulbs** — LIFX has a LAN UDP protocol (usable), Hue needs the Entertainment API; both are low-fixture-count and latency-risky. Not the experiment platform, maybe a later integration.
- **LED matrix panel** — the freq×time heatmap → pixel mapping from milestone 4 generalizes to 2-D; a 16×16 or 32×8 WLED matrix is a cheap, striking demo. Candidate for the first order.

---

## Decisions (2026-07-23)

- Budget: ~$250 target; DMX pack accepted as an overage or second wave (see `shopping-list.md` totals).
- Primary strip: SK6812 RGBW — white channel maps to `color_temp`/`saturation`.
- Transport: Ethernet from day one (Dig-Quad + Ethernet add-on).
- Scope: DMX pack included — exercises all five milestone-4 fixture types.

## Still open

- Where Prism emits from: Rust shell vs Python sidecar (Rust likely — transport-synced, low jitter).
- DDP vs sACN as the pixel protocol (decide when building the emitter; WLED accepts both).
- eDMX1 PRO vs budget Art-Net node vs WLED+MAX485 bench hack for the DMX universe.
