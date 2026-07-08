<script lang="ts">
  import AutoMapButton from "$lib/components/mapping/AutoMapButton.svelte";
  import DerivationEditor from "$lib/components/mapping/DerivationEditor.svelte";
  import LightPreview from "$lib/components/mapping/LightPreview.svelte";
  import MacroPanel from "$lib/components/mapping/MacroPanel.svelte";
  import ProgramEditor from "$lib/components/mapping/ProgramEditor.svelte";
  import ProgramList from "$lib/components/mapping/ProgramList.svelte";
  import SourcesPanel from "$lib/components/mapping/SourcesPanel.svelte";
  import PixelLane from "$lib/graphs/PixelLane.svelte";
  import RibbonLane from "$lib/graphs/RibbonLane.svelte";
  import { resolveFeature } from "$lib/mapping/sources";
  import {
    getRawProfile,
    inspection,
    sidecarPath,
  } from "$lib/state/inspection.svelte";
  import {
    editProgram,
    ensureMatrix,
    evaluation,
    mapping,
    mappingUi,
    matrixVersion,
    reevaluate,
  } from "$lib/state/mapping.svelte";
  import {
    scrub,
    scrubEnd,
    scrubStart,
    setViewWindow,
    transport,
    view,
  } from "$lib/state/transport.svelte";

  // The Mapping tab: author derivations and programs from favorited features
  // and confirm the result against playback. Sources + programs on the left,
  // the open editor and the ribbon preview stack in the main column.

  const ready = $derived(inspection.profile !== null && mapping.doc !== null);

  // Re-evaluate on any doc edit, profile (re)load, or matrix arrival.
  // reevaluate snapshots the doc (deep dependency); the profile proxy read
  // makes profile swaps count; matrixVersion ticks when a sidecar loads.
  $effect(() => {
    inspection.profile;
    matrixVersion.n;
    const profile = getRawProfile();
    // Heatmap position bindings need their .npy matrices; request any missing.
    if (profile && mapping.doc && inspection.songDir) {
      for (const p of mapping.doc.programs) {
        const pos = p.channels.position;
        if (pos === undefined || typeof pos === "number") continue;
        const feature = resolveFeature(profile, pos.source);
        if (feature?.render === "heatmap")
          ensureMatrix(pos.source, sidecarPath(feature.sidecar));
      }
    }
    reevaluate(profile);
  });

  const frameCount = $derived(inspection.profile?.timeline.frame_count ?? 0);
  const frameRateHz = $derived(
    inspection.profile?.timeline.frame_rate_hz ?? 100,
  );

  // Programs with an evaluated output, in doc order (disabled ones drop out).
  const previews = $derived(
    (mapping.doc?.programs ?? [])
      .filter((p) => evaluation.outputs[p.id])
      .map((p) => ({ program: p, output: evaluation.outputs[p.id] })),
  );

  // Per-program exact-value overlay toggle.
  const valueLines = $state<Record<string, boolean>>({});
</script>

{#if !ready}
  <div class="flex h-full items-center justify-center">
    <p class="text-sm text-ink-faint">Loading…</p>
  </div>
{:else}
  <div class="flex h-full">
    <aside
      class="w-72 shrink-0 overflow-y-auto border-r border-edge bg-surface"
    >
      <SourcesPanel />
      <ProgramList />
      <AutoMapButton />
    </aside>
    <main class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 pb-32">
      <div class="flex items-start gap-4">
        <div class="min-w-0 flex-1">
          {#if mappingUi.editingDerivation !== null}
            <DerivationEditor />
          {:else if mappingUi.editingProgram !== null}
            <ProgramEditor />
          {:else}
            <p class="text-sm text-ink-faint">
              Star features in Analysis, then derive gates and author programs
              from them here.
            </p>
          {/if}
        </div>
        <LightPreview />
      </div>

      <MacroPanel />

      {#if previews.length > 0}
        <section class="flex flex-col gap-2">
          <p class="text-xs font-medium uppercase tracking-wide text-ink-faint">
            Preview
          </p>
          {#each previews as { program, output } (program.id)}
            <div>
              <div class="mb-0.5 flex items-center gap-2">
                <button
                  onclick={() => editProgram(program.id)}
                  class="text-sm text-ink-muted hover:text-ink {mappingUi.editingProgram ===
                  program.id
                    ? 'text-accent'
                    : ''}"
                >
                  {program.id}
                </button>
                <button
                  onclick={() =>
                    (valueLines[program.id] = !valueLines[program.id])}
                  title="Toggle the exact brightness value line"
                  class="rounded border border-edge px-1.5 py-0 text-xs {valueLines[
                    program.id
                  ]
                    ? 'text-accent'
                    : 'text-ink-faint hover:text-ink'}"
                >
                  values
                </button>
              </div>
              <RibbonLane
                {output}
                {frameCount}
                {frameRateHz}
                showValueLine={valueLines[program.id] ?? false}
                playheadSec={transport.currentTime}
                follow={transport.playing}
                window={view.window}
                followMode={view.followMode}
                onWindowChange={setViewWindow}
                onSeek={scrub}
                onScrubStart={scrubStart}
                onScrubEnd={scrubEnd}
              />
              {#if output.pixels}
                <div class="mt-1">
                  <PixelLane
                    pixels={output.pixels}
                    {frameRateHz}
                    playheadSec={transport.currentTime}
                    follow={transport.playing}
                    window={view.window}
                    followMode={view.followMode}
                    onWindowChange={setViewWindow}
                    onSeek={scrub}
                    onScrubStart={scrubStart}
                    onScrubEnd={scrubEnd}
                  />
                </div>
              {/if}
            </div>
          {/each}
        </section>
      {/if}
    </main>
  </div>
{/if}
