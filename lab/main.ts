// Lab command dispatch (see docs/milestone-8-show-lab/design.md, Lab).
//   generate --run NAME [--library eval-library] [--room lab/rooms/demo-room.json]
//            [--algorithms v1-baseline,v2-ranked] [--palette blue] [--songs q1,q2]
//   report --run NAME
//   render --run NAME [--songs q1,q2] [--seconds 45] [--size 960x540]

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { ALGORITHMS } from "$lib/showgen/registry";

import { generate } from "./generate";
import { lightsFromRoom } from "./lights";
import { report } from "./report";

function flags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++)
    if (argv[i].startsWith("--"))
      out[argv[i].slice(2)] =
        argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
  return out;
}

export async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  const f = flags(rest);
  const runDir = resolve("eval-runs", f.run ?? "latest");
  if (cmd === "generate") {
    const roomPath = f.room ?? "lab/rooms/demo-room.json";
    if (!existsSync(roomPath))
      throw new Error(`room file not found: ${roomPath}`);
    generate({
      library: resolve(f.library ?? "eval-library"),
      out: runDir,
      algorithms: f.algorithms
        ? f.algorithms.split(",")
        : ALGORITHMS.map((a) => a.id),
      lights: lightsFromRoom(roomPath),
      roomPath,
      palette: f.palette?.startsWith("#")
        ? { id: "single", color: f.palette }
        : { id: f.palette ?? "blue" },
      songs: f.songs ? f.songs.split(",") : undefined,
    });
    console.log(`report: ${report(runDir)}`);
  } else if (cmd === "report") {
    console.log(report(runDir));
  } else if (cmd === "render") {
    const { render } = await import("./render");
    await render({
      runDir,
      songs: f.songs ? f.songs.split(",") : undefined,
      seconds: Number(f.seconds ?? 45),
      size: f.size ?? "960x540",
      only: f.only,
    });
    console.log(`report: ${report(join(runDir))}`);
  } else {
    throw new Error("usage: pnpm lab generate|report|render --run NAME");
  }
}
