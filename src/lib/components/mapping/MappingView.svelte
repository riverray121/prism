<script lang="ts">
  import CandidatesPanel from "$lib/components/mapping/CandidatesPanel.svelte";
  import DerivationEditor from "$lib/components/mapping/DerivationEditor.svelte";
  import LightPreview from "$lib/components/mapping/LightPreview.svelte";
  import MacroPanel from "$lib/components/mapping/MacroPanel.svelte";
  import ProgramCards from "$lib/components/mapping/ProgramCards.svelte";
  import ProgramEditor from "$lib/components/mapping/ProgramEditor.svelte";
  import ProgramSimpleEditor from "$lib/components/mapping/ProgramSimpleEditor.svelte";
  import ShowToolbar from "$lib/components/mapping/ShowToolbar.svelte";
  import SourcesPanel from "$lib/components/mapping/SourcesPanel.svelte";
  import ResizablePanel from "$lib/components/shell/ResizablePanel.svelte";
  import PixelLane from "$lib/graphs/PixelLane.svelte";
  import RibbonLane from "$lib/graphs/RibbonLane.svelte";
  import { programLabel } from "$lib/mapping/labels";
  import { evaluation } from "$lib/state/evaluation.svelte";
  import { inspection } from "$lib/state/inspection.svelte";
  import { editProgram, mapping, mappingUi } from "$lib/state/mapping.svelte";
  import {
    scrub,
    scrubEnd,
    scrubStart,
    setViewWindow,
    transport,
    view,
  } from "$lib/state/transport.svelte";
  import {
    PANEL_MAX_WIDTH,
    PANEL_MIN_WIDTH,
    workspace,
  } from "$lib/state/workspace.svelte";

  // The Mapping tab: generate a show, then adjust it card by card. Program
  // cards (and derivations) on the left; the selected program's simple
  // editor and live light preview in the main column, with the channel
  // editor, candidate table, scenes and preview lanes in disclosures below.

  const ready = $derived(inspection.profile !== null && mapping.doc !== null);

  // Evaluation refresh is app-lifetime (state/stream.svelte.ts): outputs are
  // already current whenever a song is open, this tab mounted or not.

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

  const summary =
    "cursor-pointer select-none text-xs font-medium uppercase tracking-wide text-ink-faint hover:text-ink";
</script>

{#if !ready}
  <div class="flex h-full items-center justify-center">
    <p class="text-sm text-ink-faint">Loading…</p>
  </div>
{:else}
  <div class="flex h-full flex-col">
    <ShowToolbar />
    <div class="flex min-h-0 flex-1">
      <ResizablePanel
        bind:width={workspace.mappingPanelWidth}
        min={PANEL_MIN_WIDTH}
        max={PANEL_MAX_WIDTH}
      >
        <div class="min-h-0 flex-1 overflow-y-auto pt-3">
          <ProgramCards />
          <details class="px-3 pb-3">
            <summary class={summary}>Derivations</summary>
            <div class="-mx-3 mt-1.5">
              <SourcesPanel />
            </div>
          </details>
        </div>
      </ResizablePanel>
      <main
        class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 pb-32"
      >
        <div class="flex items-start gap-4">
          <div class="min-w-0 flex-1">
            {#if mappingUi.editingDerivation !== null}
              <DerivationEditor />
            {:else if mappingUi.editingProgram !== null}
              <ProgramSimpleEditor />
              <details class="mt-4">
                <summary class={summary}>Advanced: channels</summary>
                <div class="mt-2">
                  <ProgramEditor />
                </div>
              </details>
            {:else}
              <p class="text-sm text-ink-faint">
                {(mapping.doc?.programs.length ?? 0) > 0
                  ? "Select a program card to adjust it."
                  : "Press Generate to build a show from this song."}
              </p>
            {/if}
          </div>
          <LightPreview />
        </div>

        <details>
          <summary class={summary}>Candidates</summary>
          <div class="mt-2"><CandidatesPanel /></div>
        </details>

        <details>
          <summary class={summary}>Scenes &amp; master</summary>
          <div class="mt-2"><MacroPanel /></div>
        </details>

        {#if previews.length > 0}
          <details open>
            <summary class={summary}>Preview</summary>
            <div class="mt-2 flex flex-col gap-2">
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
                      {programLabel(program)}
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
            </div>
          </details>
        {/if}
      </main>
    </div>
  </div>
{/if}
