import { describe, expect, it, vi } from "vitest";
import {
  MixFeatureSchema,
  ProfileSchema,
  ScalarFeatureSchema,
  SidecarEventSchema,
  SongSchema,
} from "./messages";

describe("SongSchema", () => {
  it("defaults absent progress fields to null", () => {
    const song = SongSchema.parse({
      id: "1",
      title: "t",
      artist: "a",
      duration_sec: null,
      sample_rate: null,
      source_path: "p",
      status: "unanalyzed",
      imported_at: "now",
    });
    expect(song.current_stage).toBeNull();
    expect(song.current_engine).toBeNull();
    expect(song.current_step).toBeNull();
    expect(song.total_steps).toBeNull();
  });
});

describe("ScalarFeatureSchema", () => {
  it("accepts both numeric and string values", () => {
    const base = {
      render: "scalar",
      category: "tonal",
      source: "s",
      unit: "key",
    };
    expect(ScalarFeatureSchema.parse({ ...base, value: 3.2 }).value).toBe(3.2);
    expect(ScalarFeatureSchema.parse({ ...base, value: "C major" }).value).toBe(
      "C major",
    );
  });
});

describe("MixFeatureSchema discriminated union", () => {
  it("routes by render mode", () => {
    const cont = MixFeatureSchema.parse({
      render: "continuous",
      category: "amplitude",
      source: "librosa",
      unit: "normalized",
      data: [0, 1],
    });
    expect(cont.render).toBe("continuous");
  });

  it("passes unknown per-event keys through", () => {
    const ev = MixFeatureSchema.parse({
      render: "event",
      category: "tonal",
      source: "btc",
      events: [{ t: 1.0, root: "C", quality: "maj" }],
    });
    // Chord attrs beyond `t` survive via .passthrough().
    expect((ev as any).events[0].root).toBe("C");
  });

  it("rejects an unknown render mode", () => {
    expect(
      MixFeatureSchema.safeParse({
        render: "bogus",
        category: "x",
        source: "y",
      }).success,
    ).toBe(false);
  });
});

describe("SidecarEventSchema discriminated union", () => {
  it("rejects an unknown event type", () => {
    expect(SidecarEventSchema.safeParse({ type: "nope" }).success).toBe(false);
  });

  it("parses a settings event", () => {
    const ev = SidecarEventSchema.parse({
      type: "settings",
      engines: ["htdemucs_ft"],
      available_engines: ["htdemucs_ft"],
      engine_info: { htdemucs_ft: { label: "Demucs", drums: true } },
      drum_subsep: false,
    });
    expect(ev.type).toBe("settings");
  });
});

describe("ProfileSchema", () => {
  const baseProfile = {
    schema_version: "0.1.0",
    song: {
      id: "1",
      title: "t",
      artist: "a",
      duration_sec: 10,
      sample_rate: 44100,
      source_file: "source.flac",
      imported_at: "then",
      analyzed_at: "now",
    },
    timeline: { frame_rate_hz: 100, frame_count: 5 },
  };

  it("defaults stems to empty when absent (pre-M4 profiles)", () => {
    const profile = ProfileSchema.parse({ ...baseProfile, mix: {} });
    expect(profile.stems).toEqual({});
  });

  it("drops only the unparseable feature, keeping the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const profile = ProfileSchema.parse({
      ...baseProfile,
      mix: {
        good: {
          render: "continuous",
          category: "amplitude",
          source: "librosa",
          unit: "normalized",
          data: [0, 1],
        },
        bad: { render: "unmodeled-mode" },
      },
    });
    expect(Object.keys(profile.mix)).toEqual(["good"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
