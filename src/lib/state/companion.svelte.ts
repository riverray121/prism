import {
  COMPANION_API_VERSION,
  CompanionError,
  getInfo,
  listRequests,
  patchRequest,
  type CompanionInfo,
  type CompanionRequest,
  type Endpoint,
} from "$lib/companion/client";
import { importRequest as sendImportRequest } from "$lib/ipc";
import { settings } from "$lib/state/settings.svelte";

// Connection to the one configured companion (docs/companion-api.md).
// `off` means no URL is set; every other status is the result of the last
// /v1/info call. Downstream of settings only, so the state module graph stays
// acyclic.
export type CompanionStatus =
  | "off"
  | "connecting"
  | "connected"
  | "unauthorized"
  | "incompatible"
  | "unreachable";

export const companion = $state<{
  status: CompanionStatus;
  info: CompanionInfo | null;
  error: string | null;
  // Open requests from the last refresh, newest first. Requests in any other
  // status are not kept: the UI only offers open ones.
  requests: CompanionRequest[];
}>({ status: "off", info: null, error: null, requests: [] });

const RETRY_MS = 60_000;

export function endpoint(): Endpoint | null {
  if (settings.companionUrl === "") return null;
  return { url: settings.companionUrl, token: settings.companionToken };
}

// Serializes checks: a check started for one endpoint must not overwrite the
// result of a check for a newer endpoint.
let checkGeneration = 0;

export async function checkConnection(): Promise<void> {
  const target = endpoint();
  const gen = ++checkGeneration;
  if (target === null) {
    companion.status = "off";
    companion.info = null;
    companion.error = null;
    companion.requests = [];
    return;
  }
  companion.status = "connecting";
  try {
    const info = await getInfo(target);
    if (gen !== checkGeneration) return;
    if (info.api !== COMPANION_API_VERSION) {
      companion.status = "incompatible";
      companion.info = info;
      companion.error = `companion speaks API ${info.api}, this Prism speaks ${COMPANION_API_VERSION}`;
      return;
    }
    companion.status = "connected";
    companion.info = info;
    companion.error = null;
    await refreshRequests();
  } catch (e) {
    if (gen !== checkGeneration) return;
    companion.info = null;
    if (e instanceof CompanionError && e.status === 401) {
      companion.status = "unauthorized";
      companion.error = e.message;
    } else {
      companion.status = "unreachable";
      companion.error = e instanceof Error ? e.message : String(e);
    }
  }
}

// Pull the open requests. Only meaningful while connected; a failure keeps the
// last list (the connection check reports reachability).
export async function refreshRequests(): Promise<void> {
  const target = endpoint();
  if (target === null || companion.status !== "connected") return;
  try {
    const all = await listRequests(target);
    companion.requests = all.filter((r) => r.status === "open");
  } catch (e) {
    console.warn("companion requests refresh failed", e);
  }
}

// Start the import for a request and mark it analyzing. The request leaves
// the open list at once; the sidecar's import events carry progress.
export async function importRequest(request: CompanionRequest): Promise<void> {
  const target = endpoint();
  if (target === null) return;
  companion.requests = companion.requests.filter((r) => r.id !== request.id);
  await sendImportRequest(request);
  try {
    await patchRequest(target, request.id, { status: "analyzing" });
  } catch (e) {
    console.warn("companion request status update failed", request.id, e);
  }
}

export async function rejectRequest(request: CompanionRequest): Promise<void> {
  const target = endpoint();
  if (target === null) return;
  companion.requests = companion.requests.filter((r) => r.id !== request.id);
  try {
    await patchRequest(target, request.id, { status: "rejected" });
  } catch (e) {
    console.warn("companion request reject failed", request.id, e);
    await refreshRequests();
  }
}

// Session: re-check whenever the configured endpoint changes, and every
// RETRY_MS while one is configured. Hosted by the shell route.
let stopEffects: (() => void) | undefined;
let timer: ReturnType<typeof setInterval> | null = null;

export function startCompanionSession(): void {
  stopCompanionSession();
  stopEffects = $effect.root(() => {
    $effect(() => {
      // Reading both fields registers them as dependencies.
      void settings.companionUrl;
      void settings.companionToken;
      if (!settings.loaded) return;
      void checkConnection();
    });
  });
  timer = setInterval(() => {
    if (endpoint() !== null) void checkConnection();
  }, RETRY_MS);
}

export function stopCompanionSession(): void {
  stopEffects?.();
  stopEffects = undefined;
  if (timer !== null) clearInterval(timer);
  timer = null;
  checkGeneration++;
}
