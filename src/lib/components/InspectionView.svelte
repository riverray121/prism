<script lang="ts">
  import HeatmapGraph from "$lib/components/HeatmapGraph.svelte";
  import SegmentGraph from "$lib/components/SegmentGraph.svelte";
  import TagsGraph from "$lib/components/TagsGraph.svelte";
  import ContinuousLane from "$lib/graphs/ContinuousLane.svelte";
  import EventLane from "$lib/graphs/EventLane.svelte";
  import type {
    ContinuousFeature,
    EventFeature,
    HeatmapFeature,
    MixFeature,
    ScalarFeature,
    SegmentFeature,
    TagsFeature,
  } from "$lib/ipc/messages";
  import { inspection, playToggle } from "$lib/state/inspection.svelte";
  import {
    scrub,
    scrubEnd,
    scrubStart,
    transport,
  } from "$lib/state/transport.svelte";

  // Resolve a relative sidecar path (heatmap/tags .npy) to its absolute URL.
  // Call sites gate on inspection.songDir being set.
  function sidecarUrl(sidecar: string): string {
    return `${inspection.songDir}/${sidecar}`;
  }

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
</script>

<section class="flex w-full max-w-4xl flex-col gap-6">
  {#if inspection.profile === null}
    <p class="text-sm text-neutral-500">Loading…</p>
  {:else}
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
          playheadSec={transport.currentTime}
          follow={transport.playing}
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
        <EventLane
          events={feature.events}
          maxTimeSec={durationSec}
          playheadSec={transport.currentTime}
          follow={transport.playing}
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
            playheadSec={transport.currentTime}
            follow={transport.playing}
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
          <ContinuousLane
            data={feature.data}
            {frameRateHz}
            label={name}
            color={PALETTE[i % PALETTE.length]}
            playheadSec={transport.currentTime}
            follow={transport.playing}
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
            playheadSec={transport.currentTime}
            follow={transport.playing}
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
                  {@render playButton(stemKey)}
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
                          {@render playButton(subKey)}
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

<!-- Play/pause toggle for one audio source key; active while it is audible. -->
{#snippet playButton(key: string)}
  <button
    onclick={() => playToggle(key)}
    class="rounded-md border border-indigo-600 px-3 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 {transport.playing &&
    transport.activeKey === key
      ? 'bg-indigo-600 text-white hover:bg-indigo-500 dark:text-white'
      : ''}"
  >
    {transport.playing && transport.activeKey === key ? "Pause" : "Play"}
  </button>
{/snippet}

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
      <EventLane
        events={feature.events}
        maxTimeSec={durationSec}
        playheadSec={transport.currentTime}
        follow={transport.playing}
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
      <ContinuousLane
        data={feature.data}
        {frameRateHz}
        label={`${labelPrefix} ${name}`}
        color={PALETTE[i % PALETTE.length]}
        playheadSec={transport.currentTime}
        follow={transport.playing}
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
          playheadSec={transport.currentTime}
          follow={transport.playing}
          onSeek={scrub}
          onScrubStart={scrubStart}
          onScrubEnd={scrubEnd}
        />
      </div>
    {/each}
  {/if}
{/snippet}
