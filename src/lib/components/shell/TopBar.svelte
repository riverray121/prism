<script lang="ts">
  import { close, inspection } from "$lib/state/inspection.svelte";
  import { songById } from "$lib/state/library.svelte";
  import { setTab, TABS, workspace } from "$lib/state/workspace.svelte";

  const openSong = $derived(songById(inspection.songId));
</script>

<header
  class="flex h-bar shrink-0 items-stretch border-b border-edge bg-surface"
>
  <div class="flex min-w-0 flex-1 items-center gap-3 px-3">
    <span class="text-sm font-semibold tracking-tight">Prism</span>
    {#if openSong}
      <span class="truncate text-sm text-ink-muted">
        {openSong.title} — {openSong.artist}
      </span>
      <button
        onclick={close}
        title="Close song"
        class="px-1 text-sm text-ink-faint hover:text-ink"
      >
        ×
      </button>
    {/if}
  </div>

  <nav class="flex items-stretch">
    {#each TABS as { id, label } (id)}
      <button
        onclick={() => setTab(id)}
        class="border-b-2 px-4 text-sm {workspace.tab === id
          ? 'border-accent text-ink'
          : 'border-transparent text-ink-muted hover:text-ink'}"
      >
        {label}
      </button>
    {/each}
  </nav>
</header>
