<script lang="ts">
  import { formatTime } from "$lib/format";
  import ContinuousLane from "$lib/graphs/ContinuousLane.svelte";
  import {
    backToMix,
    inspection,
    playToggle,
  } from "$lib/state/inspection.svelte";
  import {
    scrub,
    scrubEnd,
    scrubStart,
    setRate,
    transport,
  } from "$lib/state/transport.svelte";

  // The one transport surface: song overview + playhead + controls, shown on
  // every tab while a song is open, so the song is scrubbable from any stage.

  const RATES = [0.25, 0.5, 0.75, 1];

  // Song-level lane: RMS if present, else the first continuous mix feature.
  const overview = $derived.by(() => {
    const mix = inspection.profile?.mix;
    if (!mix) return null;
    const rms = mix["rms"];
    if (rms?.render === "continuous") return rms.data;
    const first = Object.values(mix).find((f) => f.render === "continuous");
    return first && first.render === "continuous" ? first.data : null;
  });

  const frameRateHz = $derived(
    inspection.profile?.timeline.frame_rate_hz ?? 100,
  );
</script>

{#if inspection.songId !== null}
  <div
    class="flex shrink-0 items-center gap-3 border-b border-edge bg-surface px-3 py-2"
  >
    <button
      onclick={() => playToggle(transport.activeKey)}
      disabled={!inspection.audioPath}
      title={transport.playing ? "Pause playback" : "Play from the playhead"}
      class="rounded bg-accent px-4 py-1.5 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-50"
    >
      {transport.playing ? "Pause" : "Play"}
    </button>

    <span class="shrink-0 text-sm tabular-nums text-ink-muted">
      {formatTime(transport.currentTime)} / {formatTime(transport.durationSec)}
    </span>

    <select
      value={transport.rate}
      onchange={(e) => setRate(Number(e.currentTarget.value))}
      title="Playback speed (changes pitch)"
      class="rounded border border-edge bg-app px-1.5 py-1 text-sm text-ink-muted focus:border-accent focus:outline-none"
    >
      {#each RATES as r (r)}
        <option value={r}>{r}×</option>
      {/each}
    </select>

    {#if transport.activeKey !== "mix"}
      <button
        onclick={backToMix}
        title="Switch the audible source back to the original mix"
        class="shrink-0 rounded border border-edge px-2 py-1 text-sm text-ink-muted hover:text-ink"
      >
        ♪ {transport.activeKey.split("::").at(-1)} → mix
      </button>
    {/if}

    {#if transport.error}
      <span class="truncate text-sm text-danger" title={transport.error}>
        {transport.error}
      </span>
    {/if}

    <div class="min-w-0 flex-1">
      {#if overview}
        <ContinuousLane
          data={overview}
          {frameRateHz}
          label="overview"
          color="#74ade8"
          height={88}
          showYAxis={false}
          showControls={false}
          playheadSec={transport.currentTime}
          follow={transport.playing}
          onSeek={scrub}
          onScrubStart={scrubStart}
          onScrubEnd={scrubEnd}
        />
      {/if}
    </div>
  </div>
{/if}
