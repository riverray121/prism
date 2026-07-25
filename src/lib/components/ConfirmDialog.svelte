<script lang="ts">
  import { Dialog } from "bits-ui";

  // Small are-you-sure gate for destructive actions.
  let {
    title,
    body,
    confirmLabel = "Delete",
    onconfirm,
    onclose,
  }: {
    title: string;
    body: string;
    confirmLabel?: string;
    onconfirm: () => void;
    onclose: () => void;
  } = $props();
</script>

<Dialog.Root open onOpenChange={(o) => !o && onclose()}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
    <Dialog.Content
      class="fixed left-1/2 top-1/2 z-50 w-96 max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-md border border-edge bg-surface p-4 shadow-lg"
    >
      <Dialog.Title class="text-sm font-semibold">{title}</Dialog.Title>
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
          {confirmLabel}
        </button>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
