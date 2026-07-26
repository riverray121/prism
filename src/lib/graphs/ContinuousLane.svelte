<script lang="ts">
  import type uPlot from "uplot";

  import type { FollowMode, Win } from "$lib/graphs/axis";
  import { decimateMinMax, LOD_THRESHOLD_POINTS } from "$lib/graphs/lod";
  import TimeAxis from "$lib/graphs/TimeAxis.svelte";

  // Renderer for one continuous track (one value per timeline frame). Takes a
  // bare number array — not a feature envelope — so any per-frame series
  // (mix feature, stem feature, tags matrix row) renders through it.
  let {
    data,
    frameRateHz,
    label = "value",
    color = "#6366f1",
    height = 120,
    showYAxis = true,
    showXAxis = true,
    playheadSec = null,
    follow = false,
    window: win = null,
    followMode = "center",
    hlines = [],
    onWindowChange,
    onSeek,
    onScrubStart,
    onScrubEnd,
  }: {
    data: number[] | Float32Array;
    frameRateHz: number;
    label?: string;
    color?: string;
    height?: number;
    showYAxis?: boolean;
    showXAxis?: boolean;
    playheadSec?: number | null;
    follow?: boolean;
    window?: Win | null;
    followMode?: FollowMode;
    // Horizontal guide lines in data units (e.g. a threshold cutoff).
    hlines?: { value: number; color: string }[];
    onWindowChange?: (win: Win | null) => void;
    onSeek?: (sec: number) => void;
    onScrubStart?: () => void;
    onScrubEnd?: () => void;
  } = $props();

  // X axis is time in seconds, derived from the frame index (no timestamps stored).
  const fullAligned = $derived.by(() => {
    const xs = Array.from(data, (_, i) => i / frameRateHz);
    return [xs, data] as uPlot.AlignedData;
  });
  const maxTimeSec = $derived(
    data.length > 1 ? (data.length - 1) / frameRateHz : 1,
  );

  // Min/max-decimated dataset for wide views: at full extent a 30k-point
  // path per redraw is the cost driver; the decimated set draws the same
  // shape from ~4k points. Zoomed in, the full data wins (uPlot clips to the
  // visible range, so it's cheap and exact).
  const lod = $derived(decimateMinMax(data, frameRateHz));
  const aligned = $derived.by(() => {
    if (!lod) return fullAligned;
    const visibleSec = win ? win.max - win.min : maxTimeSec;
    return visibleSec * frameRateHz > LOD_THRESHOLD_POINTS ? lod : fullAligned;
  });

  // Dashed guide lines; values read outside the closure so a moved cutoff
  // repaints immediately.
  const drawHlines = $derived.by(() => {
    const lines = hlines;
    if (lines.length === 0) return null;
    return (u: uPlot) => {
      const { ctx } = u;
      const dpr = globalThis.devicePixelRatio || 1;
      ctx.save();
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.lineWidth = Math.round(dpr);
      for (const line of lines) {
        const y = u.valToPos(line.value, "y", true);
        if (y < u.bbox.top || y > u.bbox.top + u.bbox.height) continue;
        ctx.strokeStyle = line.color;
        ctx.beginPath();
        ctx.moveTo(u.bbox.left, y);
        ctx.lineTo(u.bbox.left + u.bbox.width, y);
        ctx.stroke();
      }
      ctx.restore();
    };
  });
</script>

<TimeAxis
  data={aligned}
  series={[{}, { label, stroke: color, width: 1, points: { show: false } }]}
  draw={drawHlines}
  {maxTimeSec}
  {height}
  {showYAxis}
  {showXAxis}
  {playheadSec}
  {follow}
  window={win}
  {followMode}
  {onWindowChange}
  {onSeek}
  {onScrubStart}
  {onScrubEnd}
/>
