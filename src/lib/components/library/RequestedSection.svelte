<script lang="ts">
  import { requestImportKey } from "$lib/ipc";
  import {
    companion,
    importRequest,
    rejectRequest,
  } from "$lib/state/companion.svelte";
  import { library } from "$lib/state/library.svelte";

  // Open companion requests, above the song list. Import runs the sidecar's
  // YouTube search import; the row stays visible as "Importing…" until the
  // sidecar reports the import finished.
  const importing = $derived(
    library.pendingImports
      .filter((p) => p.startsWith("request:"))
      .map((p) => p.slice("request:".length)),
  );
  const failed = $derived(
    library.lastImportError?.path.startsWith("request:")
      ? library.lastImportError
      : null,
  );
</script>

{#if companion.status === "connected" && (companion.requests.length > 0 || importing.length > 0)}
  <div class="flex flex-col overflow-hidden rounded-md border border-edge">
    <p
      class="border-b border-edge bg-raised px-3 py-1 text-xs font-medium text-ink-muted"
    >
      Requested
    </p>
    {#each importing as id (id)}
      <div
        class="flex items-center gap-2 border-b border-edge px-3 py-2 text-sm last:border-0"
      >
        <span class="min-w-0 flex-1 truncate text-ink-muted">Importing…</span>
        {#if failed && failed.path === requestImportKey(id)}
          <span class="truncate text-xs text-danger" title={failed.error}>
            failed
          </span>
        {/if}
      </div>
    {/each}
    {#each companion.requests as request (request.id)}
      <div
        class="flex flex-col gap-0.5 border-b border-edge px-3 py-2 last:border-0"
      >
        <span class="min-w-0 truncate text-base">{request.title}</span>
        <div class="flex items-center gap-2 text-xs text-ink-muted">
          <span class="min-w-0 flex-1 truncate">{request.artist}</span>
          <button
            onclick={() => void rejectRequest(request)}
            class="shrink-0 rounded px-1.5 py-0.5 text-ink-faint hover:bg-raised hover:text-danger"
          >
            Reject
          </button>
          <button
            onclick={() => void importRequest(request)}
            class="shrink-0 rounded bg-raised px-2.5 py-1 text-sm font-medium hover:text-ink"
          >
            Import
          </button>
        </div>
      </div>
    {/each}
  </div>
{/if}
