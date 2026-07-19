<script lang="ts">
  import { untrack } from "svelte";
  import uPlot from "uplot";
  import "uplot/dist/uPlot.min.css";

  import {
    clamp,
    type FollowMode,
    followed,
    panned,
    wheelDeltaScale,
    type Win,
    zoomed,
  } from "$lib/graphs/axis";

  // The shared interactive time axis: uPlot lifecycle, drag-to-scrub,
  // wheel pan/zoom, playhead draw + follow. Renderers supply only their data,
  // series, and an optional custom draw pass — they know nothing about
  // interaction, and this shell knows nothing about data shape.
  //
  // The x-window is controlled: `window` comes in as a prop (null = full
  // extent) and every zoom/pan/follow intent goes out through
  // `onWindowChange`. Lanes wired to the shared view state therefore move
  // together; lanes without `onWindowChange` (overviews) stay at full extent.
  let {
    data,
    series,
    maxTimeSec,
    height = 120,
    yRange = null,
    showYAxis = true,
    showXAxis = true,
    draw = null,
    playheadSec = null,
    follow = false,
    window: win = null,
    followMode = "center",
    onWindowChange,
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
    draw?: ((u: uPlot) => void) | null; // renderer pass, drawn under the playhead
    playheadSec?: number | null;
    follow?: boolean; // smooth-center the view on the playhead (while playing)
    window?: Win | null; // controlled x-window; null = full extent
    followMode?: FollowMode;
    onWindowChange?: (win: Win | null) => void; // zoom/pan/follow intents; absent = fixed full extent
    onSeek?: (sec: number) => void;
    onScrubStart?: () => void; // pointer pressed on the plot (begin scrubbing)
    onScrubEnd?: () => void; // pointer released (commit scrub)
  } = $props();

  let container: HTMLDivElement;
  let chart: uPlot | undefined;

  function maxX(): number {
    return maxTimeSec > 0 ? maxTimeSec : 1;
  }

  // A window spanning the full extent is canonically null, so "not zoomed"
  // compares equal regardless of which lane produced it.
  function emitWindow(w: Win): void {
    if (w.max - w.min >= maxX() - 1e-6) onWindowChange?.(null);
    else onWindowChange?.(w);
  }

  // Time at a pointer/wheel event. Measured from the plot overlay's own rect so
  // it is correct regardless of which child element the event fired on.
  function timeAtEvent(u: uPlot, e: { clientX: number }): number {
    const rect = u.over.getBoundingClientRect();
    return u.posToVal(e.clientX - rect.left, "x");
  }

  // Push the controlled window into uPlot's x scale.
  function applyWindow(): void {
    chart?.setScale("x", win ?? { min: 0, max: maxX() });
  }

  // Keep the playhead visible while zoomed. Emits the new window instead of
  // rescaling directly — the change flows back through the prop, so every
  // lane sharing the window moves in the same flush. Returns true when a
  // change was emitted (the round-trip redraws, so the caller skips its own).
  function trackPlayhead(): boolean {
    if (!chart || playheadSec === null || !onWindowChange) return false;
    const { min, max } = chart.scales.x;
    if (min == null || max == null) return false;
    const w = followed(min, max, maxX(), playheadSec, followMode, follow);
    if (!w) return false;
    onWindowChange(w);
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
    ctx.lineWidth = Math.round(globalThis.devicePixelRatio || 1);
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
    over.addEventListener("dblclick", () => onWindowChange?.(null));

    over.addEventListener(
      "wheel",
      (e) => {
        const { min, max } = u.scales.x;
        if (min == null || max == null) return;
        const full = maxX();
        const range = max - min;
        const zoomable = onWindowChange !== undefined;

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
          const k = wheelDeltaScale(e.deltaMode, globalThis.innerHeight);
          if (!horizontal || !zoomable || range >= full - 1e-6) {
            scrollParentOf(over)?.scrollBy(e.deltaX * k, e.deltaY * k);
            return;
          }
          const dv = (e.deltaX * k * range) / (over.clientWidth || 1);
          emitWindow(panned(min, max, full, dv));
          return;
        }

        if (!zoomable) return;
        e.preventDefault();
        emitWindow(zoomed(min, max, full, timeAtEvent(u, e), e.deltaY));
      },
      { passive: false },
    );
  }

  // A lane inside a display:none ancestor (the kept-mounted hidden tab).
  // Drawing there is pure waste — playhead ticks and zooms across dozens of
  // hidden lanes are what make visible zooming lag — so redraw paths bail;
  // the ResizeObserver catches the un-hide and repaints.
  function isHidden(): boolean {
    return !container || container.offsetParent === null;
  }

  // Create the chart once per dataset, tear down on change. options() is
  // untracked so a renderer handing over a new draw closure (fresh content)
  // repaints in place below instead of recreating the chart; the controlled
  // window is untracked so zooming never recreates it either.
  $effect(() => {
    chart = new uPlot(untrack(options), data, container);
    attachInteractions(chart);
    untrack(applyWindow);
    const ro = new ResizeObserver(() => {
      if (!chart) return;
      chart.setSize({ width: container.clientWidth, height });
      // Un-hidden lanes resize from 0: catch up on the window (and playhead)
      // changes they skipped while hidden.
      untrack(applyWindow);
    });
    ro.observe(container);
    return () => {
      ro.disconnect();
      chart?.destroy();
      chart = undefined;
    };
  });

  // Renderer content changed (new draw identity): repaint in place. This is
  // what makes value-line toggles, cutoff slider drags, and re-evaluations
  // show up immediately — closures capture their data, so a content change
  // arrives here as a new function.
  $effect(() => {
    draw;
    chart?.redraw(false);
  });

  // Window prop changes rescale in place (setScale redraws).
  $effect(() => {
    win;
    if (isHidden()) return;
    applyWindow();
  });

  // On each playhead move: track it (the emitted window redraws), else redraw.
  $effect(() => {
    playheadSec;
    if (!chart || isHidden()) return;
    if (!trackPlayhead()) chart.redraw(false);
  });
</script>

<div bind:this={container} class="w-full"></div>
