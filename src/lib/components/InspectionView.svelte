<script lang="ts">
  import { tick } from "svelte";

  import { chordLabel } from "$lib/chords";
  import Group from "$lib/components/analysis/Group.svelte";
  import { humanize } from "$lib/format";
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
    setViewWindow,
    transport,
    view,
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

  // Groups default to `allOpen` (collapsed on open) with sparse per-group
  // overrides; expand/collapse-all resets the overrides and flips the base.
  let allOpen = $state(false);
  let openOverrides = $state<Record<string, boolean>>({});
  function isOpen(key: string): boolean {
    return openOverrides[key] ?? allOpen;
  }
  function toggle(key: string): void {
    openOverrides[key] = !isOpen(key);
  }
  // Expanding mounts every lane at once, which takes a beat — the button
  // disables until the re-render lands so it can't be double-fired.
  let togglingAll = $state(false);
  async function toggleAll(): Promise<void> {
    if (togglingAll) return;
    togglingAll = true;
    const open = !allOpen;
    // Paint the disabled state before the heavy re-render blocks the frame.
    await new Promise(requestAnimationFrame);
    openOverrides = {};
    allOpen = open;
    await tick(); // the new tree is in the DOM…
    await new Promise(requestAnimationFrame); // …and painted
    togglingAll = false;
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
  function groupOpen(key: string, hasHits: boolean): boolean {
    if (q !== "") return hasHits;
    return isOpen(key);
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
  <!-- Fixed width: the Play/Pause label swap must not shift the layout. -->
  <button
    onclick={() => playToggle(key)}
    class="w-16 self-start rounded-md border border-accent px-3 py-1 text-center text-xs font-medium text-accent hover:bg-raised {transport.playing &&
    transport.activeKey === key
      ? 'bg-accent text-surface hover:bg-accent'
      : ''}"
  >
    {transport.playing && transport.activeKey === key ? "Pause" : "Play"}
  </button>
{/snippet}

<!-- Favorite star for one subfeature dot-path; favorites feed the Mapping
     tab's source palette. An SVG star (filled when starred, outline that
     previews amber on hover) with a generous hit area, so starring is an
     obvious affordance rather than a stray glyph. -->
{#snippet star(favPath: string)}
  {@const starred = isFavorite(favPath)}
  <button
    onclick={() => toggleFavorite(favPath)}
    title={starred
      ? "Unstar — remove from Mapping sources"
      : "Star — use as a source in Mapping"}
    class="group/star -m-1 shrink-0 rounded p-1 hover:bg-raised"
  >
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      stroke-width="1.8"
      stroke-linejoin="round"
      class={starred
        ? "fill-amber-400 stroke-amber-400"
        : "fill-none stroke-ink-faint group-hover/star:stroke-amber-400"}
    >
      <path
        d="M12 3.2l2.8 5.7 6.3.9-4.6 4.4 1.1 6.2L12 17.5l-5.6 2.9 1.1-6.2-4.6-4.4 6.3-.9z"
      />
    </svg>
  </button>
{/snippet}

<!-- One feature as a lane row: header + the render-mode-appropriate graph. -->
{#snippet featureRow(
  name: string,
  feature: MixFeature,
  i: number,
  favPath: string,
)}
  {@const strict =
    feature.render === "continuous" &&
    (strictOnsets[favPath] ?? false) &&
    !!feature.onsets_strict}
  <div>
    <p class="mb-2 flex items-center gap-2 text-base">
      {@render star(favPath)}
      <span class="font-medium text-ink">{humanize(name)}</span>
      <span class="text-sm text-ink-faint">{detailOf(feature)}</span>
      <!-- Onset-mode toggle lives in the header so the dots lane below keeps
           the full lane width and stays playhead-aligned with its parent. -->
      {#if feature.render === "continuous" && feature.onsets_strict}
        <button
          onclick={() => (strictOnsets[favPath] = !strict)}
          title={strict
            ? "Dense onsets: every qualifying peak — runs of dots trace sustained sounds"
            : "Strict onsets: prominent maxima only — one dot per distinct hit"}
          class="ml-auto w-16 shrink-0 rounded border border-edge px-2 py-0.5 text-center text-xs {strict
            ? 'text-accent'
            : 'text-ink-faint hover:text-ink'}"
        >
          {strict ? "maxima" : "dense"}
        </button>
      {/if}
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
        window={view.window}
        followMode={view.followMode}
        onWindowChange={setViewWindow}
        onSeek={scrub}
        onScrubStart={scrubStart}
        onScrubEnd={scrubEnd}
      />
      {#if feature.onsets?.length}
        <OnsetDots
          onsets={strict ? (feature.onsets_strict ?? []) : feature.onsets}
          maxTimeSec={durationSec}
          color={PALETTE[i % PALETTE.length]}
          height={56}
          gutter
          playheadSec={transport.currentTime}
          follow={transport.playing}
          window={view.window}
          followMode={view.followMode}
          onWindowChange={setViewWindow}
          onSeek={scrub}
          onScrubStart={scrubStart}
          onScrubEnd={scrubEnd}
        />
      {/if}
    {:else if feature.render === "event"}
      <EventLane
        events={feature.events}
        maxTimeSec={durationSec}
        playheadSec={transport.currentTime}
        follow={transport.playing}
        window={view.window}
        followMode={view.followMode}
        onWindowChange={setViewWindow}
        onSeek={scrub}
        onScrubStart={scrubStart}
        onScrubEnd={scrubEnd}
        labelFor={name === "chords" ? chordLabel : undefined}
        height={name === "chords" ? 100 : 76}
        gutter
      />
    {:else if feature.render === "segment"}
      <SegmentLane
        segments={feature.segments}
        maxTimeSec={durationSec}
        height={76}
        gutter
        playheadSec={transport.currentTime}
        follow={transport.playing}
        window={view.window}
        followMode={view.followMode}
        onWindowChange={setViewWindow}
        onSeek={scrub}
        onScrubStart={scrubStart}
        onScrubEnd={scrubEnd}
      />
    {:else if feature.render === "heatmap" && inspection.songDir}
      <HeatmapLane
        path={sidecarPath(feature.sidecar)}
        {frameRateHz}
        height={190}
        gutter
        normalize={name === "spectrogram" ? "global" : "per-row"}
        playheadSec={transport.currentTime}
        follow={transport.playing}
        window={view.window}
        followMode={view.followMode}
        onWindowChange={setViewWindow}
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
        window={view.window}
        followMode={view.followMode}
        onWindowChange={setViewWindow}
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
      <div class="flex w-full flex-col gap-2">
        <div class="mb-2 flex items-center gap-2">
          <input
            bind:value={query}
            placeholder="Search features…"
            title="Filter features by name, category, engine, or stem"
            class="w-72 rounded border border-edge bg-app px-2 py-1.5 text-sm placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
          <!-- One toggle for the whole tree. Both labels are stacked in one
               grid cell (the inactive one invisible), so the button hugs the
               longer label and never changes size on toggle. -->
          <button
            onclick={toggleAll}
            disabled={togglingAll}
            title={allOpen ? "Collapse all groups" : "Expand all groups"}
            class="flex items-center gap-1.5 rounded border border-edge px-2.5 py-1.5 text-xs text-ink-muted hover:text-ink disabled:pointer-events-none disabled:opacity-50"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="transition-transform duration-150 {allOpen
                ? 'rotate-180'
                : ''}"
            >
              <path d="M5 9l7 7 7-7" />
            </svg>
            <span class="grid text-left">
              <span
                class="col-start-1 row-start-1 {allOpen ? 'invisible' : ''}"
              >
                Expand all
              </span>
              <span
                class="col-start-1 row-start-1 {allOpen ? '' : 'invisible'}"
              >
                Collapse all
              </span>
            </span>
          </button>
        </div>
        <!-- Scalars: one value each, a labeled grid. -->
        {#if scalars.length > 0 && (q === "" || scalars.some( ([n]) => matches(n), ))}
          <Group
            label="Scalars"
            detail={`${scalars.length}`}
            open={groupOpen("scalars", true)}
            ontoggle={() => toggle("scalars")}
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
              open={groupOpen(`mix.${category}`, true)}
              ontoggle={() => toggle(`mix.${category}`)}
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
              open={groupOpen(`stems.${engine}`, engineHasHits)}
              ontoggle={() => toggle(`stems.${engine}`)}
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
                    open={groupOpen(stemKey, true)}
                    ontoggle={() => toggle(stemKey)}
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
                      open={groupOpen(subKey, true)}
                      ontoggle={() => toggle(subKey)}
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
