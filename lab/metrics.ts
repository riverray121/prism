// Output metrics: what a show's lights do over a song, measured from the
// sampled light states. They describe the output for a human comparison;
// they are not tuning targets.

import type { Profile } from "$lib/ipc/messages";
import { MappingDocSchema } from "$lib/mapping/schema";
import { evaluateForLights, sampleLights } from "$lib/showgen/lightstate";
import { pearson } from "$lib/showgen/measures";
import type { LightSpec, ShowResult } from "$lib/showgen/types";

export const METRIC_HZ = 20;

export interface ShowMetrics {
  // Mean over lights of the fraction of 1 s windows whose level range > 0.15.
  visible_change: number;
  // 1 − mean pairwise correlation (floored at 0) of light level series: 1 = unrelated lights.
  distinctness: number;
  // Fraction of light flashes (level rise > 0.2 within 100 ms) within 70 ms of a beat.
  beat_alignment: number;
  // Mean over lights of the fraction of time inside dark runs (< 0.05) longer than 4 s.
  dark_time: number;
  mean_level: number;
  // Per light, in light order: visible change and mean level.
  per_light: { change: number; level: number }[];
}

// Per light, its level at METRIC_HZ over the song.
export function levelSeries(
  profile: Profile,
  result: ShowResult,
  lights: LightSpec[],
): Float32Array[] {
  const doc = MappingDocSchema.parse({
    derivations: result.derivations,
    programs: result.programs,
    macro: result.macro,
    patch: result.patch,
  });
  const outputs = evaluateForLights(profile, doc, lights);
  const duration =
    profile.timeline.frame_count / profile.timeline.frame_rate_hz;
  const n = Math.floor(duration * METRIC_HZ);
  const series = lights.map(() => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    const states = sampleLights(profile, doc, outputs, lights, i / METRIC_HZ);
    lights.forEach((l, k) => (series[k][i] = states.get(l.id)?.level ?? 0));
  }
  return series;
}

export function metricsFromSeries(
  series: Float32Array[],
  beats: number[],
): ShowMetrics {
  const hz = METRIC_HZ;
  const avg = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

  const change = series.map((s) => {
    let windows = 0;
    let moving = 0;
    for (let a = 0; a + hz <= s.length; a += hz) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = a; i < a + hz; i++) {
        lo = Math.min(lo, s[i]);
        hi = Math.max(hi, s[i]);
      }
      windows++;
      if (hi - lo > 0.15) moving++;
    }
    return windows ? moving / windows : 0;
  });

  const corrs: number[] = [];
  for (let a = 0; a < series.length; a++)
    for (let b = a + 1; b < series.length; b++)
      corrs.push(pearson(series[a], series[b]));
  const identical = (a: Float32Array, b: Float32Array) =>
    a.every((v, i) => v === b[i]);
  for (let a = 0, k = 0; a < series.length; a++)
    for (let b = a + 1; b < series.length; b++, k++)
      if (identical(series[a], series[b])) corrs[k] = 1;

  let flashes = 0;
  let onBeat = 0;
  const sortedBeats = [...beats].sort((x, y) => x - y);
  for (const s of series) {
    for (let i = 2; i < s.length; i++) {
      if (s[i] - s[i - 2] > 0.2 && !(s[i - 1] - s[i - 3] > 0.2)) {
        flashes++;
        const t = i / hz;
        if (sortedBeats.some((b) => Math.abs(b - t) <= 0.07 + 0.1)) onBeat++;
      }
    }
  }

  const dark = series.map((s) => {
    let run = 0;
    let darkFrames = 0;
    for (let i = 0; i <= s.length; i++) {
      if (i < s.length && s[i] < 0.05) run++;
      else {
        if (run > 4 * hz) darkFrames += run;
        run = 0;
      }
    }
    return s.length ? darkFrames / s.length : 0;
  });

  return {
    visible_change: avg(change),
    distinctness: corrs.length ? 1 - avg(corrs.map((c) => Math.max(0, c))) : 1,
    beat_alignment: flashes ? onBeat / flashes : 0,
    dark_time: avg(dark),
    mean_level: avg(series.map((s) => avg(Array.from(s)))),
    per_light: series.map((s, i) => ({ change: change[i], level: avg(Array.from(s)) })),
  };
}
