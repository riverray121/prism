// Per-light output at one instant: the one sampling path shared by the Sim
// tab and the lab's render page, so a video shows what the app shows. It
// samples the same way the hardware streamer and published frames do
// (frameIndexAt, pixel rows, else solidFrame).

import type { Profile } from "$lib/ipc/messages";
import { solidFrame } from "$lib/hardware/frame";
import {
  applyMacro,
  evaluateDoc,
  frameIndexAt,
  type Matrices,
  type ProgramOutput,
} from "$lib/mapping/evaluate";
import type { MappingDoc } from "$lib/mapping/schema";
import type { LightSpec } from "$lib/showgen/types";

export interface LightState {
  // pixelCount × 3 sRGB bytes.
  rgb: Uint8ClampedArray;
  // Mean of the pixels' largest channel, 0–1: how much light the fixture
  // throws onto the room.
  level: number;
}

// Program outputs keyed by pixel count: pixel rows are evaluated at each
// light's own length, like renderShowFrames.
export type OutputsByPixels = Map<number, Record<string, ProgramOutput>>;

export function evaluateForLights(
  profile: Profile,
  doc: MappingDoc,
  lights: LightSpec[],
  matrices: Matrices = {},
): OutputsByPixels {
  const out: OutputsByPixels = new Map();
  for (const light of lights) {
    if (out.has(light.pixelCount)) continue;
    const raw = evaluateDoc(profile, doc, {}, matrices, light.pixelCount);
    out.set(light.pixelCount, applyMacro(profile, doc, raw));
  }
  return out;
}

const DARK = new Uint8ClampedArray(0);

export function sampleLights(
  profile: Profile,
  doc: MappingDoc,
  outputs: OutputsByPixels,
  lights: LightSpec[],
  t: number,
): Map<string, LightState> {
  const hz = profile.timeline.frame_rate_hz;
  const frame = frameIndexAt(t, hz, profile.timeline.frame_count);
  const states = new Map<string, LightState>();
  for (const light of lights) {
    const programId = doc.patch[light.id];
    const program = doc.programs.find((p) => p.id === programId);
    const output =
      program && program.enabled
        ? outputs.get(light.pixelCount)?.[programId]
        : undefined;
    if (!output) {
      states.set(light.id, {
        rgb: light.pixelCount
          ? new Uint8ClampedArray(light.pixelCount * 3)
          : DARK,
        level: 0,
      });
      continue;
    }
    const n = light.pixelCount;
    let rgb: Uint8ClampedArray;
    if (output.pixels && output.pixels.pixelCount === n) {
      rgb = output.pixels.rgb.slice(frame * n * 3, (frame + 1) * n * 3);
    } else {
      rgb = solidFrame(output, n, t, frame);
    }
    let sum = 0;
    for (let p = 0; p < n; p++)
      sum += Math.max(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]);
    states.set(light.id, { rgb, level: n ? sum / (n * 255) : 0 });
  }
  return states;
}
