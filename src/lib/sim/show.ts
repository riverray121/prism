// Room shows: per song and per room, the programs and patch that drive a
// room's simulated lights (songs/{id}/mapping/sim.json). A room show is a
// MappingDoc of its own, separate from the song's hardware mapping, so a
// 10-light room never rewrites the real rig's show.

import { z } from "zod";

import {
  MappingDocSchema,
  type MappingDoc,
  type Program,
} from "$lib/mapping/schema";
import type { PaletteRef, ShowResult } from "$lib/showgen/types";

export const SimDocSchema = z.object({
  rooms: z.record(z.string(), MappingDocSchema).default({}),
});
export type SimDoc = z.infer<typeof SimDocSchema>;

// Prefix for programs copied in from the song's hardware mapping, so their
// ids never collide with the room show's own.
export const MAPPING_PREFIX = "mapping:";

export function showFromResult(
  result: ShowResult,
  palette: PaletteRef,
  algorithm: string,
): MappingDoc {
  return MappingDocSchema.parse({
    derivations: result.derivations,
    programs: result.programs,
    macro: result.macro,
    patch: result.patch,
    palette,
    generator: { algorithm, report: result.report },
  });
}

// Every derivation id a program's channels read ("derived.{id}" sources).
function derivationIds(program: Program): string[] {
  const ids: string[] = [];
  for (const v of Object.values(program.channels))
    if (typeof v === "object" && v.source.startsWith("derived."))
      ids.push(v.source.slice("derived.".length));
  return ids;
}

// Drive one room light with a program. `programId` names a room-show program
// or, with MAPPING_PREFIX, a program of the song's hardware mapping, which is
// copied into the show (with the derivations it reads) so the show stays
// self-contained. null turns the light off. Returns a new show.
export function assignProgram(
  show: MappingDoc,
  lightId: string,
  programId: string | null,
  mapping: MappingDoc | null,
): MappingDoc {
  const next = structuredClone(show);
  if (programId === null) {
    delete next.patch[lightId];
    return next;
  }
  if (programId.startsWith(MAPPING_PREFIX) && mapping) {
    const sourceId = programId.slice(MAPPING_PREFIX.length);
    const program = mapping.programs.find((p) => p.id === sourceId);
    if (!program) return next;
    if (!next.programs.some((p) => p.id === programId)) {
      next.programs.push({ ...structuredClone(program), id: programId });
      for (const id of derivationIds(program)) {
        const d = mapping.derivations.find((x) => x.id === id);
        if (d && !next.derivations.some((x) => x.id === id))
          next.derivations.push(structuredClone(d));
      }
    }
  }
  next.patch[lightId] = programId;
  return next;
}

// Drop patch entries for lights no longer in the room, and copied mapping
// programs no light uses any more.
export function pruneShow(show: MappingDoc, lightIds: Set<string>): MappingDoc {
  const next = structuredClone(show);
  for (const id of Object.keys(next.patch))
    if (!lightIds.has(id)) delete next.patch[id];
  const used = new Set(Object.values(next.patch));
  next.programs = next.programs.filter(
    (p) => !p.id.startsWith(MAPPING_PREFIX) || used.has(p.id),
  );
  return next;
}
