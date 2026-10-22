import type { CompanionRequest } from "$lib/companion/client";
import type { RigHub } from "$lib/hardware/wled";
import type { Song } from "$lib/ipc/messages";
import type { MappingDoc } from "$lib/mapping/schema";

// Decision rules for the companion automation: given the library, the open
// requests, and what is in flight, pick the one next step. Pure, so the
// state module only glues actions to decisions.

export type AutomationAction =
  | { kind: "idle" }
  | { kind: "wait"; reason: string }
  | { kind: "import"; request: CompanionRequest }
  | { kind: "queue"; songIds: string[] }
  | { kind: "process"; song: Song };

export function nextAction(args: {
  requests: CompanionRequest[];
  songs: Song[];
  importsPending: boolean;
  publishing: boolean;
  skipped: Set<string>;
}): AutomationAction {
  if (args.publishing) return { kind: "wait", reason: "publishing" };
  if (args.importsPending) return { kind: "wait", reason: "importing" };
  const open = args.requests.find((r) => r.status === "open");
  if (open) return { kind: "import", request: open };
  const linked = args.songs.filter((s) => s.request_id !== null);
  const unanalyzed = linked.filter((s) => s.status === "unanalyzed");
  if (unanalyzed.length > 0)
    return { kind: "queue", songIds: unanalyzed.map((s) => s.id) };
  // Analysis saturates the CPU; opening and rendering a song meanwhile is
  // slow and competes with it.
  if (args.songs.some((s) => s.status === "analyzing" || s.status === "queued"))
    return { kind: "wait", reason: "analyzing" };
  const ready = linked.find(
    (s) =>
      s.status === "analyzed" &&
      s.published_at === null &&
      !args.skipped.has(s.id),
  );
  if (ready) return { kind: "process", song: ready };
  return { kind: "idle" };
}

// Every rig light gets a program, programs reused round-robin in rig order.
// Returns null when there is nothing to patch with or onto.
export function roundRobinPatch(
  doc: MappingDoc,
  hubs: RigHub[],
): Record<string, string> | null {
  const programs = doc.programs.filter((p) => p.enabled).map((p) => p.id);
  const lights = hubs.flatMap((h) => h.lights.map((l) => l.id));
  if (programs.length === 0 || lights.length === 0) return null;
  const patch: Record<string, string> = {};
  lights.forEach((id, i) => {
    patch[id] = programs[i % programs.length];
  });
  return patch;
}
