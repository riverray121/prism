# Hardware — Bench rig (as built)

First working rig, assembled 2026-07-26. Proven end to end: laptop → LAN (Wi-Fi) → WLED → strip.

## Parts

| Part       | Detail                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| Controller | ESP32-WROOM DevKitC (38-pin, micro-USB), WLED 16.0.1                                                 |
| Strip      | WS2812B 5V, 300 px (confirmed by last-pixel probe), on reel                                          |
| Also owned | 幻彩 addressable neon flex, DC5V, 3 m (not yet wired)                                                |
| PSU        | Mean Well LRS-350-5 (5 V 60 A); 115 V input selector; 2-wire cord, chassis not earthed               |
| Wiring     | Strip red→+V, white→−V; ESP GND→−V (common ground); ESP GPIO16→JST green (data); breadboard + Dupont |

## WLED node

- Network: `653BWiFi` (2.4 GHz); IP `192.168.0.84` (DHCP — may change; re-find via mDNS or router)
- LED config: 300 px, GPIO16, type WS281x GRB, software current limit 12 A
- Realtime inputs available for Prism: DDP (preferred), sACN/E1.31, Art-Net; UDP port 21324 (WLED notifier), DDP 4048
- Flashing/provisioning workspace: `~/Dev/hardware/prism-lights/` (esptool venv, WLED binaries, `improv_provision.py` for serial Wi-Fi setup)

## Flash procedure (fresh ESP32)

1. `esptool --port <port> erase-flash`
2. `esptool --port <port> write-flash 0x0 esp32_bootloader_v4.bin` (bootloader package; release app bin alone at 0x0 does not boot)
3. `esptool --port <port> write-flash 0x10000 WLED_<ver>_ESP32.bin`
4. Wi-Fi via `improv_provision.py <port> <ssid> <pass>` (Improv serial; ESP32 is 2.4 GHz only)

## Saved looks (WLED presets on the node)

- 1–10: effect showcase playlist (Pacifica, Colorwaves, Meteor, Fire 2012, Ripple, Dancing Shadows, Plasma, Fireworks, Lightning, Flow)
- 11 "Lantern" — user favorite. Candle Multi (fx 102), col1 amber (255,170,60), col2 ember (110,50,8), sx 96, ix 190, bri 150. Reads as old street lights / lanterns. Candidate `color_temp`/ambience program for the mapping layer.

## Cautions

- Don't run sustained bright white while the strip is coiled on the reel (heat).
- PSU terminals are exposed mains; case or terminal cover before this leaves the desk.
- Second reel + neon flex need power runs from the same PSU; add inline fuses when the rig grows.

## Next

- Prism DDP emitter (Rust shell): stream pixel frames synced to transport → this node. First slice of the Hardware tab.
- Mail-order wave per `shopping-list.md`: Dig-Quad + Ethernet, DMX node, pars/mover/strobe.
