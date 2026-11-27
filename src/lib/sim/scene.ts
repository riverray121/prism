// The simulator scene: a room shell, its furniture and fixtures, rendered
// with physically based lights, ACES tone mapping and bloom on emitters.
// Framework-free (no Svelte, no Tauri) so the Sim tab and the lab's headless
// render page share it. A frame depends only on the room, the light states
// and (t, bpm): no clocks, no randomness.

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";

import type { LightState } from "$lib/showgen/lightstate";
import { buildFixture, type FixtureNode } from "$lib/sim/fixtures";
import { buildFurniture } from "$lib/sim/furniture";
import type { Wall } from "$lib/sim/geometry";
import type { Room, RoomItem } from "$lib/sim/room";

export interface SimSceneOptions {
  pixelRatio?: number;
  // "high": shadows from spots and moving heads; "low": none.
  quality?: "high" | "low";
}

// A surface hit under the pointer, for dropping items into the room.
export interface SurfaceHit {
  surface: "floor" | Wall;
  point: [number, number, number];
}

export interface SimScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  setRoom(room: Room): void;
  setLightStates(states: Map<string, LightState>, t: number, bpm: number): void;
  render(): void;
  resize(width: number, height: number): void;
  // Item id under a normalized device coordinate (-1..1), or null.
  pick(ndcX: number, ndcY: number): string | null;
  // Floor or wall under a normalized device coordinate, or null.
  pickSurface(ndcX: number, ndcY: number): SurfaceHit | null;
  setSelected(id: string | null): void;
  // The root object of an item, for interactive transform controls.
  objectFor(id: string): THREE.Object3D | undefined;
  // Point the camera at the room's saved view (or a default one).
  resetCamera(): void;
  dispose(): void;
}

const WALL_COLOR = "#8a8d93";
const FLOOR_COLOR = "#5b5248";
const CEILING_COLOR = "#7d8086";
// Faint fill so unlit surfaces read as a dark room, not a void.
const AMBIENT = 0.06;

let areaLightsReady = false;

function shellMaterial(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.95,
    metalness: 0,
  });
}

export function createSimScene(
  canvas: HTMLCanvasElement,
  room: Room,
  options: SimSceneOptions = {},
): SimScene {
  if (!areaLightsReady) {
    RectAreaLightUniformsLib.init();
    areaLightsReady = true;
  }
  const shadows = (options.quality ?? "high") === "high";
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(options.pixelRatio ?? 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#040405");
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 60);
  scene.add(new THREE.HemisphereLight(0xb8c4d6, 0x2a241e, AMBIENT));

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(1280, 720),
    0.8,
    0.5,
    1.15,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let current = room;
  let shell = new THREE.Group();
  const itemsRoot = new THREE.Group();
  scene.add(shell, itemsRoot);
  const fixtures = new Map<string, FixtureNode>();
  const objects = new Map<string, THREE.Object3D>();
  const surfaces: THREE.Mesh[] = [];
  const raycaster = new THREE.Raycaster();
  let selection: THREE.BoxHelper | null = null;
  let selectedId: string | null = null;

  function buildShell(r: Room): void {
    scene.remove(shell);
    disposeTree(shell);
    shell = new THREE.Group();
    surfaces.length = 0;
    const { w, d, h } = r.size;
    const plane = (
      width: number,
      height: number,
      color: string,
      surface: SurfaceHit["surface"] | "ceiling",
      pos: [number, number, number],
      rot: [number, number, number],
    ) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        shellMaterial(color),
      );
      mesh.position.set(...pos);
      mesh.rotation.set(...rot);
      mesh.receiveShadow = true;
      mesh.userData.surface = surface;
      shell.add(mesh);
      if (surface !== "ceiling") surfaces.push(mesh);
    };
    // Planes face into the room, so from outside the near walls vanish and
    // the room reads like a cutaway.
    plane(w, d, FLOOR_COLOR, "floor", [0, 0, 0], [-Math.PI / 2, 0, 0]);
    plane(w, d, CEILING_COLOR, "ceiling", [0, h, 0], [Math.PI / 2, 0, 0]);
    plane(w, h, WALL_COLOR, "back", [0, h / 2, -d / 2], [0, 0, 0]);
    plane(w, h, WALL_COLOR, "front", [0, h / 2, d / 2], [0, Math.PI, 0]);
    plane(d, h, WALL_COLOR, "left", [-w / 2, h / 2, 0], [0, Math.PI / 2, 0]);
    plane(d, h, WALL_COLOR, "right", [w / 2, h / 2, 0], [0, -Math.PI / 2, 0]);
    // Baseboards give the floor/wall seam some definition in the dark.
    const trim = shellMaterial("#4a4b4f");
    for (const [bw, pos, rotY] of [
      [w, [0, 0.04, -d / 2 + 0.006], 0],
      [w, [0, 0.04, d / 2 - 0.006], 0],
      [d, [-w / 2 + 0.006, 0.04, 0], Math.PI / 2],
      [d, [w / 2 - 0.006, 0.04, 0], Math.PI / 2],
    ] as [number, [number, number, number], number][]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.08, 0.012), trim);
      b.position.set(...pos);
      b.rotation.y = rotY;
      b.receiveShadow = true;
      shell.add(b);
    }
    scene.add(shell);
  }

  function buildItems(r: Room): void {
    for (const f of fixtures.values()) f.dispose();
    fixtures.clear();
    for (const child of [...itemsRoot.children]) {
      itemsRoot.remove(child);
      disposeTree(child);
    }
    objects.clear();
    for (const item of r.items) {
      let root: THREE.Object3D;
      if (item.type === "light") {
        const node = buildFixture(item, shadows);
        fixtures.set(item.id, node);
        node.update(undefined, 0, 0);
        root = node.group;
      } else {
        root = buildFurniture(item);
      }
      place(root, item);
      root.userData.itemId = item.id;
      itemsRoot.add(root);
      objects.set(item.id, root);
    }
    refreshSelection();
  }

  function place(root: THREE.Object3D, item: RoomItem): void {
    root.position.set(...item.position);
    root.rotation.set(...item.rotation);
  }

  function refreshSelection(): void {
    if (selection) {
      scene.remove(selection);
      selection.geometry.dispose();
      (selection.material as THREE.Material).dispose();
      selection = null;
    }
    const obj = selectedId ? objects.get(selectedId) : undefined;
    if (!obj) return;
    selection = new THREE.BoxHelper(obj, 0x7aa2f7);
    scene.add(selection);
  }

  function defaultCamera(r: Room): void {
    const cam = r.camera ?? {
      position: [0, 1.6, r.size.d / 2 - 0.3] as [number, number, number],
      target: [0, 1.1, -r.size.d / 2] as [number, number, number],
    };
    camera.position.set(...cam.position);
    camera.lookAt(new THREE.Vector3(...cam.target));
    camera.userData.target = cam.target;
  }

  function ndcRay(x: number, y: number): void {
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
  }

  buildShell(room);
  buildItems(room);
  defaultCamera(room);

  return {
    scene,
    camera,
    renderer,
    setRoom(r) {
      const sizeChanged =
        r.size.w !== current.size.w ||
        r.size.d !== current.size.d ||
        r.size.h !== current.size.h;
      current = r;
      if (sizeChanged) buildShell(r);
      buildItems(r);
    },
    setLightStates(states, t, bpm) {
      for (const [id, node] of fixtures) node.update(states.get(id), t, bpm);
    },
    render() {
      selection?.update();
      composer.render();
    },
    resize(width, height) {
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      bloom.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    pick(x, y) {
      ndcRay(x, y);
      const hits = raycaster.intersectObjects(itemsRoot.children, true);
      for (const hit of hits) {
        let o: THREE.Object3D | null = hit.object;
        // Beam cones are see-through: clicks pass through them.
        const mat = (hit.object as THREE.Mesh).material as
          | THREE.Material
          | undefined;
        if (mat && mat.blending === THREE.AdditiveBlending) continue;
        if (hit.object.userData.decal) continue;
        while (o && o.userData.itemId === undefined) o = o.parent;
        if (o) return o.userData.itemId as string;
      }
      return null;
    },
    pickSurface(x, y) {
      ndcRay(x, y);
      const hit = raycaster.intersectObjects(surfaces, false)[0];
      if (!hit) return null;
      return {
        surface: hit.object.userData.surface,
        point: [hit.point.x, hit.point.y, hit.point.z],
      };
    },
    setSelected(id) {
      selectedId = id;
      refreshSelection();
    },
    objectFor(id) {
      return objects.get(id);
    },
    resetCamera() {
      defaultCamera(current);
    },
    dispose() {
      for (const f of fixtures.values()) f.dispose();
      disposeTree(scene);
      composer.dispose();
      renderer.dispose();
    },
  };
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}
