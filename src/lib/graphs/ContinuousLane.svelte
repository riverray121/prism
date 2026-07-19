<script lang="ts">
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
    onWindowChange,
    onSeek,
    onScrubStart,
    onScrubEnd,
  }: {
    data: number[];
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
    onWindowChange?: (win: Win | null) => void;
    onSeek?: (sec: number) => void;
    onScrubStart?: () => void;
    onScrubEnd?: () => void;
  } = $props();

  // X axis is time in seconds, derived from the frame index (no timestamps stored).
  const fullAligned = $derived.by(() => {
    const xs = data.map((_, i) => i / frameRateHz);
    return [xs, data] as [number[], number[]];
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
</script>

<TimeAxis
  data={aligned}
  series={[{}, { label, stroke: color, width: 1, points: { show: false } }]}
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
