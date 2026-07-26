<script lang="ts">
  import { Dialog } from "bits-ui";
  import type { Snippet } from "svelte";

  // Shared modal chrome: dimmed overlay + centered titled panel. Body markup
  // comes from the caller; esc/overlay dismissal reports through onclose.
  let {
    title,
    onclose,
    width = "w-96",
    children,
  }: {
    title: string;
    onclose: () => void;
    width?: string; // Tailwind width class for the panel
    children: Snippet;
  } = $props();
</script>

<Dialog.Root open onOpenChange={(o) => !o && onclose()}>
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
