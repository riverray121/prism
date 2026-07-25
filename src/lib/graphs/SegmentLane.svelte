<script lang="ts">
  import type uPlot from "uplot";

  import type { FollowMode, Win } from "$lib/graphs/axis";
  import TimeAxis from "$lib/graphs/TimeAxis.svelte";
  import type { SegmentFeature } from "$lib/ipc/messages";

  // Renderer for segment features: labeled time spans drawn as colored bands.
  let {
    segments,
    maxTimeSec,
    height = 64,
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
    segments: SegmentFeature["segments"];
    maxTimeSec: number; // full time extent, from the timeline
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

  // Band colors assigned per distinct label in first-seen order, so features
  // with one label (silence) are uniform and multi-label ones (sections) get
  // a stable color per group.
  const PALETTE = [
    "#6366f1",
    "#06b6d4",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#a855f7",
    "#ec4899",
    "#84cc16",
  ];
  const labelColors = $derived.by(() => {
    const colors = new Map<string, string>();
    for (const seg of segments) {
      if (!colors.has(seg.label))
        colors.set(seg.label, PALETTE[colors.size % PALETTE.length]);
    }
    return colors;
  });

  const aligned = $derived([
    [0, maxTimeSec > 0 ? maxTimeSec : 1],
    [0, 0],
  ] as [number[], number[]]);

  // Segments read outside the closure so a re-derivation (cutoff slider)
  // hands TimeAxis a new draw function to repaint with.
  const drawBands = $derived.by(() => {
    const list = segments;
    const colors = labelColors;
    return (u: uPlot) => drawBandList(u, list, colors);
  });

  function drawBandList(
    u: uPlot,
    list: SegmentFeature["segments"],
    colors: Map<string, string>,
  ) {
    const { min, max } = u.scales.x;
    if (min == null || max == null) return;
    const { ctx } = u;
    const dpr = window.devicePixelRatio || 1;
    const top = u.bbox.top;
    const bottom = u.bbox.top + u.bbox.height;
    const bandTop = top + 4 * dpr;
    ctx.save();
    ctx.font = `${Math.round(11 * dpr)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    for (const seg of list) {
      if (seg.end < min || seg.start > max) continue;
      const x0 = u.valToPos(Math.max(seg.start, min), "x", true);
      const x1 = u.valToPos(Math.min(seg.end, max), "x", true);
      const color = colors.get(seg.label) ?? PALETTE[0];
      // Translucent band with solid edges at the true boundaries.
      ctx.fillStyle = color + "33";
      ctx.fillRect(x0, bandTop, x1 - x0, bottom - bandTop);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.round(dpr);
      ctx.beginPath();
      if (seg.start >= min) {
        ctx.moveTo(x0, bandTop);
        ctx.lineTo(x0, bottom);
      }
      if (seg.end <= max) {
        ctx.moveTo(x1, bandTop);
        ctx.lineTo(x1, bottom);
      }
      ctx.stroke();
      // Label (with ML confidence when present) inside the band when it fits.
      const label =
        typeof seg.confidence === "number"
          ? `${seg.label} ${Math.round(seg.confidence * 100)}%`
          : seg.label;
      if (label) {
        const w = ctx.measureText(label).width;
        if (w + 8 * dpr < x1 - x0) {
          ctx.fillStyle = color;
          ctx.fillText(label, x0 + 4 * dpr, (bandTop + bottom) / 2);
        }
      }
    }
    ctx.restore();
  }
</script>

<TimeAxis
  data={aligned}
  series={[{}, { show: false }]}
  yRange={[0, 1]}
  showYAxis={false}
  {gutter}
  draw={drawBands}
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
