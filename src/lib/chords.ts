// Chord-event labeling, shared presentation logic for event lanes. Chord
// events carry root/quality/confidence as passthrough attrs (unknown-typed),
// so every access narrows at runtime — no casts.

import type { EventFeature } from "$lib/ipc/messages";

// Compact musical shorthand for a chord quality (BTC's vocabulary). Major
// renders as the bare root by convention.
const CHORD_QUALITY: Record<string, string> = {
  maj: "",
  min: "m",
  dim: "dim",
  aug: "aug",
  min6: "m6",
  maj6: "6",
  min7: "m7",
  minmaj7: "mM7",
  maj7: "maj7",
  "7": "7",
  dim7: "dim7",
  hdim7: "ø7",
  sus2: "sus2",
  sus4: "sus4",
};

// Append an ML confidence percentage to a label, when the event carries one.
function withConfidence(label: string, confidence: unknown): string {
  return typeof confidence === "number"
    ? `${label} ${Math.round(confidence * 100)}%`
    : label;
}

// Label a chord event with the model's confidence. 'N' (no chord) and 'X'
// (unknown) carry no quality. Returns null when the event has no chord root.
export function chordLabel(ev: EventFeature["events"][number]): string | null {
  const root = typeof ev.root === "string" ? ev.root : null;
  if (!root) return null;
  if (root === "N" || root === "X") return withConfidence(root, ev.confidence);
  const quality = typeof ev.quality === "string" ? ev.quality : "";
  return withConfidence(
    root + (CHORD_QUALITY[quality] ?? quality),
    ev.confidence,
  );
}
