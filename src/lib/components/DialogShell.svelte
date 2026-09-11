<script lang="ts">
  import { Dialog } from "bits-ui";
  import type { Snippet } from "svelte";

  // Shared modal chrome: dimmed overlay + centered titled panel. Body markup
  // comes from the caller. Every close, esc/overlay or the caller's own,
  // reports through onclose only after the dialog has flipped `open` false,
  // so its layers (focus trap, body pointer-events lock) tear down in order
  // before the caller unmounts it. Callers close by setting `open` false,
  // never by unmounting an open dialog.
  let {
    title,
    onclose,
    open = $bindable(true),
    width = "w-96",
    children,
  }: {
    title: string;
    onclose: () => void;
    open?: boolean;
    width?: string; // Tailwind width class for the panel
    children: Snippet;
  } = $props();
</script>

<Dialog.Root bind:open onOpenChange={(o) => !o && onclose()}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
    <Dialog.Content
      class="fixed left-1/2 top-1/2 z-50 {width} max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-md border border-edge bg-surface p-4 shadow-lg"
    >
      <Dialog.Title class="text-sm font-semibold">{title}</Dialog.Title>
      {@render children()}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
