import { fetch } from "@tauri-apps/plugin-http";
import { z } from "zod";

// Client for the Companion API (docs/companion-api.md). Pure request wrappers
// with zod-validated responses; connection state lives in state/companion.

export const InfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  api: z.number().int(),
});
export type CompanionInfo = z.infer<typeof InfoSchema>;

export const RequestStatusSchema = z.enum([
  "open",
  "analyzing",
  "published",
  "rejected",
]);
export type RequestStatus = z.infer<typeof RequestStatusSchema>;

export const RequestSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  external: z.record(z.string(), z.string()).default({}),
  requested_at: z.string(),
  status: RequestStatusSchema,
  show_id: z.string().nullable().optional(),
});
export type CompanionRequest = z.infer<typeof RequestSchema>;

export const ShowSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  duration_s: z.number(),
  frame_rate_hz: z.number(),
  light_count: z.number().int(),
  updated_at: z.string(),
  request_id: z.string().nullable().optional(),
});
export type ShowSummary = z.infer<typeof ShowSummarySchema>;

// The API version this client speaks; a companion reporting another is refused.
export const COMPANION_API_VERSION = 1;

export class CompanionError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message);
  }
}

export interface Endpoint {
  url: string;
  token: string;
}

async function call<T>(
  endpoint: Endpoint,
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${endpoint.url}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${endpoint.token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      connectTimeout: 5_000,
    });
  } catch (e) {
    throw new CompanionError(String(e), null);
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {
      // Non-JSON error body; the status is the message.
    }
    throw new CompanionError(message, res.status);
  }
  return schema.parse(await res.json());
}

export function getInfo(endpoint: Endpoint): Promise<CompanionInfo> {
  return call(endpoint, "/v1/info", InfoSchema);
}

export async function listRequests(
  endpoint: Endpoint,
): Promise<CompanionRequest[]> {
  const body = await call(
    endpoint,
    "/v1/requests",
    z.object({ requests: z.array(RequestSchema) }),
  );
  return body.requests;
}

export function patchRequest(
  endpoint: Endpoint,
  id: string,
  update: { status: RequestStatus; show_id?: string },
): Promise<CompanionRequest> {
  return call(endpoint, `/v1/requests/${id}`, RequestSchema, {
    method: "PATCH",
    body: JSON.stringify(update),
  });
}

export async function listShows(endpoint: Endpoint): Promise<ShowSummary[]> {
  const body = await call(
    endpoint,
    "/v1/shows",
    z.object({ shows: z.array(ShowSummarySchema) }),
  );
  return body.shows;
}
