import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/ipc", () => ({
  getRig: vi.fn(() => Promise.resolve()),
  updateRig: vi.fn(() => Promise.resolve()),
  updateMapping: vi.fn(() => Promise.resolve()),
  ddpSend: vi.fn(() => Promise.resolve()),
  discoverySnapshot: vi.fn(() => Promise.resolve([])),
}));

vi.mock("$lib/hardware/wled", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/hardware/wled")>()),
  fetchHub: vi.fn(),
  setHubPower: vi.fn(() => Promise.resolve()),
}));

import * as ipc from "$lib/ipc";
import * as wled from "$lib/hardware/wled";
import type { RigHub } from "$lib/hardware/wled";
import type { ProgramOutput } from "$lib/mapping/evaluate";
import { emptyMappingDoc, MappingDocSchema } from "$lib/mapping/schema";

import {
  applyHubSeen,
  applyRigEvent,
  connectHub,
  forgetHub,
  hardware,
  markHubOffline,
  probe,
  probeAddress,
  scan,
  startScan,
  stopStream,
  streamTick,
} from "./hardware.svelte";
import {
  applyMappingEvent,
  mapping,
  resetMappingForSong,
  setPatch,
} from "./mapping.svelte";

const updateRig = vi.mocked(ipc.updateRig);
const ddpSend = vi.mocked(ipc.ddpSend);
const setHubPower = vi.mocked(wled.setHubPower);
const fetchHub = vi.mocked(wled.fetchHub);

function benchHub(overrides: Partial<RigHub> = {}): RigHub {
  return {
    mac: "a842e39b1c60",
    name: "WLED",
    ip: "192.168.0.84",
    lights: [{ id: "a842e39b1c60:0", name: "Strip", pixel_count: 300 }],
    ...overrides,
  };
}

beforeEach(() => {
  applyRigEvent({ hubs: [] });
  hardware.discovered = [];
  hardware.online = {};
  updateRig.mockClear();
});

describe("rig event", () => {
  it("loads the persisted rig", () => {
    applyRigEvent({ hubs: [benchHub({ name: "Desk hub" })] });
    expect(hardware.rigLoaded).toBe(true);
    expect(hardware.rig.hubs[0].name).toBe("Desk hub");
  });
});

describe("discovery merge", () => {
  it("an unknown hub queues under discovered, online", () => {
    applyHubSeen(benchHub());
    expect(hardware.discovered).toHaveLength(1);
    expect(hardware.rig.hubs).toHaveLength(0);
    expect(hardware.online["a842e39b1c60"]).toBe(true);
    expect(updateRig).not.toHaveBeenCalled();
  });

  it("re-announcements replace, not duplicate, a discovered hub", () => {
    applyHubSeen(benchHub());
    applyHubSeen(benchHub({ ip: "192.168.0.90" }));
    expect(hardware.discovered).toHaveLength(1);
    expect(hardware.discovered[0].ip).toBe("192.168.0.90");
  });

  it("a known hub merges by MAC: IP refreshes and persists", () => {
    applyRigEvent({ hubs: [benchHub({ name: "Desk hub" })] });
    applyHubSeen(benchHub({ ip: "192.168.0.99" }));
    expect(hardware.rig.hubs[0].ip).toBe("192.168.0.99");
    expect(hardware.discovered).toHaveLength(0);
    expect(hardware.online["a842e39b1c60"]).toBe(true);
    expect(updateRig).toHaveBeenCalledTimes(1);
    expect((updateRig.mock.calls[0][0] as { hubs: RigHub[] }).hubs[0].ip).toBe(
      "192.168.0.99",
    );
  });

  it("light config refreshes from the device but user names survive", () => {
    applyRigEvent({ hubs: [benchHub({ name: "Desk hub" })] });
    applyHubSeen(
      benchHub({
        lights: [
          { id: "a842e39b1c60:0", name: "WLED", pixel_count: 450 },
          { id: "a842e39b1c60:1", name: "Output 2", pixel_count: 120 },
        ],
      }),
    );
    expect(hardware.rig.hubs[0].lights).toEqual([
      { id: "a842e39b1c60:0", name: "Strip", pixel_count: 450 },
      { id: "a842e39b1c60:1", name: "Output 2", pixel_count: 120 },
    ]);
    expect(updateRig).toHaveBeenCalledTimes(1);
  });

  it("an unchanged known hub does not rewrite the rig", () => {
    applyRigEvent({ hubs: [benchHub()] });
    applyHubSeen(benchHub());
    expect(updateRig).not.toHaveBeenCalled();
  });
});

describe("connect and forget", () => {
  it("connect moves a discovered hub into the rig under the given name", () => {
    applyHubSeen(benchHub());
    connectHub("a842e39b1c60", "Desk hub");
    expect(hardware.discovered).toHaveLength(0);
    expect(hardware.rig.hubs[0].name).toBe("Desk hub");
    expect(updateRig).toHaveBeenCalledTimes(1);
  });

  it("forget drops a hub from the rig; a reachable one is rediscoverable", () => {
    applyHubSeen(benchHub());
    connectHub("a842e39b1c60", "Desk hub");
    forgetHub("a842e39b1c60");
    expect(hardware.rig.hubs).toHaveLength(0);
    expect(hardware.discovered).toHaveLength(1);
    expect(updateRig).toHaveBeenCalledTimes(2);
  });

  it("lost hubs flip offline and leave the discovered list", () => {
    applyHubSeen(benchHub());
    markHubOffline("a842e39b1c60");
    expect(hardware.online["a842e39b1c60"]).toBe(false);
    expect(hardware.discovered).toHaveLength(0);
  });
});

describe("scan window", () => {
  it("scanning stays active for the window, then times out", () => {
    vi.useFakeTimers();
    try {
      startScan();
      expect(scan.active).toBe(true);
      vi.advanceTimersByTime(14_000);
      expect(scan.active).toBe(true);
      vi.advanceTimersByTime(2_000);
      expect(scan.active).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("manual probe (Add by IP)", () => {
  it("a working address is treated as a discovery", async () => {
    fetchHub.mockResolvedValueOnce(benchHub());
    await probeAddress("192.168.0.84");
    expect(probe.status).toBe("idle");
    expect(hardware.discovered).toHaveLength(1);
    expect(hardware.online["a842e39b1c60"]).toBe(true);
  });

  it("an unreachable address reports failure without touching state", async () => {
    fetchHub.mockRejectedValueOnce(new Error("timeout"));
    await probeAddress("10.0.0.9");
    expect(probe.status).toBe("failed");
    expect(probe.ip).toBe("10.0.0.9");
    expect(hardware.discovered).toHaveLength(0);
  });

  it("a probed known hub merges into the rig (offline recovery)", async () => {
    applyRigEvent({
      hubs: [benchHub({ name: "Desk hub", ip: "192.168.0.2" })],
    });
    fetchHub.mockResolvedValueOnce(benchHub({ ip: "192.168.0.84" }));
    await probeAddress("192.168.0.84");
    expect(hardware.rig.hubs[0].ip).toBe("192.168.0.84");
    expect(hardware.online["a842e39b1c60"]).toBe(true);
    expect(hardware.discovered).toHaveLength(0);
  });
});

describe("streaming", () => {
  const FRAMES = 200;
  const N = 4;

  // A pixel-program output whose bytes encode their own index, so the frame
  // actually sent is verifiable.
  function pixelOutput(): ProgramOutput {
    const rgb = new Uint8ClampedArray(FRAMES * N * 3);
    for (let i = 0; i < rgb.length; i++) rgb[i] = i % 251;
    return {
      key: "k",
      channels: {},
      gate: null,
      pixels: { pixelCount: N, rgb },
    };
  }

  function openPatchedSong(): void {
    applyRigEvent({
      hubs: [
        benchHub({
          lights: [{ id: "a842e39b1c60:0", name: "Strip", pixel_count: N }],
        }),
      ],
    });
    hardware.online["a842e39b1c60"] = true;
    resetMappingForSong("s1");
    applyMappingEvent(
      "s1",
      MappingDocSchema.parse({
        song_id: "s1",
        programs: [{ id: "pulse" }],
        patch: { "a842e39b1c60:0": "pulse" },
      }),
    );
  }

  beforeEach(async () => {
    stopStream(); // reset the per-run streamed set between tests
    // Let its async blackout → power-off chain settle before clearing, so a
    // late power-off can't leak into the next test's call counts.
    await Promise.resolve();
    await Promise.resolve();
    ddpSend.mockClear();
    setHubPower.mockClear();
  });

  it("a tick sends the playhead's frame to the patched hub", () => {
    const output = pixelOutput();
    openPatchedSong();
    streamTick(1.0, 100, FRAMES, { pulse: output }); // frame 100
    expect(ddpSend).toHaveBeenCalledTimes(1);
    const [address, port, data] = ddpSend.mock.calls[0];
    expect(address).toBe("192.168.0.84");
    expect(port).toBe(4048);
    expect(data.slice(10)).toEqual([
      ...output.pixels!.rgb.slice(100 * N * 3, 101 * N * 3),
    ]);
  });

  it("the first frame to a hub powers it on, once", () => {
    const outputs = { pulse: pixelOutput() };
    openPatchedSong();
    streamTick(0, 100, FRAMES, outputs);
    streamTick(0.1, 100, FRAMES, outputs);
    expect(setHubPower).toHaveBeenCalledTimes(1);
    expect(setHubPower).toHaveBeenCalledWith("192.168.0.84", true);
  });

  it("a program without a pixel matrix streams a solid whole-strip frame", () => {
    openPatchedSong();
    streamTick(0, 100, FRAMES, {
      pulse: { key: "k", channels: {}, gate: null, pixels: null },
    });
    const [, , data] = ddpSend.mock.calls[0];
    const payload = data.slice(10);
    expect(payload).toHaveLength(N * 3);
    // Unbound channels = full-brightness warm white: every pixel identical, lit.
    expect(payload[0]).toBeGreaterThan(0);
    for (let p = 1; p < N; p++) {
      expect(payload.slice(p * 3, p * 3 + 3)).toEqual(payload.slice(0, 3));
    }
  });

  it("a stale matrix at the wrong pixel count is skipped, not streamed", () => {
    const output = pixelOutput();
    output.pixels!.pixelCount = 60; // evaluation not yet re-run for the patch
    openPatchedSong();
    streamTick(0, 100, FRAMES, { pulse: output });
    expect(ddpSend).not.toHaveBeenCalled();
  });

  it("stop sends one all-zeros frame, then powers the hub off", async () => {
    openPatchedSong();
    streamTick(1.0, 100, FRAMES, { pulse: pixelOutput() });
    ddpSend.mockClear();
    stopStream();
    expect(ddpSend).toHaveBeenCalledTimes(1);
    const [, , data] = ddpSend.mock.calls[0];
    expect(data.slice(10)).toEqual(new Array(N * 3).fill(0));
    await vi.waitFor(() => {
      expect(setHubPower).toHaveBeenCalledWith("192.168.0.84", false);
    });
    // Blackout hit the wire before power-off.
    expect(ddpSend.mock.invocationCallOrder[0]).toBeLessThan(
      setHubPower.mock.invocationCallOrder[1],
    );
  });

  it("stop skips hubs that dropped offline mid-run", () => {
    openPatchedSong();
    streamTick(0, 100, FRAMES, { pulse: pixelOutput() });
    markHubOffline("a842e39b1c60");
    ddpSend.mockClear();
    setHubPower.mockClear();
    stopStream();
    expect(ddpSend).not.toHaveBeenCalled();
    expect(setHubPower).not.toHaveBeenCalled();
  });
});

describe("patch actions", () => {
  it("links and unlinks a light through the mapping doc", () => {
    resetMappingForSong("s1");
    applyMappingEvent("s1", emptyMappingDoc("s1"));
    setPatch("a842e39b1c60:0", "pulse");
    expect(mapping.doc?.patch).toEqual({ "a842e39b1c60:0": "pulse" });
    setPatch("a842e39b1c60:0", null);
    expect(mapping.doc?.patch).toEqual({});
    resetMappingForSong(null);
  });
});
