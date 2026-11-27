<script lang="ts">
  import type { MappingDoc } from "$lib/mapping/schema";
  import { resolveFeature } from "$lib/mapping/sources";
  import { docReport, newGlowProgram } from "$lib/showgen/edit";
  import { getRawProfile } from "$lib/state/inspection.svelte";
  import { addProgram, editProgram, mapping } from "$lib/state/mapping.svelte";

  // The generator's selection report: every candidate track with its score,
  // whether it was picked and why. Clicking a row adds it as a glow program.

  const report = $derived(docReport(mapping.doc?.generator));
  const rows = $derived(
    report ? [...report.candidates].sort((a, b) => b.score - a.score) : [],
  );

  function measuresTitle(m: Record<string, number>): string {
    return Object.entries(m)
      .map(([k, v]) => `${k} ${v.toFixed(2)}`)
      .join("\n");
  }

  function add(path: string, label: string): void {
    const profile = getRawProfile();
    if (!profile || mapping.doc === null) return;
    const doc = $state.snapshot(mapping.doc) as MappingDoc;
    const f = resolveFeature(profile, path);
    const program = newGlowProgram(
      path,
      label,
      f?.render === "continuous" ? f.data : undefined,
      doc.programs,
      doc.palette,
    );
    addProgram(program);
    editProgram(program.id);
  }
</script>

{#if report === null}
  <p class="text-sm text-ink-faint">
    Generate a show to see how every track was scored.
  </p>
{:else}
  <table class="w-full text-xs tabular-nums">
    <thead>
      <tr class="text-left text-ink-faint">
        <th class="py-1 pr-2 font-medium">Track</th>
        <th class="py-1 pr-2 text-right font-medium">Score</th>
        <th class="py-1 pr-2 font-medium">Pick</th>
        <th class="py-1 pr-2 font-medium">Role</th>
        <th class="py-1 font-medium">Why</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as c (c.path)}
        <tr
          onclick={() => add(c.path, c.label)}
          title={`${measuresTitle(c.measures)}\n\nClick to add as a glow program`}
          class="cursor-pointer border-t border-edge hover:bg-raised {c.picked
            ? 'text-ink'
            : c.score === 0
              ? 'text-ink-faint'
              : 'text-ink-muted'}"
        >
          <td class="py-1 pr-2">{c.label}</td>
          <td class="py-1 pr-2 text-right">{c.score.toFixed(2)}</td>
          <td class="py-1 pr-2">{c.rank ?? ""}</td>
          <td class="py-1 pr-2">{c.role ?? ""}</td>
          <td class="py-1">{c.reason}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
