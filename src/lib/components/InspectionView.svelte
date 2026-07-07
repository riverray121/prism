<script lang="ts">
  import { chordLabel } from "$lib/chords";
  import Group from "$lib/components/analysis/Group.svelte";
  import ContinuousLane from "$lib/graphs/ContinuousLane.svelte";
  import EventLane from "$lib/graphs/EventLane.svelte";
  import HeatmapLane from "$lib/graphs/HeatmapLane.svelte";
  import OnsetDots from "$lib/graphs/OnsetDots.svelte";
  import SegmentLane from "$lib/graphs/SegmentLane.svelte";
  import TagsLanes from "$lib/graphs/TagsLanes.svelte";
  import type { MixFeature, ScalarFeature } from "$lib/ipc/messages";
  import {
    inspection,
    isFavorite,
    playToggle,
    sidecarPath,
    toggleFavorite,
  } from "$lib/state/inspection.svelte";
  import {
    scrub,
    scrubEnd,
    scrubStart,
    transport,
  } from "$lib/state/transport.svelte";

  // ── Feature access ────────────────────────────────────────────────────────

  const features = $derived(
    inspection.profile ? Object.entries(inspection.profile.mix) : [],
  );
  const scalars = $derived(
    features.filter(
      (e): e is [string, ScalarFeature] => e[1].render === "scalar",
    ),
  );

  // Non-scalar mix features grouped by their catalog category, preserving the
  // profile's insertion order within each group.
  const mixByCategory = $derived.by(() => {
    const groups = new Map<string, [string, MixFeature][]>();
    for (const entry of features) {
      if (entry[1].render === "scalar") continue;
      const cat = entry[1].category;
      const list = groups.get(cat);
      if (list) list.push(entry);
      else groups.set(cat, [entry]);
    }
    return [...groups.entries()];
  });

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

  // ── Collapse + search state ───────────────────────────────────────────────

  // Sparse overrides over per-group defaults (mix categories open, engines
  // closed); only toggled groups are recorded.
  const openOverrides = $state<Record<string, boolean>>({});
  function isOpen(key: string, dflt: boolean): boolean {
    return openOverrides[key] ?? dflt;
  }
  function toggle(key: string, dflt: boolean): void {
    openOverrides[key] = !isOpen(key, dflt);
  }

  // Per-lane onset display mode: true = strict maxima; keyed by favorites path.
  const strictOnsets = $state<Record<string, boolean>>({});

  let query = $state("");
  const q = $derived(query.trim().toLowerCase());

  // A feature matches when the query hits its name or its group's context
  // (category, engine, stem) — so "drums" surfaces every drum lane.
  function matches(...terms: string[]): boolean {
    if (q === "") return true;
    return terms.some((t) => t.toLowerCase().includes(q));
  }

  // While searching, groups with hits are forced open.
  function groupOpen(key: string, dflt: boolean, hasHits: boolean): boolean {
    if (q !== "") return hasHits;
    return isOpen(key, dflt);
  }

  // ── Presentation helpers ─────────────────────────────────────────────────

  // Line colors cycled across stacked continuous lanes for distinction.
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

  // Dimmed metadata suffix for a feature row header.
  function detailOf(feature: MixFeature): string {
    if (feature.render === "event") return `${feature.events.length} events`;
    if (feature.render === "segment")
      return `${feature.segments.length} segments`;
    if (feature.render === "heatmap")
      return `${feature.shape[0]}×${feature.shape[1]} ${feature.unit}`;
    if (feature.render === "tags") return `${feature.labels.length} classes`;
    if (feature.render === "continuous")
      return `${feature.unit}${feature.status === "wip" ? " · wip" : ""}`;
    return "";
  }
</script>

<!-- Play/pause toggle for one audio source key; active while it is audible. -->
{#snippet playButton(key: string)}
  <button
    onclick={() => playToggle(key)}
    class="self-start rounded-md border border-accent px-3 py-1 text-xs font-medium text-accent hover:bg-raised {transport.playing &&
    transport.activeKey === key
      ? 'bg-accent text-surface hover:bg-accent'
      : ''}"
  >
    {transport.playing && transport.activeKey === key ? "Pause" : "Play"}
  </button>
{/snippet}

<!-- Favorite star for one subfeature dot-path; favorites feed the M3 mapping tab. -->
{#snippet star(favPath: string)}
  <button
    onclick={() => toggleFavorite(favPath)}
    title={isFavorite(favPath) ? "Unfavorite" : "Favorite"}
    class={isFavorite(favPath)
      ? "text-amber-400 hover:text-amber-300"
      : "text-ink-faint hover:text-ink"}
  >
    {isFavorite(favPath) ? "★" : "☆"}
  </button>
{/snippet}

<!-- One feature as a lane row: header + the render-mode-appropriate graph. -->
{#snippet featureRow(
  name: string,
  feature: MixFeature,
  i: number,
  favPath: string,
)}
  <div>
    <p class="mb-1 flex items-center gap-1.5 text-sm text-ink-muted">
      {@render star(favPath)}
      {humanize(name)}
      <span class="text-xs text-ink-faint">· {detailOf(feature)}</span>
    </p>
    {#if feature.render === "continuous"}
      <ContinuousLane
        data={feature.data}
        {frameRateHz}
        label={name}
        color={PALETTE[i % PALETTE.length]}
        height={150}
        playheadSec={transport.currentTime}
        follow={transport.playing}
        onSeek={scrub}
        onScrubStart={scrubStart}
        onScrubEnd={scrubEnd}
      />
      {#if feature.onsets?.length}
        {@const strict =
          (strictOnsets[favPath] ?? false) && !!feature.onsets_strict}
        <div class="flex items-center gap-2">
          <div class="min-w-0 flex-1">
            <OnsetDots
              onsets={strict ? (feature.onsets_strict ?? []) : feature.onsets}
              maxTimeSec={durationSec}
              color={PALETTE[i % PALETTE.length]}
              playheadSec={transport.currentTime}
              follow={transport.playing}
              onSeek={scrub}
              onScrubStart={scrubStart}
              onScrubEnd={scrubEnd}
            />
          </div>
          {#if feature.onsets_strict}
            <button
              onclick={() => (strictOnsets[favPath] = !strict)}
              title={strict
                ? "Dense onsets: every qualifying peak — runs of dots trace sustained sounds"
                : "Strict onsets: prominent maxima only — one dot per distinct hit"}
              class="shrink-0 rounded border border-edge px-2 py-0.5 text-xs {strict
                ? 'text-accent'
                : 'text-ink-faint hover:text-ink'}"
            >
              {strict ? "maxima" : "dense"}
            </button>
          {/if}
        </div>
      {/if}
    {:else if feature.render === "event"}
      <EventLane
        events={feature.events}
        maxTimeSec={durationSec}
        playheadSec={transport.currentTime}
        follow={transport.playing}
        labelFor={name === "chords" ? chordLabel : undefined}
        height={name === "chords" ? 100 : 76}
        onSeek={scrub}
        onScrubStart={scrubStart}
        onScrubEnd={scrubEnd}
      />
    {:else if feature.render === "segment"}
      <SegmentLane
        segments={feature.segments}
        maxTimeSec={durationSec}
        height={76}
        playheadSec={transport.currentTime}
        follow={transport.playing}
        onSeek={scrub}
        onScrubStart={scrubStart}
        onScrubEnd={scrubEnd}
      />
    {:else if feature.render === "heatmap" && inspection.songDir}
      <HeatmapLane
        path={sidecarPath(feature.sidecar)}
        {frameRateHz}
        height={190}
        normalize={name === "spectrogram" ? "global" : "per-row"}
        playheadSec={transport.currentTime}
        follow={transport.playing}
        onSeek={scrub}
        onScrubStart={scrubStart}
        onScrubEnd={scrubEnd}
      />
    {:else if feature.render === "tags" && inspection.songDir}
      <TagsLanes
        path={sidecarPath(feature.sidecar)}
        labels={feature.labels}
        {frameRateHz}
        playheadSec={transport.currentTime}
        follow={transport.playing}
        onSeek={scrub}
        onScrubStart={scrubStart}
        onScrubEnd={scrubEnd}
      />
    {/if}
  </div>
{/snippet}

<!-- A stem (or sub-stem): play control plus its filtered feature rows. -->
{#snippet stemBody(
  stemKey: string,
  featureMap: Record<string, MixFeature>,
  context: string[],
  favPrefix: string,
)}
  {@render playButton(stemKey)}
  {#each Object.entries(featureMap).filter( ([n]) => matches(n, ...context), ) as [name, feature], i (name)}
    {@render featureRow(name, feature, i, `${favPrefix}.${name}`)}
  {/each}
{/snippet}

<div class="flex h-full flex-col">
  {#if inspection.profile === null}
    <div class="flex flex-1 items-center justify-center">
      <p class="text-sm text-ink-faint">Loading…</p>
    </div>
  {:else}
    <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-32 pt-3">
      <div class="flex w-full flex-col gap-1">
        <input
          bind:value={query}
          placeholder="Search features…"
          title="Filter features by name, category, engine, or stem"
          class="mb-2 w-72 rounded border border-edge bg-app px-2 py-1.5 text-sm placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <!-- Scalars: one value each, a labeled grid. -->
        {#if scalars.length > 0 && (q === "" || scalars.some( ([n]) => matches(n), ))}
          <Group
            label="Scalars"
            detail={`${scalars.length}`}
            open={groupOpen("scalars", true, true)}
            ontoggle={() => toggle("scalars", true)}
          >
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {#each scalars.filter( ([n]) => matches(n), ) as [name, feature] (name)}
                <div class="rounded-md border border-edge bg-surface p-3">
                  <p class="flex items-center gap-1 text-xs text-ink-muted">
                    {@render star(`mix.${name}`)}
                    {humanize(name)}
                  </p>
                  <p class="text-xl font-semibold tabular-nums">
                    {formatScalar(feature)}
                  </p>
                </div>
              {/each}
            </div>
          </Group>
        {/if}

        <!-- Mix features by catalog category. -->
        {#each mixByCategory as [category, entries] (category)}
          {@const visible = entries.filter(([n]) => matches(n, category))}
          {#if visible.length > 0}
            <Group
              label={humanize(category)}
              detail={`${visible.length}`}
              open={groupOpen(`mix.${category}`, true, true)}
              ontoggle={() => toggle(`mix.${category}`, true)}
            >
              {#each visible as [name, feature], i (name)}
                {@render featureRow(name, feature, i, `mix.${name}`)}
              {/each}
            </Group>
          {/if}
        {/each}

        <!-- Per-stem features, engine → stem → sub-stem. Engines default
             collapsed; search reaches inside. -->
        {#each stems as [engine, engineStems] (engine)}
          {@const engineHasHits =
            q !== "" &&
            Object.entries(engineStems).some(
              ([stemName, stemData]) =>
                Object.keys(stemData.features).some((n) =>
                  matches(n, engine, stemName),
                ) ||
                Object.entries(stemData.substems ?? {}).some(([subName, sub]) =>
                  Object.keys(sub.features).some((n) =>
                    matches(n, engine, stemName, subName),
                  ),
                ),
            )}
          {#if q === "" || engineHasHits}
            <Group
              label={engine}
              detail={`${Object.keys(engineStems).length} stems`}
              open={groupOpen(`stems.${engine}`, true, engineHasHits)}
              ontoggle={() => toggle(`stems.${engine}`, true)}
            >
              {#each Object.entries(engineStems) as [stemName, stemData] (stemName)}
                {@const stemKey = `${engine}::${stemName}`}
                {@const stemHits =
                  q === "" ||
                  Object.keys(stemData.features).some((n) =>
                    matches(n, engine, stemName),
                  )}
                {#if stemHits}
                  <Group
                    label={stemName}
                    depth={1}
                    open={groupOpen(stemKey, true, true)}
                    ontoggle={() => toggle(stemKey, true)}
                  >
                    {@render stemBody(
                      stemKey,
                      stemData.features,
                      [engine, stemName],
                      `stems.${engine}.${stemName}.features`,
                    )}
                  </Group>
                {/if}
                {#each Object.entries(stemData.substems ?? {}) as [subName, subData] (subName)}
                  {@const subKey = `${engine}::${stemName}::${subName}`}
                  {#if q === "" || Object.keys(subData.features).some( (n) => matches(n, engine, stemName, subName), )}
                    <Group
                      label={`${stemName} · ${subName}`}
                      depth={2}
                      open={groupOpen(subKey, true, true)}
                      ontoggle={() => toggle(subKey, true)}
                    >
                      {@render stemBody(
                        subKey,
                        subData.features,
                        [engine, stemName, subName],
                        `stems.${engine}.${stemName}.substems.${subName}.features`,
                      )}
                    </Group>
                  {/if}
                {/each}
              {/each}
            </Group>
          {/if}
        {/each}
      </div>
    </div>
  {/if}
</div>
