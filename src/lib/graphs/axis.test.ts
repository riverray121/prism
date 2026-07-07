import { describe, expect, it } from "vitest";

import {
  clamp,
  followed,
  panned,
  wheelDeltaScale,
  ZOOM_FACTOR,
  zoomed,
} from "./axis";

describe("clamp", () => {
  it("holds values inside the range and pins values outside it", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe("wheelDeltaScale", () => {
  it("maps line mode to 16px and page mode to the page height", () => {
    expect(wheelDeltaScale(0, 800)).toBe(1);
    expect(wheelDeltaScale(1, 800)).toBe(16);
    expect(wheelDeltaScale(2, 800)).toBe(800);
  });
});

describe("panned", () => {
  it("slides the window by dv preserving the range", () => {
    expect(panned(10, 20, 100, 5)).toEqual({ min: 15, max: 25 });
  });

  it("clamps at the left edge", () => {
    expect(panned(2, 12, 100, -5)).toEqual({ min: 0, max: 10 });
  });

  it("clamps at the right edge", () => {
    expect(panned(85, 95, 100, 10)).toEqual({ min: 90, max: 100 });
  });
});

describe("zoomed", () => {
  it("zooming in shrinks the range and keeps the cursor fraction fixed", () => {
    // Cursor at 25% of a [0,100] view over a 400s track.
    const w = zoomed(0, 100, 400, 25, -100);
    expect(w.max - w.min).toBeLessThan(100);
    const frac = (25 - w.min) / (w.max - w.min);
    expect(frac).toBeCloseTo(0.25, 10);
  });

  it("zooming out grows the range", () => {
    const w = zoomed(100, 200, 400, 150, 100);
    expect(w.max - w.min).toBeGreaterThan(100);
  });

  it("zoom step intensity is capped, so a huge delta equals the cap", () => {
    const capped = zoomed(0, 100, 400, 50, -1e6);
    const expected = 100 * Math.pow(ZOOM_FACTOR, 2);
    expect(capped.max - capped.min).toBeCloseTo(expected, 10);
  });

  it("zooming out past the full extent returns the full window", () => {
    expect(zoomed(0, 99, 100, 50, 1e6)).toEqual({ min: 0, max: 100 });
  });

  it("clamps a window that would cross the left edge", () => {
    const w = zoomed(0, 10, 100, 0.1, 100);
    expect(w.min).toBe(0);
  });

  it("clamps a window that would cross the right edge", () => {
    const w = zoomed(90, 100, 100, 99.9, 100);
    expect(w.max).toBe(100);
    expect(w.min).toBeCloseTo(100 - (w.max - w.min), 10);
  });
});

describe("followed", () => {
  it("returns null when not zoomed", () => {
    expect(followed(0, 100, 100, 50, "center", true)).toBeNull();
  });

  it("returns null when paused with the playhead in view", () => {
    expect(followed(10, 20, 100, 15, "center", false)).toBeNull();
  });

  it("centers the playhead in center mode while following", () => {
    const w = followed(10, 20, 100, 40, "center", true);
    expect(w).toEqual({ min: 35, max: 45 });
  });

  it("page mode leaves the window alone while the playhead is visible", () => {
    expect(followed(10, 20, 100, 15, "page", true)).toBeNull();
  });

  it("page mode brings an exited playhead to the left edge", () => {
    const w = followed(10, 20, 100, 21, "page", true);
    expect(w).toEqual({ min: 21, max: 31 });
  });

  it("clamps at the track start", () => {
    const w = followed(50, 60, 100, 2, "center", true);
    expect(w).toEqual({ min: 0, max: 10 });
  });

  it("clamps at the track end", () => {
    const w = followed(10, 20, 100, 99, "center", true);
    expect(w).toEqual({ min: 90, max: 100 });
  });

  it("returns null when the computed window equals the current one", () => {
    expect(followed(35, 45, 100, 40, "center", true)).toBeNull();
  });
});
