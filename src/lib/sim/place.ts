// Where a dropped item lands: pure, so the drop rules are unit-tested
// without a renderer. Wall-mounted kinds (TV, shelf, strips, washers) snap
// against the wall they were dropped on (or the wall nearest a floor drop);
// everything else stands on the floor at the drop point.

import type { FixtureKind } from "$lib/showgen/types";
import {
  clamp,
  nearestWall,
  snapsToWall,
  wallPlacement,
  type V3,
  type Wall,
} from "$lib/sim/geometry";
import {
  defaultParams,
  FURNITURE_LABELS,
  furnitureSize,
  LIGHT_LABELS,
  nextItemId,
  type FurnitureType,
  type Room,
  type RoomItem,
} from "$lib/sim/room";

// What the item panel offers: a furniture type or a fixture kind.
export type PanelEntry =
  | { type: FurnitureType }
  | { type: "light"; kind: FixtureKind };

export interface DropHit {
  surface: "floor" | Wall;
  point: V3;
}

// Mount height for wall items dropped on the floor.
const WALL_HEIGHT: Partial<Record<string, number>> = {
  tv: 1.35,
  strip: 1.2,
  strip_curve: 1.2,
};

// Distance from the wall to an item's origin, by what is being placed.
function wallOffset(entry: PanelEntry, item: RoomItem): number {
  if (entry.type === "light") return entry.kind === "wash" ? 0.12 : 0.03;
  const [, , d] = furnitureSize(item);
  // The TV's origin is its center; floor furniture's is its footprint center.
  return d / 2 + 0.01;
}

export function placeItem(
  room: Room,
  entry: PanelEntry,
  hit: DropHit,
): RoomItem {
  const base = entry.type === "light" ? entry.kind : entry.type;
  const item: RoomItem = {
    id: nextItemId(room, base),
    type: entry.type,
    ...(entry.type === "light" ? { kind: entry.kind } : {}),
    name:
      entry.type === "light"
        ? LIGHT_LABELS[entry.kind]
        : FURNITURE_LABELS[entry.type],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    params: defaultParams(
      entry.type,
      entry.type === "light" ? entry.kind : undefined,
    ),
  };
  const { w, d, h } = room.size;
  const [x, y, z] = hit.point;
  if (snapsToWall({ type: item.type, kind: item.kind })) {
    const wall =
      hit.surface === "floor" ? nearestWall(room, x, z) : hit.surface;
    const along = wall === "back" || wall === "front" ? x : z;
    const floorDrop = hit.surface === "floor";
    // Washers and shelves stand on the floor against the wall.
    const onFloor = base === "wash" || base === "shelf";
    const height = onFloor ? 0 : floorDrop ? (WALL_HEIGHT[base] ?? 1.2) : y;
    const placed = wallPlacement(
      room,
      wall,
      along,
      height,
      wallOffset(entry, item),
    );
    item.position = placed.position;
    item.rotation = placed.rotation;
    return item;
  }
  // Floor items stand at the drop point; a wall drop lands at the wall's
  // foot. A PAR hangs just under the ceiling, aimed down.
  item.position = [
    clamp(x, -w / 2 + 0.2, w / 2 - 0.2),
    0,
    clamp(z, -d / 2 + 0.2, d / 2 - 0.2),
  ];
  if (entry.type === "light" && entry.kind === "par")
    item.position[1] = Math.min(h - 0.15, 2.4);
  return item;
}
