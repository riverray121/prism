// Show algorithms by id. A compared algorithm is never edited: a change is a
// new file registered under a new id.

import { v1Baseline } from "$lib/showgen/algorithms/v1-baseline";
import { v2Ranked } from "$lib/showgen/algorithms/v2-ranked";
import { v3Roles } from "$lib/showgen/algorithms/v3-roles";
import { v4Verified } from "$lib/showgen/algorithms/v4-verified";
import type { ShowAlgorithm, ShowInput, ShowResult } from "$lib/showgen/types";

export const ALGORITHMS: ShowAlgorithm[] = [
  v1Baseline,
  v2Ranked,
  v3Roles,
  v4Verified,
];

export const DEFAULT_ALGORITHM = "v1-baseline";

export function algorithmById(id: string): ShowAlgorithm {
  return ALGORITHMS.find((a) => a.id === id) ?? ALGORITHMS[0];
}

export function generateShow(id: string, input: ShowInput): ShowResult {
  return algorithmById(id).generate(input);
}
