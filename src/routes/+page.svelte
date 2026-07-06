<script lang="ts">
  import { onMount } from "svelte";

  import InspectionView from "$lib/components/InspectionView.svelte";
  import Sidebar from "$lib/components/shell/Sidebar.svelte";
  import TabStub from "$lib/components/shell/TabStub.svelte";
  import TopBar from "$lib/components/shell/TopBar.svelte";
  import { inspection } from "$lib/state/inspection.svelte";
  import { startSidecarSession, stopSidecarSession } from "$lib/state/sidecar";
  import { TABS, workspace } from "$lib/state/workspace.svelte";

  onMount(() => {
    startSidecarSession();
    return stopSidecarSession;
  });

  // Chrome copy for the showing tab; stubs and the analysis empty state render it.
  const activeTab = $derived(
    TABS.find((t) => t.id === workspace.tab) ?? TABS[0],
  );
</script>

<div class="flex h-screen">
  <Sidebar />
  <div class="flex min-w-0 flex-1 flex-col">
    <TopBar />
    <main class="min-h-0 flex-1 overflow-y-auto">
      {#if workspace.tab === "analysis" && inspection.songId !== null}
        <div class="flex justify-center px-6 py-6">
          <InspectionView />
        </div>
      {:else}
        <TabStub title={activeTab.label} blurb={activeTab.blurb} />
      {/if}
    </main>
  </div>
</div>
