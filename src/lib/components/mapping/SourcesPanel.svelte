<script lang="ts">
  import { derivationLabel } from "$lib/mapping/labels";
  import { favoriteSources } from "$lib/mapping/sources";
  import { inspection } from "$lib/state/inspection.svelte";
  import {
    editDerivation,
    mapping,
    mappingUi,
  } from "$lib/state/mapping.svelte";

  // Derivations authored from favorited features (starred in Analysis;
  // extendable live via the Analysis|Mapping split). Favorites themselves are
  // not listed — the star set is curated in Analysis, not here.

  const derivations = $derived(mapping.doc?.derivations ?? []);

  // Only continuous features can be thresholded into a derivation.
  const hasContinuousFavorite = $derived(
    inspection.profile
      ? favoriteSources(inspection.profile).some(
          (f) => f.feature.render === "continuous",
        )
      : false,
  );
</script>

<div class="flex flex-col gap-4 p-3">
  <section>
    <div class="mb-1.5 flex items-center justify-between">
      <p class="text-xs font-medium uppercase tracking-wide text-ink-faint">
        Derivations
      </p>
      <button
        onclick={() => editDerivation("new")}
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
      <p class="text-sm text-ink-faint">None</p>
    {:else}
      <ul class="flex flex-col gap-0.5">
        {#each derivations as d (d.id)}
          <li>
            <button
              onclick={() => editDerivation(d.id)}
              title={`${d.source} · cutoff ${d.threshold.cutoff.toFixed(2)}`}
              class="flex w-full items-baseline justify-between gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-raised {mappingUi.editingDerivation ===
              d.id
                ? 'bg-raised text-accent'
                : ''}"
            >
              <span class="truncate">{derivationLabel(d)}</span>
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
