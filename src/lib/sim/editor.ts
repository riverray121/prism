// Interactive layer over a SimScene for the Sim tab: orbit camera, click to
// select, a move/rotate gizmo on the selection, and drop targets. Kept out
// of scene.ts so the headless renderer carries no input handling.

import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

import type { V3 } from "$lib/sim/geometry";
import type { SimScene, SurfaceHit } from "$lib/sim/scene";

export type GizmoMode = "translate" | "rotate";

export interface SimEditorCallbacks {
  onSelect(id: string | null): void;
  // A gizmo drag ended: the item's new transform.
  onTransform(id: string, position: V3, rotation: V3): void;
}

export interface SimEditor {
  setSelected(id: string | null): void;
  setMode(mode: GizmoMode): void;
  // Re-attach the gizmo after the scene rebuilt its objects.
  refresh(): void;
  surfaceAt(clientX: number, clientY: number): SurfaceHit | null;
  // Camera back to the room's saved view, orbiting around its target.
  resetView(): void;
  // Advance camera damping; call once per animation frame.
  update(): void;
  dispose(): void;
}

export function createSimEditor(
  sim: SimScene,
  cb: SimEditorCallbacks,
): SimEditor {
  const dom = sim.renderer.domElement;
  const orbit = new OrbitControls(sim.camera, dom);
  function aimOrbit(): void {
    const target = sim.camera.userData.target as V3 | undefined;
    if (target) orbit.target.set(...target);
  }
  aimOrbit();
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.12;
  orbit.maxDistance = 20;
  orbit.update();

  const gizmo = new TransformControls(sim.camera, dom);
  gizmo.setSize(0.7);
  const helper = gizmo.getHelper();
  sim.scene.add(helper);
  let selected: string | null = null;
  // Set while the gizmo is dragging, so the click that ends a drag does not
  // also change the selection.
  let dragging = false;
  let dragEndedAt = 0;

  gizmo.addEventListener("dragging-changed", (e) => {
    dragging = Boolean(e.value);
    orbit.enabled = !dragging;
    if (dragging || !selected || !gizmo.object) return;
    dragEndedAt = performance.now();
    const o = gizmo.object;
    cb.onTransform(
      selected,
      [o.position.x, o.position.y, o.position.z],
      [o.rotation.x, o.rotation.y, o.rotation.z],
    );
  });

  function ndc(clientX: number, clientY: number): [number, number] {
    const r = dom.getBoundingClientRect();
    return [
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    ];
  }

  // A press that moves less than this many pixels counts as a click, not an
  // orbit drag.
  const CLICK_SLOP = 4;
  let down: [number, number] | null = null;
  const onDown = (e: PointerEvent) => {
    down = [e.clientX, e.clientY];
  };
  const onUp = (e: PointerEvent) => {
    if (!down || dragging || performance.now() - dragEndedAt < 50) return;
    const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
    down = null;
    if (moved > CLICK_SLOP) return;
    const [x, y] = ndc(e.clientX, e.clientY);
    cb.onSelect(sim.pick(x, y));
  };
  dom.addEventListener("pointerdown", onDown);
  dom.addEventListener("pointerup", onUp);

  function attach(): void {
    const obj = selected ? sim.objectFor(selected) : undefined;
    if (obj) gizmo.attach(obj);
    else gizmo.detach();
  }

  return {
    setSelected(id) {
      selected = id;
      sim.setSelected(id);
      attach();
    },
    setMode(mode) {
      gizmo.setMode(mode);
      // Rotation only about the vertical axis: fixtures face walls and floors.
      gizmo.showX = mode === "translate";
      gizmo.showZ = mode === "translate";
    },
    refresh() {
      sim.setSelected(selected);
      attach();
    },
    surfaceAt(clientX, clientY) {
      const [x, y] = ndc(clientX, clientY);
      return sim.pickSurface(x, y);
    },
    resetView() {
      sim.resetCamera();
      aimOrbit();
      orbit.update();
    },
    update() {
      orbit.update();
    },
    dispose() {
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointerup", onUp);
      gizmo.detach();
      sim.scene.remove(helper);
      gizmo.dispose();
      orbit.dispose();
    },
  };
}
