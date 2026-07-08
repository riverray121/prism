<script lang="ts">
  import {
    autoMap,
    proposalIsEmpty,
    type AutoMapProposal,
  } from "$lib/mapping/automap";
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

  function generate(): void {
    note = null;
    pending = null;
    const profile = getRawProfile();
    if (!profile || mapping.doc === null) return;
    const doc = $state.snapshot(mapping.doc) as MappingDoc;
    const proposal = autoMap(profile, doc);
    if (proposalIsEmpty(proposal)) {
      note = "Nothing to propose — star features in Analysis first.";
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
    {#if pending === null}
      <button
        onclick={generate}
        title="Propose a starter show from your favorites (adds to the doc, never replaces)"
        class="rounded border border-edge px-1.5 py-0.5 text-xs text-ink-muted hover:text-ink"
      >
        Generate
      </button>
    {/if}
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
