<script lang="ts">
  import type { FollowMode, Win } from "$lib/graphs/axis";
  import ContinuousLane from "$lib/graphs/ContinuousLane.svelte";
  import { presentRows } from "$lib/graphs/tags";
  import { loadNpy } from "$lib/npy";

  // Renderer for tags features: one continuous lane per present row of a
  // [rows, frames] probability matrix.
  let {
    path,
    labels,
    frameRateHz,
    color = "#a855f7",
    playheadSec = null,
    follow = false,
    window: win = null,
    followMode = "center",
    onWindowChange,
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
    window?: Win | null;
    followMode?: FollowMode;
    onWindowChange?: (win: Win | null) => void;
    onSeek?: (sec: number) => void;
    onScrubStart?: () => void;
    onScrubEnd?: () => void;
  } = $props();

  const PRESENT_THRESHOLD = 0.05;

  let rows = $state<{ label: string; data: number[] }[]>([]);
  let error = $state<string | null>(null);

  $effect(() => {
    const url = path;
    const labelList = labels;
    error = null;
    rows = [];
    (async () => {
      try {
        rows = presentRows(await loadNpy(url), labelList, PRESENT_THRESHOLD);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    })();
  });
</script>

{#if error}
  <p class="text-xs text-danger">Failed to load tags: {error}</p>
{:else if rows.length === 0}
  <p class="text-xs text-ink-faint">No tags above threshold.</p>
{:else}
  <div class="flex flex-col gap-4">
    {#each rows as { label, data } (label)}
      <div>
        <p class="mb-1 text-xs text-ink-muted">
          {label}
        </p>
        <ContinuousLane
          {data}
          {frameRateHz}
          {label}
          {color}
          height={80}
          {playheadSec}
          {follow}
          window={win}
          {followMode}
          {onWindowChange}
          {onSeek}
          {onScrubStart}
          {onScrubEnd}
        />
      </div>
    {/each}
  </div>
{/if}
