<script lang="ts">
  import { onMount } from "svelte";

  import Pane from "$lib/components/shell/Pane.svelte";
  import Sidebar from "$lib/components/shell/Sidebar.svelte";
  import TabContent from "$lib/components/shell/TabContent.svelte";
  import TopBar from "$lib/components/shell/TopBar.svelte";
  import TransportBar from "$lib/components/shell/TransportBar.svelte";
  import {
    dismissUncleanExit,
    health,
    openLogs,
    startHealthMonitor,
  } from "$lib/state/health.svelte";
  import { startSidecarSession, stopSidecarSession } from "$lib/state/sidecar";
  import { workspace } from "$lib/state/workspace.svelte";

  onMount(() => {
    startSidecarSession();
    const stopHealth = startHealthMonitor();
    return () => {
      stopSidecarSession();
      stopHealth();
    };
  });
</script>

<div class="flex h-screen">
  <Sidebar />
  <div class="flex min-w-0 flex-1 flex-col">
    <TopBar />

    {#if health.sidecarDown}
      <div
        class="flex shrink-0 items-center gap-3 border-b border-edge bg-danger/15 px-3 py-2 text-sm text-danger"
      >
        <span>
          Analysis engine stopped (exit code {health.sidecarExitCode ?? "?"}) —
          restart the app.
        </span>
        <button
          onclick={openLogs}
          title="Open the log folder"
          class="rounded border border-danger px-2 py-0.5 hover:bg-danger hover:text-surface"
        >
          Open logs
        </button>
      </div>
    {/if}
    {#if health.uncleanExit}
      <div
        class="flex shrink-0 items-center gap-3 border-b border-edge bg-raised px-3 py-1.5 text-sm text-ink-muted"
      >
        <span>Prism didn't shut down cleanly last time.</span>
        <button
          onclick={openLogs}
          title="Open the log folder"
          class="rounded border border-edge px-2 py-0.5 hover:text-ink"
        >
          Open logs
        </button>
        <button
          onclick={dismissUncleanExit}
          title="Dismiss"
          class="ml-auto rounded px-2 py-0.5 text-ink-faint hover:text-ink"
        >
          ×
        </button>
      </div>
    {/if}

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
