<script lang="ts">
  import { PIXEL_KINDS } from "$lib/showgen/types";
  import {
    FACINGS,
    FURNITURE_LABELS,
    furnitureSize,
    LIGHT_LABELS,
    STRIP_SHAPES,
    type FurnitureType,
    type ItemParams,
    type RoomItem,
  } from "$lib/sim/room";
  import {
    activeRoom,
    removeItem,
    selectItem,
    sim,
    updateItem,
    updateItemParams,
  } from "$lib/state/sim.svelte";

  // Properties of the selected item: name, position, facing angle, and the
  // parameters its kind has (pixel count, length, beam angle, size, color).

  const item = $derived(
    activeRoom()?.items.find((i) => i.id === sim.selectedItemId) ?? null,
  );

  const DEG = 180 / Math.PI;

  type NumKey =
    | "pixelCount"
    | "length"
    | "width"
    | "height"
    | "depth"
    | "radius"
    | "arc"
    | "beamAngle";

  // Numeric fields offered per item, with input bounds.
  function fields(it: RoomItem): {
    key: NumKey;
    label: string;
    min: number;
    max: number;
    step: number;
    value: number;
  }[] {
    const p = it.params;
    if (it.type !== "light") {
      const [w, h, d] = furnitureSize(it);
      return [
        {
          key: "width",
          label: "Width (m)",
          min: 0.1,
          max: 6,
          step: 0.05,
          value: w,
        },
        {
          key: "height",
          label: "Height (m)",
          min: 0.1,
          max: 3,
          step: 0.05,
          value: h,
        },
        {
          key: "depth",
          label: "Depth (m)",
          min: 0.02,
          max: 6,
          step: 0.05,
          value: d,
        },
      ];
    }
    const out = [];
    if (it.kind && PIXEL_KINDS.has(it.kind))
      out.push({
        key: "pixelCount" as const,
        label: "Pixels",
        min: 1,
        max: 600,
        step: 1,
        value: p.pixelCount ?? 60,
      });
    if (it.kind === "strip" && (p.shape ?? "line") === "line")
      out.push({
        key: "length" as const,
        label: "Length (m)",
        min: 0.1,
        max: 10,
        step: 0.05,
        value: p.length ?? 1,
      });
    if (it.kind === "strip" && p.shape === "rect") {
      out.push({
        key: "width" as const,
        label: "Width (m)",
        min: 0.1,
        max: 6,
        step: 0.05,
        value: p.width ?? 1.4,
      });
      out.push({
        key: "height" as const,
        label: "Height (m)",
        min: 0.1,
        max: 3,
        step: 0.05,
        value: p.height ?? 0.8,
      });
    }
    if (it.kind === "strip_curve" || p.shape === "arc") {
      out.push({
        key: "radius" as const,
        label: "Radius (m)",
        min: 0.05,
        max: 5,
        step: 0.05,
        value: p.radius ?? 0.6,
      });
      out.push({
        key: "arc" as const,
        label: "Arc (°)",
        min: 10,
        max: 360,
        step: 5,
        value: p.arc ?? 180,
      });
    }
    if (it.kind === "tube")
      out.push({
        key: "length" as const,
        label: "Length (m)",
        min: 0.2,
        max: 3,
        step: 0.05,
        value: p.length ?? 1.2,
      });
    if (it.kind === "wash" || it.kind === "par" || it.kind === "moving_head")
      out.push({
        key: "beamAngle" as const,
        label: "Beam (°)",
        min: 4,
        max: 90,
        step: 1,
        value: p.beamAngle ?? 30,
      });
    return out;
  }

  function setPosition(axis: 0 | 1 | 2, v: number): void {
    if (!item || !Number.isFinite(v)) return;
    const position = [...item.position] as RoomItem["position"];
    position[axis] = v;
    updateItem(item.id, { position });
  }

  function setYaw(deg: number): void {
    if (!item || !Number.isFinite(deg)) return;
    const rotation = [...item.rotation] as RoomItem["rotation"];
    rotation[1] = deg / DEG;
    updateItem(item.id, { rotation });
  }

  function setParam(key: NumKey, v: number, min: number, max: number): void {
    if (!item || !Number.isFinite(v)) return;
    const clamped = Math.min(
      max,
      Math.max(min, key === "pixelCount" ? Math.round(v) : v),
    );
    updateItemParams(item.id, { [key]: clamped } as Partial<ItemParams>);
  }
</script>

{#if item}
  <div
    class="absolute top-3 right-3 flex w-60 flex-col gap-2 rounded-md border border-edge bg-surface/95 p-3 text-xs shadow-lg"
  >
    <div class="flex items-center justify-between">
      <p class="font-medium uppercase tracking-wide text-ink-faint">
        {item.type === "light" && item.kind
          ? LIGHT_LABELS[item.kind]
          : FURNITURE_LABELS[item.type as FurnitureType]}
      </p>
      <button
        onclick={() => selectItem(null)}
        title="Close"
        class="text-ink-faint hover:text-ink">✕</button
      >
    </div>
    <input
      value={item.name ?? ""}
      placeholder="Name"
      onchange={(e) =>
        updateItem(item.id, {
          name: e.currentTarget.value.trim() || undefined,
        })}
      class="rounded border border-edge bg-app px-1.5 py-1 text-sm"
    />
    <div class="grid grid-cols-3 gap-1">
      {#each ["X", "Y", "Z"] as axis, i (axis)}
        <label class="flex flex-col gap-0.5 text-ink-muted">
          {axis}
          <input
            type="number"
            step="0.05"
            value={item.position[i].toFixed(2)}
            onchange={(e) =>
              setPosition(i as 0 | 1 | 2, Number(e.currentTarget.value))}
            class="rounded border border-edge bg-app px-1 py-0.5 text-ink"
          />
        </label>
      {/each}
    </div>
    <label class="flex items-center justify-between gap-2 text-ink-muted">
      Facing (°)
      <input
        type="number"
        step="5"
        value={Math.round(item.rotation[1] * DEG)}
        onchange={(e) => setYaw(Number(e.currentTarget.value))}
        class="w-20 rounded border border-edge bg-app px-1 py-0.5 text-ink"
      />
    </label>
    {#if item.kind === "strip"}
      <label class="flex items-center justify-between gap-2 text-ink-muted">
        Shape
        <select
          value={item.params.shape ?? "line"}
          onchange={(e) =>
            updateItemParams(item.id, {
              shape: e.currentTarget.value as (typeof STRIP_SHAPES)[number],
            })}
          class="w-24 rounded border border-edge bg-app px-1 py-0.5 text-ink"
        >
          {#each STRIP_SHAPES as s (s)}
            <option value={s}>{s}</option>
          {/each}
        </select>
      </label>
    {/if}
    {#if item.kind === "strip" || item.kind === "strip_curve" || item.kind === "par"}
      <label class="flex items-center justify-between gap-2 text-ink-muted">
        Aim
        <select
          value={item.params.facing ?? "front"}
          onchange={(e) =>
            updateItemParams(item.id, {
              facing: e.currentTarget.value as (typeof FACINGS)[number],
            })}
          class="w-24 rounded border border-edge bg-app px-1 py-0.5 text-ink"
        >
          {#each FACINGS as f (f)}
            <option value={f}>{f}</option>
          {/each}
        </select>
      </label>
    {/if}
    {#each fields(item) as f (f.key)}
      <label class="flex items-center justify-between gap-2 text-ink-muted">
        {f.label}
        <input
          type="number"
          min={f.min}
          max={f.max}
          step={f.step}
          value={f.value}
          onchange={(e) =>
            setParam(f.key, Number(e.currentTarget.value), f.min, f.max)}
          class="w-20 rounded border border-edge bg-app px-1 py-0.5 text-ink"
        />
      </label>
    {/each}
    {#if item.type !== "light"}
      <label class="flex items-center justify-between gap-2 text-ink-muted">
        Color
        <input
          type="color"
          value={item.params.color ?? "#555555"}
          onchange={(e) =>
            updateItemParams(item.id, { color: e.currentTarget.value })}
          class="h-5 w-8 cursor-pointer rounded border border-edge bg-app"
        />
      </label>
    {/if}
    <button
      onclick={() => removeItem(item.id)}
      class="mt-1 rounded border border-edge px-2 py-1 text-ink-muted hover:text-danger"
    >
      Remove
    </button>
  </div>
{/if}
