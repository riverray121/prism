import { describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: unknown[]) => fetchMock(...args),
}));

import {
  CompanionError,
  getInfo,
  InfoSchema,
  listRequests,
  patchRequest,
  RequestSchema,
  ShowSummarySchema,
} from "./client";

const endpoint = { url: "http://pi:8760", token: "tok" };

function reply(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("schemas", () => {
  it("parse the documented shapes", () => {
    expect(InfoSchema.parse({ name: "p", version: "0.1.0", api: 1 }).api).toBe(
      1,
    );
    const req = RequestSchema.parse({
      id: "r1",
      title: "Dior",
      artist: "Joji",
      requested_at: "2026-09-11T00:00:00Z",
      status: "open",
    });
    expect(req.external).toEqual({});
    expect(
      ShowSummarySchema.parse({
        id: "s",
        title: "t",
        artist: "a",
        duration_s: 1.5,
        frame_rate_hz: 40,
        light_count: 2,
        updated_at: "now",
      }).light_count,
    ).toBe(2);
  });
});

describe("calls", () => {
  it("sends the bearer token and parses info", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(200, { name: "prism-player", version: "0.1.0", api: 1 }),
    );
    const info = await getInfo(endpoint);
    expect(info.name).toBe("prism-player");
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("http://pi:8760/v1/info");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("surfaces the status and error body on failure", async () => {
    fetchMock.mockResolvedValueOnce(reply(401, { error: "bad token" }));
    await expect(getInfo(endpoint)).rejects.toMatchObject({
      status: 401,
      message: "bad token",
    });
  });

  it("wraps a network failure with a null status", async () => {
    fetchMock.mockRejectedValueOnce(new Error("refused"));
    const err = await getInfo(endpoint).catch((e) => e);
    expect(err).toBeInstanceOf(CompanionError);
    expect(err.status).toBeNull();
  });

  it("unwraps request lists and patches with a JSON body", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(200, {
        requests: [
          {
            id: "r1",
            title: "t",
            artist: "a",
            requested_at: "x",
            status: "open",
          },
        ],
      }),
    );
    expect(await listRequests(endpoint)).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(
      reply(200, {
        id: "r1",
        title: "t",
        artist: "a",
        requested_at: "x",
        status: "analyzing",
      }),
    );
    const patched = await patchRequest(endpoint, "r1", {
      status: "analyzing",
    });
    expect(patched.status).toBe("analyzing");
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("http://pi:8760/v1/requests/r1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ status: "analyzing" });
  });
});
