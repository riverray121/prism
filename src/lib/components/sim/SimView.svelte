<script lang="ts">
  import { onMount } from "svelte";

  import Inspector from "$lib/components/sim/Inspector.svelte";
  import ItemPanel from "$lib/components/sim/ItemPanel.svelte";
  import LightAssign from "$lib/components/sim/LightAssign.svelte";
  import RoomBar from "$lib/components/sim/RoomBar.svelte";
  import ResizablePanel from "$lib/components/shell/ResizablePanel.svelte";
  import Segmented from "$lib/components/shell/Segmented.svelte";
  import type { MappingDoc } from "$lib/mapping/schema";
  import {
    evaluateForLights,
    sampleLights,
    type OutputsByPixels,
  } from "$lib/showgen/lightstate";
  import { createSimEditor, type SimEditor } from "$lib/sim/editor";
  import { placeItem } from "$lib/sim/place";
  import {
    FURNITURE_LABELS,
    LIGHT_LABELS,
    roomLights,
    type Room,
  } from "$lib/sim/room";
  import { createSimScene, type SimScene } from "$lib/sim/scene";
  import { getRawProfile, inspection } from "$lib/state/inspection.svelte";
  import {
    activeRoom,
    activeShow,
    addItem,
    ensureRoomShow,
    ensureRoomsLoaded,
    ensureSimForSong,
    selectItem,
    setGizmo,
    sim,
    startDrag,
    updateItem,
  } from "$lib/state/sim.svelte";
  import { tracks } from "$lib/state/tracks.svelte";
  import { transport } from "$lib/state/transport.svelte";
  import {
    PANEL_MAX_WIDTH,
    PANEL_MIN_WIDTH,
    workspace,
  } from "$lib/state/workspace.svelte";

  // The Sim tab: a 3D room of simulated fixtures. The left panel edits the
  // room and which program drives each light; the view renders the open
  // song's room show at the transport clock.

  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let scene: SimScene | null = null;
  let editor: SimEditor | null = null;
  let pointer = $state<{ x: number; y: number } | null>(null);

  const room = $derived(activeRoom());
  const show = $derived(activeShow());

  onMount(() => {
    ensureRoomsLoaded();
  });

  // Follow the open song: load its room shows, and generate one for the
  // active room when missing (once every track is in).
  $effect(() => {
    ensureSimForSong(inspection.songId);
  });
  $effect(() => {
    tracks.version;
    inspection.profile;
    sim.doc;
    sim.activeRoomId;
    ensureRoomShow();
  });

  // Evaluated program outputs for the room show, per pixel count. Rebuilt
  // when the show, the room's lights or the loaded tracks change.
  const lights = $derived(
    room ? roomLights($state.snapshot(room) as Room) : [],
  );
  let outputs: OutputsByPixels | null = null;
  let showSnapshot: MappingDoc | null = null;
  $effect(() => {
    tracks.version;
    const profile = getRawProfile();
    inspection.profile;
    const doc = show ? ($state.snapshot(show) as MappingDoc) : null;
    showSnapshot = doc;
    outputs = profile && doc ? evaluateForLights(profile, doc, lights) : null;
  });

  // Scene lifecycle: create on mount, rebuild on room edits.
  $effect(() => {
    if (!room) return;
    const snapshot = $state.snapshot(room) as Room;
    if (!scene) {
      scene = createSimScene(canvas, snapshot, {
        pixelRatio: Math.min(2, globalThis.devicePixelRatio ?? 1),
      });
      editor = createSimEditor(scene, {
        onSelect: (id) => selectItem(id),
        onTransform: (id, position, rotation) =>
          updateItem(id, { position, rotation }),
      });
      resize();
    } else {
      scene.setRoom(snapshot);
    }
    editor?.refresh();
  });

  $effect(() => {
    editor?.setSelected(sim.selectedItemId);
  });
  $effect(() => {
    editor?.setMode(sim.gizmo);
  });

  // A switch to another room re-frames the camera on that room's view.
  let framedRoom: string | null = null;
  $effect(() => {
    const id = sim.activeRoomId;
    if (editor && id !== framedRoom) {
      framedRoom = id;
      editor.resetView();
    }
  });

  function resize(): void {
    if (!scene) return;
    const r = host.getBoundingClientRect();
    scene.resize(r.width, r.height);
  }

  onMount(() => {
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    let raf = requestAnimationFrame(function loop() {
      raf = requestAnimationFrame(loop);
      if (!scene) return;
      editor?.update();
      const profile = getRawProfile();
      const t = transport.currentTime;
      if (profile && showSnapshot && outputs) {
        const bpm =
          profile.mix.bpm?.render === "scalar"
            ? Number(profile.mix.bpm.value)
            : 120;
        scene.setLightStates(
          sampleLights(profile, showSnapshot, outputs, lights, t),
          t,
          bpm,
        );
      } else {
        scene.setLightStates(new Map(), t, 120);
      }
      scene.render();
    });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      editor?.dispose();
      scene?.dispose();
      editor = null;
      scene = null;
    };
  });

  // Panel drag: the ghost follows the mouse; releasing over the room view
  // places the item where the pointer is.
  function onMove(e: MouseEvent): void {
    if (sim.dragging) pointer = { x: e.clientX, y: e.clientY };
  }

  function onUp(e: MouseEvent): void {
    const entry = sim.dragging;
    if (!entry) return;
    startDrag(null);
    pointer = null;
    if (!room || !editor) return;
    const r = host.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      return;
    const hit = editor.surfaceAt(e.clientX, e.clientY);
    if (!hit) return;
    addItem(
      placeItem($state.snapshot(room) as Room, $state.snapshot(entry), hit),
    );
  }

  function onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "SELECT"))
      return;
    if (workspace.tab !== "sim" && workspace.splitTab !== "sim") return;
    if (e.key === "Escape") selectItem(null);
    if (e.key === "g") setGizmo("translate");
    if (e.key === "r") setGizmo("rotate");
  }
</script>

<svelte:window onmousemove={onMove} onmouseup={onUp} onkeydown={onKey} />

<div class="flex h-full">
  <ResizablePanel
    bind:width={workspace.simPanelWidth}
    min={PANEL_MIN_WIDTH}
    max={PANEL_MAX_WIDTH}
  >
    <div class="flex h-bar shrink-0 items-center px-3">
      <span class="text-base font-semibold">Simulator</span>
    </div>
    <RoomBar />
    <LightAssign />
    <ItemPanel />
  </ResizablePanel>
  <main class="relative min-h-0 min-w-0 flex-1 bg-black">
    <div bind:this={host} class="absolute inset-0">
      <canvas bind:this={canvas} class="block h-full w-full"></canvas>
    </div>
    {#if room}
      <div class="absolute top-3 left-3 flex items-center gap-2 text-xs">
        <Segmented
          class="w-36 bg-surface/90"
          options={[
            {
              label: "Move",
              active: sim.gizmo === "translate",
              onpick: () => setGizmo("translate"),
              title: "Move the selected item (G)",
            },
            {
              label: "Rotate",
              active: sim.gizmo === "rotate",
              onpick: () => setGizmo("rotate"),
              title: "Turn the selected item (R)",
            },
          ]}
        />
        <button
          onclick={() => editor?.resetView()}
          title="Back to the room's saved view"
          class="rounded-md border border-edge bg-surface/90 px-2 py-1 text-ink-muted hover:text-ink"
        >
          Reset view
        </button>
      </div>
      <Inspector />
    {:else if sim.roomsLoaded}
      <p
        class="absolute inset-0 flex items-center justify-center text-sm text-ink-faint"
      >
        Create a room to start.
      </p>
    {/if}
  </main>
</div>

{#if sim.dragging && pointer}
  <div
    class="pointer-events-none fixed z-50 rounded border border-accent bg-surface px-2 py-1 text-xs text-ink shadow-lg"
    style="left: {pointer.x + 12}px; top: {pointer.y + 8}px"
  >
    {sim.dragging.type === "light"
      ? LIGHT_LABELS[sim.dragging.kind]
      : FURNITURE_LABELS[sim.dragging.type]}
  </div>
{/if}
