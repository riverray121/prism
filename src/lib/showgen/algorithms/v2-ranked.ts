// v2-ranked: signal-scored candidates, MMR for distinct picks, one glow
// program per pick (docs/milestone-8-show-lab/ranking.md). Frozen once
// compared; changes go in a new version.

import { MacroSchema, type Program } from "$lib/mapping/schema";
import { uniqueId } from "$lib/mapping/automap";
import { enumerateCandidates } from "$lib/showgen/candidates";
import { applyPalette } from "$lib/showgen/palettes";
import {
  measureCandidates,
  selectMMR,
  songContext,
  type Measured,
} from "$lib/showgen/select";
import { glowProgram } from "$lib/showgen/styles";
import type {
  CandidateReport,
  ShowAlgorithm,
  ShowInput,
  ShowResult,
} from "$lib/showgen/types";

export function programId(m: Measured, taken: Set<string>): string {
  const c = m.candidate;
  const base = c.kind === "mix" ? c.path.replace("mix.", "mix_") : c.family;
  const id = uniqueId(base, taken);
  taken.add(id);
  return id;
}

export function reportCandidates(
  measured: Measured[],
  picks: Measured[],
  passed: Map<string, string>,
  roles: Map<string, string> = new Map(),
): CandidateReport[] {
  return measured
    .map((m) => {
      const rank = picks.indexOf(m);
      return {
        path: m.candidate.path,
        label: m.candidate.label,
        family: m.candidate.family,
        measures: m.measures,
        score: m.score,
        rank: rank >= 0 ? rank + 1 : null,
        picked: rank >= 0,
        reason:
          rank >= 0
            ? `pick ${rank + 1}`
            : (m.rejected ?? passed.get(m.candidate.path) ?? "not reached"),
        role: roles.get(m.candidate.path),
      };
    })
    .sort((a, b) => b.score - a.score);
}

export const v2Ranked: ShowAlgorithm = {
  id: "v2-ranked",
  label: "v2 ranked",
  description:
    "Signal-scored tracks, near-duplicates removed, one glow program per light.",
  generate({ profile, lights, palette }: ShowInput): ShowResult {
    const ctx = songContext(profile);
    const measured = measureCandidates(enumerateCandidates(profile), ctx);
    const { picks, passed } = selectMMR(measured, lights.length);

    const taken = new Set<string>();
    const programs: Program[] = picks.map((m) =>
      glowProgram(
        programId(m, taken),
        m.candidate.label,
        m.candidate.path,
        m.candidate.data,
      ),
    );
    // More lights than picks: each extra light gets a copy of a pick in score
    // order as its own program, so it takes a different palette slot.
    const patch: Record<string, string> = {};
    const pickOf: string[] = [];
    lights.forEach((light, i) => {
      if (programs.length === 0) return;
      if (i < picks.length) {
        patch[light.id] = programs[i].id;
        pickOf.push(picks[i].candidate.path);
        return;
      }
      const source = programs[(i - picks.length) % picks.length];
      const id = uniqueId(`${source.id}_alt`, taken);
      taken.add(id);
      programs.push({ ...source, id, name: `${source.name} (alt)` });
      patch[light.id] = id;
      pickOf.push(picks[(i - picks.length) % picks.length].candidate.path);
    });

    const colored = applyPalette(programs, palette);
    return {
      programs: colored,
      derivations: [],
      patch,
      macro: MacroSchema.parse({}),
      report: {
        algorithm: "v2-ranked",
        candidates: reportCandidates(measured, picks, passed),
        picks: colored.map((p) => ({
          path: pickOf[lights.findIndex((l) => patch[l.id] === p.id)] ?? p.id,
          programId: p.id,
          lights: lights.filter((l) => patch[l.id] === p.id).map((l) => l.id),
        })),
        notes:
          picks.length < lights.length
            ? [
                `${picks.length} distinct tracks for ${lights.length} lights; extra lights repeat picks in another color`,
              ]
            : [],
      },
    };
  },
};
