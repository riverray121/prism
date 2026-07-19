<script lang="ts">
  import type uPlot from "uplot";

  import type { FollowMode, Win } from "$lib/graphs/axis";
  import { buildRgbCanvas } from "$lib/graphs/heatmap";
  import TimeAxis from "$lib/graphs/TimeAxis.svelte";
  import type { PixelMatrix } from "$lib/mapping/evaluate";

  // 2-D lane for an evaluated pixel strip (pixel index × time, color = pixel
  // color) — the heatmap render path fed by the evaluator's RGB matrix.
  let {
    pixels,
    frameRateHz,
    height = 100,
    playheadSec = null,
    follow = false,
    window: win = null,
    followMode = "center",
    onWindowChange,
    onSeek,
    onScrubStart,
    onScrubEnd,
  }: {
    pixels: PixelMatrix;
    frameRateHz: number;
    height?: number;
    playheadSec?: number | null;
    follow?: boolean;
    window?: Win | null;
    followMode?: FollowMode;
    onWindowChange?: (win: Win | null) => void;
    onSeek?: (sec: number) => void;
    onScrubStart?: () => void;
    onScrubEnd?: () => void;
  } = $props();

  const frameCount = $derived(pixels.rgb.length / (pixels.pixelCount * 3));
  const maxTimeSec = $derived(
    frameCount > 1 ? (frameCount - 1) / frameRateHz : 1,
  );
  const aligned = $derived([
    [0, maxTimeSec],
    [0, 0],
  ] as [number[], number[]]);

  const offscreen = $derived(buildRgbCanvas(pixels));

  // Content read outside the closure: a new evaluation yields a new draw
  // function, which TimeAxis repaints on.
  const drawPixels = $derived.by(() => {
    const strip = offscreen;
    const rows = pixels.pixelCount;
    return (u: uPlot) => {
      const { min, max } = u.scales.x;
      if (min == null || max == null) return;
      const { ctx } = u;
      const { left, top, width, height: h } = u.bbox;
      let sx = min * frameRateHz;
      let sw = (max - min) * frameRateHz;
      if (sx < 0) {
        sw += sx;
        sx = 0;
      }
      if (sx + sw > frameCount) sw = frameCount - sx;
      ctx.save();
      ctx.imageSmoothingEnabled = false; // pixels should read as pixels
      ctx.drawImage(strip, sx, 0, Math.max(1, sw), rows, left, top, width, h);
      ctx.restore();
    };
  });
</script>

<TimeAxis
  data={aligned}
  series={[{}, { show: false }]}
  yRange={[0, 1]}
  showYAxis={false}
  showXAxis={false}
  draw={drawPixels}
  {maxTimeSec}
  {height}
  {playheadSec}
  {follow}
  window={win}
  {followMode}
  {onWindowChange}
  {onSeek}
  {onScrubStart}
  {onScrubEnd}
/>
