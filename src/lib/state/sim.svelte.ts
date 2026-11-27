import { deleteRoom, getSim, listRooms, saveRoom, updateSim } from "$lib/ipc";
import type { ContinuousFeature, MixFeature, Profile } from "$lib/ipc/messages";
import type { MappingDoc } from "$lib/mapping/schema";
import { DEFAULT_PALETTE } from "$lib/showgen/palettes";
import { DEFAULT_ALGORITHM, generateShow } from "$lib/showgen/registry";
import type { PaletteRef } from "$lib/showgen/types";
import type { GizmoMode } from "$lib/sim/editor";
import type { PanelEntry } from "$lib/sim/place";
import {
  emptyRoom,
  RoomSchema,
  roomLights,
  type Room,
  type RoomItem,
} from "$lib/sim/room";
import {
  assignProgram,
  pruneShow,
  showFromResult,
  type SimDoc,
} from "$lib/sim/show";
import {
  getRawProfile,
  inspection,
  requestFeatureTrack,
} from "$lib/state/inspection.svelte";
import { mapping } from "$lib/state/mapping.svelte";
import { tracksPending } from "$lib/state/tracks.svelte";
import demoRoom from "../../../lab/rooms/demo-room.json";

// Simulator state: the saved rooms, the active one, and the open song's room
// shows. Rooms and room shows are edited locally and written through; the
// sidecar's echoes only seed the first load, so a late echo can never undo a
// newer local edit.

export const sim = $state<{
  rooms: Room[];
  roomsLoaded: boolean;
  activeRoomId: string | null;
  // The song whose room shows `doc` holds; null when no song is open.
  songId: string | null;
  doc: SimDoc | null;
  selectedItemId: string | null;
  gizmo: GizmoMode;
  // An item being dragged from the panel toward the room.
  dragging: PanelEntry | null;
  // Choices for the next Regenerate.
  algorithm: string;
  palette: PaletteRef;
  error: string | null;
}>({
  rooms: [],
  roomsLoaded: false,
  activeRoomId: null,
  songId: null,
  doc: null,
  selectedItemId: null,
  gizmo: "translate",
  dragging: null,
  algorithm: DEFAULT_ALGORITHM,
  palette: DEFAULT_PALETTE,
  error: null,
});

const ACTIVE_ROOM_KEY = "prism.sim.activeRoom";

export function activeRoom(): Room | null {
  return sim.rooms.find((r) => r.id === sim.activeRoomId) ?? null;
}

// ── Rooms ───────────────────────────────────────────────────────────────────

let roomsRequested = false;

export function ensureRoomsLoaded(): void {
  if (roomsRequested) return;
  roomsRequested = true;
  void listRooms();
}

// The first `rooms` event seeds the list (and a starter room when there are
// none); later echoes are ignored because local state is authoritative.
export function applyRoomsEvent(rooms: unknown[]): void {
  if (sim.roomsLoaded) return;
  const parsed: Room[] = [];
  for (const r of rooms) {
    const result = RoomSchema.safeParse(r);
    if (result.success) parsed.push(result.data);
    else console.warn("malformed room skipped", r, result.error);
  }
  sim.rooms = parsed;
  sim.roomsLoaded = true;
  if (parsed.length === 0) {
    const starter = RoomSchema.parse({
      ...demoRoom,
      id: "living-room",
      title: "Living room",
    });
    sim.rooms = [starter];
    void saveRoom(starter);
  }
  const saved = globalThis.localStorage?.getItem(ACTIVE_ROOM_KEY) ?? null;
  sim.activeRoomId = sim.rooms.some((r) => r.id === saved)
    ? saved
    : (sim.rooms[0]?.id ?? null);
}

export function setActiveRoom(id: string): void {
  sim.activeRoomId = id;
  sim.selectedItemId = null;
  globalThis.localStorage?.setItem(ACTIVE_ROOM_KEY, id);
}

function newRoomId(): string {
  return `room-${Date.now().toString(36)}`;
}

function commitRoom(room: Room): void {
  void saveRoom($state.snapshot(room));
}

function editRoom(mutate: (room: Room) => void): void {
  const room = activeRoom();
  if (!room) return;
  mutate(room);
  commitRoom(room);
}

export function createRoom(): void {
  const room = emptyRoom(newRoomId(), "New room");
  sim.rooms.push(room);
  commitRoom(room);
  setActiveRoom(room.id);
}

export function duplicateRoom(): void {
  const room = activeRoom();
  if (!room) return;
  const copy: Room = {
    ...structuredClone($state.snapshot(room)),
    id: newRoomId(),
    title: `${room.title} copy`,
  };
  sim.rooms.push(copy);
  commitRoom(copy);
  setActiveRoom(copy.id);
}

export function removeActiveRoom(): void {
  const room = activeRoom();
  if (!room) return;
  sim.rooms = sim.rooms.filter((r) => r.id !== room.id);
  void deleteRoom(room.id);
  if (sim.doc?.rooms[room.id]) {
    delete sim.doc.rooms[room.id];
    commitSim();
  }
  const next = sim.rooms[0];
  if (next) setActiveRoom(next.id);
  else sim.activeRoomId = null;
}

export function renameRoom(title: string): void {
  const trimmed = title.trim();
  if (!trimmed) return;
  editRoom((r) => {
    r.title = trimmed;
  });
}

export function setRoomSize(size: Partial<Room["size"]>): void {
  editRoom((r) => {
    r.size = { ...r.size, ...size };
  });
}

export function addItem(item: RoomItem): void {
  editRoom((r) => {
    r.items.push(item);
  });
  sim.selectedItemId = item.id;
}

export function updateItem(
  id: string,
  patch: Partial<Omit<RoomItem, "id">>,
): void {
  editRoom((r) => {
    const it = r.items.find((x) => x.id === id);
    if (!it) return;
    Object.assign(it, patch);
  });
}

export function updateItemParams(
  id: string,
  params: Partial<RoomItem["params"]>,
): void {
  editRoom((r) => {
    const it = r.items.find((x) => x.id === id);
    if (!it) return;
    it.params = { ...it.params, ...params };
  });
}

export function removeItem(id: string): void {
  editRoom((r) => {
    r.items = r.items.filter((x) => x.id !== id);
  });
  if (sim.selectedItemId === id) sim.selectedItemId = null;
  pruneActiveShow();
}

export function selectItem(id: string | null): void {
  sim.selectedItemId = id;
}

export function startDrag(entry: PanelEntry | null): void {
  sim.dragging = entry;
}

export function setGizmo(mode: GizmoMode): void {
  sim.gizmo = mode;
}

// ── Room shows ──────────────────────────────────────────────────────────────

// Point the store at the open song (null = none); requests its room shows.
export function ensureSimForSong(songId: string | null): void {
  if (songId === sim.songId) return;
  sim.songId = songId;
  sim.doc = null;
  sim.error = null;
  if (songId !== null) void getSim(songId);
}

export function applySimEvent(songId: string, doc: SimDoc): void {
  if (songId !== sim.songId || sim.doc !== null) return;
  sim.doc = doc;
}

function commitSim(): void {
  if (sim.songId === null || sim.doc === null) return;
  void updateSim(sim.songId, $state.snapshot(sim.doc));
}

export function activeShow(): MappingDoc | null {
  const room = activeRoom();
  if (!room || !sim.doc) return null;
  return sim.doc.rooms[room.id] ?? null;
}

// Every continuous feature envelope in a profile: mix, stems, drum sub-stems.
function continuousFeatures(profile: Profile): ContinuousFeature[] {
  const out: ContinuousFeature[] = [];
  const scan = (features: Record<string, MixFeature>) => {
    for (const f of Object.values(features))
      if (f.render === "continuous") out.push(f);
  };
  scan(profile.mix);
  for (const engineStems of Object.values(profile.stems))
    for (const stem of Object.values(engineStems)) {
      scan(stem.features);
      for (const sub of Object.values(stem.substems ?? {})) scan(sub.features);
    }
  return out;
}

// A streamable envelope still waiting for its .npy data.
function unloaded(f: ContinuousFeature): boolean {
  return !f.data && f.sidecar !== undefined;
}

// Show algorithms read every candidate track: request any not yet loaded and
// report whether all are in. requestTrack marks a load pending synchronously,
// so nothing pending right after the requests means the remaining tracks
// cannot load (failed earlier); generation then proceeds without them
// rather than waiting forever.
export function allTracksLoaded(): boolean {
  const proxy = inspection.profile;
  const raw = getRawProfile();
  if (!proxy || !raw) return false;
  if (!continuousFeatures(raw).some(unloaded)) return true;
  for (const f of continuousFeatures(proxy))
    if (unloaded(f)) requestFeatureTrack(f);
  return tracksPending() === 0;
}

// Generate the active room's show with the chosen algorithm and palette,
// replacing any existing one.
export function regenerate(): void {
  const room = activeRoom();
  const profile = getRawProfile();
  if (!room || !profile || !sim.doc) return;
  try {
    const palette = $state.snapshot(sim.palette) as PaletteRef;
    const result = generateShow(sim.algorithm, {
      profile,
      lights: roomLights($state.snapshot(room) as Room),
      palette,
    });
    sim.doc.rooms[room.id] = showFromResult(result, palette, sim.algorithm);
    sim.error = null;
    commitSim();
  } catch (e) {
    console.error("show generation failed", e);
    sim.error = e instanceof Error ? e.message : String(e);
  }
}

// A room without a show for the open song gets one generated as soon as the
// song's tracks are loaded. Called from the Sim view's effect.
// A room with no lights gets no show; a show with no programs (generated
// while the room was empty) counts as missing, so adding lights fills it.
export function ensureRoomShow(): void {
  const room = activeRoom();
  if (!room || !sim.doc) return;
  if (roomLights($state.snapshot(room) as Room).length === 0) return;
  const show = sim.doc.rooms[room.id];
  if (show && show.programs.length > 0) return;
  if (!allTracksLoaded()) return;
  regenerate();
}

export function assignLight(lightId: string, programId: string | null): void {
  const room = activeRoom();
  const show = activeShow();
  if (!room || !show || !sim.doc) return;
  const hardware = mapping.doc
    ? ($state.snapshot(mapping.doc) as MappingDoc)
    : null;
  sim.doc.rooms[room.id] = assignProgram(
    $state.snapshot(show) as MappingDoc,
    lightId,
    programId,
    hardware,
  );
  commitSim();
}

function pruneActiveShow(): void {
  const room = activeRoom();
  const show = activeShow();
  if (!room || !show || !sim.doc) return;
  const ids = new Set(roomLights(room).map((l) => l.id));
  sim.doc.rooms[room.id] = pruneShow($state.snapshot(show) as MappingDoc, ids);
  commitSim();
}
