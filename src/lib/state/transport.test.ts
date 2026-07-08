import { beforeEach, describe, expect, it, vi } from "vitest";

// convertFileSrc is identity here so assertions read as plain file paths.
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
}));

import {
  resetForSong,
  scrub,
  scrubEnd,
  scrubStart,
  setRate,
  setViewWindow,
  switchSource,
  toggleFollowMode,
  toggleSource,
  transport,
  view,
} from "./transport.svelte";

// Minimal Web Audio fake: decodeAudioData parks its resolver in `decodes` so
// tests control exactly when (and in what order) decodes complete — the race
// guards under test all hinge on that timing.
type FakeBuffer = { duration: number };
let decodes: Array<(buffer: FakeBuffer) => void>;

class FakeSource {
  buffer: FakeBuffer | null = null;
  playbackRate = { value: 1 };
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  connect(): void {}
  disconnect(): void {}
  start(_when: number, offset: number): void {
    this.startedAt = offset;
  }
  stop(): void {}
}

let ctx: FakeAudioContext | undefined;

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  sources: FakeSource[] = [];
  constructor() {
    ctx = this;
  }
  async resume(): Promise<void> {}
  decodeAudioData(_bytes: ArrayBuffer): Promise<FakeBuffer> {
    return new Promise((resolve) => decodes.push(resolve));
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
}

vi.stubGlobal("AudioContext", FakeAudioContext);
vi.stubGlobal("fetch", async () => ({
  arrayBuffer: async () => new ArrayBuffer(4),
}));
// The playhead loop schedules but never runs; tests read state synchronously.
vi.stubGlobal("requestAnimationFrame", () => 1);
vi.stubGlobal("cancelAnimationFrame", () => {});

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// Let pending loads reach decodeAudioData, complete them all, then let the
// awaiting code observe the result.
async function settleDecodes(duration = 30): Promise<void> {
  await flush();
  while (decodes.length > 0) decodes.shift()!({ duration });
  await flush();
}

// The transport module is a singleton; resetForSong(null) is its own
// between-songs reset, which is exactly the per-test isolation needed.
beforeEach(() => {
  decodes = [];
  resetForSong(null, 0);
  transport.rate = 1;
  view.followMode = "center";
  if (ctx) {
    ctx.currentTime = 0;
    ctx.sources = [];
  }
});

describe("shared view window", () => {
  it("stores a window and resets it to full extent", () => {
    setViewWindow({ min: 10, max: 20 });
    expect(view.window).toEqual({ min: 10, max: 20 });
    setViewWindow(null);
    expect(view.window).toBeNull();
  });

  it("drops equal-value writes so lanes echoing a window don't retrigger", () => {
    setViewWindow({ min: 10, max: 20 });
    const held = view.window;
    setViewWindow({ min: 10, max: 20 });
    expect(view.window).toBe(held); // same object: the write was skipped
    setViewWindow(null);
    const cleared = view.window;
    setViewWindow(null);
    expect(view.window).toBe(cleared);
  });

  it("toggleFollowMode flips between center and page", () => {
    expect(view.followMode).toBe("center");
    toggleFollowMode();
    expect(view.followMode).toBe("page");
    toggleFollowMode();
    expect(view.followMode).toBe("center");
  });

  it("a song change clears the window (new time extent)", () => {
    setViewWindow({ min: 5, max: 9 });
    resetForSong(null, 0);
    expect(view.window).toBeNull();
  });
});

describe("resetForSong", () => {
  it("publishes the metadata duration until a buffer decodes", () => {
    resetForSong(null, 5);
    expect(transport.durationSec).toBe(5);
    expect(transport.playing).toBe(false);
    expect(transport.currentTime).toBe(0);
    expect(transport.activeKey).toBe("mix");
    expect(transport.error).toBeNull();
  });

  it("pre-decodes the mix and adopts its real duration", async () => {
    resetForSong("/song.wav", 3);
    expect(transport.durationSec).toBe(3);
    await settleDecodes(30);
    expect(transport.durationSec).toBe(30);
    expect(transport.playing).toBe(false);
  });

  it("abandons a pre-decode superseded by a newer reset", async () => {
    resetForSong("/old.wav", 3);
    await flush();
    resetForSong(null, 0);
    await settleDecodes(30);
    expect(transport.durationSec).toBe(0);
  });
});

describe("play / pause", () => {
  it("toggleSource with no path surfaces an error instead of playing", () => {
    toggleSource("eng::vocals", null);
    expect(transport.playing).toBe(false);
    expect(transport.error).toContain("eng::vocals");
  });

  it("plays a source, then pauses it holding the playhead", async () => {
    resetForSong(null, 30);
    toggleSource("mix", "/song.wav");
    await settleDecodes(30);
    expect(transport.playing).toBe(true);
    expect(transport.activeKey).toBe("mix");
    expect(transport.error).toBeNull();
    expect(ctx!.sources.at(-1)!.startedAt).toBe(0);

    // Two seconds of audio-clock time elapse, then the same key toggles off.
    ctx!.currentTime = 2;
    toggleSource("mix", "/song.wav");
    expect(transport.playing).toBe(false);
    expect(transport.currentTime).toBe(2);
  });

  it("a play superseded by a newer play never becomes audible", async () => {
    toggleSource("mix", "/a.wav");
    await flush();
    toggleSource("eng::drums", "/b.wav");
    await flush();
    // Both decodes are in flight; the first resolving must not win.
    decodes.shift()!({ duration: 10 });
    await flush();
    expect(transport.playing).toBe(false);
    decodes.shift()!({ duration: 20 });
    await flush();
    expect(transport.playing).toBe(true);
    expect(transport.activeKey).toBe("eng::drums");
    expect(transport.durationSec).toBe(20);
  });

  it("a song reset during a pending play keeps the transport stopped", async () => {
    toggleSource("mix", "/a.wav");
    await flush();
    resetForSong(null, 0);
    await settleDecodes(30);
    expect(transport.playing).toBe(false);
    expect(transport.durationSec).toBe(0);
  });
});

describe("scrubbing", () => {
  it("clamps the playhead to the audible duration", () => {
    resetForSong(null, 10);
    scrub(-3);
    expect(transport.currentTime).toBe(0);
    scrub(999);
    expect(transport.currentTime).toBe(10);
  });

  it("silences during the drag and resumes from the release position", async () => {
    resetForSong(null, 30);
    toggleSource("mix", "/song.wav");
    await settleDecodes(30);

    scrubStart();
    expect(transport.playing).toBe(false);
    scrub(12);
    expect(transport.currentTime).toBe(12);
    scrubEnd();
    await settleDecodes();
    expect(transport.playing).toBe(true);
    expect(ctx!.sources.at(-1)!.startedAt).toBe(12);
  });

  it("stays paused after a scrub that started while paused", () => {
    resetForSong(null, 10);
    scrub(4);
    scrubStart();
    scrubEnd();
    expect(transport.playing).toBe(false);
    expect(transport.currentTime).toBe(4);
  });
});

describe("rate and source switching", () => {
  it("setRate while paused only records the rate", () => {
    setRate(1.5);
    expect(transport.rate).toBe(1.5);
    expect(transport.playing).toBe(false);
  });

  it("setRate while playing restarts the source at the current position", async () => {
    resetForSong(null, 30);
    toggleSource("mix", "/song.wav");
    await settleDecodes(30);
    ctx!.currentTime = 4;
    setRate(2);
    expect(transport.playing).toBe(true);
    const restarted = ctx!.sources.at(-1)!;
    expect(restarted.startedAt).toBe(4);
    expect(restarted.playbackRate.value).toBe(2);
  });

  it("switchSource while paused retargets without starting playback", async () => {
    resetForSong(null, 5);
    switchSource("eng::bass", "/bass.wav");
    expect(transport.activeKey).toBe("eng::bass");
    expect(transport.playing).toBe(false);
    await settleDecodes(21);
    expect(transport.durationSec).toBe(21);
    expect(transport.playing).toBe(false);
  });
});
