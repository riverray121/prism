// Simulator room model: a rectangular room with placed furniture and light
// fixtures, stored as library/rooms/{id}.json (sidecar/rooms.py).
//
// Coordinates are meters. The origin is the floor's center; x runs right,
// y up, z toward the viewer. The back wall (where a TV usually hangs) is at
// z = -d/2. Rotations are Euler XYZ in radians.

import { z } from "zod";

import {
  FIXTURE_KINDS,
  PIXEL_KINDS,
  type FixtureKind,
  type LightSpec,
} from "$lib/showgen/types";

export const FURNITURE_TYPES = [
  "sofa",
  "tv_stand",
  "tv",
  "table",
  "shelf",
  "bed",
  "plant",
] as const;
export type FurnitureType = (typeof FURNITURE_TYPES)[number];

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

// Strip shapes: a straight line along local x, a rectangle outline in the
// local x/y plane (a TV backlight), or an arc in the local x/z plane.
export const STRIP_SHAPES = ["line", "rect", "arc"] as const;
// Direction a fixture's LEDs or beam face, in its local frame.
export const FACINGS = ["front", "back", "up", "down"] as const;

export const ItemParamsSchema = z
  .object({
    // Lights.
    pixelCount: z.number().int().positive().optional(),
    length: z.number().positive().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    depth: z.number().positive().optional(),
    radius: z.number().positive().optional(),
    // Arc sweep in degrees, for curved strips.
    arc: z.number().positive().optional(),
    beamAngle: z.number().positive().optional(),
    shape: z.enum(STRIP_SHAPES).optional(),
    facing: z.enum(FACINGS).optional(),
    // Furniture body color as hex.
    color: z.string().optional(),
  })
  .default({});
export type ItemParams = z.infer<typeof ItemParamsSchema>;

export const RoomItemSchema = z.object({
  id: z.string(),
  type: z.enum([...FURNITURE_TYPES, "light"]),
  // Set when type is "light".
  kind: z.enum(FIXTURE_KINDS).optional(),
  name: z.string().optional(),
  position: Vec3,
  rotation: Vec3.default([0, 0, 0]),
  params: ItemParamsSchema,
});
export type RoomItem = z.infer<typeof RoomItemSchema>;

export const RoomSchema = z.object({
  id: z.string(),
  title: z.string(),
  size: z.object({
    w: z.number().positive(),
    d: z.number().positive(),
    h: z.number().positive(),
  }),
  items: z.array(RoomItemSchema).default([]),
  // Default camera: eye position and look-at target.
  camera: z.object({ position: Vec3, target: Vec3 }).optional(),
});
export type Room = z.infer<typeof RoomSchema>;

export const LIGHT_LABELS: Record<FixtureKind, string> = {
  strip: "LED strip",
  strip_curve: "Curved LED strip",
  tube: "LED tube",
  wash: "Wall washer",
  par: "PAR spot",
  strobe: "Strobe",
  lamp: "Lamp",
  moving_head: "Moving head",
};

export const FURNITURE_LABELS: Record<FurnitureType, string> = {
  sofa: "Sofa",
  tv_stand: "TV stand",
  tv: "TV",
  table: "Table",
  shelf: "Shelf",
  bed: "Bed",
  plant: "Plant",
};

// Parameters a new item starts with, per kind/type.
export function defaultParams(
  type: RoomItem["type"],
  kind?: FixtureKind,
): ItemParams {
  if (type === "light") {
    switch (kind) {
      case "strip":
        return { pixelCount: 60, length: 1, shape: "line", facing: "front" };
      case "strip_curve":
        return {
          pixelCount: 60,
          radius: 0.6,
          arc: 180,
          shape: "arc",
          facing: "front",
        };
      case "tube":
        return { pixelCount: 48, length: 1.2 };
      case "wash":
        return { beamAngle: 40, facing: "up" };
      case "par":
        return { beamAngle: 25, facing: "down" };
      case "moving_head":
        return { beamAngle: 14 };
      default:
        return {};
    }
  }
  return {};
}

// Furniture body sizes (w × h × d meters) before any params override.
export const FURNITURE_SIZE: Record<FurnitureType, [number, number, number]> = {
  sofa: [2.1, 0.85, 0.9],
  tv_stand: [1.8, 0.5, 0.42],
  tv: [1.45, 0.83, 0.06],
  table: [1.1, 0.45, 0.6],
  shelf: [0.9, 1.8, 0.35],
  bed: [1.6, 0.55, 2.05],
  plant: [0.45, 1.2, 0.45],
};

export function furnitureSize(item: RoomItem): [number, number, number] {
  const base = FURNITURE_SIZE[item.type as FurnitureType] ?? [1, 1, 1];
  return [
    item.params.width ?? base[0],
    item.params.height ?? base[1],
    item.params.depth ?? base[2],
  ];
}

// The pixel count a light renders: pixel kinds use their param (default 60),
// single-color fixtures render one pixel.
export function itemPixelCount(item: RoomItem): number {
  if (item.kind && PIXEL_KINDS.has(item.kind))
    return Math.max(1, item.params.pixelCount ?? 60);
  return 1;
}

// The room's fixtures as show-algorithm lights, in item order.
export function roomLights(room: Room): LightSpec[] {
  return room.items
    .filter((it) => it.type === "light" && it.kind !== undefined)
    .map((it) => ({
      id: it.id,
      name: it.name ?? LIGHT_LABELS[it.kind as FixtureKind],
      kind: it.kind as FixtureKind,
      pixelCount: itemPixelCount(it),
      position: it.position,
    }));
}

// A short unique item id: the kind/type plus a counter not already used.
export function nextItemId(room: Room, base: string): string {
  const taken = new Set(room.items.map((i) => i.id));
  let n = 1;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function emptyRoom(id: string, title: string): Room {
  return {
    id,
    title,
    size: { w: 6, d: 5, h: 2.7 },
    items: [],
  };
}
