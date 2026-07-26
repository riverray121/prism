import { describe, expect, it } from "vitest";

import type { Profile } from "$lib/ipc/messages";

import { autoMap, proposalIsEmpty } from "./automap";
import { MappingDocSchema, type MappingDoc } from "./schema";

// Profile with a broad feature set; `favorites` is set per test — auto-map
// must draw from the stars only.
function makeProfile(favorites: string[]): Profile {
  return {
    schema_version: "0.3.0",
    song: {
      id: "s1",
      title: "T",
      artist: "A",
      duration_sec: 2,
      sample_rate: 44100,
      source_file: "t.wav",
      imported_at: "2026-01-01",
      analyzed_at: "2026-01-02",
    },
    timeline: { frame_rate_hz: 100, frame_count: 200 },
    mix: {
      rms: {
        render: "continuous",
        category: "amplitude",
        source: "librosa",
        unit: "normalized",
        data: [0.1, 0.5, 0.9],
        sidecar: "features/f1.npy",
        frames: 3,
        data_range: [0.1, 0.9],
      },
      spectral_centroid: {
        render: "continuous",
        category: "frequency",
        source: "librosa",
        unit: "hz",
        data: [500, 1500, 3000],
        sidecar: "features/f2.npy",
        frames: 3,
        data_range: [500, 3000],
      },
      beats: {
        render: "event",
        category: "rhythm",
        source: "librosa",
        events: [{ t: 0.5 }, { t: 1.5 }],
      },
      chroma: {
        render: "heatmap",
        category: "tonal",
        source: "librosa",
        unit: "energy",
        sidecar: "heatmaps/chroma.npy",
        shape: [12, 200],
        axes: ["pitch", "time"],
      },
      sections: {
        render: "segment",
        category: "structure",
        source: "ml",
        segments: [
          { start: 0, end: 1, label: "intro" },
          { start: 1, end: 2, label: "drop" },
        ],
      },
    },
    stems: {
      eng: {
        drums: {
          audio_file: "stems/eng/drums.wav",
          features: {
            drums_energy: {
              render: "continuous",
              category: "amplitude",
              source: "librosa",
              unit: "normalized",
              data: [0, 1, 0],
              sidecar: "features/f3.npy",
              frames: 3,
              data_range: [0, 1],
            },
            drums_onsets: {
              render: "event",
              category: "rhythm",
              source: "librosa",
              events: [{ t: 0.5 }],
            },
          },
        },
      },
    },
    favorites,
  };
}

const emptyDoc = () => MappingDocSchema.parse({});

describe("autoMap", () => {
  it("empty favorites yields an empty proposal (star features first)", () => {
    const proposal = autoMap(makeProfile([]), emptyDoc());
    expect(proposalIsEmpty(proposal)).toBe(true);
  });

  it("references only favorited paths, and the result validates", () => {
    const favorites = [
      "mix.rms",
      "stems.eng.drums.features.drums_energy",
      "stems.eng.drums.features.drums_onsets",
    ];
    const proposal = autoMap(makeProfile(favorites), emptyDoc());
    const sources: string[] = [];
    for (const p of proposal.programs) {
      for (const v of Object.values(p.channels)) {
        if (typeof v === "object" && v !== null) sources.push(v.source);
      }
    }
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) expect(favorites).toContain(s);
    // The unfavorited centroid/heatmap/beats never appear.
    expect(sources).not.toContain("mix.spectral_centroid");
    // Assembles into a schema-valid doc.
    const assembled = MappingDocSchema.safeParse({
      programs: proposal.programs,
      macro: {
        scenes_from: proposal.scenesFrom,
        scenes: proposal.scenes,
        master: null,
      },
    });
    expect(assembled.success).toBe(true);
  });

  it("groups by stem: drums energy + onsets land in one program", () => {
    const proposal = autoMap(
      makeProfile([
        "stems.eng.drums.features.drums_energy",
        "stems.eng.drums.features.drums_onsets",
      ]),
      emptyDoc(),
    );
    expect(proposal.programs).toHaveLength(1);
    const p = proposal.programs[0];
    expect(p.id).toBe("auto_drums");
    expect(p.channels.brightness).toBeDefined();
    expect(p.channels.gate).toBeDefined();
  });

  it("binds by kind: centroid → color_temp, heatmap → position", () => {
    const proposal = autoMap(
      makeProfile(["mix.spectral_centroid", "mix.chroma"]),
      emptyDoc(),
    );
    const mix = proposal.programs.find((p) => p.id === "auto_mix")!;
    expect(mix.channels.color_temp).toBeDefined();
    expect(mix.channels.position).toBeDefined();
  });

  it("favorited sections seed scenes, one preset per label", () => {
    const proposal = autoMap(
      makeProfile(["mix.rms", "mix.sections"]),
      emptyDoc(),
    );
    expect(proposal.scenesFrom).toBe("mix.sections");
    expect(Object.keys(proposal.scenes).sort()).toEqual(["drop", "intro"]);
    expect(proposal.scenes.intro.programs).toContain("auto_mix");
  });

  it("never touches existing entries: ids unique, scene source untouched", () => {
    const existing = MappingDocSchema.parse({
      programs: [{ id: "auto_mix", enabled: true, channels: { hue: 20 } }],
      macro: {
        scenes_from: "mix.sections",
        scenes: { intro: { programs: [], master_scale: 0.3 } },
        master: null,
      },
    }) as MappingDoc;
    const proposal = autoMap(
      makeProfile(["mix.rms", "mix.sections"]),
      existing,
    );
    // Fresh id, no collision with the hand-built program.
    expect(proposal.programs[0].id).toBe("auto_mix_2");
    // Scenes source already set by hand: the proposal leaves it alone.
    expect(proposal.scenesFrom).toBeNull();
    expect(proposal.scenes).toEqual({});
  });

  it("song intensity anchors stem brightness to the mix range", () => {
    const favorites = ["mix.rms", "stems.eng.drums.features.drums_energy"];
    const proposal = autoMap(makeProfile(favorites), emptyDoc(), {
      intensity: "song",
    });
    const mix = proposal.programs.find((p) => p.id === "auto_mix")!;
    const drums = proposal.programs.find((p) => p.id === "auto_drums")!;
    // The mix's own range already is the song: silent default chain.
    expect(mix.channels.brightness).toEqual({
      source: "mix.rms",
      transform: [],
    });
    // No mix.drums_energy exists, so the stem anchors to mix.rms's range.
    expect(drums.channels.brightness).toEqual({
      source: "stems.eng.drums.features.drums_energy",
      transform: [
        { normalize: { min: 0.1, max: 0.9, curve: "linear", gamma: 2 } },
        { smooth: { window_s: 0.08 } },
      ],
    });
  });

  it("feature intensity (default) keeps the silent default chain", () => {
    const proposal = autoMap(
      makeProfile(["stems.eng.drums.features.drums_energy"]),
      emptyDoc(),
    );
    const drums = proposal.programs.find((p) => p.id === "auto_drums")!;
    expect(drums.channels.brightness).toEqual({
      source: "stems.eng.drums.features.drums_energy",
      transform: [],
    });
  });
});
