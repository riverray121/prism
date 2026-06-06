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
    follow = false,
    onSeek,
    onScrubStart,
    onScrubEnd,
  }: {
    rms: Profile["mix"]["rms"];
    frameRateHz: number;
    playheadSec?: number | null;
    follow?: boolean; // smooth-center the view on the playhead (while playing)
    onSeek?: (sec: number) => void;
    onScrubStart?: () => void; // pointer pressed on the plot (begin scrubbing)
    onScrubEnd?: () => void; // pointer released (commit scrub)
  } = $props();

  const HEIGHT = 400;
  const ZOOM_FACTOR = 0.75; // range multiplier per zoom-in step (deltaY < 0)

  let container: HTMLDivElement;
  let chart: uPlot | undefined;

  // While playing+zoomed, how the view tracks the playhead:
  //   center — keep the playhead centered, scrolling the waveform under it
  //   page   — let the playhead sweep across, jumping the window when it exits
  let followMode = $state<"center" | "page">("center");

  // Full time extent of the data, in seconds.
  function maxX(): number {
    return rms.data.length > 1 ? (rms.data.length - 1) / frameRateHz : 1;
  }

  // X axis is time in seconds, derived from the frame index (no timestamps stored).
  function buildData(): uPlot.AlignedData {
    const xs = rms.data.map((_, i) => i / frameRateHz);
    return [xs, rms.data];
  }

  function clamp(t: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, t));
  }

  // Time at a pointer/wheel event. Measured from the plot overlay's own rect so
  // it is correct regardless of which child element the event fired on.
  function timeAtEvent(u: uPlot, e: { clientX: number }): number {
    const rect = u.over.getBoundingClientRect();
    return u.posToVal(e.clientX - rect.left, "x");
  }

  function resetZoom() {
    chart?.setScale("x", { min: 0, max: maxX() });
  }

  // Keep the playhead visible while zoomed: smooth-center it when following
  // (playing); otherwise only re-center when it has left the view. Returns true
  // if it changed the scale (which itself redraws, so the caller skips its own).
  function trackPlayhead(): boolean {
    if (!chart || playheadSec === null) return false;
    const { min, max } = chart.scales.x;
    if (min == null || max == null) return false;
    const full = maxX();
    const range = max - min;
    if (range >= full - 1e-6) return false; // not zoomed
    const visible = playheadSec >= min && playheadSec <= max;
    if (!follow && visible) return false; // paused and in view: leave the window alone

    let nmin: number;
    let nmax: number;
    if (followMode === "page") {
      if (visible) return false; // sweep until the playhead exits, then page
      nmin = playheadSec; // bring it to the left edge
      nmax = nmin + range;
    } else {
      nmin = playheadSec - range / 2; // keep it centered
      nmax = nmin + range;
    }
    if (nmin < 0) {
      nmin = 0;
      nmax = range;
    }
    if (nmax > full) {
      nmax = full;
      nmin = full - range;
    }
    if (Math.abs(nmin - min) < 1e-9 && Math.abs(nmax - max) < 1e-9)
      return false;
    chart.setScale("x", { min: nmin, max: nmax });
    return true;
  }

  function options(): uPlot.Options {
    const grid = { stroke: "rgba(128,128,128,0.15)", width: 1 };
    return {
      width: container.clientWidth,
      height: HEIGHT,
      scales: { x: { time: false } },
      // Drag is repurposed for scrubbing the playhead; zoom is on the wheel.
      cursor: { drag: { x: false, y: false } },
      axes: [
        { stroke: "#888", grid },
        { stroke: "#888", grid },
      ],
      series: [
        {},
        { label: "RMS", stroke: "#6366f1", width: 1, points: { show: false } },
      ],
      legend: { show: false },
      // Draw the playback head as a vertical line, in uPlot's own coordinate
      // system so it stays aligned; skip it when outside the current view.
      hooks: {
        draw: [
          (u) => {
            if (playheadSec === null) return;
            const { min, max } = u.scales.x;
            if (min == null || max == null) return;
            if (playheadSec < min || playheadSec > max) return;
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

  // Drag-to-scrub and wheel-to-zoom, bound to the plot overlay.
  function attachInteractions(u: uPlot) {
    const over = u.over;
    over.style.cursor = "ew-resize";
    let seeking = false;

    const endScrub = (e: PointerEvent) => {
      if (!seeking) return;
      seeking = false;
      over.releasePointerCapture(e.pointerId);
      onSeek?.(clamp(timeAtEvent(u, e), 0, maxX()));
      onScrubEnd?.();
    };

    over.addEventListener("pointerdown", (e) => {
      seeking = true;
      over.setPointerCapture(e.pointerId);
      onScrubStart?.();
      onSeek?.(clamp(timeAtEvent(u, e), 0, maxX()));
    });
    over.addEventListener("pointermove", (e) => {
      if (seeking) onSeek?.(clamp(timeAtEvent(u, e), 0, maxX()));
    });
    over.addEventListener("pointerup", endScrub);
    over.addEventListener("pointercancel", endScrub);

    over.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const { min, max } = u.scales.x;
        if (min == null || max == null) return;
        const full = maxX();
        const range = max - min;

        // Gesture routing across devices:
        //  - trackpad pinch / ctrl+wheel -> zoom (the browser sets ctrlKey for pinch)
        //  - mouse wheel -> zoom (coarse vertical steps, line mode or large integer
        //    deltaY with no horizontal component)
        //  - trackpad two-finger scroll -> pan horizontally
        const mouseWheel =
          e.deltaMode !== 0 ||
          (e.deltaX === 0 &&
            Number.isInteger(e.deltaY) &&
            Math.abs(e.deltaY) >= 50);

        if (!e.ctrlKey && !mouseWheel) {
          if (range >= full - 1e-6) return; // not zoomed: nothing to pan
          const dv = (e.deltaX * range) / (over.clientWidth || 1);
          let nmin = min + dv;
          let nmax = max + dv;
          if (nmin < 0) {
            nmin = 0;
            nmax = range;
          }
          if (nmax > full) {
            nmax = full;
            nmin = full - range;
          }
          u.setScale("x", { min: nmin, max: nmax });
          return;
        }

        // Zoom, centered on the cursor. Pinch deltas are small and frequent, so
        // scale the step by magnitude; a mouse-wheel notch is one full step.
        const intensity = e.ctrlKey
          ? Math.min(Math.abs(e.deltaY) * 0.035, 2)
          : 1;
        const step = Math.pow(ZOOM_FACTOR, intensity);
        const nrange = e.deltaY < 0 ? range * step : range / step;
        const center = timeAtEvent(u, e);
        const leftPct = range > 0 ? (center - min) / range : 0.5;
        let nmin = center - leftPct * nrange;
        let nmax = nmin + nrange;
        if (nmax - nmin >= full) {
          nmin = 0;
          nmax = full;
        } else if (nmin < 0) {
          nmin = 0;
          nmax = nrange;
        } else if (nmax > full) {
          nmax = full;
          nmin = full - nrange;
        }
        u.setScale("x", { min: nmin, max: nmax });
      },
      { passive: false },
    );
  }

  // Create the chart once per dataset (rms/frameRateHz), tear down on change.
  $effect(() => {
    chart = new uPlot(options(), buildData(), container);
    attachInteractions(chart);
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

  // On each playhead move: track it (may rescale), else just redraw the line.
  $effect(() => {
    playheadSec;
    if (!chart) return;
    if (!trackPlayhead()) chart.redraw(false);
  });
</script>

<div class="flex flex-col gap-2">
  <div class="flex items-center justify-end gap-4 text-xs text-neutral-500">
    <button
      onclick={() => (followMode = followMode === "center" ? "page" : "center")}
      title="How the view tracks the playhead when zoomed and playing"
      class="hover:text-neutral-700 dark:hover:text-neutral-300"
    >
      Follow: {followMode === "center" ? "Center" : "Page"}
    </button>
    <button
      onclick={resetZoom}
      class="hover:text-neutral-700 dark:hover:text-neutral-300"
    >
      Reset zoom
    </button>
  </div>
  <div bind:this={container} class="w-full"></div>
</div>
