<script lang="ts">
  import { Tooltip } from "bits-ui";

  import LibraryPanel from "$lib/components/LibraryPanel.svelte";
  import { toggleSidebar, workspace } from "$lib/state/workspace.svelte";
</script>

<aside
  class="flex shrink-0 border-r border-edge bg-surface {workspace.sidebarExpanded
    ? 'w-[32rem]'
    : 'w-10'}"
>
  {#if workspace.sidebarExpanded}
    <div class="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div class="flex h-bar shrink-0 items-center justify-between px-3">
        <span class="text-sm font-semibold">Library</span>
        <button
          onclick={toggleSidebar}
          class="px-1 text-sm text-ink-muted hover:text-ink"
        >
          «
        </button>
      </div>
      <div class="flex flex-col gap-6 px-3 pb-6">
        <LibraryPanel />
      </div>
    </div>
  {:else}
    <div class="flex flex-1 flex-col items-center pt-2">
      <Tooltip.Provider delayDuration={300}>
        <Tooltip.Root>
          <Tooltip.Trigger
            onclick={toggleSidebar}
            class="rounded px-1.5 py-0.5 text-sm text-ink-muted hover:bg-raised hover:text-ink"
          >
            »
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="right"
              sideOffset={6}
              class="rounded border border-edge bg-raised px-2 py-1 text-xs text-ink"
            >
              Expand library
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
    </div>
  {/if}
</aside>
