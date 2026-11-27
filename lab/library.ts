// Node-side loading of a lab library: profiles with every continuous
// feature's data read from its .npy sidecar.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ProfileSchema,
  type MixFeature,
  type Profile,
} from "$lib/ipc/messages";
import { parseNpy } from "$lib/npy";

export interface LabSong {
  id: string;
  dir: string;
  title: string;
  artist: string;
  sourceFile: string;
}

export function listSongs(library: string): LabSong[] {
  const songsDir = join(library, "songs");
  if (!existsSync(songsDir)) return [];
  const out: LabSong[] = [];
  for (const id of readdirSync(songsDir)) {
    const path = join(songsDir, id, "profile.json");
    if (!existsSync(path)) continue;
    const raw = JSON.parse(readFileSync(path, "utf8"));
    out.push({
      id,
      dir: join(songsDir, id),
      title: raw.song.title,
      artist: raw.song.artist,
      sourceFile: join(songsDir, id, raw.song.source_file),
    });
  }
  return out.sort((a, b) => a.artist.localeCompare(b.artist));
}

function hydrate(dir: string, features: Record<string, MixFeature>): void {
  for (const f of Object.values(features)) {
    if (f.render !== "continuous") continue;
    const buf = readFileSync(join(dir, f.sidecar));
    f.data = parseNpy(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    ).data;
  }
}

export function loadProfile(song: LabSong): Profile {
  const profile = ProfileSchema.parse(
    JSON.parse(readFileSync(join(song.dir, "profile.json"), "utf8")),
  );
  hydrate(song.dir, profile.mix);
  for (const stems of Object.values(profile.stems))
    for (const stem of Object.values(stems)) {
      hydrate(song.dir, stem.features);
      for (const sub of Object.values(stem.substems ?? {}))
        hydrate(song.dir, sub.features);
    }
  return profile;
}
