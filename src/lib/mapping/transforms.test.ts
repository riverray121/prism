import { describe, expect, it } from "vitest";

import {
  applyColormap,
  applyEnvelope,
  applyNormalize,
  applySmooth,
  categoricalValues,
} from "./transforms";

const HZ = 100;

describe("applyNormalize", () => {
  it("auto range maps the data's own min/max onto [0,1]", () => {
    const out = applyNormalize([2, 4, 6], {
      min: null,
      max: null,
      curve: "linear",
      gamma: 2,
    });
    expect([...out]).toEqual([0, 0.5, 1]);
  });

  it("explicit range clamps values outside it", () => {
    const out = applyNormalize([-1, 0.5, 3], {
      min: 0,
      max: 1,
      curve: "linear",
      gamma: 2,
    });
    expect([...out]).toEqual([0, 0.5, 1]);
  });

  it("gamma darkens the low end, log lifts it", () => {
    const opts = { min: 0, max: 1, gamma: 2 };
    const gamma = applyNormalize([0.5], { ...opts, curve: "gamma" });
    const log = applyNormalize([0.5], { ...opts, curve: "log" });
    expect(gamma[0]).toBeCloseTo(0.25, 5);
    expect(log[0]).toBeGreaterThan(0.5);
    // Endpoints are fixed points for every curve.
    for (const curve of ["gamma", "log"] as const) {
      const ends = applyNormalize([0, 1], { ...opts, curve });
      expect(ends[0]).toBeCloseTo(0, 5);
      expect(ends[1]).toBeCloseTo(1, 5);
    }
  });

  it("a flat signal normalizes to zero, not NaN", () => {
    const out = applyNormalize([3, 3, 3], {
      min: null,
      max: null,
      curve: "linear",
      gamma: 2,
    });
    expect([...out]).toEqual([0, 0, 0]);
  });
});

describe("applySmooth", () => {
  it("flattens a spike while preserving its energy nearby", () => {
    const data = new Array(41).fill(0);
    data[20] = 1;
    const out = applySmooth(data, 0.1, HZ); // ±5 frames
    expect(out[20]).toBeLessThan(0.2);
    expect(out[20]).toBeGreaterThan(0);
    expect(out[24]).toBeGreaterThan(0); // spread into the window
    expect(out[30]).toBe(0); // but not beyond it
  });

  it("leaves a constant signal unchanged", () => {
    const out = applySmooth([0.4, 0.4, 0.4, 0.4, 0.4], 0.05, HZ);
    for (const v of out) expect(v).toBeCloseTo(0.4, 6);
  });
});

describe("applyEnvelope", () => {
  it("gives a point event duration: attack, hold, decay", () => {
    const events = [{ t: 0.5, strength: 1 }];
    const out = applyEnvelope(
      events,
      { attack_s: 0.02, hold_s: 0.05, decay_s: 0.1 },
      HZ,
      100,
    );
    expect(out[49]).toBe(0); // before the event
    expect(out[52]).toBe(1); // holding
    expect(out[56]).toBe(1); // still holding (attack 2 + hold 5 frames)
    expect(out[62]).toBeGreaterThan(0); // decaying
    expect(out[62]).toBeLessThan(1);
    expect(out[68]).toBe(0); // fully decayed
  });

  it("scales by event strength and overlaps take the max", () => {
    const events = [
      { t: 0.1, strength: 0.4 },
      { t: 0.12, strength: 1 },
    ];
    const out = applyEnvelope(
      events,
      { attack_s: 0, hold_s: 0.1, decay_s: 0.05 },
      HZ,
      50,
    );
    expect(out[13]).toBe(1); // the stronger overlapping envelope wins
  });

  it("zero attack fires at full strength immediately", () => {
    const out = applyEnvelope(
      [{ t: 0.1, strength: 0.8 }],
      { attack_s: 0, hold_s: 0.02, decay_s: 0.02 },
      HZ,
      30,
    );
    expect(out[10]).toBeCloseTo(0.8, 5);
  });
});

describe("applyColormap", () => {
  it("extracts hue in degrees, saturation and lightness in 0-1", () => {
    const hue = applyColormap([0, 1], "warm_cool", "hue");
    expect(hue[0]).toBeLessThan(120); // warm amber
    expect(hue[1]).toBeGreaterThan(180); // cool blue
    const sat = applyColormap([0.5], "warm_cool", "saturation");
    expect(sat[0]).toBeGreaterThanOrEqual(0);
    expect(sat[0]).toBeLessThanOrEqual(1);
    const light = applyColormap([0.5], "warm_cool", "lightness");
    expect(light[0]).toBeGreaterThan(0.5);
  });

  it("unknown palettes fall back to warm_cool", () => {
    const a = applyColormap([0.3], "warm_cool", "hue");
    const b = applyColormap([0.3], "does_not_exist", "hue");
    expect(b[0]).toBe(a[0]);
  });
});

describe("categoricalValues", () => {
  it("spreads unmapped labels evenly over [0,1] in first-seen order", () => {
    const values = categoricalValues(["a", "b", "c", "a"], {});
    expect(values.get("a")).toBe(0);
    expect(values.get("b")).toBe(0.5);
    expect(values.get("c")).toBe(1);
  });

  it("explicit map entries win; the rest spread", () => {
    const values = categoricalValues(["a", "b", "c"], { b: 0.9 });
    expect(values.get("b")).toBe(0.9);
    expect(values.get("a")).toBe(0);
    expect(values.get("c")).toBe(1);
  });

  it("a single label maps to 0", () => {
    expect(categoricalValues(["only"], {}).get("only")).toBe(0);
  });
});
