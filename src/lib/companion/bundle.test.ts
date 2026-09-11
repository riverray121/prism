import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/mapping/evaluate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/mapping/evaluate")>()),
  evaluateDoc: vi.fn(),
  applyMacro: vi.fn((_p, _d, raw) => raw),
}));

import * as evaluate from "$lib/mapping/evaluate";
import type { Profile } from "$lib/ipc/messages";
import type { RigHub } from "$lib/hardware/wled";
import { emptyMappingDoc, MappingDocSchema } from "$lib/mapping/schema";

import {
  buildManifest,
  renderShowFrames,
  showFrameCount,
  showLights,
} from "./bundle";

// 10 source frames at 100 Hz: a 0.1 s song, 4 show frames at 40 Hz.
const profile = {
  timeline: { frame_rate_hz: 100, frame_count: 10 },
} as unknown as Profile;

const hubs: RigHub[] = [
  {
    mac: "aa",
    name: "WLED",
    ip: "1.2.3.4",
    lights: [
      { id: "aa:0", name: "Left", pixel_count: 4, start: 0 },
      { id: "aa:1", name: "Right", pixel_count: 2, start: 4 },
    ],
  },
];

function doc(patch: Record<string, string>, enabled = true) {
  return MappingDocSchema.parse({
    ...emptyMappingDoc(),
    programs: [
      { id: "px", enabled },
      { id: "solid", enabled },
    ],
    patch,
  });
}

// A pixel matrix where source frame f has every byte equal to f.
function pixelOutput(pixelCount: number): evaluate.ProgramOutput {
  const rgb = new Uint8ClampedArray(10 * pixelCount * 3);
  for (let f = 0; f < 10; f++)
    rgb.fill(f, f * pixelCount * 3, (f + 1) * pixelCount * 3);
  return { key: "k", channels: {}, gate: null, pixels: { pixelCount, rgb } };
}

describe("showLights", () => {
  it("keys patched rig lights by hub MAC and output index", () => {
    const lights = showLights(doc({ "aa:1": "px", "zz:0": "px" }), hubs);
    expect(lights).toEqual([
      {
        light: {
          key: "aa-1",
          hub_mac: "aa",
          output: 1,
          name: "Right",
          pixel_count: 2,
          frames: "frames/aa-1.bin",
        },
        programId: "px",
      },
    ]);
  });

  it("drops disabled programs", () => {
    expect(showLights(doc({ "aa:0": "px" }, false), hubs)).toEqual([]);
  });
});

describe("renderShowFrames", () => {
  it("samples each light at its own pixel count at the show rate", () => {
    vi.mocked(evaluate.evaluateDoc).mockImplementation(
      (_p, _d, _prev, _m, pixelCount) => ({
        px: pixelOutput(pixelCount ?? 60),
        solid: { key: "s", channels: {}, gate: null, pixels: null },
      }),
    );
    const { frameCount, lights } = renderShowFrames(
      profile,
      doc({ "aa:0": "px", "aa:1": "solid" }),
      hubs,
      {},
    );
    expect(showFrameCount(profile)).toBe(4);
    expect(frameCount).toBe(4);
    expect(evaluate.evaluateDoc).toHaveBeenCalledTimes(2);
    const [left, right] = lights;
    expect(left.bytes.length).toBe(4 * 4 * 3);
    // Show frame i at i/40 s maps to source frame round(i * 2.5).
    expect([0, 12, 24, 36].map((o) => left.bytes[o])).toEqual([0, 3, 5, 8]);
    expect(right.light.key).toBe("aa-1");
    expect(right.bytes.length).toBe(4 * 2 * 3);
    // A program without a pixel matrix renders a solid whole-strip frame.
    expect(right.bytes[0]).toBe(right.bytes[3]);
  });
});

describe("buildManifest", () => {
  it("names the audio by the source extension and fills the timeline", () => {
    const m = buildManifest({
      title: "t",
      artist: "a",
      profile,
      sourceFile: "source.flac",
      lights: [],
      frameCount: 4,
      latencyMs: 90,
      prismVersion: "0.1.0",
    });
    expect(m.audio).toBe("audio.flac");
    expect(m.duration_s).toBeCloseTo(0.1);
    expect(m.frame_rate_hz).toBe(40);
    expect(m.schema).toBe("prism-show/1");
  });
});
