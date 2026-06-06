<script lang="ts">
  import { onMount } from "svelte";

  import LibraryPanel from "$lib/components/LibraryPanel.svelte";
  import { listLibrary, onSidecarEvent } from "$lib/ipc";
  import { library } from "$lib/state/library.svelte";

  // Subscribe to sidecar events and request the current library on mount.
  onMount(() => {
    const off = onSidecarEvent((event) => {
      if (event.type === "library.songs") {
        library.songs = event.songs;
      } else if (event.type === "library.import_failed") {
        console.error("import failed", event.path, event.error);
      }
    });
    listLibrary();
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

  <LibraryPanel />
</main>
