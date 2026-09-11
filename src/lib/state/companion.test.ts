import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/companion/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/companion/client")>()),
  getInfo: vi.fn(),
}));

import * as client from "$lib/companion/client";
import { settings } from "$lib/state/settings.svelte";

import { checkConnection, companion, endpoint } from "./companion.svelte";

const getInfo = vi.mocked(client.getInfo);

beforeEach(() => {
  getInfo.mockReset();
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
