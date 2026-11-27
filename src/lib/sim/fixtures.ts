// Light fixtures: visible emitter meshes plus the three.js lights that throw
// their color onto the room. Every fixture updates from a LightState (sRGB
// bytes per pixel) and the time, and nothing else, so a frame is fully
// determined by (states, t, bpm).

import * as THREE from "three";

import type { LightState } from "$lib/showgen/lightstate";
import {
  facingVector,
  movingHeadAim,
  pixelPoints,
  segmentRanges,
  type V3,
} from "$lib/sim/geometry";
import { itemPixelCount, type RoomItem } from "$lib/sim/room";

export interface FixtureNode {
  group: THREE.Group;
  update(state: LightState | undefined, t: number, bpm: number): void;
  dispose(): void;
}

// Emitter brightness above 1 (linear) so lit LEDs pass the bloom threshold.
const EMITTER_GAIN = 3.2;
// Light output per fixture kind at full level (three.js physical units:
// candela for spot/point lights, nits for area lights).
const SPOT_CD = 60;
const PAR_CD = 90;
const HEAD_CD = 140;
const STROBE_CD = 18;
const LAMP_CD = 14;
const TUBE_CD = 0.9;
const AREA_NITS = 60;
// Opacity of a beam cone at full level: a faint haze, not a solid shape.
const BEAM_OPACITY = 0.22;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

// Mean linear color of pixels [a, b) as a 0–1 color plus its peak channel.
function meanColor(rgb: Uint8ClampedArray, a: number, b: number): Rgb {
  let r = 0;
  let g = 0;
  let bl = 0;
  const n = Math.max(1, b - a);
  for (let i = a; i < b; i++) {
    r += srgbToLinear(rgb[i * 3] / 255);
    g += srgbToLinear(rgb[i * 3 + 1] / 255);
    bl += srgbToLinear(rgb[i * 3 + 2] / 255);
  }
  return { r: r / n, g: g / n, b: bl / n };
}

function srgbToLinear(x: number): number {
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

// Set a light from a mean color: hue from the normalized color, intensity
// from its peak channel.
function drive(light: THREE.Light, c: Rgb, base: number): void {
  const peak = Math.max(c.r, c.g, c.b);
  if (peak <= 1e-4) {
    light.intensity = 0;
    return;
  }
  light.color.setRGB(c.r / peak, c.g / peak, c.b / peak);
  light.intensity = base * peak;
}

// Rotation that points a light's -z (the direction three.js lights emit
// along) at a local facing vector.
function rotationForFacing(f: V3): THREE.Euler {
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(...f).normalize(),
  );
  return new THREE.Euler().setFromQuaternion(q);
}

const tmpColor = new THREE.Color();

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
    if ((o as THREE.Light).isLight) (o as THREE.Light).dispose();
  });
}

function matte(color: string, roughness = 0.6): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.1 });
}

// Beam haze: brightest at the lens, fading along the beam and toward the
// cone's silhouette, so the cone reads as light in the air, not a surface.
const BEAM_VERTEX = /* glsl */ `
  uniform float uLength;
  varying float vAlong;
  varying float vFacing;
  void main() {
    vAlong = clamp(-position.z / uLength, 0.0, 1.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vFacing = abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }
`;
const BEAM_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlong;
  varying float vFacing;
  void main() {
    float a = uOpacity * pow(1.0 - vAlong, 1.6) * pow(vFacing, 1.4);
    gl_FragColor = vec4(uColor * a, 1.0);
  }
`;

type BeamMaterial = THREE.ShaderMaterial & {
  uniforms: { uColor: { value: THREE.Color }; uOpacity: { value: number } };
};

// A haze cone from the fixture along -z of its parent, `length` meters
// long, spreading to the beam angle.
function beamCone(beamAngleDeg: number, length: number): THREE.Mesh {
  const radius = Math.tan(((beamAngleDeg / 2) * Math.PI) / 180) * length;
  const geo = new THREE.ConeGeometry(radius, length, 32, 8, true);
  // Cone tip at the origin, opening toward -z.
  geo.translate(0, -length / 2, 0);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0, 0, 0) },
      uOpacity: { value: 0 },
      uLength: { value: length },
    },
    vertexShader: BEAM_VERTEX,
    fragmentShader: BEAM_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

function spot(
  cd: number,
  beamAngleDeg: number,
  shadows: boolean,
): THREE.SpotLight {
  const s = new THREE.SpotLight(
    0xffffff,
    0,
    0,
    ((beamAngleDeg / 2) * Math.PI) / 180,
    0.55,
    2,
  );
  s.intensity = 0;
  s.userData.base = cd;
  if (shadows) {
    s.castShadow = true;
    s.shadow.mapSize.set(512, 512);
    s.shadow.bias = -0.0008;
  }
  return s;
}

// LED strips and tubes: one emissive dot per pixel, plus up to 3 (4 for a
// rectangle) area or point lights colored by their pixel range.
function pixelFixture(item: RoomItem): FixtureNode {
  const group = new THREE.Group();
  const count = itemPixelCount(item);
  const points = pixelPoints(item, count);
  const isTube = item.kind === "tube";
  const len = isTube ? (item.params.length ?? 1.2) : 0;
  const dot = isTube
    ? new THREE.CylinderGeometry(0.022, 0.022, Math.max(0.004, len / count), 10)
    : new THREE.BoxGeometry(0.014, 0.014, 0.006);
  const dots = new THREE.InstancedMesh(
    dot,
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    count,
  );
  const facing = facingVector(item.params.facing);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(...facing),
  );
  points.forEach((p, i) => {
    m.compose(
      new THREE.Vector3(...p),
      isTube ? new THREE.Quaternion() : q,
      new THREE.Vector3(1, 1, 1),
    );
    dots.setMatrixAt(i, m);
    dots.setColorAt(i, tmpColor.setRGB(0.02, 0.02, 0.02));
  });
  group.add(dots);

  // A dim backing so an unlit strip still reads as a fixture.
  if (isTube) {
    const housing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.024, len, 12, 1, true),
      new THREE.MeshStandardMaterial({
        color: "#d8dde6",
        roughness: 0.3,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }),
    );
    housing.position.y = len / 2;
    group.add(housing);
  }

  const parts = item.params.shape === "rect" ? 4 : 3;
  const ranges = segmentRanges(count, parts);
  const lights: { light: THREE.Light; range: [number, number] }[] = [];
  for (const range of ranges) {
    const seg = points.slice(range[0], range[1]);
    const center = seg
      .reduce(
        (acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]],
        [0, 0, 0],
      )
      .map((v) => v / seg.length) as V3;
    if (isTube) {
      const pl = new THREE.PointLight(0xffffff, 0, 0, 2);
      pl.position.set(...center);
      pl.userData.base = TUBE_CD;
      group.add(pl);
      lights.push({ light: pl, range });
      continue;
    }
    const xs = seg.map((p) => p[0]);
    const ys = seg.map((p) => p[1]);
    const zs = seg.map((p) => p[2]);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    const spanZ = Math.max(...zs) - Math.min(...zs);
    const vertical =
      item.params.facing === "up" || item.params.facing === "down";
    // Width runs along the strip; height is a thin band (or the vertical
    // span of a rectangle's side).
    const width = Math.max(0.04, Math.hypot(spanX, vertical ? 0 : spanZ));
    const height = Math.max(0.08, vertical ? spanZ : spanY);
    const area = new THREE.RectAreaLight(0xffffff, 0, width, height);
    area.position.set(...center);
    area.rotation.copy(rotationForFacing(facing));
    area.userData.base = AREA_NITS;
    group.add(area);
    lights.push({ light: area, range });
  }

  const glow = isTube ? null : glowDecal(item, facing);
  if (glow) group.add(glow.mesh);

  return {
    group,
    update(state) {
      const rgb = state?.rgb;
      if (glow) {
        glow.colors.forEach((c, k) => {
          const r = ranges[Math.min(k, ranges.length - 1)];
          const m = rgb ? meanColor(rgb, r[0], r[1]) : { r: 0, g: 0, b: 0 };
          c.set(m.r, m.g, m.b);
        });
      }
      for (let i = 0; i < count; i++) {
        if (!rgb || rgb.length < (i + 1) * 3) {
          dots.setColorAt(i, tmpColor.setRGB(0.02, 0.02, 0.02));
          continue;
        }
        tmpColor.setRGB(
          rgb[i * 3] / 255,
          rgb[i * 3 + 1] / 255,
          rgb[i * 3 + 2] / 255,
          THREE.SRGBColorSpace,
        );
        tmpColor.multiplyScalar(EMITTER_GAIN);
        if (tmpColor.r + tmpColor.g + tmpColor.b < 0.06)
          tmpColor.setRGB(0.02, 0.02, 0.02);
        dots.setColorAt(i, tmpColor);
      }
      if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
      for (const { light, range } of lights) {
        if (!rgb) light.intensity = 0;
        else
          drive(light, meanColor(rgb, range[0], range[1]), light.userData.base);
      }
    },
    dispose() {
      disposeTree(group);
    },
  };
}

// Distance from a strip to the surface it lights, when that surface is close
// enough for a visible glow: a strip facing back is mounted on a wall (the
// usual few centimeters off it); a strip facing down lights the floor below.
function glowGap(item: RoomItem): number | null {
  if (item.params.facing === "back") return 0.036;
  if (item.params.facing === "down" && item.position[1] <= 0.8)
    return item.position[1] - 0.003;
  return null;
}

const GLOW_VERTEX = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Additive glow around the strip's outline (rect) or segment (line): the
// light a strip spills onto a nearby wall or floor. Color comes from the
// nearest side (rect: bottom, right, top, left in pixel order) or the third
// of the line the point is over. An area light alone cannot draw this halo:
// three.js area lights cast no light past the strip's own footprint when
// they sit centimeters from the surface.
const GLOW_FRAGMENT = /* glsl */ `
  uniform vec2 uHalf;
  uniform float uSpread;
  uniform float uRect;
  uniform vec3 uColors[4];
  varying vec2 vP;
  void main() {
    vec2 q = abs(vP) - uHalf;
    float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float d = abs(sd);
    vec3 c;
    if (uRect > 0.5) {
      float sx = abs(vP.x) / max(uHalf.x, 1e-3);
      float sy = abs(vP.y) / max(uHalf.y, 1e-3);
      if (sx > sy) c = vP.x > 0.0 ? uColors[1] : uColors[3];
      else c = vP.y > 0.0 ? uColors[2] : uColors[0];
    } else {
      float t = clamp((vP.x / max(uHalf.x, 1e-3) + 1.0) * 0.5, 0.0, 0.999);
      int k = int(floor(t * 3.0));
      c = k == 0 ? uColors[0] : (k == 1 ? uColors[1] : uColors[2]);
    }
    float a = exp(-d / uSpread);
    gl_FragColor = vec4(c * a * 2.0, 1.0);
  }
`;

function glowDecal(
  item: RoomItem,
  facing: V3,
): { mesh: THREE.Mesh; colors: THREE.Vector3[] } | null {
  const gap = glowGap(item);
  if (gap === null) return null;
  const isRect = item.params.shape === "rect";
  const half = isRect
    ? new THREE.Vector2(
        (item.params.width ?? 1.4) / 2,
        (item.params.height ?? 0.8) / 2,
      )
    : new THREE.Vector2((item.params.length ?? 1) / 2, 0);
  const spread = 0.09 + gap * 0.9;
  const margin = spread * 6;
  const colors = [0, 1, 2, 3].map(() => new THREE.Vector3());
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uHalf: { value: half },
      uSpread: { value: spread },
      uRect: { value: isRect ? 1 : 0 },
      uColors: { value: colors },
    },
    vertexShader: GLOW_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(half.x * 2 + margin * 2, half.y * 2 + margin * 2),
    mat,
  );
  // The plane's local x/y must match the strip's: for a back-facing strip
  // the plane already lies in x/y; for a down-facing line, y maps to z.
  mesh.position.set(facing[0] * gap, facing[1] * gap, facing[2] * gap);
  if (item.params.facing === "down") mesh.rotation.x = -Math.PI / 2;
  mesh.userData.decal = true;
  return { mesh, colors };
}

// Wall washer: a small floor unit with a lens and a wide spot aimed up the
// wall behind it (local -z is the wall side).
// Washers cast no shadows: they sit against walls, where shadows add GPU
// cost without visible effect.
function washFixture(item: RoomItem): FixtureNode {
  const group = new THREE.Group();
  const beam = item.params.beamAngle ?? 40;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.07, 0.12),
    matte("#1c1d20"),
  );
  body.position.y = 0.035;
  group.add(body);
  const lensMat = new THREE.MeshBasicMaterial({
    color: 0x050505,
    toneMapped: false,
  });
  const lens = new THREE.Mesh(
    new THREE.BoxGeometry(0.13, 0.008, 0.09),
    lensMat,
  );
  lens.position.y = 0.074;
  group.add(lens);
  const aim = new THREE.Vector3(0, 1, -0.22).normalize();
  const s = spot(SPOT_CD, beam, false);
  s.position.set(0, 0.08, 0);
  s.target.position.copy(aim.clone().multiplyScalar(3)).add(s.position);
  group.add(s, s.target);
  const cone = beamCone(beam, 1.6);
  cone.position.copy(s.position);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), aim);
  group.add(cone);
  const coneMat = cone.material as BeamMaterial;
  return {
    group,
    update(state) {
      const c = state ? meanColor(state.rgb, 0, 1) : { r: 0, g: 0, b: 0 };
      drive(s, c, SPOT_CD);
      setEmitter(lensMat, c);
      setBeam(coneMat, c);
    },
    dispose() {
      disposeTree(group);
    },
  };
}

function setEmitter(mat: THREE.MeshBasicMaterial, c: Rgb): void {
  mat.color.setRGB(c.r, c.g, c.b).multiplyScalar(EMITTER_GAIN);
  if (mat.color.r + mat.color.g + mat.color.b < 0.02)
    mat.color.setRGB(0.02, 0.02, 0.02);
}

function setBeam(mat: BeamMaterial, c: Rgb, gain = 1): void {
  const peak = Math.max(c.r, c.g, c.b);
  if (peak <= 1e-4) {
    mat.uniforms.uOpacity.value = 0;
    return;
  }
  mat.uniforms.uColor.value.setRGB(c.r / peak, c.g / peak, c.b / peak);
  mat.uniforms.uOpacity.value = BEAM_OPACITY * gain * Math.sqrt(peak);
}

// PAR can: a cylinder body aimed along its facing, shadow-casting spot.
function parFixture(item: RoomItem, shadows: boolean): FixtureNode {
  const group = new THREE.Group();
  const beam = item.params.beamAngle ?? 25;
  const dir = new THREE.Vector3(
    ...facingVector(item.params.facing),
  ).normalize();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.11, 0.22, 20),
    matte("#151619"),
  );
  body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  group.add(body);
  const lensMat = new THREE.MeshBasicMaterial({
    color: 0x050505,
    toneMapped: false,
  });
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.085, 20), lensMat);
  lens.position.copy(dir.clone().multiplyScalar(0.111));
  lens.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  group.add(lens);
  const s = spot(PAR_CD, beam, shadows);
  s.position.copy(dir.clone().multiplyScalar(0.12));
  s.target.position.copy(dir.clone().multiplyScalar(4));
  group.add(s, s.target);
  const cone = beamCone(beam, 2.4);
  cone.position.copy(s.position);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
  group.add(cone);
  const coneMat = cone.material as BeamMaterial;
  return {
    group,
    update(state) {
      const c = state ? meanColor(state.rgb, 0, 1) : { r: 0, g: 0, b: 0 };
      drive(s, c, PAR_CD);
      setEmitter(lensMat, c);
      setBeam(coneMat, c);
    },
    dispose() {
      disposeTree(group);
    },
  };
}

// Strobe: a wide LED panel and a point light.
function strobeFixture(): FixtureNode {
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.07), matte("#141518")),
  );
  const panelMat = new THREE.MeshBasicMaterial({
    color: 0x050505,
    toneMapped: false,
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.1), panelMat);
  panel.position.z = 0.036;
  group.add(panel);
  const pl = new THREE.PointLight(0xffffff, 0, 0, 2);
  pl.position.z = 0.25;
  group.add(pl);
  return {
    group,
    update(state) {
      const c = state ? meanColor(state.rgb, 0, 1) : { r: 0, g: 0, b: 0 };
      drive(pl, c, STROBE_CD);
      setEmitter(panelMat, c);
    },
    dispose() {
      disposeTree(group);
    },
  };
}

// Floor lamp: base, pole and a glowing shade with a point light inside.
function lampFixture(): FixtureNode {
  const group = new THREE.Group();
  const metal = matte("#2a2a2c", 0.4);
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.18, 0.03, 24),
    metal,
  );
  base.position.y = 0.015;
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 1.4, 8),
    metal,
  );
  pole.position.y = 0.72;
  group.add(base, pole);
  const shadeMat = new THREE.MeshStandardMaterial({
    color: "#e9e1d4",
    roughness: 0.9,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(0, 0, 0),
  });
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.24, 0.3, 28, 1, true),
    shadeMat,
  );
  shade.position.y = 1.5;
  shade.castShadow = false;
  group.add(shade);
  const pl = new THREE.PointLight(0xffffff, 0, 0, 2);
  pl.position.y = 1.5;
  group.add(pl);
  return {
    group,
    update(state) {
      const c = state ? meanColor(state.rgb, 0, 1) : { r: 0, g: 0, b: 0 };
      drive(pl, c, LAMP_CD);
      shadeMat.emissive.setRGB(c.r, c.g, c.b).multiplyScalar(1.8);
    },
    dispose() {
      disposeTree(group);
    },
  };
}

// Moving head: base, yoke (pans about y) and head (tilts about x), with a
// narrow shadow-casting spot along the head's -z.
function movingHeadFixture(item: RoomItem, shadows: boolean): FixtureNode {
  const group = new THREE.Group();
  const beam = item.params.beamAngle ?? 14;
  const dark = matte("#16171a", 0.5);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.22), dark);
  base.position.y = 0.05;
  group.add(base);
  const yoke = new THREE.Group();
  yoke.position.y = 0.1;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.24, 0.07), dark);
  armL.position.set(-0.11, 0.12, 0);
  const armR = armL.clone();
  armR.position.x = 0.11;
  yoke.add(armL, armR);
  const head = new THREE.Group();
  head.position.y = 0.17;
  const can = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.09, 0.2, 18),
    dark,
  );
  can.rotation.x = Math.PI / 2;
  head.add(can);
  const lensMat = new THREE.MeshBasicMaterial({
    color: 0x050505,
    toneMapped: false,
  });
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.06, 18), lensMat);
  lens.position.z = -0.101;
  lens.rotation.y = Math.PI;
  head.add(lens);
  const s = spot(HEAD_CD, beam, shadows);
  s.position.z = -0.11;
  s.target.position.set(0, 0, -5);
  head.add(s, s.target);
  const cone = beamCone(beam, 3.2);
  cone.position.z = -0.11;
  head.add(cone);
  yoke.add(head);
  group.add(yoke);
  const coneMat = cone.material as BeamMaterial;
  return {
    group,
    update(state, t, bpm) {
      const { pan, tilt } = movingHeadAim(t, bpm);
      yoke.rotation.y = pan;
      // Tilt up from horizontal toward the ceiling.
      head.rotation.x = tilt;
      const c = state ? meanColor(state.rgb, 0, 1) : { r: 0, g: 0, b: 0 };
      drive(s, c, HEAD_CD);
      setEmitter(lensMat, c);
      setBeam(coneMat, c, 1.6);
    },
    dispose() {
      disposeTree(group);
    },
  };
}

export function buildFixture(item: RoomItem, shadows: boolean): FixtureNode {
  switch (item.kind) {
    case "strip":
    case "strip_curve":
    case "tube":
      return pixelFixture(item);
    case "wash":
      return washFixture(item);
    case "par":
      return parFixture(item, shadows);
    case "strobe":
      return strobeFixture();
    case "lamp":
      return lampFixture();
    case "moving_head":
      return movingHeadFixture(item, shadows);
    default:
      return { group: new THREE.Group(), update() {}, dispose() {} };
  }
}
