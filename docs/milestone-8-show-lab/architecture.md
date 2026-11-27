# Show Lab — Architecture

## Stack

- TypeScript, pure modules under `src/lib/showgen/`: the show algorithms. They run unchanged in the app, in vitest and in the lab, because the evaluator they build on (`mapping/evaluate.ts`) is already pure.
- three.js (`three`), with its bundled addons for `RectAreaLight`, `EffectComposer` and `UnrealBloomPass`: the simulator renderer. It is a mature WebGL engine with physically based lights, so no custom renderer is needed.
- Vite's module loader (`createServer` + `ssrLoadModule`): runs the lab's TypeScript from Node with the `$lib` alias and Svelte runes compiled, with no extra TypeScript runner.
- `playwright-core` driving the system Google Chrome (`channel: "chrome"`), with no browser download: headless WebGL rendering for videos.
- ffmpeg (Homebrew, already installed): encodes rendered frames with the song's audio into H.264 MP4.
- Python sidecar: `sidecar/lab.py` for headless fetch and analysis; `sidecar/rooms.py` for room storage; Beat This! (`beat-this`) for beats and downbeats.

## Key decisions

- **One algorithm contract for app and lab.** `ShowAlgorithm.generate(input) → ShowResult` is synchronous and pure. Input holds the profile with every candidate's `data` loaded, the lights (`LightSpec`: id, name, kind, pixel count, optional position), and the palette. Output holds programs, patch, macro and the selection report. Loading data is the caller's job: the app loads through `loadNpy` and the lab through `fs`. An algorithm that loads its own data or reads app state is a bug.
- **Algorithms are frozen files.** `showgen/algorithms/v1-baseline.ts`, `v2-ranked.ts`, `v3-roles.ts`, registered in `showgen/registry.ts` by id. A compared algorithm is never edited; a change is a new file with a new id. The shared measure library (`showgen/measures.ts`) is versioned the same way: a measure an algorithm depends on keeps its behavior, and a change adds a new function.
- **One program per pick.** `v2` and later algorithms build programs directly, one per selected track. They do not go through favorites or the per-stem grouping in `automap.ts`, which merges picks from the same stem into one program. `v1-baseline` keeps using `autoMap` so the baseline stays faithful.
- **The selection report travels with the show.** `MappingDoc.generator = { algorithm, palette, report }` (optional, schema 0.2.0). Room shows carry the same field. The UI reads why from it; nothing is written to `profile.json`.
- **Palette is doc state.** `MappingDoc.palette = { id, color? }`. Applying it writes `hue` and `saturation` constants on programs, so the evaluator, the hardware streamer and the published frames need no change. New docs get `{ id: "blue" }`.
- **Rooms are library files; room shows are per song.** `library/rooms/{id}.json` holds a room (title, size, items). `songs/{id}/mapping/sim.json` holds, per room id, `{ programs, patch, generator }`. Both go through sidecar commands, like `mapping.json`. Room-show programs are separate from the hardware mapping doc, so a 10-light room never rewrites the real 5-light show.
- **The simulator core has no Svelte and no Tauri imports.** `src/lib/sim/` takes a room plus a per-frame light-state function and renders into a canvas. The Sim tab and the lab's render page both wrap the same core, so a video shows exactly what the app shows.
- **Light state is one function.** `sampleLights(doc, outputs, lights, t) → LightState[]` (per light: an RGB per pixel, plus pan and tilt for moving heads) is shared by the Sim tab and the renderer, and reuses `frameIndexAt` and `channelColor` from `evaluate.ts`.
- **Lab never touches `library/`.** Every lab command takes `--library` (default `eval-library/`), and run output goes to `eval-runs/{name}/`. Both are gitignored.
- **Video rendering is deterministic.** The render page exposes `renderAt(t)`. The driver steps `t` at 30 fps, reads the composited 2D canvas as JPEG and pipes it to ffmpeg, so output never depends on real-time speed. Comparison videos composite one WebGL canvas per algorithm, plus an info panel, into a 2×2 grid inside the page.
- **Automatic mode reads `show_algorithm`.** `processSong` calls the registry with the setting's id, defaulting to `v1-baseline`. Its other steps are unchanged.

## Structure

```
src/lib/showgen/
  types.ts         ShowAlgorithm, ShowInput, LightSpec, ShowResult, SelectionReport
  rig.ts           the real rig as LightSpecs (WLED strips)
  candidates.ts    enumerate candidate tracks from a profile, family labels
  measures.ts      envelope measures (see ranking.md), pure, synthetic-tested
  select.ts        score + MMR selection
  styles.ts        program builders per style (glow, pulse, flash, strobe, chase)
  palettes.ts      catalog, hex↔OKLCH, applyPalette
  lightstate.ts    sampleLights: doc + outputs → per-light pixels at time t
  registry.ts      id → algorithm
  algorithms/      v1-baseline.ts, v2-ranked.ts, v3-roles.ts
src/lib/sim/       three.js core: room model types, scene builder, fixtures/, furniture/, renderer
src/lib/components/sim/   SimView, ItemPanel, RoomBar, Inspector, LightAssign (Svelte)
src/lib/components/mapping/  refreshed tab: ShowToolbar, ProgramCard, ProgramSimpleEditor, CandidatesPanel
lab/
  cli.mjs          entry: starts Vite's loader, dispatches generate | report | render
  generate.ts, report.ts, render.ts, metrics.ts, rooms/*.json
  render/          index.html + main.ts: headless render page over src/lib/sim
sidecar/lab.py     fetch | analyze | list on a library folder
sidecar/rooms.py   rooms + per-song sim.json storage
```

## Breakouts

- [ranking.md](ranking.md): candidate set, measures, scoring and selection.

## Risks / unknowns

- Headless Chrome WebGL speed limits render throughput. Falling back to software WebGL would make 10 comparison videos slow but still possible.
- Many real-time lights in three.js: each `RectAreaLight` and shadow-casting spot has a GPU cost. Fixtures approximate strips with up to 3 area lights each, and only spots and moving heads cast shadows.
- Separation engines differ in quality per song. The ranking has to detect bad stems from their signals alone, without per-engine priors.
