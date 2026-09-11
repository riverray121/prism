import type { Profile } from "$lib/ipc/messages";
import { solidFrame } from "$lib/hardware/frame";
import { hubForLight } from "$lib/hardware/patch";
import type { RigHub } from "$lib/hardware/wled";
import {
  applyMacro,
  evaluateDoc,
  frameIndexAt,
  type Matrices,
  type ProgramOutput,
} from "$lib/mapping/evaluate";
import type { MappingDoc } from "$lib/mapping/schema";

// Show bundle rendering (docs/companion-api.md): every patched light rendered
// at its own pixel count over the whole song at SHOW_FRAME_RATE_HZ, sampled
// the way the live streamer samples, without the light-delay offset (the
// player calibrates its own).

export const SHOW_FRAME_RATE_HZ = 40;
export const SHOW_SCHEMA = "prism-show/1";

export interface ShowLight {
  key: string;
  hub_mac: string;
  output: number;
  name: string;
  pixel_count: number;
  frames: string;
}

export interface ShowManifest {
  schema: typeof SHOW_SCHEMA;
  title: string;
  artist: string;
  duration_s: number;
  audio: string;
  // The audio's name inside the song folder; the sidecar packs it as `audio`.
  source_file: string;
  frame_rate_hz: number;
  frame_count: number;
  latency_ms: number;
  lights: ShowLight[];
  external: Record<string, string>;
  prism_version: string;
}

export interface RenderedLight {
  light: ShowLight;
  bytes: Uint8Array;
}

// Patched lights that exist in the rig with an enabled program, whether or
// not their hub is online: a bundle describes the rig, not the network.
export function showLights(
  doc: MappingDoc,
  hubs: RigHub[],
): { light: ShowLight; programId: string }[] {
  const out: { light: ShowLight; programId: string }[] = [];
  for (const [lightId, programId] of Object.entries(doc.patch)) {
    const hub = hubForLight(hubs, lightId);
    const light = hub?.lights.find((l) => l.id === lightId);
    const program = doc.programs.find((p) => p.id === programId);
    if (!hub || !light || !program || !program.enabled) continue;
    const output = hub.lights.indexOf(light);
    const key = `${hub.mac}-${output}`;
    out.push({
      light: {
        key,
        hub_mac: hub.mac,
        output,
        name: light.name ?? `Output ${output + 1}`,
        pixel_count: light.pixel_count,
        frames: `frames/${key}.bin`,
      },
      programId,
    });
  }
  return out;
}

export function showFrameCount(profile: Profile): number {
  const duration =
    profile.timeline.frame_count / profile.timeline.frame_rate_hz;
  return Math.max(1, Math.ceil(duration * SHOW_FRAME_RATE_HZ));
}

// One light's frame-major RGB bytes over the show.
function renderLight(
  output: ProgramOutput,
  pixelCount: number,
  profile: Profile,
  frameCount: number,
): Uint8Array {
  const hz = profile.timeline.frame_rate_hz;
  const sourceFrames = profile.timeline.frame_count;
  const stride = pixelCount * 3;
  const bytes = new Uint8Array(frameCount * stride);
  for (let i = 0; i < frameCount; i++) {
    const t = i / SHOW_FRAME_RATE_HZ;
    const frame = frameIndexAt(t, hz, sourceFrames);
    if (output.pixels && output.pixels.pixelCount === pixelCount) {
      bytes.set(
        output.pixels.rgb.subarray(frame * stride, (frame + 1) * stride),
        i * stride,
      );
    } else {
      bytes.set(solidFrame(output, pixelCount, t, frame), i * stride);
    }
  }
  return bytes;
}

export function renderShowFrames(
  profile: Profile,
  doc: MappingDoc,
  hubs: RigHub[],
  matrices: Matrices,
): { frameCount: number; lights: RenderedLight[] } {
  const frameCount = showFrameCount(profile);
  const targets = showLights(doc, hubs);
  // The evaluator renders every program at one strip resolution; run it once
  // per distinct pixel count among the patched lights.
  const byCount = new Map<number, Record<string, ProgramOutput>>();
  for (const { light } of targets) {
    if (byCount.has(light.pixel_count)) continue;
    const raw = evaluateDoc(profile, doc, {}, matrices, light.pixel_count);
    byCount.set(light.pixel_count, applyMacro(profile, doc, raw, {}));
  }
  const lights: RenderedLight[] = [];
  for (const { light, programId } of targets) {
    const output = byCount.get(light.pixel_count)?.[programId];
    if (!output) continue;
    lights.push({
      light,
      bytes: renderLight(output, light.pixel_count, profile, frameCount),
    });
  }
  return { frameCount, lights };
}

export function buildManifest(args: {
  title: string;
  artist: string;
  profile: Profile;
  sourceFile: string;
  lights: ShowLight[];
  frameCount: number;
  latencyMs: number;
  prismVersion: string;
}): ShowManifest {
  const ext = args.sourceFile.includes(".")
    ? args.sourceFile.slice(args.sourceFile.lastIndexOf("."))
    : "";
  return {
    schema: SHOW_SCHEMA,
    title: args.title,
    artist: args.artist,
    duration_s:
      args.profile.timeline.frame_count / args.profile.timeline.frame_rate_hz,
    audio: `audio${ext}`,
    source_file: args.sourceFile,
    frame_rate_hz: SHOW_FRAME_RATE_HZ,
    frame_count: args.frameCount,
    latency_ms: args.latencyMs,
    lights: args.lights,
    external: {},
    prism_version: args.prismVersion,
  };
}
