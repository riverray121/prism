// Ribbon rendering for evaluated programs, kept pure so the lane component
// only blits. A ribbon reads as the light itself: lit runs (gate) on a dark
// background, fill color from hue/saturation (or color_temp), glow/opacity
// from brightness.

import { oklchToRgb, PALETTES } from "$lib/color";
import type { GateSegment, ProgramOutput } from "$lib/mapping/evaluate";

// Practical sRGB chroma ceiling; saturation 0-1 maps onto it.
const MAX_CHROMA = 0.32;

// Per-frame lit mask from gate segments (null gate = always lit).
export function litMask(
  gate: GateSegment[] | null,
  frameCount: number,
  frameRateHz: number,
): Float32Array {
  const mask = new Float32Array(frameCount);
  if (gate === null) {
    mask.fill(1);
    return mask;
  }
  for (const seg of gate) {
    const a = Math.max(0, Math.round(seg.start * frameRateHz));
    const b = Math.min(frameCount - 1, Math.round(seg.end * frameRateHz));
    for (let i = a; i <= b; i++)
      if (seg.strength > mask[i]) mask[i] = seg.strength;
  }
  return mask;
}

// One RGBA column per frame. Color precedence: hue (+saturation) → color_temp
// via the warm↔cool palette → neutral warm-white. Alpha carries brightness on
// lit frames and drops to a faint floor on unlit ones, so the ribbon glows
// where the light would.
export function ribbonRgba(
  output: ProgramOutput,
  frameCount: number,
  frameRateHz: number,
): Uint8ClampedArray {
  const { channels, gate } = output;
  const mask = litMask(gate, frameCount, frameRateHz);
  const rgba = new Uint8ClampedArray(frameCount * 4);
  const hue = channels.hue ?? null;
  const saturation = channels.saturation ?? null;
  const colorTemp = channels.color_temp ?? null;
  const brightness = channels.brightness ?? null;
  for (let i = 0; i < frameCount; i++) {
    const b = brightness ? brightness[i] : 1;
    let color;
    if (hue) {
      color = {
        l: 0.55 + 0.25 * b,
        c: (saturation ? saturation[i] : 0.8) * MAX_CHROMA,
        h: hue[i],
      };
    } else if (colorTemp) {
      const base = PALETTES.warm_cool(colorTemp[i]);
      color = { l: 0.45 + 0.4 * b, c: base.c, h: base.h };
    } else {
      color = { l: 0.55 + 0.35 * b, c: 0.02, h: 90 };
    }
    const { r, g, b: bl } = oklchToRgb(color);
    const lit = mask[i] > 0;
    const alpha = lit ? 0.25 + 0.75 * b : 0.05;
    const idx = i * 4;
    rgba[idx] = Math.round(r * 255);
    rgba[idx + 1] = Math.round(g * 255);
    rgba[idx + 2] = Math.round(bl * 255);
    rgba[idx + 3] = Math.round(alpha * 255);
  }
  return rgba;
}

// Native-resolution offscreen strip (frameCount × 1); the lane's draw hook
// stretches the visible slice over the plot area, exactly like heatmaps.
export function buildRibbonCanvas(
  output: ProgramOutput,
  frameCount: number,
  frameRateHz: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, frameCount);
  canvas.height = 1;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(canvas.width, 1);
  img.data.set(ribbonRgba(output, frameCount, frameRateHz));
  ctx.putImageData(img, 0, 0);
  return canvas;
}
