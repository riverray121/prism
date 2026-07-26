<script lang="ts">
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import EditableName from "$lib/components/EditableName.svelte";
  import Segmented from "$lib/components/shell/Segmented.svelte";
  import ContinuousLane from "$lib/graphs/ContinuousLane.svelte";
  import OnsetDots from "$lib/graphs/OnsetDots.svelte";
  import SegmentLane from "$lib/graphs/SegmentLane.svelte";
  import { deriveEvents, deriveSegments } from "$lib/mapping/derive";
  import { GATE_PULSE_SEC } from "$lib/mapping/evaluate";
  import { extent } from "$lib/extent";
  import { uniqueId } from "$lib/mapping/automap";
  import { derivationLabel, sourceLabel } from "$lib/mapping/labels";
  import {
    audioKeyForSource,
    favoriteSources,
    parseSourcePath,
    resolveFeature,
  } from "$lib/mapping/sources";
  import {
    backToMix,
    getRawProfile,
    inspection,
    requestFeatureTrack,
    soloSource,
  } from "$lib/state/inspection.svelte";
  import { tracks } from "$lib/state/tracks.svelte";
  import {
    addDerivation,
    audition,
    mapping,
    mappingUi,
    removeDerivation,
    renameDerivation,
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

  // One home for the threshold defaults: the new-derivation draft and the
  // display fallbacks for a doc missing fields both read from it.
  const DEFAULT_THRESHOLD = {
    cutoff: 0.4,
    max: 1,
    sensitivity: 1,
    mode: "segments",
  } as const;

  // Draft for a new derivation; committed on Create.
  const draft = $state<{
    source: string;
    cutoff: number;
    max: number;
    sensitivity: number;
    mode: "events" | "segments";
  }>({ source: "", ...DEFAULT_THRESHOLD });
  $effect(() => {
    // Default the draft source to the first continuous favorite.
    if (isNew && draft.source === "" && continuousFavorites.length > 0) {
      draft.source = continuousFavorites[0].path;
    }
  });

  // The values the editor and preview actually show.
  const source = $derived(isNew ? draft.source : (existing?.source ?? ""));
  const cutoff = $derived(
    isNew
      ? draft.cutoff
      : (existing?.threshold.cutoff ?? DEFAULT_THRESHOLD.cutoff),
  );
  const maxBound = $derived(
    isNew ? draft.max : (existing?.threshold.max ?? DEFAULT_THRESHOLD.max),
  );
  const sensitivity = $derived(
    isNew
      ? draft.sensitivity
      : (existing?.threshold.sensitivity ?? DEFAULT_THRESHOLD.sensitivity),
  );
  const mode = $derived(
    isNew ? draft.mode : (existing?.threshold.mode ?? DEFAULT_THRESHOLD.mode),
  );

  type Threshold = NonNullable<typeof existing>["threshold"];
  function patchThreshold(patch: Partial<Threshold>): void {
    if (isNew) Object.assign(draft, patch);
    else if (existing)
      updateDerivation(existing.id, {
        threshold: { ...existing.threshold, ...patch },
      });
  }

  function setSource(value: string): void {
    if (isNew) draft.source = value;
    else if (existing) updateDerivation(existing.id, { source: value });
  }

  // Suggested id: stem context + feature name + mode suffix, uniqued against
  // the doc — a stem's feature is named just "energy", so without the stem
  // prefix every stem's gate would suggest the same id.
  function suggestedId(): string {
    const parsed = parseSourcePath(source);
    let name = parsed.name || "derivation";
    if (parsed.root === "stems" && parsed.stem) {
      const context = parsed.sub ? `${parsed.stem}_${parsed.sub}` : parsed.stem;
      if (!name.startsWith(context)) name = `${context}_${name}`;
    }
    const base = `${name}_${mode === "events" ? "hits" : "gate"}`;
    return uniqueId(base, new Set(mapping.doc?.derivations.map((d) => d.id)));
  }

  function create(): void {
    if (draft.source === "") return;
    const id = suggestedId();
    addDerivation({
      id,
      source: draft.source,
      threshold: {
        cutoff: draft.cutoff,
        max: draft.max,
        sensitivity: draft.sensitivity,
        mode: draft.mode,
      },
    });
    mappingUi.editingDerivation = id;
  }

  // Deleting asks first (cancelable) — a derivation is hand-tuned work.
  let confirmingDelete = $state(false);

  // Audio key for a stem source ("engine::stem[::substem]"), so the audible
  // track can be soloed to what's being thresholded — same keys as Analysis.
  const audioKey = $derived(audioKeyForSource(source));
  // Soloed = the stem is the audible source, playing or paused; the button
  // toggles the source only and never starts/stops playback.
  const soloed = $derived(
    audioKey !== null && transport.activeKey === audioKey,
  );

  // ── Live preview ────────────────────────────────────────────────────────

  // Envelope data comes from the raw profile: the slider re-derives over the
  // full track per input, and the $state proxy would add a trap per sample.
  // (The `profile` read keeps this reactive to profile loads.)
  const data = $derived.by(() => {
    tracks.version; // raw-profile read — re-run when a streamed sidecar lands
    if (!profile || !source) return null;
    const raw = getRawProfile();
    const feature = raw ? resolveFeature(raw, source) : undefined;
    return feature?.render === "continuous" ? (feature.data ?? null) : null;
  });
  // Stream the source's sidecar when it isn't hydrated yet.
  $effect(() => {
    if (!profile || !source) return;
    const feature = resolveFeature(profile, source);
    if (feature?.render === "continuous" && !feature.data)
      requestFeatureTrack(feature);
  });
  const frameRateHz = $derived(profile?.timeline.frame_rate_hz ?? 100);
  const durationSec = $derived(
    profile
      ? (profile.timeline.frame_count - 1) / profile.timeline.frame_rate_hz
      : 0,
  );

  const events = $derived(
    data && mode === "events"
      ? deriveEvents(data, frameRateHz, cutoff, { max: maxBound, sensitivity })
      : [],
  );
  const derivedSegments = $derived(
    data && mode === "segments"
      ? deriveSegments(data, frameRateHz, cutoff, {
          max: maxBound,
          sensitivity,
        })
      : [],
  );
  const segments = $derived(
    derivedSegments.map((s) => ({ start: s.start, end: s.end, label: "" })),
  );

  // Threshold guides drawn over the source lane, in its raw units (the
  // cutoff/ceiling are fractions of the source's own range).
  const dataRange = $derived.by(() => {
    if (!data) return null;
    const e = extent(data);
    return e && e.hi > e.lo ? e : null;
  });
  const hlines = $derived.by(() => {
    if (!dataRange) return [];
    const { lo, hi } = dataRange;
    const lines = [{ value: lo + cutoff * (hi - lo), color: "#f59e0b" }];
    if (maxBound < 0.995)
      lines.push({ value: lo + maxBound * (hi - lo), color: "#ef4444" });
    return lines;
  });

  // Audition: mirror the current threshold result into the live light while
  // the editor is open, so tuning is judged by feel, not just the lanes —
  // even before any program consumes this derivation.
  $effect(() => {
    const gate =
      mode === "events"
        ? events.map((e) => ({
            start: e.t,
            end: e.t + GATE_PULSE_SEC,
            strength: e.strength,
          }))
        : derivedSegments.map((s) => ({
            start: s.start,
            end: s.end,
            strength: s.strength,
          }));
    audition.output = data
      ? { key: "audition", channels: {}, gate, pixels: null }
      : null;
    return () => {
      audition.output = null;
    };
  });
</script>

<div class="flex flex-col gap-3">
  <div class="flex items-center gap-3">
    {#if isNew}
      <p class="text-base font-medium">New derivation</p>
    {:else if existing}
      <EditableName
        value={derivationLabel(existing)}
        title="Rename this derivation"
        onrename={(name) => renameDerivation(existing.id, name)}
      />
    {/if}
    {#if !isNew && existing}
      <button
        onclick={() => (confirmingDelete = true)}
        title="Delete this derivation (programs referencing it are muted)"
        class="ml-auto rounded border border-edge px-2 py-0.5 text-xs text-danger hover:bg-danger hover:text-surface"
      >
        Delete
      </button>
    {/if}
  </div>
  {#if confirmingDelete && existing}
    <ConfirmDialog
      title={`Delete "${derivationLabel(existing)}"?`}
      body="Removes this derivation from the mapping. Programs referencing it are muted until rebound."
      onconfirm={() => removeDerivation(existing.id)}
      onclose={() => (confirmingDelete = false)}
    />
  {/if}

  <!-- Controls: one labeled row each (transport-style), so the column of
       labels reads as a settings list. Cutoff/ceiling bound the considered
       band — the dots echo their guide-line colors on the source lane. -->
  <div class="flex max-w-xl flex-col gap-2 text-sm">
    <div class="flex h-7 items-center gap-3">
      <span class="w-20 shrink-0 text-ink-muted">Source</span>
      <select
        value={source}
        onchange={(e) => setSource(e.currentTarget.value)}
        class="min-w-0 flex-1 rounded border border-edge bg-app px-1.5 py-1 focus:border-accent focus:outline-none"
      >
        {#each continuousFavorites as fav (fav.path)}
          <option value={fav.path}>{sourceLabel(fav.path)}</option>
        {/each}
        {#if !isNew && source && !continuousFavorites.some((f) => f.path === source)}
          <!-- Keep a stale/unstarred source visible instead of silently swapping it. -->
          <option value={source}>{sourceLabel(source)} (unstarred)</option>
        {/if}
      </select>
      {#if audioKey}
        <label
          title="Audio follows this stem while on; off = the full mix"
          class="flex cursor-pointer select-none items-center gap-2 text-xs text-ink-muted hover:text-ink"
        >
          <input
            type="checkbox"
            checked={soloed}
            onchange={() => (soloed ? backToMix() : soloSource(audioKey))}
            class="sr-only"
          />
          <span
            class="relative inline-flex h-4 w-8 shrink-0 items-center rounded-full transition-colors {soloed
              ? 'bg-accent'
              : 'bg-edge'}"
          >
            <span
              class="absolute h-3 w-3 rounded-full bg-surface transition-transform {soloed
                ? 'translate-x-[1.125rem]'
                : 'translate-x-0.5'}"
            ></span>
          </span>
          Play this stem only
        </label>
      {/if}
    </div>

    <div class="flex h-7 items-center gap-3 text-xs">
      <span class="w-20 shrink-0 text-sm text-ink-muted">Mode</span>
      <Segmented
        class="w-56"
        options={[
          {
            label: "Segments",
            active: mode === "segments",
            onpick: () => patchThreshold({ mode: "segments" }),
            title: "Hysteresis gate: on/off spans with duration",
          },
          {
            label: "Events",
            active: mode === "events",
            onpick: () => patchThreshold({ mode: "events" }),
            title: "Peak-pick: one event per distinct hit",
          },
        ]}
      />
    </div>

    <div class="flex h-7 items-center gap-3">
      <span class="flex w-20 shrink-0 items-center gap-1.5 text-ink-muted">
        Cutoff
        <span class="size-1.5 rounded-full bg-[#f59e0b]"></span>
      </span>
      <input
        type="range"
        min="0.02"
        max="0.98"
        step="0.01"
        value={cutoff}
        oninput={(e) =>
          patchThreshold({
            cutoff: Math.min(Number(e.currentTarget.value), maxBound - 0.02),
          })}
        class="flex-1"
      />
      <span class="w-10 text-right tabular-nums text-ink-muted">
        {cutoff.toFixed(2)}
      </span>
    </div>

    <div class="flex h-7 items-center gap-3">
      <span class="flex w-20 shrink-0 items-center gap-1.5 text-ink-muted">
        Ceiling
        <span class="size-1.5 rounded-full bg-[#ef4444]"></span>
      </span>
      <input
        type="range"
        min="0.05"
        max="1"
        step="0.01"
        value={maxBound}
        oninput={(e) =>
          patchThreshold({
            max: Math.max(Number(e.currentTarget.value), cutoff + 0.02),
          })}
        class="flex-1"
      />
      <span class="w-10 text-right tabular-nums text-ink-muted">
        {maxBound.toFixed(2)}
      </span>
    </div>

    <div
      class="flex h-7 items-center gap-3"
      title="1 = every qualifying change counts; lower = only bigger swings start a new {mode ===
      'events'
        ? 'event'
        : 'segment'}"
    >
      <span class="w-20 shrink-0 text-ink-muted">Sensitivity</span>
      <input
        type="range"
        min="0.05"
        max="1"
        step="0.01"
        value={sensitivity}
        oninput={(e) =>
          patchThreshold({ sensitivity: Number(e.currentTarget.value) })}
        class="flex-1"
      />
      <span class="w-10 text-right tabular-nums text-ink-muted">
        {sensitivity.toFixed(2)}
      </span>
    </div>

    {#if isNew}
      <div class="flex h-9 items-center gap-3">
        <span class="w-20 shrink-0"></span>
        <button
          onclick={create}
          disabled={draft.source === ""}
          class="rounded-md bg-accent px-5 py-1.5 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-50"
        >
          Create
        </button>
      </div>
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
        showYAxis={false}
        {hlines}
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
      Source unavailable — it may have been removed by re-analysis.
    </p>
  {/if}
</div>
