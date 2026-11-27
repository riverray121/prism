// Candidate scoring and maximal-marginal-relevance selection, the v2 rules of
// docs/milestone-8-show-lab/ranking.md. Every constant here is part of the
// v2 contract: a change belongs in a new versioned module.

import type { Profile } from "$lib/ipc/messages";
import type { Candidate } from "$lib/showgen/candidates";
import {
  beatAlignment,
  compress10,
  contrast,
  flicker,
  level,
  motion,
  pearson,
  presence,
  pulseClarity,
  sectionContrast,
} from "$lib/showgen/measures";

export interface SongContext {
  hz: number;
  durationS: number;
  beats: number[];
  beatPeriodS: number;
  sections: { start: number; end: number; label: string }[];
  mixRms: ArrayLike<number> | null;
  mixScale: number | null;
}

export interface Measured {
  candidate: Candidate;
  measures: Record<string, number>;
  compressed: Float64Array;
  score: number;
  rejected: string | null;
}

export function songContext(profile: Profile): SongContext {
  const hz = profile.timeline.frame_rate_hz;
  const beatsF = profile.mix.beats;
  const beats = beatsF?.render === "event" ? beatsF.events.map((e) => e.t) : [];
  const intervals = beats
    .slice(1)
    .map((t, i) => t - beats[i])
    .sort((a, b) => a - b);
  const bpmF = profile.mix.bpm;
  const bpm =
    bpmF?.render === "scalar" && typeof bpmF.value === "number"
      ? bpmF.value
      : 0;
  const beatPeriodS = intervals.length
    ? intervals[Math.floor(intervals.length / 2)]
    : bpm > 0
      ? 60 / bpm
      : 0.5;
  const sectionsF = profile.mix.sections;
  const sections =
    sectionsF?.render === "segment"
      ? sectionsF.segments.map((s) => ({
          start: s.start,
          end: s.end,
          label: s.label,
        }))
      : [];
  const rms = profile.mix.rms;
  const mixRms = rms?.render === "continuous" && rms.data ? rms.data : null;
  const mixScale = rms?.render === "continuous" ? (rms.scale ?? null) : null;
  return {
    hz,
    durationS: profile.timeline.frame_count / hz,
    beats,
    beatPeriodS,
    sections,
    mixRms,
    mixScale,
  };
}

const LEAK_KINDS = new Set(["stem", "substem"]);

export function measureCandidates(
  candidates: Candidate[],
  ctx: SongContext,
): Measured[] {
  const compressed = candidates.map((c) => compress10(c.data, ctx.hz));
  return candidates.map((c, i) => {
    const onsets = (c.feature.onsets_strict ?? []).map((o) => o.t);
    let leak = 0;
    if (LEAK_KINDS.has(c.kind))
      candidates.forEach((o, j) => {
        if (
          j === i ||
          o.kind !== c.kind ||
          o.engine !== c.engine ||
          o.family === c.family
        )
          return;
        leak = Math.max(leak, pearson(compressed[i], compressed[j]));
      });
    const measures: Record<string, number> = {
      presence: presence(c.data),
      motion: motion(c.data, ctx.hz),
      flicker: flicker(c.data, ctx.hz),
      pulse: pulseClarity(c.data, ctx.hz, ctx.beatPeriodS),
      alignment: beatAlignment(onsets, ctx.beats),
      onset_rate: ctx.durationS > 0 ? onsets.length / ctx.durationS : 0,
      contrast: contrast(c.data),
      section_contrast: sectionContrast(c.data, ctx.hz, ctx.sections),
      leak,
    };
    const scale = c.feature.scale;
    if (c.kind !== "mix" && scale !== undefined && ctx.mixRms && ctx.mixScale)
      measures.level = level(c.data, scale, ctx.mixRms, ctx.mixScale);
    const rejected = rejection(measures);
    return {
      candidate: c,
      measures,
      compressed: compressed[i],
      score: rejected ? 0 : score(measures),
      rejected,
    };
  });
}

function rejection(m: Record<string, number>): string | null {
  if (m.presence < 0.2)
    return `silent most of the song (presence ${m.presence.toFixed(2)})`;
  if (m.level !== undefined && m.level > 1.05)
    return `louder than the mix (level ${m.level.toFixed(2)}): bleed or artifact`;
  if (m.contrast < 0.15)
    return `nearly constant (contrast ${m.contrast.toFixed(2)})`;
  if (m.flicker > 1.5)
    return `noise-like flicker (flicker ${m.flicker.toFixed(2)})`;
  return null;
}

export function score(m: Record<string, number>): number {
  return (
    0.3 * m.motion +
    0.2 * m.pulse +
    0.15 * m.alignment +
    0.15 * m.contrast +
    0.1 * Math.min(1, m.section_contrast / 0.5) +
    0.1 * m.presence -
    (0.2 * Math.max(0, m.leak - 0.8)) / 0.2
  );
}

export const SAME_FAMILY_SIM = 0.9;
export const MMR_LAMBDA = 0.7;
export const MIN_VALUE = 0.05;

export function similarity(a: Measured, b: Measured): number {
  const corr = Math.max(0, pearson(a.compressed, b.compressed));
  return a.candidate.family === b.candidate.family
    ? Math.max(corr, SAME_FAMILY_SIM)
    : corr;
}

export interface Selection {
  picks: Measured[];
  // Per candidate path: why it was passed over, when it was not picked.
  passed: Map<string, string>;
}

// Greedy MMR: each step takes the candidate with the highest
// score − λ · (max similarity to anything already picked).
export function selectMMR(measured: Measured[], n: number): Selection {
  const pool = measured.filter((m) => !m.rejected);
  const picks: Measured[] = [];
  const passed = new Map<string, string>();
  while (picks.length < n && pool.length > 0) {
    let best = -Infinity;
    let bestIdx = -1;
    pool.forEach((m, i) => {
      const sim = picks.length
        ? Math.max(...picks.map((p) => similarity(m, p)))
        : 0;
      const value = m.score - MMR_LAMBDA * sim;
      if (value > best) {
        best = value;
        bestIdx = i;
      }
    });
    if (best < MIN_VALUE) break;
    picks.push(pool.splice(bestIdx, 1)[0]);
  }
  for (const m of pool) {
    let nearest: Measured | null = null;
    let nearestSim = -1;
    for (const p of picks) {
      const s = similarity(m, p);
      if (s > nearestSim) {
        nearestSim = s;
        nearest = p;
      }
    }
    passed.set(
      m.candidate.path,
      nearest && nearestSim >= 0.5
        ? `too similar to ${nearest.candidate.label} (${nearestSim.toFixed(2)})`
        : "lower score than the picks",
    );
  }
  return { picks, passed };
}
