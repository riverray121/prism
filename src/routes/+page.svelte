<script lang="ts">
  import { onMount } from "svelte";

  import AnalysisSettings from "$lib/components/AnalysisSettings.svelte";
  import InspectionView from "$lib/components/InspectionView.svelte";
  import LibraryPanel from "$lib/components/LibraryPanel.svelte";
  import { getSettings, listLibrary, onSidecarEvent } from "$lib/ipc";
  import { applySidecarEvent } from "$lib/state/sidecar";
  import { inspection } from "$lib/state/inspection.svelte";

  // Attach the sidecar-event listener, then request the current library +
  // settings. The listener is awaited first so no reply emitted before it is
  // attached can be dropped.
  onMount(() => {
    let off: (() => void) | undefined;
    let stopped = false;
    (async () => {
      off = await onSidecarEvent(applySidecarEvent);
      if (stopped) {
        off();
        return;
      }
      listLibrary();
      getSettings();
    })();
    return () => {
      stopped = true;
      off?.();
    };
  });
</script>

<main class="flex min-h-screen flex-col items-center gap-8 px-6 py-10">
  <header class="text-center">
    <h1 class="text-3xl font-semibold tracking-tight">Prism</h1>
    <p class="text-sm text-neutral-500 dark:text-neutral-400">
      Audio analysis dashboard
    </p>
  </header>

  {#if inspection.songId === null}
    <LibraryPanel />
    <AnalysisSettings />
  {:else}
    <InspectionView />
  {/if}
</main>
