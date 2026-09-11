# Hardware — Bench rig (as built)

First working rig, assembled 2026-07-26; grown to five outputs 2026-08-01. Proven end to end: laptop → LAN (Wi-Fi) → WLED → strip.

## Parts

| Part       | Detail                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Controller | ESP32-WROOM DevKitC (38-pin), WLED 16.0.1; powered over micro-USB from a wall adapter, never from the PSU (the PSU is relay-switched)  |
| Relay      | SSR-40DA solid-state relay on the PSU's live input, driven from ESP GPIO 23 through a PN2222A transistor (see PSU relay)               |
| Strips     | 3× WS2812B 5V, cut from 300 px reels and mounted: TV 237 px, TV shelf 233 px, speaker box 85 px (lengths by end-probe)                 |
| Tubes      | 2× 幻彩 addressable neon flex, DC5V, 3 m (diffused; 269–272 px by end-probe, buses set to 272)                                         |
| PSU        | Mean Well LRS-350-5 (5 V 60 A); 115 V input selector; 3-wire cord, wall ground to the FG terminal                                      |
| Wiring     | Strip red→+V via an inline ATC/ATO blade fuse per strip, white→−V; ESP GND→−V (common ground); data: JST green→terminal block→ESP GPIO |

## WLED node

- Network: `653BWiFi` (2.4 GHz); IP `192.168.0.95` (DHCP — may change; re-find via mDNS or sweep `/json/info` on 192.168.0.x)
- LED config: five buses, type WS281x GRB, one per output:

| Bus | GPIO | Fixture                          | Pixels | Start | Current limit |
| --- | ---- | -------------------------------- | ------ | ----- | ------------- |
| 0   | 16   | tube A (a few px short of 272)   | 272    | 0     | 8 A           |
| 1   | 17   | tube B                           | 272    | 272   | 8 A           |
| 2   | 18   | TV shelf strip                   | 233    | 544   | 8 A           |
| 3   | 19   | speaker box strip (under the TV) | 85     | 777   | 8 A           |
| 4   | 21   | TV backlight strip               | 237    | 862   | 8 A           |

Total 1099 px. Lengths were found by lighting marker pixels and colored blocks at known offsets and reading back the last visible one; repeat that after any re-cut. A bus longer than its fixture is harmless (the extra addresses go nowhere); a bus shorter than its fixture leaves the far end permanently dark.

Per-bus limits are 8 A each (40 A worst case against the 60 A PSU). Each strip's +V feed carries a 15 A blade fuse in an inline holder placed close to the PSU +V terminal; the fuse rating must not exceed the feed wire's rating (15 A needs 16 AWG or thicker, 18 AWG takes 10 A). Blade fuses have no polarity. GPIO 23 is the PSU relay pin. Safe spare output pins if the rig grows: 22, 25, 26, 27, 32, 33. Never 34–39 (input-only), 0/2/5/12/15 (strapping), 6–11 (flash), 1/3 (UART).

- Realtime inputs available for Prism: DDP (preferred), sACN/E1.31, Art-Net; UDP port 21324 (WLED notifier), DDP 4048. On stop Prism restores the hub's prior power state: a hub that was on falls back to its own look after the realtime timeout (Config → Sync Interfaces → Realtime, set 1 s), a hub that was off is blacked out and powered off.
- Flashing/provisioning workspace: `~/Dev/hardware/prism-lights/` (esptool venv, WLED binaries, `improv_provision.py` for serial Wi-Fi setup)

## PSU relay

WLED switches the PSU's mains input through the SSR so the rig is fully dark and unpowered whenever the strip is off. WLED drives the relay pin high when the strip is on and low about 0.6 s after it goes off (setting: `hw.relay.pin` 23, `rev` false, `odrain` false in `/json/cfg`). Prism powers the hub on before streaming and off on stop, so the PSU follows playback with no app changes.

Control side (low voltage):

| From               | To                           |
| ------------------ | ---------------------------- |
| ESP `5V` pin       | SSR terminal 3 (+)           |
| SSR terminal 4 (−) | PN2222A collector            |
| PN2222A emitter    | ESP `GND`                    |
| ESP `GPIO 23`      | 1 kΩ resistor → PN2222A base |

PN2222A (TO-92, flat face toward you, legs down): E B C left to right.

Mains side (cord unplugged while wiring): black (live) → SSR terminal 1, SSR terminal 2 → PSU `L`; white (neutral) → PSU `N`; green (ground) → PSU `FG`. Only the live wire passes through the relay. SSR terminals 1 and 2 carry mains; keep them inside the box. Mount the SSR on metal or a small heatsink.

Constraints:

- The ESP cannot be powered from the PSU it switches; the relay would never close again after an off. USB from an always-on adapter is the ESP's supply.
- ESP `GND` → PSU `−V` is mandatory even with the ESP on USB. It is the data reference for every output; without it every strip shows random flashing.
- The relay pin is only written on a power-state transition. After changing the pin in config, cycle WLED off and on once.

## Flash procedure (fresh ESP32)

1. `esptool --port <port> erase-flash`
2. `esptool --port <port> write-flash 0x0 esp32_bootloader_v4.bin` (bootloader package; release app bin alone at 0x0 does not boot)
3. `esptool --port <port> write-flash 0x10000 WLED_<ver>_ESP32.bin`
4. Wi-Fi via `improv_provision.py <port> <ssid> <pass>` (Improv serial; ESP32 is 2.4 GHz only)

## Home Assistant

The node is in Home Assistant through the core WLED integration (host 192.168.0.95, device and entity named "TV LEDs"): `light.tv_leds` (on/off, brightness, color; off drops the PSU relay through WLED), `select.tv_leds_preset` (presets by name). The WLED node's own name is also "TV LEDs".

## Saved looks (WLED presets on the node)

- 12 "Day ambient" — the boot preset (`def.ps` 12): solid (255,160,55), bri 48, whole rig. The look the rig wakes up in and the daytime default.

- 1–10: effect showcase playlist (Pacifica, Colorwaves, Meteor, Fire 2012, Ripple, Dancing Shadows, Plasma, Fireworks, Lightning, Flow)
- 11 "Lantern" — user favorite. Candle Multi (fx 102), col1 amber (255,170,60), col2 ember (110,50,8), sx 96, ix 190, bri 150. Reads as old street lights / lanterns. Candidate `color_temp`/ambience program for the mapping layer.

## Cautions

- Don't run sustained bright white while the strip is coiled on the reel (heat).
- Data links are contact-critical: a strip that holds a frozen color latched one good frame and then lost data — check its terminal block landing and the JST at both ends. A dark output with a good controller config is a wiring fault on that GPIO path (verified by swapping bus pin assignments in WLED: a dead pin stays dark under any bus). The ESP's 3.3 V data level is marginal against 5 V-powered WS281x inputs (threshold ≈ 0.7 × VDD); if a strip flickers or freezes with good contact, the fix is a 5 V level shifter (two 74HCT04N inverters in series per line) or trimming the PSU toward 4.7 V (V-ADJ pot at the output terminals).
- PSU terminals are exposed mains; keep the lid on.
- Every fixture power run comes off the same PSU; each gets its own fused +V feed.
- Random flashing on every output at once is a missing or bad ESP `GND` → PSU `−V` wire, not a data-pin fault.

## Next

- Prism DDP emitter (Rust shell): stream pixel frames synced to transport → this node. First slice of the Hardware tab.
- Mail-order wave per `shopping-list.md`: Dig-Quad + Ethernet, DMX node, pars/mover/strobe.
