<script lang="ts">
  import { Popover } from "bits-ui";

  import { docReport } from "$lib/showgen/edit";
  import {
    applyPalette,
    PALETTES,
    resolvePalette,
    SINGLE_PALETTE_ID,
  } from "$lib/showgen/palettes";
  import {
    ALGORITHMS,
    algorithmById,
    generateShow,
  } from "$lib/showgen/registry";
  import { rigLights } from "$lib/showgen/rig";
  import type { LightSpec, PaletteRef } from "$lib/showgen/types";
  import { requestCandidateTracks } from "$lib/state/evaluation.svelte";
  import { hardware } from "$lib/state/hardware.svelte";
  import { getRawProfile } from "$lib/state/inspection.svelte";
  import {
    generateWithUndo,
    mapping,
    setPalette,
    showHistory,
    undoGenerate,
  } from "$lib/state/mapping.svelte";
  import { settings } from "$lib/state/settings.svelte";
  import { tracksPending } from "$lib/state/tracks.svelte";
  import type { MappingDoc } from "$lib/mapping/schema";

  // The Mapping tab's primary action: generate a whole show from an
  // algorithm and palette, then adjust it in the program cards. Generate
  // replaces the show; Undo restores the one before.

  // How long Generate waits for candidate tracks before giving up.
  const TRACK_WAIT_MS = 60_000;
  const VIRTUAL_LIGHTS = 5;

  // Follows the app-wide setting until the user picks one here.
  let picked = $state<string | null>(null);
  const algorithm = $derived(
    picked ?? algorithmById(settings.showAlgorithm).id,
  );
  let busy = $state(false);
  let note = $state<string | null>(null);

  const palette = $derived(mapping.doc?.palette ?? { id: "blue" });
  const current = $derived(resolvePalette(palette));
  const generatedBy = $derived(
    mapping.doc?.generator
      ? algorithmById(mapping.doc.generator.algorithm).label
      : null,
  );

  async function generate(): Promise<void> {
    if (busy || mapping.doc === null) return;
    busy = true;
    note = null;
    const songId = mapping.songId;
    try {
      requestCandidateTracks();
      const start = Date.now();
      while (tracksPending() > 0 && Date.now() - start < TRACK_WAIT_MS)
        await new Promise((r) => setTimeout(r, 100));
      // The user may have opened another song while tracks loaded.
      if (mapping.songId !== songId) return;
      const profile = getRawProfile();
      if (!profile || mapping.doc === null) return;
      const rig = rigLights($state.snapshot(hardware.rig.hubs));
      // No rig: shape the show for five strips and leave it unpatched, so
      // the cards and preview still work before any hardware exists.
      const lights: LightSpec[] =
        rig.length > 0
          ? rig
          : Array.from({ length: VIRTUAL_LIGHTS }, (_, i) => ({
              id: `virtual_${i + 1}`,
              name: `Light ${i + 1}`,
              kind: "strip" as const,
              pixelCount: 60,
            }));
      const ref = $state.snapshot(palette) as PaletteRef;
      const result = generateShow(algorithm, { profile, lights, palette: ref });
      if (result.programs.length === 0) {
        note = result.report.notes.join("; ") || "No usable tracks.";
        return;
      }
      if (rig.length === 0) result.patch = {};
      generateWithUndo(result, algorithm, ref);
      if (rig.length === 0) note = "No rig lights: programs left unpatched.";
    } finally {
      busy = false;
    }
  }

  // Accent program for the palette's outlier: the generator's accent pick.
  function accentId(doc: MappingDoc): string | undefined {
    return docReport(doc.generator)?.picks.find((p) => p.role === "accent")
      ?.programId;
  }

  function choose(ref: PaletteRef): void {
    if (mapping.doc === null) return;
    const doc = $state.snapshot(mapping.doc) as MappingDoc;
    setPalette(ref, applyPalette(doc.programs, ref, accentId(doc)));
  }

  let singleColor = $state("#2B6CC4");
</script>

<div
  class="flex h-bar shrink-0 items-center gap-2 border-b border-edge px-3 text-xs"
>
  <span class="text-base font-semibold">Show</span>
  <select
    value={algorithm}
    onchange={(e) => (picked = e.currentTarget.value)}
    title={algorithmById(algorithm).description}
    class="rounded border border-edge bg-raised px-1.5 py-1 text-ink focus:border-accent focus:outline-none"
  >
    {#each ALGORITHMS as alg (alg.id)}
      <option value={alg.id} title={alg.description}>{alg.label}</option>
    {/each}
  </select>

  <Popover.Root>
    <Popover.Trigger
      title="Palette"
      class="flex items-center gap-1.5 rounded border border-edge px-1.5 py-1 text-ink-muted hover:text-ink"
    >
      <span class="flex">
        {#each current.colors as c (c)}
          <span
            class="h-3 w-2.5 first:rounded-l-sm last:rounded-r-sm"
            style:background={c}
          ></span>
        {/each}
      </span>
      {current.name}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        side="bottom"
        align="start"
        sideOffset={6}
        class="z-50 w-64 rounded-md border border-edge bg-surface p-2 shadow-lg"
      >
        <p
          class="mb-1.5 px-1 text-xs font-medium uppercase tracking-wide text-ink-faint"
        >
          Palette
        </p>
        <ul class="flex flex-col">
          {#each PALETTES as p (p.id)}
            <li>
              <button
                onclick={() => choose({ id: p.id })}
                class="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs hover:bg-raised {palette.id ===
                p.id
                  ? 'text-accent'
                  : 'text-ink-muted'}"
              >
                <span class="flex">
                  {#each p.colors as c, i (i)}
                    <span
                      class="h-3.5 w-3.5 first:rounded-l-sm last:rounded-r-sm {p.outlier ===
                      i
                        ? 'ml-1 rounded-sm'
                        : ''}"
                      style:background={c}
                    ></span>
                  {/each}
                </span>
                {p.name}
              </button>
            </li>
          {/each}
          <li
            class="mt-1 flex items-center gap-2 border-t border-edge px-1 pt-1.5"
          >
            <input
              type="color"
              bind:value={singleColor}
              class="h-5 w-6 cursor-pointer rounded border border-edge bg-transparent"
              title="Pick the single color"
            />
            <button
              onclick={() =>
                choose({ id: SINGLE_PALETTE_ID, color: singleColor })}
              class="flex-1 rounded px-1 py-1 text-left text-xs hover:bg-raised {palette.id ===
              SINGLE_PALETTE_ID
                ? 'text-accent'
                : 'text-ink-muted'}"
            >
              Single color for every program
            </button>
          </li>
        </ul>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>

  <button
    onclick={generate}
    disabled={busy}
    title="Replace the show with one generated by the chosen algorithm"
    class="rounded border border-accent/60 bg-accent/10 px-2 py-1 font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
  >
    {busy ? "Generating…" : "Generate"}
  </button>
  {#if showHistory.before}
    <button
      onclick={undoGenerate}
      title="Restore the show from before the last Generate"
      class="rounded border border-edge px-2 py-1 text-ink-muted hover:text-ink"
    >
      Undo
    </button>
  {/if}
  <span class="min-w-0 flex-1 truncate text-ink-faint">
    {note ?? (generatedBy ? `Generated by ${generatedBy}` : "")}
  </span>
</div>
