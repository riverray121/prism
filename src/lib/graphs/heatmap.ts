// Colormapping for heatmap matrices, kept pure so the renderer component only
// blits. Perceptual-ish colormap (inferno-like) for a normalized value in [0,1].

import type { PixelMatrix } from "$lib/mapping/evaluate";
import type { Npy } from "$lib/npy";

const STOPS: [number, number, number, number][] = [
  [0.0, 0, 0, 4],
  [0.25, 60, 15, 110],
  [0.5, 160, 40, 100],
  [0.75, 230, 110, 40],
  [1.0, 250, 250, 180],
];

export function heatColor(t: number): [number, number, number] {
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, r0, g0, b0] = STOPS[i - 1];
      const [t1, r1, g1, b1] = STOPS[i];
      const f = (t - t0) / (t1 - t0 || 1);
      return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f];
    }
  }
  const last = STOPS[STOPS.length - 1];
  return [last[1], last[2], last[3]];
}

// Render the matrix once into a native-resolution offscreen canvas (cols×rows);
// the draw hook scales the relevant slice of it into the plot each frame.
// Normalization (per-row vs global) is chosen per feature: per-row keeps each
// coefficient legible when scales differ (mfcc's energy row 0); global keeps
// the true relative magnitudes (a spectrogram's loudness across frequencies).
export function buildHeatmapCanvas(
  m: Npy,
  normalize: "per-row" | "global",
): HTMLCanvasElement {
  const [rows, cols] = m.shape;
  let globalLo = Infinity;
  let globalHi = -Infinity;
  if (normalize === "global") {
    for (let i = 0; i < m.data.length; i++) {
      const v = m.data[i];
      if (v < globalLo) globalLo = v;
      if (v > globalHi) globalHi = v;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(cols, rows);
  for (let r = 0; r < rows; r++) {
    let lo = globalLo;
    let hi = globalHi;
    if (normalize === "per-row") {
      lo = Infinity;
      hi = -Infinity;
      for (let c = 0; c < cols; c++) {
        const v = m.data[r * cols + c];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    const span = hi - lo || 1;
    const y = rows - 1 - r; // low row index at the bottom
    for (let c = 0; c < cols; c++) {
      const [cr, cg, cb] = heatColor((m.data[r * cols + c] - lo) / span);
      const idx = (y * cols + c) * 4;
      img.data[idx] = cr;
      img.data[idx + 1] = cg;
      img.data[idx + 2] = cb;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Same offscreen-strip idea for an evaluated pixel matrix: the evaluator
// already produced RGB bytes, so this only transposes frame-major triples
// into a (frames × pixels) canvas, pixel 0 at the bottom.
export function buildRgbCanvas(pixels: PixelMatrix): HTMLCanvasElement {
  const { pixelCount, rgb } = pixels;
  const frames = Math.max(1, rgb.length / (pixelCount * 3));
  const canvas = document.createElement("canvas");
  canvas.width = frames;
  canvas.height = pixelCount;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(frames, pixelCount);
  for (let f = 0; f < frames; f++) {
    for (let p = 0; p < pixelCount; p++) {
      const src = (f * pixelCount + p) * 3;
      const dst = ((pixelCount - 1 - p) * frames + f) * 4;
      img.data[dst] = rgb[src];
      img.data[dst + 1] = rgb[src + 1];
      img.data[dst + 2] = rgb[src + 2];
      img.data[dst + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
