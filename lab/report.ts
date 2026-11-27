// lab report: one self-contained HTML page per run comparing algorithms per
// song: output metrics, what each light plays, and the full candidate table.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ShowResult } from "$lib/showgen/types";

import type { ShowMetrics } from "./metrics";

interface ShowFile {
  song: { id: string; title: string; artist: string };
  algorithm: string;
  ms: number;
  metrics: ShowMetrics;
  result: ShowResult;
}

const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
const f2 = (n: number | undefined) => (n === undefined ? "" : n.toFixed(2));

const METRIC_LABELS: [keyof ShowMetrics, string, string][] = [
  [
    "visible_change",
    "Visible change",
    "share of seconds each light visibly changes",
  ],
  ["distinctness", "Distinctness", "1 − mean correlation between lights"],
  [
    "beat_alignment",
    "Flashes on beat",
    "share of flashes within 70 ms of a beat",
  ],
  ["dark_time", "Dark time", "share of time lights sit dark for over 4 s"],
  ["mean_level", "Mean level", "average light level"],
];

const MEASURE_ORDER = [
  "presence",
  "level",
  "motion",
  "pulse",
  "alignment",
  "onset_rate",
  "contrast",
  "section_contrast",
  "flicker",
  "leak",
];

export function report(runDir: string): string {
  const run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
  const algs: { id: string; label: string; description: string }[] =
    run.algorithms;
  const lightName = new Map<string, string>(
    run.lights.map((l: { id: string; name: string; kind: string }) => [
      l.id,
      `${l.name} · ${l.kind}`,
    ]),
  );
  const songs: { id: string; title: string; artist: string }[] = run.songs;
  const shows = new Map<string, ShowFile>();
  for (const s of songs)
    for (const a of algs) {
      const p = join(runDir, s.id, `${a.id}.json`);
      if (existsSync(p))
        shows.set(`${s.id}/${a.id}`, JSON.parse(readFileSync(p, "utf8")));
    }

  const avg = (alg: string, key: keyof ShowMetrics) => {
    const xs = songs
      .map((s) => shows.get(`${s.id}/${alg}`)?.metrics[key])
      .filter((x): x is number => x !== undefined);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
  };

  const videos = existsSync(join(runDir, "videos"))
    ? readdirSync(join(runDir, "videos"))
    : [];

  let html = `<!doctype html><meta charset="utf-8"><title>Show Lab · ${esc(runDir.split("/").pop())}</title>
<style>
:root{color-scheme:dark;--bg:#1b1c1f;--surface:#232428;--edge:#34363c;--ink:#d6d7da;--muted:#9a9ca3;--faint:#6d7078;--accent:#5aa2ff}
body{background:var(--bg);color:var(--ink);font:13px/1.45 -apple-system,BlinkMacSystemFont,"Inter",sans-serif;margin:0;padding:24px 32px;max-width:1400px}
h1{font-size:18px;font-weight:600;margin:0 0 4px} h2{font-size:15px;font-weight:600;margin:32px 0 8px;padding-top:16px;border-top:1px solid var(--edge)}
h3{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);margin:16px 0 6px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums} th,td{padding:4px 8px;border-bottom:1px solid var(--edge);text-align:left;vertical-align:top}
th{color:var(--muted);font-weight:500;font-size:12px} td.num{text-align:right} tr.picked td{color:var(--ink)} tr.rej td{color:var(--faint)}
.grid{display:grid;grid-template-columns:repeat(${algs.length},1fr);gap:16px} .card{background:var(--surface);border:1px solid var(--edge);border-radius:6px;padding:12px}
.muted{color:var(--muted)} .sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
details summary{cursor:pointer;color:var(--muted);margin-top:8px} video{width:100%;border-radius:6px;border:1px solid var(--edge);margin-top:8px}
a{color:var(--accent)}
</style>
<h1>Show Lab run</h1>
<div class="muted">${esc(run.created)} · ${songs.length} songs · room ${esc(run.room)} · ${run.lights.length} lights · palette ${esc(run.palette.id)}</div>
<h3>Algorithms</h3><table><tr><th>Id</th><th>Description</th>${METRIC_LABELS.map(([, l, d]) => `<th title="${esc(d)}">${l}</th>`).join("")}</tr>
${algs.map((a) => `<tr><td>${esc(a.label)}</td><td class="muted">${esc(a.description)}</td>${METRIC_LABELS.map(([k]) => `<td class="num">${f2(avg(a.id, k))}</td>`).join("")}</tr>`).join("")}
</table>
<p class="muted">Metrics describe what the lights do. They support judging the videos by eye and ear; they are not targets.</p>`;

  for (const s of songs) {
    html += `<h2>${esc(s.artist)} – ${esc(s.title)}</h2>`;
    const vid = videos.find((v) => v.startsWith(s.id) && v.includes("compare"));
    if (vid)
      html += `<video controls preload="none" src="videos/${esc(vid)}"></video>`;
    html += `<div class="grid">`;
    for (const a of algs) {
      const show = shows.get(`${s.id}/${a.id}`);
      if (!show) {
        html += `<div class="card muted">${esc(a.label)}: no output</div>`;
        continue;
      }
      const r = show.result;
      const progName = new Map(r.programs.map((p) => [p.id, p.name ?? p.id]));
      const progHue = new Map(
        r.programs.map((p) => [
          p.id,
          typeof p.channels.hue === "number" ? p.channels.hue : null,
        ]),
      );
      html += `<div class="card"><h3>${esc(a.label)}</h3><table>
${METRIC_LABELS.map(([k, l]) => `<tr><td class="muted">${l}</td><td class="num">${f2(show.metrics[k])}</td></tr>`).join("")}</table>
<h3>Lights</h3><table>${Object.entries(r.patch)
        .map(([light, pid]) => {
          const pick = r.report.picks.find((p) => p.programId === pid);
          const hue = progHue.get(pid);
          const sw =
            hue === null || hue === undefined
              ? ""
              : `<span class="sw" style="background:oklch(0.7 0.15 ${hue})"></span>`;
          return `<tr><td>${esc(lightName.get(light) ?? light)}</td><td>${sw}${esc(progName.get(pid))}${pick?.role ? ` <span class="muted">· ${esc(pick.role)}</span>` : ""}</td></tr>`;
        })
        .join("")}</table>
${r.report.notes.length ? `<p class="muted">${r.report.notes.map(esc).join("<br>")}</p>` : ""}
<details><summary>Candidates (${r.report.candidates.length})</summary><table><tr><th>Track</th><th>Score</th>${MEASURE_ORDER.map((m) => `<th>${m}</th>`).join("")}<th>Why</th></tr>
${r.report.candidates
  .map(
    (c) =>
      `<tr class="${c.picked ? "picked" : c.score === 0 ? "rej" : ""}"><td>${esc(c.label)}</td><td class="num">${f2(c.score)}</td>${MEASURE_ORDER.map((m) => `<td class="num">${f2(c.measures[m])}</td>`).join("")}<td>${esc(c.reason)}</td></tr>`,
  )
  .join("")}</table></details></div>`;
    }
    html += `</div>`;
  }
  const out = join(runDir, "index.html");
  writeFileSync(out, html);
  return out;
}
