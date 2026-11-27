<script lang="ts">
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import EditableName from "$lib/components/EditableName.svelte";
  import {
    activeRoom,
    createRoom,
    duplicateRoom,
    removeActiveRoom,
    renameRoom,
    setActiveRoom,
    setRoomSize,
    sim,
  } from "$lib/state/sim.svelte";

  // Room picker and room-level actions: switch, create, duplicate, rename,
  // delete, and the room's dimensions.

  const room = $derived(activeRoom());
  let confirmDelete = $state(false);

  const DIMENSIONS = [
    { key: "w", label: "W" },
    { key: "d", label: "D" },
    { key: "h", label: "H" },
  ] as const;
</script>

<section class="flex flex-col gap-2 p-3">
  <div class="flex items-center justify-between">
    <p class="text-xs font-medium uppercase tracking-wide text-ink-faint">
      Room
    </p>
    <div class="flex gap-1">
      <button
        onclick={createRoom}
        title="Create an empty room"
        class="rounded border border-edge px-1.5 py-0.5 text-xs text-ink-muted hover:text-ink"
      >
        + New
      </button>
      <button
        onclick={duplicateRoom}
        disabled={!room}
        title="Copy this room"
        class="rounded border border-edge px-1.5 py-0.5 text-xs text-ink-muted hover:text-ink disabled:opacity-40"
      >
        Duplicate
      </button>
      <button
        onclick={() => (confirmDelete = true)}
        disabled={!room}
        title="Delete this room"
        class="rounded border border-edge px-1.5 py-0.5 text-xs text-ink-muted hover:text-danger disabled:opacity-40"
      >
        Delete
      </button>
    </div>
  </div>
  {#if sim.rooms.length > 1}
    <select
      value={sim.activeRoomId ?? ""}
      onchange={(e) => setActiveRoom(e.currentTarget.value)}
      class="rounded border border-edge bg-app px-1.5 py-1 text-sm"
    >
      {#each sim.rooms as r (r.id)}
        <option value={r.id}>{r.title}</option>
      {/each}
    </select>
  {/if}
  {#if room}
    <EditableName
      value={room.title}
      onrename={renameRoom}
      title="Rename room"
    />
    <div class="flex items-center gap-2 text-xs text-ink-muted">
      {#each DIMENSIONS as dim (dim.key)}
        <label class="flex items-center gap-1">
          {dim.label}
          <input
            type="number"
            min="2"
            max="20"
            step="0.1"
            value={room.size[dim.key]}
            onchange={(e) => {
              const v = Number(e.currentTarget.value);
              if (v >= 2 && v <= 20) setRoomSize({ [dim.key]: v });
            }}
            class="w-14 rounded border border-edge bg-app px-1 py-0.5 text-ink"
          />
        </label>
      {/each}
      <span class="text-ink-faint">m</span>
    </div>
  {:else if sim.roomsLoaded}
    <p class="text-sm text-ink-faint">No rooms. Create one.</p>
  {/if}
</section>

{#if confirmDelete && room}
  <ConfirmDialog
    title="Delete room"
    body={`Delete "${room.title}" and its layout?`}
    onconfirm={removeActiveRoom}
    onclose={() => (confirmDelete = false)}
  />
{/if}
