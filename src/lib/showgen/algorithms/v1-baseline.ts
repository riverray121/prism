// v1-baseline: favorites (storage.DEFAULT_FAVORITES on an un-starred song)
// grouped per stem into programs by autoMap, patched to lights round-robin in
// light order, colored from the palette so comparisons with later algorithms
// differ in selection and motion, not in color. Frozen: it is the reference
// the later algorithms are compared against.

import { autoMap } from "$lib/mapping/automap";
import { sourceLabel } from "$lib/mapping/labels";
import { MappingDocSchema } from "$lib/mapping/schema";
import { applyPalette } from "$lib/showgen/palettes";
import type { ShowAlgorithm, ShowInput, ShowResult } from "$lib/showgen/types";

export const v1Baseline: ShowAlgorithm = {
  id: "v1-baseline",
  label: "v1 baseline",
  description:
    "Default favorites grouped per stem into programs, lights patched round-robin.",
  generate({ profile, lights, palette }: ShowInput): ShowResult {
    const proposal = autoMap(profile, MappingDocSchema.parse({}), {
      intensity: "feature",
    });
    const programs = applyPalette(proposal.programs, palette);
    const patch: Record<string, string> = {};
    if (programs.length > 0)
      lights.forEach((light, i) => {
        patch[light.id] = programs[i % programs.length].id;
      });
    const favorites = new Set(profile.favorites);
    return {
      programs,
      derivations: [],
      patch,
      macro: {
        scenes_from: proposal.scenesFrom,
        scenes: proposal.scenes,
        master: null,
      },
      report: {
        algorithm: "v1-baseline",
        candidates: [...favorites].map((path, i) => ({
          path,
          label: sourceLabel(path),
          family: path,
          measures: {},
          score: 0,
          rank: i + 1,
          picked: true,
          reason: "favorite",
        })),
        picks: programs.map((p) => ({
          path: p.id,
          programId: p.id,
          lights: Object.keys(patch).filter((id) => patch[id] === p.id),
        })),
        notes: programs.length ? [] : ["no usable favorites"],
      },
    };
  },
};
