<script lang="ts">
  import DerivationEditor from "$lib/components/mapping/DerivationEditor.svelte";
  import SourcesPanel from "$lib/components/mapping/SourcesPanel.svelte";
  import { inspection } from "$lib/state/inspection.svelte";
  import { mapping, mappingUi } from "$lib/state/mapping.svelte";

  // The Mapping tab: author derivations and programs from favorited features
  // and confirm the result against playback. Sources on the left, editors and
  // preview lanes in the main column.

  const ready = $derived(inspection.profile !== null && mapping.doc !== null);
</script>

{#if !ready}
  <div class="flex h-full items-center justify-center">
    <p class="text-sm text-ink-faint">Loading…</p>
  </div>
{:else}
  <div class="flex h-full">
    <aside
      class="w-72 shrink-0 overflow-y-auto border-r border-edge bg-surface"
    >
      <SourcesPanel />
    </aside>
    <main class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 pb-32">
      {#if mappingUi.editingDerivation !== null}
        <DerivationEditor />
      {:else}
        <p class="text-sm text-ink-faint">
          Star features in Analysis, then derive gates and author programs from
          them here.
        </p>
      {/if}
    </main>
  </div>
{/if}
