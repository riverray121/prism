<script lang="ts">
  import Segmented from "$lib/components/shell/Segmented.svelte";
  import { formatTime, humanize } from "$lib/format";
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
    setFollowMode,
    setRate,
    setViewWindow,
    transport,
    view,
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

  // The main button is the full song's play/pause. While a stem is soloed it
  // reads as "play the full song": clicking switches the audible source back
  // to the mix (mid-playback, same playhead) instead of pausing the stem.
  const mixAudible = $derived(transport.activeKey === "mix");
  const mixPlaying = $derived(transport.playing && mixAudible);

  // Compact label for the soloed source: "{stem}" or "{stem} · {substem}".
  const soloLabel = $derived.by(() => {
    if (mixAudible) return null;
    const [, stem, sub] = transport.activeKey.split("::");
    return sub ? `${humanize(stem)} · ${humanize(sub)}` : humanize(stem);
  });
</script>

{#if inspection.songId !== null}
  <div class="flex shrink-0 flex-col border-b border-edge bg-surface">
    <div class="flex items-center gap-3 px-3 py-2">
      <!-- Left cluster: play + time only, so the button stays vertically
           centered with the overview lane regardless of solo state. -->
      <div
        class="flex w-28 shrink-0 flex-col items-center justify-center gap-1"
      >
        <!-- Full-song play/pause: a fixed circle so the glyph swap never
             shifts layout. Soloed-stem state shows ▶ — clicking returns to
             the mix. -->
        <button
          onclick={() => playToggle("mix")}
          disabled={!inspection.audioPath}
          title={mixPlaying
            ? "Pause playback"
            : mixAudible
              ? "Play from the playhead"
              : "Back to the full song (from the soloed stem)"}
          class="flex size-10 items-center justify-center rounded-full bg-accent text-surface hover:opacity-90 disabled:opacity-50"
        >
          {#if mixPlaying}
            <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor">
              <rect x="1" y="1" width="3.5" height="12" rx="1" />
              <rect x="7.5" y="1" width="3.5" height="12" rx="1" />
            </svg>
          {:else}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M3.5 1.5 12 7l-8.5 5.5z" />
            </svg>
          {/if}
        </button>
        <span class="text-xs tabular-nums text-ink-muted">
          {formatTime(transport.currentTime)} / {formatTime(
            transport.durationSec,
          )}
        </span>
      </div>

      <!-- Overview lane: opts out of the shared window (no onWindowChange), so
           it always shows the full song. -->
      <div class="min-w-0 flex-1">
        {#if overview}
          <ContinuousLane
            data={overview}
            {frameRateHz}
            label="overview"
            color="#74ade8"
            height={110}
            showYAxis={false}
            playheadSec={transport.currentTime}
            onSeek={scrub}
            onScrubStart={scrubStart}
            onScrubEnd={scrubEnd}
          />
        {/if}
      </div>

      <!-- View + speed controls: label + segmented picker per row, stacked in
           a fixed-width column so the overview lane gets the width. -->
      <div class="flex w-48 shrink-0 flex-col gap-1.5 text-xs">
        <!-- Audible source: always-present row, so a solo starting/ending
             never reflows the bar. -->
        <div class="flex h-6 items-center gap-2">
          <span
            class="w-11 shrink-0 text-ink-faint"
            title="Which audio is playing — the full mix or a soloed stem"
          >
            Audio
          </span>
          {#if soloLabel}
            <div
              class="flex h-full min-w-0 flex-1 items-center gap-1 rounded-md border border-accent px-1.5"
            >
              <span
                class="min-w-0 flex-1 truncate font-medium text-accent"
                title={`Soloed stem: ${transport.activeKey.replaceAll("::", " · ")}`}
              >
                {soloLabel}
              </span>
              <button
                onclick={backToMix}
                title="End the solo — back to the full song"
                class="flex size-4 shrink-0 items-center justify-center rounded-full text-accent hover:bg-raised"
              >
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                >
                  <path d="M2 2l8 8M10 2l-8 8" />
                </svg>
              </button>
            </div>
          {:else}
            <span
              class="flex h-full flex-1 items-center rounded-md border border-transparent px-1.5 text-ink-muted"
            >
              Full mix
            </span>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          <span
            class="w-11 shrink-0 text-ink-faint"
            title="Playback speed (changes pitch)"
          >
            Speed
          </span>
          <Segmented
            class="flex-1"
            options={RATES.map((r) => ({
              label: r === 1 ? "1×" : String(r).replace("0.", "."),
              active: transport.rate === r,
              onpick: () => setRate(r),
            }))}
          />
        </div>
        <div class="flex items-center gap-2">
          <span
            class="w-11 shrink-0 text-ink-faint"
            title="How zoomed lanes track the playhead while playing"
          >
            Follow
          </span>
          <Segmented
            class="flex-1"
            options={[
              {
                label: "Center",
                active: view.followMode === "center",
                onpick: () => setFollowMode("center"),
              },
              {
                label: "Page",
                active: view.followMode === "page",
                onpick: () => setFollowMode("page"),
              },
            ]}
          />
        </div>
        <div class="flex items-center gap-2">
          <span class="w-11 shrink-0 text-ink-faint">Zoom</span>
          <button
            onclick={() => setViewWindow(null)}
            disabled={view.window === null}
            title="Reset all lanes to the full time extent"
            class="flex-1 rounded-md border border-edge px-1 py-1 text-center text-ink-muted hover:text-ink disabled:opacity-40"
          >
            Reset
          </button>
        </div>
      </div>
    </div>

    {#if transport.error}
      <p
        class="truncate px-3 pb-1.5 text-sm text-danger"
        title={transport.error}
      >
        {transport.error}
      </p>
    {/if}
  </div>
{/if}
