// Program builders per style. Each returns plain schema objects; color comes
// from the palette afterwards (palettes.ts) or from a section-hue binding.

import type { Binding, Derivation, Program } from "$lib/mapping/schema";
import { percentile } from "$lib/showgen/measures";
import { hueSaturation } from "$lib/showgen/palettes";

// Brightness follows the envelope over its p5..p98 range, gamma 1.6 for
// contrast, smoothed 150 ms. solidFrame adds a 12 % floor while lit.
export function glowBrightness(path: string, data: ArrayLike<number>): Binding {
  const lo = percentile(data, 5);
  let hi = percentile(data, 98);
  if (hi <= lo) hi = lo + 1e-3;
  return {
    source: path,
    transform: [
      { normalize: { min: lo, max: hi, curve: "gamma", gamma: 1.6 } },
      { smooth: { window_s: 0.15 } },
    ],
  };
}

export function glowProgram(
  id: string,
  name: string,
  path: string,
  data: ArrayLike<number>,
): Program {
  return {
    id,
    name,
    enabled: true,
    channels: { brightness: glowBrightness(path, data) },
  };
}

// Peak-picked events over the envelope: the cutoff sits at the track's p70
// so only clear hits fire.
export function onsetDerivation(
  id: string,
  path: string,
  data: ArrayLike<number>,
): Derivation {
  const cutoff = Math.min(0.8, Math.max(0.15, percentile(data, 70)));
  return {
    id,
    name: `${id} hits`,
    source: path,
    threshold: { cutoff, max: 1, sensitivity: 0.6, mode: "events" },
  };
}

// Flash per event: 20 ms attack, 30 ms hold, decay over `decayS`.
export function flashProgram(
  id: string,
  name: string,
  derivationId: string,
  decayS: number,
): Program {
  return {
    id,
    name,
    enabled: true,
    channels: {
      brightness: {
        source: `derived.${derivationId}`,
        transform: [
          { envelope: { attack_s: 0.02, hold_s: 0.03, decay_s: decayS } },
        ],
      },
    },
  };
}

// Hue and saturation that step with the song's sections: each section label
// takes a palette color, starting at `offset`, so the room's color follows
// the structure. Labels are taken in order of first appearance.
export function sectionColor(
  sections: { label: string }[],
  colors: string[],
  offset: number,
): { hue: Binding; saturation: Binding } {
  const labels: string[] = [];
  for (const s of sections) if (!labels.includes(s.label)) labels.push(s.label);
  const hue: Record<string, number> = {};
  const sat: Record<string, number> = {};
  labels.forEach((label, i) => {
    const c = hueSaturation(colors[(offset + i) % colors.length]);
    // A bound hue track is 0–1 of a turn (the evaluator scales it ×360);
    // only constants are degrees.
    hue[label] = c.hue / 360;
    sat[label] = c.saturation;
  });
  return {
    hue: { source: "mix.sections", transform: [{ categorical: { map: hue } }] },
    saturation: {
      source: "mix.sections",
      transform: [{ categorical: { map: sat } }],
    },
  };
}
