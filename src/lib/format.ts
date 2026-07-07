// Seconds → "m:ss". The one clock/duration formatter, shared by the transport
// display and library rows so the two can't drift.
export function formatTime(seconds: number): string {
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
