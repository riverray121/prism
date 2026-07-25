<script lang="ts">
  import { Tooltip } from "bits-ui";

  import LibraryPanel from "$lib/components/LibraryPanel.svelte";
  import ProgressRing from "$lib/components/shell/ProgressRing.svelte";
  import { library } from "$lib/state/library.svelte";
  import {
    setSidebarWidth,
    toggleSidebar,
    workspace,
  } from "$lib/state/workspace.svelte";

  // Songs with analysis in flight — the collapsed rail keeps them glanceable.
  const inFlight = $derived(
    library.songs.filter(
      (s) => s.status === "queued" || s.status === "analyzing",
    ),
  );

  // Coarse fraction from the engine step counter; null (static arc) until the
  // worker reports steps, and always null while merely queued.
  function fractionOf(song: (typeof library.songs)[number]): number | null {
    if (song.status !== "analyzing") return null;
    return song.current_step && song.total_steps
      ? song.current_step / song.total_steps
      : null;
  }

  // Edge-drag resize. Pointer capture keeps the drag alive when the cursor
  // leaves the thin handle; the sidebar sits at x=0, so clientX is the width.
  let resizing = $state(false);

  function startResize(e: PointerEvent): void {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizing = true;
  }

  function moveResize(e: PointerEvent): void {
    if (resizing) setSidebarWidth(e.clientX);
  }

  function endResize(): void {
    resizing = false;
  }
</script>

<aside
  class="relative flex shrink-0 border-r border-edge bg-surface {workspace.sidebarExpanded
    ? ''
    : 'w-10'}"
  style={workspace.sidebarExpanded
    ? `width: ${workspace.sidebarWidth}px`
    : undefined}
>
  <!-- The toggle occupies the same slot in both states — leftmost in a
       header-height row — so collapsing/expanding never moves it. -->
  {#if workspace.sidebarExpanded}
    <div class="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div class="flex h-bar shrink-0 items-center gap-2 px-1">
        <button
          onclick={toggleSidebar}
          title="Collapse the library sidebar"
          class="rounded px-2 py-1.5 text-xl leading-none text-ink-muted hover:bg-raised hover:text-ink"
        >
          «
        </button>
        <span class="text-base font-semibold">Library</span>
      </div>
      <div class="flex flex-col gap-6 px-3 pb-6">
        <LibraryPanel />
      </div>
    </div>
  {:else}
    <div class="flex flex-1 flex-col">
      <Tooltip.Provider delayDuration={300}>
        <div class="flex h-bar shrink-0 items-center px-1">
          <Tooltip.Root>
            <Tooltip.Trigger
              onclick={toggleSidebar}
              title="Expand the library sidebar"
              class="rounded px-2 py-1.5 text-xl leading-none text-ink-muted hover:bg-raised hover:text-ink"
            >
              »
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="right"
                sideOffset={6}
                class="rounded border border-edge bg-raised px-2 py-1 text-xs text-ink"
              >
                Expand library
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </div>

        <!-- One ring per queued/analyzing song; queued shows a static arc. -->
        <div class="mt-1 flex flex-col items-center gap-2">
          {#each inFlight as song (song.id)}
            <Tooltip.Root>
              <Tooltip.Trigger
                class={song.status === "queued" ? "opacity-40" : ""}
              >
                <ProgressRing fraction={fractionOf(song)} />
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  side="right"
                  sideOffset={6}
                  class="rounded border border-edge bg-raised px-2 py-1 text-xs text-ink"
                >
                  {song.title} — {song.status}
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          {/each}
        </div>
      </Tooltip.Provider>
    </div>
  {/if}

  {#if workspace.sidebarExpanded}
    <!-- Drag handle straddling the right border; wider hit area than the 1px
         edge it visually is, highlighted while hovered or dragging. -->
    <div
      role="separator"
      aria-orientation="vertical"
      onpointerdown={startResize}
      onpointermove={moveResize}
      onpointerup={endResize}
      onpointercancel={endResize}
      class="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none {resizing
        ? 'bg-accent/40'
        : 'hover:bg-accent/25'}"
    ></div>
  {/if}
</aside>
