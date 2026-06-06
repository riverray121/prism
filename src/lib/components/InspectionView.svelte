<script lang="ts">
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { onDestroy } from "svelte";

  import RmsGraph from "$lib/components/RmsGraph.svelte";
  import { close, inspection } from "$lib/state/inspection.svelte";

  let audioEl = $state<HTMLAudioElement>();
  let currentTime = $state(0);
  let playing = $state(false);
  let raf: number | null = null;

  // Asset-protocol URL the WebView can load; empty until the path arrives.
  let audioSrc = $derived(
    inspection.audioPath ? convertFileSrc(inspection.audioPath) : "",
  );

  // Poll playback time each frame while playing; this drives the playhead.
  function tick() {
    if (!audioEl) return;
    currentTime = audioEl.currentTime;
    if (!audioEl.paused && !audioEl.ended) {
      raf = requestAnimationFrame(tick);
    }
  }

  function togglePlay() {
    if (!audioEl) return;
    if (audioEl.paused) audioEl.play();
    else audioEl.pause();
  }

  function onPlay() {
    playing = true;
    tick();
  }

  function onPause() {
    playing = false;
    if (raf !== null) cancelAnimationFrame(raf);
  }

  function onEnded() {
    playing = false;
    currentTime = 0;
  }

  // Stop playback if the view is torn down (e.g. navigating back).
  onDestroy(() => {
    audioEl?.pause();
    if (raf !== null) cancelAnimationFrame(raf);
  });

  function formatBpm(value: number): string {
    return value.toFixed(1);
  }

  function formatTime(seconds: number): string {
    const total = Math.floor(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
</script>

<section class="flex w-full max-w-2xl flex-col gap-6">
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
        class="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
      >
        {playing ? "Pause" : "Play"}
      </button>
      <span class="text-sm tabular-nums text-neutral-500 dark:text-neutral-400">
        {formatTime(currentTime)} / {formatTime(song.duration_sec ?? 0)}
      </span>
      <audio
        bind:this={audioEl}
        src={audioSrc}
        onplay={onPlay}
        onpause={onPause}
        onended={onEnded}
        preload="metadata"
      ></audio>
    </div>

    <div
      class="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <p class="text-xs text-neutral-500 dark:text-neutral-400">BPM</p>
      <p class="text-3xl font-semibold tabular-nums">
        {formatBpm(inspection.profile.mix.bpm.value)}
      </p>
    </div>

    <div
      class="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <p class="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
        RMS (volume envelope)
      </p>
      <RmsGraph
        rms={inspection.profile.mix.rms}
        frameRateHz={inspection.profile.timeline.frame_rate_hz}
        playheadSec={currentTime}
      />
    </div>
  {/if}
</section>
