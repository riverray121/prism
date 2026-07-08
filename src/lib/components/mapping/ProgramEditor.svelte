<script lang="ts">
  import TransformEditor from "$lib/components/mapping/TransformEditor.svelte";
  import { favoriteSources, sourceLabel } from "$lib/mapping/sources";
  import type { Channel } from "$lib/mapping/schema";
  import { inspection } from "$lib/state/inspection.svelte";
  import {
    mapping,
    mappingUi,
    removeProgram,
    setProgramChannel,
    setProgramEnabled,
  } from "$lib/state/mapping.svelte";

  // Editor for one program: a row per channel. Default authoring is pick a
  // source, done — transform chains sit behind the per-row disclosure.

  const program = $derived(
    mapping.doc?.programs.find((p) => p.id === mappingUi.editingProgram),
  );

  // Channel order: gate, the point channels, then the pixel dimension.
  const EDITABLE: Channel[] = [
    "gate",
    "brightness",
    "hue",
    "saturation",
    "color_temp",
    "strobe_rate",
    "position",
    "motion",
  ];

  // Program sources: favorites plus saved derivations. Heatmaps stay in the
  // list for the position channel; a heatmap bound to a point channel simply
  // mutes (maximum applicability, no special rules).
  const sources = $derived.by(() => {
    const profile = inspection.profile;
    const out: { value: string; label: string }[] = [];
    if (profile) {
      for (const fav of favoriteSources(profile)) {
        if (fav.feature.render === "tags") continue;
        out.push({ value: fav.path, label: sourceLabel(fav.path) });
      }
    }
    for (const d of mapping.doc?.derivations ?? []) {
      out.push({ value: `derived.${d.id}`, label: `${d.id} (derived)` });
    }
    return out;
  });

  function channelValue(channel: Channel) {
    return program?.channels[channel];
  }

  function bindingFor(channel: Channel) {
    const v = channelValue(channel);
    return typeof v === "object" ? v : undefined;
  }

  // Mode changes: unbound → source (first available) → constant defaults.
  function setMode(channel: Channel, mode: string): void {
    if (!program) return;
    if (mode === "off") setProgramChannel(program.id, channel, null);
    else if (mode === "source") {
      const current = bindingFor(channel);
      if (!current)
        setProgramChannel(program.id, channel, {
          source: sources[0]?.value ?? "",
          transform: [],
        });
    } else {
      const dflt = channel === "hue" ? 0 : channel === "gate" ? 1 : 0.5;
      setProgramChannel(program.id, channel, dflt);
    }
  }

  function modeOf(channel: Channel): "off" | "source" | "constant" {
    const v = channelValue(channel);
    if (v === undefined) return "off";
    return typeof v === "number" ? "constant" : "source";
  }
</script>

{#if program}
  <div class="flex flex-col gap-3">
    <div class="flex items-center gap-3">
      <p class="text-base font-medium">{program.id}</p>
      <label class="flex items-center gap-1.5 text-sm text-ink-muted">
        <input
          type="checkbox"
          checked={program.enabled}
          onchange={(e) =>
            setProgramEnabled(program.id, e.currentTarget.checked)}
        />
        enabled
      </label>
      <button
        onclick={() => removeProgram(program.id)}
        title="Delete this program (its derivations stay)"
        class="ml-auto rounded border border-edge px-2 py-0.5 text-xs text-danger hover:bg-danger hover:text-surface"
      >
        Delete
      </button>
    </div>

    <div class="flex flex-col gap-2">
      {#each EDITABLE as channel (channel)}
        {@const mode = modeOf(channel)}
        {@const binding = bindingFor(channel)}
        {@const value = channelValue(channel)}
        <div
          class="flex flex-col gap-1.5 rounded border border-edge bg-surface p-2"
        >
          <div class="flex flex-wrap items-center gap-3 text-sm">
            <span class="w-24 font-medium">{channel}</span>
            <select
              value={mode}
              onchange={(e) => setMode(channel, e.currentTarget.value)}
              class="rounded border border-edge bg-app px-1.5 py-0.5"
            >
              <option value="off">—</option>
              <option value="source" disabled={sources.length === 0}>
                source
              </option>
              <!-- Position has no constant meaning: it maps a source's shape
                   onto the strip. -->
              <option value="constant" disabled={channel === "position"}>
                constant
              </option>
            </select>

            {#if mode === "source" && binding}
              <select
                value={binding.source}
                onchange={(e) =>
                  setProgramChannel(program.id, channel, {
                    ...binding,
                    source: e.currentTarget.value,
                  })}
                class="min-w-48 rounded border border-edge bg-app px-1.5 py-0.5"
              >
                {#each sources as s (s.value)}
                  <option value={s.value}>{s.label}</option>
                {/each}
                {#if binding.source && !sources.some((s) => s.value === binding.source)}
                  <option value={binding.source}>
                    {sourceLabel(binding.source)} (unresolved)
                  </option>
                {/if}
              </select>
            {:else if mode === "constant" && typeof value === "number"}
              <input
                type="number"
                min={channel === "hue" ? 0 : 0}
                max={channel === "hue"
                  ? 360
                  : channel === "strobe_rate"
                    ? 30
                    : 1}
                step={channel === "hue" ? 1 : 0.05}
                {value}
                onchange={(e) =>
                  setProgramChannel(
                    program.id,
                    channel,
                    Number(e.currentTarget.value) || 0,
                  )}
                class="w-24 rounded border border-edge bg-app px-1.5 py-0.5"
              />
              <span class="text-xs text-ink-faint">
                {channel === "hue"
                  ? "degrees"
                  : channel === "strobe_rate"
                    ? "Hz"
                    : "0–1"}
              </span>
            {/if}
          </div>

          {#if mode === "source" && binding && channel !== "gate"}
            <details>
              <summary
                class="cursor-pointer select-none text-xs text-ink-faint hover:text-ink"
              >
                Transforms ({binding.transform.length})
              </summary>
              <div class="mt-1.5">
                <TransformEditor programId={program.id} {channel} {binding} />
              </div>
            </details>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}
