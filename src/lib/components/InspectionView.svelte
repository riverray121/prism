<script lang="ts">
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { onDestroy } from "svelte";

  import ContinuousGraph from "$lib/components/ContinuousGraph.svelte";
  import type { ContinuousFeature, ScalarFeature } from "$lib/ipc/messages";
  import { close, inspection } from "$lib/state/inspection.svelte";

  // Playback uses the Web Audio API: the file is decoded into an AudioBuffer and
  // played through an AudioBufferSourceNode. The playhead is derived from
  // AudioContext.currentTime — the clock that generates the sound — so the two
  // can never drift, and seeking restarts the source at an exact offset.

  let currentTime = $state(0);
  let playing = $state(false);
  let audioBuffer = $state<AudioBuffer | null>(null);

  let ctx: AudioContext | undefined;
  let source: AudioBufferSourceNode | undefined;
  let startCtxTime = 0; // ctx.currentTime when the current source started
  let startOffset = 0; // buffer offset the current source started from
  let raf: number | null = null;

  function ensureCtx(): AudioContext {
    if (!ctx) ctx = new AudioContext();
    return ctx;
  }

  function duration(): number {
    return audioBuffer?.duration ?? inspection.profile?.song.duration_sec ?? 0;
  }

  // Current playback position from the audio clock while playing, else the held position.
  function positionNow(): number {
    if (!ctx || !playing) return currentTime;
    return Math.min(startOffset + (ctx.currentTime - startCtxTime), duration());
  }

  function startSource(offset: number) {
    const context = ensureCtx();
    const node = context.createBufferSource();
    node.buffer = audioBuffer;
    node.connect(context.destination);
    node.onended = onSourceEnded;
    startOffset = offset;
    startCtxTime = context.currentTime;
    node.start(0, offset);
    source = node;
  }

  function stopSource() {
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // already stopped
    }
    source.disconnect();
    source = undefined;
  }

  function cancelRaf() {
    if (raf !== null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
  }

  // Fires when a source finishes on its own (reached the end).
  function onSourceEnded() {
    stopSource();
    cancelRaf();
    playing = false;
    currentTime = 0;
  }

  function tick() {
    currentTime = positionNow();
    if (currentTime >= duration()) {
      onSourceEnded();
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  async function play() {
    if (!audioBuffer) return;
    await ensureCtx().resume();
    if (currentTime >= duration()) currentTime = 0;
    startSource(currentTime);
    playing = true;
    tick();
  }

  function pause() {
    currentTime = positionNow();
    stopSource();
    cancelRaf();
    playing = false;
  }

  function togglePlay() {
    if (playing) pause();
    else play();
  }

  // Scrubbing: while dragging, audio is silenced (no per-move source restarts,
  // which would pop) and only the playhead moves; playback resumes from the
  // final position on release if it was playing beforehand.
  let resumeAfterScrub = false;

  function scrubStart() {
    resumeAfterScrub = playing;
    if (playing) pause();
  }

  function scrub(sec: number) {
    currentTime = Math.max(0, Math.min(duration(), sec));
  }

  function scrubEnd() {
    if (resumeAfterScrub) play();
    resumeAfterScrub = false;
  }

  // Decode the audio whenever the open song changes; reset playback state.
  $effect(() => {
    const path = inspection.audioPath;
    stopSource();
    cancelRaf();
    playing = false;
    currentTime = 0;
    audioBuffer = null;
    if (!path) return;
    let cancelled = false;
    (async () => {
      const resp = await fetch(convertFileSrc(path));
      const bytes = await resp.arrayBuffer();
      const decoded = await ensureCtx().decodeAudioData(bytes);
      if (!cancelled) audioBuffer = decoded;
    })();
    return () => {
      cancelled = true;
    };
  });

  onDestroy(() => {
    stopSource();
    cancelRaf();
    ctx?.close();
  });

  // Split the keyed mix map into scalar (text) and continuous (graph) features,
  // each preserving the profile's insertion order.
  const features = $derived(
    inspection.profile ? Object.entries(inspection.profile.mix) : [],
  );
  const scalars = $derived(
    features.filter(
      (e): e is [string, ScalarFeature] => e[1].render === "scalar",
    ),
  );
  const continuous = $derived(
    features.filter(
      (e): e is [string, ContinuousFeature] => e[1].render === "continuous",
    ),
  );

  // Line colors cycled across the stacked continuous graphs for distinction.
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

  // "spectral_centroid" -> "Spectral centroid".
  function humanize(name: string): string {
    const s = name.replace(/_/g, " ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function formatScalar(f: ScalarFeature): string {
    if (typeof f.value === "string") return f.value;
    const n = f.unit === "normalized" ? f.value.toFixed(2) : f.value.toFixed(1);
    const unit =
      f.unit === "normalized" || f.unit === "key" ? "" : ` ${f.unit}`;
    return `${n}${unit}`;
  }

  function formatTime(seconds: number): string {
    const total = Math.floor(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
</script>

<section class="flex w-full max-w-4xl flex-col gap-6">
  <button
    onclick={close}
    class="self-start text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
  >
    ← Library
  </button>

  {#if inspection.profile === null}
    <p class="text-sm text-neutral-500">Loading…</p>
  {:else}
    {@const song = inspection.profile.song}
    <header>
      <h2 class="text-2xl font-semibold tracking-tight">{song.title}</h2>
      <p class="text-sm text-neutral-500 dark:text-neutral-400">
        {song.artist}
      </p>
    </header>

    <!-- Playback transport -->
    <div class="flex items-center gap-3">
      <button
        onclick={togglePlay}
        disabled={!audioBuffer}
        class="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {playing ? "Pause" : "Play"}
      </button>
      <span class="text-sm tabular-nums text-neutral-500 dark:text-neutral-400">
        {formatTime(currentTime)} / {formatTime(duration())}
      </span>
    </div>

    <!-- Scalar features: one value each, shown as a labeled grid. -->
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {#each scalars as [name, feature] (name)}
        <div
          class="rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            {humanize(name)}
          </p>
          <p class="text-xl font-semibold tabular-nums">
            {formatScalar(feature)}
          </p>
        </div>
      {/each}
    </div>

    <!-- Continuous features: stacked line graphs sharing the playhead/scrub. -->
    <div class="flex flex-col gap-4">
      {#each continuous as [name, feature], i (name)}
        <div
          class="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <p class="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
            {humanize(name)}
            <span class="text-neutral-400 dark:text-neutral-600"
              >· {feature.unit}</span
            >
          </p>
          <ContinuousGraph
            {feature}
            frameRateHz={inspection.profile.timeline.frame_rate_hz}
            label={name}
            color={PALETTE[i % PALETTE.length]}
            playheadSec={currentTime}
            follow={playing}
            onSeek={scrub}
            onScrubStart={scrubStart}
            onScrubEnd={scrubEnd}
          />
        </div>
      {/each}
    </div>
  {/if}
</section>
