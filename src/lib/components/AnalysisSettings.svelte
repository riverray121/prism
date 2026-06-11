<script lang="ts">
  import { updateSettings } from "$lib/ipc";
  import { settings } from "$lib/state/settings.svelte";

  // Friendly labels for known engine ids; falls back to the raw id.
  const LABELS: Record<string, string> = {
    htdemucs_ft: "Demucs (htdemucs_ft) — vocals/drums/bass/other",
    htdemucs_6s: "Demucs 6-stem (htdemucs_6s) — + guitar/piano",
    bs_roformer: "BS-RoFormer — vocals/instrumental",
    mel_band_roformer: "Mel-Band RoFormer — vocals/instrumental",
  };
  function label(id: string): string {
    return LABELS[id] ?? id;
  }

  // Toggle an engine; update the store optimistically, then persist via the
  // sidecar (which echoes back a settings snapshot to confirm).
  function toggle(engine: string, on: boolean) {
    const next = on
      ? settings.availableEngines.filter(
          (e) => e === engine || settings.engines.includes(e),
        )
      : settings.engines.filter((e) => e !== engine);
    settings.engines = next;
    updateSettings({ engines: next });
  }

  // Toggle drum sub-separation (splits a drums stem into kick/snare/etc.).
  function toggleDrumSubsep(on: boolean) {
    settings.drumSubsep = on;
    updateSettings({ drum_subsep: on });
  }

  // Engines that emit a `drums` stem (Demucs variants) — the only ones drum
  // sub-separation can run on; the RoFormers output vocals/instrumental.
  const DRUMS_ENGINES = new Set(["htdemucs_ft", "htdemucs_6s"]);
  // Anchor the nested drum sub-sep box under the last drums-producing engine.
  const lastDrumsEngine = $derived(
    settings.availableEngines.filter((e) => DRUMS_ENGINES.has(e)).at(-1),
  );
  // Drum sub-sep is only meaningful when a drums-producing engine is selected.
  const canDrumSubsep = $derived(
    settings.engines.some((e) => DRUMS_ENGINES.has(e)),
  );
</script>

<section class="flex w-full max-w-2xl flex-col gap-3">
  <h2 class="text-lg font-semibold">Analysis settings</h2>
  <div
    class="flex flex-col gap-3 rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
  >
    <p class="text-xs text-neutral-500 dark:text-neutral-400">
      Separation engines to run on each analysis. More engines means longer
      analysis; every engine's stems are kept for comparison.
    </p>
    {#if !settings.loaded}
      <p class="text-sm text-neutral-500">Loading…</p>
    {:else}
      {#each settings.availableEngines as engine (engine)}
        <label class="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            class="size-4 accent-indigo-600"
            checked={settings.engines.includes(engine)}
            onchange={(e) => toggle(engine, e.currentTarget.checked)}
          />
          {label(engine)}
        </label>
        {#if engine === lastDrumsEngine}
          <!-- Nested under the Demucs engines: drum sub-sep needs their drums stem. -->
          <label
            class="ml-6 flex items-center gap-2 text-sm {canDrumSubsep
              ? ''
              : 'opacity-50'}"
            title={canDrumSubsep
              ? ""
              : "Select a Demucs engine to enable drum sub-separation"}
          >
            <input
              type="checkbox"
              class="size-4 accent-indigo-600"
              disabled={!canDrumSubsep}
              checked={settings.drumSubsep && canDrumSubsep}
              onchange={(e) => toggleDrumSubsep(e.currentTarget.checked)}
            />
            ↳ Drum sub-separation — kick/snare/toms/hh/ride/crash
          </label>
        {/if}
      {/each}
      {#if settings.engines.length === 0}
        <p class="text-xs text-amber-600 dark:text-amber-500">
          No engines selected — analysis will produce mix features only, no
          stems.
        </p>
      {/if}
    {/if}
  </div>
</section>
