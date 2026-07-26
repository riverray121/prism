<script lang="ts">
  import type uPlot from "uplot";

  import type { FollowMode, Win } from "$lib/graphs/axis";
  import TimeAxis from "$lib/graphs/TimeAxis.svelte";

  // Sub-lane of a continuous feature: its derived onsets as dots on a center
  // line. Deliberately minimal — no controls, no axes — it rides directly
  // under its parent lane and shares the global playhead.
  let {
    onsets,
    maxTimeSec,
    color = "#6366f1",
    height = 28,
    gutter = false,
    playheadSec = null,
    follow = false,
    window: win = null,
    followMode = "center",
    onWindowChange,
    onSeek,
    onScrubStart,
    onScrubEnd,
  }: {
    onsets: { t: number; strength: number }[];
    maxTimeSec: number;
    color?: string;
    height?: number;
    gutter?: boolean;
    playheadSec?: number | null;
    follow?: boolean;
    window?: Win | null;
    followMode?: FollowMode;
    onWindowChange?: (win: Win | null) => void;
    onSeek?: (sec: number) => void;
    onScrubStart?: () => void;
    onScrubEnd?: () => void;
  } = $props();

  const aligned = $derived([
    [0, maxTimeSec > 0 ? maxTimeSec : 1],
    [0, 0],
  ] as [number[], number[]]);

  // Onsets are read outside the closure so a re-derivation (cutoff slider)
  // hands TimeAxis a new draw function to repaint with.
  const drawDots = $derived.by(() => {
    const list = onsets;
    return (u: uPlot) => {
      const { min, max } = u.scales.x;
      if (min == null || max == null) return;
      const { ctx } = u;
      const dpr = globalThis.devicePixelRatio || 1;
      const mid = u.bbox.top + u.bbox.height / 2;
      // Faint baseline the dots sit on.
      ctx.save();
      ctx.strokeStyle = "rgba(128,128,128,0.3)";
      ctx.lineWidth = Math.round(dpr);
      ctx.beginPath();
      ctx.moveTo(u.bbox.left, mid);
      ctx.lineTo(u.bbox.left + u.bbox.width, mid);
      ctx.stroke();
      // One dot per onset; opacity and radius both track strength so hard
      // hits read clearly darker and bigger than weak ones. Radii scale with
      // lane height so a taller lane gets proportionally bigger dots.
      const rMin = height * 0.055 * dpr;
      const rSpan = height * 0.07 * dpr;
      ctx.fillStyle = color;
      for (const onset of list) {
        if (onset.t < min || onset.t > max) continue;
        const x = u.valToPos(onset.t, "x", true);
        ctx.globalAlpha = 0.12 + 0.88 * onset.strength;
        ctx.beginPath();
        ctx.arc(x, mid, rMin + rSpan * onset.strength, 0, Math.PI * 2);
        ctx.fill();
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
  {gutter}
  draw={drawDots}
  maxTimeSec={maxTimeSec > 0 ? maxTimeSec : 1}
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
