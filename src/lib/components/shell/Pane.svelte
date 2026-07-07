<script lang="ts">
  import TabContent from "$lib/components/shell/TabContent.svelte";
  import {
    fullscreenPane,
    setSplitTab,
    setTab,
    TABS,
    workspace,
    type Tab,
  } from "$lib/state/workspace.svelte";

  // One half of the split view: a slim header (tab picker + fullscreen) above
  // the tab's content. Only rendered while the workspace is split.
  let { side }: { side: "primary" | "split" } = $props();

  const tab = $derived(
    side === "primary" ? workspace.tab : (workspace.splitTab ?? workspace.tab),
  );

  function pick(next: Tab) {
    if (side === "primary") setTab(next);
    else setSplitTab(next);
  }
</script>

<div class="flex h-full min-h-0 min-w-0 flex-col">
  <div
    class="flex h-10 shrink-0 items-center gap-1 border-b border-edge bg-surface px-2"
  >
    {#each TABS as { id, label } (id)}
      <button
        onclick={() => pick(id)}
        title={`Show the ${label} stage in this pane`}
        class="rounded px-3 py-1 text-sm {tab === id
          ? 'bg-raised text-ink'
          : 'text-ink-muted hover:text-ink'}"
      >
        {label}
      </button>
    {/each}
    <button
      onclick={() => fullscreenPane(side)}
      title="Fullscreen this pane (closes the split)"
      class="ml-auto rounded px-3 py-1 text-base leading-none text-ink-faint hover:bg-raised hover:text-ink"
    >
      ⤢
    </button>
  </div>
  <div class="min-h-0 flex-1 overflow-hidden">
    <TabContent {tab} />
  </div>
</div>
