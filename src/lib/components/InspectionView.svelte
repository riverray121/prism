<script lang="ts">
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { onDestroy } from "svelte";

  import ContinuousGraph from "$lib/components/ContinuousGraph.svelte";
  import EventGraph from "$lib/components/EventGraph.svelte";
  import HeatmapGraph from "$lib/components/HeatmapGraph.svelte";
  import type {
    ContinuousFeature,
    EventFeature,
    HeatmapFeature,
    ScalarFeature,
  } from "$lib/ipc/messages";
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
  const events = $derived(
    features.filter(
      (e): e is [string, EventFeature] => e[1].render === "event",
    ),
  );
  const heatmaps = $derived(
    features.filter(
      (e): e is [string, HeatmapFeature] => e[1].render === "heatmap",
    ),
  );

  // Full time extent shared by every graph's x axis, from the timeline.
  const durationSec = $derived(
    inspection.profile
      ? (inspection.profile.timeline.frame_count - 1) /
          inspection.profile.timeline.frame_rate_hz
      : 0,
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

  // Compact musical shorthand for a chord quality (BTC's vocabulary). Major
  // renders as the bare root by convention.
  const CHORD_QUALITY: Record<string, string> = {
    maj: "",
    min: "m",
    dim: "dim",
    aug: "aug",
    min6: "m6",
    maj6: "6",
    min7: "m7",
    minmaj7: "mM7",
    maj7: "maj7",
    "7": "7",
    dim7: "dim7",
    hdim7: "ø7",
    sus2: "sus2",
    sus4: "sus4",
  };

  // Label a chord event (root/quality passed through the event schema). 'N' (no
  // chord) and 'X' (unknown) carry no quality and render as-is.
  function chordLabel(ev: EventFeature["events"][number]): string | null {
    const c = ev as { root?: string; quality?: string };
    if (!c.root) return null;
    if (c.root === "N" || c.root === "X") return c.root;
    const q = c.quality ?? "";
    return c.root + (CHORD_QUALITY[q] ?? q);
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

    <!-- Event features: vertical tick lanes on the shared time axis. -->
    {#each events as [name, feature] (name)}
      <div
        class="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <p class="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
          {humanize(name)}
          <span class="text-neutral-400 dark:text-neutral-600"
            >· {feature.events.length} events</span
          >
        </p>
        <EventGraph
          events={feature.events}
          maxTimeSec={durationSec}
          playheadSec={currentTime}
          follow={playing}
          labelFor={name === "chords" ? chordLabel : undefined}
          height={name === "chords" ? 88 : 64}
          onSeek={scrub}
          onScrubStart={scrubStart}
          onScrubEnd={scrubEnd}
        />
      </div>
    {/each}

    <!-- Heatmap features: a .npy matrix rendered as a colormapped image. -->
    {#if inspection.songDir}
      {#each heatmaps as [name, feature] (name)}
        <div
          class="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <p class="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
            {humanize(name)}
            <span class="text-neutral-400 dark:text-neutral-600"
              >· {feature.shape[0]}×{feature.shape[1]} {feature.unit}</span
            >
          </p>
          <HeatmapGraph
            path={`${inspection.songDir}/${feature.sidecar}`}
            frameRateHz={inspection.profile.timeline.frame_rate_hz}
            normalize={name === "spectrogram" ? "global" : "per-row"}
            playheadSec={currentTime}
            follow={playing}
            onSeek={scrub}
            onScrubStart={scrubStart}
            onScrubEnd={scrubEnd}
          />
        </div>
      {/each}
    {/if}

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
