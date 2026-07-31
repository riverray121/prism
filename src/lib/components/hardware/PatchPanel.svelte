<script lang="ts">
  import type { RigHub, RigLight } from "$lib/hardware/wled";
  import { programLabel } from "$lib/mapping/labels";
  import type { Program } from "$lib/mapping/schema";
  import { hardware } from "$lib/state/hardware.svelte";
  import { mapping, setPatch } from "$lib/state/mapping.svelte";

  // Per-song patch as aligned rows: linked program–light pairs sit side by
  // side joined by a string across the gutter; unlinked programs and lights
  // fill the remaining rows. Click a program, then a light, to link; clicking
  // a linked light unlinks it. One active program per light.

  let selectedProgram = $state<string | null>(null);

  const doc = $derived(mapping.doc);
  const lights = $derived(
    hardware.rig.hubs.flatMap((hub) =>
      hub.lights.map((light) => ({ hub, light })),
    ),
  );

  interface LightEntry {
    hub: RigHub;
    light: RigLight;
  }
  interface Row {
    program: Program | null;
    entry: LightEntry | null;
    linked: boolean;
    // Patched to a program that no longer exists: muted, never a failure.
    dangling: boolean;
  }

  const rows = $derived.by((): Row[] => {
    if (!doc) return [];
    const linked: Row[] = [];
    const usedPrograms = new Set<string>();
    const linkedLights = new Set<string>();
    for (const entry of lights) {
      const programId = doc.patch[entry.light.id];
      if (programId === undefined) continue;
      const program = doc.programs.find((p) => p.id === programId) ?? null;
      linked.push({
        program,
        entry,
        linked: program !== null,
        dangling: program === null,
      });
      linkedLights.add(entry.light.id);
      if (program) usedPrograms.add(program.id);
    }
    const restPrograms = doc.programs.filter((p) => !usedPrograms.has(p.id));
    const restLights = lights.filter((e) => !linkedLights.has(e.light.id));
    const rest: Row[] = [];
    for (let i = 0; i < Math.max(restPrograms.length, restLights.length); i++) {
      rest.push({
        program: restPrograms[i] ?? null,
        entry: restLights[i] ?? null,
        linked: false,
        dangling: false,
      });
    }
    return [...linked, ...rest];
  });

  function clickLight(lightId: string): void {
    if (!doc) return;
    const current = doc.patch[lightId];
    if (selectedProgram !== null && current !== selectedProgram) {
      setPatch(lightId, selectedProgram);
    } else if (current !== undefined) {
      setPatch(lightId, null);
    }
  }
</script>

<section>
  <div class="mb-2 flex items-baseline gap-3">
    <h2 class="text-base font-semibold">Patch</h2>
    <p class="text-xs text-ink-faint">Click a program, then a light.</p>
  </div>
  {#if !doc}
    <p class="text-sm text-ink-faint">Loading…</p>
  {:else if doc.programs.length === 0}
    <p class="text-sm text-ink-faint">
      No programs yet — create them in Mapping.
    </p>
  {:else if lights.length === 0}
    <p class="text-sm text-ink-faint">Connect a hub first.</p>
  {:else}
    <div class="grid grid-cols-[1fr_3rem_1fr] gap-y-1">
      <p
        class="mb-0.5 text-xs font-medium uppercase tracking-wide text-ink-faint"
      >
        Programs
      </p>
      <span></span>
      <p
        class="mb-0.5 text-xs font-medium uppercase tracking-wide text-ink-faint"
      >
        Lights
      </p>
      {#each rows as row, i (i)}
        {#if row.program}
          <button
            onclick={() =>
              (selectedProgram =
                selectedProgram === row.program!.id ? null : row.program!.id)}
            class="flex items-baseline justify-between gap-2 rounded border px-2 py-1.5 text-left text-sm {selectedProgram ===
            row.program.id
              ? 'border-accent bg-raised text-accent'
              : 'border-edge bg-surface hover:bg-raised'} {row.program.enabled
              ? ''
              : 'opacity-50'}"
          >
            <span class="truncate">{programLabel(row.program)}</span>
          </button>
        {:else}
          <span></span>
        {/if}
        {#if row.linked}
          <span class="flex items-center px-1" aria-hidden="true">
            <span class="size-1.5 shrink-0 rounded-full bg-accent"></span>
            <span class="h-px flex-1 bg-accent"></span>
            <span class="size-1.5 shrink-0 rounded-full bg-accent"></span>
          </span>
        {:else}
          <span></span>
        {/if}
        {#if row.entry}
          {@const online = hardware.online[row.entry.hub.mac] === true}
          <button
            onclick={() => clickLight(row.entry!.light.id)}
            class="flex items-baseline justify-between gap-2 rounded border px-2 py-1.5 text-left text-sm {row.linked
              ? 'border-accent/50 bg-surface'
              : 'border-edge bg-surface'} hover:bg-raised"
          >
            <span class="truncate {online ? '' : 'text-ink-faint'}">
              {row.entry.light.name}
            </span>
            <span class="shrink-0 text-xs text-ink-faint">
              {row.entry.light.pixel_count} px{online
                ? ""
                : " · offline"}{row.dangling ? " · missing program" : ""}
            </span>
          </button>
        {:else}
          <span></span>
        {/if}
      {/each}
    </div>
  {/if}
</section>
