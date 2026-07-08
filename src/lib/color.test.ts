import { describe, expect, it } from "vitest";

import {
  gradient,
  mixOklch,
  oklchToCss,
  oklchToRgb,
  oklchToRgb8,
  PALETTES,
  pitchClassColor,
  sectionColor,
} from "./color";

describe("oklchToRgb", () => {
  it("converts white and black exactly", () => {
    const white = oklchToRgb({ l: 1, c: 0, h: 0 });
    expect(white.r).toBeCloseTo(1, 4);
    expect(white.g).toBeCloseTo(1, 4);
    expect(white.b).toBeCloseTo(1, 4);
    const black = oklchToRgb({ l: 0, c: 0, h: 0 });
    expect(black.r).toBeCloseTo(0, 4);
    expect(black.g).toBeCloseTo(0, 4);
    expect(black.b).toBeCloseTo(0, 4);
  });

  it("matches the sRGB primaries at their reference OKLCH coordinates", () => {
    // Reference values from the OKLab spec conversions.
    const red = oklchToRgb({ l: 0.628, c: 0.2577, h: 29.23 });
    expect(red.r).toBeCloseTo(1, 2);
    expect(red.g).toBeCloseTo(0, 2);
    expect(red.b).toBeCloseTo(0, 2);
    const green = oklchToRgb({ l: 0.8664, c: 0.2948, h: 142.5 });
    expect(green.r).toBeCloseTo(0, 2);
    expect(green.g).toBeCloseTo(1, 2);
    expect(green.b).toBeCloseTo(0, 2);
    const blue = oklchToRgb({ l: 0.452, c: 0.3132, h: 264.05 });
    expect(blue.r).toBeCloseTo(0, 2);
    expect(blue.g).toBeCloseTo(0, 2);
    expect(blue.b).toBeCloseTo(1, 2);
  });

  it("mid gray is achromatic", () => {
    const gray = oklchToRgb({ l: 0.6, c: 0, h: 123 });
    expect(gray.r).toBeCloseTo(gray.g, 5);
    expect(gray.g).toBeCloseTo(gray.b, 5);
  });

  it("clamps out-of-gamut chroma instead of overflowing channels", () => {
    // Chroma far beyond sRGB at this lightness/hue.
    const clamped = oklchToRgb({ l: 0.5, c: 0.4, h: 145 });
    for (const v of [clamped.r, clamped.g, clamped.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // The clamp keeps the color colorful (not collapsed to gray).
    const spread =
      Math.max(clamped.r, clamped.g, clamped.b) -
      Math.min(clamped.r, clamped.g, clamped.b);
    expect(spread).toBeGreaterThan(0.2);
  });

  it("negative chroma is treated as zero", () => {
    const c = oklchToRgb({ l: 0.7, c: -0.5, h: 0 });
    expect(c.r).toBeCloseTo(c.g, 5);
    expect(c.g).toBeCloseTo(c.b, 5);
  });
});

describe("oklchToRgb8 / oklchToCss", () => {
  it("produces byte values and css strings", () => {
    expect(oklchToRgb8({ l: 1, c: 0, h: 0 })).toEqual([255, 255, 255]);
    expect(oklchToCss({ l: 1, c: 0, h: 0 })).toBe("rgb(255,255,255)");
    expect(oklchToCss({ l: 1, c: 0, h: 0 }, 0.5)).toBe(
      "rgba(255,255,255,0.500)",
    );
  });
});

describe("mixOklch", () => {
  it("interpolates hue along the shortest path", () => {
    // 350° → 10°: through 0°, not through 180°.
    const mid = mixOklch(
      { l: 0.5, c: 0.1, h: 350 },
      { l: 0.5, c: 0.1, h: 10 },
      0.5,
    );
    expect(mid.h).toBeCloseTo(0, 5);
  });

  it("a gray endpoint adopts the other side's hue", () => {
    const mid = mixOklch(
      { l: 0.2, c: 0, h: 0 },
      { l: 0.8, c: 0.2, h: 200 },
      0.5,
    );
    expect(mid.h).toBeCloseTo(200, 5);
    expect(mid.l).toBeCloseTo(0.5, 5);
    expect(mid.c).toBeCloseTo(0.1, 5);
  });
});

describe("gradient", () => {
  it("hits the stops at their positions and interpolates between", () => {
    const stops = [
      { l: 0, c: 0, h: 0 },
      { l: 0.5, c: 0.1, h: 100 },
      { l: 1, c: 0, h: 100 },
    ];
    expect(gradient(stops, 0).l).toBe(0);
    expect(gradient(stops, 0.5).l).toBeCloseTo(0.5, 5);
    expect(gradient(stops, 1).l).toBeCloseTo(1, 5);
    expect(gradient(stops, 0.25).l).toBeCloseTo(0.25, 5);
  });

  it("clamps t outside [0,1]", () => {
    const stops = [
      { l: 0.2, c: 0, h: 0 },
      { l: 0.9, c: 0, h: 0 },
    ];
    expect(gradient(stops, -1).l).toBe(0.2);
    expect(gradient(stops, 2).l).toBeCloseTo(0.9, 5);
  });
});

describe("pitchClassColor", () => {
  it("yields 12 distinct hues at equal lightness", () => {
    const colors = Array.from({ length: 12 }, (_, pc) => pitchClassColor(pc));
    const hues = new Set(colors.map((c) => Math.round(c.h)));
    expect(hues.size).toBe(12);
    for (const c of colors) expect(c.l).toBe(colors[0].l);
    // And the 12 rendered colors are distinct after conversion too.
    const rendered = new Set(colors.map((c) => oklchToRgb8(c).join(",")));
    expect(rendered.size).toBe(12);
  });

  it("wraps outside 0–11", () => {
    expect(pitchClassColor(12)).toEqual(pitchClassColor(0));
    expect(pitchClassColor(-1)).toEqual(pitchClassColor(11));
  });
});

describe("palettes", () => {
  it("warm_cool runs warm to cool", () => {
    const warm = PALETTES.warm_cool(0);
    const cool = PALETTES.warm_cool(1);
    expect(warm.h).toBeLessThan(120); // amber side
    expect(cool.h).toBeGreaterThan(180); // blue side
  });

  it("pitch_wheel wraps t across the circle", () => {
    expect(PALETTES.pitch_wheel(0).h).toBeCloseTo(0, 5);
    expect(PALETTES.pitch_wheel(0.5).h).toBeCloseTo(180, 5);
    expect(PALETTES.pitch_wheel(1.25).h).toBeCloseTo(90, 5);
  });

  it("sectionColor cycles the palette on any integer", () => {
    expect(sectionColor(0)).toEqual(sectionColor(8));
    expect(sectionColor(-1)).toEqual(sectionColor(7));
  });
});
