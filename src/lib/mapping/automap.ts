// On-demand auto-map: propose a starter show from the FAVORITED features
// only. Pure — invoked exclusively by the Generate button, never on song
// open; hand authoring is the primary flow and a proposal only ever appends.

import type { Profile } from "$lib/ipc/messages";
import type { MappingDoc, Program, Scene } from "$lib/mapping/schema";
import { favoriteSources, resolveFeature } from "$lib/mapping/sources";

export interface AutoMapProposal {
  programs: Program[];
  // Set when sections are favorited and the doc has no scene source yet.
  scenesFrom: string | null;
  // One seed preset per detected section label (all programs, full scale).
  scenes: Record<string, Scene>;
}

export interface AutoMapOptions {
  // Brightness reference for energy → brightness bindings:
  //  - "feature": each source normalizes to its own range, so every program
  //    reaches full brightness at its own loudest moment.
  //  - "song": stem sources anchor to the mix's matching feature range, so a
  //    quiet stem stays proportionally dim within the song.
  intensity: "feature" | "song";
}

// Binding choices by feature kind (see the mapping catalog): energy-like →
// brightness (silent normalize+smooth default), onsets/beats → gate,
// centroid-like → color_temp, a favorited heatmap → the pixel row.
const ENERGY_RE = /energy|rms|loudness|peak/;
const GATE_RE = /onset|beat/;
const CENTROID_RE = /centroid/;

// Group key: which light-ish entity a favorite belongs to — the mix or one
// stem — so each group becomes one program.
function groupOf(path: string): string {
  const parts = path.split(".");
  if (parts[0] !== "stems") return "mix";
  // stems.{engine}.{stem}[.substems.{sub}].features.{name}
  const sub = parts[3] === "substems" ? `_${parts[4]}` : "";
  return `${parts[2]}${sub}`;
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

// Brightness transform chain per the intensity option. "feature" leaves the
// chain empty (the evaluator's silent normalize+smooth default, own range).
// "song" pins normalize to the mix's energy range — the same-named mix
// feature when present, else mix.rms (stem energy and mix rms share units) —
// so a stem's brightness scales relative to the whole song.
function brightnessChain(
  profile: Profile,
  path: string,
  name: string,
  intensity: AutoMapOptions["intensity"],
): Program["channels"]["brightness"] {
  if (intensity === "song") {
    for (const ref of [`mix.${name}`, "mix.rms"]) {
      if (ref === path) break; // the mix's own program: own range is the song
      const mixFeature = resolveFeature(profile, ref);
      if (mixFeature?.render !== "continuous" || mixFeature.data.length === 0)
        continue;
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of mixFeature.data) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi <= lo) continue;
      return {
        source: path,
        transform: [
          { normalize: { min: lo, max: hi, curve: "linear", gamma: 2 } },
          { smooth: { window_s: 0.08 } },
        ],
      };
    }
  }
  return { source: path, transform: [] };
}

export function autoMap(
  profile: Profile,
  existing: MappingDoc,
  options: AutoMapOptions = { intensity: "feature" },
): AutoMapProposal {
  const proposal: AutoMapProposal = {
    programs: [],
    scenesFrom: null,
    scenes: {},
  };

  // Bucket favorited features into per-group channel candidates.
  const groups = new Map<string, Program["channels"]>();
  let sectionsPath: string | null = null;
  for (const { path, feature } of favoriteSources(profile)) {
    const name = path.split(".").at(-1) ?? "";
    const group = () => {
      const key = groupOf(path);
      let channels = groups.get(key);
      if (!channels) {
        channels = {};
        groups.set(key, channels);
      }
      return channels;
    };
    if (feature.render === "continuous" && ENERGY_RE.test(name)) {
      const channels = group();
      if (!channels.brightness)
        channels.brightness = brightnessChain(
          profile,
          path,
          name,
          options.intensity,
        );
    } else if (feature.render === "event" && GATE_RE.test(name)) {
      const channels = group();
      if (!channels.gate) channels.gate = { source: path, transform: [] };
    } else if (feature.render === "continuous" && CENTROID_RE.test(name)) {
      const channels = group();
      if (!channels.color_temp)
        channels.color_temp = {
          source: path,
          transform: [
            { normalize: { min: null, max: null, curve: "linear", gamma: 2 } },
          ],
        };
    } else if (feature.render === "heatmap") {
      const channels = group();
      if (!channels.position)
        channels.position = { source: path, transform: [] };
    } else if (feature.render === "segment" && name === "sections") {
      sectionsPath = path;
    }
  }

  // Materialize groups into programs, ids uniqued against the existing doc.
  const taken = new Set(existing.programs.map((p) => p.id));
  for (const [group, channels] of groups) {
    if (Object.keys(channels).length === 0) continue;
    const id = uniqueId(`auto_${group}`, taken);
    taken.add(id);
    proposal.programs.push({ id, enabled: true, channels });
  }

  // Scenes only when sections are favorited, never overriding an existing
  // scene source; seed one identity preset per label so every section is
  // editable. Presets cover existing programs plus the proposed ones.
  if (sectionsPath && existing.macro.scenes_from === null) {
    const feature = resolveFeature(profile, sectionsPath);
    if (feature?.render === "segment" && proposal.programs.length > 0) {
      proposal.scenesFrom = sectionsPath;
      const allPrograms = [
        ...existing.programs.map((p) => p.id),
        ...proposal.programs.map((p) => p.id),
      ];
      for (const seg of feature.segments) {
        if (
          !(seg.label in proposal.scenes) &&
          !(seg.label in existing.macro.scenes)
        ) {
          proposal.scenes[seg.label] = {
            programs: allPrograms,
            master_scale: 1,
          };
        }
      }
    }
  }

  return proposal;
}

// Whether a proposal has anything to add (empty favorites → nothing).
export function proposalIsEmpty(proposal: AutoMapProposal): boolean {
  return proposal.programs.length === 0 && proposal.scenesFrom === null;
}
