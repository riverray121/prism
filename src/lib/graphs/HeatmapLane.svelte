<script lang="ts">
  import type uPlot from "uplot";

  import { buildHeatmapCanvas } from "$lib/graphs/heatmap";
  import TimeAxis from "$lib/graphs/TimeAxis.svelte";
  import { loadNpy, type Npy } from "$lib/npy";

  // Renderer for heatmap features: a 2D matrix loaded from a .npy sidecar,
  // colormapped once into an offscreen canvas and blitted per frame.
  let {
    path,
    frameRateHz,
    height = 160,
    normalize = "per-row",
    playheadSec = null,
    follow = false,
    onSeek,
    onScrubStart,
    onScrubEnd,
  }: {
    path: string; // absolute fs path to the .npy sidecar
    frameRateHz: number;
    height?: number;
    // per-row: each row scaled to its own range (mfcc/chroma, mixed scales).
    // global: one range for the whole matrix (spectrogram dB — preserves loudness).
    normalize?: "per-row" | "global";
    playheadSec?: number | null;
    follow?: boolean;
    onSeek?: (sec: number) => void;
    onScrubStart?: () => void;
    onScrubEnd?: () => void;
  } = $props();

  let matrix = $state<Npy | null>(null);
  let offscreen: HTMLCanvasElement | null = null;

  const maxTimeSec = $derived.by(() => {
    const frames = matrix ? matrix.shape[1] : 0;
    return frames > 1 ? (frames - 1) / frameRateHz : 1;
  });

  const aligned = $derived([
    [0, maxTimeSec],
    [0, 0],
  ] as [number[], number[]]);

  // Load + parse the sidecar whenever the path changes.
  $effect(() => {
    const p = path;
    matrix = null;
    offscreen = null;
    let cancelled = false;
    (async () => {
      try {
        const m = await loadNpy(p);
        if (cancelled) return;
        offscreen = buildHeatmapCanvas(m, normalize);
        matrix = m;
      } catch (e) {
        if (!cancelled) console.error("heatmap load failed", p, e);
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  // Blit the visible time slice of the heatmap into the plot area.
  function drawHeatmap(u: uPlot) {
    const { min, max } = u.scales.x;
    if (min == null || max == null) return;
    if (!offscreen || !matrix) return;
    const { ctx } = u;
    const { left, top, width, height: h } = u.bbox;
    const cols = matrix.shape[1];
    let sx = min * frameRateHz;
    let sw = (max - min) * frameRateHz;
    if (sx < 0) {
      sw += sx;
      sx = 0;
    }
    if (sx + sw > cols) sw = cols - sx;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      offscreen,
      sx,
      0,
      Math.max(1, sw),
      matrix.shape[0],
      left,
      top,
      width,
      h,
    );
    ctx.restore();
  }
</script>

{#if matrix}
  <TimeAxis
    data={aligned}
    series={[{}, { show: false }]}
    yRange={[0, 1]}
    showYAxis={false}
    draw={drawHeatmap}
    {maxTimeSec}
    {height}
    {playheadSec}
    {follow}
    {onSeek}
    {onScrubStart}
    {onScrubEnd}
  />
{/if}
