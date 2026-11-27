// v3-roles: v2's ranking and selection, plus a role per pick that decides how
// its program moves (pulse flashes on hits, swell follows the envelope,
// accent fires short bright hits), placement of each role on the fixture
// kinds that suit it, section-stepped palette color, and a per-section level
// from the mix's loudness (docs/milestone-8-show-lab/ranking.md, Roles).
// Frozen once compared; changes go in a new version.

import type { Derivation, Macro, Program } from "$lib/mapping/schema";
import { uniqueId } from "$lib/mapping/automap";
import { enumerateCandidates } from "$lib/showgen/candidates";
import { visibleChange } from "$lib/showgen/measures";
import { hueSaturation, resolvePalette } from "$lib/showgen/palettes";
import {
  measureCandidates,
  selectMMR,
  songContext,
  type Measured,
  type SongContext,
} from "$lib/showgen/select";
import {
  flashProgram,
  glowBrightness,
  onsetDerivation,
  sectionColor,
} from "$lib/showgen/styles";
import type {
  FixtureKind,
  LightSpec,
  ShowAlgorithm,
  ShowInput,
  ShowResult,
} from "$lib/showgen/types";

import { programId, reportCandidates } from "./v2-ranked";

export type Role = "pulse" | "swell" | "accent";

export function roleOf(m: Measured): Role {
  const x = m.measures;
  if (x.pulse >= 0.35 && x.alignment >= 0.5) return "pulse";
  if (x.onset_rate < 0.5 && x.contrast >= 0.6) return "accent";
  return "swell";
}

export const ROLE_KINDS: Record<Role, FixtureKind[]> = {
  pulse: ["strobe", "par", "moving_head", "tube"],
  accent: ["strobe", "moving_head", "par"],
  swell: ["wash", "lamp", "strip", "strip_curve", "tube"],
};

// v3 adds `visible` to v2's measures: a track whose glow would rarely move
// visibly is rejected, and the score scales with how often it moves, so
// every light changes noticeably over the song.
export function applyVisibility(measured: Measured[], hz: number): void {
  for (const m of measured) {
    const visible = visibleChange(m.candidate.data, hz);
    m.measures.visible = visible;
    if (m.rejected) continue;
    if (visible < 0.2) {
      m.rejected = `barely visible on a light (visible ${visible.toFixed(2)})`;
      m.score = 0;
    } else m.score *= 0.5 + 0.5 * visible;
  }
}

// Section level: each label's mean mix loudness over the loudest label's,
// floored at 0.5 so quiet sections dim but stay clearly lit.
export function sectionLevels(ctx: SongContext): Record<string, number> {
  if (!ctx.mixRms || ctx.sections.length === 0) return {};
  const sum: Record<string, number> = {};
  const count: Record<string, number> = {};
  for (const s of ctx.sections) {
    const a = Math.max(0, Math.floor(s.start * ctx.hz));
    const b = Math.min(ctx.mixRms.length, Math.ceil(s.end * ctx.hz));
    for (let i = a; i < b; i++) {
      sum[s.label] = (sum[s.label] ?? 0) + ctx.mixRms[i];
      count[s.label] = (count[s.label] ?? 0) + 1;
    }
  }
  const means = Object.fromEntries(
    Object.keys(sum).map((k) => [k, sum[k] / Math.max(1, count[k])]),
  );
  const top = Math.max(...Object.values(means), 1e-9);
  return Object.fromEntries(
    Object.entries(means).map(([k, v]) => [
      k,
      Math.max(0.5, Math.min(1, v / top)),
    ]),
  );
}

interface Slot {
  pick: Measured;
  role: Role;
}

// Picks in score order go to the first free light of a kind their role
// prefers; leftovers fill the remaining lights in order. With
// `accentKinds`, an accent that finds none of those kinds free becomes a
// swell instead of landing on whatever light is left.
export function placeRoles(
  slots: Slot[],
  lights: LightSpec[],
  accentKinds?: FixtureKind[],
): Map<string, Slot> {
  const placed = new Map<string, Slot>();
  const waiting: Slot[] = [];
  const free = (kind: FixtureKind) =>
    lights.find((l) => l.kind === kind && !placed.has(l.id));
  for (const original of slots) {
    let slot = original;
    if (accentKinds && slot.role === "accent" && !accentKinds.some(free))
      slot = { ...slot, role: "swell" };
    let chosen: LightSpec | undefined;
    for (const kind of ROLE_KINDS[slot.role]) {
      chosen = free(kind);
      if (chosen) break;
    }
    if (chosen) placed.set(chosen.id, slot);
    else waiting.push(slot);
  }
  for (const light of lights) {
    if (placed.has(light.id)) continue;
    const next = waiting.shift();
    if (!next) break;
    placed.set(light.id, next);
  }
  return placed;
}

export interface RoleShowOptions {
  algorithm: string;
  accentKinds?: FixtureKind[];
}

// Programs, patch, section scenes and report for a set of picks, by role.
// Shared by v3 and later role-based algorithms; v3 calls it with roleOf and
// no accent restriction.
export function buildRoleShow(
  { lights, palette }: ShowInput,
  ctx: SongContext,
  measured: Measured[],
  picks: Measured[],
  passed: Map<string, string>,
  roleFn: (m: Measured) => Role,
  options: RoleShowOptions,
): ShowResult {
  const slots: Slot[] = picks.map((pick) => ({ pick, role: roleFn(pick) }));
  const placed = placeRoles(slots, lights, options.accentKinds);
  const roles = new Map<string, string>();
  for (const slot of placed.values())
    roles.set(slot.pick.candidate.path, slot.role);
  for (const slot of slots)
    if (!roles.has(slot.pick.candidate.path))
      roles.set(slot.pick.candidate.path, slot.role);

  const pal = resolvePalette(palette);
  const base = pal.colors.filter((_, i) => i !== pal.outlier);
  const accentHex =
    pal.outlier !== undefined ? pal.colors[pal.outlier] : base[0];
  const decayPulse = Math.max(0.12, 0.6 * ctx.beatPeriodS);

  const taken = new Set<string>();
  const programs: Program[] = [];
  const derivations: Derivation[] = [];
  const patch: Record<string, string> = {};
  const pickOfProgram = new Map<string, Slot>();

  const build = (
    slot: Slot,
    role: Role,
    colorOffset: number,
    suffix = "",
  ): Program => {
    const c = slot.pick.candidate;
    const id = programId(slot.pick, taken) + suffix;
    taken.add(id);
    let program: Program;
    if (role === "swell") {
      program = {
        id,
        name: c.label,
        enabled: true,
        channels: { brightness: glowBrightness(c.path, c.data) },
      };
    } else {
      const dId = uniqueId(`${id}_hits`, new Set(derivations.map((d) => d.id)));
      derivations.push(onsetDerivation(dId, c.path, c.data));
      program = flashProgram(
        id,
        c.label,
        dId,
        role === "pulse" ? decayPulse : 0.25,
      );
    }
    if (role === "accent") {
      const { hue } = hueSaturation(accentHex);
      program.channels.hue = hue;
      program.channels.saturation = 0.3;
    } else if (ctx.sections.length > 0) {
      const color = sectionColor(ctx.sections, base, colorOffset);
      program.channels.hue = color.hue;
      program.channels.saturation = color.saturation;
    } else {
      const { hue, saturation } = hueSaturation(
        base[colorOffset % base.length],
      );
      program.channels.hue = hue;
      program.channels.saturation = saturation;
    }
    programs.push(program);
    pickOfProgram.set(id, { pick: slot.pick, role });
    return program;
  };

  const programOfPick = new Map<string, Program>();
  let offset = 0;
  for (const light of lights) {
    const slot = placed.get(light.id);
    if (!slot) continue;
    let program = programOfPick.get(slot.pick.candidate.path);
    if (!program) {
      program = build(slot, slot.role, offset++);
      programOfPick.set(slot.pick.candidate.path, program);
    }
    patch[light.id] = program.id;
  }
  // More lights than picks: each extra light plays a pick in score order
  // in the other motion (a pulse source as a swell and the reverse) and
  // another color, so no two lights show the same frames.
  let k = 0;
  for (const light of lights) {
    if (patch[light.id] || slots.length === 0) continue;
    const slot = slots[k % slots.length];
    const alt: Role =
      slot.role === "swell" && slot.pick.measures.pulse >= 0.2
        ? "pulse"
        : "swell";
    patch[light.id] = build(slot, alt, offset++, "_alt").id;
    k++;
  }

  const levels = sectionLevels(ctx);
  const macro: Macro = Object.keys(levels).length
    ? {
        scenes_from: "mix.sections",
        scenes: Object.fromEntries(
          Object.entries(levels).map(([label, level]) => [
            label,
            { programs: programs.map((p) => p.id), master_scale: level },
          ]),
        ),
        master: null,
      }
    : { scenes_from: null, scenes: {}, master: null };

  return {
    programs,
    derivations,
    patch,
    macro,
    report: {
      algorithm: options.algorithm,
      candidates: reportCandidates(measured, picks, passed, roles),
      picks: programs.map((p) => ({
        path: pickOfProgram.get(p.id)!.pick.candidate.path,
        programId: p.id,
        lights: lights.filter((l) => patch[l.id] === p.id).map((l) => l.id),
        role: pickOfProgram.get(p.id)!.role,
      })),
      notes:
        picks.length < lights.length
          ? [
              `${picks.length} distinct tracks for ${lights.length} lights; extra lights play a pick in the other motion`,
            ]
          : [],
    },
  };
}

export const v3Roles: ShowAlgorithm = {
  id: "v3-roles",
  label: "v3 roles",
  description:
    "v2 picks with roles (pulse, swell, accent) placed on suitable fixtures, section-stepped color and section levels.",
  generate(input: ShowInput): ShowResult {
    const ctx = songContext(input.profile);
    const measured = measureCandidates(enumerateCandidates(input.profile), ctx);
    applyVisibility(measured, ctx.hz);
    const { picks, passed } = selectMMR(measured, input.lights.length);
    return buildRoleShow(input, ctx, measured, picks, passed, roleOf, {
      algorithm: "v3-roles",
    });
  },
};
