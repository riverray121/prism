<script lang="ts">
  import ProgramCard from "$lib/components/mapping/ProgramCard.svelte";
  import type { MappingDoc } from "$lib/mapping/schema";
  import { resolveFeature } from "$lib/mapping/sources";
  import { docReport, newGlowProgram, sourceOptions } from "$lib/showgen/edit";
  import { rigLights } from "$lib/showgen/rig";
  import { hardware } from "$lib/state/hardware.svelte";
  import { getRawProfile } from "$lib/state/inspection.svelte";
  import { addProgram, editProgram, mapping } from "$lib/state/mapping.svelte";

  // The show's programs as cards: the primary view of the Mapping tab.

  const programs = $derived(mapping.doc?.programs ?? []);
  const lights = $derived(rigLights(hardware.rig.hubs));

  // + Add: a glow program on the best-scoring source not already used.
  function add(): void {
    const profile = getRawProfile();
    if (!profile || mapping.doc === null) return;
    const doc = $state.snapshot(mapping.doc) as MappingDoc;
    const options = sourceOptions(profile, docReport(doc.generator));
    const used = new Set(
      doc.programs.flatMap((p) =>
        Object.values(p.channels).flatMap((v) =>
          typeof v === "object" ? [v.source] : [],
        ),
      ),
    );
    const pick = options.find((o) => !used.has(o.path)) ?? options[0];
    if (!pick) return;
    const f = resolveFeature(profile, pick.path);
    const data = f?.render === "continuous" ? f.data : undefined;
    const program = newGlowProgram(
      pick.path,
      pick.label,
      data,
      doc.programs,
      doc.palette,
    );
    addProgram(program);
    editProgram(program.id);
  }
</script>

<section class="flex flex-col gap-1.5 p-3 pt-0">
  <div class="flex items-center justify-between">
    <p class="text-xs font-medium uppercase tracking-wide text-ink-faint">
      Programs
    </p>
    <button
      onclick={add}
      title="Add a glow program on the best unused source"
      class="rounded border border-edge px-1.5 py-0.5 text-xs text-ink-muted hover:text-ink"
    >
      + Add
    </button>
  </div>
  {#if programs.length === 0}
    <p class="text-sm text-ink-faint">
      No programs. Press Generate to build a show.
    </p>
  {:else}
    {#each programs as program (program.id)}
      <ProgramCard {program} {lights} />
    {/each}
  {/if}
</section>
