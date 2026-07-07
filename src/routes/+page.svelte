<script lang="ts">
  import { onMount } from "svelte";

  import Pane from "$lib/components/shell/Pane.svelte";
  import Sidebar from "$lib/components/shell/Sidebar.svelte";
  import TabContent from "$lib/components/shell/TabContent.svelte";
  import TopBar from "$lib/components/shell/TopBar.svelte";
  import TransportBar from "$lib/components/shell/TransportBar.svelte";
  import { startSidecarSession, stopSidecarSession } from "$lib/state/sidecar";
  import { workspace } from "$lib/state/workspace.svelte";

  onMount(() => {
    startSidecarSession();
    return stopSidecarSession;
  });
</script>

<div class="flex h-screen">
  <Sidebar />
  <div class="flex min-w-0 flex-1 flex-col">
    <TopBar />
    <TransportBar />
    <main class="min-h-0 flex-1 overflow-hidden">
      {#if workspace.splitTab === null}
        <TabContent tab={workspace.tab} />
      {:else}
        <!-- Two tabs side by side, both driven by the one global transport. -->
        <div
          class="grid h-full grid-cols-2 grid-rows-[minmax(0,1fr)] divide-x divide-edge"
        >
          <Pane side="primary" />
          <Pane side="split" />
        </div>
      {/if}
    </main>
  </div>
</div>
