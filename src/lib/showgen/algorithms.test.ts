import { describe, expect, it } from "vitest";

import type { ContinuousFeature, Profile } from "$lib/ipc/messages";
import { autoMap } from "$lib/mapping/automap";
import { MappingDocSchema } from "$lib/mapping/schema";
import { v1Baseline } from "$lib/showgen/algorithms/v1-baseline";
import { v2Ranked } from "$lib/showgen/algorithms/v2-ranked";
import { v3Roles } from "$lib/showgen/algorithms/v3-roles";
import {
  lightActivity,
  MIN_ACTIVE,
  v4Verified,
} from "$lib/showgen/algorithms/v4-verified";
import {
  applyPalette,
  hexToOklch,
  PALETTES,
  resolvePalette,
} from "$lib/showgen/palettes";
import { oklchToRgb8 } from "$lib/color";
import type { LightSpec } from "$lib/showgen/types";

const HZ = 100;
const N = 60 * HZ;
const BEAT = 0.5;

function env(data: Float32Array, scale = 0.2): ContinuousFeature {
  // Strict onsets at each local maximum above half the peak.
  const onsets_strict: { t: number; strength: number }[] = [];
  for (let i = 1; i < data.length - 1; i++)
    if (data[i] > 0.5 && data[i] >= data[i - 1] && data[i] > data[i + 1])
      onsets_strict.push({ t: i / HZ, strength: data[i] });
  return {
    render: "continuous",
    category: "amplitude",
    source: "test",
    unit: "normalized",
    data,
    sidecar: "x.npy",
    frames: data.length,
    data_range: [0, 1],
    scale,
    onsets_strict,
  };
}

// Kick: hit every beat. Hats: every half beat, offset. Pad: slow swell.
const kick = Float32Array.from({ length: N }, (_, i) =>
  Math.exp(-(i % (BEAT * HZ)) / 10),
);
const hats = Float32Array.from(
  { length: N },
  (_, i) => 0.3 + 0.7 * Math.exp(-((i + 12) % 25) / 4),
);
const vocal = Float32Array.from({ length: N }, (_, i) => {
  const phrase = Math.floor(i / (4 * HZ)) % 2;
  return phrase
    ? 0.05
    : 0.5 + 0.5 * Math.abs(Math.sin((2 * Math.PI * i) / (1.3 * HZ)));
});
const mix = Float32Array.from({ length: N }, (_, i) =>
  Math.min(1, 0.5 * kick[i] + 0.3 * hats[i] + 0.3 * vocal[i]),
);

function profile(
  extraStems: Record<
    string,
    Record<
      string,
      { audio_file: string; features: Record<string, ContinuousFeature> }
    >
  > = {},
): Profile {
  const beats = Array.from({ length: N / (BEAT * HZ) }, (_, i) => ({
    t: i * BEAT,
  }));
  return {
    schema_version: "0.4.0",
    song: {
      id: "s",
      title: "T",
      artist: "A",
      duration_sec: 60,
      sample_rate: 44100,
      source_file: "s.wav",
      imported_at: "",
      analyzed_at: "",
    },
    timeline: { frame_rate_hz: HZ, frame_count: N },
    mix: {
      rms: env(mix, 0.5),
      beats: {
        render: "event",
        category: "rhythm",
        source: "t",
        events: beats,
      },
      bpm: {
        render: "scalar",
        category: "rhythm",
        source: "t",
        unit: "bpm",
        value: 120,
      },
      sections: {
        render: "segment",
        category: "structure",
        source: "t",
        segments: [
          { start: 0, end: 30, label: "verse" },
          { start: 30, end: 60, label: "chorus" },
        ],
      },
    },
    stems: {
      eng_a: {
        drums: { audio_file: "", features: { energy: env(kick, 0.3) } },
        other: { audio_file: "", features: { energy: env(hats, 0.1) } },
        vocals: { audio_file: "", features: { energy: env(vocal, 0.2) } },
      },
      ...extraStems,
    },
    favorites: [
      "stems.eng_a.drums.features.energy",
      "stems.eng_a.vocals.features.energy",
    ],
  } as Profile;
}

const lights = (n: number): LightSpec[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `L${i}`,
    name: `L${i}`,
    kind: "strip",
    pixelCount: 10,
  }));

describe("v1-baseline", () => {
  it("matches autoMap plus round-robin, recolored by the palette", () => {
    const p = profile();
    const result = v1Baseline.generate({
      profile: p,
      lights: lights(5),
      palette: { id: "blue" },
    });
    const proposal = autoMap(p, MappingDocSchema.parse({}), {
      intensity: "feature",
    });
    expect(result.programs.map((x) => x.id)).toEqual(
      proposal.programs.map((x) => x.id),
    );
    expect(result.programs[0].channels.brightness).toEqual(
      proposal.programs[0].channels.brightness,
    );
    const ids = proposal.programs.map((x) => x.id);
    expect(result.patch).toEqual({
      L0: ids[0],
      L1: ids[1],
      L2: ids[0],
      L3: ids[1],
      L4: ids[0],
    });
  });
});

describe("v2-ranked", () => {
  it("reports every candidate with every measure", () => {
    const r = v2Ranked.generate({
      profile: profile(),
      lights: lights(3),
      palette: { id: "blue" },
    });
    expect(r.report.candidates).toHaveLength(4);
    for (const c of r.report.candidates) {
      expect(Object.keys(c.measures)).toEqual(
        expect.arrayContaining([
          "presence",
          "motion",
          "flicker",
          "pulse",
          "alignment",
          "contrast",
          "section_contrast",
          "leak",
        ]),
      );
    }
  });

  it("never picks a stem louder than its mix (bleed)", () => {
    const p = profile({
      eng_b: {
        vocals: { audio_file: "", features: { energy: env(mix, 0.6) } },
      },
    });
    const r = v2Ranked.generate({
      profile: p,
      lights: lights(5),
      palette: { id: "blue" },
    });
    const bleed = r.report.candidates.find(
      (c) => c.path === "stems.eng_b.vocals.features.energy",
    )!;
    expect(bleed.picked).toBe(false);
    expect(bleed.reason).toMatch(/louder than the mix/);
  });

  it("keeps one of a same-family pair from two engines", () => {
    const p = profile({
      eng_b: {
        drums: {
          audio_file: "",
          features: {
            energy: env(
              kick.map((v) => v * 0.98),
              0.3,
            ),
          },
        },
      },
    });
    const r = v2Ranked.generate({
      profile: p,
      lights: lights(3),
      palette: { id: "blue" },
    });
    const drums = r.report.candidates.filter(
      (c) => c.family === "drums" && c.picked,
    );
    expect(drums).toHaveLength(1);
  });

  it("never picks a scaled copy of a picked track", () => {
    const p = profile({
      eng_b: {
        piano: {
          audio_file: "",
          features: {
            energy: env(
              kick.map((v) => v * 0.5),
              0.15,
            ),
          },
        },
      },
    });
    const r = v2Ranked.generate({
      profile: p,
      lights: lights(3),
      palette: { id: "blue" },
    });
    const picked = r.report.candidates
      .filter((c) => c.picked)
      .map((c) => c.path);
    expect(
      picked.includes("stems.eng_a.drums.features.energy") &&
        picked.includes("stems.eng_b.piano.features.energy"),
    ).toBe(false);
  });

  it("gives every light a program and extra lights a distinct program", () => {
    const r = v2Ranked.generate({
      profile: profile(),
      lights: lights(6),
      palette: { id: "blue" },
    });
    const ids = Object.values(r.patch);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });
});

describe("palettes", () => {
  it("hex → OKLCH → sRGB round-trips within one step", () => {
    for (const p of PALETTES)
      for (const hex of p.colors) {
        const back = oklchToRgb8(hexToOklch(hex));
        const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        back.forEach((v, i) =>
          expect(Math.abs(v - want[i])).toBeLessThanOrEqual(1),
        );
      }
  });

  it("cycles base colors and gives the outlier to the accent program only", () => {
    const progs = ["a", "b", "c", "d", "e"].map((id) => ({
      id,
      enabled: true,
      channels: {},
    }));
    const out = applyPalette(progs, { id: "forest" }, "e");
    const forest = resolvePalette({ id: "forest" });
    const hueOf = (hex: string) => hexToOklch(hex).h;
    expect(out[0].channels.hue).toBeCloseTo(hueOf(forest.colors[0]), 6);
    expect(out[3].channels.hue).toBeCloseTo(hueOf(forest.colors[0]), 6);
    expect(out[4].channels.hue).toBeCloseTo(hueOf(forest.colors[3]), 6);
  });

  it("single mode colors every program the same", () => {
    const progs = ["a", "b"].map((id) => ({ id, enabled: true, channels: {} }));
    const out = applyPalette(progs, { id: "single", color: "#FF8800" });
    expect(out[0].channels.hue).toBe(out[1].channels.hue);
  });

  it("an old doc without palette reads as blue", () => {
    expect(MappingDocSchema.parse({ schema_version: "0.1.0" }).palette).toEqual(
      { id: "blue" },
    );
  });
});

describe("v3-roles", () => {
  const room: LightSpec[] = [
    { id: "wash", name: "wash", kind: "wash", pixelCount: 1 },
    { id: "strobe", name: "strobe", kind: "strobe", pixelCount: 1 },
    { id: "strip", name: "strip", kind: "strip", pixelCount: 30 },
  ];

  it("puts the click-like track on the strobe as a pulse", () => {
    const r = v3Roles.generate({
      profile: profile(),
      lights: room,
      palette: { id: "blue" },
    });
    const drums = r.report.candidates.find(
      (c) => c.path === "stems.eng_a.drums.features.energy",
    )!;
    expect(drums.role).toBe("pulse");
    const pid = r.patch.strobe;
    expect(r.report.picks.find((p) => p.programId === pid)?.path).toBe(
      drums.path,
    );
    const b = r.programs.find((p) => p.id === pid)!.channels.brightness;
    expect(typeof b === "object" && b.source.startsWith("derived.")).toBe(true);
  });

  it("puts a swell on the wall washer", () => {
    const r = v3Roles.generate({
      profile: profile(),
      lights: room,
      palette: { id: "blue" },
    });
    const pick = r.report.picks.find((p) => p.programId === r.patch.wash)!;
    expect(pick.role).toBe("swell");
  });

  it("steps hue with the sections and scales each section by its loudness", () => {
    const r = v3Roles.generate({
      profile: profile(),
      lights: room,
      palette: { id: "blue" },
    });
    const swell = r.programs.find((p) => p.id === r.patch.wash)!;
    const hue = swell.channels.hue;
    expect(typeof hue === "object" && hue.source).toBe("mix.sections");
    expect(r.macro.scenes_from).toBe("mix.sections");
    expect(Object.keys(r.macro.scenes).sort()).toEqual(["chorus", "verse"]);
  });

  it("gives extra lights a different program from their source pick", () => {
    const many = lights(7);
    const r = v3Roles.generate({
      profile: profile(),
      lights: many,
      palette: { id: "blue" },
    });
    expect(new Set(Object.values(r.patch)).size).toBe(7);
  });
});

describe("v4-verified", () => {
  const room: LightSpec[] = [
    { id: "strip", name: "strip", kind: "strip", pixelCount: 20 },
    { id: "wash", name: "wash", kind: "wash", pixelCount: 1 },
  ];

  it("never puts an accent on a strip when no accent fixture exists", () => {
    const r = v4Verified.generate({
      profile: profile(),
      lights: room,
      palette: { id: "blue" },
    });
    expect(r.report.picks.every((p) => p.role !== "accent")).toBe(true);
  });

  it("keeps only lights that visibly change as programmed", () => {
    const input = { profile: profile(), lights: room, palette: { id: "blue" } };
    const r = v4Verified.generate(input);
    for (const a of lightActivity(input, r).values())
      expect(a.active).toBeGreaterThanOrEqual(MIN_ACTIVE);
  });
});
