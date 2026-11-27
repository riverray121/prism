import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/ipc", () => ({
  updateMapping: vi.fn(() => Promise.resolve()),
}));

import * as ipc from "$lib/ipc";
import { emptyMappingDoc } from "$lib/mapping/schema";

import {
  applyMappingEvent,
  flushMappingSave,
  generateWithUndo,
  mapping,
  resetMappingForSong,
  showHistory,
  touchDoc,
  undoGenerate,
} from "./mapping.svelte";

const updateMapping = vi.mocked(ipc.updateMapping);

beforeEach(() => {
  vi.useFakeTimers();
  resetMappingForSong(null);
  updateMapping.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

function openWithDoc(songId = "s1") {
  resetMappingForSong(songId);
  applyMappingEvent(songId, emptyMappingDoc(songId));
}

describe("mapping event application", () => {
  it("applies the doc for the open song", () => {
    resetMappingForSong("s1");
    expect(mapping.doc).toBeNull();
    applyMappingEvent("s1", emptyMappingDoc());
    expect(mapping.doc?.song_id).toBe("s1");
  });

  it("drops a stale event for a song no longer open", () => {
    resetMappingForSong("s2");
    applyMappingEvent("s1", emptyMappingDoc());
    expect(mapping.doc).toBeNull();
  });
});

describe("debounced saves", () => {
  it("touchDoc saves once after the debounce window", () => {
    openWithDoc();
    touchDoc((doc) => {
      doc.programs.push({ id: "p1", enabled: true, channels: {} });
    });
    touchDoc((doc) => {
      doc.programs[0].enabled = false;
    });
    expect(updateMapping).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(updateMapping).toHaveBeenCalledTimes(1);
    const [songId, doc] = updateMapping.mock.calls[0];
    expect(songId).toBe("s1");
    expect((doc as { programs: unknown[] }).programs).toHaveLength(1);
  });

  it("a song switch flushes the pending save to the old song", () => {
    openWithDoc("s1");
    touchDoc((doc) => {
      doc.derivations.push({
        id: "d1",
        source: "mix.rms",
        threshold: { cutoff: 0.5, max: 1, sensitivity: 1, mode: "events" },
      });
    });
    resetMappingForSong("s2");
    expect(updateMapping).toHaveBeenCalledTimes(1);
    expect(updateMapping.mock.calls[0][0]).toBe("s1");
    // No second save fires later.
    vi.runAllTimers();
    expect(updateMapping).toHaveBeenCalledTimes(1);
  });

  it("touchDoc is a no-op with no doc loaded", () => {
    resetMappingForSong("s1"); // doc still null
    touchDoc((doc) => {
      doc.programs.push({ id: "p", enabled: true, channels: {} });
    });
    vi.runAllTimers();
    expect(updateMapping).not.toHaveBeenCalled();
  });

  it("flushMappingSave with nothing pending is a no-op", () => {
    openWithDoc();
    flushMappingSave();
    expect(updateMapping).not.toHaveBeenCalled();
  });
});

describe("generate with undo", () => {
  const result = {
    programs: [{ id: "gen", enabled: true, channels: {} }],
    derivations: [],
    patch: { L1: "gen" },
    macro: { scenes_from: null, scenes: {}, master: null },
    report: { algorithm: "v2-ranked", candidates: [], picks: [], notes: [] },
  };

  it("replaces the show and Undo restores the doc from before", () => {
    openWithDoc();
    touchDoc((doc) => {
      doc.programs.push({ id: "mine", enabled: true, channels: {} });
      doc.patch = { L1: "mine" };
    });
    generateWithUndo(result, "v2-ranked", { id: "ember" });
    expect(mapping.doc?.programs.map((p) => p.id)).toEqual(["gen"]);
    expect(mapping.doc?.generator?.algorithm).toBe("v2-ranked");
    expect(mapping.doc?.palette).toEqual({ id: "ember" });
    expect(showHistory.before).not.toBeNull();

    undoGenerate();
    expect(mapping.doc?.programs.map((p) => p.id)).toEqual(["mine"]);
    expect(mapping.doc?.patch).toEqual({ L1: "mine" });
    expect(mapping.doc?.generator).toBeUndefined();
    expect(mapping.doc?.palette).toEqual({ id: "blue" });
    expect(showHistory.before).toBeNull();
  });

  it("any edit after Generate clears the undo snapshot", () => {
    openWithDoc();
    generateWithUndo(result, "v2-ranked", { id: "blue" });
    touchDoc((doc) => {
      doc.patch = { L1: "gen" };
    });
    expect(showHistory.before).toBeNull();
  });

  it("a song switch clears the undo snapshot", () => {
    openWithDoc("s1");
    generateWithUndo(result, "v2-ranked", { id: "blue" });
    resetMappingForSong("s2");
    expect(showHistory.before).toBeNull();
  });
});
