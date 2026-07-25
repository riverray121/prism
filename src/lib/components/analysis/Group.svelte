<script lang="ts">
  import type { Snippet } from "svelte";

  // Collapsible section of the analysis feature list. Collapsed groups render
  // no children at all, so folded lanes cost nothing.
  //
  // Visual hierarchy: a filled full-width header bar per group (largest at the
  // top level, stepping down with depth) and a left rail along the open body,
  // so where a section starts and ends reads at a glance.
  let {
    label,
    detail = "",
    depth = 0,
    open,
    ontoggle,
    children,
  }: {
    label: string;
    detail?: string; // dimmed suffix (counts, units)
    depth?: number; // nesting level, indents the header
    open: boolean;
    ontoggle: () => void;
    children: Snippet;
  } = $props();

  // Header text steps down with nesting so levels are tellable apart.
  const LABEL_SIZE = ["text-base", "text-sm", "text-sm"];
  const labelSize = $derived(LABEL_SIZE[Math.min(depth, 2)]);
</script>

<div class="flex flex-col" style:margin-left={`${depth * 1}rem`}>
  <button
    onclick={ontoggle}
    class="group flex w-full items-center gap-2.5 rounded-md bg-raised px-3 py-2 text-left hover:bg-edge/60"
  >
    <!-- One chevron glyph, rotated when open — no size change between states. -->
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="size-4 shrink-0 text-ink-faint transition-transform duration-150 group-hover:text-ink {open
        ? 'rotate-90'
        : ''}"
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
    <span class="{labelSize} font-semibold text-ink">{label}</span>
    {#if detail}
      <span
        class="ml-auto rounded-full bg-app px-2 py-0.5 text-xs text-ink-muted"
      >
        {detail}
      </span>
    {/if}
  </button>
  {#if open}
    <div
      class="mb-2 ml-4 mt-3 flex flex-col gap-7 border-l-2 border-edge pb-1 pl-5"
    >
      {@render children()}
    </div>
  {/if}
</div>
