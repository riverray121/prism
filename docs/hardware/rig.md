# Hardware — Bench rig (as built)

First working rig, assembled 2026-07-26; grown to five outputs 2026-08-01. Proven end to end: laptop → LAN (Wi-Fi) → WLED → strip.

## Parts

| Part       | Detail                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------- |
| Controller | ESP32-WROOM DevKitC (38-pin, micro-USB), WLED 16.0.1                                               |
| Strips     | 3× WS2812B 5V, 300 px each (first confirmed by last-pixel probe), on reels                         |
| Tubes      | 2× 幻彩 addressable neon flex, DC5V, 3 m (diffused; 269–272 px by end-probe, buses set to 272)     |
| PSU        | Mean Well LRS-350-5 (5 V 60 A); 115 V input selector; 2-wire cord, chassis not earthed             |
| Wiring     | Strip red→+V, white→−V; ESP GND→−V (common ground); ESP GPIO→JST green (data); breadboard + Dupont |

## WLED node

- Network: `653BWiFi` (2.4 GHz); IP `192.168.0.84` (DHCP — may change; re-find via mDNS or router)
- LED config: five buses, type WS281x GRB, one per output:

| Bus | GPIO | Fixture | Pixels | Start | Current limit |
| --- | ---- | ------- | ------ | ----- | ------------- |
| 0   | 16   | strip   | 300    | 0     | 8 A           |
| 1   | 17   | strip   | 300    | 300   | 8 A           |
| 2   | 18   | tube    | 272    | 600   | 8 A           |
| 3   | 19   | strip   | 300    | 872   | 8 A           |
| 4   | 21   | tube    | 272    | 1172  | 8 A           |

Per-bus limits are 8 A each (40 A worst case against the 60 A PSU) until inline fuses are in; raise them after fusing. Safe spare output pins if the rig grows: 22, 23, 25, 26, 27, 32, 33. Never 34–39 (input-only), 0/2/5/12/15 (strapping), 6–11 (flash), 1/3 (UART).

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
- Data links are Dupont jumpers and contact-critical: a strip that holds a frozen color latched one good frame and then lost data — reseat its jumper at both ends. The ESP's 3.3 V data level is marginal against 5 V-powered WS281x inputs (threshold ≈ 0.7 × VDD); if a strip flickers or freezes with good contact, the fix is a 74AHCT125 level shifter or trimming the PSU toward 4.7 V (V-ADJ pot at the output terminals).
- PSU terminals are exposed mains; case or terminal cover before this leaves the desk.
- Second reel + neon flex need power runs from the same PSU; add inline fuses when the rig grows.

## Next

- Prism DDP emitter (Rust shell): stream pixel frames synced to transport → this node. First slice of the Hardware tab.
- Mail-order wave per `shopping-list.md`: Dig-Quad + Ethernet, DMX node, pars/mover/strobe.
