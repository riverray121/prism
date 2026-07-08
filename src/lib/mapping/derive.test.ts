import { describe, expect, it } from "vitest";

import { deriveEvents, deriveSegments, HYSTERESIS_RELEASE } from "./derive";

const HZ = 100;

// Attack-decay bump peaking at `peak`, `width` frames long.
function bump(peak: number, width: number): number[] {
  const rise = Math.floor(width / 2);
  return Array.from({ length: width }, (_, i) =>
    i < rise ? (peak * i) / rise : peak * (1 - (i - rise) / (width - rise)),
  );
}

describe("deriveEvents", () => {
  it("a drum-roll-like envelope yields one event per crest, not one", () => {
    // Five distinct crests riding on a floor that never drops below 0.3:
    // a plain threshold-crossing detector would report a single onset.
    const data: number[] = [];
    for (let hit = 0; hit < 5; hit++) {
      data.push(...bump(1, 20).map((v) => 0.4 + 0.6 * v));
    }
    const events = deriveEvents(data, HZ, 0.5);
    expect(events).toHaveLength(5);
    // Chronological, spaced by the bump width.
    for (let i = 1; i < events.length; i++) {
      expect(events[i].t).toBeGreaterThan(events[i - 1].t);
    }
  });

  it("strengths are the normalized peak values", () => {
    const data = [0, ...bump(0.5, 21), ...bump(1, 21), 0];
    const events = deriveEvents(data, HZ, 0.1);
    expect(events).toHaveLength(2);
    expect(events[0].strength).toBeCloseTo(0.5, 5);
    expect(events[1].strength).toBeCloseTo(1, 5);
  });

  it("peaks below the cutoff are dropped", () => {
    const data = [0, ...bump(0.3, 21), ...bump(1, 21), 0];
    const events = deriveEvents(data, HZ, 0.5);
    expect(events).toHaveLength(1);
    expect(events[0].strength).toBeCloseTo(1, 5);
  });

  it("close peaks collapse into the higher one (min separation)", () => {
    // Two crests 5 frames apart (< 0.1 s at 100 Hz).
    const data = [0, 0.2, 0.9, 0.2, 0.7, 0.2, 0];
    const events = deriveEvents(data, HZ, 0.1);
    expect(events).toHaveLength(1);
    expect(events[0].strength).toBeCloseTo(1, 5); // the 0.9 crest, normalized
  });

  it("a plateau registers once, at its midpoint", () => {
    const data = [0, 0.2, 1, 1, 1, 0.2, 0];
    const events = deriveEvents(data, HZ, 0.5);
    expect(events).toHaveLength(1);
    expect(events[0].t).toBeCloseTo(3 / HZ, 5);
  });

  it("flat or tiny signals yield nothing", () => {
    expect(deriveEvents([0.5, 0.5, 0.5, 0.5], HZ, 0.3)).toEqual([]);
    expect(deriveEvents([0, 1], HZ, 0.3)).toEqual([]);
  });
});

describe("deriveSegments", () => {
  it("hysteresis keeps a wobble around the cutoff as one segment", () => {
    // Rises above 0.5, dips to 0.45 (below the cutoff but above the release
    // level 0.4), recovers, then truly drops. Plain gating would split it.
    const data = [
      0, 0, 0.6, 0.7, 0.45, 0.45, 0.7, 0.8, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 1,
    ];
    expect(HYSTERESIS_RELEASE).toBeCloseTo(0.8);
    const segments = deriveSegments(data, HZ, 0.5);
    expect(segments).toHaveLength(2); // the wobbly hit + the final spike
    expect(segments[0].start).toBeCloseTo(2 / HZ, 5);
    expect(segments[0].end).toBeCloseTo(8 / HZ, 5);
  });

  it("carries the peak value within each segment as strength", () => {
    const data = [0, 0.6, 0.9, 0.6, 0, 0, 0, 0, 0, 0, 0, 0.7, 0, 0, 1];
    const segments = deriveSegments(data, HZ, 0.5);
    expect(segments.map((s) => s.strength)).toEqual([0.9, 0.7, 1]);
  });

  it("a segment open at the end of the track closes at the last frame", () => {
    const data = [0, 0, 0.2, 0.9, 1, 1];
    const segments = deriveSegments(data, HZ, 0.5);
    expect(segments).toHaveLength(1);
    expect(segments[0].end).toBeCloseTo(5 / HZ, 5);
  });

  it("the rising edge is the onset time", () => {
    const data = [0, 0, 0, 0.8, 0.9, 0.8, 0, 0, 0, 0, 1];
    const segments = deriveSegments(data, HZ, 0.5);
    expect(segments[0].start).toBeCloseTo(3 / HZ, 5);
  });

  it("flat signals yield nothing", () => {
    expect(deriveSegments([1, 1, 1, 1], HZ, 0.5)).toEqual([]);
  });
});
