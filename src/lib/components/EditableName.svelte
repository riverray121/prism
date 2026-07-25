<script lang="ts">
  // Inline-editable display name: click the name (or the pencil that appears
  // on hover) to edit; Enter or clicking anywhere else commits, Escape
  // cancels. The owner decides what an empty commit means (usually: reset to
  // the default name).
  let {
    value,
    onrename,
    title = "Rename",
  }: {
    value: string;
    onrename: (name: string) => void;
    title?: string;
  } = $props();

  let editing = $state(false);
  let draft = $state("");
  let input = $state<HTMLInputElement | undefined>();

  function start(): void {
    draft = value;
    editing = true;
  }

  function commit(): void {
    if (!editing) return;
    editing = false;
    onrename(draft);
  }

  // Focus the input as soon as it mounts (it only exists while editing).
  $effect(() => {
    input?.select();
  });
</script>

{#if editing}
  <input
    bind:this={input}
    value={draft}
    oninput={(e) => (draft = e.currentTarget.value)}
    onblur={commit}
    onkeydown={(e) => {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") editing = false;
    }}
    class="rounded border border-edge bg-app px-1.5 py-0.5 text-base font-medium focus:border-accent focus:outline-none"
  />
{:else}
  <button
    onclick={start}
    {title}
    class="group flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-base font-medium hover:bg-raised"
  >
    <span class="truncate">{value}</span>
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      class="shrink-0 text-ink-faint opacity-0 group-hover:opacity-100"
    >
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </svg>
  </button>
{/if}
