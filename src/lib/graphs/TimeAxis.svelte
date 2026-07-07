<script lang="ts">
  import uPlot from "uplot";
  import "uplot/dist/uPlot.min.css";

  import {
    clamp,
    followed,
    panned,
    wheelDeltaScale,
    zoomed,
  } from "$lib/graphs/axis";

  // The shared interactive time axis: uPlot lifecycle, drag-to-scrub,
  // wheel pan/zoom, playhead draw + follow, and the footer controls. Renderers
  // supply only their data, series, and an optional custom draw pass — they
  // know nothing about interaction, and this shell knows nothing about data
  // shape.
  let {
    data,
    series,
    maxTimeSec,
    height = 120,
    yRange = null,
    showYAxis = true,
    showXAxis = true,
    showControls = true,
    draw = null,
    playheadSec = null,
    follow = false,
    onSeek,
    onScrubStart,
    onScrubEnd,
  }: {
    data: uPlot.AlignedData;
    series: uPlot.Series[];
    maxTimeSec: number; // full time extent of the x axis
    height?: number;
    yRange?: [number, number] | null; // fixed y scale (renderers that self-draw)
    showYAxis?: boolean;
    showXAxis?: boolean; // off for sub-lanes that ride under a parent lane
    showControls?: boolean; // Follow/Reset footer; off for minimal sub-lanes
    draw?: ((u: uPlot) => void) | null; // renderer pass, drawn under the playhead
    playheadSec?: number | null;
    follow?: boolean; // smooth-center the view on the playhead (while playing)
    onSeek?: (sec: number) => void;
    onScrubStart?: () => void; // pointer pressed on the plot (begin scrubbing)
    onScrubEnd?: () => void; // pointer released (commit scrub)
  } = $props();

  let container: HTMLDivElement;
  let chart: uPlot | undefined;

  // How the view tracks the playhead when zoomed and playing (see axis.ts).
  let followMode = $state<"center" | "page">("center");

  function maxX(): number {
    return maxTimeSec > 0 ? maxTimeSec : 1;
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

  // Keep the playhead visible while zoomed. Returns true if it changed the
  // scale (which itself redraws, so the caller skips its own).
  function trackPlayhead(): boolean {
    if (!chart || playheadSec === null) return false;
    const { min, max } = chart.scales.x;
    if (min == null || max == null) return false;
    const win = followed(min, max, maxX(), playheadSec, followMode, follow);
    if (!win) return false;
    chart.setScale("x", win);
    return true;
  }

  // Draw the playback head as a vertical line, in uPlot's own coordinate
  // system so it stays aligned; skip it when outside the current view.
  function drawPlayhead(u: uPlot) {
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
  }

  function options(): uPlot.Options {
    const grid = { stroke: "rgba(128,128,128,0.15)", width: 1 };
    // Larger than uPlot's default so tick labels stay readable on dense lanes.
    const font = "13px ui-sans-serif, system-ui, sans-serif";
    return {
      width: container.clientWidth,
      height,
      scales: {
        x: { time: false },
        ...(yRange ? { y: { range: yRange } } : {}),
      },
      // Drag is repurposed for scrubbing the playhead; zoom is on the wheel.
      cursor: { drag: { x: false, y: false } },
      axes: [
        showXAxis ? { stroke: "#888", grid, font } : { show: false },
        showYAxis ? { stroke: "#888", grid, font } : { show: false },
      ],
      series,
      legend: { show: false },
      hooks: {
        draw: [
          (u) => {
            draw?.(u);
            drawPlayhead(u);
          },
        ],
      },
    };
  }

  // Nearest ancestor that can actually scroll vertically; the tab panes own
  // their scrolling, so window-level scrollBy would be a no-op.
  function scrollParentOf(el: Element): Element | null {
    for (let n = el.parentElement; n; n = n.parentElement) {
      if (n.scrollHeight <= n.clientHeight) continue;
      const overflowY = getComputedStyle(n).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") return n;
    }
    return null;
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

    // Double-click resets the zoom to the full time extent.
    over.addEventListener("dblclick", resetZoom);

    over.addEventListener(
      "wheel",
      (e) => {
        const { min, max } = u.scales.x;
        if (min == null || max == null) return;
        const full = maxX();
        const range = max - min;

        // Gesture routing:
        //  - pinch / ctrl+wheel (ctrlKey) -> zoom (below)
        //  - horizontal two-finger swipe on a zoomed view -> pan
        //  - anything else -> scroll, forwarded to the nearest scrollable
        //    ancestor explicitly because the absolutely-positioned uPlot
        //    overlay swallows the wheel in this webview (scrolling would
        //    otherwise go dead while the cursor is over a graph)
        if (!e.ctrlKey) {
          e.preventDefault();
          const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
          const k = wheelDeltaScale(e.deltaMode, window.innerHeight);
          if (!horizontal || range >= full - 1e-6) {
            scrollParentOf(over)?.scrollBy(e.deltaX * k, e.deltaY * k);
            return;
          }
          const dv = (e.deltaX * k * range) / (over.clientWidth || 1);
          u.setScale("x", panned(min, max, full, dv));
          return;
        }

        e.preventDefault();
        u.setScale("x", zoomed(min, max, full, timeAtEvent(u, e), e.deltaY));
      },
      { passive: false },
    );
  }

  // Create the chart once per dataset, tear down on change.
  $effect(() => {
    chart = new uPlot(options(), data, container);
    attachInteractions(chart);
    const ro = new ResizeObserver(() =>
      chart?.setSize({ width: container.clientWidth, height }),
    );
    ro.observe(container);
    return () => {
      ro.disconnect();
      chart?.destroy();
      chart = undefined;
    };
  });

  // On each playhead move: track it (may rescale), else just redraw.
  $effect(() => {
    playheadSec;
    if (!chart) return;
    if (!trackPlayhead()) chart.redraw(false);
  });
</script>

<div class="flex flex-col gap-2">
  {#if showControls}
    <div class="flex items-center justify-end gap-4 text-xs text-ink-muted">
      <button
        onclick={() =>
          (followMode = followMode === "center" ? "page" : "center")}
        title="How the view tracks the playhead when zoomed and playing"
        class="hover:text-ink"
      >
        Follow: {followMode === "center" ? "Center" : "Page"}
      </button>
      <button onclick={resetZoom} class="hover:text-ink"> Reset zoom </button>
    </div>
  {/if}
  <div bind:this={container} class="w-full"></div>
</div>
