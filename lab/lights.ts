// Lights for a lab run: a room file's lights, named and sized exactly as the
// Sim tab sees them.

import { readFileSync } from "node:fs";

import { RoomSchema, roomLights } from "$lib/sim/room";
import type { LightSpec } from "$lib/showgen/types";

export function lightsFromRoom(path: string): LightSpec[] {
  return roomLights(RoomSchema.parse(JSON.parse(readFileSync(path, "utf8"))));
}
