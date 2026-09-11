import { oklchToRgb } from "$lib/color";
import {
  channelColor,
  type GateSegment,
  type ProgramOutput,
} from "$lib/mapping/evaluate";

// Whole-strip frame math shared by the live streamer and the show renderer,
// so a published show and the bench strip can never disagree.

// Gate strength at one instant (null gate = always lit).
export function gateStrengthAt(gate: GateSegment[] | null, t: number): number {
  if (gate === null) return 1;
  let s = 0;
  for (const seg of gate)
    if (t >= seg.start && t <= seg.end && seg.strength > s) s = seg.strength;
  return s;
}

// Whole-strip frame for a program with no pixel matrix, mirroring the live
// preview's swatch math (brightness/gate/strobe scale the frame color).
export function solidFrame(
  output: ProgramOutput,
  pixelCount: number,
  t: number,
  frame: number,
): Uint8ClampedArray {
  const lit = gateStrengthAt(output.gate, t);
  const b = output.channels.brightness ? output.channels.brightness[frame] : 1;
  let s = lit > 0 ? Math.min(1, (0.12 + 1.05 * b) * lit) : 0;
  const rate = output.channels.strobe_rate
    ? output.channels.strobe_rate[frame]
    : 0;
  if (rate > 0 && (t * rate) % 1 >= 0.5) s = 0;
  const c = oklchToRgb(channelColor(output.channels, frame));
  const rgb = new Uint8ClampedArray(pixelCount * 3);
  const r = Math.round(Math.min(1, c.r * s) * 255);
  const g = Math.round(Math.min(1, c.g * s) * 255);
  const bl = Math.round(Math.min(1, c.b * s) * 255);
  for (let p = 0; p < pixelCount; p++) {
    rgb[p * 3] = r;
    rgb[p * 3 + 1] = g;
    rgb[p * 3 + 2] = bl;
  }
  return rgb;
}
