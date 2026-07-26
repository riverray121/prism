<script lang="ts">
  import { programLabel, sourceLabel } from "$lib/mapping/labels";
  import { favoriteSources, resolveFeature } from "$lib/mapping/sources";
  import { inspection } from "$lib/state/inspection.svelte";
  import {
    mapping,
    setMaster,
    setScene,
    setScenesFrom,
  } from "$lib/state/mapping.svelte";

  // The macro layer: scenes from a favorited segment feature (a preset per
  // section label — which programs play, at what master scale) and the
  // adaptive master over everything.

  const doc = $derived(mapping.doc);
  const macro = $derived(mapping.doc?.macro);

  // Segment-rendered favorites can drive scenes; continuous ones the master.
  const segmentSources = $derived(
    inspection.profile
      ? favoriteSources(inspection.profile).filter(
          (f) => f.feature.render === "segment",
        )
      : [],
  );
  const continuousSources = $derived(
    inspection.profile
      ? favoriteSources(inspection.profile).filter(
          (f) => f.feature.render === "continuous",
        )
      : [],
  );

  // Distinct section labels of the selected scenes source, first-seen order.
  const labels = $derived.by(() => {
    const source = macro?.scenes_from;
    if (!source || !inspection.profile) return [];
    const feature = resolveFeature(inspection.profile, source);
    if (feature?.render !== "segment") return [];
    const seen = new Set<string>();
    for (const seg of feature.segments) seen.add(seg.label);
    return [...seen];
  });

  const programIds = $derived(doc?.programs.map((p) => p.id) ?? []);

  function toggleSceneProgram(label: string, id: string): void {
    const scene = macro?.scenes[label];
    if (!scene) return;
    const programs = scene.programs.includes(id)
      ? scene.programs.filter((p) => p !== id)
      : [...scene.programs, id];
    setScene(label, { ...scene, programs });
  }
</script>

{#if doc && macro}
  <details class="rounded border border-edge bg-surface">
    <summary
      class="cursor-pointer select-none px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-faint hover:text-ink"
    >
      Macro — scenes &amp; master
    </summary>
    <div class="flex flex-col gap-4 border-t border-edge p-3 text-sm">
      <!-- Scenes -->
      <section class="flex flex-col gap-2">
        <label class="flex items-center gap-2">
          <span class="text-ink-muted">Scenes from</span>
          <select
            value={macro.scenes_from ?? ""}
            onchange={(e) => setScenesFrom(e.currentTarget.value || null)}
            class="rounded border border-edge bg-app px-1.5 py-0.5"
          >
            <option value="">— none —</option>
            {#each segmentSources as s (s.path)}
              <option value={s.path}>{sourceLabel(s.path)}</option>
            {/each}
            {#if macro.scenes_from && !segmentSources.some((s) => s.path === macro.scenes_from)}
              <option value={macro.scenes_from}>
                {sourceLabel(macro.scenes_from)} (unstarred)
              </option>
            {/if}
          </select>
        </label>

        {#if macro.scenes_from !== null && labels.length === 0}
          <p class="text-xs text-ink-faint">
            The selected source has no labeled sections on this profile.
          </p>
        {/if}

        {#each labels as label (label)}
          {@const scene = macro.scenes[label]}
          <div
            class="flex flex-wrap items-center gap-3 rounded border border-edge bg-app px-2 py-1.5"
          >
            <span class="w-24 truncate font-medium" title={label}>{label}</span>
            {#if scene}
              {#each doc?.programs ?? [] as p (p.id)}
                <label class="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={scene.programs.includes(p.id)}
                    onchange={() => toggleSceneProgram(label, p.id)}
                  />
                  {programLabel(p)}
                </label>
              {/each}
              <label class="flex items-center gap-1 text-xs">
                scale
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={scene.master_scale}
                  oninput={(e) =>
                    setScene(label, {
                      ...scene,
                      master_scale: Number(e.currentTarget.value),
                    })}
                  class="w-24"
                />
                <span class="w-8 tabular-nums"
                  >{scene.master_scale.toFixed(2)}</span
                >
              </label>
              <button
                onclick={() => setScene(label, null)}
                title="Remove this preset (section falls back to all programs, full scale)"
                class="ml-auto rounded px-1 text-xs text-ink-faint hover:text-danger"
              >
                ×
              </button>
            {:else}
              <span class="text-xs text-ink-faint"
                >default (all programs, full scale)</span
              >
              <button
                onclick={() =>
                  setScene(label, {
                    programs: [...programIds],
                    master_scale: 1,
                  })}
                class="ml-auto rounded border border-edge px-1.5 py-0.5 text-xs text-ink-muted hover:text-ink"
              >
                Customize
              </button>
            {/if}
          </div>
        {/each}
      </section>

      <!-- Adaptive master -->
      <section class="flex flex-wrap items-center gap-3">
        <label class="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={macro.master !== null}
            onchange={(e) =>
              setMaster(
                e.currentTarget.checked
                  ? {
                      source: continuousSources[0]?.path ?? "mix.rms",
                      adaptive: { mode: "windowed", window_s: 4 },
                    }
                  : null,
              )}
          />
          <span class="text-ink-muted">Adaptive master</span>
        </label>

        {#if macro.master}
          {@const master = macro.master}
          <select
            value={master.adaptive.mode}
            onchange={(e) =>
              setMaster({
                ...master,
                adaptive: {
                  ...master.adaptive,
                  mode: e.currentTarget.value as
                    | "absolute"
                    | "windowed"
                    | "share",
                },
              })}
            title="absolute: song max · windowed: rolling max · share: split across active programs"
            class="rounded border border-edge bg-app px-1.5 py-0.5"
          >
            <option value="absolute">absolute</option>
            <option value="windowed">windowed</option>
            <option value="share">share</option>
          </select>

          {#if master.adaptive.mode !== "share"}
            <label class="flex items-center gap-1">
              <span class="text-ink-muted">source</span>
              <select
                value={master.source}
                onchange={(e) =>
                  setMaster({ ...master, source: e.currentTarget.value })}
                class="rounded border border-edge bg-app px-1.5 py-0.5"
              >
                {#each continuousSources as s (s.path)}
                  <option value={s.path}>{sourceLabel(s.path)}</option>
                {/each}
                {#if !continuousSources.some((s) => s.path === master.source)}
                  <option value={master.source}>
                    {sourceLabel(master.source)} (unstarred)
                  </option>
                {/if}
              </select>
            </label>
          {/if}

          {#if master.adaptive.mode === "windowed"}
            <label class="flex items-center gap-1">
              <span class="text-ink-muted">window (s)</span>
              <input
                type="number"
                min="0.5"
                max="30"
                step="0.5"
                value={master.adaptive.window_s}
                onchange={(e) =>
                  setMaster({
                    ...master,
                    adaptive: {
                      ...master.adaptive,
                      window_s: Number(e.currentTarget.value) || 4,
                    },
                  })}
                class="w-16 rounded border border-edge bg-app px-1.5 py-0.5"
              />
            </label>
          {/if}
        {/if}
      </section>
    </div>
  </details>
{/if}
