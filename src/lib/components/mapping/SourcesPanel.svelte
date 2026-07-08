<script lang="ts">
  import { sourceLabel, favoriteSources } from "$lib/mapping/sources";
  import { inspection } from "$lib/state/inspection.svelte";
  import { mapping, mappingUi } from "$lib/state/mapping.svelte";

  // Source palette for authoring: the song's favorited subfeatures (curated in
  // Analysis; extendable live via the Analysis|Mapping split) plus the saved
  // derivations. Favorites-only by design — starring is the curation step.

  const favorites = $derived(
    inspection.profile ? favoriteSources(inspection.profile) : [],
  );
  const derivations = $derived(mapping.doc?.derivations ?? []);

  // Only continuous features can be thresholded into a derivation.
  const hasContinuousFavorite = $derived(
    favorites.some((f) => f.feature.render === "continuous"),
  );
</script>

<div class="flex flex-col gap-4 p-3">
  <section>
    <p
      class="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint"
    >
      Favorites
    </p>
    {#if favorites.length === 0}
      <p class="text-sm text-ink-faint">
        No starred features yet — star (★) subfeatures in Analysis to build your
        source palette.
      </p>
    {:else}
      <ul class="flex flex-col gap-0.5">
        {#each favorites as fav (fav.path)}
          <li
            class="flex items-baseline justify-between gap-2 rounded px-1.5 py-1 text-sm"
            title={fav.path}
          >
            <span class="truncate">{sourceLabel(fav.path)}</span>
            <span class="shrink-0 text-xs text-ink-faint">
              {fav.feature.render}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section>
    <div class="mb-1.5 flex items-center justify-between">
      <p class="text-xs font-medium uppercase tracking-wide text-ink-faint">
        Derivations
      </p>
      <button
        onclick={() => (mappingUi.editingDerivation = "new")}
        disabled={!hasContinuousFavorite}
        title={hasContinuousFavorite
          ? "Derive events or gates from a favorited continuous feature"
          : "Star a continuous feature first"}
        class="rounded border border-edge px-1.5 py-0.5 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
      >
        + New
      </button>
    </div>
    {#if derivations.length === 0}
      <p class="text-sm text-ink-faint">
        None yet. Threshold a continuous favorite into events or gate segments.
      </p>
    {:else}
      <ul class="flex flex-col gap-0.5">
        {#each derivations as d (d.id)}
          <li>
            <button
              onclick={() => (mappingUi.editingDerivation = d.id)}
              title={`${d.source} · cutoff ${d.threshold.cutoff.toFixed(2)}`}
              class="flex w-full items-baseline justify-between gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-raised {mappingUi.editingDerivation ===
              d.id
                ? 'bg-raised text-accent'
                : ''}"
            >
              <span class="truncate">{d.id}</span>
              <span class="shrink-0 text-xs text-ink-faint">
                {d.threshold.mode}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
