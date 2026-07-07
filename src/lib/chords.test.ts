import { describe, expect, it } from "vitest";

import { chordLabel } from "./chords";

describe("chordLabel", () => {
  it("renders major as the bare root", () => {
    expect(chordLabel({ t: 0, root: "C", quality: "maj" })).toBe("C");
  });

  it("maps known qualities to compact shorthand", () => {
    expect(chordLabel({ t: 0, root: "A", quality: "min" })).toBe("Am");
    expect(chordLabel({ t: 0, root: "B", quality: "hdim7" })).toBe("Bø7");
    expect(chordLabel({ t: 0, root: "F", quality: "sus4" })).toBe("Fsus4");
  });

  it("passes unknown qualities through verbatim", () => {
    expect(chordLabel({ t: 0, root: "C", quality: "weird9" })).toBe("Cweird9");
  });

  it("appends a rounded confidence percentage when present", () => {
    expect(
      chordLabel({ t: 0, root: "A", quality: "min", confidence: 0.874 }),
    ).toBe("Am 87%");
  });

  it("renders N (no chord) and X (unknown) without quality", () => {
    expect(chordLabel({ t: 0, root: "N", confidence: 0.5 })).toBe("N 50%");
    expect(chordLabel({ t: 0, root: "X" })).toBe("X");
  });

  it("returns null when the event has no usable root", () => {
    expect(chordLabel({ t: 0 })).toBeNull();
    expect(chordLabel({ t: 0, root: 42 })).toBeNull();
  });
});
