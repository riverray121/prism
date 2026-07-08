<script lang="ts">
  import type uPlot from "uplot";

  import type { FollowMode, Win } from "$lib/graphs/axis";
  import TimeAxis from "$lib/graphs/TimeAxis.svelte";
  import type { EventFeature } from "$lib/ipc/messages";

  // Renderer for event features: vertical ticks (with optional labels) drawn
  // directly on the canvas; the y series is hidden.
  let {
    events,
    maxTimeSec,
    color = "#6366f1",
    height = 64,
    playheadSec = null,
    follow = false,
    window: win = null,
    followMode = "center",
    onWindowChange,
    labelFor,
    onSeek,
    onScrubStart,
    onScrubEnd,
  }: {
    events: EventFeature["events"];
    maxTimeSec: number; // full time extent, from the timeline (events alone don't define it)
    color?: string;
    height?: number;
    playheadSec?: number | null;
    follow?: boolean;
    window?: Win | null;
    followMode?: FollowMode;
    onWindowChange?: (win: Win | null) => void;
    // Optional per-event text label (e.g. chord names). Returns null to skip.
    // Labels drawn in a top band; overlapping ones are dropped so density
    // resolves as you zoom in.
    labelFor?: (ev: EventFeature["events"][number]) => string | null;
    onSeek?: (sec: number) => void;
    onScrubStart?: () => void;
    onScrubEnd?: () => void;
  } = $props();

  // Two x points anchor the scale to [0, maxTimeSec]; ticks are self-drawn.
  const aligned = $derived([
    [0, maxTimeSec > 0 ? maxTimeSec : 1],
    [0, 0],
  ] as [number[], number[]]);

  function drawTicks(u: uPlot) {
    const { min, max } = u.scales.x;
    if (min == null || max == null) return;
    const { ctx } = u;
    const dpr = window.devicePixelRatio || 1;
    const top = u.bbox.top;
    const bottom = u.bbox.top + u.bbox.height;
    // Reserve a top band for labels so text doesn't sit on the ticks.
    const labelBand = labelFor ? 14 * dpr : 0;
    const tickTop = top + labelBand;
    // Event ticks within the current view.
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.round(dpr);
    ctx.beginPath();
    for (const ev of events) {
      if (ev.t < min || ev.t > max) continue;
      const x = u.valToPos(ev.t, "x", true);
      ctx.moveTo(x, tickTop);
      ctx.lineTo(x, bottom);
    }
    ctx.stroke();
    ctx.restore();
    // Per-event labels in the top band; drop any that would overlap the
    // previously drawn one (events are in chronological order).
    if (labelFor) {
      ctx.save();
      ctx.fillStyle = color;
      ctx.textBaseline = "top";
      ctx.font = `${Math.round(11 * dpr)}px ui-sans-serif, system-ui, sans-serif`;
      let lastRight = -Infinity;
      for (const ev of events) {
        if (ev.t < min || ev.t > max) continue;
        const label = labelFor(ev);
        if (!label) continue;
        const x = u.valToPos(ev.t, "x", true);
        if (x < lastRight + 4 * dpr) continue;
        ctx.fillText(label, x + 2 * dpr, top + 1 * dpr);
        lastRight = x + 2 * dpr + ctx.measureText(label).width;
      }
      ctx.restore();
    }
  }
</script>

<TimeAxis
  data={aligned}
  series={[{}, { show: false }]}
  yRange={[0, 1]}
  showYAxis={false}
  draw={drawTicks}
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
