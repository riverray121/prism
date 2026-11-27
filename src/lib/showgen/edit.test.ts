import { describe, expect, it } from "vitest";

import type { Derivation, Program } from "$lib/mapping/schema";
import {
  brightnessRange,
  detectStyle,
  hitsId,
  levelAt,
  newGlowProgram,
  nextSlotColor,
  programSource,
  restyle,
  smoothing,
  STYLES,
  withColor,
  withRange,
  withSmoothing,
} from "$lib/showgen/edit";
import { resolvePalette } from "$lib/showgen/palettes";

const PATH = "stems.e.bass.features.energy";
const data = Float32Array.from({ length: 1000 }, (_, i) => (i % 100) / 100);
const base: Program = {
  id: "bass",
  name: "Bass",
  enabled: true,
  channels: { hue: 220, saturation: 0.5 },
};

describe("restyle", () => {
  it("every style round-trips through detectStyle and keeps color and name", () => {
    for (const style of STYLES) {
      const { program, derivations } = restyle(base, [], style, {
        path: PATH,
        data,
        beatPeriodS: 0.5,
      });
      expect(detectStyle(program)).toBe(style);
      expect(program.channels.hue).toBe(220);
      expect(program.channels.saturation).toBe(0.5);
      expect(program.name).toBe("Bass");
      expect(programSource(program, derivations)).toBe(PATH);
    }
  });

  it("owns one hits derivation: added for hits styles, dropped for glow", () => {
    const other: Derivation = {
      id: "keep",
      source: PATH,
      threshold: { cutoff: 0.4, max: 1, sensitivity: 1, mode: "events" },
    };
    const flash = restyle(base, [other], "flash", {
      path: PATH,
      data,
      beatPeriodS: 0.5,
    });
    expect(flash.derivations.map((d) => d.id)).toEqual([
      "keep",
      hitsId("bass"),
    ]);
    const pulse = restyle(flash.program, flash.derivations, "pulse", {
      path: PATH,
      data,
      beatPeriodS: 0.5,
    });
    expect(pulse.derivations.map((d) => d.id)).toEqual([
      "keep",
      hitsId("bass"),
    ]);
    const glow = restyle(pulse.program, pulse.derivations, "glow", {
      path: PATH,
      data,
      beatPeriodS: 0.5,
    });
    expect(glow.derivations.map((d) => d.id)).toEqual(["keep"]);
  });

  it("works before the source data has loaded (auto range)", () => {
    const { program } = restyle(base, [], "glow", {
      path: PATH,
      beatPeriodS: 0.5,
    });
    expect(detectStyle(program)).toBe("glow");
    expect(brightnessRange(program)).toBeNull();
  });
});

describe("range, smoothing, color", () => {
  const glow = restyle(base, [], "glow", {
    path: PATH,
    data,
    beatPeriodS: 0.5,
  }).program;

  it("floor and peak set the normalize input range", () => {
    const r = brightnessRange(withRange(glow, 0.2, 0.7));
    expect(r?.floor).toBeCloseTo(0.2);
    expect(r?.peak).toBeCloseTo(0.7);
  });

  it("smoothing sets and removes the smooth step", () => {
    expect(smoothing(withSmoothing(glow, 0.3))).toBe(0.3);
    expect(smoothing(withSmoothing(glow, 0))).toBeNull();
  });

  it("withColor sets constant hue and saturation and drops color_temp", () => {
    const p = withColor(
      { ...glow, channels: { ...glow.channels, color_temp: 0.5 } },
      "#FF0000",
    );
    expect(typeof p.channels.hue).toBe("number");
    expect(p.channels.color_temp).toBeUndefined();
  });
});

describe("new programs", () => {
  it("take the palette's next base slot, skipping the outlier", () => {
    const forest = resolvePalette({ id: "forest" });
    expect(nextSlotColor(0, { id: "forest" })).toBe(forest.colors[0]);
    expect(nextSlotColor(3, { id: "forest" })).toBe(forest.colors[0]);
  });

  it("get a unique id from the source", () => {
    const a = newGlowProgram(PATH, "Bass", data, [], { id: "blue" });
    const b = newGlowProgram(PATH, "Bass", data, [a], { id: "blue" });
    const kick = newGlowProgram(
      "stems.e.drums.substems.kick.features.energy",
      "Kick",
      data,
      [],
      { id: "blue" },
    );
    const mix = newGlowProgram("mix.rms", "Mix", data, [], { id: "blue" });
    expect([a.id, b.id, kick.id, mix.id]).toEqual([
      "bass",
      "bass_2",
      "kick",
      "mix_rms",
    ]);
  });
});

describe("levelAt", () => {
  it("is brightness times the gate", () => {
    const output = {
      key: "k",
      channels: { brightness: Float32Array.from([0.2, 0.8]) },
      gate: [{ start: 0.005, end: 0.02, strength: 0.5 }],
      pixels: null,
    };
    expect(levelAt(output, 0.01, 100, 2)).toBeCloseTo(0.4);
    expect(levelAt({ ...output, gate: null }, 0.01, 100, 2)).toBeCloseTo(0.8);
  });
});
