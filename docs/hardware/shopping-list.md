# Hardware — First order

Decisions (2026-07-23): SK6812 RGBW as primary strip, Ethernet pixel node from day one, DMX fixtures included. Prices approximate — verify at checkout.

## Pixel core (~$215)

| Item                                                            | ~Price | Notes                                                          |
| --------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| QuinLED Dig-Quad, pre-assembled, + Ethernet add-on              | $75    | 4 fused outputs, WLED pre-flashed; Ethernet kills Wi-Fi jitter |
| SK6812 RGBW strip, 5 m, 60 LEDs/m, IP30 (BTF-Lighting or equal) | $30    | 300 px; white channel maps to `color_temp`/`saturation`        |
| Mean Well LRS-350-5 PSU (5 V 60 A)                              | $40    | 300 RGBW px can pull ~24 A; headroom for a second strip        |
| 16×16 WS2812B matrix panel                                      | $22    | 2-D target for the freq×time heatmap mapping                   |
| 18 AWG power-injection wire + 3-pin JST-SM pigtails             | $12    | Inject at both strip ends minimum                              |
| Inline fuse holders + fuses                                     | $8     | Fuse every power feed                                          |
| Aluminum diffuser channel, 2× 1 m                               | $20    | Diffusion is most of the perceived quality                     |
| Misc: gaffer tape, ferrules/wagos                               | $10    |                                                                |

## DMX wave (~$220 with the solid node, ~$160 budget)

Covers `wash`, `mover`, `strobe_rate` fixture types. Can ship with the first order or follow once the pixel path works end to end.

| Item                                                                                | ~Price  | Notes                                                                       |
| ----------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| DMX node — pick one: DMXking eDMX1 PRO ($100) or generic Art-Net/sACN node ($40–60) | $40–100 | Ethernet → 1 DMX universe; eDMX is the no-surprises choice                  |
| 2× budget RGBW LED par (Betopper or similar)                                        | $65     | The `wash` fixture type                                                     |
| Small moving head (Betopper LM70 class)                                             | $110    | `position` pan/tilt + `motion`; the single biggest line — defer if trimming |
| 3× DMX cables + terminator                                                          | $20     | Real 110 Ω DMX cable preferred; short mic cables work for experiments       |

Cheap-node fallback: WLED can also emit one DMX universe through a ~$3 MAX485 module on a spare ESP32 — worth a bench test before buying the eDMX if feeling thrifty.

## Totals

- Pixel core only: **~$215** (inside the $250 target)
- Core + budget DMX: **~$375**
- Core + eDMX + mover: **~$435**

## What Prism needs to build against this

One UDP emitter in the Rust shell: DDP (or sACN) to WLED for pixels, sACN/Art-Net to the DMX node for fixtures. Same transport clock as playback; the stubbed Hardware tab becomes the patch UI from milestone-4 `overview.md`.
