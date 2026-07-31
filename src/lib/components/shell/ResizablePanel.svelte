<script lang="ts">
  import type { Snippet } from "svelte";

  // Left-docked side panel with a drag-resizable right edge. Owns the drag
  // mechanics and width clamping; the caller owns the width state (bindable)
  // so it can persist or share it.
  let {
    width = $bindable(),
    min = 240,
    max = 800,
    children,
  }: {
    width: number;
    min?: number;
    max?: number;
    children: Snippet;
  } = $props();

  let panel: HTMLElement;

  // Edge-drag resize on MOUSE events (this webview can drop pointer events;
  // mouse events are what every working control runs on). The drag tracks on
  // window so it stays alive when the cursor leaves the thin handle.
  let resizing = $state(false);

  function moveResize(e: MouseEvent): void {
    if (!resizing) return;
    const left = panel.getBoundingClientRect().left;
    width = Math.min(max, Math.max(min, e.clientX - left));
  }

  function endResize(): void {
    resizing = false;
    globalThis.removeEventListener("mousemove", moveResize);
    globalThis.removeEventListener("mouseup", endResize);
  }

  function startResize(e: MouseEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    resizing = true;
    globalThis.addEventListener("mousemove", moveResize);
    globalThis.addEventListener("mouseup", endResize);
  }

  // A drag in progress when the panel unmounts must not leave window
  // listeners behind.
  $effect(() => () => endResize());
</script>

<aside
  bind:this={panel}
  class="relative flex shrink-0 flex-col border-r border-edge bg-surface"
  style="width: {width}px"
>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
    {@render children()}
  </div>

  <!-- Drag handle straddling the right border; wider hit area than the 1px
       edge it visually is, highlighted while hovered or dragging. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    role="separator"
    aria-orientation="vertical"
    onmousedown={startResize}
    class="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none {resizing
      ? 'bg-accent/40'
      : 'hover:bg-accent/25'}"
  ></div>
</aside>
