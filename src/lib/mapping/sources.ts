import type { MixFeature, Profile } from "$lib/ipc/messages";

// Profile addressing: dot-path resolution and source-path shape parsing,
// shared by the mapping schema, sources panel, and evaluator. Presentation
// (labels) lives in labels.ts so this module stays headless.

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

// Decoded source path. The positional layout —
// "mix.{name}", "derived.{id}",
// "stems.{engine}.{stem}[.substems.{sub}].features.{name}" — is encoded HERE
// only; everything else goes through this parser.
export interface SourcePath {
  root: "mix" | "stems" | "derived" | "unknown";
  name: string; // final feature/derivation name
  engine?: string;
  stem?: string;
  sub?: string;
}

export function parseSourcePath(path: string): SourcePath {
  const parts = path.split(".");
  if (parts[0] === "mix")
    return { root: "mix", name: parts.slice(1).join(".") };
  if (parts[0] === "derived")
    return { root: "derived", name: parts.slice(1).join(".") };
  if (parts[0] === "stems") {
    return {
      root: "stems",
      engine: parts[1],
      stem: parts[2],
      sub: parts[3] === "substems" ? parts[4] : undefined,
      name: parts.at(-1) ?? path,
    };
  }
  return { root: "unknown", name: path };
}

// Audio key ("engine::stem[::substem]") for a stem source path — the same
// keys the transport/inspection use to solo a stem. Null for non-stem paths.
export function audioKeyForSource(path: string): string | null {
  const p = parseSourcePath(path);
  if (p.root !== "stems" || !p.engine || !p.stem) return null;
  return p.sub ? `${p.engine}::${p.stem}::${p.sub}` : `${p.engine}::${p.stem}`;
}
