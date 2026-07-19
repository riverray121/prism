<script lang="ts">
  import type uPlot from "uplot";

  import type { FollowMode, Win } from "$lib/graphs/axis";
  import { buildRibbonCanvas } from "$lib/graphs/ribbon";
  import TimeAxis from "$lib/graphs/TimeAxis.svelte";
  import type { ProgramOutput } from "$lib/mapping/evaluate";

  // Renderer for one evaluated program: the lit ribbon. Pre-rendered to an
  // offscreen strip on evaluation, blitted per redraw; the optional exact-value
  // line overlays brightness for when opacity is too coarse to read.
  let {
    output,
    frameCount,
    frameRateHz,
    height = 56,
    showValueLine = false,
    playheadSec = null,
    follow = false,
    window: win = null,
    followMode = "center",
    onWindowChange,
    onSeek,
    onScrubStart,
    onScrubEnd,
  }: {
    output: ProgramOutput;
    frameCount: number;
    frameRateHz: number;
    height?: number;
    showValueLine?: boolean; // thin brightness overlay
    playheadSec?: number | null;
    follow?: boolean;
    window?: Win | null;
    followMode?: FollowMode;
    onWindowChange?: (win: Win | null) => void;
    onSeek?: (sec: number) => void;
    onScrubStart?: () => void;
    onScrubEnd?: () => void;
  } = $props();

  const maxTimeSec = $derived(
    frameCount > 1 ? (frameCount - 1) / frameRateHz : 1,
  );
  const aligned = $derived([
    [0, maxTimeSec],
    [0, 0],
  ] as [number[], number[]]);

  // Re-render the strip only when the evaluation output changes.
  const offscreen = $derived(
    buildRibbonCanvas(output, frameCount, frameRateHz),
  );

  // Content is read here, outside the closure, so a new evaluation or a
  // value-line toggle produces a new draw function — TimeAxis repaints on
  // that identity change. (Reads inside the closure would register nothing:
  // it runs during canvas draws, untracked.)
  const drawRibbon = $derived.by(() => {
    const strip = offscreen;
    const brightness = showValueLine
      ? (output.channels.brightness ?? null)
      : null;
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
      // Dark bed so unlit stretches read as "off".
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(left, top, width, h);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(strip, sx, 0, Math.max(1, sw), 1, left, top, width, h);

      // Exact brightness values as a thin line, sampled per pixel column.
      if (brightness) {
        const dpr = globalThis.devicePixelRatio || 1;
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = Math.round(dpr);
        ctx.beginPath();
        for (let px = 0; px <= width; px += 2) {
          const t = min + ((max - min) * px) / width;
          const frame = Math.round(t * frameRateHz);
          if (frame < 0 || frame >= frameCount) continue;
          const y = top + (1 - brightness[frame]) * h;
          if (px === 0) ctx.moveTo(left + px, y);
          else ctx.lineTo(left + px, y);
        }
        ctx.stroke();
      }
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
  draw={drawRibbon}
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
