<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";

  import { formatTime } from "$lib/format";
  import AnalyzeDialog from "$lib/components/library/AnalyzeDialog.svelte";
  import { cancelAnalysis, importFiles } from "$lib/ipc";
  import { library } from "$lib/state/library.svelte";
  import { open as openInspection } from "$lib/state/inspection.svelte";

  // Open a native file picker and import the selected audio files.
  async function pickAndImport() {
    const selected = await open({
      multiple: true,
      filters: [
        { name: "Audio", extensions: ["flac", "wav", "mp3", "m4a", "aac"] },
      ],
    });
    if (selected === null) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    await importFiles(paths);
  }

  // Song whose analysis-configuration dialog is open (null = none).
  let analyzeFor = $state<{ id: string; title: string } | null>(null);

  // Remove a queued song from the analysis queue.
  function cancel(songId: string) {
    return cancelAnalysis(songId);
  }

  // Uppercase file extension from the stored source path (e.g. "FLAC", "MP3").
  function formatType(sourcePath: string): string {
    const ext = sourcePath.split(".").pop() ?? "";
    return ext.toUpperCase();
  }

  // Format seconds as m:ss; em dash when duration is unknown.
  function formatDuration(seconds: number | null): string {
    return seconds === null ? "—" : formatTime(seconds);
  }

  // Human verb per pipeline stage.
  const STAGE_VERB: Record<string, string> = {
    "dsp-mix": "analyzing mix",
    separate: "separating",
    "dsp-stem": "stem features",
    "drum-subsep": "drum sub-sep",
  };

  // Status label: while analyzing, show the stage, engine, and step count
  // (engine k of N) — discrete progress, no misleading percentage.
  function statusLabel(song: {
    status: string;
    current_stage: string | null;
    current_engine: string | null;
    current_step: number | null;
    total_steps: number | null;
  }): string {
    if (song.status !== "analyzing" || !song.current_stage) return song.status;
    const base = STAGE_VERB[song.current_stage] ?? song.current_stage;
    const engine = song.current_engine ? ` ${song.current_engine}` : "";
    const step =
      song.current_step && song.total_steps
        ? ` (${song.current_step}/${song.total_steps})`
        : "";
    return `${base}${engine}${step}`;
  }
</script>

<section class="flex w-full flex-col gap-4">
  <div class="flex items-center justify-end">
    <button
      onclick={pickAndImport}
      class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
    >
      Import…
    </button>
  </div>

  <div
    class="overflow-x-auto rounded-md border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
  >
    {#if library.songs.length === 0}
      <p class="p-4 text-sm text-neutral-500">No songs imported yet.</p>
    {:else}
      <table class="w-full text-left text-sm">
        <thead
          class="border-b border-neutral-200 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400"
        >
          <tr>
            <th class="px-3 py-2 font-medium">Title</th>
            <th class="px-3 py-2 font-medium">Artist</th>
            <th class="px-3 py-2 font-medium">Type</th>
            <th class="px-3 py-2 font-medium">Duration</th>
            <th class="px-3 py-2 font-medium">Status</th>
            <th class="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {#each library.songs as song (song.id)}
            <tr
              onclick={() =>
                song.status === "analyzed"
                  ? openInspection(song.id)
                  : undefined}
              class="border-b border-neutral-200 last:border-0 dark:border-neutral-800/50 {song.status ===
              'analyzed'
                ? 'cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800/50'
                : ''}"
            >
              <td class="px-3 py-2">{song.title}</td>
              <td class="px-3 py-2 text-neutral-600 dark:text-neutral-400"
                >{song.artist}</td
              >
              <td class="px-3 py-2 text-neutral-600 dark:text-neutral-400">
                {formatType(song.source_path)}
              </td>
              <td
                class="px-3 py-2 tabular-nums text-neutral-600 dark:text-neutral-400"
              >
                {formatDuration(song.duration_sec)}
              </td>
              <td class="px-3 py-2 tabular-nums text-neutral-500"
                >{statusLabel(song)}</td
              >
              <td class="px-3 py-2 text-right">
                {#if song.status === "unanalyzed" || song.status === "failed"}
                  <button
                    onclick={() =>
                      (analyzeFor = { id: song.id, title: song.title })}
                    class="rounded bg-neutral-200 px-2 py-1 text-xs font-medium hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700"
                  >
                    {song.status === "failed" ? "Retry" : "Analyze"}
                  </button>
                {:else if song.status === "analyzed"}
                  <!-- stopPropagation: the row click opens the inspection view. -->
                  <button
                    onclick={(e) => {
                      e.stopPropagation();
                      analyzeFor = { id: song.id, title: song.title };
                    }}
                    title="Run analysis again (overwrites the existing profile)"
                    class="rounded bg-neutral-200 px-2 py-1 text-xs font-medium hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700"
                  >
                    Re-analyze
                  </button>
                {:else if song.status === "queued"}
                  <button
                    onclick={() => cancel(song.id)}
                    class="rounded bg-neutral-200 px-2 py-1 text-xs font-medium hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700"
                  >
                    Cancel
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</section>

{#if analyzeFor}
  <AnalyzeDialog
    songId={analyzeFor.id}
    songTitle={analyzeFor.title}
    onclose={() => (analyzeFor = null)}
  />
{/if}
