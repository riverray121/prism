<script lang="ts">
  import { programLabel } from "$lib/mapping/sources";
  import {
    addProgram,
    editProgram,
    mapping,
    mappingUi,
    setProgramEnabled,
  } from "$lib/state/mapping.svelte";

  // Program list for the aside: select to edit, toggle enabled in place.
  // Disabled programs dim here and drop out of the preview stack.

  const programs = $derived(mapping.doc?.programs ?? []);

  function createProgram(): void {
    const taken = new Set(programs.map((p) => p.id));
    let n = 1;
    while (taken.has(`program_${n}`)) n++;
    const id = `program_${n}`;
    addProgram({ id, enabled: true, channels: {} });
    editProgram(id);
  }
</script>

<section class="p-3 pt-0">
  <div class="mb-1.5 flex items-center justify-between">
    <p class="text-xs font-medium uppercase tracking-wide text-ink-faint">
      Programs
    </p>
    <button
      onclick={createProgram}
      title="Create an empty program"
      class="rounded border border-edge px-1.5 py-0.5 text-xs text-ink-muted hover:text-ink"
    >
      + New
    </button>
  </div>
  {#if programs.length === 0}
    <p class="text-sm text-ink-faint">None</p>
  {:else}
    <ul class="flex flex-col gap-0.5">
      {#each programs as p (p.id)}
        <li class="flex items-center gap-1.5 {p.enabled ? '' : 'opacity-50'}">
          <input
            type="checkbox"
            checked={p.enabled}
            title={p.enabled ? "Mute (keeps the program)" : "Unmute"}
            onchange={(e) => setProgramEnabled(p.id, e.currentTarget.checked)}
          />
          <button
            onclick={() => editProgram(p.id)}
            class="flex min-w-0 flex-1 items-baseline justify-between gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-raised {mappingUi.editingProgram ===
            p.id
              ? 'bg-raised text-accent'
              : ''}"
          >
            <span class="truncate">{programLabel(p)}</span>
            <span class="shrink-0 text-xs text-ink-faint">
              {Object.keys(p.channels).length} ch
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
