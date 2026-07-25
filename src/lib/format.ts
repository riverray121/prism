// Seconds → "m:ss". The one clock/duration formatter, shared by the transport
// display and library rows so the two can't drift.
export function formatTime(seconds: number): string {
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Tokens that read as acronyms/units, kept in their canonical casing.
const ACRONYMS: Record<string, string> = {
  rms: "RMS",
  lufs: "LUFS",
  bpm: "BPM",
  mfcc: "MFCC",
  hz: "Hz",
};

// snake_case identifier → sentence-case display name ("color_temp" → "Color
// temp", "loudness_lufs" → "Loudness LUFS"). The one display formatter for
// feature/channel/program/derivation names — ids stay snake_case internally.
export function humanize(name: string): string {
  const words = name.split(/[_\s]+/).filter(Boolean);
  return words
    .map((w, i) => {
      const acronym = ACRONYMS[w.toLowerCase()];
      if (acronym) return acronym;
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    })
    .join(" ");
}
