<script lang="ts">
  import { formatTime } from "$lib/format";
  import { close, inspection, playToggle } from "$lib/state/inspection.svelte";
  import { songById } from "$lib/state/library.svelte";
  import { transport } from "$lib/state/transport.svelte";
  import {
    setTab,
    TABS,
    toggleSplit,
    workspace,
  } from "$lib/state/workspace.svelte";

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

      <!-- Global transport: one clock for every tab. Plays the audible source
           (mix by default; a stem when soloed from a graph lane). -->
      <button
        onclick={() => playToggle(transport.activeKey)}
        disabled={!inspection.audioPath}
        class="rounded bg-accent px-3 py-0.5 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-50"
      >
        {transport.playing ? "Pause" : "Play"}
      </button>
      <span class="text-sm tabular-nums text-ink-muted">
        {formatTime(transport.currentTime)} / {formatTime(
          transport.durationSec,
        )}
      </span>
      {#if transport.activeKey !== "mix"}
        <span class="text-xs text-ink-faint">
          ♪ {transport.activeKey.split("::").at(-1)}
        </span>
      {/if}
      {#if transport.error}
        <span class="truncate text-xs text-danger">{transport.error}</span>
      {/if}
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
    <button
      onclick={toggleSplit}
      title={workspace.splitTab === null
        ? "Split view (two tabs side by side)"
        : "Close split view"}
      class="border-b-2 border-transparent px-3 text-sm {workspace.splitTab !==
      null
        ? 'text-accent'
        : 'text-ink-muted hover:text-ink'}"
    >
      ◫
    </button>
  </nav>
</header>
