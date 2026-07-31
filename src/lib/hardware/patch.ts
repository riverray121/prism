import { DEFAULT_PIXELS } from "$lib/mapping/evaluate";
import type { MappingDoc, Program } from "$lib/mapping/schema";
import type { RigHub, RigLight } from "$lib/hardware/wled";

// Patch resolution: which patch entries actually stream. Pure so the streamer
// and the patch view can never disagree about what is live vs muted.

export interface PatchTarget {
  hub: RigHub;
  light: RigLight;
  program: Program;
}

// The hub a light id belongs to (light ids are `{hub mac}:{output index}`).
export function hubForLight(
  hubs: RigHub[],
  lightId: string,
): RigHub | undefined {
  return hubs.find((h) => h.lights.some((l) => l.id === lightId));
}

// The strip resolution evaluation should run at: the largest pixel count
// among patched lights that exist in the rig (offline hubs still count — a
// connection flap must not flip the whole evaluation's resolution), or the
// preview default when nothing is patched.
export function patchedPixelCount(doc: MappingDoc, hubs: RigHub[]): number {
  let best = 0;
  for (const lightId of Object.keys(doc.patch)) {
    const light = hubForLight(hubs, lightId)?.lights.find(
      (l) => l.id === lightId,
    );
    if (light && light.pixel_count > best) best = light.pixel_count;
  }
  return best > 0 ? best : DEFAULT_PIXELS;
}

// Resolve a doc's patch against the rig. An entry streams only when its light
// exists on an online hub and its program still exists and is enabled;
// anything else mutes (the favorites rule: warn, never a hard failure).
export function activePatch(
  doc: MappingDoc,
  hubs: RigHub[],
  online: Record<string, boolean>,
): PatchTarget[] {
  const out: PatchTarget[] = [];
  for (const [lightId, programId] of Object.entries(doc.patch)) {
    const hub = hubForLight(hubs, lightId);
    if (!hub || online[hub.mac] !== true) continue;
    const light = hub.lights.find((l) => l.id === lightId);
    const program = doc.programs.find((p) => p.id === programId);
    if (!light || !program || !program.enabled) continue;
    out.push({ hub, light, program });
  }
  return out;
}
