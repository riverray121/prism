import { describe, expect, it } from "vitest";

import { lightLabel, parseHub, RigSchema } from "./wled";

// Payload shapes per the WLED JSON API (bench hub: ESP32, WLED 16.x, one
// 300-px WS2812B output). Only the fields Prism reads, plus the surrounding
// noise a real device sends, so parsing proves it tolerates extras.
const INFO = {
  ver: "0.16.1",
  vid: 2506010,
  name: "WLED",
  mac: "A842E39B1C60",
  ip: "192.168.0.84",
  leds: { count: 300, pwr: 850, fps: 5, maxpwr: 12000 },
  arch: "esp32",
  freeheap: 168804,
};

const CFG = {
  rev: [1, 0],
  id: { name: "WLED", mdns: "wled-9b1c60" },
  hw: {
    led: {
      total: 300,
      maxpwr: 12000,
      ins: [
        {
          start: 0,
          len: 300,
          pin: [16],
          order: 1,
          type: 22,
          skip: 0,
        },
      ],
    },
  },
};

describe("parseHub", () => {
  it("reads identity and outputs into a rig-shaped hub", () => {
    const hub = parseHub("192.168.0.84", INFO, CFG);
    expect(hub).toEqual({
      mac: "a842e39b1c60",
      name: "WLED",
      ip: "192.168.0.84",
      lights: [{ id: "a842e39b1c60:0", pixel_count: 300, start: 0 }],
    });
  });

  it("numbers lights on a multi-output hub and skips empty outputs", () => {
    const cfg = {
      hw: {
        led: {
          ins: [
            { start: 0, len: 300 },
            { start: 300, len: 0 },
            { start: 300, len: 120 },
          ],
        },
      },
    };
    const hub = parseHub("10.0.0.2", INFO, cfg);
    expect(hub.lights).toEqual([
      { id: "a842e39b1c60:0", pixel_count: 300, start: 0 },
      { id: "a842e39b1c60:1", pixel_count: 120, start: 300 },
    ]);
  });

  it("throws on a payload without a MAC (not a usable hub)", () => {
    expect(() => parseHub("10.0.0.2", { name: "x" }, CFG)).toThrow();
  });

  it("parsed hubs satisfy the rig schema", () => {
    const hub = parseHub("192.168.0.84", INFO, CFG);
    expect(RigSchema.parse({ hubs: [hub] })).toEqual({ hubs: [hub] });
  });
});

describe("light names", () => {
  const light = { id: "a842e39b1c60:2", pixel_count: 300, start: 600 };

  it("labels fall back to the positional default from the light id", () => {
    expect(lightLabel(light)).toBe("Output 3");
    expect(lightLabel({ ...light, name: "Tube left" })).toBe("Tube left");
  });

  it("loading a rig drops stored default names, keeping real renames", () => {
    // Docs written before names became rename-only stored a name for every
    // light: the hub's device name (single output) or "Output N".
    const rig = RigSchema.parse({
      hubs: [
        {
          mac: "a842e39b1c60",
          name: "WLED",
          ip: "192.168.0.84",
          lights: [
            { id: "a842e39b1c60:0", name: "WLED", pixel_count: 300 },
            { id: "a842e39b1c60:1", name: "Output 2", pixel_count: 300 },
            { id: "a842e39b1c60:2", name: "Tube left", pixel_count: 272 },
          ],
        },
      ],
    });
    expect(rig.hubs[0].lights.map((l) => l.name)).toEqual([
      undefined,
      undefined,
      "Tube left",
    ]);
  });
});
