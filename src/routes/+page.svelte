<script lang="ts">
  import { onMount } from "svelte";

  import AnalysisSettings from "$lib/components/AnalysisSettings.svelte";
  import InspectionView from "$lib/components/InspectionView.svelte";
  import LibraryPanel from "$lib/components/LibraryPanel.svelte";
  import { getSettings, listLibrary, onSidecarEvent } from "$lib/ipc";
  import { library } from "$lib/state/library.svelte";
  import { inspection } from "$lib/state/inspection.svelte";
  import { settings } from "$lib/state/settings.svelte";

  // Subscribe to sidecar events and request the current library + settings on mount.
  onMount(() => {
    const off = onSidecarEvent((event) => {
      if (event.type === "library.songs") {
        library.songs = event.songs;
      } else if (event.type === "library.import_failed") {
        console.error("import failed", event.path, event.error);
      } else if (event.type === "profile") {
        // Ignore stale responses if the user has since navigated away/elsewhere.
        if (event.song_id === inspection.songId) {
          inspection.profile = event.profile;
          inspection.audioPath = event.audio_path;
          inspection.songDir = event.song_dir;
        }
      } else if (event.type === "settings") {
        settings.engines = event.engines;
        settings.availableEngines = event.available_engines;
        settings.loaded = true;
      }
    });
    listLibrary();
    getSettings();
    return off;
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
