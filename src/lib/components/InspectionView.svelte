<script lang="ts">
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { onDestroy } from "svelte";

  import ContinuousGraph from "$lib/components/ContinuousGraph.svelte";
  import EventGraph from "$lib/components/EventGraph.svelte";
  import HeatmapGraph from "$lib/components/HeatmapGraph.svelte";
  import SegmentGraph from "$lib/components/SegmentGraph.svelte";
  import TagsGraph from "$lib/components/TagsGraph.svelte";
  import type {
    ContinuousFeature,
    EventFeature,
    HeatmapFeature,
    MixFeature,
    ScalarFeature,
    SegmentFeature,
    TagsFeature,
  } from "$lib/ipc/messages";
  import { inspection } from "$lib/state/inspection.svelte";

  // Playback uses the Web Audio API: the file is decoded into an AudioBuffer and
  // played through an AudioBufferSourceNode. The playhead is derived from
  // AudioContext.currentTime — the clock that generates the sound — so the two
  // can never drift, and seeking restarts the source at an exact offset.

  let currentTime = $state(0);
  let playing = $state(false);
  // Which audio source is audible: "mix" (the original) or a stem, keyed
  // `${engine}::${stem}`. All graphs share one playhead regardless of the source,
  // so any stem — or the original — can be heard against every graph.
  let activeKey = $state("mix");
  let activeBuffer = $state<AudioBuffer | null>(null);

  let ctx: AudioContext | undefined;
  let source: AudioBufferSourceNode | undefined;
  let startCtxTime = 0; // ctx.currentTime when the current source started
  let startOffset = 0; // buffer offset the current source started from
  let raf: number | null = null;
  // Decoded buffers cached by file path, so switching sources doesn't re-decode.
  let buffers = new Map<string, AudioBuffer>();
  // Bumped on each song change to abandon decodes still in flight.
  let loadToken = 0;

  function ensureCtx(): AudioContext {
    if (!ctx) ctx = new AudioContext();
    return ctx;
  }

  // Resolve a source key to its absolute file path (null if unavailable). Keys:
  // "mix", "{engine}::{stem}", or "{engine}::{stem}::{substem}" (drum sub-stems).
  function pathForKey(key: string): string | null {
    if (key === "mix") return inspection.audioPath;
    const prof = inspection.profile;
    if (!prof || !inspection.songDir) return null;
    const [engine, stem, sub] = key.split("::");
    const stemObj = prof.stems[engine]?.[stem];
    const audioFile = sub
      ? stemObj?.substems?.[sub]?.audio_file
      : stemObj?.audio_file;
    return audioFile ? `${inspection.songDir}/${audioFile}` : null;
  }

  // Resolve a relative sidecar path (heatmap/tags .npy) to its absolute URL.
  // Call sites gate on inspection.songDir being set.
  function sidecarUrl(sidecar: string): string {
    return `${inspection.songDir}/${sidecar}`;
  }

  // Decode a file to an AudioBuffer, caching by path.
  async function loadBuffer(path: string): Promise<AudioBuffer> {
    const cached = buffers.get(path);
    if (cached) return cached;
    const resp = await fetch(convertFileSrc(path));
    const bytes = await resp.arrayBuffer();
    const decoded = await ensureCtx().decodeAudioData(bytes);
    buffers.set(path, decoded);
    return decoded;
  }

  function duration(): number {
    return activeBuffer?.duration ?? inspection.profile?.song.duration_sec ?? 0;
  }

  // Current playback position from the audio clock while playing, else the held position.
  function positionNow(): number {
    if (!ctx || !playing) return currentTime;
    return Math.min(startOffset + (ctx.currentTime - startCtxTime), duration());
  }

  function startSource(offset: number) {
    const context = ensureCtx();
    const node = context.createBufferSource();
    node.buffer = activeBuffer;
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

  // Surfaced in the transport when playback fails, so errors are visible instead
  // of silent (e.g. a missing stem file or a decode failure).
  let playbackError = $state<string | null>(null);

  // Play a source (mix or stem) from the current playhead, switching the active
  // buffer first. The playhead is preserved across switches, so soloing a stem
  // mid-playback keeps it aligned to the graphs.
  async function playKey(key: string) {
    const path = pathForKey(key);
    if (!path) {
      playbackError = `No audio path for "${key}".`;
      return;
    }
    const token = loadToken;
    try {
      const context = ensureCtx();
      await context.resume();
      const buf = await loadBuffer(path);
      if (token !== loadToken) return; // song changed mid-decode
      stopSource();
      cancelRaf();
      activeKey = key;
      activeBuffer = buf;
      if (currentTime >= duration()) currentTime = 0;
      startSource(currentTime);
      playing = true;
      playbackError = null;
      tick();
    } catch (e) {
      playing = false;
      playbackError = `Playback failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  function pause() {
    currentTime = positionNow();
    stopSource();
    cancelRaf();
    playing = false;
  }

  // Toggle playback of a specific source: pause if it's the one playing, else
  // (re)start it — which also switches the audible source.
  function toggleSource(key: string) {
    if (playing && activeKey === key) pause();
    else playKey(key);
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
    if (resumeAfterScrub) playKey(activeKey);
    resumeAfterScrub = false;
  }

  // Reset playback and pre-decode the original whenever the open song changes.
  $effect(() => {
    const path = inspection.audioPath;
    loadToken++;
    stopSource();
    cancelRaf();
    playing = false;
    currentTime = 0;
    activeKey = "mix";
    activeBuffer = null;
    buffers = new Map();
    if (!path) return;
    const token = loadToken;
    (async () => {
      const buf = await loadBuffer(path);
      // Only adopt the pre-decoded mix if it is still the active source; a stem
      // soloed before this resolves must keep its own buffer.
      if (token === loadToken && activeKey === "mix") activeBuffer = buf;
    })();
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
  const segmentFeatures = $derived(
    features.filter(
      (e): e is [string, SegmentFeature] => e[1].render === "segment",
    ),
  );
  const heatmaps = $derived(
    features.filter(
      (e): e is [string, HeatmapFeature] => e[1].render === "heatmap",
    ),
  );
  const tagFeatures = $derived(
    features.filter((e): e is [string, TagsFeature] => e[1].render === "tags"),
  );

  // Split a keyed feature map by render mode, preserving insertion order. Used
  // for each stem's feature map (the mix uses the dedicated $derived above).
  function splitFeatures(map: Record<string, MixFeature>) {
    const entries = Object.entries(map);
    return {
      continuous: entries.filter(
        (e): e is [string, ContinuousFeature] => e[1].render === "continuous",
      ),
      events: entries.filter(
        (e): e is [string, EventFeature] => e[1].render === "event",
      ),
      heatmaps: entries.filter(
        (e): e is [string, HeatmapFeature] => e[1].render === "heatmap",
      ),
    };
  }

  // Separated stems grouped by engine, then stem (empty on pre-M4 profiles).
  const stems = $derived(
    inspection.profile ? Object.entries(inspection.profile.stems) : [],
  );

  // Shared timeline frame rate; consumers render only once a profile exists.
  const frameRateHz = $derived(
    inspection.profile?.timeline.frame_rate_hz ?? 100,
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

  // Append an ML confidence percentage to a label, when the item carries one.
  function withConfidence(
    label: string,
    item: { confidence?: unknown },
  ): string {
    return typeof item.confidence === "number"
      ? `${label} ${Math.round(item.confidence * 100)}%`
      : label;
  }

  // Label a chord event (root/quality passed through the event schema), with the
  // model's confidence. 'N' (no chord) and 'X' (unknown) carry no quality.
  function chordLabel(ev: EventFeature["events"][number]): string | null {
    const c = ev as { root?: string; quality?: string; confidence?: number };
    if (!c.root) return null;
    if (c.root === "N" || c.root === "X") return withConfidence(c.root, c);
    const q = c.quality ?? "";
    return withConfidence(c.root + (CHORD_QUALITY[q] ?? q), c);
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
  {#if inspection.profile === null}
    <p class="text-sm text-neutral-500">Loading…</p>
  {:else}
    <!-- Playback transport. The top button plays the original mix; each stem has
         its own play button below. Only one source is audible at a time, and the
         playhead is shared across every graph. -->
    <div class="flex items-center gap-3">
      <button
        onclick={() => toggleSource("mix")}
        disabled={!inspection.audioPath}
        class="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {playing && activeKey === "mix" ? "Pause" : "Play"} original
      </button>
      <span class="text-sm tabular-nums text-neutral-500 dark:text-neutral-400">
        {formatTime(currentTime)} / {formatTime(duration())}
      </span>
      {#if activeKey !== "mix"}
        <span class="text-xs text-neutral-500 dark:text-neutral-400">
          ♪ {activeKey.split("::").at(-1)}
        </span>
      {/if}
    </div>
    {#if playbackError}
      <p class="text-xs text-red-500">{playbackError}</p>
    {/if}

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

    <!-- Segment features: labeled time-span lanes on the shared time axis. -->
    {#each segmentFeatures as [name, feature] (name)}
      <div
        class="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <p class="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
          {humanize(name)}
          <span class="text-neutral-400 dark:text-neutral-600"
            >· {feature.segments.length} segments</span
          >
        </p>
        <SegmentGraph
          segments={feature.segments}
          maxTimeSec={durationSec}
          playheadSec={currentTime}
          follow={playing}
          onSeek={scrub}
          onScrubStart={scrubStart}
          onScrubEnd={scrubEnd}
        />
      </div>
    {/each}

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
            path={sidecarUrl(feature.sidecar)}
            {frameRateHz}
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
              >· {feature.unit}{feature.status === "wip" ? " · wip" : ""}</span
            >
          </p>
          <ContinuousGraph
            {feature}
            {frameRateHz}
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

    <!-- Tag features (sound_tags): one line graph per present class, loaded from
         a shared .npy matrix. -->
    {#if inspection.songDir}
      {#each tagFeatures as [name, feature] (name)}
        <div
          class="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <p class="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
            {humanize(name)}
            <span class="text-neutral-400 dark:text-neutral-600">
              · {feature.labels.length} classes{feature.status === "wip"
                ? " · wip"
                : ""}</span
            >
          </p>
          <TagsGraph
            path={sidecarUrl(feature.sidecar)}
            labels={feature.labels}
            {frameRateHz}
            playheadSec={currentTime}
            follow={playing}
            onSeek={scrub}
            onScrubStart={scrubStart}
            onScrubEnd={scrubEnd}
          />
        </div>
      {/each}
    {/if}

    <!-- Per-stem features, grouped by separation engine then stem, so the same
         stem can be compared across engines. Reuses the mix graph components and
         shares the playhead/scrub. -->
    {#if stems.length > 0}
      <section class="flex flex-col gap-6">
        <h3 class="text-lg font-semibold tracking-tight">Stems</h3>
        {#each stems as [engine, engineStems] (engine)}
          <div class="flex flex-col gap-3">
            <h4
              class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
            >
              {engine}
            </h4>
            {#each Object.entries(engineStems) as [stemName, stemData] (stemName)}
              {@const sf = splitFeatures(stemData.features)}
              {@const stemKey = `${engine}::${stemName}`}
              <div
                class="flex flex-col gap-4 rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div class="flex items-center gap-3">
                  <button
                    onclick={() => toggleSource(stemKey)}
                    class="rounded-md border border-indigo-600 px-3 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 {playing &&
                    activeKey === stemKey
                      ? 'bg-indigo-600 text-white hover:bg-indigo-500 dark:text-white'
                      : ''}"
                  >
                    {playing && activeKey === stemKey ? "Pause" : "Play"}
                  </button>
                  <p class="text-sm font-semibold capitalize">{stemName}</p>
                </div>
                {@render featureGraphs(sf, stemName)}
                {#if stemData.substems}
                  <div
                    class="ml-2 flex flex-col gap-4 border-l-2 border-neutral-200 pl-3 dark:border-neutral-800"
                  >
                    {#each Object.entries(stemData.substems) as [subName, subData] (subName)}
                      {@const subKey = `${engine}::${stemName}::${subName}`}
                      {@const ssf = splitFeatures(subData.features)}
                      <div class="flex flex-col gap-3">
                        <div class="flex items-center gap-3">
                          <button
                            onclick={() => toggleSource(subKey)}
                            class="rounded-md border border-indigo-600 px-3 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 {playing &&
                            activeKey === subKey
                              ? 'bg-indigo-600 text-white hover:bg-indigo-500 dark:text-white'
                              : ''}"
                          >
                            {playing && activeKey === subKey ? "Pause" : "Play"}
                          </button>
                          <p class="text-sm font-medium capitalize">
                            {subName}
                          </p>
                        </div>
                        {@render featureGraphs(ssf, subName)}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/each}
      </section>
    {/if}
  {/if}
</section>

<!-- Renders a feature group (events, continuous, heatmaps) for a stem or sub-stem,
     reused so stems and drum sub-stems share one layout. -->
{#snippet featureGraphs(
  sf: ReturnType<typeof splitFeatures>,
  labelPrefix: string,
)}
  {#each sf.events as [name, feature] (name)}
    <div>
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
        height={64}
        onSeek={scrub}
        onScrubStart={scrubStart}
        onScrubEnd={scrubEnd}
      />
    </div>
  {/each}
  {#each sf.continuous as [name, feature], i (name)}
    <div>
      <p class="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
        {humanize(name)}
        <span class="text-neutral-400 dark:text-neutral-600"
          >· {feature.unit}</span
        >
      </p>
      <ContinuousGraph
        {feature}
        {frameRateHz}
        label={`${labelPrefix} ${name}`}
        color={PALETTE[i % PALETTE.length]}
        playheadSec={currentTime}
        follow={playing}
        onSeek={scrub}
        onScrubStart={scrubStart}
        onScrubEnd={scrubEnd}
      />
    </div>
  {/each}
  {#if inspection.songDir}
    {#each sf.heatmaps as [name, feature] (name)}
      <div>
        <p class="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
          {humanize(name)}
          <span class="text-neutral-400 dark:text-neutral-600"
            >· {feature.shape[0]}×{feature.shape[1]} {feature.unit}</span
          >
        </p>
        <HeatmapGraph
          path={sidecarUrl(feature.sidecar)}
          {frameRateHz}
          normalize="per-row"
          playheadSec={currentTime}
          follow={playing}
          onSeek={scrub}
          onScrubStart={scrubStart}
          onScrubEnd={scrubEnd}
        />
      </div>
    {/each}
  {/if}
{/snippet}
