// OKLCH color math for the mapping engine. OKLCH is the app's color model —
// perceptually even, so gradients and pitch wheels don't band or shift in
// brightness. RGB conversion happens only at the edges (canvas, hardware).
// Conversion math from Björn Ottosson's OKLab reference implementation.

export interface Oklch {
  l: number; // lightness 0–1
  c: number; // chroma, 0 = gray (~0.37 max for sRGB primaries)
  h: number; // hue in degrees
}

export interface Rgb {
  r: number; // 0–1
  g: number;
  b: number;
}

const DEG = Math.PI / 180;

// OKLCH → linear sRGB, no gamut handling (components may fall outside [0,1]).
function oklchToLinear(l: number, c: number, h: number): Rgb {
  const a = c * Math.cos(h * DEG);
  const b = c * Math.sin(h * DEG);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;
  return {
    r: 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  };
}

// Linear component → gamma-encoded sRGB.
function encode(x: number): number {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

const IN_GAMUT_EPS = 1e-4;

function inGamut(rgb: Rgb): boolean {
  return (
    rgb.r >= -IN_GAMUT_EPS &&
    rgb.r <= 1 + IN_GAMUT_EPS &&
    rgb.g >= -IN_GAMUT_EPS &&
    rgb.g <= 1 + IN_GAMUT_EPS &&
    rgb.b >= -IN_GAMUT_EPS &&
    rgb.b <= 1 + IN_GAMUT_EPS
  );
}

// OKLCH → sRGB with gamut clamping: out-of-gamut colors keep lightness and
// hue and give up chroma (bisected to the gamut boundary) rather than letting
// channels overflow, which would shift the hue.
export function oklchToRgb(color: Oklch): Rgb {
  const l = Math.max(0, Math.min(1, color.l));
  let c = Math.max(0, color.c);
  let rgb = oklchToLinear(l, c, color.h);
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i++) {
      c = (lo + hi) / 2;
      rgb = oklchToLinear(l, c, color.h);
      if (inGamut(rgb)) lo = c;
      else hi = c;
    }
    rgb = oklchToLinear(l, lo, color.h);
  }
  return {
    r: Math.max(0, Math.min(1, encode(rgb.r))),
    g: Math.max(0, Math.min(1, encode(rgb.g))),
    b: Math.max(0, Math.min(1, encode(rgb.b))),
  };
}

// Byte triple for canvas pixel buffers.
export function oklchToRgb8(color: Oklch): [number, number, number] {
  const { r, g, b } = oklchToRgb(color);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// CSS color string (bypasses native oklch() so canvas 2D contexts, which only
// take rgb strings pre-Chromium-111, always work).
export function oklchToCss(color: Oklch, alpha = 1): string {
  const [r, g, b] = oklchToRgb8(color);
  return alpha >= 1
    ? `rgb(${r},${g},${b})`
    : `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

// Interpolate in OKLCH with shortest-path hue, so a gradient between two hues
// never detours around the wheel. A gray endpoint (c≈0) adopts the other
// side's hue — its own hue is meaningless and would drag the path.
export function mixOklch(a: Oklch, b: Oklch, t: number): Oklch {
  const ha = a.c < 1e-6 ? b.h : a.h;
  const hb = b.c < 1e-6 ? a.h : b.h;
  const dh = ((((hb - ha) % 360) + 540) % 360) - 180;
  return {
    l: a.l + (b.l - a.l) * t,
    c: a.c + (b.c - a.c) * t,
    h: (((ha + dh * t) % 360) + 360) % 360,
  };
}

// Sample a multi-stop gradient at t ∈ [0,1], stops evenly spaced.
export function gradient(stops: Oklch[], t: number): Oklch {
  if (stops.length === 1) return stops[0];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  return mixOklch(stops[i], stops[i + 1], x - i);
}

// ── Palettes ────────────────────────────────────────────────────────────────

// Pitch-class wheel: 12 hues at equal lightness/chroma, C at 0° (red) and the
// circle of semitones spread evenly, so pitch distance reads as hue distance.
export const PITCH_WHEEL_L = 0.7;
export const PITCH_WHEEL_C = 0.15;

export function pitchClassColor(pc: number): Oklch {
  const idx = ((Math.round(pc) % 12) + 12) % 12;
  return { l: PITCH_WHEEL_L, c: PITCH_WHEEL_C, h: (idx * 360) / 12 };
}

// Warm↔cool ramp for color_temp: t=0 candle-warm amber, t=1 cool sky blue.
export const WARM_COOL: Oklch[] = [
  { l: 0.75, c: 0.14, h: 55 },
  { l: 0.85, c: 0.02, h: 90 },
  { l: 0.75, c: 0.12, h: 240 },
];

// Section palette: visually distinct colors assigned to section labels in
// first-seen order (mirrors the graph kit's label coloring).
export const SECTION_COLORS: Oklch[] = [
  { l: 0.65, c: 0.17, h: 275 }, // indigo
  { l: 0.75, c: 0.13, h: 210 }, // cyan
  { l: 0.75, c: 0.15, h: 155 }, // green
  { l: 0.8, c: 0.15, h: 80 }, // amber
  { l: 0.65, c: 0.2, h: 25 }, // red
  { l: 0.65, c: 0.19, h: 310 }, // purple
  { l: 0.7, c: 0.18, h: 350 }, // pink
  { l: 0.8, c: 0.17, h: 125 }, // lime
];

export function sectionColor(index: number): Oklch {
  return SECTION_COLORS[
    ((index % SECTION_COLORS.length) + SECTION_COLORS.length) %
      SECTION_COLORS.length
  ];
}

// Named scalar→color palettes for the colormap transform: t ∈ [0,1] → color.
export const PALETTES: Record<string, (t: number) => Oklch> = {
  // Continuous pitch wheel (t = pitch class / 12, wraps).
  pitch_wheel: (t) => ({
    l: PITCH_WHEEL_L,
    c: PITCH_WHEEL_C,
    h: (((t % 1) + 1) % 1) * 360,
  }),
  warm_cool: (t) => gradient(WARM_COOL, t),
  // Dark violet → bright yellow intensity ramp (heat-style, hue-safe).
  heat: (t) =>
    gradient(
      [
        { l: 0.25, c: 0.08, h: 300 },
        { l: 0.55, c: 0.2, h: 25 },
        { l: 0.85, c: 0.16, h: 90 },
      ],
      t,
    ),
};
