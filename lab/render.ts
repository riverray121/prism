// lab render: play a run's shows in the demo room in headless Chrome and
// encode MP4s with the song's audio. One comparison video per song tiles the
// run's algorithms (up to three) plus an info panel in a 2×2 grid; `--only ID`
// renders one algorithm full frame. Time is stepped, never real-time, so the
// output does not depend on render speed.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import { createServer, type Plugin } from "vite";

import { listSongs, loadProfile } from "./library";

export const FPS = 30;

export interface RenderOptions {
  runDir: string;
  songs?: string[];
  seconds: number;
  size: string;
  only?: string;
}

const REPO = fileURLToPath(new URL("..", import.meta.url));

// Serves files under the repo at /fs/<absolute path>; nothing outside it.
function fsPlugin(): Plugin {
  return {
    name: "lab-fs",
    configureServer(server) {
      server.middlewares.use("/fs/", (req, res) => {
        const path = resolve("/", decodeURIComponent((req.url ?? "").split("?")[0]));
        if (!path.startsWith(REPO + sep) || !existsSync(path)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("Cache-Control", "no-store");
        res.end(readFileSync(path));
      });
    },
  };
}

// The excerpt: the loudest section that fits (mean mix loudness), starting
// 2 s before it so the change into it is visible.
export function excerptStart(
  sections: { start: number; end: number }[],
  rms: ArrayLike<number> | null,
  hz: number,
  duration: number,
  seconds: number,
): number {
  if (duration <= seconds) return 0;
  let best = Math.min(30, duration - seconds);
  let bestLevel = -1;
  if (rms)
    for (const s of sections) {
      const a = Math.floor(s.start * hz);
      const b = Math.min(rms.length, Math.floor(Math.min(s.end, s.start + seconds) * hz));
      if (b - a < hz * 4) continue;
      let sum = 0;
      for (let i = a; i < b; i++) sum += rms[i];
      const level = sum / (b - a);
      if (level > bestLevel) {
        bestLevel = level;
        best = s.start;
      }
    }
  return Math.max(0, Math.min(duration - seconds, best - 2));
}

function encoder(out: string, audio: string, start: number, seconds: number) {
  const ff = spawn(
    "ffmpeg",
    [
      "-y", "-loglevel", "error",
      "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
      "-ss", start.toFixed(3), "-t", seconds.toFixed(3), "-i", audio,
      "-map", "0:v", "-map", "1:a",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "19", "-preset", "medium",
      "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart",
      out,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const done = new Promise<void>((ok, fail) =>
    ff.on("close", (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited ${code}`)))),
  );
  return { stdin: ff.stdin, done };
}

export async function render(opts: RenderOptions): Promise<void> {
  const run = JSON.parse(readFileSync(resolve(opts.runDir, "run.json"), "utf8"));
  const [w, h] = opts.size.split("x").map(Number);
  const algorithms: { id: string; label: string }[] = run.algorithms.filter(
    (a: { id: string }) => !opts.only || a.id === opts.only,
  );
  const tiles = algorithms.slice(0, 3);
  const songs = listSongs(run.library).filter(
    (s) =>
      run.songs.some((r: { id: string }) => r.id === s.id) &&
      (!opts.songs || opts.songs.some((q) => s.id.startsWith(q) || `${s.artist} - ${s.title}`.toLowerCase().includes(q.toLowerCase()))),
  );
  const outDir = resolve(opts.runDir, "videos");
  mkdirSync(outDir, { recursive: true });

  const server = await createServer({
    configFile: false,
    root: resolve(REPO, "lab/render"),
    logLevel: "error",
    resolve: { alias: { $lib: resolve(REPO, "src/lib") } },
    server: { port: 0, host: "127.0.0.1", fs: { allow: [REPO] } },
    plugins: [fsPlugin()],
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === "object" && address ? address.port : 5173;
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
  });
  const single = tiles.length === 1;
  const page = await browser.newPage({
    viewport: single ? { width: w * 2, height: h * 2 } : { width: w * 2, height: h * 2 },
  });
  page.on("console", (m) => {
    if (m.type() === "error") console.error("page:", m.text());
  });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(() => "lab" in window);

  try {
    for (const song of songs) {
      const profile = loadProfile(song);
      const hz = profile.timeline.frame_rate_hz;
      const duration = profile.timeline.frame_count / hz;
      const sectionsF = profile.mix.sections;
      const sections = sectionsF?.render === "segment" ? sectionsF.segments : [];
      const rmsF = profile.mix.rms;
      const rms = rmsF?.render === "continuous" ? (rmsF.data ?? null) : null;
      const seconds = Math.min(opts.seconds, duration);
      const start = excerptStart(sections, rms, hz, duration, seconds);
      const ready = await page.evaluate(
        (cfg) => (window as unknown as { lab: { load(c: unknown): Promise<boolean> } }).lab.load(cfg),
        {
          roomUrl: `/fs${resolve(REPO, run.room)}`,
          songDir: `/fs${song.dir}`,
          title: song.title,
          artist: song.artist,
          tileWidth: w,
          tileHeight: h,
          single,
          shows: tiles.map((a) => ({
            id: a.id,
            label: a.label,
            url: `/fs${resolve(opts.runDir, song.id, `${a.id}.json`)}`,
          })),
        },
      );
      if (!ready) {
        console.error(`skipped ${song.artist} - ${song.title}: page could not load it`);
        continue;
      }
      const name = single ? `${song.id}-${tiles[0].id}.mp4` : `${song.id}-compare.mp4`;
      const enc = encoder(resolve(outDir, name), song.sourceFile, start, seconds);
      const frames = Math.round(seconds * FPS);
      const started = Date.now();
      for (let f = 0; f < frames; f++) {
        const b64 = await page.evaluate(
          (t) => (window as unknown as { lab: { frame(t: number): string } }).lab.frame(t),
          start + f / FPS,
        );
        if (!enc.stdin.write(Buffer.from(b64, "base64")))
          await new Promise((ok) => enc.stdin.once("drain", ok));
      }
      enc.stdin.end();
      await enc.done;
      const secs = (Date.now() - started) / 1000;
      console.log(`${name} · ${song.artist} - ${song.title} · ${frames} frames in ${secs.toFixed(0)} s`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
}
