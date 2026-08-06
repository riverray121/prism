import { describe, expect, it } from "vitest";

import { activePatch, hubForLight, patchedPixelCount } from "./patch";
import type { RigHub } from "./wled";
import { DEFAULT_PIXELS } from "$lib/mapping/evaluate";
import { MappingDocSchema, type MappingDoc } from "$lib/mapping/schema";

const HUB: RigHub = {
  mac: "a842e39b1c60",
  name: "Desk hub",
  ip: "192.168.0.84",
  lights: [{ id: "a842e39b1c60:0", name: "Strip", pixel_count: 300, start: 0 }],
};

function doc(patch: Record<string, string> = {}): MappingDoc {
  return MappingDocSchema.parse({
    programs: [{ id: "pulse", channels: { brightness: 1 } }],
    patch,
  });
}

describe("patch schema", () => {
  it("docs written before the patch field existed load with an empty patch", () => {
    const legacy = MappingDocSchema.parse({
      schema_version: "0.1.0",
      programs: [{ id: "p1" }],
    });
    expect(legacy.patch).toEqual({});
  });

  it("round-trips a saved patch entry", () => {
    const d = doc({ "a842e39b1c60:0": "pulse" });
    expect(MappingDocSchema.parse(d).patch).toEqual({
      "a842e39b1c60:0": "pulse",
    });
  });
});

describe("activePatch", () => {
  const online = { a842e39b1c60: true };

  it("resolves a live entry to its hub, light, and program", () => {
    const targets = activePatch(
      doc({ "a842e39b1c60:0": "pulse" }),
      [HUB],
      online,
    );
    expect(targets).toHaveLength(1);
    expect(targets[0].hub.mac).toBe("a842e39b1c60");
    expect(targets[0].light.pixel_count).toBe(300);
    expect(targets[0].program.id).toBe("pulse");
  });

  it("mutes a dangling program id", () => {
    const targets = activePatch(
      doc({ "a842e39b1c60:0": "deleted" }),
      [HUB],
      online,
    );
    expect(targets).toEqual([]);
  });

  it("mutes a disabled program", () => {
    const d = doc({ "a842e39b1c60:0": "pulse" });
    d.programs[0].enabled = false;
    expect(activePatch(d, [HUB], online)).toEqual([]);
  });

  it("mutes lights on offline or unknown hubs", () => {
    const d = doc({ "a842e39b1c60:0": "pulse", "ffffffffffff:0": "pulse" });
    expect(activePatch(d, [HUB], { a842e39b1c60: false })).toEqual([]);
    expect(activePatch(d, [HUB], online)).toHaveLength(1);
  });

  it("hubForLight finds the owning hub by light id", () => {
    expect(hubForLight([HUB], "a842e39b1c60:0")?.name).toBe("Desk hub");
    expect(hubForLight([HUB], "other:0")).toBeUndefined();
  });
});

describe("patchedPixelCount", () => {
  it("uses the patched light's real count, even while its hub is offline", () => {
    const d = doc({ "a842e39b1c60:0": "pulse" });
    expect(patchedPixelCount(d, [HUB])).toBe(300);
  });

  it("falls back to the preview default with no patch or unknown lights", () => {
    expect(patchedPixelCount(doc(), [HUB])).toBe(DEFAULT_PIXELS);
    expect(patchedPixelCount(doc({ "gone:0": "pulse" }), [HUB])).toBe(
      DEFAULT_PIXELS,
    );
  });
});
