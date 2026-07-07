import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile, SidecarEvent, Song } from "$lib/ipc/messages";

// The reducer is exercised through the public session API: onSidecarEvent is
// mocked to capture the handler startSidecarSession attaches, and tests feed
// events straight into it. Attachment resolution is manual so the start/stop
// generation guards can be driven through their race windows.
const ipc = vi.hoisted(() => ({
  onSidecarEvent: vi.fn(),
  listLibrary: vi.fn(),
  getSettings: vi.fn(),
  getProfile: vi.fn(),
  updateFavorites: vi.fn(),
}));
vi.mock("$lib/ipc", () => ipc);

const transport = vi.hoisted(() => ({
  resetForSong: vi.fn(),
  switchSource: vi.fn(),
  toggleSource: vi.fn(),
}));
vi.mock("$lib/state/transport.svelte", () => transport);

import { inspection } from "./inspection.svelte";
import { library } from "./library.svelte";
import { settings } from "./settings.svelte";
import { startSidecarSession, stopSidecarSession } from "./sidecar";

type Handler = (event: SidecarEvent) => void;
// One entry per onSidecarEvent call: the handler passed in, plus the resolver
// that completes the attachment promise.
let attachments: Array<{ handler: Handler; attach: (d: () => void) => void }>;

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// Start a session and complete its attachment, returning the live handler.
async function startAttached(): Promise<Handler> {
  startSidecarSession();
  const { handler, attach } = attachments.at(-1)!;
  attach(vi.fn());
  await flush();
  return handler;
}

const song: Song = {
  id: "s1",
  title: "Title",
  artist: "Artist",
  duration_sec: 10,
  sample_rate: 44100,
  source_path: "/music/t.wav",
  status: "analyzed",
  imported_at: "2026-01-01",
  analyzed_at: null,
  current_stage: null,
  current_engine: null,
  current_step: null,
  total_steps: null,
  error_message: null,
};

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    schema_version: "0.3.0",
    song: {
      id: "s1",
      title: "Title",
      artist: "Artist",
      duration_sec: 12.5,
      sample_rate: 44100,
      source_file: "t.wav",
      imported_at: "2026-01-01",
      analyzed_at: "2026-01-02",
    },
    timeline: { frame_rate_hz: 50, frame_count: 625 },
    mix: {
      tempo: {
        render: "scalar",
        category: "rhythm",
        source: "librosa",
        unit: "bpm",
        value: 120,
      },
    },
    stems: {},
    favorites: [],
    ...overrides,
  };
}

function profileEvent(profile: Profile, songId = "s1"): SidecarEvent {
  return {
    type: "profile",
    song_id: songId,
    profile,
    audio_path: "/music/t.wav",
    song_dir: "/library/s1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  attachments = [];
  ipc.onSidecarEvent.mockImplementation(
    (handler: Handler) =>
      new Promise<() => void>((attach) => {
        attachments.push({ handler, attach });
      }),
  );
  library.songs = [];
  library.lastImportError = null;
  library.pendingImports = [];
  inspection.songId = null;
  inspection.profile = null;
  inspection.audioPath = null;
  inspection.songDir = null;
  settings.loaded = false;
});

afterEach(() => {
  stopSidecarSession();
});

describe("applySidecarEvent", () => {
  it("replaces the library from a songs snapshot", async () => {
    const handler = await startAttached();
    handler({ type: "library.songs", songs: [song] });
    expect(library.songs).toEqual([song]);
  });

  it("records the latest import failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = await startAttached();
    handler({ type: "library.import_failed", path: "/x.wav", error: "boom" });
    expect(library.lastImportError).toEqual({ path: "/x.wav", error: "boom" });
    errorSpy.mockRestore();
  });

  it("tracks the import lifecycle in pendingImports", async () => {
    const handler = await startAttached();
    handler({ type: "library.import_started", path: "url-a" });
    handler({ type: "library.import_started", path: "url-b" });
    expect(library.pendingImports).toEqual(["url-a", "url-b"]);
    handler({ type: "library.import_finished", path: "url-a" });
    expect(library.pendingImports).toEqual(["url-b"]);
  });

  it("loads a profile for the open song and arms the transport", async () => {
    inspection.songId = "s1";
    const handler = await startAttached();
    const profile = makeProfile();
    handler(profileEvent(profile));
    expect(inspection.profile).toBe(profile);
    expect(inspection.audioPath).toBe("/music/t.wav");
    expect(inspection.songDir).toBe("/library/s1");
    expect(transport.resetForSong).toHaveBeenCalledWith("/music/t.wav", 12.5);
  });

  it("drops a profile for a song no longer open", async () => {
    inspection.songId = "s2";
    const handler = await startAttached();
    handler(profileEvent(makeProfile()));
    expect(inspection.profile).toBeNull();
    expect(inspection.audioPath).toBeNull();
    expect(transport.resetForSong).not.toHaveBeenCalled();
  });

  it("warns on favorites that no longer resolve, without failing the load", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    inspection.songId = "s1";
    const handler = await startAttached();
    const profile = makeProfile({ favorites: ["mix.tempo", "mix.gone"] });
    handler(profileEvent(profile));
    expect(inspection.profile).toBe(profile);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]).toContain("mix.gone");
    warnSpy.mockRestore();
  });

  it("applies a settings snapshot and marks settings loaded", async () => {
    const handler = await startAttached();
    handler({
      type: "settings",
      engines: ["htdemucs_ft"],
      available_engines: ["htdemucs_ft", "mel_band_roformer"],
      engine_info: {
        htdemucs_ft: { label: "Demucs", drums: true },
        mel_band_roformer: { label: "Roformer", drums: false },
      },
      drum_subsep: true,
    });
    expect(settings.engines).toEqual(["htdemucs_ft"]);
    expect(settings.availableEngines).toEqual([
      "htdemucs_ft",
      "mel_band_roformer",
    ]);
    expect(settings.engineInfo.htdemucs_ft).toEqual({
      label: "Demucs",
      drums: true,
    });
    expect(settings.drumSubsep).toBe(true);
    expect(settings.loaded).toBe(true);
  });
});

describe("session lifecycle", () => {
  it("requests library and settings once attached", async () => {
    await startAttached();
    expect(ipc.listLibrary).toHaveBeenCalledTimes(1);
    expect(ipc.getSettings).toHaveBeenCalledTimes(1);
  });

  it("a stop during attachment detaches the late listener and sends nothing", async () => {
    startSidecarSession();
    stopSidecarSession();
    const detach = vi.fn();
    attachments[0].attach(detach);
    await flush();
    expect(detach).toHaveBeenCalledTimes(1);
    expect(ipc.listLibrary).not.toHaveBeenCalled();
  });

  it("a newer start supersedes one still attaching", async () => {
    startSidecarSession();
    startSidecarSession();
    const detach1 = vi.fn();
    const detach2 = vi.fn();
    attachments[0].attach(detach1);
    attachments[1].attach(detach2);
    await flush();
    expect(detach1).toHaveBeenCalledTimes(1);
    expect(detach2).not.toHaveBeenCalled();
    expect(ipc.listLibrary).toHaveBeenCalledTimes(1);
  });

  it("stop detaches the live listener", async () => {
    startSidecarSession();
    const detach = vi.fn();
    attachments[0].attach(detach);
    await flush();
    stopSidecarSession();
    expect(detach).toHaveBeenCalledTimes(1);
  });
});
