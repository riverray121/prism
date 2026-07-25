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
  <div class="flex min-w-0 flex-1 items-center px-3">
    {#if openSong}
      <!-- The working song, as a filled chip with a note glyph so it reads as
           "what's open" at a glance rather than blending into the chrome. -->
      <div
        class="flex min-w-0 items-center gap-2 rounded-md bg-raised py-1 pl-2.5 pr-1"
        title={`Open song: ${openSong.title} — ${openSong.artist}`}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="currentColor"
          class="shrink-0 text-accent"
        >
          <path
            d="M9 18.5a3 3 0 1 1-2-2.83V5.6a1 1 0 0 1 .76-.97l9-2.25A1 1 0 0 1 18 3.35v11.32a3 3 0 1 1-2-2.83V7.03l-7 1.75z"
          />
        </svg>
        <span class="truncate text-sm font-semibold text-ink">
          {openSong.title}
        </span>
        <span class="truncate text-sm text-ink-muted">{openSong.artist}</span>
        <button
          onclick={close}
          title="Close this song"
          class="shrink-0 rounded px-1.5 py-0.5 text-base leading-none text-ink-faint hover:bg-surface hover:text-ink"
        >
          ×
        </button>
      </div>
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
      title={workspace.splitTab === null ? "Split view" : "Close split view"}
      class="rounded px-3 py-1.5 text-xl leading-none {workspace.splitTab !==
      null
        ? 'bg-raised text-accent'
        : 'text-ink-muted hover:bg-raised hover:text-ink'}"
    >
      ◫
    </button>
  </div>
</header>
