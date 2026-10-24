import {
  COMPANION_API_VERSION,
  CompanionError,
  getInfo,
  listRequests,
  listShows,
  patchRequest,
  type CompanionInfo,
  type CompanionRequest,
  type Endpoint,
  type ShowSummary,
} from "$lib/companion/client";
import { getVersion } from "@tauri-apps/api/app";

import { nextAction, roundRobinPatch } from "$lib/companion/automation";
import { autoMap, proposalIsEmpty } from "$lib/mapping/automap";

import {
  buildManifest,
  renderShowFrames,
  showLights,
} from "$lib/companion/bundle";
import {
  clearShowFrames,
  importRequest as sendImportRequest,
  publishShow,
  pullShow,
  queueAnalysis,
  writeShowFrames,
} from "$lib/ipc";
import type { MappingDoc } from "$lib/mapping/schema";
import { currentMatrices, matricesPending } from "$lib/state/evaluation.svelte";
import { hardware, rigLatencyMs } from "$lib/state/hardware.svelte";
import {
  getRawProfile,
  inspection,
  open as openSong,
} from "$lib/state/inspection.svelte";
import { library, songById } from "$lib/state/library.svelte";
import {
  applyAutoMapProposal,
  docIsEmpty,
  flushMappingSave,
  mapping,
  setPatch,
} from "$lib/state/mapping.svelte";
import { settings } from "$lib/state/settings.svelte";
import { tracksPending } from "$lib/state/tracks.svelte";

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
  // Every published show from the last refresh.
  shows: ShowSummary[];
}>({ status: "off", info: null, error: null, requests: [], shows: [] });

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
    companion.shows = [];
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
    await refreshShows();
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

export async function refreshShows(): Promise<void> {
  const target = endpoint();
  if (target === null || companion.status !== "connected") return;
  try {
    companion.shows = await listShows(target);
  } catch (e) {
    console.warn("companion shows refresh failed", e);
  }
}

// Shows worth pulling: not in the library, or published from elsewhere after
// this library's last publish of the same song.
export function pullableShows(): { show: ShowSummary; local: boolean }[] {
  const out: { show: ShowSummary; local: boolean }[] = [];
  for (const show of companion.shows) {
    const song = library.songs.find((s) => s.id === show.id);
    if (!song) {
      out.push({ show, local: false });
    } else if (
      song.published_at === null ||
      Date.parse(show.updated_at) > Date.parse(song.published_at) + 1000
    ) {
      out.push({ show, local: true });
    }
  }
  return out;
}

export const pulling = $state<{
  showId: string | null;
  error: string | null;
}>({ showId: null, error: null });

export async function pull(showId: string): Promise<void> {
  if (pulling.showId !== null || endpoint() === null) return;
  pulling.showId = showId;
  pulling.error = null;
  await pullShow(showId);
}

export function applyPullResult(
  showId: string,
  ok: boolean,
  error: string | null,
): void {
  if (pulling.showId !== showId) return;
  pulling.showId = null;
  pulling.error = ok ? null : (error ?? "pull failed");
}

// Start the import for a request and mark it analyzing. The request leaves
// the open list at once; the sidecar's import events carry progress. With
// `retryOnFailure`, a failed download puts the request back to open so the
// next automation tick tries again; otherwise a failure rejects it.
export async function importRequest(
  request: CompanionRequest,
  retryOnFailure = false,
  attempt = 1,
): Promise<void> {
  const target = endpoint();
  if (target === null) return;
  companion.requests = companion.requests.filter((r) => r.id !== request.id);
  await sendImportRequest(request, attempt);
  try {
    await patchRequest(target, request.id, { status: "analyzing" });
  } catch (e) {
    console.warn("companion request status update failed", request.id, e);
  }
  watchImport(request, retryOnFailure);
}

// Resolve an import's outcome from the library's import events: the key
// leaves pendingImports when the sidecar finishes, and lastImportError names
// it on failure.
function watchImport(request: CompanionRequest, retry: boolean): void {
  const key = `request:${request.id}`;
  const deadline = Date.now() + 10 * 60_000;
  const poll = async () => {
    if (library.pendingImports.includes(key) && Date.now() < deadline) {
      setTimeout(() => void poll(), 2_000);
      return;
    }
    const failed = library.lastImportError?.path === key;
    if (!failed) return;
    const target = endpoint();
    if (target === null) return;
    const status = retry ? "open" : "rejected";
    automation.lastNote = `${retry ? "retrying" : "rejected"}: ${request.title} (${library.lastImportError?.error ?? "import failed"})`;
    try {
      await patchRequest(target, request.id, { status });
    } catch (e) {
      console.warn("companion request status update failed", request.id, e);
    }
    if (retry) await refreshRequests();
  };
  setTimeout(() => void poll(), 3_000);
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

// Publishing the open song: render, hand the frames to the shell, then let
// the sidecar pack and upload. One publish at a time; the result event
// lands through applyPublishResult.
export type PublishStage =
  | "idle"
  | "rendering"
  | "uploading"
  | "done"
  | "failed";

export const publishing = $state<{
  songId: string | null;
  stage: PublishStage;
  error: string | null;
}>({ songId: null, stage: "idle", error: null });

// The open song can publish when a companion is connected and at least one
// rig light is patched to an enabled program.
export function canPublish(): boolean {
  if (companion.status !== "connected") return false;
  if (!inspection.songId || !mapping.doc || !getRawProfile()) return false;
  return showLights(mapping.doc, hardware.rig.hubs).length > 0;
}

export async function publish(): Promise<void> {
  const songId = inspection.songId;
  const profile = getRawProfile();
  const song = songById(songId);
  if (!songId || !profile || !song || !mapping.doc || !canPublish()) return;
  if (
    publishing.songId === songId &&
    (publishing.stage === "rendering" || publishing.stage === "uploading")
  )
    return;
  const doc = $state.snapshot(mapping.doc) as MappingDoc;
  publishing.songId = songId;
  publishing.stage = "rendering";
  publishing.error = null;
  try {
    const { frameCount, lights } = renderShowFrames(
      profile,
      doc,
      $state.snapshot(hardware.rig.hubs),
      currentMatrices(),
    );
    await clearShowFrames(songId);
    for (const rendered of lights) {
      await writeShowFrames(songId, rendered.light.key, rendered.bytes);
    }
    const manifest = buildManifest({
      title: song.title,
      artist: song.artist,
      profile,
      sourceFile: song.source_path.slice(song.source_path.lastIndexOf("/") + 1),
      lights: lights.map((l) => l.light),
      frameCount,
      latencyMs: rigLatencyMs(),
      prismVersion: await getVersion(),
    });
    publishing.stage = "uploading";
    await publishShow(songId, manifest);
  } catch (e) {
    publishing.stage = "failed";
    publishing.error = e instanceof Error ? e.message : String(e);
  }
}

export function applyPublishResult(
  songId: string,
  ok: boolean,
  error: string | null,
): void {
  if (publishing.songId !== songId) return;
  publishing.stage = ok ? "done" : "failed";
  publishing.error = ok ? null : (error ?? "publish failed");
  if (ok) {
    void refreshRequests();
    void refreshShows();
  }
}

// ── Automation ──────────────────────────────────────────────────────────────
// With the setting on and a companion connected, requests are imported,
// analyzed, auto-mapped onto every rig light, and published without a
// person. One step per tick; a song that cannot be processed is skipped with
// a reason and never retried in this session.

export const automation = $state<{
  // The song being processed and what it waits on, for the dialog.
  current: { songId: string; since: number; step: string } | null;
  skipped: Record<string, string>;
  lastNote: string | null;
}>({ current: null, skipped: {}, lastNote: null });

// Import attempts per request id this session. A YouTube download can fail
// once and succeed on retry; the third try takes a different video (the
// sidecar's search plan); a failure after that rejects the request so it
// cannot sit in `analyzing` forever.
const importAttempts = new Map<string, number>();
const IMPORT_ATTEMPTS = 3;

const AUTOMATION_TICK_MS = 10_000;
// Opening a song, loading its tracks, and rendering must finish within this.
const PROCESS_TIMEOUT_MS = 180_000;
// Settle time after doc edits so the evaluation effect requests every track.
const SETTLE_MS = 3_000;

export async function automationTick(): Promise<void> {
  if (!settings.companionAuto || companion.status !== "connected") return;
  if (!library.loaded || !hardware.rigLoaded) return;
  const action = nextAction({
    requests: companion.requests,
    songs: library.songs,
    importsPending: library.pendingImports.some((p) =>
      p.startsWith("request:"),
    ),
    publishing:
      publishing.stage === "rendering" || publishing.stage === "uploading",
    skipped: new Set(Object.keys(automation.skipped)),
  });
  switch (action.kind) {
    case "import": {
      const attempts = (importAttempts.get(action.request.id) ?? 0) + 1;
      importAttempts.set(action.request.id, attempts);
      automation.lastNote = `importing ${action.request.artist} - ${action.request.title}`;
      await importRequest(action.request, attempts < IMPORT_ATTEMPTS, attempts);
      return;
    }
    case "queue":
      automation.lastNote = `queuing analysis for ${action.songIds.length} song(s)`;
      await queueAnalysis(action.songIds);
      return;
    case "process":
      await processSong(action.song.id);
      return;
    case "wait":
      automation.lastNote = action.reason;
      return;
    default:
      if (automation.current === null) automation.lastNote = null;
  }
}

function skip(songId: string, reason: string): void {
  automation.skipped[songId] = reason;
  automation.lastNote = `skipped: ${reason}`;
  automation.current = null;
}

async function processSong(songId: string): Promise<void> {
  const now = Date.now();
  if (automation.current?.songId !== songId) {
    automation.current = { songId, since: now, step: "opening" };
    openSong(songId);
    return;
  }
  const cur = automation.current;
  if (now - cur.since > PROCESS_TIMEOUT_MS) {
    skip(songId, `timed out while ${cur.step}`);
    return;
  }
  const profile = getRawProfile();
  if (inspection.songId !== songId || !profile || mapping.doc === null) {
    cur.step = "loading";
    return;
  }
  const doc = $state.snapshot(mapping.doc) as MappingDoc;
  if (docIsEmpty(doc)) {
    const proposal = autoMap(profile, doc, { intensity: "feature" });
    if (proposalIsEmpty(proposal)) {
      skip(songId, "nothing to auto-map (no usable favorites)");
      return;
    }
    applyAutoMapProposal(proposal);
    cur.step = "mapping";
    cur.since = now;
    return;
  }
  if (Object.keys(doc.patch).length === 0) {
    const patch = roundRobinPatch(doc, $state.snapshot(hardware.rig.hubs));
    if (patch === null) {
      skip(songId, "no rig lights or no enabled programs to patch");
      return;
    }
    for (const [lightId, programId] of Object.entries(patch))
      setPatch(lightId, programId);
    cur.step = "patching";
    cur.since = now;
    return;
  }
  if (
    now - cur.since < SETTLE_MS ||
    tracksPending() > 0 ||
    matricesPending() > 0
  ) {
    cur.step = "loading tracks";
    return;
  }
  if (publishing.songId === songId) {
    if (publishing.stage === "failed") {
      skip(songId, `publish failed: ${publishing.error}`);
      return;
    }
    if (publishing.stage === "done") {
      automation.lastNote = `published ${songById(songId)?.title ?? songId}`;
      automation.current = null;
      return;
    }
    cur.step = "publishing";
    return;
  }
  cur.step = "publishing";
  flushMappingSave();
  await publish();
}

// Session: re-check whenever the configured endpoint changes, and every
// RETRY_MS while one is configured. Hosted by the shell route.
let stopEffects: (() => void) | undefined;
let timer: ReturnType<typeof setInterval> | null = null;
let autoTimer: ReturnType<typeof setInterval> | null = null;

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
  autoTimer = setInterval(() => void automationTick(), AUTOMATION_TICK_MS);
}

export function stopCompanionSession(): void {
  stopEffects?.();
  stopEffects = undefined;
  if (timer !== null) clearInterval(timer);
  timer = null;
  if (autoTimer !== null) clearInterval(autoTimer);
  autoTimer = null;
  checkGeneration++;
}
