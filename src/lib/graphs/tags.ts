// Row extraction for tags matrices ([rows, frames] probabilities), kept pure
// so the renderer component only iterates.

import type { Npy } from "$lib/npy";

// A row is "present" when its peak clears the threshold — a row that never
// fires would only be a flat zero line. Returned in descending-peak order so
// the prominent tags lead.
export function presentRows(
  matrix: Npy,
  labels: string[],
  threshold: number,
): { label: string; data: number[] }[] {
  const [nRows, nCols] = matrix.shape;
  const present: { label: string; peak: number; data: number[] }[] = [];
  for (let r = 0; r < nRows; r++) {
    const slice = matrix.data.subarray(r * nCols, (r + 1) * nCols);
    let peak = 0;
    for (let i = 0; i < slice.length; i++) if (slice[i] > peak) peak = slice[i];
    if (peak < threshold) continue;
    present.push({
      label: labels[r] ?? `row ${r}`,
      peak,
      data: Array.from(slice),
    });
  }
  present.sort((a, b) => b.peak - a.peak);
  return present.map(({ label, data }) => ({ label, data }));
}
