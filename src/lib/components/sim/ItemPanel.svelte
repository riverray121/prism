<script lang="ts">
  import { FIXTURE_KINDS } from "$lib/showgen/types";
  import type { PanelEntry } from "$lib/sim/place";
  import {
    FURNITURE_LABELS,
    FURNITURE_TYPES,
    LIGHT_LABELS,
  } from "$lib/sim/room";
  import { activeRoom, sim, startDrag } from "$lib/state/sim.svelte";

  // Everything that can be placed in a room. Press an entry and drag it onto
  // the room view; the view places it where the pointer is released. Mouse
  // events, not HTML drag-and-drop: the shell's window-level file drop
  // handling intercepts HTML drag events in this webview.

  const lights: { entry: PanelEntry; label: string }[] = FIXTURE_KINDS.map(
    (kind) => ({
      entry: { type: "light", kind },
      label: LIGHT_LABELS[kind],
    }),
  );
  const furniture: { entry: PanelEntry; label: string }[] = FURNITURE_TYPES.map(
    (type) => ({
      entry: { type },
      label: FURNITURE_LABELS[type],
    }),
  );

  const enabled = $derived(activeRoom() !== null);

  function key(entry: PanelEntry): string {
    return entry.type === "light" ? `light:${entry.kind}` : entry.type;
  }

  function begin(e: MouseEvent, entry: PanelEntry): void {
    if (e.button !== 0 || !enabled) return;
    e.preventDefault();
    startDrag(entry);
  }
</script>

{#snippet group(title: string, entries: { entry: PanelEntry; label: string }[])}
  <p class="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">
    {title}
  </p>
  <div class="mb-3 grid grid-cols-2 gap-1">
    {#each entries as { entry, label } (label)}
      <button
        onmousedown={(e) => begin(e, entry)}
        disabled={!enabled}
        title="Drag into the room"
        class="cursor-grab rounded border border-edge px-2 py-1 text-left text-xs text-ink-muted hover:bg-raised hover:text-ink disabled:opacity-40 {sim.dragging &&
        key(sim.dragging) === key(entry)
          ? 'border-accent text-ink'
          : ''}"
      >
        {label}
      </button>
    {/each}
  </div>
{/snippet}

<section class="p-3 pt-0">
  {@render group("Lights", lights)}
  {@render group("Furniture", furniture)}
</section>
