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

  let open = $state(true);
</script>

<DialogShell {title} bind:open {onclose}>
  <p class="mt-2 text-sm text-ink-muted">{body}</p>
  <div class="mt-4 flex justify-end gap-2">
    <button
      onclick={() => (open = false)}
      class="rounded border border-edge px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
    >
      Cancel
    </button>
    <button
      onclick={() => {
        onconfirm();
        open = false;
      }}
      title="This cannot be undone"
      class="rounded bg-danger px-3 py-1.5 text-sm font-medium text-surface hover:opacity-90"
    >
      Delete
    </button>
  </div>
</DialogShell>
