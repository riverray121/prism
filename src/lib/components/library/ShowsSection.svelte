<script lang="ts">
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import type { ShowSummary } from "$lib/companion/client";
  import {
    companion,
    pull,
    pullableShows,
    pulling,
  } from "$lib/state/companion.svelte";

  // Published shows the library lacks or that are newer on the companion.
  // Pulling over a local song replaces its profile and mapping, so that case
  // confirms first.
  const rows = $derived(pullableShows());
  let confirmFor = $state<ShowSummary | null>(null);
</script>

{#if companion.status === "connected" && rows.length > 0}
  <div class="flex flex-col overflow-hidden rounded-md border border-edge">
    <p
      class="border-b border-edge bg-raised px-3 py-1 text-xs font-medium text-ink-muted"
    >
      On companion
    </p>
    {#each rows as { show, local } (show.id)}
      <div
        class="flex flex-col gap-0.5 border-b border-edge px-3 py-2 last:border-0"
      >
        <span class="min-w-0 truncate text-base">{show.title}</span>
        <div class="flex items-center gap-2 text-xs text-ink-muted">
          <span class="min-w-0 flex-1 truncate">
            {show.artist}{local ? " · newer on companion" : ""}
          </span>
          {#if pulling.showId === show.id}
            <span class="shrink-0 text-ink-faint">Pulling…</span>
          {:else}
            <button
              onclick={() => (local ? (confirmFor = show) : void pull(show.id))}
              disabled={pulling.showId !== null}
              class="shrink-0 rounded bg-raised px-2.5 py-1 text-sm font-medium hover:text-ink disabled:opacity-40"
            >
              Pull
            </button>
          {/if}
        </div>
        {#if pulling.error && pulling.showId === null}
          <p class="truncate text-xs text-danger" title={pulling.error}>
            Pull failed: {pulling.error}
          </p>
        {/if}
      </div>
    {/each}
  </div>
{/if}

{#if confirmFor}
  <ConfirmDialog
    title="Replace local project?"
    body={`Pulling "${confirmFor.title}" replaces this library's analysis and mapping for the song with the companion's copy.`}
    onconfirm={() => {
      const id = confirmFor!.id;
      confirmFor = null;
      void pull(id);
    }}
    onclose={() => (confirmFor = null)}
  />
{/if}
