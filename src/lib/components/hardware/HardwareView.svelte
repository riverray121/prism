<script lang="ts">
  import PatchPanel from "$lib/components/hardware/PatchPanel.svelte";
  import ProgressRing from "$lib/components/shell/ProgressRing.svelte";
  import ResizablePanel from "$lib/components/shell/ResizablePanel.svelte";
  import {
    connectHub,
    forgetHub,
    hardware,
    probe,
    probeAddress,
    scan,
    startScan,
    stopStream,
    streamTick,
  } from "$lib/state/hardware.svelte";
  import { inspection } from "$lib/state/inspection.svelte";
  import { ensureEvaluationCurrent } from "$lib/state/mapping.svelte";
  import { transport } from "$lib/state/transport.svelte";
  import {
    PANEL_MAX_WIDTH,
    PANEL_MIN_WIDTH,
    workspace,
  } from "$lib/state/workspace.svelte";

  // The Hardware tab, mirroring the Mapping layout: rig devices in the left
  // panel (saved hubs with live status, hubs found on the network under
  // Connect new), the open song's patch in the main column.

  // Name drafts for the Connect new flow, keyed by hub MAC.
  let drafts = $state<Record<string, string>>({});
  // Address draft for the manual Add-by-IP fallback.
  let ipDraft = $state("");

  function connect(mac: string, fallback: string): void {
    connectHub(mac, drafts[mac] ?? fallback);
    delete drafts[mac];
  }

  function addByIp(): void {
    void probeAddress(ipDraft).then(() => {
      if (probe.status === "idle") ipDraft = "";
    });
  }

  // Keep evaluated outputs fresh while this tab is open — the streamer needs
  // them even when the Mapping tab (the other evaluation host) is closed.
  $effect(() => {
    ensureEvaluationCurrent();
  });

  const frameCount = $derived(inspection.profile?.timeline.frame_count ?? 0);
  const frameRateHz = $derived(
    inspection.profile?.timeline.frame_rate_hz ?? 100,
  );

  // Stream while playing; any exit — pause, stop, tab switch, unmount —
  // runs the cleanup, which blacks out and powers off every streamed hub.
  // Until the milestone-6 Rust-side sampler, the strip stalls if the window
  // is minimized during playback (browsers throttle rAF when hidden).
  $effect(() => {
    if (!transport.playing) return;
    let raf = 0;
    const loop = () => {
      streamTick(transport.currentTime, frameRateHz, frameCount);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      stopStream();
    };
  });
</script>

<div class="flex h-full">
  <ResizablePanel
    bind:width={workspace.hardwarePanelWidth}
    min={PANEL_MIN_WIDTH}
    max={PANEL_MAX_WIDTH}
  >
    <div class="flex h-bar shrink-0 items-center px-3">
      <span class="text-base font-semibold">Devices</span>
    </div>

    <section class="p-3 pt-0">
      <p
        class="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint"
      >
        Hubs
      </p>
      {#if !hardware.rigLoaded}
        <p class="text-sm text-ink-faint">Loading…</p>
      {:else if hardware.rig.hubs.length === 0}
        <p class="text-sm text-ink-faint">None yet.</p>
      {:else}
        <ul class="flex flex-col gap-0.5">
          {#each hardware.rig.hubs as hub (hub.mac)}
            {@const online = hardware.online[hub.mac] === true}
            <li class="group rounded px-1.5 py-1 hover:bg-raised">
              <div class="flex items-center gap-2">
                <span
                  class="size-2 shrink-0 rounded-full {online
                    ? 'bg-accent'
                    : 'bg-ink-faint'}"
                  title={online ? "Online" : "Offline"}
                ></span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm">{hub.name}</p>
                  <p class="truncate text-xs text-ink-faint">
                    {online ? hub.ip : "offline"} · {hub.mac}
                  </p>
                </div>
                <button
                  onclick={() => forgetHub(hub.mac)}
                  title="Remove this hub from the rig"
                  class="invisible shrink-0 rounded px-1.5 py-0.5 text-xs text-ink-faint hover:text-danger group-hover:visible"
                >
                  Forget
                </button>
              </div>
              <ul class="mt-0.5 flex flex-col">
                {#each hub.lights as light (light.id)}
                  <li class="flex items-baseline gap-2 pl-4 text-sm">
                    <span class="truncate">{light.name}</span>
                    <span class="shrink-0 text-xs text-ink-faint">
                      {light.pixel_count} px
                    </span>
                  </li>
                {/each}
              </ul>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="p-3 pt-0">
      <div class="mb-1.5 flex items-center justify-between">
        <p class="text-xs font-medium uppercase tracking-wide text-ink-faint">
          Connect new
        </p>
        {#if scan.active}
          <span class="inline-flex animate-spin" aria-hidden="true">
            <ProgressRing size={12} />
          </span>
        {:else}
          <button
            onclick={startScan}
            title="Scan for hubs"
            class="flex size-5 items-center justify-center rounded border border-edge text-ink-muted hover:text-ink"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        {/if}
      </div>
      {#if hardware.discovered.length === 0}
        <p class="text-sm text-ink-faint">
          {scan.active ? "Scanning…" : "None found."}
        </p>
      {:else}
        <ul class="flex flex-col gap-1.5">
          {#each hardware.discovered as hub (hub.mac)}
            <li class="flex flex-col gap-1.5 rounded border border-edge p-2">
              <p class="truncate text-sm">
                {hub.name}
                <span class="text-xs text-ink-faint">
                  {hub.ip} · {hub.lights.length}
                  {hub.lights.length === 1 ? "light" : "lights"}
                </span>
              </p>
              <div class="flex gap-1.5">
                <input
                  type="text"
                  placeholder="Name this hub"
                  bind:value={drafts[hub.mac]}
                  onkeydown={(e) => {
                    if (e.key === "Enter") connect(hub.mac, hub.name);
                  }}
                  class="min-w-0 flex-1 rounded border border-edge bg-app px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none"
                />
                <button
                  onclick={() => connect(hub.mac, hub.name)}
                  class="shrink-0 rounded bg-accent px-3 py-1 text-sm font-medium text-surface hover:opacity-90"
                >
                  Connect
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}

      <!-- Manual fallback: some networks block multicast between Wi-Fi
           clients (and macOS gates it behind the Local Network permission),
           so a hub mDNS can't see can still be added by address. -->
      <div class="mt-2 flex gap-1.5">
        <input
          type="text"
          placeholder="Add by IP"
          bind:value={ipDraft}
          onkeydown={(e) => {
            if (e.key === "Enter") addByIp();
          }}
          class="min-w-0 flex-1 rounded border border-edge bg-app px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none"
        />
        <button
          onclick={addByIp}
          disabled={probe.status === "checking" || ipDraft.trim() === ""}
          class="shrink-0 rounded border border-edge px-3 py-1 text-sm text-ink-muted hover:text-ink disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {#if probe.status === "checking"}
        <p class="mt-1 flex items-center gap-2 text-xs text-ink-faint">
          <span class="inline-flex animate-spin" aria-hidden="true">
            <ProgressRing size={12} />
          </span>
          Checking {probe.ip}…
        </p>
      {:else if probe.status === "failed"}
        <p class="mt-1 text-xs text-danger">No hub at {probe.ip}.</p>
      {/if}
    </section>
  </ResizablePanel>

  <main class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 pb-32">
    <PatchPanel />
  </main>
</div>
