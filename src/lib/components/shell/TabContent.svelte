<script lang="ts">
  import InspectionView from "$lib/components/InspectionView.svelte";
  import TabStub from "$lib/components/shell/TabStub.svelte";
  import { inspection } from "$lib/state/inspection.svelte";
  import { TABS, type Tab } from "$lib/state/workspace.svelte";

  // One tab's content, host-agnostic: rendered by the single-tab main and by
  // each split pane. Every graph inside reads the same global transport.
  let { tab }: { tab: Tab } = $props();

  const meta = $derived(TABS.find((t) => t.id === tab) ?? TABS[0]);
</script>

<!-- The analysis view stays mounted (hidden) while other tabs show, so its
     scroll position, collapse state, and loaded lanes survive tab switches. -->
{#if inspection.songId !== null}
  <div class={tab === "analysis" ? "h-full" : "hidden"}>
    <InspectionView />
  </div>
{/if}
{#if tab !== "analysis" || inspection.songId === null}
  <TabStub title={meta.label} blurb={meta.blurb} />
{/if}
