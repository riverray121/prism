<script lang="ts">
  import { Dialog } from "bits-ui";

  import { queueAnalysis, updateSettings } from "$lib/ipc";
  import { settings } from "$lib/state/settings.svelte";

  // Analysis-configuration popup: opened per song from the library, confirms
  // into the queue. The engine set/options are global settings (persisted by
  // the sidecar); this dialog is the one surface that edits them.
  let {
    songId,
    songTitle,
    onclose,
  }: {
    songId: string;
    songTitle: string;
    onclose: () => void;
  } = $props();

  // Toggle an engine; update the store optimistically, then persist via the
  // sidecar (which echoes back a settings snapshot to confirm).
  function toggleEngine(engine: string, on: boolean) {
    const next = on
      ? settings.availableEngines.filter(
          (e) => e === engine || settings.engines.includes(e),
        )
      : settings.engines.filter((e) => e !== engine);
    settings.engines = next;
    updateSettings({ engines: next });
  }

  function toggleDrumSubsep(on: boolean) {
    settings.drumSubsep = on;
    updateSettings({ drum_subsep: on });
  }

  // Drum sub-sep applies only when a selected engine emits a drums stem; the
  // capability comes from the sidecar's engine_info, nothing hard-coded here.
  const drumsEngines = $derived(
    settings.availableEngines.filter((e) => settings.engineInfo[e]?.drums),
  );
  const lastDrumsEngine = $derived(drumsEngines.at(-1));
  const canDrumSubsep = $derived(
    settings.engines.some((e) => settings.engineInfo[e]?.drums),
  );

  function confirm() {
    void queueAnalysis([songId]);
    onclose();
  }
</script>

<Dialog.Root open onOpenChange={(open) => !open && onclose()}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
    <Dialog.Content
      class="fixed left-1/2 top-1/2 z-50 w-[34rem] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-md border border-edge bg-surface p-4 shadow-lg"
    >
      <Dialog.Title class="text-sm font-semibold">
        Analyze — {songTitle}
      </Dialog.Title>
      <p class="mt-1 text-xs text-ink-muted">
        Separation engines to run. More engines means longer analysis; every
        engine's stems are kept for comparison.
      </p>

      <div class="mt-3 flex flex-col gap-2">
        {#if !settings.loaded}
          <p class="text-sm text-ink-muted">Loading…</p>
        {:else}
          {#each settings.availableEngines as engine (engine)}
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                class="size-4 accent-accent"
                checked={settings.engines.includes(engine)}
                onchange={(e) => toggleEngine(engine, e.currentTarget.checked)}
              />
              {settings.engineInfo[engine]?.label ?? engine}
            </label>
            {#if engine === lastDrumsEngine}
              <!-- Nested under the drums-capable engines: sub-sep needs their drums stem. -->
              <label
                class="ml-6 flex items-center gap-2 text-sm {canDrumSubsep
                  ? ''
                  : 'opacity-50'}"
                title={canDrumSubsep
                  ? ""
                  : "Select a drums-capable engine to enable drum sub-separation"}
              >
                <input
                  type="checkbox"
                  class="size-4 accent-accent"
                  disabled={!canDrumSubsep}
                  checked={settings.drumSubsep && canDrumSubsep}
                  onchange={(e) => toggleDrumSubsep(e.currentTarget.checked)}
                />
                ↳ Drum sub-separation — kick/snare/toms/hh/ride/crash
              </label>
            {/if}
          {/each}
          {#if settings.engines.length === 0}
            <p class="text-xs text-danger">
              No engines selected — analysis will produce mix features only, no
              stems.
            </p>
          {/if}
        {/if}
      </div>

      <div class="mt-4 flex justify-end gap-2">
        <button
          onclick={onclose}
          class="rounded border border-edge px-3 py-1 text-sm text-ink-muted hover:text-ink"
        >
          Cancel
        </button>
        <button
          onclick={confirm}
          class="rounded bg-accent px-3 py-1 text-sm font-medium text-surface hover:opacity-90"
        >
          Queue analysis
        </button>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
