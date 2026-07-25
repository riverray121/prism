import { describe, expect, it } from "vitest";

import { formatTime, humanize } from "./format";

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

describe("humanize", () => {
  it("sentence-cases snake_case identifiers", () => {
    expect(humanize("color_temp")).toBe("Color temp");
    expect(humanize("strobe_rate")).toBe("Strobe rate");
    expect(humanize("auto_mix")).toBe("Auto mix");
    expect(humanize("saturation")).toBe("Saturation");
  });

  it("keeps acronyms in canonical casing", () => {
    expect(humanize("rms")).toBe("RMS");
    expect(humanize("loudness_lufs")).toBe("Loudness LUFS");
    expect(humanize("bpm")).toBe("BPM");
  });
});
