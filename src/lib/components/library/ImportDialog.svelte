<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";

  import DialogShell from "$lib/components/DialogShell.svelte";
  import { importFiles, importYoutube } from "$lib/ipc";
  import { library } from "$lib/state/library.svelte";

  // Import entry point behind the sidebar's plus button: local audio files via
  // the native picker, or a YouTube URL downloaded and converted by the sidecar.
  let { onclose }: { onclose: () => void } = $props();

  let url = $state("");
  // URL whose download we're waiting on; keeps the dialog open with progress.
  let submitted = $state<string | null>(null);

  const downloading = $derived(
    submitted !== null && library.pendingImports.includes(submitted),
  );
  const failed = $derived(
    submitted !== null && library.lastImportError?.path === submitted
      ? library.lastImportError
      : null,
  );

  // Close once the download finished cleanly (song row arrives via snapshot).
  // The latch waits for import_started to round-trip first — without it the
  // effect would close the dialog before the sidecar even acknowledged.
  let sawStart = $state(false);
  $effect(() => {
    if (downloading) sawStart = true;
    else if (submitted !== null && sawStart && !failed) onclose();
  });

  async function pickFiles() {
    const selected = await open({
      multiple: true,
      filters: [
        { name: "Audio", extensions: ["flac", "wav", "mp3", "m4a", "aac"] },
      ],
    });
    if (selected === null) return;
    library.lastImportError = null;
    await importFiles(Array.isArray(selected) ? selected : [selected]);
    onclose();
  }

  function submitUrl() {
    const trimmed = url.trim();
    if (trimmed === "") return;
    library.lastImportError = null;
    // Re-arm the latch: a leftover true from a previous (failed) attempt would
    // close the dialog before this download is even acknowledged.
    sawStart = false;
    submitted = trimmed;
    void importYoutube(trimmed);
    // The dialog stays open showing progress until import_finished arrives.
  }
</script>

<DialogShell title="Add songs" {onclose}>
  <div class="mt-3 flex flex-col gap-4">
    <button
      onclick={pickFiles}
      class="rounded border border-edge px-3 py-2 text-sm hover:bg-raised"
    >
      Choose audio files…
    </button>

    <div class="flex flex-col gap-1">
      <label class="text-xs text-ink-muted" for="yt-url">
        or paste a YouTube URL
      </label>
      <div class="flex gap-2">
        <input
          id="yt-url"
          bind:value={url}
          placeholder="https://www.youtube.com/watch?v=…"
          onkeydown={(e) => e.key === "Enter" && submitUrl()}
          class="min-w-0 flex-1 rounded border border-edge bg-app px-2 py-1 text-sm placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <button
          onclick={submitUrl}
          disabled={url.trim() === "" || downloading}
          title="Download this URL's audio as FLAC and import it"
          class="rounded bg-accent px-3 py-1 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-50"
        >
          Import
        </button>
      </div>
      <p class="text-xs text-ink-faint">
        Downloads as FLAC. Requires ffmpeg on the system.
      </p>

      {#if downloading}
        <!-- Indeterminate: yt-dlp exposes no byte progress through this path. -->
        <div class="flex flex-col gap-1">
          <p class="text-xs text-ink-muted">Downloading…</p>
          <div class="h-1.5 overflow-hidden rounded bg-raised">
            <div class="h-full w-1/3 animate-indeterminate bg-accent"></div>
          </div>
        </div>
      {:else if failed}
        <p class="text-xs text-danger" title={failed.error}>
          Import failed: {failed.error}
        </p>
      {/if}
    </div>
  </div>
</DialogShell>
