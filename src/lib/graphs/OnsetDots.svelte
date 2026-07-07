<script lang="ts">
  import type uPlot from "uplot";

  import TimeAxis from "$lib/graphs/TimeAxis.svelte";

  // Sub-lane of a continuous feature: its derived onsets as dots on a center
  // line. Deliberately minimal — no controls, no axes — it rides directly
  // under its parent lane and shares the global playhead.
  let {
    onsets,
    maxTimeSec,
    color = "#6366f1",
    playheadSec = null,
    follow = false,
    onSeek,
    onScrubStart,
    onScrubEnd,
  }: {
    onsets: { t: number; strength: number }[];
    maxTimeSec: number;
    color?: string;
    playheadSec?: number | null;
    follow?: boolean;
    onSeek?: (sec: number) => void;
    onScrubStart?: () => void;
    onScrubEnd?: () => void;
  } = $props();

  const aligned = $derived([
    [0, maxTimeSec > 0 ? maxTimeSec : 1],
    [0, 0],
  ] as [number[], number[]]);

  function drawDots(u: uPlot) {
    const { min, max } = u.scales.x;
    if (min == null || max == null) return;
    const { ctx } = u;
    const dpr = window.devicePixelRatio || 1;
    const mid = u.bbox.top + u.bbox.height / 2;
    // Faint baseline the dots sit on.
    ctx.save();
    ctx.strokeStyle = "rgba(128,128,128,0.3)";
    ctx.lineWidth = Math.round(dpr);
    ctx.beginPath();
    ctx.moveTo(u.bbox.left, mid);
    ctx.lineTo(u.bbox.left + u.bbox.width, mid);
    ctx.stroke();
    // One dot per onset; opacity tracks strength so hard hits read darker.
    ctx.fillStyle = color;
    for (const onset of onsets) {
      if (onset.t < min || onset.t > max) continue;
      const x = u.valToPos(onset.t, "x", true);
      ctx.globalAlpha = 0.35 + 0.65 * onset.strength;
      ctx.beginPath();
      ctx.arc(x, mid, 2.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
</script>

<TimeAxis
  data={aligned}
  series={[{}, { show: false }]}
  yRange={[0, 1]}
  showYAxis={false}
  showXAxis={false}
  showControls={false}
  draw={drawDots}
  maxTimeSec={maxTimeSec > 0 ? maxTimeSec : 1}
  height={28}
  {playheadSec}
  {follow}
  {onSeek}
  {onScrubStart}
  {onScrubEnd}
/>
