<script lang="ts">
  import { close, inspection } from "$lib/state/inspection.svelte";

  // BPM rounded for display; the profile keeps the raw value.
  function formatBpm(value: number): string {
    return value.toFixed(1);
  }
</script>

<section class="flex w-full max-w-2xl flex-col gap-6">
  <button
    onclick={close}
    class="self-start text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
  >
    ← Library
  </button>

  {#if inspection.profile === null}
    <p class="text-sm text-neutral-500">Loading…</p>
  {:else}
    {@const song = inspection.profile.song}
    <header>
      <h2 class="text-2xl font-semibold tracking-tight">{song.title}</h2>
      <p class="text-sm text-neutral-500 dark:text-neutral-400">
        {song.artist}
      </p>
    </header>

    <div
      class="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <p class="text-xs text-neutral-500 dark:text-neutral-400">BPM</p>
      <p class="text-3xl font-semibold tabular-nums">
        {formatBpm(inspection.profile.mix.bpm.value)}
      </p>
    </div>
  {/if}
</section>
