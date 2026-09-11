import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/companion/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/companion/client")>()),
  getInfo: vi.fn(),
  listRequests: vi.fn(() => Promise.resolve([])),
  patchRequest: vi.fn(),
}));
vi.mock("$lib/ipc", () => ({
  importRequest: vi.fn(() => Promise.resolve()),
}));

import * as client from "$lib/companion/client";
import * as ipc from "$lib/ipc";
import { settings } from "$lib/state/settings.svelte";

import {
  checkConnection,
  companion,
  endpoint,
  importRequest,
  refreshRequests,
  rejectRequest,
} from "./companion.svelte";

const getInfo = vi.mocked(client.getInfo);
const listRequests = vi.mocked(client.listRequests);
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
  patchRequest.mockReset();
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
    expect(ipc.importRequest).toHaveBeenCalledWith(open);
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
