<script lang="ts">
  import ContinuousGraph from "$lib/components/ContinuousGraph.svelte";
  import type { ContinuousFeature } from "$lib/ipc/messages";
  import { parseNpy } from "$lib/npy";

  // Tags feature: a [rows, frames] probability matrix in a .npy sidecar, one
  // row per label. Renders one line graph per row that is actually present
  // (peak above PRESENT_THRESHOLD), reusing ContinuousGraph — a row that never
  // fires would only be a flat zero line. Sorted by prominence.
  let {
    path,
    labels,
    frameRateHz,
    color = "#a855f7",
    playheadSec = null,
    follow = false,
    onSeek,
    onScrubStart,
    onScrubEnd,
  }: {
    path: string;
    labels: string[];
    frameRateHz: number;
    color?: string;
    playheadSec?: number | null;
    follow?: boolean;
    onSeek?: (sec: number) => void;
    onScrubStart?: () => void;
    onScrubEnd?: () => void;
  } = $props();

  const PRESENT_THRESHOLD = 0.05;

  // Each present row as a synthetic ContinuousFeature for ContinuousGraph,
  // ordered by descending peak so the prominent tags lead.
  let rows = $state<{ label: string; feature: ContinuousFeature }[]>([]);
  let error = $state<string | null>(null);

  $effect(() => {
    const url = path;
    const labelList = labels;
    error = null;
    rows = [];
    (async () => {
      try {
        const { convertFileSrc } = await import("@tauri-apps/api/core");
        const resp = await fetch(convertFileSrc(url));
        const { shape, data } = parseNpy(await resp.arrayBuffer());
        const [nRows, nCols] = shape;
        const present: {
          label: string;
          peak: number;
          feature: ContinuousFeature;
        }[] = [];
        for (let r = 0; r < nRows; r++) {
          const slice = data.subarray(r * nCols, (r + 1) * nCols);
          let peak = 0;
          for (let i = 0; i < slice.length; i++)
            if (slice[i] > peak) peak = slice[i];
          if (peak < PRESENT_THRESHOLD) continue;
          present.push({
            label: labelList[r] ?? `row ${r}`,
            peak,
            feature: {
              render: "continuous",
              category: "semantic",
              source: "panns",
              unit: "probability",
              range: [0, 1],
              data: Array.from(slice),
            },
          });
        }
        present.sort((a, b) => b.peak - a.peak);
        rows = present.map(({ label, feature }) => ({ label, feature }));
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    })();
  });
</script>

{#if error}
  <p class="text-xs text-red-500">Failed to load tags: {error}</p>
{:else if rows.length === 0}
  <p class="text-xs text-neutral-500">No tags above threshold.</p>
{:else}
  <div class="flex flex-col gap-4">
    {#each rows as { label, feature } (label)}
      <div>
        <p class="mb-1 text-xs text-neutral-500 dark:text-neutral-400">
          {label}
        </p>
        <ContinuousGraph
          {feature}
          {frameRateHz}
          {label}
          {color}
          height={80}
          {playheadSec}
          {follow}
          {onSeek}
          {onScrubStart}
          {onScrubEnd}
        />
      </div>
    {/each}
  </div>
{/if}
