<script lang="ts">
  import type { Snippet } from "svelte";

  import type { ContinuousFeature } from "$lib/ipc/messages";
  import { requestFeatureTrack } from "$lib/state/inspection.svelte";

  // Gate on a continuous feature's data being streamed in: requests the .npy
  // on mount and shows a lane-sized shimmer until it lands. Children receive
  // the resolved array.
  let {
    feature,
    height = 150,
    children,
  }: {
    feature: ContinuousFeature;
    height?: number; // placeholder height, matched to the lane it gates
    children: Snippet<[number[] | Float32Array]>;
  } = $props();

  $effect(() => {
    if (!feature.data) requestFeatureTrack(feature);
  });
</script>

{#if feature.data}
  {@render children(feature.data)}
{:else}
  <div
    class="animate-pulse rounded bg-raised/60"
    style="height: {height}px"
  ></div>
{/if}
