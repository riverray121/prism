<script lang="ts">
  import DialogShell from "$lib/components/DialogShell.svelte";
  import { updateMetadata } from "$lib/ipc";
  import type { Song } from "$lib/ipc/messages";

  // Edit a song's title/artist. Persisted by the sidecar (DB row and, when
  // analyzed, profile.json); the next snapshot reflects it everywhere.
  let { song, onclose }: { song: Song; onclose: () => void } = $props();

  // Seed the inputs from the song at open; the dialog is recreated per song,
  // so capturing the initial value is the intent.
  // svelte-ignore state_referenced_locally
  let title = $state(song.title);
  // svelte-ignore state_referenced_locally
  let artist = $state(song.artist);

  function save() {
    void updateMetadata(song.id, title.trim(), artist.trim());
    onclose();
  }
</script>

<DialogShell title="Edit metadata" {onclose}>
  <div class="mt-3 flex flex-col gap-3">
    <label class="flex flex-col gap-1 text-xs text-ink-muted">
      Title
      <input
        bind:value={title}
        class="rounded border border-edge bg-app px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none"
      />
    </label>
    <label class="flex flex-col gap-1 text-xs text-ink-muted">
      Artist
      <input
        bind:value={artist}
        class="rounded border border-edge bg-app px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none"
      />
    </label>
  </div>
  <div class="mt-4 flex justify-end gap-2">
    <button
      onclick={onclose}
      class="rounded border border-edge px-3 py-1 text-sm text-ink-muted hover:text-ink"
    >
      Cancel
    </button>
    <button
      onclick={save}
      disabled={title.trim() === ""}
      class="rounded bg-accent px-3 py-1 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-50"
    >
      Save
    </button>
  </div>
</DialogShell>
