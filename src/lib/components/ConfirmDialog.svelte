<script lang="ts">
  import DialogShell from "$lib/components/DialogShell.svelte";

  // Small are-you-sure gate for destructive actions.
  let {
    title,
    body,
    onconfirm,
    onclose,
  }: {
    title: string;
    body: string;
    onconfirm: () => void;
    onclose: () => void;
  } = $props();
</script>

<DialogShell {title} {onclose}>
  <p class="mt-2 text-sm text-ink-muted">{body}</p>
  <div class="mt-4 flex justify-end gap-2">
    <button
      onclick={onclose}
      class="rounded border border-edge px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
    >
      Cancel
    </button>
    <button
      onclick={() => {
        onconfirm();
        onclose();
      }}
      title="This cannot be undone"
      class="rounded bg-danger px-3 py-1.5 text-sm font-medium text-surface hover:opacity-90"
    >
      Delete
    </button>
  </div>
</DialogShell>
