<script lang="ts">
  // Segmented option group: current state is the highlighted segment, so what
  // a click selects is always explicit (no toggle-label ambiguity).
  let {
    options,
    class: cls = "",
  }: {
    options: {
      label: string;
      active: boolean;
      onpick: () => void;
      title?: string;
    }[];
    class?: string;
  } = $props();
</script>

<div
  class="flex divide-x divide-edge overflow-hidden rounded-md border border-edge {cls}"
>
  {#each options as opt (opt.label)}
    <button
      onclick={opt.onpick}
      title={opt.title}
      class="flex-1 px-1 py-1 text-center {opt.active
        ? 'bg-raised font-medium text-ink'
        : 'text-ink-faint hover:text-ink'}"
    >
      {opt.label}
    </button>
  {/each}
</div>
