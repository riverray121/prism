import { describe, expect, it } from "vitest";

import { heatColor } from "./heatmap";

describe("heatColor", () => {
  it("hits the colormap endpoints exactly", () => {
    expect(heatColor(0)).toEqual([0, 0, 4]);
    expect(heatColor(1)).toEqual([250, 250, 180]);
  });

  it("interpolates linearly between stops", () => {
    // Halfway between the 0.0 and 0.25 stops.
    const [r, g, b] = heatColor(0.125);
    expect(r).toBeCloseTo(30, 5);
    expect(g).toBeCloseTo(7.5, 5);
    expect(b).toBeCloseTo(57, 5);
  });

  it("brightness increases monotonically with the input", () => {
    const luma = (t: number) => {
      const [r, g, b] = heatColor(t);
      return r + g + b;
    };
    let prev = luma(0);
    for (let t = 0.1; t <= 1.0001; t += 0.1) {
      const next = luma(t);
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
  });
});
