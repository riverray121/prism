import { describe, expect, it } from "vitest";

import { METRIC_HZ, metricsFromSeries } from "./metrics";

const n = 60 * METRIC_HZ;
const beats = Array.from({ length: 120 }, (_, i) => i * 0.5);
// Flash on every beat: jumps to 1 at the beat, decays over 200 ms.
const flash = Float32Array.from({ length: n }, (_, i) =>
  Math.max(0.05, 1 - ((i / METRIC_HZ) % 0.5) * 5),
);
const flat = new Float32Array(n).fill(0.5);
const dark = new Float32Array(n);

describe("show metrics", () => {
  it("identical lights have zero distinctness", () => {
    expect(metricsFromSeries([flash, flash], beats).distinctness).toBe(0);
  });

  it("a flat light never visibly changes; beat flashes do and align", () => {
    expect(metricsFromSeries([flat], beats).visible_change).toBe(0);
    const m = metricsFromSeries([flash], beats);
    expect(m.visible_change).toBeGreaterThan(0.9);
    expect(m.beat_alignment).toBeGreaterThan(0.9);
  });

  it("a dark light counts as dark time", () => {
    expect(metricsFromSeries([dark], beats).dark_time).toBe(1);
  });
});
