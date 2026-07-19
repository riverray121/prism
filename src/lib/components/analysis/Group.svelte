<script lang="ts">
  import type { Snippet } from "svelte";

  // Collapsible section of the analysis feature list. Collapsed groups render
  // no children at all, so folded lanes cost nothing.
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
</script>

<div class="flex flex-col">
  <button
    onclick={ontoggle}
    class="flex items-center gap-2 py-1.5 text-left text-base text-ink-muted hover:text-ink"
    style:padding-left={`${depth * 0.75}rem`}
  >
    <span class="w-5 text-lg leading-none text-ink-faint">
      {open ? "▾" : "▸"}
    </span>
    <span class="font-medium">{label}</span>
    {#if detail}
      <span class="text-xs text-ink-faint">{detail}</span>
    {/if}
  </button>
  {#if open}
    <div
      class="flex flex-col gap-3 pb-2"
      style:padding-left={`${depth * 0.75 + 1.25}rem`}
    >
      {@render children()}
    </div>
  {/if}
</div>
