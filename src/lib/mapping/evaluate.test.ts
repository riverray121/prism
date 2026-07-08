import { describe, expect, it } from "vitest";

import type { Profile } from "$lib/ipc/messages";

import { evaluateDoc, evaluateProgram, GATE_PULSE_SEC } from "./evaluate";
import { MappingDocSchema, type MappingDoc, type Program } from "./schema";

const HZ = 100;
const FRAMES = 200; // 2 s

// Synthetic profile: an energy envelope with two humps, a beats event track,
// a sections segment track, and a bpm scalar.
function makeProfile(): Profile {
  const energy = new Array(FRAMES).fill(0);
  for (let i = 40; i < 60; i++) energy[i] = 0.8; // hump one
  for (let i = 120; i < 140; i++) energy[i] = 1.6; // hump two, louder
  return {
    schema_version: "0.3.0",
    song: {
      id: "s1",
      title: "T",
      artist: "A",
      duration_sec: FRAMES / HZ,
      sample_rate: 44100,
      source_file: "t.wav",
      imported_at: "2026-01-01",
      analyzed_at: "2026-01-02",
    },
    timeline: { frame_rate_hz: HZ, frame_count: FRAMES },
    mix: {
      energy: {
        render: "continuous",
        category: "amplitude",
        source: "librosa",
        unit: "normalized",
        data: energy,
      },
      beats: {
        render: "event",
        category: "rhythm",
        source: "librosa",
        events: [{ t: 0.5 }, { t: 1.0 }, { t: 1.5 }],
      },
      sections: {
        render: "segment",
        category: "structure",
        source: "ml",
        segments: [
          { start: 0, end: 1, label: "intro" },
          { start: 1, end: 2, label: "drop" },
        ],
      },
      bpm: {
        render: "scalar",
        category: "rhythm",
        source: "librosa",
        unit: "bpm",
        value: 120,
      },
    },
    stems: {},
    favorites: [],
  };
}

function doc(programs: unknown[], derivations: unknown[] = []): MappingDoc {
  return MappingDocSchema.parse({ programs, derivations });
}

const profile = makeProfile();

describe("evaluateProgram — point channels", () => {
  it("continuous → brightness silently gets normalize + smooth", () => {
    const d = doc([
      { id: "p", channels: { brightness: { source: "mix.energy" } } },
    ]);
    const out = evaluateProgram(profile, d, d.programs[0]);
    const b = out.channels.brightness!;
    expect(b).toHaveLength(FRAMES);
    // Normalized: the louder hump reaches 1 (after smoothing, near it).
    const peak = Math.max(...b);
    expect(peak).toBeGreaterThan(0.9);
    expect(peak).toBeLessThanOrEqual(1);
    // Smoothed: the hump edge is no longer a hard step.
    expect(b[40]).toBeGreaterThan(0);
    expect(b[40]).toBeLessThan(0.5);
    // Quiet frames stay dark.
    expect(b[10]).toBe(0);
  });

  it("constants pass through as filled timelines", () => {
    const d = doc([{ id: "p", channels: { brightness: 0.6, hue: 210 } }]);
    const out = evaluateProgram(profile, d, d.programs[0]);
    expect(out.channels.brightness![0]).toBeCloseTo(0.6, 5);
    expect(out.channels.hue![FRAMES - 1]).toBe(210);
  });

  it("envelope gives point events duration", () => {
    const d = doc([
      {
        id: "p",
        channels: {
          brightness: {
            source: "mix.beats",
            transform: [
              { envelope: { attack_s: 0, hold_s: 0.05, decay_s: 0.1 } },
            ],
          },
        },
      },
    ]);
    const out = evaluateProgram(profile, d, d.programs[0]);
    const b = out.channels.brightness!;
    expect(b[50]).toBe(1); // at the beat
    expect(b[53]).toBe(1); // holding
    expect(b[60]).toBeGreaterThan(0); // decaying
    expect(b[75]).toBe(0); // gone before the next beat
  });

  it("a non-resolving source mutes the channel, never throws", () => {
    const d = doc([
      { id: "p", channels: { brightness: { source: "mix.vanished" } } },
    ]);
    const out = evaluateProgram(profile, d, d.programs[0]);
    expect(out.channels.brightness).toBeUndefined();
  });

  it("hue from a plain 0-1 source scales to degrees; colormap emits degrees directly", () => {
    const d = doc([
      {
        id: "plain",
        channels: {
          hue: { source: "mix.energy", transform: [{ normalize: {} }] },
        },
      },
      {
        id: "mapped",
        channels: {
          hue: {
            source: "mix.energy",
            transform: [
              { normalize: {} },
              { colormap: { palette: "warm_cool" } },
            ],
          },
        },
      },
    ]);
    const plain = evaluateProgram(profile, d, d.programs[0]).channels.hue!;
    expect(plain[50]).toBeCloseTo(180, 5); // 0.5 × 360 (hump one is half range)
    expect(plain[130]).toBeCloseTo(0, 5); // full range wraps the hue circle
    const mapped = evaluateProgram(profile, d, d.programs[1]).channels.hue!;
    for (const v of mapped) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(360);
    }
  });

  it("categorical maps segment labels to values held over their spans", () => {
    const d = doc([
      {
        id: "p",
        channels: {
          saturation: {
            source: "mix.sections",
            transform: [{ categorical: { map: { intro: 0.2, drop: 0.9 } } }],
          },
        },
      },
    ]);
    const out = evaluateProgram(profile, d, d.programs[0]);
    const s = out.channels.saturation!;
    expect(s[50]).toBeCloseTo(0.2, 5); // inside intro
    expect(s[150]).toBeCloseTo(0.9, 5); // inside drop
  });
});

describe("evaluateProgram — gate", () => {
  it("a segments derivation drives the gate with strengths", () => {
    const d = doc(
      [{ id: "p", channels: { gate: { source: "derived.energy_gate" } } }],
      [
        {
          id: "energy_gate",
          source: "mix.energy",
          threshold: { cutoff: 0.4, mode: "segments" },
        },
      ],
    );
    const out = evaluateProgram(profile, d, d.programs[0]);
    expect(out.gate).toHaveLength(2);
    expect(out.gate![0].start).toBeCloseTo(0.4, 2);
    expect(out.gate![1].strength).toBeCloseTo(1, 5);
  });

  it("point events become fixed pulses", () => {
    const d = doc([{ id: "p", channels: { gate: { source: "mix.beats" } } }]);
    const out = evaluateProgram(profile, d, d.programs[0]);
    expect(out.gate).toHaveLength(3);
    expect(out.gate![0].end - out.gate![0].start).toBeCloseTo(
      GATE_PULSE_SEC,
      5,
    );
  });

  it("no gate binding means always lit (null)", () => {
    const d = doc([{ id: "p", channels: { brightness: 1 } }]);
    expect(evaluateProgram(profile, d, d.programs[0]).gate).toBeNull();
  });

  it("gate constants: on ≥ 0.5, off below", () => {
    const on = doc([{ id: "p", channels: { gate: 1 } }]);
    const off = doc([{ id: "p", channels: { gate: 0 } }]);
    expect(evaluateProgram(profile, on, on.programs[0]).gate).toBeNull();
    expect(evaluateProgram(profile, off, off.programs[0]).gate).toEqual([]);
  });
});

describe("evaluateDoc — incremental re-evaluation", () => {
  const base = () =>
    doc([
      { id: "a", channels: { brightness: { source: "mix.energy" } } },
      { id: "b", channels: { brightness: 0.5 } },
    ]);

  it("editing one program re-evaluates only it", () => {
    const d1 = base();
    const first = evaluateDoc(profile, d1);
    const d2 = base();
    (d2.programs[1].channels as { brightness: number }).brightness = 0.9;
    const second = evaluateDoc(profile, d2, first);
    expect(second.a).toBe(first.a); // untouched program: same object reused
    expect(second.b).not.toBe(first.b);
    expect(second.b.channels.brightness![0]).toBeCloseTo(0.9, 5);
  });

  it("editing a derivation re-evaluates its consumers", () => {
    const withDerivation = (cutoff: number) =>
      doc(
        [{ id: "a", channels: { gate: { source: "derived.g" } } }],
        [
          {
            id: "g",
            source: "mix.energy",
            threshold: { cutoff, mode: "segments" },
          },
        ],
      );
    const first = evaluateDoc(profile, withDerivation(0.4));
    const second = evaluateDoc(profile, withDerivation(0.9), first);
    expect(second.a).not.toBe(first.a);
    expect(second.a.gate).toHaveLength(1); // only the loud hump clears 0.9
  });

  it("disabled programs are dropped from the output", () => {
    const d = doc([
      { id: "a", enabled: false, channels: { brightness: 1 } },
      { id: "b", channels: { brightness: 1 } },
    ]);
    const out = evaluateDoc(profile, d);
    expect(out.a).toBeUndefined();
    expect(out.b).toBeDefined();
  });
});
