<script lang="ts">
  import uPlot from "uplot";
  import "uplot/dist/uPlot.min.css";

  import type { SegmentFeature } from "$lib/ipc/messages";

  // Concrete graph for segment features: labeled time spans drawn as colored
  // bands on the shared time axis. Interaction mechanics mirror EventGraph /
  // ContinuousGraph so the stacked graphs behave identically (shared-layer
  // consolidation is deferred to M6).
  let {
    segments,
    maxTimeSec,
    height = 64,
    playheadSec = null,
    follow = false,
    onSeek,
    onScrubStart,
    onScrubEnd,
  }: {
    segments: SegmentFeature["segments"];
    maxTimeSec: number; // full time extent, from the timeline
    height?: number;
    playheadSec?: number | null;
    follow?: boolean;
    onSeek?: (sec: number) => void;
    onScrubStart?: () => void;
    onScrubEnd?: () => void;
  } = $props();

  const ZOOM_FACTOR = 0.75;

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

  let container: HTMLDivElement;
  let chart: uPlot | undefined;

  let followMode = $state<"center" | "page">("center");

  function maxX(): number {
    return maxTimeSec > 0 ? maxTimeSec : 1;
  }

  // Two x points anchor the scale to [0, maxX]; the y series is hidden — bands
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
            const bandTop = top + 4 * dpr;
            ctx.save();
            ctx.font = `${Math.round(11 * dpr)}px ui-sans-serif, system-ui, sans-serif`;
            ctx.textBaseline = "middle";
            for (const seg of segments) {
              if (seg.end < min || seg.start > max) continue;
              const x0 = u.valToPos(Math.max(seg.start, min), "x", true);
              const x1 = u.valToPos(Math.min(seg.end, max), "x", true);
              const color = labelColors.get(seg.label) ?? PALETTE[0];
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
              // Label inside the band when it fits.
              const label = seg.label;
              if (label) {
                const w = ctx.measureText(label).width;
                if (w + 8 * dpr < x1 - x0) {
                  ctx.fillStyle = color;
                  ctx.fillText(label, x0 + 4 * dpr, (bandTop + bottom) / 2);
                }
              }
            }
            ctx.restore();
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
        e.preventDefault();
        const { min, max } = u.scales.x;
        if (min == null || max == null) return;
        const full = maxX();
        const range = max - min;

        const mouseWheel =
          e.deltaMode !== 0 ||
          (e.deltaX === 0 &&
            Number.isInteger(e.deltaY) &&
            Math.abs(e.deltaY) >= 50);

        if (!e.ctrlKey && !mouseWheel) {
          if (range >= full - 1e-6) return;
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
