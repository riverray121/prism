<script lang="ts">
  import HardwareView from "$lib/components/hardware/HardwareView.svelte";
  import InspectionView from "$lib/components/InspectionView.svelte";
  import MappingView from "$lib/components/mapping/MappingView.svelte";
  import SimView from "$lib/components/sim/SimView.svelte";
  import TabStub from "$lib/components/shell/TabStub.svelte";
  import { inspection } from "$lib/state/inspection.svelte";
  import { TABS, type Tab } from "$lib/state/workspace.svelte";

  // One tab's content, host-agnostic: rendered by the single-tab main and by
  // each split pane. Every graph inside reads the same global transport.
  let { tab }: { tab: Tab } = $props();

  const meta = $derived(TABS.find((t) => t.id === tab) ?? TABS[0]);
</script>

<!-- The analysis view stays mounted (hidden) while other tabs show, so its
     scroll position, collapse state, and loaded lanes survive tab switches.
     The mapping view mounts per showing pane instead — its selection lives in
     the mapping store, so nothing is lost, and hidden uPlot stacks aren't
     duplicated across split panes. -->
{#if inspection.songId !== null}
  <div class={tab === "analysis" ? "h-full" : "hidden"}>
    <InspectionView />
  </div>
  {#if tab === "mapping"}
    <MappingView />
  {/if}
  {#if tab === "hardware"}
    <HardwareView />
  {/if}
{/if}
<!-- The Sim tab works without a song: rooms are edited on their own, and
     an open song adds its show. -->
{#if tab === "sim"}
  <SimView />
{:else if inspection.songId === null}
  <TabStub title={meta.label} blurb={meta.blurb} />
{/if}
