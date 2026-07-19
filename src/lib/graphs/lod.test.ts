import { describe, expect, it } from "vitest";

import { decimateMinMax } from "./lod";

const HZ = 100;

describe("decimateMinMax", () => {
  it("returns null for data small enough to draw directly", () => {
    expect(decimateMinMax(new Array(100).fill(0), HZ, 256)).toBeNull();
  });

  it("keeps each bucket's extremes at their true times, in order", () => {
    // 1000 points, 10 buckets of 100: a spike and a dip inside one bucket.
    const data = new Array(1000).fill(0.5);
    data[137] = 0.05; // dip before…
    data[142] = 0.95; // …spike, same bucket
    const [xs, ys] = decimateMinMax(data, HZ, 10)!;
    const dipAt = xs.indexOf(137 / HZ);
    const spikeAt = xs.indexOf(142 / HZ);
    expect(dipAt).toBeGreaterThanOrEqual(0);
    expect(spikeAt).toBe(dipAt + 1); // index order preserved
    expect(ys[dipAt]).toBe(0.05);
    expect(ys[spikeAt]).toBe(0.95);
    // Time axis is strictly non-decreasing.
    for (let i = 1; i < xs.length; i++)
      expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  });

  it("bounds the output to at most two points per bucket", () => {
    const data = Array.from({ length: 30000 }, (_, i) => Math.sin(i / 7));
    const [xs, ys] = decimateMinMax(data, HZ, 2048)!;
    expect(xs.length).toBeLessThanOrEqual(2048 * 2);
    expect(xs.length).toBe(ys.length);
    // Global extremes survive decimation.
    expect(Math.max(...ys)).toBeCloseTo(Math.max(...data), 10);
    expect(Math.min(...ys)).toBeCloseTo(Math.min(...data), 10);
  });
});
