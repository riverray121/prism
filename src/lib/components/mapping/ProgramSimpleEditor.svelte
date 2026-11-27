<script lang="ts">
  import EditableName from "$lib/components/EditableName.svelte";
  import Segmented from "$lib/components/shell/Segmented.svelte";
  import { programLabel } from "$lib/mapping/labels";
  import type { MappingDoc, Program } from "$lib/mapping/schema";
  import { resolveFeature } from "$lib/mapping/sources";
  import {
    brightnessRange,
    detectStyle,
    docReport,
    hasContinuousBrightness,
    programSource,
    restyle,
    smoothing,
    sourceOptions,
    STYLE_LABELS,
    STYLES,
    swatchCss,
    withColor,
    withRange,
    withSmoothing,
    type Style,
  } from "$lib/showgen/edit";
  import { hexToOklch, resolvePalette } from "$lib/showgen/palettes";
  import { songContext } from "$lib/showgen/select";
  import { requestCandidateTracks } from "$lib/state/evaluation.svelte";
  import { getRawProfile, inspection } from "$lib/state/inspection.svelte";
  import {
    mapping,
    mappingUi,
    renameProgram,
    replaceProgram,
  } from "$lib/state/mapping.svelte";
  import { tracks } from "$lib/state/tracks.svelte";

  // Simple editor for the selected program: one source, one style, a color,
  // floor/peak and smoothing. Each control rewrites the program through the
  // same builders the show algorithms use; the channel editor stays under
  // Advanced in the parent view.

  const program = $derived(
    mapping.doc?.programs.find((p) => p.id === mappingUi.editingProgram),
  );
  const doc = $derived(mapping.doc);
  const style = $derived(program ? detectStyle(program) : null);
  const source = $derived(
    program && doc ? programSource(program, doc.derivations) : null,
  );
  const options = $derived(
    inspection.profile && doc
      ? sourceOptions(inspection.profile, docReport(doc.generator))
      : [],
  );
  const selectedOption = $derived(options.find((o) => o.path === source));
  const palette = $derived(resolvePalette(doc?.palette ?? { id: "blue" }));

  // Source data (for percentile ranges) and its extent for the sliders.
  function sourceData(path: string): ArrayLike<number> | undefined {
    const profile = getRawProfile();
    const f = profile ? resolveFeature(profile, path) : undefined;
    return f?.render === "continuous" ? f.data : undefined;
  }
  const extent = $derived.by(() => {
    tracks.version;
    if (!source || !inspection.profile) return [0, 1] as const;
    const f = resolveFeature(inspection.profile, source);
    return f?.render === "continuous" ? f.data_range : ([0, 1] as const);
  });
  const range = $derived(program ? brightnessRange(program) : null);
  const span = $derived(Math.max(1e-6, extent[1] - extent[0]));
  const floorT = $derived(range ? (range.floor - extent[0]) / span : 0);
  const peakT = $derived(range ? (range.peak - extent[0]) / span : 1);
  const smooth = $derived(program ? (smoothing(program) ?? 0) : 0);

  $effect(() => {
    // Candidate data feeds percentile ranges and the source list.
    if (mappingUi.editingProgram) requestCandidateTracks();
  });

  function snapshot(): { p: Program; d: MappingDoc } | null {
    if (!program || !doc) return null;
    return {
      p: $state.snapshot(program) as Program,
      d: $state.snapshot(doc) as MappingDoc,
    };
  }

  function rebuild(nextStyle: Style, path: string): void {
    const s = snapshot();
    const profile = getRawProfile();
    if (!s || !profile) return;
    const out = restyle(s.p, s.d.derivations, nextStyle, {
      path,
      data: sourceData(path),
      beatPeriodS: songContext(profile).beatPeriodS,
    });
    replaceProgram(out.program, out.derivations);
  }

  function setColor(hex: string): void {
    const s = snapshot();
    if (s) replaceProgram(withColor(s.p, hex));
  }

  function setRange(floor: number, peak: number): void {
    const s = snapshot();
    if (!s) return;
    replaceProgram(
      withRange(s.p, extent[0] + floor * span, extent[0] + peak * span),
    );
  }

  function setSmooth(windowS: number): void {
    const s = snapshot();
    if (s) replaceProgram(withSmoothing(s.p, windowS));
  }

  const MEASURE_KEYS = ["motion", "pulse", "alignment", "contrast", "visible"];
  function hueLabel(h: number): string {
    return `hue ${Math.round(h)}°`;
  }
</script>

{#if program}
  <section class="flex flex-col gap-3">
    <div class="flex items-center gap-2">
      <span
        class="h-5 w-5 shrink-0 rounded border border-edge"
        style:background={swatchCss(program)}
      ></span>
      <span class="text-base font-semibold">
        <EditableName
          value={programLabel(program)}
          onrename={(n) => renameProgram(program.id, n)}
        />
      </span>
    </div>

    <div class="flex flex-col gap-1">
      <p class="text-xs font-medium uppercase tracking-wide text-ink-faint">
        Source
      </p>
      <select
        value={source ?? ""}
        onchange={(e) =>
          rebuild(
            style ?? "glow",
            (e.currentTarget as HTMLSelectElement).value,
          )}
        class="rounded border border-edge bg-raised px-1.5 py-1 text-sm text-ink focus:border-accent focus:outline-none"
      >
        {#if !source}<option value="">Choose a source…</option>{/if}
        {#each options as o (o.path)}
          <option value={o.path}>
            {o.label}{o.score !== null
              ? ` · ${o.score.toFixed(2)}`
              : ""}{o.picked ? " ★" : ""}
          </option>
        {/each}
      </select>
      {#if selectedOption?.reason}
        <p class="text-xs text-ink-faint">
          {selectedOption.reason}
          {#each MEASURE_KEYS.filter((k) => k in selectedOption.measures) as k (k)}
            <span class="ml-2">{k} {selectedOption.measures[k].toFixed(2)}</span
            >
          {/each}
        </p>
      {/if}
    </div>

    <div class="flex flex-col gap-1">
      <p class="text-xs font-medium uppercase tracking-wide text-ink-faint">
        Style
      </p>
      <Segmented
        class="text-xs"
        options={STYLES.map((s) => ({
          label: STYLE_LABELS[s],
          active: style === s,
          onpick: () => source && rebuild(s, source),
          title: {
            glow: "Brightness follows the track",
            pulse: "Flash on each hit, fading over the beat",
            flash: "Short flash on each hit",
            strobe: "Strobe burst on each hit",
            chase: "Light runs along the strip at the track's speed",
          }[s],
        }))}
      />
      {#if style === null}
        <p class="text-xs text-ink-faint">
          Hand-built channels. Picking a style replaces them.
        </p>
      {/if}
    </div>

    <div class="flex flex-col gap-1">
      <p class="text-xs font-medium uppercase tracking-wide text-ink-faint">
        Color
      </p>
      <div class="flex items-center gap-1.5">
        {#each palette.colors as c, i (i)}
          <button
            onclick={() => setColor(c)}
            title="{palette.name} slot {i + 1}{palette.outlier === i
              ? ' (accent)'
              : ''}"
            class="h-6 w-6 rounded border {typeof program.channels.hue ===
              'number' && Math.abs(program.channels.hue - hexToOklch(c).h) < 0.5
              ? 'border-ink'
              : 'border-edge'}"
            style:background={c}
          ></button>
        {/each}
        <input
          type="color"
          title="Custom color"
          onchange={(e) =>
            setColor((e.currentTarget as HTMLInputElement).value)}
          class="h-6 w-7 cursor-pointer rounded border border-edge bg-transparent"
        />
        <span class="text-xs text-ink-faint">
          {typeof program.channels.hue === "number"
            ? hueLabel(program.channels.hue)
            : program.channels.hue
              ? "changes with sections"
              : "warm white"}
        </span>
      </div>
    </div>

    {#if hasContinuousBrightness(program)}
      <div
        class="grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-x-2 gap-y-1.5 text-xs"
      >
        <span class="text-ink-muted" title="Track level that maps to dark">
          Floor
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={floorT}
          onchange={(e) =>
            setRange(
              Number((e.currentTarget as HTMLInputElement).value),
              peakT,
            )}
        />
        <span class="text-right tabular-nums text-ink-faint">
          {floorT.toFixed(2)}
        </span>
        <span
          class="text-ink-muted"
          title="Track level that maps to full brightness"
        >
          Peak
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={peakT}
          onchange={(e) =>
            setRange(
              floorT,
              Number((e.currentTarget as HTMLInputElement).value),
            )}
        />
        <span class="text-right tabular-nums text-ink-faint">
          {peakT.toFixed(2)}
        </span>
        <span class="text-ink-muted" title="Moving-average window"
          >Smoothing</span
        >
        <input
          type="range"
          min="0"
          max="0.5"
          step="0.01"
          value={smooth}
          onchange={(e) =>
            setSmooth(Number((e.currentTarget as HTMLInputElement).value))}
        />
        <span class="text-right tabular-nums text-ink-faint">
          {Math.round(smooth * 1000)} ms
        </span>
      </div>
    {/if}
  </section>
{/if}
