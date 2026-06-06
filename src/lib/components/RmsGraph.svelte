<script lang="ts">
  import uPlot from "uplot";
  import "uplot/dist/uPlot.min.css";

  import type { Profile } from "$lib/ipc/messages";

  // Concrete graph for the RMS continuous feature. A generic FeatureGraph
  // abstraction waits until three concrete graph types exist (see development.md).
  let {
    rms,
    frameRateHz,
  }: { rms: Profile["mix"]["rms"]; frameRateHz: number } = $props();

  const HEIGHT = 160;

  let container: HTMLDivElement;

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
    };
  }

  $effect(() => {
    const chart = new uPlot(options(), buildData(), container);
    const ro = new ResizeObserver(() =>
      chart.setSize({ width: container.clientWidth, height: HEIGHT }),
    );
    ro.observe(container);
    return () => {
      ro.disconnect();
      chart.destroy();
    };
  });
</script>

<div bind:this={container} class="w-full"></div>
