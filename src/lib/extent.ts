// Min/max of a numeric series — the one extent scan (several modules grew
// hand-rolled copies that drifted on the empty/flat-range check).
export interface Extent {
  lo: number;
  hi: number;
}

// Null only when the data is empty. Flat data (hi === lo) is returned as-is —
// whether that counts as "no usable range" is the caller's call.
export function extent(data: ArrayLike<number>): Extent | null {
  if (data.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { lo, hi };
}
