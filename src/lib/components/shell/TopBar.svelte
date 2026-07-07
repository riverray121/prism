<script lang="ts">
  import { close, inspection } from "$lib/state/inspection.svelte";
  import { songById } from "$lib/state/library.svelte";
  import {
    setTab,
    TABS,
    toggleSplit,
    workspace,
  } from "$lib/state/workspace.svelte";

  const openSong = $derived(songById(inspection.songId));
</script>

<header
  class="relative flex h-bar shrink-0 items-stretch border-b border-edge bg-surface"
>
  <div class="flex min-w-0 flex-1 items-center gap-2 px-3">
    {#if openSong}
      <span class="truncate text-sm text-ink" title="Open song">
        {openSong.title} — {openSong.artist}
      </span>
      <button
        onclick={close}
        title="Close this song"
        class="rounded px-2 py-1 text-base leading-none text-ink-faint hover:bg-raised hover:text-ink"
      >
        ×
      </button>
    {/if}
  </div>

  <!-- Pipeline stages, centered. Hidden while split: the pane headers are the
       tab pickers then, so the stages never appear in more than two places. -->
  {#if workspace.splitTab === null}
    <nav class="absolute inset-x-0 mx-auto flex w-fit items-stretch">
      {#each TABS as { id, label } (id)}
        <button
          onclick={() => setTab(id)}
          title={`Show the ${label} stage`}
          class="border-b-2 px-5 text-sm {workspace.tab === id
            ? 'border-accent text-ink'
            : 'border-transparent text-ink-muted hover:text-ink'}"
          style:height="var(--spacing-bar)"
        >
          {label}
        </button>
      {/each}
    </nav>
  {/if}

  <div class="flex items-center px-2">
    <button
      onclick={toggleSplit}
      title={workspace.splitTab === null
        ? "Split view: two stages side by side"
        : "Close split view"}
      class="rounded px-3 py-1.5 text-base leading-none {workspace.splitTab !==
      null
        ? 'bg-raised text-accent'
        : 'text-ink-muted hover:bg-raised hover:text-ink'}"
    >
      ◫
    </button>
  </div>
</header>
