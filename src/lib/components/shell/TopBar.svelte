<script lang="ts">
  import CompanionDialog from "$lib/components/CompanionDialog.svelte";
  import {
    canPublish,
    companion,
    publish,
    publishing,
  } from "$lib/state/companion.svelte";
  import { close, inspection } from "$lib/state/inspection.svelte";
  import { songById } from "$lib/state/library.svelte";
  import {
    setTab,
    TABS,
    toggleSplit,
    workspace,
  } from "$lib/state/workspace.svelte";

  const openSong = $derived(songById(inspection.songId));
  let companionOpen = $state(false);

  // Publish button label for the open song; stages from another song do not
  // show here.
  const publishLabel = $derived.by(() => {
    if (publishing.songId !== inspection.songId) return "Publish";
    switch (publishing.stage) {
      case "rendering":
        return "Rendering…";
      case "uploading":
        return "Uploading…";
      case "done":
        return "Published";
      case "failed":
        return "Publish failed";
      default:
        return "Publish";
    }
  });
  const publishBusy = $derived(
    publishing.songId === inspection.songId &&
      (publishing.stage === "rendering" || publishing.stage === "uploading"),
  );
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
    {#if openSong && companion.status === "connected"}
      <button
        onclick={() => void publish()}
        disabled={publishBusy || !canPublish()}
        title={publishing.songId === inspection.songId && publishing.error
          ? publishing.error
          : "Publish this song's show to the companion"}
        class="mr-1 rounded px-2.5 py-1 text-sm font-medium {publishing.songId ===
          inspection.songId && publishing.stage === 'failed'
          ? 'text-danger'
          : 'text-ink-muted'} hover:bg-raised hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
      >
        {publishLabel}
      </button>
    {/if}
    <button
      onclick={() => (companionOpen = true)}
      title="Companion"
      class="relative rounded px-3 py-1.5 text-xl leading-none text-ink-muted hover:bg-raised hover:text-ink"
    >
      ⇄
      {#if companion.status !== "off"}
        <span
          class="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full {companion.status ===
          'connected'
            ? 'bg-accent'
            : companion.status === 'connecting'
              ? 'bg-ink-faint'
              : 'bg-danger'}"
        ></span>
      {/if}
    </button>
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

{#if companionOpen}
  <CompanionDialog onclose={() => (companionOpen = false)} />
{/if}
