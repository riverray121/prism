// Lights for a lab run, from a room file's light items.

import { readFileSync } from "node:fs";

import {
  FIXTURE_KINDS,
  PIXEL_KINDS,
  type FixtureKind,
  type LightSpec,
} from "$lib/showgen/types";

interface RoomItem {
  id: string;
  kind?: string;
  position?: [number, number, number];
  params?: { name?: string; pixelCount?: number };
}

export function lightsFromRoom(path: string): LightSpec[] {
  const room = JSON.parse(readFileSync(path, "utf8")) as { items: RoomItem[] };
  return room.items
    .filter(
      (it) => it.kind && (FIXTURE_KINDS as readonly string[]).includes(it.kind),
    )
    .map((it) => {
      const kind = it.kind as FixtureKind;
      return {
        id: it.id,
        name: it.params?.name ?? it.id,
        kind,
        pixelCount: PIXEL_KINDS.has(kind) ? (it.params?.pixelCount ?? 60) : 1,
        position: it.position,
      };
    });
}
