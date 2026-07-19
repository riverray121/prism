<script lang="ts">
  import ContinuousLane from "$lib/graphs/ContinuousLane.svelte";
  import OnsetDots from "$lib/graphs/OnsetDots.svelte";
  import SegmentLane from "$lib/graphs/SegmentLane.svelte";
  import { deriveEvents, deriveSegments } from "$lib/mapping/derive";
  import {
    favoriteSources,
    resolveFeature,
    sourceLabel,
  } from "$lib/mapping/sources";
  import { getRawProfile, inspection } from "$lib/state/inspection.svelte";
  import {
    addDerivation,
    mapping,
    mappingUi,
    removeDerivation,
    updateDerivation,
  } from "$lib/state/mapping.svelte";
  import {
    scrub,
    scrubEnd,
    scrubStart,
    setViewWindow,
    transport,
    view,
  } from "$lib/state/transport.svelte";

  // Editor for one derivation (or a new draft): source picker, cutoff slider,
  // mode toggle, live preview against playback. The slider re-derives on every
  // input — the engine is client-side, no sidecar round-trip.

  const profile = $derived(inspection.profile);
  const isNew = $derived(mappingUi.editingDerivation === "new");
  const existing = $derived(
    isNew
      ? undefined
      : mapping.doc?.derivations.find(
          (d) => d.id === mappingUi.editingDerivation,
        ),
  );

  // Favorited continuous features are the only valid derivation sources.
  const continuousFavorites = $derived(
    profile
      ? favoriteSources(profile).filter(
          (f) => f.feature.render === "continuous",
        )
      : [],
  );

  // Draft for a new derivation; committed on Create.
  const draft = $state<{
    source: string;
    cutoff: number;
    mode: "events" | "segments";
  }>({ source: "", cutoff: 0.4, mode: "segments" });
  $effect(() => {
    // Default the draft source to the first continuous favorite.
    if (isNew && draft.source === "" && continuousFavorites.length > 0) {
      draft.source = continuousFavorites[0].path;
    }
  });

  // The values the editor and preview actually show.
  const source = $derived(isNew ? draft.source : (existing?.source ?? ""));
  const cutoff = $derived(
    isNew ? draft.cutoff : (existing?.threshold.cutoff ?? 0.4),
  );
  const mode = $derived(
    isNew ? draft.mode : (existing?.threshold.mode ?? "segments"),
  );

  function setCutoff(value: number): void {
    if (isNew) draft.cutoff = value;
    else if (existing)
      updateDerivation(existing.id, {
        threshold: { cutoff: value, mode: existing.threshold.mode },
      });
  }

  function setMode(value: "events" | "segments"): void {
    if (isNew) draft.mode = value;
    else if (existing)
      updateDerivation(existing.id, {
        threshold: { cutoff: existing.threshold.cutoff, mode: value },
      });
  }

  function setSource(value: string): void {
    if (isNew) draft.source = value;
    else if (existing) updateDerivation(existing.id, { source: value });
  }

  // Suggested id: source feature name + mode suffix, uniqued against the doc.
  function suggestedId(): string {
    const name = source.split(".").at(-1) ?? "derivation";
    const base = `${name}_${mode === "events" ? "hits" : "gate"}`;
    const taken = new Set(mapping.doc?.derivations.map((d) => d.id));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}_${n}`)) n++;
    return `${base}_${n}`;
  }

  function create(): void {
    if (draft.source === "") return;
    const id = suggestedId();
    addDerivation({
      id,
      source: draft.source,
      threshold: { cutoff: draft.cutoff, mode: draft.mode },
    });
    mappingUi.editingDerivation = id;
  }

  // ── Live preview ────────────────────────────────────────────────────────

  // Envelope data comes from the raw profile: the slider re-derives over the
  // full track per input, and the $state proxy would add a trap per sample.
  // (The `profile` read keeps this reactive to profile loads.)
  const data = $derived.by(() => {
    if (!profile || !source) return null;
    const raw = getRawProfile();
    const feature = raw ? resolveFeature(raw, source) : undefined;
    return feature?.render === "continuous" ? feature.data : null;
  });
  const frameRateHz = $derived(profile?.timeline.frame_rate_hz ?? 100);
  const durationSec = $derived(
    profile
      ? (profile.timeline.frame_count - 1) / profile.timeline.frame_rate_hz
      : 0,
  );

  const events = $derived(
    data && mode === "events" ? deriveEvents(data, frameRateHz, cutoff) : [],
  );
  const segments = $derived(
    data && mode === "segments"
      ? deriveSegments(data, frameRateHz, cutoff).map((s) => ({
          start: s.start,
          end: s.end,
          label: "",
        }))
      : [],
  );
</script>

<div class="flex flex-col gap-3">
  <div class="flex items-center gap-3">
    <p class="text-base font-medium">
      {isNew ? "New derivation" : (existing?.id ?? "")}
    </p>
    {#if !isNew && existing}
      <button
        onclick={() => removeDerivation(existing.id)}
        title="Delete this derivation (programs referencing it are muted)"
        class="ml-auto rounded border border-edge px-2 py-0.5 text-xs text-danger hover:bg-danger hover:text-surface"
      >
        Delete
      </button>
    {/if}
  </div>

  <div class="flex flex-wrap items-center gap-4 text-sm">
    <label class="flex items-center gap-2">
      <span class="text-ink-muted">Source</span>
      <select
        value={source}
        onchange={(e) => setSource(e.currentTarget.value)}
        class="rounded border border-edge bg-app px-1.5 py-1 focus:border-accent focus:outline-none"
      >
        {#each continuousFavorites as fav (fav.path)}
          <option value={fav.path}>{sourceLabel(fav.path)}</option>
        {/each}
        {#if !isNew && source && !continuousFavorites.some((f) => f.path === source)}
          <!-- Keep a stale/unstarred source visible instead of silently swapping it. -->
          <option value={source}>{sourceLabel(source)} (unstarred)</option>
        {/if}
      </select>
    </label>

    <div class="flex items-center gap-1" role="group" aria-label="Mode">
      {#each ["segments", "events"] as const as m (m)}
        <button
          onclick={() => setMode(m)}
          title={m === "events"
            ? "Peak-pick: one event per distinct hit"
            : "Hysteresis gate: on/off spans with duration"}
          class="rounded border px-2 py-0.5 text-xs {mode === m
            ? 'border-accent text-accent'
            : 'border-edge text-ink-faint hover:text-ink'}"
        >
          {m}
        </button>
      {/each}
    </div>

    <label class="flex min-w-56 flex-1 items-center gap-2">
      <span class="text-ink-muted">Cutoff</span>
      <input
        type="range"
        min="0.02"
        max="0.98"
        step="0.01"
        value={cutoff}
        oninput={(e) => setCutoff(Number(e.currentTarget.value))}
        class="flex-1 accent-[var(--color-accent,#74ade8)]"
      />
      <span class="w-10 text-right tabular-nums text-ink-muted">
        {cutoff.toFixed(2)}
      </span>
    </label>

    {#if isNew}
      <button
        onclick={create}
        disabled={draft.source === ""}
        class="rounded bg-accent px-3 py-1 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-50"
      >
        Create “{suggestedId()}”
      </button>
    {/if}
  </div>

  {#if data}
    <div class="flex flex-col gap-1">
      <ContinuousLane
        {data}
        {frameRateHz}
        label={sourceLabel(source)}
        color="#74ade8"
        height={200}
        playheadSec={transport.currentTime}
        follow={transport.playing}
        window={view.window}
        followMode={view.followMode}
        onWindowChange={setViewWindow}
        onSeek={scrub}
        onScrubStart={scrubStart}
        onScrubEnd={scrubEnd}
      />
      {#if mode === "events"}
        <OnsetDots
          onsets={events}
          maxTimeSec={durationSec}
          color="#f59e0b"
          height={110}
          playheadSec={transport.currentTime}
          follow={transport.playing}
          window={view.window}
          followMode={view.followMode}
          onWindowChange={setViewWindow}
          onSeek={scrub}
          onScrubStart={scrubStart}
          onScrubEnd={scrubEnd}
        />
        <p class="text-xs text-ink-faint">{events.length} events</p>
      {:else}
        <SegmentLane
          {segments}
          maxTimeSec={durationSec}
          height={130}
          playheadSec={transport.currentTime}
          follow={transport.playing}
          window={view.window}
          followMode={view.followMode}
          onWindowChange={setViewWindow}
          onSeek={scrub}
          onScrubStart={scrubStart}
          onScrubEnd={scrubEnd}
        />
        <p class="text-xs text-ink-faint">{segments.length} segments</p>
      {/if}
    </div>
  {:else if source}
    <p class="text-sm text-danger">
      Source “{source}” doesn't resolve to a continuous feature on this profile
      — it may have been removed by a re-analysis.
    </p>
  {/if}
</div>
