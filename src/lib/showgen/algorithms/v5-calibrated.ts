// v5-calibrated: v4 with two measures calibrated against the lab corpus.
// - Level floor: a stem whose median level is under LEVEL_FLOOR of the
//   mix's (about −30 dB) is separation bleed, however full it looks after
//   peak normalization (the drums-only song's "vocals").
// - Presence is counted over 2 s windows, so a sparse hit track such as a
//   kick on every beat is present, where per-frame presence rejected it.
// - Pulse and accent lights are checked for visible change with a low
//   mean-level floor, since flashes on sparse hits are dark between them.
// Frozen once compared.

import { enumerateCandidates } from "$lib/showgen/candidates";
import { windowPresence } from "$lib/showgen/measures";
import { measureCandidates, score, songContext } from "$lib/showgen/select";
import type { ShowAlgorithm, ShowInput, ShowResult } from "$lib/showgen/types";

import { applyVisibility } from "./v3-roles";
import { verifyAndBuild } from "./v4-verified";

export const LEVEL_FLOOR = 0.03;
export const WINDOW_PRESENCE_FLOOR = 0.4;
// Flash lights pass the output check on visible change alone above this
// mean level: a kick or snare flash is dark between hits.
export const FLASH_LEVEL_FLOOR = 0.03;

function rejection(m: Record<string, number>): string | null {
  if (m.window_presence < WINDOW_PRESENCE_FLOOR)
    return `active in under ${WINDOW_PRESENCE_FLOOR * 100}% of the song (window presence ${m.window_presence.toFixed(2)})`;
  if (m.level !== undefined && m.level < LEVEL_FLOOR)
    return `near-silent next to the mix (level ${m.level.toFixed(3)}): separation bleed`;
  if (m.level !== undefined && m.level > 1.05)
    return `louder than the mix (level ${m.level.toFixed(2)}): bleed or artifact`;
  if (m.contrast < 0.15)
    return `nearly constant (contrast ${m.contrast.toFixed(2)})`;
  if (m.flicker > 1.5)
    return `noise-like flicker (flicker ${m.flicker.toFixed(2)})`;
  return null;
}

export const v5Calibrated: ShowAlgorithm = {
  id: "v5-calibrated",
  label: "v5 calibrated",
  description:
    "v4 with a level floor that rejects separation bleed and presence counted over 2 s windows so sparse hits count.",
  generate(input: ShowInput): ShowResult {
    const ctx = songContext(input.profile);
    const measured = measureCandidates(enumerateCandidates(input.profile), ctx);
    for (const m of measured) {
      m.measures.window_presence = windowPresence(m.candidate.data, ctx.hz);
      m.rejected = rejection(m.measures);
      m.score = m.rejected ? 0 : score(m.measures);
    }
    applyVisibility(measured, ctx.hz);
    return verifyAndBuild(
      input,
      ctx,
      measured,
      "v5-calibrated",
      FLASH_LEVEL_FLOOR,
    );
  },
};
