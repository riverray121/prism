<script lang="ts">
  import { oklchToRgb } from "$lib/color";
  import {
    channelColor,
    DEFAULT_PIXELS,
    litMask,
    type ProgramOutput,
  } from "$lib/mapping/evaluate";
  import { programLabel } from "$lib/mapping/labels";
  import { inspection } from "$lib/state/inspection.svelte";
  import { audition, evaluation, mapping } from "$lib/state/mapping.svelte";
  import { transport } from "$lib/state/transport.svelte";

  // The feel check: each program rendered as its own generic light (glowing
  // swatch + pixel row) animating at the transport clock. One program = one
  // light — combining programs onto one fixture is a patching decision, not
  // a preview default. The derivation editor's audition joins as an extra
  // light while it's open.

  const W = 128;
  const H = 92;

  const frameCount = $derived(inspection.profile?.timeline.frame_count ?? 0);
  const frameRateHz = $derived(
    inspection.profile?.timeline.frame_rate_hz ?? 100,
  );

  interface Light {
    id: string;
    label: string;
    output: ProgramOutput;
    mask: Float32Array;
  }

  const lights = $derived.by(() => {
    const out: Light[] = [];
    for (const p of mapping.doc?.programs ?? []) {
      const output = evaluation.outputs[p.id];
      if (output)
        out.push({
          id: p.id,
          label: programLabel(p),
          output,
          mask: litMask(output.gate, frameCount, frameRateHz),
        });
    }
    if (audition.output) {
      out.push({
        id: "__audition",
        label: "derivation",
        output: audition.output,
        mask: litMask(audition.output.gate, frameCount, frameRateHz),
      });
    }
    return out;
  });

  let canvases = $state<Record<string, HTMLCanvasElement | undefined>>({});

  function drawLight(
    canvas: HTMLCanvasElement,
    light: Light,
    t: number,
    frame: number,
  ): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { output, mask } = light;
    const lit = mask[frame];
    const b = output.channels.brightness
      ? output.channels.brightness[frame]
      : 1;
    let s = lit > 0 ? Math.min(1, (0.12 + 1.05 * b) * lit) : 0;
    // Strobe: hard on/off square wave at the bound rate.
    const rate = output.channels.strobe_rate
      ? output.channels.strobe_rate[frame]
      : 0;
    if (rate > 0 && (t * rate) % 1 >= 0.5) s = 0;

    const c = oklchToRgb(channelColor(output.channels, frame));
    const R = Math.min(1, c.r * s);
    const G = Math.min(1, c.g * s);
    const B = Math.min(1, c.b * s);
    const css = `rgb(${Math.round(R * 255)},${Math.round(G * 255)},${Math.round(B * 255)})`;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0a0a0c";
    ctx.fillRect(0, 0, W, H);

    // Swatch with glow; a white-hot core near full intensity so maximum
    // brightness reads as blinding, not just colored.
    ctx.save();
    ctx.shadowColor = css;
    ctx.shadowBlur = 40 * s;
    ctx.fillStyle = css;
    ctx.beginPath();
    ctx.arc(W / 2, 36, 22, 0, Math.PI * 2);
    ctx.fill();
    if (s > 0.75) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(255,255,255,${(s - 0.75) * 2.4})`;
      ctx.beginPath();
      ctx.arc(W / 2, 36, 11, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Pixel row: the program's own matrix, else the swatch mirrored.
    const N = DEFAULT_PIXELS;
    const rowY = H - 18;
    const cell = W / N;
    for (let p = 0; p < N; p++) {
      if (output.pixels) {
        const idx = (frame * N + p) * 3;
        const rgb = output.pixels.rgb;
        ctx.fillStyle = `rgb(${rgb[idx]},${rgb[idx + 1]},${rgb[idx + 2]})`;
      } else {
        ctx.fillStyle = css;
      }
      ctx.fillRect(p * cell, rowY, Math.max(1, cell - 0.5), 12);
    }
  }

  function draw(): void {
    if (frameCount === 0) return;
    const t = transport.currentTime;
    const frame = Math.max(
      0,
      Math.min(frameCount - 1, Math.round(t * frameRateHz)),
    );
    for (const light of lights) {
      const canvas = canvases[light.id];
      if (canvas) drawLight(canvas, light, t, frame);
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
    lights;
    transport.currentTime;
    if (!transport.playing) draw();
  });
</script>

<div
  class="flex max-w-72 shrink-0 flex-col items-center gap-2 rounded border border-edge bg-surface p-2"
>
  {#if lights.length === 0}
    <p class="px-3 py-6 text-xs text-ink-faint">
      Lights appear here as you add programs.
    </p>
  {:else}
    <div class="flex flex-wrap justify-center gap-2">
      {#each lights as light (light.id)}
        <div class="flex flex-col items-center gap-0.5">
          <canvas bind:this={canvases[light.id]} width={W} height={H}></canvas>
          <p class="max-w-32 truncate text-xs text-ink-faint">{light.label}</p>
        </div>
      {/each}
    </div>
  {/if}
  <p class="text-xs text-ink-faint">Live lights — one per program</p>
</div>
