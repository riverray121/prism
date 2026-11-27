// Curated color palettes for shows. Each palette is mostly one color family,
// with at most one outlier that still belongs (marked `outlier`). Applying a
// palette writes hue and saturation constants onto programs, so the
// evaluator, the hardware streamer and published frames need no palette
// support of their own.
//
// Colors are chosen for LEDs: no near-black (reads as dim brown) and few
// very pale tones (LEDs show pale colors as white).

import type { Oklch } from "$lib/color";
import type { Program } from "$lib/mapping/schema";
import type { PaletteRef } from "$lib/showgen/types";

export interface Palette {
  id: string;
  name: string;
  colors: string[];
  // Index into colors of the outlier, when the palette has one.
  outlier?: number;
}

export const DEFAULT_PALETTE: PaletteRef = { id: "blue" };
export const SINGLE_PALETTE_ID = "single";

export const PALETTES: Palette[] = [
  {
    id: "blue",
    name: "Deep blue",
    colors: ["#2B6CC4", "#1F4E9C", "#3B8ED8", "#5AAEE6", "#2A3F8F"],
  },
  {
    id: "coastal",
    name: "Coastal",
    colors: ["#2B6CC4", "#1E8C93", "#3FA7A3", "#A0784F"],
  },
  {
    id: "desert-rose",
    name: "Desert rose",
    colors: ["#D2B48C", "#F2E3C6", "#E8CFA4", "#C8302C"],
    outlier: 3,
  },
  {
    id: "ember",
    name: "Ember",
    colors: ["#F2A541", "#E8743B", "#D4482B", "#B83A4B"],
  },
  {
    id: "forest",
    name: "Forest",
    colors: ["#2E7D4F", "#4E9F5D", "#7DBF6A", "#E3B23C"],
    outlier: 3,
  },
  {
    id: "neon-night",
    name: "Neon night",
    colors: ["#C03CC4", "#7A3CD6", "#4A47D8", "#2EC4D6"],
    outlier: 3,
  },
  {
    id: "indie-dusk",
    name: "Indie dusk",
    colors: ["#F4A259", "#E8705A", "#D45D79", "#8E4A8C", "#3F6FA8"],
  },
  {
    id: "sakura",
    name: "Sakura",
    colors: ["#F4A6C0", "#E87EA1", "#F7C9D6", "#D9668C"],
  },
  {
    id: "sunset",
    name: "Sunset",
    colors: ["#F28C5A", "#F6B15A", "#E96A6A", "#7B4FC9"],
    outlier: 3,
  },
  {
    id: "arctic",
    name: "Arctic",
    colors: ["#9FD3EE", "#6FB8E0", "#D3ECF7", "#7C6FE0"],
    outlier: 3,
  },
  {
    id: "lagoon",
    name: "Lagoon",
    colors: ["#127A7A", "#1E9E9A", "#44C2B4", "#F2C14E"],
    outlier: 3,
  },
  {
    id: "rose-gold",
    name: "Rose gold",
    colors: ["#E8A87C", "#D98E73", "#F0C4A0", "#C76B6B"],
  },
];

export function paletteById(id: string): Palette | undefined {
  return PALETTES.find((p) => p.id === id);
}

// The colors a palette ref resolves to; an unknown id falls back to blue.
export function resolvePalette(ref: PaletteRef): Palette {
  if (ref.id === SINGLE_PALETTE_ID)
    return {
      id: SINGLE_PALETTE_ID,
      name: "Single color",
      colors: [ref.color ?? "#2B6CC4"],
    };
  return paletteById(ref.id) ?? PALETTES[0];
}

// ── sRGB hex → OKLCH (Björn Ottosson's OKLab) ───────────────────────────────

function decode(x: number): number {
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

export function hexToOklch(hex: string): Oklch {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) =>
    decode(parseInt(h.slice(i, i + 2), 16) / 255),
  );
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  let hue = (Math.atan2(B, A) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return { l: L, c, h: hue };
}

// channelColor maps saturation s to chroma 0.32·s, so a palette color's
// chroma becomes saturation c / 0.32.
export function hueSaturation(hex: string): {
  hue: number;
  saturation: number;
} {
  const { c, h } = hexToOklch(hex);
  return { hue: h, saturation: Math.min(1, c / 0.32) };
}

// Palette slot order for n programs: the non-outlier colors cycle; the
// outlier goes only to the accent program.
function baseSlots(p: Palette): string[] {
  return p.colors.filter((_, i) => i !== p.outlier);
}

// Color each program from the palette: program i takes base color i mod n,
// the accent program (when given and the palette has an outlier) takes the
// outlier. Programs keep every other channel.
export function applyPalette(
  programs: Program[],
  ref: PaletteRef,
  accentProgramId?: string,
): Program[] {
  const palette = resolvePalette(ref);
  const base = baseSlots(palette);
  let i = 0;
  return programs.map((program) => {
    const hex =
      accentProgramId === program.id && palette.outlier !== undefined
        ? palette.colors[palette.outlier]
        : base[i++ % base.length];
    const { hue, saturation } = hueSaturation(hex);
    const channels = { ...program.channels, hue, saturation };
    delete channels.color_temp;
    return { ...program, channels };
  });
}

// Recolor programs for a new palette while keeping how their color moves:
// a hue bound to the song's sections through a categorical map keeps its
// labels and takes the new palette's colors (from the program's own offset,
// its position among non-accent programs); a fixed hue takes the base color
// at that offset; the accent program takes the outlier at its own
// saturation. Every other channel is untouched.
export function recolorPrograms(
  programs: Program[],
  ref: PaletteRef,
  accentProgramId?: string,
): Program[] {
  const palette = resolvePalette(ref);
  const base = baseSlots(palette);
  let offset = 0;
  return programs.map((program) => {
    const channels = { ...program.channels };
    if (accentProgramId === program.id) {
      const hex =
        palette.outlier !== undefined
          ? palette.colors[palette.outlier]
          : base[0];
      channels.hue = hueSaturation(hex).hue;
      if (typeof channels.saturation !== "number")
        channels.saturation = hueSaturation(hex).saturation;
      return { ...program, channels };
    }
    const i = offset++;
    const hue = channels.hue;
    const step =
      typeof hue === "object" && hue.source === "mix.sections"
        ? hue.transform.find((s) => "categorical" in s)
        : undefined;
    if (typeof hue === "object" && step && "categorical" in step) {
      const labels = Object.keys(step.categorical.map);
      const hueMap: Record<string, number> = {};
      const satMap: Record<string, number> = {};
      labels.forEach((label, k) => {
        const c = hueSaturation(base[(i + k) % base.length]);
        // Bound hue tracks are 0–1 of a turn; the evaluator scales ×360.
        hueMap[label] = c.hue / 360;
        satMap[label] = c.saturation;
      });
      channels.hue = {
        source: "mix.sections",
        transform: [{ categorical: { map: hueMap } }],
      };
      channels.saturation = {
        source: "mix.sections",
        transform: [{ categorical: { map: satMap } }],
      };
    } else {
      const c = hueSaturation(base[i % base.length]);
      channels.hue = c.hue;
      channels.saturation = c.saturation;
      delete channels.color_temp;
    }
    return { ...program, channels };
  });
}
