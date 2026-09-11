import {
  COMPANION_API_VERSION,
  CompanionError,
  getInfo,
  type CompanionInfo,
  type Endpoint,
} from "$lib/companion/client";
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
}>({ status: "off", info: null, error: null });

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
