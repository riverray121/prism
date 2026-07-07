<script lang="ts">
  import { formatTime } from "$lib/format";
  import AnalyzeDialog from "$lib/components/library/AnalyzeDialog.svelte";
  import ConfirmDialog from "$lib/components/library/ConfirmDialog.svelte";
  import ImportDialog from "$lib/components/library/ImportDialog.svelte";
  import MetadataDialog from "$lib/components/library/MetadataDialog.svelte";
  import { cancelAnalysis, deleteSong } from "$lib/ipc";
  import type { Song } from "$lib/ipc/messages";
  import { library } from "$lib/state/library.svelte";
  import {
    close as closeInspection,
    inspection,
    open as openInspection,
  } from "$lib/state/inspection.svelte";

  // Whether the import (files / YouTube URL) dialog is open.
  let importOpen = $state(false);

  // Song whose analysis-configuration dialog is open (null = none).
  let analyzeFor = $state<{ id: string; title: string } | null>(null);
  // Song whose metadata dialog is open (null = none).
  let editFor = $state<Song | null>(null);
  // Song pending delete confirmation (null = none).
  let deleteFor = $state<Song | null>(null);

  function confirmDelete(song: Song) {
    if (inspection.songId === song.id) closeInspection();
    void deleteSong(song.id);
  }

  // "Jul 7" style short date from an ISO timestamp.
  function shortDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }

  // ── Search + filters ─────────────────────────────────────────────────────

  const STATUSES = [
    "all",
    "unanalyzed",
    "queued",
    "analyzing",
    "analyzed",
    "failed",
  ] as const;
  let query = $state("");
  let statusFilter = $state<(typeof STATUSES)[number]>("all");
  let missingMetaOnly = $state(false);

  // Import falls back to "Unknown" when a file carries no artist tag.
  function missingMeta(song: Song): boolean {
    return song.artist === "Unknown" || song.artist.trim() === "";
  }

  const visibleSongs = $derived(
    library.songs.filter((song) => {
      if (statusFilter !== "all" && song.status !== statusFilter) return false;
      if (missingMetaOnly && !missingMeta(song)) return false;
      const q = query.trim().toLowerCase();
      if (q === "") return true;
      return (
        song.title.toLowerCase().includes(q) ||
        song.artist.toLowerCase().includes(q)
      );
    }),
  );

  // ── Presentation ─────────────────────────────────────────────────────────

  // Uppercase file extension from the stored source path (e.g. "FLAC", "MP3").
  function formatType(sourcePath: string): string {
    const ext = sourcePath.split(".").pop() ?? "";
    return ext.toUpperCase();
  }

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
  function statusLabel(song: Song): string {
    if (song.status !== "analyzing" || !song.current_stage) return song.status;
    const base = STAGE_VERB[song.current_stage] ?? song.current_stage;
    const engine = song.current_engine ? ` ${song.current_engine}` : "";
    const step =
      song.current_step && song.total_steps
        ? ` (${song.current_step}/${song.total_steps})`
        : "";
    return `${base}${engine}${step}`;
  }

  const STATUS_COLOR: Record<string, string> = {
    analyzed: "text-accent",
    analyzing: "text-ink",
    queued: "text-ink-muted",
    failed: "text-danger",
    unanalyzed: "text-ink-faint",
  };
</script>

<section class="flex w-full flex-col gap-3">
  <div class="flex items-center gap-2">
    <input
      bind:value={query}
      placeholder="Search library…"
      class="min-w-0 flex-1 rounded border border-edge bg-app px-2 py-1 text-sm placeholder:text-ink-faint focus:border-accent focus:outline-none"
    />
    <button
      onclick={() => (importOpen = true)}
      title="Add songs (files or YouTube URL)"
      class="shrink-0 rounded bg-accent px-2.5 py-1 text-sm font-medium text-surface hover:opacity-90"
    >
      +
    </button>
  </div>

  <div class="flex items-center gap-3 text-xs text-ink-muted">
    <select
      bind:value={statusFilter}
      class="rounded border border-edge bg-app px-1 py-0.5 focus:border-accent focus:outline-none"
    >
      {#each STATUSES as s (s)}
        <option value={s}>{s}</option>
      {/each}
    </select>
    <label class="flex items-center gap-1">
      <input type="checkbox" bind:checked={missingMetaOnly} class="size-3" />
      missing metadata
    </label>
    <span class="ml-auto text-ink-faint">
      {visibleSongs.length}/{library.songs.length}
    </span>
  </div>

  {#if library.lastImportError}
    <p
      class="truncate text-xs text-danger"
      title={`${library.lastImportError.path}: ${library.lastImportError.error}`}
    >
      Import failed: {library.lastImportError.error}
    </p>
  {/if}

  <div class="flex flex-col overflow-hidden rounded-md border border-edge">
    {#if visibleSongs.length === 0}
      <p class="p-4 text-sm text-ink-faint">
        {library.songs.length === 0 ? "No songs imported yet." : "No matches."}
      </p>
    {:else}
      {#each visibleSongs as song (song.id)}
        <div
          role="button"
          tabindex="0"
          onclick={() =>
            song.status === "analyzed" ? openInspection(song.id) : undefined}
          onkeydown={(e) =>
            e.key === "Enter" && song.status === "analyzed"
              ? openInspection(song.id)
              : undefined}
          class="flex flex-col gap-0.5 border-b border-edge px-3 py-2 last:border-0 {song.status ===
          'analyzed'
            ? 'cursor-pointer hover:bg-raised'
            : ''} {inspection.songId === song.id ? 'bg-raised' : ''}"
        >
          <div class="flex items-center gap-1">
            <span class="min-w-0 truncate text-sm">{song.title}</span>
            <button
              onclick={(e) => {
                e.stopPropagation();
                editFor = song;
              }}
              title="Edit title and artist"
              class="shrink-0 rounded px-1.5 py-0.5 text-xs leading-none text-ink-faint hover:bg-raised hover:text-ink"
            >
              ✎
            </button>
            <span class="flex-1"></span>
            <span
              class="shrink-0 text-xs tabular-nums {STATUS_COLOR[song.status] ??
                'text-ink-muted'}"
            >
              {statusLabel(song)}
            </span>
          </div>
          <div class="flex items-center gap-2 text-xs text-ink-muted">
            <span class="min-w-0 flex-1 truncate">
              {song.artist} · {formatType(song.source_path)} · {formatDuration(
                song.duration_sec,
              )}{song.analyzed_at
                ? ` · analyzed ${shortDate(song.analyzed_at)}`
                : ""}
            </span>
            {#if song.status !== "analyzing"}
              <button
                onclick={(e) => {
                  e.stopPropagation();
                  deleteFor = song;
                }}
                title="Delete this song and all its analysis data"
                class="shrink-0 rounded p-1 text-ink-faint hover:bg-raised hover:text-danger"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                >
                  <path
                    d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"
                  />
                </svg>
              </button>
            {/if}
            {#if song.status === "unanalyzed" || song.status === "failed" || song.status === "analyzed"}
              <button
                onclick={(e) => {
                  e.stopPropagation();
                  analyzeFor = { id: song.id, title: song.title };
                }}
                title={song.status === "analyzed"
                  ? "Run analysis again (overwrites the existing profile)"
                  : ""}
                class="shrink-0 rounded bg-raised px-2.5 py-1 text-sm font-medium hover:text-ink"
              >
                {song.status === "failed"
                  ? "Retry"
                  : song.status === "analyzed"
                    ? "Re-analyze"
                    : "Analyze"}
              </button>
            {:else if song.status === "queued"}
              <button
                onclick={(e) => {
                  e.stopPropagation();
                  void cancelAnalysis(song.id);
                }}
                class="shrink-0 rounded bg-raised px-2.5 py-1 text-sm font-medium hover:text-ink"
              >
                Cancel
              </button>
            {/if}
          </div>
          {#if song.status === "failed" && song.error_message}
            <p class="truncate text-xs text-danger" title={song.error_message}>
              {song.error_message}
            </p>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</section>

{#if importOpen}
  <ImportDialog onclose={() => (importOpen = false)} />
{/if}
{#if analyzeFor}
  <AnalyzeDialog
    songId={analyzeFor.id}
    songTitle={analyzeFor.title}
    onclose={() => (analyzeFor = null)}
  />
{/if}
{#if editFor}
  <MetadataDialog song={editFor} onclose={() => (editFor = null)} />
{/if}
{#if deleteFor}
  {@const target = deleteFor}
  <ConfirmDialog
    title={`Delete "${target.title}"?`}
    body="Removes the song, its analysis, stems, and favorites from the library. This cannot be undone."
    onconfirm={() => confirmDelete(target)}
    onclose={() => (deleteFor = null)}
  />
{/if}
