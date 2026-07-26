// Display names for mapping entities. Presentation-only — the evaluator and
// any headless consumer never import this; addressing stays in sources.ts.

import { humanize } from "$lib/format";
import { parseSourcePath } from "$lib/mapping/sources";

// Display name for a program or derivation: the user-set name, else the
// humanized id.
export function programLabel(p: { id: string; name?: string }): string {
  return p.name ?? humanize(p.id);
}
export const derivationLabel = programLabel;

// Short human label for a source path: humanized feature name plus its
// context. "mix.rms" → "RMS (mix)"; "stems.eng.drums.features.drums_energy" →
// "Drums energy (eng · drums)"; substems add their name to the context.
export function sourceLabel(path: string): string {
  const p = parseSourcePath(path);
  if (p.root === "mix") return `${humanize(p.name)} (mix)`;
  if (p.root === "derived") return `${humanize(p.name)} (derived)`;
  if (p.root === "stems") {
    const context = [p.engine, p.stem, p.sub].filter(Boolean).join(" · ");
    return `${humanize(p.name)} (${context})`;
  }
  return path;
}
