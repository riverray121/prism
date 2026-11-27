<script lang="ts">
  import { programLabel, sourceLabel } from "$lib/mapping/labels";
  import type { Program } from "$lib/mapping/schema";
  import {
    detectStyle,
    docReport,
    levelAt,
    programSource,
    STYLE_LABELS,
    swatchCss,
  } from "$lib/showgen/edit";
  import type { LightSpec } from "$lib/showgen/types";
  import { evaluation } from "$lib/state/evaluation.svelte";
  import { inspection } from "$lib/state/inspection.svelte";
  import {
    editProgram,
    mapping,
    mappingUi,
    removeProgram,
    setPatch,
    setProgramEnabled,
  } from "$lib/state/mapping.svelte";
  import { transport } from "$lib/state/transport.svelte";

  // One program as a card: color, source, style, role, the lights it drives
  // and a live level. Click to open it in the simple editor.

  let { program, lights }: { program: Program; lights: LightSpec[] } = $props();

  const doc = $derived(mapping.doc);
  const selected = $derived(mappingUi.editingProgram === program.id);
  const style = $derived(detectStyle(program));
  const source = $derived(doc ? programSource(program, doc.derivations) : null);
  const role = $derived(
    docReport(doc?.generator)?.picks.find((p) => p.programId === program.id)
      ?.role,
  );
  const assigned = $derived(
    lights.filter((l) => doc?.patch[l.id] === program.id),
  );
  const unassigned = $derived(
    lights.filter((l) => doc?.patch[l.id] !== program.id),
  );
  const level = $derived.by(() => {
    const output = evaluation.outputs[program.id];
    const profile = inspection.profile;
    if (!output || !profile) return 0;
    return levelAt(
      output,
      transport.currentTime,
      profile.timeline.frame_rate_hz,
      profile.timeline.frame_count,
    );
  });

  function patchLight(e: Event): void {
    const select = e.currentTarget as HTMLSelectElement;
    if (select.value) setPatch(select.value, program.id);
    select.value = "";
  }
</script>

<div
  role="button"
  tabindex="0"
  onclick={() => editProgram(program.id)}
  onkeydown={(e) => e.key === "Enter" && editProgram(program.id)}
  class="group flex cursor-pointer flex-col gap-1.5 rounded-md border p-2 text-left {selected
    ? 'border-accent/70 bg-raised'
    : 'border-edge hover:bg-raised/60'} {program.enabled ? '' : 'opacity-50'}"
>
  <div class="flex items-center gap-2">
    <span
      class="h-4 w-4 shrink-0 rounded-sm border border-edge"
      style:background={swatchCss(program)}
    ></span>
    <span class="min-w-0 flex-1 truncate text-sm">{programLabel(program)}</span>
    <input
      type="checkbox"
      checked={program.enabled}
      title={program.enabled ? "Mute (keeps the program)" : "Unmute"}
      onclick={(e) => e.stopPropagation()}
      onchange={(e) => setProgramEnabled(program.id, e.currentTarget.checked)}
    />
    <button
      onclick={(e) => {
        e.stopPropagation();
        removeProgram(program.id);
      }}
      title="Delete program"
      class="text-ink-faint opacity-0 group-hover:opacity-100 hover:text-danger"
    >
      ×
    </button>
  </div>
  <div class="flex items-center gap-1.5 text-xs">
    <span
      class="rounded border border-edge px-1 py-0 text-ink-muted"
      title="Style"
    >
      {style ? STYLE_LABELS[style] : "Custom"}
    </span>
    {#if role}
      <span class="rounded bg-raised px-1 py-0 text-ink-faint" title="Role">
        {role}
      </span>
    {/if}
    <span class="min-w-0 flex-1 truncate text-ink-faint" title={source ?? ""}>
      {source ? sourceLabel(source) : "no source"}
    </span>
  </div>
  <div class="h-1 overflow-hidden rounded-full bg-app" title="Live level">
    <div
      class="h-full rounded-full"
      style:width="{Math.round(level * 100)}%"
      style:background={swatchCss(program)}
    ></div>
  </div>
  {#if lights.length > 0}
    <div class="flex flex-wrap items-center gap-1 text-xs">
      {#each assigned as light (light.id)}
        <button
          onclick={(e) => {
            e.stopPropagation();
            setPatch(light.id, null);
          }}
          title="Unpatch {light.name}"
          class="rounded border border-edge px-1 py-0 text-ink-muted hover:border-danger hover:text-danger"
        >
          {light.name}
        </button>
      {/each}
      {#if unassigned.length > 0}
        <select
          onclick={(e) => e.stopPropagation()}
          onchange={patchLight}
          title="Patch a light to this program"
          class="rounded border border-dashed border-edge bg-transparent px-1 py-0 text-ink-faint hover:text-ink"
        >
          <option value="">+ light</option>
          {#each unassigned as light (light.id)}
            <option value={light.id}>{light.name}</option>
          {/each}
        </select>
      {/if}
    </div>
  {/if}
</div>
