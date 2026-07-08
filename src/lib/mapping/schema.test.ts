import { describe, expect, it } from "vitest";

import type { Profile } from "$lib/ipc/messages";

import {
  emptyMappingDoc,
  MAPPING_SCHEMA_VERSION,
  MappingDocSchema,
  MappingEventSchema,
  sourceResolves,
} from "./schema";

// A hand-written doc in the terse on-disk shape (defaults omitted).
const HAND_DOC = {
  schema_version: "0.1.0",
  derivations: [
    {
      id: "kick_hits",
      source: "stems.htdemucs_ft.drums.features.drums_energy",
      threshold: { cutoff: 0.4, mode: "segments" },
    },
  ],
  programs: [
    {
      id: "kick_strobe",
      enabled: true,
      channels: {
        gate: { source: "derived.kick_hits" },
        brightness: {
          source: "stems.htdemucs_ft.drums.features.drums_energy",
          transform: [{ smooth: {} }, { normalize: {} }],
        },
        hue: 0,
      },
    },
  ],
  macro: {
    scenes_from: "mix.sections",
    scenes: { drop: { programs: ["kick_strobe"], master_scale: 1 } },
    master: { source: "mix.rms", adaptive: { mode: "windowed", window_s: 4 } },
  },
};

describe("MappingDocSchema", () => {
  it("an empty object expands to the empty doc", () => {
    const doc = MappingDocSchema.parse({});
    expect(doc.schema_version).toBe(MAPPING_SCHEMA_VERSION);
    expect(doc.derivations).toEqual([]);
    expect(doc.programs).toEqual([]);
    expect(doc.macro).toEqual({ scenes_from: null, scenes: {}, master: null });
  });

  it("emptyMappingDoc carries the song id", () => {
    expect(emptyMappingDoc("s1").song_id).toBe("s1");
    expect(emptyMappingDoc().song_id).toBeUndefined();
  });

  it("fills transform-step and program defaults", () => {
    const doc = MappingDocSchema.parse(HAND_DOC);
    const program = doc.programs[0];
    expect(program.enabled).toBe(true);
    const brightness = program.channels.brightness;
    if (typeof brightness === "number" || brightness === undefined)
      throw new Error("expected a binding");
    expect(brightness.transform).toEqual([
      { smooth: { window_s: 0.08 } },
      { normalize: { min: null, max: null, curve: "linear", gamma: 2 } },
    ]);
    // The gate binding's omitted transform defaults to [].
    const gate = program.channels.gate;
    if (typeof gate === "number" || gate === undefined)
      throw new Error("expected a binding");
    expect(gate.transform).toEqual([]);
  });

  it("a parsed doc re-parses unchanged (round-trip stable)", () => {
    const once = MappingDocSchema.parse(HAND_DOC);
    const twice = MappingDocSchema.parse(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });

  it("rejects structurally invalid docs (bad threshold mode)", () => {
    const bad = {
      derivations: [
        { id: "x", source: "mix.rms", threshold: { mode: "nope" } },
      ],
    };
    expect(MappingDocSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown channels", () => {
    const bad = { programs: [{ id: "p", channels: { warp: 1 } }] };
    expect(MappingDocSchema.safeParse(bad).success).toBe(false);
  });
});

describe("MappingEventSchema", () => {
  it("expands an empty doc payload (song with no saved mapping)", () => {
    const event = MappingEventSchema.parse({
      type: "mapping",
      song_id: "s1",
      doc: {},
    });
    expect(event.doc.programs).toEqual([]);
  });
});

describe("sourceResolves", () => {
  // Minimal profile shape — resolution only walks keys.
  const profile = {
    mix: { rms: { render: "continuous" } },
    stems: { eng: { drums: { features: { drums_energy: {} } } } },
  } as unknown as Profile;
  const doc = MappingDocSchema.parse(HAND_DOC);

  it("resolves profile dot-paths", () => {
    expect(sourceResolves(profile, doc, "mix.rms")).toBe(true);
    expect(
      sourceResolves(profile, doc, "stems.eng.drums.features.drums_energy"),
    ).toBe(true);
  });

  it("mutes non-resolving paths (returns false, never throws)", () => {
    expect(sourceResolves(profile, doc, "mix.gone")).toBe(false);
    expect(sourceResolves(profile, doc, "stems.other.drums.features.x")).toBe(
      false,
    );
    expect(sourceResolves(profile, doc, "mix.rms.data.0.deeper")).toBe(false);
  });

  it("resolves derived refs against the doc's derivations", () => {
    expect(sourceResolves(profile, doc, "derived.kick_hits")).toBe(true);
    expect(sourceResolves(profile, doc, "derived.missing")).toBe(false);
  });
});
