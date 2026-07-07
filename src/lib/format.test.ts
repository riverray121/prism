import { describe, expect, it } from "vitest";

import { formatTime } from "./format";

describe("formatTime", () => {
  it("formats zero and sub-minute values", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(59)).toBe("0:59");
  });

  it("carries minutes and pads seconds", () => {
    expect(formatTime(60)).toBe("1:00");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(600)).toBe("10:00");
  });

  it("floors fractional seconds (a clock never rounds up)", () => {
    expect(formatTime(59.9)).toBe("0:59");
  });
});
