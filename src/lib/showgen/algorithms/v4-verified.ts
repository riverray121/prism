// v4-verified: v3's roles and placement, checked against what each light
// actually does. After building the show it evaluates every light's output
// over the whole song; a pick whose light rarely changes visibly or sits
// near dark is rejected and selection runs again without it. Also: presence
// floor 0.4 (a light dark most of the song is not a show), and accents go
// only to strobes, moving heads and PAR spots (a sparse accent on an
// ambient strip leaves it dark). Frozen once compared.

import { MacroSchema, MappingDocSchema } from "$lib/mapping/schema";
import { enumerateCandidates } from "$lib/showgen/candidates";
import { evaluateForLights, sampleLights } from "$lib/showgen/lightstate";
import {
  measureCandidates,
  selectMMR,
  songContext,
  type Measured,
} from "$lib/showgen/select";
import type { ShowAlgorithm, ShowInput, ShowResult } from "$lib/showgen/types";

import { applyVisibility, buildRoleShow, roleOf } from "./v3-roles";

export const PRESENCE_FLOOR = 0.4;
// A light passes when it changes by more than 0.15 within at least this
// share of 1 s windows, and its mean level is at least MIN_LEVEL.
export const MIN_ACTIVE = 0.35;
export const MIN_LEVEL = 0.1;
const CHECK_HZ = 10;
const MAX_ROUNDS = 4;

export interface LightActivity {
  active: number;
  level: number;
}

// Per light: the share of 1 s windows in which its level moves by more than
// 0.15, and its mean level, over the whole song at CHECK_HZ.
export function lightActivity(
  input: ShowInput,
  result: ShowResult,
): Map<string, LightActivity> {
  const { profile, lights } = input;
  const doc = MappingDocSchema.parse({
    derivations: result.derivations,
    programs: result.programs,
    macro: result.macro,
    patch: result.patch,
  });
  const outputs = evaluateForLights(profile, doc, lights);
  const duration =
    profile.timeline.frame_count / profile.timeline.frame_rate_hz;
  const n = Math.floor(duration * CHECK_HZ);
  const series = new Map(lights.map((l) => [l.id, new Float32Array(n)]));
  for (let i = 0; i < n; i++) {
    const states = sampleLights(profile, doc, outputs, lights, i / CHECK_HZ);
    for (const l of lights) series.get(l.id)![i] = states.get(l.id)?.level ?? 0;
  }
  const out = new Map<string, LightActivity>();
  for (const [id, s] of series) {
    let windows = 0;
    let moving = 0;
    let sum = 0;
    for (let a = 0; a + CHECK_HZ <= s.length; a += CHECK_HZ) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = a; i < a + CHECK_HZ; i++) {
        lo = Math.min(lo, s[i]);
        hi = Math.max(hi, s[i]);
      }
      windows++;
      if (hi - lo > 0.15) moving++;
    }
    for (let i = 0; i < s.length; i++) sum += s[i];
    out.set(id, {
      active: windows ? moving / windows : 0,
      level: s.length ? sum / s.length : 0,
    });
  }
  return out;
}

export const v4Verified: ShowAlgorithm = {
  id: "v4-verified",
  label: "v4 verified",
  description:
    "v3 with every light's output checked over the whole song; dull picks are replaced.",
  generate(input: ShowInput): ShowResult {
    const { profile, lights } = input;
    const ctx = songContext(profile);
    const measured = measureCandidates(enumerateCandidates(profile), ctx);
    applyVisibility(measured, ctx.hz);
    for (const m of measured)
      if (!m.rejected && m.measures.presence < PRESENCE_FLOOR) {
        m.rejected = `present under ${PRESENCE_FLOOR * 100}% of the song (presence ${m.measures.presence.toFixed(2)})`;
        m.score = 0;
      }

    let result: ShowResult | null = null;
    const notes: string[] = [];
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const { picks, passed } = selectMMR(measured, lights.length);
      result = buildRoleShow(input, ctx, measured, picks, passed, roleOf, {
        algorithm: "v4-verified",
        accentKinds: ["strobe", "moving_head", "par"],
      });
      if (picks.length === 0) break;
      const activity = lightActivity(input, result);
      const dull = new Set<string>();
      for (const light of lights) {
        const a = activity.get(light.id);
        const programId = result.patch[light.id];
        const pick = result.report.picks.find((p) => p.programId === programId);
        if (!a || !pick) continue;
        if (a.active < MIN_ACTIVE || a.level < MIN_LEVEL) dull.add(pick.path);
      }
      if (dull.size === 0) break;
      for (const m of measured)
        if (dull.has(m.candidate.path)) {
          const a = [...activity.entries()].find(
            ([id]) =>
              result!.report.picks.find(
                (p) => p.programId === result!.patch[id],
              )?.path === m.candidate.path,
          )?.[1];
          m.rejected = `its light rarely changed as programmed (active ${a?.active.toFixed(2)}, level ${a?.level.toFixed(2)})`;
          m.score = 0;
          notes.push(`round ${round + 1}: replaced ${m.candidate.label}`);
        }
    }
    if (!result)
      return {
        programs: [],
        derivations: [],
        patch: {},
        macro: MacroSchema.parse({}),
        report: {
          algorithm: "v4-verified",
          candidates: [],
          picks: [],
          notes: ["no candidates"],
        },
      };
    result.report.notes.push(...notes);
    return result;
  },
};
