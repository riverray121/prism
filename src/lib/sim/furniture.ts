// Furniture meshes: plain matte boxes and cylinders, no textures. Each group
// has its origin at the center of its floor footprint (y = 0), except the TV,
// whose origin is its center so it can hang at any height.

import * as THREE from "three";

import {
  furnitureSize,
  type FurnitureType,
  type RoomItem,
} from "$lib/sim/room";

const DEFAULT_COLORS: Record<FurnitureType, string> = {
  sofa: "#3b4150",
  tv_stand: "#2b2724",
  tv: "#101113",
  table: "#5a4a3c",
  shelf: "#4a4038",
  bed: "#5b5f6b",
  plant: "#2f5a3a",
};

function matte(color: string, roughness = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
}

function box(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildFurniture(item: RoomItem): THREE.Group {
  const type = item.type as FurnitureType;
  const [w, h, d] = furnitureSize(item);
  const color = item.params.color ?? DEFAULT_COLORS[type] ?? "#555";
  const mat = matte(color);
  const g = new THREE.Group();
  switch (type) {
    case "sofa": {
      const seatH = h * 0.5;
      const arm = 0.18;
      g.add(box(w - 2 * arm, seatH, d * 0.8, mat, 0, seatH / 2, d * 0.1));
      g.add(box(w, h, d * 0.22, mat, 0, h / 2, -d / 2 + d * 0.11));
      g.add(box(arm, h * 0.68, d, mat, -w / 2 + arm / 2, (h * 0.68) / 2, 0));
      g.add(box(arm, h * 0.68, d, mat, w / 2 - arm / 2, (h * 0.68) / 2, 0));
      break;
    }
    case "tv_stand": {
      g.add(box(w, h * 0.92, d, mat, 0, (h * 0.92) / 2, 0));
      g.add(box(w, h * 0.08, d, matte("#1d1a18", 0.7), 0, h * 0.96, 0));
      break;
    }
    case "tv": {
      const bezel = matte("#0b0b0c", 0.6);
      g.add(box(w, h, d, bezel));
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.97, h * 0.95),
        new THREE.MeshStandardMaterial({
          color: "#050608",
          roughness: 0.25,
          metalness: 0.1,
        }),
      );
      screen.position.z = d / 2 + 0.001;
      g.add(screen);
      break;
    }
    case "table": {
      const top = 0.04;
      g.add(box(w, top, d, mat, 0, h - top / 2, 0));
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ])
        g.add(
          box(
            0.05,
            h - top,
            0.05,
            mat,
            sx * (w / 2 - 0.06),
            (h - top) / 2,
            sz * (d / 2 - 0.06),
          ),
        );
      break;
    }
    case "shelf": {
      const t = 0.025;
      g.add(box(t, h, d, mat, -w / 2 + t / 2, h / 2, 0));
      g.add(box(t, h, d, mat, w / 2 - t / 2, h / 2, 0));
      for (let i = 0; i < 5; i++)
        g.add(box(w, t, d, mat, 0, t / 2 + (i * (h - t)) / 4, 0));
      break;
    }
    case "bed": {
      g.add(box(w, h * 0.45, d, matte("#3a332e"), 0, (h * 0.45) / 2, 0));
      g.add(
        box(w * 0.97, h * 0.4, d * 0.97, mat, 0, h * 0.45 + (h * 0.4) / 2, 0),
      );
      g.add(
        box(
          w,
          h * 1.7,
          0.08,
          matte("#3a332e"),
          0,
          (h * 1.7) / 2,
          -d / 2 + 0.04,
        ),
      );
      break;
    }
    case "plant": {
      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(w * 0.35, w * 0.28, h * 0.3, 20),
        matte("#7a6a5a"),
      );
      pot.position.y = h * 0.15;
      pot.castShadow = pot.receiveShadow = true;
      g.add(pot);
      const leaves = new THREE.Mesh(
        new THREE.SphereGeometry(w * 0.5, 16, 12),
        mat,
      );
      leaves.scale.set(1, (h * 0.7) / w, 1);
      leaves.position.y = h * 0.3 + h * 0.35;
      leaves.castShadow = leaves.receiveShadow = true;
      g.add(leaves);
      break;
    }
  }
  return g;
}
