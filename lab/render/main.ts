// Headless render page for `pnpm lab render`: one simulator scene per
// algorithm over the same room and song, composited into one canvas with
// labels and an info panel. The driver calls lab.load once per song, then
// lab.frame(t) per output frame and encodes the returned JPEG.

import { oklchToCss } from "$lib/color";
import {
  ProfileSchema,
  type MixFeature,
  type Profile,
} from "$lib/ipc/messages";
import { channelColor } from "$lib/mapping/evaluate";
import { MappingDocSchema, type MappingDoc } from "$lib/mapping/schema";
import { parseNpy } from "$lib/npy";
import { RoomSchema, roomLights } from "$lib/sim/room";
import { createSimScene, type SimScene } from "$lib/sim/scene";
import {
  evaluateForLights,
  sampleLights,
  type OutputsByPixels,
} from "$lib/showgen/lightstate";
import type { LightSpec, ShowResult } from "$lib/showgen/types";

interface LoadConfig {
  roomUrl: string;
  songDir: string;
  title: string;
  artist: string;
  tileWidth: number;
  tileHeight: number;
  single: boolean;
  shows: { id: string; label: string; url: string }[];
}

interface Tile {
  label: string;
  doc: MappingDoc;
  outputs: OutputsByPixels;
  canvas: HTMLCanvasElement;
  scene: SimScene;
  legend: { light: string; program: string; color: string; role?: string }[];
}

let profile: Profile | null = null;
let lights: LightSpec[] = [];
let tiles: Tile[] = [];
let cfg: LoadConfig | null = null;
let bpm = 120;
const out = document.getElementById("out") as HTMLCanvasElement;
const ctx = out.getContext("2d")!;

async function hydrate(
  dir: string,
  features: Record<string, MixFeature>,
): Promise<void> {
  await Promise.all(
    Object.values(features).map(async (f) => {
      if (f.render !== "continuous") return;
      const resp = await fetch(`${dir}/${f.sidecar}`);
      f.data = parseNpy(await resp.arrayBuffer()).data;
    }),
  );
}

async function loadProfile(dir: string): Promise<Profile> {
  const p = ProfileSchema.parse(
    await (await fetch(`${dir}/profile.json`)).json(),
  );
  await hydrate(dir, p.mix);
  for (const stems of Object.values(p.stems))
    for (const stem of Object.values(stems)) {
      await hydrate(dir, stem.features);
      for (const sub of Object.values(stem.substems ?? {}))
        await hydrate(dir, sub.features);
    }
  return p;
}

async function load(c: LoadConfig): Promise<boolean> {
  try {
    for (const t of tiles) t.scene.dispose();
    tiles = [];
    document.getElementById("tiles")!.replaceChildren();
    cfg = c;
    const room = RoomSchema.parse(await (await fetch(c.roomUrl)).json());
    lights = roomLights(room);
    profile = await loadProfile(c.songDir);
    const bpmF = profile.mix.bpm;
    bpm =
      bpmF?.render === "scalar" &&
      typeof bpmF.value === "number" &&
      bpmF.value > 0
        ? bpmF.value
        : 120;
    const w = c.single ? c.tileWidth * 2 : c.tileWidth;
    const h = c.single ? c.tileHeight * 2 : c.tileHeight;
    out.width = c.tileWidth * 2;
    out.height = c.tileHeight * 2;
    for (const show of c.shows) {
      const file = (await (await fetch(show.url)).json()) as {
        result: ShowResult;
      };
      const r = file.result;
      const doc = MappingDocSchema.parse({
        derivations: r.derivations,
        programs: r.programs,
        macro: r.macro,
        patch: r.patch,
      });
      const outputs = evaluateForLights(profile, doc, lights);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      document.getElementById("tiles")!.append(canvas);
      const scene = createSimScene(canvas, room, { pixelRatio: 1 });
      scene.resize(w, h);
      const legend = lights.map((l) => {
        const pid = doc.patch[l.id];
        const program = doc.programs.find((p) => p.id === pid);
        const frame = Math.floor(profile!.timeline.frame_count / 2);
        const o = pid ? outputs.get(l.pixelCount)?.[pid] : undefined;
        return {
          light: l.name,
          program: program?.name ?? pid ?? "off",
          color: o
            ? oklchToCss({ ...channelColor(o.channels, frame), l: 0.72 })
            : "#444",
          role: r.report.picks.find((p) => p.programId === pid)?.role,
        };
      });
      tiles.push({ label: show.label, doc, outputs, canvas, scene, legend });
    }
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

function sectionAt(t: number): string {
  const s = profile?.mix.sections;
  if (s?.render !== "segment") return "";
  return s.segments.find((x) => t >= x.start && t < x.end)?.label ?? "";
}

function mmss(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function drawLabel(text: string, x: number, y: number): void {
  ctx.font = "600 22px -apple-system, Helvetica, sans-serif";
  const w = ctx.measureText(text).width + 24;
  ctx.fillStyle = "rgba(17,18,20,0.72)";
  ctx.beginPath();
  ctx.roundRect(x + 16, y + 16, w, 36, 6);
  ctx.fill();
  ctx.fillStyle = "#e6e7ea";
  ctx.fillText(text, x + 28, y + 41);
}

function drawInfo(t: number, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = "#18191c";
  ctx.fillRect(x, y, w, h);
  const pad = 32;
  ctx.fillStyle = "#e6e7ea";
  ctx.font = "600 30px -apple-system, Helvetica, sans-serif";
  ctx.fillText(cfg!.title, x + pad, y + pad + 28);
  ctx.fillStyle = "#9a9ca3";
  ctx.font = "400 22px -apple-system, Helvetica, sans-serif";
  ctx.fillText(
    `${cfg!.artist}  ·  ${mmss(t)}  ·  ${sectionAt(t)}  ·  ${Math.round(bpm)} BPM`,
    x + pad,
    y + pad + 62,
  );
  const colW = (w - pad * 2) / Math.max(1, tiles.length);
  tiles.forEach((tile, k) => {
    const cx = x + pad + k * colW;
    let cy = y + pad + 110;
    ctx.fillStyle = "#6d7078";
    ctx.font = "600 15px -apple-system, Helvetica, sans-serif";
    ctx.fillText(tile.label.toUpperCase(), cx, cy);
    cy += 26;
    ctx.font = "400 15px -apple-system, Helvetica, sans-serif";
    for (const row of tile.legend) {
      ctx.fillStyle = row.color;
      ctx.fillRect(cx, cy - 11, 11, 11);
      ctx.fillStyle = "#c9cace";
      const text = `${row.light}: ${row.program}${row.role ? ` (${row.role})` : ""}`;
      ctx.fillText(
        text.length > 34 ? `${text.slice(0, 33)}…` : text,
        cx + 18,
        cy,
      );
      cy += 22;
    }
  });
}

// Four tiles fill the grid: song, time and section go in a strip across the
// middle instead of the info panel.
function drawBanner(t: number): void {
  const text = `${cfg!.artist} - ${cfg!.title}   ·   ${mmss(t)}   ·   ${sectionAt(t)}`;
  ctx.font = "600 22px -apple-system, Helvetica, sans-serif";
  const w = ctx.measureText(text).width + 40;
  const x = (out.width - w) / 2;
  const y = out.height / 2 - 20;
  ctx.fillStyle = "rgba(17,18,20,0.8)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, 40, 8);
  ctx.fill();
  ctx.fillStyle = "#e6e7ea";
  ctx.fillText(text, x + 20, y + 28);
}

function frame(t: number): string {
  if (!profile || !cfg) return "";
  const W = cfg.tileWidth;
  const H = cfg.tileHeight;
  ctx.fillStyle = "#111214";
  ctx.fillRect(0, 0, out.width, out.height);
  const slots = cfg.single
    ? [[0, 0]]
    : [
        [0, 0],
        [W, 0],
        [0, H],
        [W, H],
      ];
  tiles.forEach((tile, k) => {
    const states = sampleLights(profile!, tile.doc, tile.outputs, lights, t);
    tile.scene.setLightStates(states, t, bpm);
    tile.scene.render();
    const [x, y] = slots[k];
    ctx.drawImage(
      tile.canvas,
      x,
      y,
      cfg!.single ? W * 2 : W,
      cfg!.single ? H * 2 : H,
    );
    drawLabel(tile.label, x, y);
  });
  if (!cfg.single && tiles.length < 4) drawInfo(t, W, H, W, H);
  else if (tiles.length === 4) drawBanner(t);
  return out.toDataURL("image/jpeg", 0.92).split(",")[1];
}

(window as unknown as { lab: unknown }).lab = { load, frame };
