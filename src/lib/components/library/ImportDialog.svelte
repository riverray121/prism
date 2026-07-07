<script lang="ts">
  import { Dialog } from "bits-ui";
  import { open } from "@tauri-apps/plugin-dialog";

  import { importFiles, importYoutube } from "$lib/ipc";
  import { library } from "$lib/state/library.svelte";

  // Import entry point behind the sidebar's plus button: local audio files via
  // the native picker, or a YouTube URL downloaded and converted by the sidecar.
  let { onclose }: { onclose: () => void } = $props();

  let url = $state("");

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
    void importYoutube(trimmed);
    // The download runs sidecar-side; the row appears via the next snapshot,
    // or lastImportError carries the failure (e.g. missing ffmpeg).
    onclose();
  }
</script>

<Dialog.Root open onOpenChange={(o) => !o && onclose()}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
    <Dialog.Content
      class="fixed left-1/2 top-1/2 z-50 w-96 max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-md border border-edge bg-surface p-4 shadow-lg"
    >
      <Dialog.Title class="text-sm font-semibold">Add songs</Dialog.Title>

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
              disabled={url.trim() === ""}
              class="rounded bg-accent px-3 py-1 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-50"
            >
              Import
            </button>
          </div>
          <p class="text-xs text-ink-faint">
            Downloads as FLAC. Requires ffmpeg on the system.
          </p>
        </div>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
