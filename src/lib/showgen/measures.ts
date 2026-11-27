// Envelope measures for ranking candidate tracks (docs/milestone-8-show-lab/
// ranking.md). Pure functions over a 100 Hz envelope and the song's mix data.
// A measure an algorithm depends on keeps its behavior; a changed measure is
// a new function.

export type Track = ArrayLike<number>;

export function percentile(x: Track, q: number): number {
  if (x.length === 0) return 0;
  const sorted = Float32Array.from(x).sort();
  const i = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((q / 100) * (sorted.length - 1))),
  );
  return sorted[i];
}

function mean(x: Track): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return x.length ? s / x.length : 0;
}

// Fraction of frames above 10 % of the track's robust peak (p99).
export function presence(x: Track): number {
  const floor = 0.1 * percentile(x, 99);
  if (floor <= 0) return 0;
  let n = 0;
  for (let i = 0; i < x.length; i++) if (x[i] > floor) n++;
  return n / x.length;
}

// Median ratio of the candidate's absolute level to the mix's, over frames
// where the mix is above its p20. Both envelopes are RMS normalized by their
// own raw peak (`scale`), so absolute level = data · scale.
export function level(
  x: Track,
  xScale: number,
  mix: Track,
  mixScale: number,
): number {
  const gate = percentile(mix, 20);
  const ratios: number[] = [];
  const n = Math.min(x.length, mix.length);
  for (let i = 0; i < n; i++) {
    if (mix[i] <= gate || mix[i] <= 0) continue;
    ratios.push((x[i] * xScale) / (mix[i] * mixScale));
  }
  return ratios.length ? percentile(ratios, 50) : 0;
}

// (p90 - p10) / p90: visible dynamic range.
export function contrast(x: Track): number {
  const hi = percentile(x, 90);
  return hi > 0 ? (hi - percentile(x, 10)) / hi : 0;
}

// ── Spectra ─────────────────────────────────────────────────────────────────

// In-place iterative radix-2 FFT; re/im length must be a power of two.
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// Power spectrum of the mean-removed, Hann-windowed envelope.
// Returns power per bin and the bin width in Hz.
export function modulationSpectrum(
  x: Track,
  hz: number,
): { power: Float64Array; df: number } {
  const n = nextPow2(x.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const m = mean(x);
  const len = x.length;
  for (let i = 0; i < len; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, len - 1));
    re[i] = (x[i] - m) * w;
  }
  fft(re, im);
  const power = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];
  return { power, df: hz / n };
}

function bandPower(
  power: Float64Array,
  df: number,
  lo: number,
  hi: number,
): number {
  let s = 0;
  const a = Math.max(0, Math.ceil(lo / df));
  const b = Math.min(power.length - 1, Math.floor(hi / df));
  for (let k = a; k <= b; k++) s += power[k];
  return s;
}

// Share of 0.25–20 Hz modulation power in 0.5–8 Hz (beat and phrase scale).
export function motion(x: Track, hz: number): number {
  const { power, df } = modulationSpectrum(x, hz);
  const total = bandPower(power, df, 0.25, 20);
  return total > 0 ? bandPower(power, df, 0.5, 8) / total : 0;
}

// Modulation power above 10 Hz over power in 1–8 Hz.
export function flicker(x: Track, hz: number): number {
  const { power, df } = modulationSpectrum(x, hz);
  const beat = bandPower(power, df, 1, 8);
  return beat > 0 ? bandPower(power, df, 10, hz / 2) / beat : 0;
}

// ── Pulse ───────────────────────────────────────────────────────────────────

// Half-wave rectified first difference: where the envelope rises.
export function onsetCurve(x: Track): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 1; i < x.length; i++) out[i] = Math.max(0, x[i] - x[i - 1]);
  return out;
}

// Normalized autocorrelation (lag 0 = 1) of a mean-removed signal, via FFT.
export function autocorrelation(x: Track): Float64Array {
  const n = nextPow2(2 * x.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const m = mean(x);
  for (let i = 0; i < x.length; i++) re[i] = x[i] - m;
  fft(re, im);
  for (let k = 0; k < n; k++) {
    re[k] = re[k] * re[k] + im[k] * im[k];
    im[k] = 0;
  }
  // Inverse via the forward transform of the conjugate (power is real).
  fft(re, im);
  const out = new Float64Array(x.length);
  const zero = re[0];
  for (let i = 0; i < x.length; i++) out[i] = zero > 0 ? re[i] / zero : 0;
  return out;
}

// Pulse clarity: the highest normalized autocorrelation of the onset curve at
// 0.5, 1 and 2 beat periods (±3 %). After Lartillot et al. 2008
// (mirpulseclarity, autocorrelation maximum at beat lags).
export function pulseClarity(
  x: Track,
  hz: number,
  beatPeriodS: number,
): number {
  if (!(beatPeriodS > 0)) return 0;
  const ac = autocorrelation(onsetCurve(x));
  let best = 0;
  for (const mult of [0.5, 1, 2]) {
    const lag = beatPeriodS * mult * hz;
    const a = Math.max(1, Math.floor(lag * 0.97));
    const b = Math.min(ac.length - 1, Math.ceil(lag * 1.03));
    for (let i = a; i <= b; i++) if (ac[i] > best) best = ac[i];
  }
  return Math.max(0, Math.min(1, best));
}

// Fraction of onsets within `tol` seconds of a beat or half-beat.
export function beatAlignment(
  onsets: number[],
  beats: number[],
  tol = 0.05,
): number {
  if (onsets.length === 0 || beats.length === 0) return 0;
  const grid: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    grid.push(beats[i]);
    if (i + 1 < beats.length) grid.push((beats[i] + beats[i + 1]) / 2);
  }
  grid.sort((a, b) => a - b);
  let hits = 0;
  let j = 0;
  for (const t of [...onsets].sort((a, b) => a - b)) {
    while (j + 1 < grid.length && grid[j + 1] <= t) j++;
    const d = Math.min(
      Math.abs(t - grid[j]),
      j + 1 < grid.length ? Math.abs(grid[j + 1] - t) : Infinity,
    );
    if (d <= tol) hits++;
  }
  return hits / onsets.length;
}

// Std / mean of the per-section mean level.
export function sectionContrast(
  x: Track,
  hz: number,
  sections: { start: number; end: number }[],
): number {
  const means: number[] = [];
  for (const s of sections) {
    const a = Math.max(0, Math.floor(s.start * hz));
    const b = Math.min(x.length, Math.ceil(s.end * hz));
    if (b - a < hz) continue;
    let sum = 0;
    for (let i = a; i < b; i++) sum += x[i];
    means.push(sum / (b - a));
  }
  if (means.length < 2) return 0;
  const m = mean(means);
  if (m <= 0) return 0;
  const v = means.reduce((s, y) => s + (y - m) ** 2, 0) / means.length;
  return Math.sqrt(v) / m;
}

// ── Similarity ──────────────────────────────────────────────────────────────

// 10 Hz block means, log-compressed so quiet passages count, for correlation.
export function compress10(x: Track, hz: number): Float64Array {
  const step = Math.max(1, Math.round(hz / 10));
  const n = Math.floor(x.length / step);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < step; k++) s += x[i * step + k];
    out[i] = Math.log1p(100 * Math.max(0, s / step));
  }
  return out;
}

export function pearson(a: Track, b: Track): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

// Fraction of 1 s windows in which the envelope, mapped through the glow
// transform (p5..p98 → 0..1, gamma), moves by more than `threshold`: how
// often a light driven by it visibly changes.
export function visibleChange(
  x: Track,
  hz: number,
  gamma = 1.6,
  threshold = 0.15,
): number {
  const lo = percentile(x, 5);
  const hi = percentile(x, 98);
  if (hi <= lo) return 0;
  const win = Math.max(1, Math.round(hz));
  let windows = 0;
  let moving = 0;
  for (let a = 0; a + win <= x.length; a += win) {
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = a; i < a + win; i++) {
      const v = Math.pow(
        Math.min(1, Math.max(0, (x[i] - lo) / (hi - lo))),
        gamma,
      );
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    windows++;
    if (mx - mn > threshold) moving++;
  }
  return windows ? moving / windows : 0;
}

// Fraction of `windowS` windows whose peak exceeds 10 % of the track's p99:
// how much of the song the track is active in. Unlike per-frame presence it
// counts a sparse hit track (a kick on every beat) as present throughout.
export function windowPresence(x: Track, hz: number, windowS = 2): number {
  const floor = 0.1 * percentile(x, 99);
  if (floor <= 0) return 0;
  const win = Math.max(1, Math.round(windowS * hz));
  let windows = 0;
  let active = 0;
  for (let a = 0; a + win <= x.length; a += win) {
    windows++;
    for (let i = a; i < a + win; i++)
      if (x[i] > floor) {
        active++;
        break;
      }
  }
  return windows ? active / windows : 0;
}
