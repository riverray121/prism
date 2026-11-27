// Candidate tracks for ranking: every intensity-like continuous feature the
// analysis produced (docs/milestone-8-show-lab/ranking.md, Candidates).

import type { ContinuousFeature, MixFeature, Profile } from "$lib/ipc/messages";

export type CandidateKind = "stem" | "substem" | "mix";

export interface Candidate {
  path: string;
  label: string;
  // Same family = near-duplicate by definition (one instrument).
  family: string;
  kind: CandidateKind;
  engine: string | null;
  feature: ContinuousFeature;
  data: ArrayLike<number>;
}

export const MIX_CANDIDATES = [
  "rms",
  "band_energy_sub",
  "band_energy_bass",
  "band_energy_low_mid",
  "band_energy_mid",
  "band_energy_high_mid",
  "band_energy_air",
  "novelty",
  "rhythmic_density",
  "spectral_flux",
] as const;

const MIX_LABELS: Record<string, string> = {
  rms: "Mix loudness",
  band_energy_sub: "Mix sub band",
  band_energy_bass: "Mix bass band",
  band_energy_low_mid: "Mix low-mid band",
  band_energy_mid: "Mix mid band",
  band_energy_high_mid: "Mix high-mid band",
  band_energy_air: "Mix air band",
  novelty: "Mix novelty",
  rhythmic_density: "Mix rhythmic density",
  spectral_flux: "Mix spectral flux",
};

// Engine stem names that mean the same instrument.
const FAMILY_ALIASES: Record<string, string> = {
  instrumental: "other",
  no_vocals: "other",
  hh: "hihat",
};

export function familyOf(stem: string): string {
  return FAMILY_ALIASES[stem] ?? stem;
}

function loaded(
  f: MixFeature | undefined,
): f is ContinuousFeature & { data: ArrayLike<number> } {
  return f?.render === "continuous" && !!f.data && f.data.length > 0;
}

function title(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Candidates whose data is loaded, in a stable order: stems by engine, then
// drum sub-stems, then mix features.
export function enumerateCandidates(profile: Profile): Candidate[] {
  const out: Candidate[] = [];
  for (const [engine, stems] of Object.entries(profile.stems)) {
    for (const [stem, entry] of Object.entries(stems)) {
      const energy = entry.features.energy;
      if (loaded(energy))
        out.push({
          path: `stems.${engine}.${stem}.features.energy`,
          label: `${title(stem)} (${engine})`,
          family: familyOf(stem),
          kind: "stem",
          engine,
          feature: energy,
          data: energy.data,
        });
      for (const [sub, subEntry] of Object.entries(entry.substems ?? {})) {
        const subEnergy = subEntry.features.energy;
        if (loaded(subEnergy))
          out.push({
            path: `stems.${engine}.${stem}.substems.${sub}.features.energy`,
            label: `${title(familyOf(sub))} (${engine})`,
            family: familyOf(sub),
            kind: "substem",
            engine,
            feature: subEnergy,
            data: subEnergy.data,
          });
      }
    }
  }
  for (const name of MIX_CANDIDATES) {
    const f = profile.mix[name];
    if (loaded(f))
      out.push({
        path: `mix.${name}`,
        label: MIX_LABELS[name],
        family: `mix.${name}`,
        kind: "mix",
        engine: null,
        feature: f,
        data: f.data,
      });
  }
  return out;
}
