<script lang="ts">
  import uPlot from "uplot";
  import "uplot/dist/uPlot.min.css";

  import type { Profile } from "$lib/ipc/messages";

  // Concrete graph for the RMS continuous feature. A generic FeatureGraph
  // abstraction waits until three concrete graph types exist (see development.md).
  let {
    rms,
    frameRateHz,
    playheadSec = null,
  }: {
    rms: Profile["mix"]["rms"];
    frameRateHz: number;
    playheadSec?: number | null;
  } = $props();

  const HEIGHT = 160;

  let container: HTMLDivElement;
  let chart: uPlot | undefined;

  // X axis is time in seconds, derived from the frame index (no timestamps stored).
  function buildData(): uPlot.AlignedData {
    const xs = rms.data.map((_, i) => i / frameRateHz);
    return [xs, rms.data];
  }

  // Mid-gray axes read acceptably in both light and dark themes; theming is an
  // M5 concern.
  function options(): uPlot.Options {
    const grid = { stroke: "rgba(128,128,128,0.15)", width: 1 };
    return {
      width: container.clientWidth,
      height: HEIGHT,
      scales: { x: { time: false } },
      axes: [
        { stroke: "#888", grid },
        { stroke: "#888", grid },
      ],
      series: [
        {},
        { label: "RMS", stroke: "#6366f1", width: 1, points: { show: false } },
      ],
      legend: { show: false },
      // Draw the playback head as a vertical line, using uPlot's own coordinate
      // system so it stays aligned with the data.
      hooks: {
        draw: [
          (u) => {
            if (playheadSec === null) return;
            const x = u.valToPos(playheadSec, "x", true);
            const { ctx } = u;
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = "#ef4444";
            ctx.lineWidth = Math.round(window.devicePixelRatio || 1);
            ctx.moveTo(x, u.bbox.top);
            ctx.lineTo(x, u.bbox.top + u.bbox.height);
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    };
  }

  // Create the chart once per dataset (rms/frameRateHz), tear down on change.
  $effect(() => {
    chart = new uPlot(options(), buildData(), container);
    const ro = new ResizeObserver(() =>
      chart?.setSize({ width: container.clientWidth, height: HEIGHT }),
    );
    ro.observe(container);
    return () => {
      ro.disconnect();
      chart?.destroy();
      chart = undefined;
    };
  });

  // Redraw (without recomputing scales) whenever the playhead moves.
  $effect(() => {
    playheadSec;
    chart?.redraw(false);
  });
</script>

<div bind:this={container} class="w-full"></div>
