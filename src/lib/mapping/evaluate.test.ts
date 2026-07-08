import { describe, expect, it } from "vitest";

import type { Profile } from "$lib/ipc/messages";

import {
  applyMacro,
  DEFAULT_PIXELS,
  evaluateDoc,
  evaluateProgram,
  GATE_PULSE_SEC,
  motionPhase,
} from "./evaluate";
import { MappingDocSchema, type MappingDoc } from "./schema";

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
      chroma: {
        render: "heatmap",
        category: "tonal",
        source: "librosa",
        unit: "energy",
        sidecar: "heatmaps/chroma.npy",
        shape: [4, FRAMES],
        axes: ["pitch", "time"],
      },
      band_energy_low: {
        render: "continuous",
        category: "frequency",
        source: "librosa",
        unit: "normalized",
        data: new Array(FRAMES).fill(0).map((_, i) => (i < 100 ? 1 : 0)),
      },
      band_energy_high: {
        render: "continuous",
        category: "frequency",
        source: "librosa",
        unit: "normalized",
        data: new Array(FRAMES).fill(0).map((_, i) => (i < 100 ? 0 : 1)),
      },
      stereo_width: {
        render: "continuous",
        category: "spatial",
        source: "librosa",
        unit: "normalized",
        data: new Array(FRAMES).fill(0).map((_, i) => (i < 100 ? 0.1 : 1)),
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

describe("evaluateProgram — pixel dimension", () => {
  const N = DEFAULT_PIXELS;

  it("a heatmap position binding lands rows on the right pixels", () => {
    // Row 3 (top quarter) hot everywhere, others cold.
    const rows = 4;
    const data = new Float32Array(rows * FRAMES);
    for (let f = 0; f < FRAMES; f++) data[3 * FRAMES + f] = 1;
    const d = doc([
      { id: "p", channels: { position: { source: "mix.chroma" } } },
    ]);
    const out = evaluateProgram(profile, d, d.programs[0], {
      "mix.chroma": { rows, cols: FRAMES, data },
    });
    expect(out.pixels).not.toBeNull();
    const { rgb, pixelCount } = out.pixels!;
    expect(pixelCount).toBe(N);
    // Top-quarter pixels bright, bottom-quarter dark (sum RGB as intensity).
    const sum = (f: number, p: number) =>
      rgb[(f * N + p) * 3] +
      rgb[(f * N + p) * 3 + 1] +
      rgb[(f * N + p) * 3 + 2];
    expect(sum(50, N - 1)).toBeGreaterThan(sum(50, 0) + 100);
  });

  it("a heatmap position binding without its matrix stays pending (null)", () => {
    const d = doc([
      { id: "p", channels: { position: { source: "mix.chroma" } } },
    ]);
    expect(evaluateProgram(profile, d, d.programs[0]).pixels).toBeNull();
  });

  it("a band_energy source stacks sibling bands as zones", () => {
    const d = doc([
      { id: "p", channels: { position: { source: "mix.band_energy_low" } } },
    ]);
    const out = evaluateProgram(profile, d, d.programs[0]);
    const { rgb } = out.pixels!;
    const sum = (f: number, p: number) =>
      rgb[(f * N + p) * 3] +
      rgb[(f * N + p) * 3 + 1] +
      rgb[(f * N + p) * 3 + 2];
    // First half of the song: low band on → bottom zone bright, top dark.
    expect(sum(50, 0)).toBeGreaterThan(sum(50, N - 1) + 100);
    // Second half: high band on → top zone bright.
    expect(sum(150, N - 1)).toBeGreaterThan(sum(150, 0) + 100);
  });

  it("spread widens with stereo_width", () => {
    const d = doc([
      { id: "p", channels: { position: { source: "mix.stereo_width" } } },
    ]);
    const out = evaluateProgram(profile, d, d.programs[0]);
    const { rgb } = out.pixels!;
    const litCount = (f: number) => {
      let n = 0;
      for (let p = 0; p < N; p++) {
        if (rgb[(f * N + p) * 3] + rgb[(f * N + p) * 3 + 1] > 30) n++;
      }
      return n;
    };
    expect(litCount(150)).toBeGreaterThan(litCount(50)); // wide > narrow
    expect(litCount(150)).toBeGreaterThanOrEqual(N - 2); // full width
  });

  it("motion alone renders the program color chased along the strip", () => {
    const d = doc([
      { id: "p", channels: { brightness: 1, motion: 1 } }, // 1 cycle/sec
    ]);
    const out = evaluateProgram(profile, d, d.programs[0]);
    expect(out.pixels).not.toBeNull();
    const { rgb } = out.pixels!;
    // At t=0.5s (half a cycle) the head sits mid-strip: center bright, ends dim.
    const sum = (f: number, p: number) =>
      rgb[(f * N + p) * 3] +
      rgb[(f * N + p) * 3 + 1] +
      rgb[(f * N + p) * 3 + 2];
    expect(sum(50, Math.floor(N / 2))).toBeGreaterThan(sum(50, 2) + 100);
  });
});

describe("motionPhase", () => {
  it("chase head advances with phase and wraps the ring", () => {
    const N = 60;
    // Peak pixel at phase 0.25 sits a quarter along the strip.
    let best = 0;
    let bestV = -1;
    for (let p = 0; p < N; p++) {
      const v = motionPhase("chase", p, N, 0.25, 0.1);
      if (v > bestV) {
        bestV = v;
        best = p;
      }
    }
    expect(best).toBe(15);
    // Whole cycles land back on the same pixel (speed-proportional advance).
    expect(motionPhase("chase", 15, N, 1.25, 0.1)).toBeCloseTo(
      motionPhase("chase", 15, N, 0.25, 0.1),
      6,
    );
  });

  it("sweep bounces instead of wrapping", () => {
    const N = 60;
    const headAt = (phase: number) => {
      let best = 0;
      let bestV = -1;
      for (let p = 0; p < N; p++) {
        const v = motionPhase("sweep", p, N, phase, 0.1);
        if (v > bestV) {
          bestV = v;
          best = p;
        }
      }
      return best;
    };
    expect(headAt(0.5)).toBe(N - 1); // end of the forward pass
    expect(headAt(1.0)).toBe(0); // swept back
  });

  it("pulse ignores pixel index and oscillates with phase", () => {
    expect(motionPhase("pulse", 0, 60, 0.5, 0.1)).toBeCloseTo(1, 6);
    expect(motionPhase("pulse", 30, 60, 0.5, 0.1)).toBeCloseTo(1, 6);
    expect(motionPhase("pulse", 0, 60, 1, 0.1)).toBeCloseTo(0, 6);
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

describe("applyMacro", () => {
  function docWithMacro(macro: unknown, programs: unknown[]): MappingDoc {
    return MappingDocSchema.parse({ programs, macro });
  }

  it("no scenes and no master returns the raw record untouched", () => {
    const d = doc([{ id: "p", channels: { brightness: 1 } }]);
    const raw = evaluateDoc(profile, d);
    expect(applyMacro(profile, d, raw)).toBe(raw);
  });

  it("section boundaries switch presets exactly at the boundary frame", () => {
    // intro: [0,1) — program off; drop: [1,2) — program on at half scale.
    const d = docWithMacro(
      {
        scenes_from: "mix.sections",
        scenes: {
          intro: { programs: [], master_scale: 1 },
          drop: { programs: ["p"], master_scale: 0.5 },
        },
      },
      [{ id: "p", channels: { brightness: 1 } }],
    );
    const final = applyMacro(profile, d, evaluateDoc(profile, d));
    const b = final.p.channels.brightness!;
    expect(b[99]).toBe(0); // last intro frame
    expect(b[100]).toBeCloseTo(0.5, 5); // first drop frame
    // The gate is cut too: the program reads as off during intro.
    expect(final.p.gate).not.toBeNull();
    expect(final.p.gate![0].start).toBeCloseTo(1, 5);
  });

  it("windowed master normalizes to a rolling max; absolute to the song max", () => {
    // energy: quiet hump (0.8 raw) then loud hump (1.6 raw).
    const master = (mode: string) => ({
      scenes_from: null,
      scenes: {},
      master: { source: "mix.energy", adaptive: { mode, window_s: 0.5 } },
    });
    const programs = [{ id: "p", channels: { brightness: 1 } }];

    const abs = docWithMacro(master("absolute"), programs);
    const bAbs = applyMacro(profile, abs, evaluateDoc(profile, abs)).p.channels
      .brightness!;
    expect(bAbs[50]).toBeCloseTo(0.5, 5); // quiet hump ÷ song max
    expect(bAbs[130]).toBeCloseTo(1, 5);

    const win = docWithMacro(master("windowed"), programs);
    const bWin = applyMacro(profile, win, evaluateDoc(profile, win)).p.channels
      .brightness!;
    // Inside the quiet hump, the rolling max is the hump itself → full range.
    expect(bWin[50]).toBeCloseTo(1, 5);
    expect(bWin[130]).toBeCloseTo(1, 5);
    // Silence between humps stays dark, not amplified.
    expect(bWin[110]).toBeLessThanOrEqual(bAbs[110] + 1e-6);
  });

  it("share splits brightness across simultaneously active programs", () => {
    const d = docWithMacro(
      {
        scenes_from: null,
        scenes: {},
        master: {
          source: "mix.energy",
          adaptive: { mode: "share", window_s: 4 },
        },
      },
      [
        { id: "a", channels: { brightness: 0.6 } },
        { id: "b", channels: { brightness: 0.2 } },
      ],
    );
    const final = applyMacro(profile, d, evaluateDoc(profile, d));
    expect(final.a.channels.brightness![50]).toBeCloseTo(0.75, 5); // 0.6/0.8
    expect(final.b.channels.brightness![50]).toBeCloseTo(0.25, 5);
  });

  it("share clamps the degenerate all-quiet case to dark", () => {
    const d = docWithMacro(
      {
        scenes_from: null,
        scenes: {},
        master: {
          source: "mix.energy",
          adaptive: { mode: "share", window_s: 4 },
        },
      },
      [{ id: "a", channels: { brightness: 0 } }],
    );
    const final = applyMacro(profile, d, evaluateDoc(profile, d));
    expect(final.a.channels.brightness![50]).toBe(0); // no 0/0 blowup
  });

  it("reuses per-program finals when nothing feeding them changed", () => {
    const d = docWithMacro(
      {
        scenes_from: "mix.sections",
        scenes: { drop: { programs: ["p"], master_scale: 0.5 } },
      },
      [{ id: "p", channels: { brightness: 1 } }],
    );
    const raw = evaluateDoc(profile, d);
    const first = applyMacro(profile, d, raw);
    const second = applyMacro(profile, d, raw, first);
    expect(second.p).toBe(first.p);
  });
});
