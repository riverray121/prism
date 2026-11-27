// lab generate: run algorithms over every analyzed song in a library for one
// room's lights; write each show, its report and its output metrics.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { generateShow, algorithmById } from "$lib/showgen/registry";
import type { LightSpec, PaletteRef } from "$lib/showgen/types";

import { listSongs, loadProfile } from "./library";
import { levelSeries, metricsFromSeries } from "./metrics";

export interface GenerateOptions {
  library: string;
  out: string;
  algorithms: string[];
  lights: LightSpec[];
  roomPath: string;
  palette: PaletteRef;
  songs?: string[];
}

export function generate(opts: GenerateOptions): void {
  mkdirSync(opts.out, { recursive: true });
  const songs = listSongs(opts.library).filter(
    (s) =>
      !opts.songs ||
      opts.songs.some(
        (q) =>
          s.id.startsWith(q) ||
          `${s.artist} - ${s.title}`.toLowerCase().includes(q.toLowerCase()),
      ),
  );
  const manifest = {
    created: new Date().toISOString(),
    library: opts.library,
    room: opts.roomPath,
    palette: opts.palette,
    algorithms: opts.algorithms.map((id) => {
      const a = algorithmById(id);
      return { id: a.id, label: a.label, description: a.description };
    }),
    lights: opts.lights,
    songs: songs.map((s) => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      source: s.sourceFile,
    })),
  };
  writeFileSync(join(opts.out, "run.json"), JSON.stringify(manifest, null, 2));
  for (const song of songs) {
    const profile = loadProfile(song);
    const beatsF = profile.mix.beats;
    const beats =
      beatsF?.render === "event" ? beatsF.events.map((e) => e.t) : [];
    const dir = join(opts.out, song.id);
    mkdirSync(dir, { recursive: true });
    for (const id of opts.algorithms) {
      const started = performance.now();
      const result = generateShow(id, {
        profile,
        lights: opts.lights,
        palette: opts.palette,
      });
      const ms = performance.now() - started;
      const metrics = metricsFromSeries(
        levelSeries(profile, result, opts.lights),
        beats,
      );
      writeFileSync(
        join(dir, `${id}.json`),
        JSON.stringify({
          song: { id: song.id, title: song.title, artist: song.artist },
          algorithm: id,
          ms,
          metrics,
          result,
        }),
      );
      console.log(
        `${song.artist} - ${song.title} · ${id} · ${ms.toFixed(0)} ms · change ${metrics.visible_change.toFixed(2)} distinct ${metrics.distinctness.toFixed(2)}`,
      );
    }
  }
}
