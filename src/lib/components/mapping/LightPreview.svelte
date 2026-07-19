<script lang="ts">
  import { oklchToRgb } from "$lib/color";
  import {
    channelColor,
    DEFAULT_PIXELS,
    litMask,
    type ProgramOutput,
  } from "$lib/mapping/evaluate";
  import { inspection } from "$lib/state/inspection.svelte";
  import { audition, evaluation, mapping } from "$lib/state/mapping.svelte";
  import { transport } from "$lib/state/transport.svelte";

  // The feel check: a rendered generic light (glowing swatch + pixel row)
  // animating at the transport clock. Ribbons diagnose; this confirms.
  // All enabled programs blend additively — the macro layer (slice 8) is
  // applied upstream in the evaluated outputs.

  const WIDTH = 260;
  const HEIGHT = 128;

  let canvas: HTMLCanvasElement | undefined;

  const frameCount = $derived(inspection.profile?.timeline.frame_count ?? 0);
  const frameRateHz = $derived(
    inspection.profile?.timeline.frame_rate_hz ?? 100,
  );

  // Evaluated programs with their lit masks, recomputed per evaluation. The
  // derivation editor's audition layer (its live threshold result) blends in
  // on top while it's open.
  const sampled = $derived.by(() => {
    const out: { output: ProgramOutput; mask: Float32Array }[] = [];
    for (const p of mapping.doc?.programs ?? []) {
      const output = evaluation.outputs[p.id];
      if (output)
        out.push({
          output,
          mask: litMask(output.gate, frameCount, frameRateHz),
        });
    }
    if (audition.output) {
      out.push({
        output: audition.output,
        mask: litMask(audition.output.gate, frameCount, frameRateHz),
      });
    }
    return out;
  });

  function draw(): void {
    if (!canvas || frameCount === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const t = transport.currentTime;
    const frame = Math.max(
      0,
      Math.min(frameCount - 1, Math.round(t * frameRateHz)),
    );

    // Composite the point channels of every program into one light color.
    let R = 0;
    let G = 0;
    let B = 0;
    for (const { output, mask } of sampled) {
      const lit = mask[frame];
      if (lit <= 0) continue;
      const b = output.channels.brightness
        ? output.channels.brightness[frame]
        : 1;
      let s = (0.1 + 0.9 * b) * lit;
      // Strobe: hard on/off square wave at the bound rate.
      const rate = output.channels.strobe_rate
        ? output.channels.strobe_rate[frame]
        : 0;
      if (rate > 0 && (t * rate) % 1 >= 0.5) s = 0;
      if (s <= 0) continue;
      const c = oklchToRgb(channelColor(output.channels, frame));
      R += c.r * s;
      G += c.g * s;
      B += c.b * s;
    }
    const intensity = Math.min(1, Math.max(R, G, B));
    R = Math.min(1, R);
    G = Math.min(1, G);
    B = Math.min(1, B);
    const css = `rgb(${Math.round(R * 255)},${Math.round(G * 255)},${Math.round(B * 255)})`;

    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "#0a0a0c";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Swatch: the light itself, glow scaling with intensity.
    ctx.save();
    ctx.shadowColor = css;
    ctx.shadowBlur = 36 * intensity;
    ctx.fillStyle = css;
    ctx.beginPath();
    ctx.arc(WIDTH / 2, 48, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Pixel row: programs with a pixel matrix blend additively; if none has
    // one, the strip mirrors the swatch.
    const N = DEFAULT_PIXELS;
    const rowY = HEIGHT - 26;
    const cell = WIDTH / N;
    const withPixels = sampled.filter(({ output }) => output.pixels);
    for (let p = 0; p < N; p++) {
      let r = 0;
      let g = 0;
      let b = 0;
      if (withPixels.length > 0) {
        for (const { output } of withPixels) {
          const idx = (frame * N + p) * 3;
          const rgb = output.pixels!.rgb;
          r += rgb[idx] / 255;
          g += rgb[idx + 1] / 255;
          b += rgb[idx + 2] / 255;
        }
      } else {
        r = R;
        g = G;
        b = B;
      }
      ctx.fillStyle = `rgb(${Math.round(Math.min(1, r) * 255)},${Math.round(
        Math.min(1, g) * 255,
      )},${Math.round(Math.min(1, b) * 255)})`;
      ctx.fillRect(p * cell + 0.5, rowY, cell - 1, 16);
    }
  }

  // rAF loop while playing; the cleanup on unmount (or pause) stops it — no
  // leaked frames when the tab switches away.
  $effect(() => {
    if (!transport.playing) return;
    let raf = 0;
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  });

  // Paused: a static frame at the playhead, redrawn on scrub or re-evaluation.
  $effect(() => {
    sampled;
    transport.currentTime;
    if (!transport.playing) draw();
  });
</script>

<div
  class="flex shrink-0 flex-col items-center gap-1 rounded border border-edge bg-surface p-2"
>
  <canvas bind:this={canvas} width={WIDTH} height={HEIGHT}></canvas>
  <p class="text-xs text-ink-faint">Live light</p>
</div>
