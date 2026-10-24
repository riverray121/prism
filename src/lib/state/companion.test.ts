import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/companion/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/companion/client")>()),
  getInfo: vi.fn(),
  listRequests: vi.fn(() => Promise.resolve([])),
  listShows: vi.fn(() => Promise.resolve([])),
  patchRequest: vi.fn(),
}));
vi.mock("$lib/ipc", () => ({
  importRequest: vi.fn(() => Promise.resolve()),
  queueAnalysis: vi.fn(() => Promise.resolve()),
  getProfile: vi.fn(() => Promise.resolve()),
  getMapping: vi.fn(() => Promise.resolve()),
  updateMapping: vi.fn(() => Promise.resolve()),
  pullShow: vi.fn(() => Promise.resolve()),
  publishShow: vi.fn(() => Promise.resolve()),
  writeShowFrames: vi.fn(() => Promise.resolve()),
  clearShowFrames: vi.fn(() => Promise.resolve()),
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(() => Promise.resolve("0.1.0")),
}));

import * as client from "$lib/companion/client";
import * as ipc from "$lib/ipc";
import { library } from "$lib/state/library.svelte";
import { settings } from "$lib/state/settings.svelte";

import {
  applyPullResult,
  checkConnection,
  companion,
  endpoint,
  importRequest,
  pull,
  pullableShows,
  pulling,
  refreshRequests,
  rejectRequest,
} from "./companion.svelte";

const getInfo = vi.mocked(client.getInfo);
const listRequests = vi.mocked(client.listRequests);
const listShows = vi.mocked(client.listShows);
const patchRequest = vi.mocked(client.patchRequest);

const open = {
  id: "r1",
  title: "Dior",
  artist: "Joji",
  external: { spotify_uri: "spotify:track:x" },
  requested_at: "2026-09-11T00:00:00Z",
  status: "open" as const,
};

beforeEach(() => {
  getInfo.mockReset();
  listRequests.mockReset();
  listRequests.mockResolvedValue([]);
  listShows.mockReset();
  listShows.mockResolvedValue([]);
  patchRequest.mockReset();
  library.songs = [];
  pulling.showId = null;
  pulling.error = null;
  vi.mocked(ipc.importRequest).mockClear();
  companion.requests = [];
  settings.companionUrl = "";
  settings.companionToken = "";
  settings.loaded = true;
  companion.status = "off";
  companion.info = null;
  companion.error = null;
});

describe("checkConnection", () => {
  it("is off with no URL configured and never calls the companion", async () => {
    await checkConnection();
    expect(companion.status).toBe("off");
    expect(getInfo).not.toHaveBeenCalled();
    expect(endpoint()).toBeNull();
  });

  it("is connected when info answers with the matching API version", async () => {
    settings.companionUrl = "http://pi:8760";
    settings.companionToken = "tok";
    getInfo.mockResolvedValueOnce({
      name: "prism-player",
      version: "0.1.0",
      api: 1,
    });
    await checkConnection();
    expect(companion.status).toBe("connected");
    expect(companion.info?.name).toBe("prism-player");
    expect(getInfo).toHaveBeenCalledWith({
      url: "http://pi:8760",
      token: "tok",
    });
  });

  it("is incompatible on another API version", async () => {
    settings.companionUrl = "http://pi:8760";
    getInfo.mockResolvedValueOnce({ name: "x", version: "9", api: 2 });
    await checkConnection();
    expect(companion.status).toBe("incompatible");
  });

  it("is unauthorized on 401 and unreachable otherwise", async () => {
    settings.companionUrl = "http://pi:8760";
    getInfo.mockRejectedValueOnce(new client.CompanionError("bad token", 401));
    await checkConnection();
    expect(companion.status).toBe("unauthorized");
    getInfo.mockRejectedValueOnce(new client.CompanionError("refused", null));
    await checkConnection();
    expect(companion.status).toBe("unreachable");
    expect(companion.error).toBe("refused");
  });

  it("drops a stale result when a newer check started", async () => {
    settings.companionUrl = "http://old:1";
    let resolveOld: (v: client.CompanionInfo) => void = () => {};
    getInfo.mockImplementationOnce(() => new Promise((r) => (resolveOld = r)));
    const first = checkConnection();
    settings.companionUrl = "http://new:1";
    getInfo.mockRejectedValueOnce(new client.CompanionError("refused", null));
    await checkConnection();
    resolveOld({ name: "old", version: "0", api: 1 });
    await first;
    expect(companion.status).toBe("unreachable");
  });
});

describe("requests", () => {
  beforeEach(async () => {
    settings.companionUrl = "http://pi:8760";
    settings.companionToken = "tok";
    getInfo.mockResolvedValue({ name: "p", version: "0", api: 1 });
  });

  it("loads open requests on connect and drops the others", async () => {
    listRequests.mockResolvedValue([
      open,
      { ...open, id: "r2", status: "analyzing" },
    ]);
    await checkConnection();
    expect(companion.requests.map((r) => r.id)).toEqual(["r1"]);
  });

  it("keeps the last list when a refresh fails", async () => {
    listRequests.mockResolvedValue([open]);
    await checkConnection();
    listRequests.mockRejectedValueOnce(new Error("down"));
    await refreshRequests();
    expect(companion.requests).toHaveLength(1);
  });

  it("import sends the sidecar command and marks the request analyzing", async () => {
    listRequests.mockResolvedValue([open]);
    await checkConnection();
    patchRequest.mockResolvedValueOnce({ ...open, status: "analyzing" });
    await importRequest(open);
    expect(companion.requests).toEqual([]);
    expect(ipc.importRequest).toHaveBeenCalledWith(open, 1);
    expect(patchRequest).toHaveBeenCalledWith(
      { url: "http://pi:8760", token: "tok" },
      "r1",
      { status: "analyzing" },
    );
  });

  it("reject marks the request and restores the list if that fails", async () => {
    listRequests.mockResolvedValue([open]);
    await checkConnection();
    patchRequest.mockRejectedValueOnce(new client.CompanionError("x", 500));
    await rejectRequest(open);
    expect(patchRequest).toHaveBeenCalledWith(expect.anything(), "r1", {
      status: "rejected",
    });
    expect(companion.requests).toHaveLength(1);
  });

  it("clears requests when the companion is removed", async () => {
    listRequests.mockResolvedValue([open]);
    await checkConnection();
    settings.companionUrl = "";
    await checkConnection();
    expect(companion.requests).toEqual([]);
  });
});

describe("shows", () => {
  const show = {
    id: "s1",
    title: "Dior",
    artist: "Joji",
    duration_s: 200,
    frame_rate_hz: 40,
    light_count: 2,
    updated_at: "2026-09-11T12:00:00Z",
  };
  const song = {
    id: "s1",
    title: "Dior",
    artist: "Joji",
    duration_sec: 200,
    sample_rate: 48000,
    source_path: "songs/s1/source.flac",
    status: "analyzed",
    imported_at: "x",
    analyzed_at: null,
    current_stage: null,
    current_engine: null,
    current_step: null,
    total_steps: null,
    progress: null,
    error_message: null,
    request_id: null,
    published_at: null,
  };

  beforeEach(async () => {
    settings.companionUrl = "http://pi:8760";
    getInfo.mockResolvedValue({ name: "p", version: "0", api: 1 });
    listShows.mockResolvedValue([show]);
    await checkConnection();
  });

  it("lists a show missing from the library as pullable", () => {
    expect(pullableShows()).toEqual([{ show, local: false }]);
  });

  it("lists a local song only when the companion copy is newer", () => {
    library.songs = [{ ...song, published_at: "2026-09-11T11:00:00Z" }];
    expect(pullableShows()).toEqual([{ show, local: true }]);
    library.songs = [{ ...song, published_at: "2026-09-11T12:00:00Z" }];
    expect(pullableShows()).toEqual([]);
  });

  it("pull sends the command and clears on the result", async () => {
    await pull("s1");
    expect(ipc.pullShow).toHaveBeenCalledWith("s1");
    expect(pulling.showId).toBe("s1");
    applyPullResult("s1", false, "boom");
    expect(pulling.showId).toBeNull();
    expect(pulling.error).toBe("boom");
  });
});
