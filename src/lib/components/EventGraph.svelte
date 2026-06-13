<script lang="ts">
  import uPlot from "uplot";
  import "uplot/dist/uPlot.min.css";

  import type { EventFeature } from "$lib/ipc/messages";

  // Concrete graph for event features: vertical ticks on the shared time axis.
  // Second concrete graph type; a generic FeatureGraph waits for the third
  // (heatmap) before abstracting (see development.md). Interaction mechanics
  // mirror ContinuousGraph so the stacked graphs behave identically.
  let {
    events,
    maxTimeSec,
    color = "#6366f1",
    height = 64,
    playheadSec = null,
    follow = false,
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
    // Optional per-event text label (e.g. chord names). Returns null to skip.
    // Labels drawn in a top band; overlapping ones are dropped so density
    // resolves as you zoom in.
    labelFor?: (ev: EventFeature["events"][number]) => string | null;
    onSeek?: (sec: number) => void;
    onScrubStart?: () => void;
    onScrubEnd?: () => void;
  } = $props();

  const ZOOM_FACTOR = 0.75;

  let container: HTMLDivElement;
  let chart: uPlot | undefined;

  let followMode = $state<"center" | "page">("center");

  function maxX(): number {
    return maxTimeSec > 0 ? maxTimeSec : 1;
  }

  // Two x points anchor the scale to [0, maxX]; the y series is hidden — ticks
  // are drawn directly in the draw hook.
  function buildData(): uPlot.AlignedData {
    return [
      [0, maxX()],
      [0, 0],
    ];
  }

  function clamp(t: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, t));
  }

  function timeAtEvent(u: uPlot, e: { clientX: number }): number {
    const rect = u.over.getBoundingClientRect();
    return u.posToVal(e.clientX - rect.left, "x");
  }

  function resetZoom() {
    chart?.setScale("x", { min: 0, max: maxX() });
  }

  // Keep the playhead visible while zoomed (mirrors ContinuousGraph).
  function trackPlayhead(): boolean {
    if (!chart || playheadSec === null) return false;
    const { min, max } = chart.scales.x;
    if (min == null || max == null) return false;
    const full = maxX();
    const range = max - min;
    if (range >= full - 1e-6) return false;
    const visible = playheadSec >= min && playheadSec <= max;
    if (!follow && visible) return false;

    let nmin: number;
    let nmax: number;
    if (followMode === "page") {
      if (visible) return false;
      nmin = playheadSec;
      nmax = nmin + range;
    } else {
      nmin = playheadSec - range / 2;
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
      height,
      scales: { x: { time: false }, y: { range: [0, 1] } },
      cursor: { drag: { x: false, y: false } },
      axes: [{ stroke: "#888", grid }, { show: false }],
      series: [{}, { show: false }],
      legend: { show: false },
      hooks: {
        draw: [
          (u) => {
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
            // Playback head.
            if (playheadSec === null) return;
            if (playheadSec < min || playheadSec > max) return;
            const px = u.valToPos(playheadSec, "x", true);
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = "#ef4444";
            ctx.lineWidth = Math.round(window.devicePixelRatio || 1);
            ctx.moveTo(px, top);
            ctx.lineTo(px, bottom);
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    };
  }

  // Drag-to-scrub and wheel-to-zoom (mirrors ContinuousGraph).
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
    over.addEventListener("dblclick", resetZoom);

    over.addEventListener(
      "wheel",
      (e) => {
        const { min, max } = u.scales.x;
        if (min == null || max == null) return;
        const full = maxX();
        const range = max - min;

        // Pinch / ctrl+wheel zooms (below). A horizontal two-finger swipe pans a
        // zoomed view. Anything else is a page scroll: forward it to the viewport
        // explicitly, because the absolutely-positioned uPlot overlay swallows
        // the wheel in this webview and the page would otherwise not scroll while
        // the cursor is over a graph.
        if (!e.ctrlKey) {
          e.preventDefault();
          const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
          if (!horizontal || range >= full - 1e-6) {
            const k =
              e.deltaMode === 1
                ? 16
                : e.deltaMode === 2
                  ? window.innerHeight
                  : 1;
            window.scrollBy(e.deltaX * k, e.deltaY * k);
            return;
          }
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

        // Pinch / ctrl+wheel: zoom centered on the cursor.
        e.preventDefault();
        const intensity = Math.min(Math.abs(e.deltaY) * 0.035, 2);
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

  // Create the chart once per dataset, tear down on change.
  $effect(() => {
    chart = new uPlot(options(), buildData(), container);
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

  // Redraw on playhead move (tracking may rescale, which redraws anyway).
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
