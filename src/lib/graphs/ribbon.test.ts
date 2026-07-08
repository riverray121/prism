import { describe, expect, it } from "vitest";

import type { ProgramOutput } from "$lib/mapping/evaluate";

import { litMask, ribbonRgba } from "./ribbon";

const HZ = 100;

function output(partial: Partial<ProgramOutput>): ProgramOutput {
  return { key: "", channels: {}, gate: null, pixels: null, ...partial };
}

describe("litMask", () => {
  it("null gate lights every frame", () => {
    const mask = litMask(null, 5, HZ);
    expect([...mask]).toEqual([1, 1, 1, 1, 1]);
  });

  it("segments light their spans with strength", () => {
    const mask = litMask([{ start: 0.01, end: 0.03, strength: 0.7 }], 6, HZ);
    expect(mask[0]).toBe(0);
    expect(mask[2]).toBeCloseTo(0.7, 5);
    expect(mask[5]).toBe(0);
  });
});

describe("ribbonRgba", () => {
  it("unlit frames are near-transparent, lit frames glow with brightness", () => {
    const brightness = new Float32Array([0.2, 1]);
    const rgba = ribbonRgba(
      output({
        channels: { brightness },
        gate: [{ start: 0.01, end: 0.01, strength: 1 }],
      }),
      2,
      HZ,
    );
    expect(rgba[3]).toBeLessThan(20); // frame 0 unlit: faint floor
    expect(rgba[7]).toBe(255); // frame 1 lit at full brightness
  });

  it("hue drives the fill color", () => {
    const hue = new Float32Array([25, 250]); // warm red vs blue
    const saturation = new Float32Array([1, 1]);
    const rgba = ribbonRgba(output({ channels: { hue, saturation } }), 2, HZ);
    expect(rgba[0]).toBeGreaterThan(rgba[2]); // frame 0: red > blue
    expect(rgba[6]).toBeGreaterThan(rgba[4]); // frame 1: blue > red
  });

  it("color_temp falls back to the warm↔cool palette when hue is unbound", () => {
    const colorTemp = new Float32Array([0, 1]);
    const rgba = ribbonRgba(
      output({ channels: { color_temp: colorTemp } }),
      2,
      HZ,
    );
    expect(rgba[0]).toBeGreaterThan(rgba[2]); // warm end: red-ish
    expect(rgba[6]).toBeGreaterThan(rgba[4]); // cool end: blue-ish
  });
});
