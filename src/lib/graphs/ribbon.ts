// Ribbon rendering for evaluated programs, kept pure so the lane component
// only blits. A ribbon reads as the light itself: lit runs (gate) on a dark
// background, fill color from hue/saturation (or color_temp), glow/opacity
// from brightness.

import { oklchToRgb } from "$lib/color";
import {
  channelColor,
  litMask,
  type ProgramOutput,
} from "$lib/mapping/evaluate";

// One RGBA column per frame. Fill comes from the shared channelColor
// precedence (hue → color_temp → neutral); alpha carries brightness on lit
// frames and drops to a faint floor on unlit ones, so the ribbon glows where
// the light would.
export function ribbonRgba(
  output: ProgramOutput,
  frameCount: number,
  frameRateHz: number,
): Uint8ClampedArray {
  const { channels, gate } = output;
  const mask = litMask(gate, frameCount, frameRateHz);
  const rgba = new Uint8ClampedArray(frameCount * 4);
  const brightness = channels.brightness ?? null;
  for (let i = 0; i < frameCount; i++) {
    const b = brightness ? brightness[i] : 1;
    const { r, g, b: bl } = oklchToRgb(channelColor(channels, i));
    const alpha = mask[i] > 0 ? 0.25 + 0.75 * b : 0.05;
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
