// Pure placement math for the simulator: where each pixel of a fixture sits
// in the fixture's local frame, which way it faces, and how a dropped item
// lands against a wall. No three.js, so it is unit-testable.

import type { Room, RoomItem } from "$lib/sim/room";

export type V3 = [number, number, number];

export const WALLS = ["back", "front", "left", "right"] as const;
export type Wall = (typeof WALLS)[number];

export function facingVector(facing: RoomItem["params"]["facing"]): V3 {
  switch (facing) {
    case "back":
      return [0, 0, -1];
    case "up":
      return [0, 1, 0];
    case "down":
      return [0, -1, 0];
    default:
      return [0, 0, 1];
  }
}

// Evenly spaced points along a polyline, by arc length, one per pixel at
// each pixel's center.
function alongPolyline(path: V3[], count: number, closed: boolean): V3[] {
  const pts = closed ? [...path, path[0]] : path;
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(
      pts[i][0] - pts[i - 1][0],
      pts[i][1] - pts[i - 1][1],
      pts[i][2] - pts[i - 1][2],
    );
    seg.push(d);
    total += d;
  }
  const out: V3[] = [];
  for (let p = 0; p < count; p++) {
    let s = ((p + 0.5) / count) * total;
    let i = 0;
    while (i < seg.length - 1 && s > seg[i]) {
      s -= seg[i];
      i++;
    }
    const f = seg[i] > 0 ? Math.min(1, s / seg[i]) : 0;
    const a = pts[i];
    const b = pts[i + 1];
    out.push([
      a[0] + (b[0] - a[0]) * f,
      a[1] + (b[1] - a[1]) * f,
      a[2] + (b[2] - a[2]) * f,
    ]);
  }
  return out;
}

// Local pixel positions of a pixel fixture, in pixel order.
//  - line strip: along x, centered, `length` long
//  - rect strip: the outline of a width × height rectangle in the x/y plane,
//    starting at the bottom-left corner and running counter-clockwise
//  - arc strip: an arc of `radius` sweeping `arc` degrees in the x/z plane,
//    bulging toward +z, with its middle at the origin
//  - tube: along y from 0 to `length`
export function pixelPoints(item: RoomItem, count: number): V3[] {
  const p = item.params;
  if (item.kind === "tube") {
    const len = p.length ?? 1.2;
    return alongPolyline(
      [
        [0, 0, 0],
        [0, len, 0],
      ],
      count,
      false,
    );
  }
  const shape = p.shape ?? (item.kind === "strip_curve" ? "arc" : "line");
  if (shape === "rect") {
    const w = (p.width ?? 1.4) / 2;
    const h = (p.height ?? 0.8) / 2;
    return alongPolyline(
      [
        [-w, -h, 0],
        [w, -h, 0],
        [w, h, 0],
        [-w, h, 0],
      ],
      count,
      true,
    );
  }
  if (shape === "arc") {
    const r = p.radius ?? 0.6;
    const sweep = ((p.arc ?? 180) * Math.PI) / 180;
    const out: V3[] = [];
    for (let i = 0; i < count; i++) {
      const a = -sweep / 2 + (sweep * (i + 0.5)) / count;
      out.push([r * Math.sin(a), 0, r * Math.cos(a) - r]);
    }
    return out;
  }
  const len = p.length ?? 1;
  return alongPolyline(
    [
      [-len / 2, 0, 0],
      [len / 2, 0, 0],
    ],
    count,
    false,
  );
}

// Split `count` pixels into at most `parts` contiguous, near-equal ranges
// [start, end). Used to give a strip a few area lights, each colored by the
// average of its range.
export function segmentRanges(
  count: number,
  parts: number,
): [number, number][] {
  const k = Math.max(1, Math.min(parts, count));
  const out: [number, number][] = [];
  for (let i = 0; i < k; i++)
    out.push([Math.floor((i * count) / k), Math.floor(((i + 1) * count) / k)]);
  return out;
}

// Inward normal of each wall (pointing into the room).
export function wallNormal(wall: Wall): V3 {
  switch (wall) {
    case "back":
      return [0, 0, 1];
    case "front":
      return [0, 0, -1];
    case "left":
      return [1, 0, 0];
    default:
      return [-1, 0, 0];
  }
}

// Yaw that turns an item's local +z (its front) to face into the room from
// a wall.
export function wallYaw(wall: Wall): number {
  const [x, , z] = wallNormal(wall);
  return Math.atan2(x, z);
}

// Place an item flat against a wall: `along` is the horizontal coordinate
// on that wall (x for back/front, z for left/right), `y` the height. The
// item's back sits `offset` meters off the wall, facing into the room.
export function wallPlacement(
  room: Room,
  wall: Wall,
  along: number,
  y: number,
  offset: number,
): { position: V3; rotation: V3 } {
  const { w, d, h } = room.size;
  const yy = Math.max(0, Math.min(h, y));
  let position: V3;
  switch (wall) {
    case "back":
      position = [clamp(along, -w / 2, w / 2), yy, -d / 2 + offset];
      break;
    case "front":
      position = [clamp(along, -w / 2, w / 2), yy, d / 2 - offset];
      break;
    case "left":
      position = [-w / 2 + offset, yy, clamp(along, -d / 2, d / 2)];
      break;
    default:
      position = [w / 2 - offset, yy, clamp(along, -d / 2, d / 2)];
  }
  return { position, rotation: [0, wallYaw(wall), 0] };
}

// The wall nearest a floor point, for washers dropped on the floor.
export function nearestWall(room: Room, x: number, z: number): Wall {
  const { w, d } = room.size;
  const gaps: [Wall, number][] = [
    ["back", z + d / 2],
    ["front", d / 2 - z],
    ["left", x + w / 2],
    ["right", w / 2 - x],
  ];
  gaps.sort((a, b) => a[1] - b[1]);
  return gaps[0][0];
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Kinds placed against a wall when dropped; everything else stands on the
// floor where it is dropped.
export function snapsToWall(item: Pick<RoomItem, "type" | "kind">): boolean {
  return (
    item.type === "tv" ||
    item.type === "shelf" ||
    (item.type === "light" &&
      (item.kind === "strip" ||
        item.kind === "strip_curve" ||
        item.kind === "wash"))
  );
}

// Moving-head pan and tilt at time t (radians): one full pan cycle every 4
// bars of 4 beats, tilt swinging at twice that rate. Deterministic in
// (t, bpm) so a rendered video matches the app frame for frame.
export function movingHeadAim(
  t: number,
  bpm: number,
): { pan: number; tilt: number } {
  const beats = bpm > 0 ? (t * bpm) / 60 : t * 2;
  const phase = (beats / 16) * 2 * Math.PI;
  return {
    pan: 0.9 * Math.sin(phase),
    tilt: 0.55 + 0.3 * Math.sin(2 * phase + Math.PI / 3),
  };
}
