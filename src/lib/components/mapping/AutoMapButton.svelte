<script lang="ts">
  import { Popover } from "bits-ui";

  import {
    autoMap,
    proposalIsEmpty,
    type AutoMapOptions,
    type AutoMapProposal,
  } from "$lib/mapping/automap";
  import { favoriteSources } from "$lib/mapping/sources";
  import type { MappingDoc } from "$lib/mapping/schema";
  import { getRawProfile } from "$lib/state/inspection.svelte";
  import {
    applyAutoMapProposal,
    docIsEmpty,
    mapping,
  } from "$lib/state/mapping.svelte";

  // The one entry point to auto-map: strictly on demand. An empty doc fills
  // silently; a doc with hand-built work gets an explicit confirm step, and
  // the proposal only ever appends.

  let pending = $state<AutoMapProposal | null>(null);
  let note = $state<string | null>(null);

  // Brightness reference for generated programs (see AutoMapOptions).
  let intensity = $state<AutoMapOptions["intensity"]>("feature");

  function generate(): void {
    note = null;
    pending = null;
    const profile = getRawProfile();
    if (!profile || mapping.doc === null) return;
    const doc = $state.snapshot(mapping.doc) as MappingDoc;
    const proposal = autoMap(profile, doc, { intensity });
    if (proposalIsEmpty(proposal)) {
      // Say which precondition failed: stars are per-song, can go stale
      // (re-analysis with other engines), or may fit no channel kind.
      const starred = profile.favorites.length;
      const usable = favoriteSources(profile).length;
      note =
        starred === 0
          ? "Nothing starred on this song. Star (★) features in Analysis."
          : usable === 0
            ? "Starred features no longer exist on this profile (re-analyzed with different engines?). Re-star in Analysis."
            : "Starred features fit no channel. Star energy, onsets, centroid, or sections.";
      return;
    }
    if (docIsEmpty(doc)) {
      applyAutoMapProposal(proposal);
      return;
    }
    pending = proposal; // hand-built work present: append only after confirm
  }

  function confirm(): void {
    if (pending) applyAutoMapProposal(pending);
    pending = null;
  }
</script>

<section class="p-3 pt-0">
  <div class="flex items-center justify-between">
    <p class="text-xs font-medium uppercase tracking-wide text-ink-faint">
      Auto-map
    </p>
    <div class="flex items-center gap-1">
      {#if pending === null}
        <button
          onclick={generate}
          title="Propose a starter show from your favorites (adds to the doc, never replaces)"
          class="rounded border border-edge px-1.5 py-0.5 text-xs text-ink-muted hover:text-ink"
        >
          Generate
        </button>
      {/if}
      <!-- Settings live behind the gear so the section stays one line. -->
      <Popover.Root>
        <Popover.Trigger
          title="Auto-map settings"
          class="rounded border border-edge p-1 text-ink-muted hover:text-ink"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
            />
          </svg>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="end"
            sideOffset={6}
            class="z-50 w-56 rounded-md border border-edge bg-surface p-3 shadow-lg"
          >
            <p
              class="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint"
            >
              Auto-map settings
            </p>
            <!-- Brightness reference for generated programs: each source's
                 own range, or anchored to the mix so quiet stems stay dim. -->
            <label
              class="flex items-center justify-between gap-2 text-xs text-ink-muted"
              title="Full brightness at each feature's own peak, or scaled against the whole song's level"
            >
              Intensity
              <select
                bind:value={intensity}
                class="rounded border border-edge bg-app px-1 py-0.5 text-xs focus:border-accent focus:outline-none"
              >
                <option value="feature">per feature</option>
                <option value="song">whole song</option>
              </select>
            </label>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  </div>
  {#if pending}
    <div class="mt-1.5 flex flex-col gap-1.5 text-xs text-ink-muted">
      <p>
        Append {pending.programs.length} program{pending.programs.length === 1
          ? ""
          : "s"}{pending.scenesFrom !== null ? " + scene seeds" : ""} to your existing
        work?
      </p>
      <div class="flex gap-2">
        <button
          onclick={confirm}
          class="rounded bg-accent px-2 py-0.5 font-medium text-surface hover:opacity-90"
        >
          Append
        </button>
        <button
          onclick={() => (pending = null)}
          class="rounded border border-edge px-2 py-0.5 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  {/if}
  {#if note}
    <p class="mt-1.5 text-xs text-ink-faint">{note}</p>
  {/if}
</section>
