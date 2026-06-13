<script lang="ts">
  import { convertFileSrc } from "@tauri-apps/api/core";
  import uPlot from "uplot";
  import "uplot/dist/uPlot.min.css";

  import { parseNpy, type Npy } from "$lib/npy";

  // Concrete graph for heatmap features: a 2D matrix loaded from a .npy sidecar,
  // rendered as a colormapped image in a uPlot draw hook (third concrete graph
  // type). Interaction mechanics mirror Continuous/EventGraph.
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

  const ZOOM_FACTOR = 0.75;

  let container: HTMLDivElement;
  let chart: uPlot | undefined;
  let matrix = $state<Npy | null>(null);
  let offscreen: HTMLCanvasElement | null = null;
  let followMode = $state<"center" | "page">("center");

  function maxX(): number {
    const frames = matrix ? matrix.shape[1] : 0;
    return frames > 1 ? (frames - 1) / frameRateHz : 1;
  }

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

  // Perceptual-ish colormap (inferno-like) for a normalized value in [0,1].
  const STOPS: [number, number, number, number][] = [
    [0.0, 0, 0, 4],
    [0.25, 60, 15, 110],
    [0.5, 160, 40, 100],
    [0.75, 230, 110, 40],
    [1.0, 250, 250, 180],
  ];
  function color(t: number): [number, number, number] {
    for (let i = 1; i < STOPS.length; i++) {
      if (t <= STOPS[i][0]) {
        const [t0, r0, g0, b0] = STOPS[i - 1];
        const [t1, r1, g1, b1] = STOPS[i];
        const f = (t - t0) / (t1 - t0 || 1);
        return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f];
      }
    }
    return [STOPS[STOPS.length - 1][1], 250, 180];
  }

  // Render the matrix once into a native-resolution offscreen canvas (cols×rows);
  // the draw hook scales the relevant slice of it into the plot each frame.
  // Normalization (per-row vs global) is chosen per feature: per-row keeps each
  // coefficient legible when scales differ (mfcc's energy row 0); global keeps
  // the true relative magnitudes (a spectrogram's loudness across frequencies).
  function buildOffscreen(m: Npy): HTMLCanvasElement {
    const [rows, cols] = m.shape;
    let globalLo = Infinity;
    let globalHi = -Infinity;
    if (normalize === "global") {
      for (let i = 0; i < m.data.length; i++) {
        const v = m.data[i];
        if (v < globalLo) globalLo = v;
        if (v > globalHi) globalHi = v;
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(cols, rows);
    for (let r = 0; r < rows; r++) {
      let lo = globalLo;
      let hi = globalHi;
      if (normalize === "per-row") {
        lo = Infinity;
        hi = -Infinity;
        for (let c = 0; c < cols; c++) {
          const v = m.data[r * cols + c];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      const span = hi - lo || 1;
      const y = rows - 1 - r; // low row index at the bottom
      for (let c = 0; c < cols; c++) {
        const [cr, cg, cb] = color((m.data[r * cols + c] - lo) / span);
        const idx = (y * cols + c) * 4;
        img.data[idx] = cr;
        img.data[idx + 1] = cg;
        img.data[idx + 2] = cb;
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  // Keep the playhead visible while zoomed (mirrors Continuous/EventGraph).
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
            const { left, top, width, height: h } = u.bbox;
            // Blit the visible time slice of the heatmap into the plot area.
            if (offscreen && matrix) {
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
            // Playback head.
            if (playheadSec === null) return;
            if (playheadSec < min || playheadSec > max) return;
            const px = u.valToPos(playheadSec, "x", true);
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = "#ef4444";
            ctx.lineWidth = Math.round(window.devicePixelRatio || 1);
            ctx.moveTo(px, top);
            ctx.lineTo(px, top + h);
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    };
  }

  // Drag-to-scrub and wheel-to-zoom (mirrors Continuous/EventGraph).
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

  // Load + parse the sidecar whenever the path changes.
  $effect(() => {
    const p = path;
    matrix = null;
    offscreen = null;
    let cancelled = false;
    (async () => {
      const resp = await fetch(convertFileSrc(p));
      const buf = await resp.arrayBuffer();
      const m = parseNpy(buf);
      if (cancelled) return;
      offscreen = buildOffscreen(m);
      matrix = m;
    })();
    return () => {
      cancelled = true;
    };
  });

  // Create the chart once the matrix is loaded (its shape sets the x extent).
  $effect(() => {
    if (!matrix || !container) return;
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
