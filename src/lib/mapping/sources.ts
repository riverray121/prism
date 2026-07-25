import { humanize } from "$lib/format";
import type { MixFeature, Profile } from "$lib/ipc/messages";

// Dot-path resolution over the profile — the favorites addressing, shared by
// the mapping schema, sources panel, and evaluator.

export function resolveNode(profile: Profile, path: string): unknown {
  let node: unknown = profile;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

// A profile dot-path as a feature envelope, if it points at one.
export function resolveFeature(
  profile: Profile,
  path: string,
): MixFeature | undefined {
  const node = resolveNode(profile, path);
  if (typeof node !== "object" || node === null) return undefined;
  if (!("render" in node)) return undefined;
  return node as MixFeature;
}

// One favorited subfeature, resolved for the sources panel.
export interface FavoriteSource {
  path: string;
  feature: MixFeature;
}

// Favorited paths that resolve to feature envelopes, in favorites order.
// Stale paths (re-analysis removed the feature) are silently skipped here;
// bindings referencing them warn at evaluation time.
export function favoriteSources(profile: Profile): FavoriteSource[] {
  const out: FavoriteSource[] = [];
  for (const path of profile.favorites) {
    const feature = resolveFeature(profile, path);
    if (feature) out.push({ path, feature });
  }
  return out;
}

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
  const parts = path.split(".");
  if (parts[0] === "mix") return `${humanize(parts.slice(1).join("."))} (mix)`;
  if (parts[0] === "stems") {
    const name = parts.at(-1) ?? path;
    const context = parts
      .slice(1, -1)
      .filter((p) => p !== "features" && p !== "substems");
    return `${humanize(name)} (${context.join(" · ")})`;
  }
  if (parts[0] === "derived")
    return `${humanize(parts.slice(1).join("."))} (derived)`;
  return path;
}
