// The show-algorithm contract (docs/milestone-8-show-lab/architecture.md):
// a pure function from a song's analysis, a set of lights and a palette to
// programs, a patch and a report of why each track was or was not chosen.
// The app, vitest and the lab call algorithms through this one shape.

import type { Profile } from "$lib/ipc/messages";
import type { Derivation, Macro, Program } from "$lib/mapping/schema";

// Simulated and real fixture kinds. Real rig lights are WLED strips.
export const FIXTURE_KINDS = [
  "strip",
  "strip_curve",
  "tube",
  "wash",
  "par",
  "strobe",
  "lamp",
  "moving_head",
] as const;
export type FixtureKind = (typeof FIXTURE_KINDS)[number];

// Kinds that render a pixel row; the others are one color per frame.
export const PIXEL_KINDS: ReadonlySet<FixtureKind> = new Set([
  "strip",
  "strip_curve",
  "tube",
]);

export interface LightSpec {
  id: string;
  name: string;
  kind: FixtureKind;
  pixelCount: number;
  // Room position in meters (x right, y up, z toward the viewer), when known.
  position?: [number, number, number];
}

// A palette choice: a catalog id, or "single" with one hex color.
export interface PaletteRef {
  id: string;
  color?: string;
}

// The profile's continuous features must have `data` loaded for every
// candidate the algorithm reads; loading is the caller's job.
export interface ShowInput {
  profile: Profile;
  lights: LightSpec[];
  palette: PaletteRef;
}

export interface CandidateReport {
  path: string;
  label: string;
  family: string;
  measures: Record<string, number>;
  score: number;
  // 1-based pick order, null when not picked.
  rank: number | null;
  picked: boolean;
  // Why it was picked, rejected or passed over, in a few words.
  reason: string;
  role?: string;
}

export interface PickReport {
  path: string;
  programId: string;
  lights: string[];
  role?: string;
}

export interface SelectionReport {
  algorithm: string;
  candidates: CandidateReport[];
  picks: PickReport[];
  notes: string[];
}

export interface ShowResult {
  programs: Program[];
  derivations: Derivation[];
  // Light id → program id.
  patch: Record<string, string>;
  macro: Macro;
  report: SelectionReport;
}

export interface ShowAlgorithm {
  id: string;
  label: string;
  description: string;
  generate(input: ShowInput): ShowResult;
}
