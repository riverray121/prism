import { describe, expect, it } from "vitest";

import type { Song } from "$lib/ipc/messages";
import { emptyMappingDoc, MappingDocSchema } from "$lib/mapping/schema";

import { nextAction, roundRobinPatch } from "./automation";

const song = (over: Partial<Song>): Song => ({
  id: "s",
  title: "t",
  artist: "a",
  duration_sec: null,
  sample_rate: null,
  source_path: "p",
  status: "analyzed",
  imported_at: "x",
  analyzed_at: null,
  current_stage: null,
  current_engine: null,
  current_step: null,
  total_steps: null,
  progress: null,
  error_message: null,
  request_id: "r",
  published_at: null,
  ...over,
});
const request = {
  id: "r1",
  title: "t",
  artist: "a",
  external: {},
  requested_at: "x",
  status: "open" as const,
};
const base = {
  requests: [],
  songs: [],
  importsPending: false,
  publishing: false,
  skipped: new Set<string>(),
};

describe("nextAction", () => {
  it("waits while publishing or importing", () => {
    expect(nextAction({ ...base, publishing: true }).kind).toBe("wait");
    expect(nextAction({ ...base, importsPending: true }).kind).toBe("wait");
  });

  it("imports an open request before anything else", () => {
    const a = nextAction({
      ...base,
      requests: [request],
      songs: [song({ status: "unanalyzed" })],
    });
    expect(a).toEqual({ kind: "import", request });
  });

  it("queues every unanalyzed linked song, ignoring ordinary imports", () => {
    const a = nextAction({
      ...base,
      songs: [
        song({ id: "a", status: "unanalyzed" }),
        song({ id: "b", status: "unanalyzed", request_id: null }),
        song({ id: "c", status: "unanalyzed" }),
      ],
    });
    expect(a).toEqual({ kind: "queue", songIds: ["a", "c"] });
  });

  it("waits while any song analyzes", () => {
    const a = nextAction({
      ...base,
      songs: [song({ id: "a" }), song({ id: "b", status: "analyzing" })],
    });
    expect(a).toEqual({ kind: "wait", reason: "analyzing" });
  });

  it("processes an analyzed, unpublished, linked song that is not skipped", () => {
    const songs = [
      song({ id: "done", published_at: "x" }),
      song({ id: "skip" }),
      song({ id: "go" }),
      song({ id: "plain", request_id: null }),
    ];
    const a = nextAction({ ...base, songs, skipped: new Set(["skip"]) });
    expect(a.kind).toBe("process");
    expect(a.kind === "process" && a.song.id).toBe("go");
    expect(nextAction({ ...base, songs: [songs[0], songs[3]] }).kind).toBe(
      "idle",
    );
  });
});

describe("roundRobinPatch", () => {
  const hubs = [
    {
      mac: "aa",
      name: "h",
      ip: "1",
      lights: [
        { id: "aa:0", pixel_count: 1, start: 0 },
        { id: "aa:1", pixel_count: 1, start: 1 },
        { id: "aa:2", pixel_count: 1, start: 2 },
      ],
    },
  ];
  it("cycles enabled programs over every rig light", () => {
    const doc = MappingDocSchema.parse({
      ...emptyMappingDoc(),
      programs: [
        { id: "p1", enabled: true },
        { id: "off", enabled: false },
        { id: "p2", enabled: true },
      ],
    });
    expect(roundRobinPatch(doc, hubs)).toEqual({
      "aa:0": "p1",
      "aa:1": "p2",
      "aa:2": "p1",
    });
  });
  it("is null with no programs or no lights", () => {
    expect(roundRobinPatch(emptyMappingDoc(), hubs)).toBeNull();
    const doc = MappingDocSchema.parse({
      ...emptyMappingDoc(),
      programs: [{ id: "p1", enabled: true }],
    });
    expect(roundRobinPatch(doc, [])).toBeNull();
  });
});
