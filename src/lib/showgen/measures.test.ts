import { describe, expect, it } from "vitest";
import {
  beatAlignment,
  contrast,
  flicker,
  level,
  motion,
  pearson,
  presence,
  pulseClarity,
} from "$lib/showgen/measures";

const HZ = 100;
const N = 60 * HZ;

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Click envelope at `bpm`: a fast attack and 150 ms decay per beat.
function clicks(bpm: number, amp = 1): Float32Array {
  const x = new Float32Array(N);
  const period = (60 / bpm) * HZ;
  for (let i = 0; i < N; i++) {
    const phase = i % period;
    x[i] = amp * Math.exp(-phase / 15);
  }
  return x;
}

const silence = new Float32Array(N);
const r = rng(1);
const noise = Float32Array.from({ length: N }, () => r());
const pad = Float32Array.from(
  { length: N },
  (_, i) => 0.8 + 0.05 * Math.sin((2 * Math.PI * i) / (20 * HZ)),
);
const burst = Float32Array.from({ length: N }, (_, i) =>
  i >= 10 * HZ && i < 15 * HZ ? 1 : 0.001,
);
// Bassline: notes on beats and off-beats with varied levels at 120 BPM.
const bass = Float32Array.from({ length: N }, (_, i) => {
  const half = 25;
  const k = Math.floor(i / half);
  return (0.4 + (0.6 * ((k * 7) % 5)) / 4) * Math.exp(-(i % half) / 12);
});

describe("measures on synthetic envelopes", () => {
  it("presence rejects silence and a 5 s burst, keeps a click track", () => {
    expect(presence(silence)).toBe(0);
    expect(presence(burst)).toBeLessThan(0.2);
    expect(presence(clicks(120))).toBeGreaterThan(0.2);
  });

  it("white noise flickers far more than a click track", () => {
    expect(flicker(noise, HZ)).toBeGreaterThan(1.5);
    expect(flicker(clicks(120), HZ)).toBeLessThan(1.5);
  });

  it("a pad has less motion than a bassline", () => {
    expect(motion(pad, HZ)).toBeLessThan(motion(bass, HZ));
    expect(contrast(pad)).toBeLessThan(0.15);
  });

  it("a 120 BPM click track has a clear pulse and sits on the beat grid", () => {
    expect(pulseClarity(clicks(120), HZ, 0.5)).toBeGreaterThan(0.6);
    const beats = Array.from({ length: 120 }, (_, i) => i * 0.5);
    const onsets = beats.map((t) => t + 0.01);
    expect(beatAlignment(onsets, beats)).toBeGreaterThan(0.9);
    const off = beats.map((t) => t + 0.13);
    expect(beatAlignment(off, beats)).toBeLessThan(0.1);
  });

  it("level is the stem-to-mix ratio in absolute units", () => {
    const mix = clicks(120);
    // Stem holds 1.2× the mix's absolute level: normalized data equal, scale 1.2.
    expect(level(mix, 1.2, mix, 1)).toBeCloseTo(1.2, 5);
    expect(level(mix, 0.5, mix, 1)).toBeCloseTo(0.5, 5);
  });

  it("pearson is 1 for a scaled copy", () => {
    const a = clicks(120);
    const b = a.map((v) => v * 0.3);
    expect(pearson(a, b)).toBeCloseTo(1, 6);
  });
});
