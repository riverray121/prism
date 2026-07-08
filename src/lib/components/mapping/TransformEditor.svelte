<script lang="ts">
  import { PALETTES } from "$lib/color";
  import type { Binding, Channel, TransformStep } from "$lib/mapping/schema";
  import { setProgramChannel } from "$lib/state/mapping.svelte";

  // The advanced affordance: a binding's transform chain. Steps apply in
  // order; every parameter has a working default so most chains stay 1-2
  // steps deep.
  let {
    programId,
    channel,
    binding,
  }: {
    programId: string;
    channel: Channel;
    binding: Binding;
  } = $props();

  const STEP_KINDS = [
    "normalize",
    "smooth",
    "envelope",
    "colormap",
    "categorical",
  ] as const;
  type StepKind = (typeof STEP_KINDS)[number];

  function defaultStep(kind: StepKind): TransformStep {
    switch (kind) {
      case "normalize":
        return {
          normalize: { min: null, max: null, curve: "linear", gamma: 2 },
        };
      case "smooth":
        return { smooth: { window_s: 0.08 } };
      case "envelope":
        return { envelope: { attack_s: 0.005, hold_s: 0.05, decay_s: 0.15 } };
      case "colormap":
        return { colormap: { palette: "warm_cool" } };
      case "categorical":
        return { categorical: { map: {} } };
    }
  }

  function kindOf(step: TransformStep): StepKind {
    return Object.keys(step)[0] as StepKind;
  }

  function commit(transform: TransformStep[]): void {
    setProgramChannel(programId, channel, { ...binding, transform });
  }

  function addStep(kind: StepKind): void {
    commit([...binding.transform, defaultStep(kind)]);
  }

  function removeStep(index: number): void {
    commit(binding.transform.filter((_, i) => i !== index));
  }

  function patchStep(index: number, step: TransformStep): void {
    commit(binding.transform.map((s, i) => (i === index ? step : s)));
  }
</script>

<div
  class="flex flex-col gap-1.5 rounded border border-edge bg-app p-2 text-xs"
>
  {#if binding.transform.length === 0}
    <p class="text-ink-faint">
      No explicit steps{channel === "brightness"
        ? " — continuous sources get normalize + smooth by default"
        : ""}.
    </p>
  {/if}

  {#each binding.transform as step, i (i)}
    <div class="flex flex-wrap items-center gap-2">
      <span class="w-20 font-medium text-ink-muted">{kindOf(step)}</span>

      {#if "normalize" in step}
        <label class="flex items-center gap-1">
          curve
          <select
            value={step.normalize.curve}
            onchange={(e) =>
              patchStep(i, {
                normalize: {
                  ...step.normalize,
                  curve: e.currentTarget.value as "linear" | "gamma" | "log",
                },
              })}
            class="rounded border border-edge bg-surface px-1 py-0.5"
          >
            <option value="linear">linear</option>
            <option value="gamma">gamma</option>
            <option value="log">log</option>
          </select>
        </label>
        {#if step.normalize.curve === "gamma"}
          <label class="flex items-center gap-1">
            γ
            <input
              type="number"
              min="0.1"
              max="8"
              step="0.1"
              value={step.normalize.gamma}
              onchange={(e) =>
                patchStep(i, {
                  normalize: {
                    ...step.normalize,
                    gamma: Number(e.currentTarget.value) || 2,
                  },
                })}
              class="w-16 rounded border border-edge bg-surface px-1 py-0.5"
            />
          </label>
        {/if}
      {:else if "smooth" in step}
        <label class="flex items-center gap-1">
          window (s)
          <input
            type="number"
            min="0.01"
            max="2"
            step="0.01"
            value={step.smooth.window_s}
            onchange={(e) =>
              patchStep(i, {
                smooth: { window_s: Number(e.currentTarget.value) || 0.08 },
              })}
            class="w-16 rounded border border-edge bg-surface px-1 py-0.5"
          />
        </label>
      {:else if "envelope" in step}
        {#each [["attack_s", "attack"], ["hold_s", "hold"], ["decay_s", "decay"]] as const as [key, name] (key)}
          <label class="flex items-center gap-1">
            {name} (s)
            <input
              type="number"
              min="0"
              max="5"
              step="0.005"
              value={step.envelope[key]}
              onchange={(e) =>
                patchStep(i, {
                  envelope: {
                    ...step.envelope,
                    [key]: Math.max(0, Number(e.currentTarget.value) || 0),
                  },
                })}
              class="w-16 rounded border border-edge bg-surface px-1 py-0.5"
            />
          </label>
        {/each}
      {:else if "colormap" in step}
        <label class="flex items-center gap-1">
          palette
          <select
            value={step.colormap.palette}
            onchange={(e) =>
              patchStep(i, { colormap: { palette: e.currentTarget.value } })}
            class="rounded border border-edge bg-surface px-1 py-0.5"
          >
            {#each Object.keys(PALETTES) as palette (palette)}
              <option value={palette}>{palette}</option>
            {/each}
          </select>
        </label>
      {:else if "categorical" in step}
        <span class="text-ink-faint">
          labels spread evenly over the channel range
        </span>
      {/if}

      <button
        onclick={() => removeStep(i)}
        title="Remove this step"
        class="ml-auto rounded px-1 text-ink-faint hover:text-danger"
      >
        ×
      </button>
    </div>
  {/each}

  <div class="flex items-center gap-2">
    <select
      value=""
      onchange={(e) => {
        const kind = e.currentTarget.value as StepKind | "";
        if (kind !== "") addStep(kind);
        e.currentTarget.value = "";
      }}
      class="rounded border border-edge bg-surface px-1 py-0.5 text-ink-muted"
    >
      <option value="" disabled>+ add step…</option>
      {#each STEP_KINDS as kind (kind)}
        <option value={kind}>{kind}</option>
      {/each}
    </select>
  </div>
</div>
