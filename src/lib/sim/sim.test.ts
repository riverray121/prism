import { describe, expect, it } from "vitest";

import { MappingDocSchema } from "$lib/mapping/schema";
import {
  facingVector,
  movingHeadAim,
  nearestWall,
  pixelPoints,
  segmentRanges,
  wallPlacement,
  wallYaw,
} from "$lib/sim/geometry";
import { placeItem } from "$lib/sim/place";
import {
  emptyRoom,
  itemPixelCount,
  nextItemId,
  RoomSchema,
  roomLights,
  type RoomItem,
} from "$lib/sim/room";
import {
  assignProgram,
  MAPPING_PREFIX,
  pruneShow,
  SimDocSchema,
} from "$lib/sim/show";
import demoRoom from "../../../lab/rooms/demo-room.json";

const room = emptyRoom("r", "Room");

function light(
  kind: RoomItem["kind"],
  params: RoomItem["params"] = {},
): RoomItem {
  return {
    id: `${kind}-1`,
    type: "light",
    kind,
    position: [0, 1, 0],
    rotation: [0, 0, 0],
    params,
  };
}

describe("room model", () => {
  it("parses the demo room with at most 10 lights", () => {
    const parsed = RoomSchema.parse(demoRoom);
    const lights = roomLights(parsed);
    expect(lights.length).toBeGreaterThan(0);
    expect(lights.length).toBeLessThanOrEqual(10);
    expect(new Set(parsed.items.map((i) => i.id)).size).toBe(
      parsed.items.length,
    );
  });

  it("fills defaults for rotation, params and items", () => {
    const r = RoomSchema.parse({
      id: "x",
      title: "X",
      size: { w: 4, d: 3, h: 2.5 },
      items: [{ id: "a", type: "sofa", position: [0, 0, 0] }],
    });
    expect(r.items[0].rotation).toEqual([0, 0, 0]);
    expect(r.items[0].params).toEqual({});
    expect(
      RoomSchema.parse({ id: "y", title: "Y", size: { w: 1, d: 1, h: 1 } })
        .items,
    ).toEqual([]);
  });

  it("rejects unknown item types and fixture kinds", () => {
    const base = { id: "x", title: "X", size: { w: 4, d: 3, h: 2.5 } };
    expect(
      RoomSchema.safeParse({
        ...base,
        items: [{ id: "a", type: "piano", position: [0, 0, 0] }],
      }).success,
    ).toBe(false);
    expect(
      RoomSchema.safeParse({
        ...base,
        items: [{ id: "a", type: "light", kind: "laser", position: [0, 0, 0] }],
      }).success,
    ).toBe(false);
  });

  it("gives pixel fixtures their pixel count and the rest one pixel", () => {
    expect(itemPixelCount(light("strip", { pixelCount: 90 }))).toBe(90);
    expect(itemPixelCount(light("tube"))).toBe(60);
    expect(itemPixelCount(light("wash", { pixelCount: 90 }))).toBe(1);
    const r = {
      ...room,
      items: [
        light("strip", { pixelCount: 30 }),
        light("lamp"),
        {
          id: "s",
          type: "sofa" as const,
          position: [0, 0, 0] as [number, number, number],
          rotation: [0, 0, 0] as [number, number, number],
          params: {},
        },
      ],
    };
    expect(roomLights(r).map((l) => [l.kind, l.pixelCount])).toEqual([
      ["strip", 30],
      ["lamp", 1],
    ]);
  });

  it("numbers new item ids past the taken ones", () => {
    const r = {
      ...room,
      items: [light("strip"), { ...light("strip"), id: "strip-2" }],
    };
    expect(nextItemId(r, "strip")).toBe("strip-3");
    expect(nextItemId(r, "lamp")).toBe("lamp-1");
  });
});

describe("geometry", () => {
  it("spaces a line strip's pixels evenly across its length", () => {
    const pts = pixelPoints(light("strip", { length: 2, shape: "line" }), 4);
    expect(pts.map((p) => p[0])).toEqual([-0.75, -0.25, 0.25, 0.75]);
    expect(pts.every((p) => p[1] === 0 && p[2] === 0)).toBe(true);
  });

  it("runs a rect strip around the outline from the bottom-left corner", () => {
    const pts = pixelPoints(
      light("strip", { shape: "rect", width: 2, height: 1 }),
      6,
    );
    expect(pts).toHaveLength(6);
    // Every pixel sits on the rectangle's edge.
    for (const [x, y] of pts)
      expect(
        Math.min(Math.abs(Math.abs(x) - 1), Math.abs(Math.abs(y) - 0.5)),
      ).toBeLessThan(1e-9);
    // The first pixel is on the bottom edge.
    expect(pts[0][1]).toBeCloseTo(-0.5);
  });

  it("bends an arc toward +z with its middle at the origin", () => {
    const pts = pixelPoints(light("strip_curve", { radius: 1, arc: 180 }), 3);
    expect(pts[1][0]).toBeCloseTo(0);
    expect(pts[1][2]).toBeCloseTo(0);
    expect(pts[0][2]).toBeLessThan(0);
  });

  it("stands a tube's pixels up from its base", () => {
    const pts = pixelPoints(light("tube", { length: 1 }), 2);
    expect(pts.map((p) => p[1])).toEqual([0.25, 0.75]);
  });

  it("splits pixels into contiguous ranges that cover them all", () => {
    expect(segmentRanges(10, 3)).toEqual([
      [0, 3],
      [3, 6],
      [6, 10],
    ]);
    expect(segmentRanges(2, 3)).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it("maps facings to unit vectors", () => {
    expect(facingVector("back")).toEqual([0, 0, -1]);
    expect(facingVector(undefined)).toEqual([0, 0, 1]);
  });

  it("places a wall item against its wall, facing into the room", () => {
    const back = wallPlacement(room, "back", 1, 1.2, 0.05);
    expect(back.position).toEqual([1, 1.2, -room.size.d / 2 + 0.05]);
    expect(back.rotation[1]).toBeCloseTo(0);
    const left = wallPlacement(room, "left", 9, 1, 0.1);
    expect(left.position[0]).toBeCloseTo(-room.size.w / 2 + 0.1);
    expect(left.position[2]).toBe(room.size.d / 2);
    expect(wallYaw("left")).toBeCloseTo(Math.PI / 2);
    expect(wallYaw("right")).toBeCloseTo(-Math.PI / 2);
  });

  it("finds the nearest wall to a floor point", () => {
    expect(nearestWall(room, 0, -2.3)).toBe("back");
    expect(nearestWall(room, 2.9, 0)).toBe("right");
  });

  it("aims moving heads deterministically from time and tempo", () => {
    expect(movingHeadAim(3.2, 120)).toEqual(movingHeadAim(3.2, 120));
    // One pan cycle per 4 bars of 4 beats: 8 s at 120 BPM.
    expect(movingHeadAim(1, 120).pan).toBeCloseTo(movingHeadAim(9, 120).pan);
  });
});

describe("placeItem", () => {
  it("snaps a TV dropped on the floor to the nearest wall at mount height", () => {
    const item = placeItem(
      room,
      { type: "tv" },
      { surface: "floor", point: [0.5, 0, -2.2] },
    );
    expect(item.type).toBe("tv");
    expect(item.position[1]).toBeCloseTo(1.35);
    expect(item.position[2]).toBeGreaterThan(-room.size.d / 2);
    expect(item.position[2]).toBeLessThan(-room.size.d / 2 + 0.1);
    expect(item.rotation[1]).toBeCloseTo(0);
  });

  it("keeps a strip at the height it was dropped on a wall", () => {
    const item = placeItem(
      room,
      { type: "light", kind: "strip" },
      { surface: "right", point: [3, 2, 0.4] },
    );
    expect(item.kind).toBe("strip");
    expect(item.position).toEqual([room.size.w / 2 - 0.03, 2, 0.4]);
    expect(item.params.pixelCount).toBe(60);
  });

  it("stands washers on the floor against the wall", () => {
    const item = placeItem(
      room,
      { type: "light", kind: "wash" },
      { surface: "left", point: [-3, 1.5, 0] },
    );
    expect(item.position[1]).toBe(0);
    expect(item.rotation[1]).toBeCloseTo(Math.PI / 2);
  });

  it("puts floor items at the drop point, inside the room", () => {
    const sofa = placeItem(
      room,
      { type: "sofa" },
      { surface: "floor", point: [9, 0, 0.5] },
    );
    expect(sofa.position).toEqual([room.size.w / 2 - 0.2, 0, 0.5]);
    const par = placeItem(
      room,
      { type: "light", kind: "par" },
      { surface: "floor", point: [0, 0, 0] },
    );
    expect(par.position[1]).toBeCloseTo(2.4);
    expect(par.params.facing).toBe("down");
  });
});

describe("room shows", () => {
  const show = MappingDocSchema.parse({
    programs: [{ id: "a", enabled: true, channels: {} }],
    patch: { l1: "a" },
  });
  const hardware = MappingDocSchema.parse({
    derivations: [
      {
        id: "kicks",
        source: "mix.rms",
        threshold: { mode: "events", cutoff: 0.5 },
      },
    ],
    programs: [
      {
        id: "a",
        enabled: true,
        channels: { gate: { source: "derived.kicks", transform: [] } },
      },
    ],
  });

  it("assigns room programs and turns lights off", () => {
    const next = assignProgram(show, "l2", "a", null);
    expect(next.patch).toEqual({ l1: "a", l2: "a" });
    expect(assignProgram(next, "l1", null, null).patch).toEqual({ l2: "a" });
    // The input is never mutated.
    expect(show.patch).toEqual({ l1: "a" });
  });

  it("copies a hardware program and its derivations under a prefixed id", () => {
    const id = `${MAPPING_PREFIX}a`;
    const next = assignProgram(show, "l2", id, hardware);
    expect(next.patch.l2).toBe(id);
    expect(next.programs.map((p) => p.id)).toEqual(["a", id]);
    expect(next.derivations.map((d) => d.id)).toEqual(["kicks"]);
    // Assigning it again does not duplicate it.
    expect(assignProgram(next, "l1", id, hardware).programs).toHaveLength(2);
  });

  it("prunes removed lights and unused copied programs", () => {
    const id = `${MAPPING_PREFIX}a`;
    const next = pruneShow(
      assignProgram(show, "gone", id, hardware),
      new Set(["l1"]),
    );
    expect(next.patch).toEqual({ l1: "a" });
    expect(next.programs.map((p) => p.id)).toEqual(["a"]);
  });

  it("parses an empty sim doc", () => {
    expect(SimDocSchema.parse({})).toEqual({ rooms: {} });
    const doc = SimDocSchema.parse({ rooms: { r: {} } });
    expect(doc.rooms.r.programs).toEqual([]);
  });
});
