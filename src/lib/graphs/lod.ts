// Min/max decimation for continuous lanes. A lane is ~1000px wide; drawing a
// 30k-point path per redraw is what makes full-extent zooming and playback
// redraws expensive. Per bucket the two extremes survive at their true
// times, in index order, so peaks and silences render identically to the
// full data at that scale.

export const LOD_BUCKETS = 2048;

// Visible source points above this render from the decimated set; below it
// the full data is cheap (uPlot clips to the scale range).
export const LOD_THRESHOLD_POINTS = 8000;

export function decimateMinMax(
  data: ArrayLike<number>,
  frameRateHz: number,
  buckets = LOD_BUCKETS,
): [number[], number[]] | null {
  const n = data.length;
  if (n <= buckets * 2) return null; // small enough to draw directly
  const size = Math.ceil(n / buckets);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let start = 0; start < n; start += size) {
    const end = Math.min(n, start + size);
    let minI = start;
    let maxI = start;
    for (let i = start + 1; i < end; i++) {
      if (data[i] < data[minI]) minI = i;
      if (data[i] > data[maxI]) maxI = i;
    }
    const a = Math.min(minI, maxI);
    const b = Math.max(minI, maxI);
    xs.push(a / frameRateHz);
    ys.push(data[a]);
    if (b !== a) {
      xs.push(b / frameRateHz);
      ys.push(data[b]);
    }
  }
  return [xs, ys];
}
