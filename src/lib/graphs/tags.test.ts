import { describe, expect, it } from "vitest";

import type { Npy } from "$lib/npy";
import { presentRows } from "./tags";

function matrix(rows: number[][]): Npy {
  const cols = rows[0]?.length ?? 0;
  return {
    shape: [rows.length, cols],
    data: new Float32Array(rows.flat()),
  };
}

describe("presentRows", () => {
  it("drops rows whose peak is below the threshold", () => {
    const rows = presentRows(
      matrix([
        [0, 0.9, 0],
        [0, 0.04, 0],
      ]),
      ["loud", "silent"],
      0.05,
    );
    expect(rows.map((r) => r.label)).toEqual(["loud"]);
  });

  it("orders rows by descending peak", () => {
    const rows = presentRows(
      matrix([
        [0.2, 0, 0],
        [0.9, 0, 0],
        [0.5, 0, 0],
      ]),
      ["a", "b", "c"],
      0.05,
    );
    expect(rows.map((r) => r.label)).toEqual(["b", "c", "a"]);
  });

  it("falls back to a row index when labels run short", () => {
    const rows = presentRows(matrix([[0.5, 0.5]]), [], 0.05);
    expect(rows[0].label).toBe("row 0");
  });

  it("copies each row's frames out of the flat matrix", () => {
    const rows = presentRows(
      matrix([
        [0.1, 0.2],
        [0.9, 0.8],
      ]),
      ["a", "b"],
      0.05,
    );
    // Values round-trip through Float32Array; compare with f32 tolerance.
    expect(rows[0].data[0]).toBeCloseTo(0.9, 6);
    expect(rows[0].data[1]).toBeCloseTo(0.8, 6);
    expect(rows[1].data[0]).toBeCloseTo(0.1, 6);
    expect(rows[1].data[1]).toBeCloseTo(0.2, 6);
  });
});
