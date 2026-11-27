# Show Lab — Design

## Summary

Show Lab turns a song's analysis into a light show automatically and gives the tools to judge and improve how that is done. Five parts:

- **Show algorithms**: versioned, interchangeable ways to choose the song's best tracks and map them to lights.
- **Lab**: a headless harness that runs several algorithms over a corpus of songs and produces reports and comparison videos.
- **Simulator**: a 3D room in the Sim tab with furniture and simulated light fixtures that plays any song's show.
- **Mapping refresh**: a Mapping tab built around generating a show and adjusting it, not building it channel by channel.
- **Palettes**: curated color palettes applied to a show's programs, with a blue palette as the default for new mappings.

## How it works

### Show algorithms

A show algorithm is a pure function from (song analysis, lights, palette) to (programs, patch, selection report). Every algorithm has an id and a version, lives in its own source file, and never changes once it has been compared. A change is a new version. The app and the lab call the same code.

- `v1-baseline`: the behavior before this milestone. It uses the default favorites, groups them per stem into programs, and patches lights round-robin.
- `v2-ranked`: scores every candidate track with signal measures, removes near-duplicates, and gives each light its own program.
- `v3-roles`: v2's ranking, plus a role per pick (pulse, swell, accent) that decides how the program moves. Each role goes to the lights that suit it, and section energy drives the overall level.

The candidate tracks are every intensity-like continuous feature the analysis produced: stem and drum sub-stem energy from every engine, mix RMS and band energies, novelty, rhythmic density and spectral flux. Measures come only from the song's own data and from published methods (see [ranking.md](ranking.md)). Past hand-picked favorites are never used as evidence or targets.

Uniqueness: picks are made greedily by score. Each next pick is penalized by its similarity to tracks already picked. Similarity is envelope correlation, raised to a minimum when two tracks come from the same instrument (the same stem from another feature or another engine). Of a group of near-duplicates (bass energy, bass onsets, bass from another engine), only the best-scoring one is kept.

When there are more lights than distinct good tracks, a pick may drive several lights. Each extra light gets a variation of the program (different palette slot, phase or style), never an identical copy.

The selection report records, for every candidate, every measure, its score, its rank, whether it was picked and why. The Mapping tab shows it.

### Lab

The lab runs from the command line against a library folder of its own (`eval-library/`), never the app's library.

1. `fetch` downloads songs by "Artist - Title" and `analyze --all-models` runs every separation engine plus drum sub-separation.
2. `generate` runs chosen algorithms over every song for a given set of lights and writes each show plus its report to a run folder.
3. `report` writes one HTML page per run: per song, the candidate table per algorithm and output metrics per show.
4. `render` plays each show in a simulator room in a headless browser and writes videos. Comparison videos tile several algorithms side by side on the same song with its audio.

Output metrics describe what the lights do, not what the algorithm intended:

- visible change per light
- distinctness between lights
- flash alignment to beats
- time spent dark

They support a judgment by eye and ear, and are not a target to tune against.

### Simulator

A room is a rectangular space with a title, dimensions and placed items. Items are furniture (sofa, TV stand, TV, table, shelf, bed, plant) and light fixtures. Fixture kinds:

| Kind             | Real-world equivalent                            | Driven by                                            |
| ---------------- | ------------------------------------------------ | ---------------------------------------------------- |
| LED strip        | WS2812/SK6812 strip on a WLED hub                | per-pixel color                                      |
| Curved LED strip | neon flex or strip on an arc                     | per-pixel color                                      |
| LED tube         | addressable light bar or tube                    | per-pixel color                                      |
| Wall washer      | uplight or LED wash on the floor aimed at a wall | color, brightness                                    |
| PAR spot         | DMX PAR can                                      | color, brightness                                    |
| Strobe           | DMX strobe                                       | gate, strobe rate                                    |
| Lamp             | smart bulb (Hue, WiZ)                            | color, brightness                                    |
| Moving head      | DMX moving head                                  | color, brightness, pan/tilt from position and motion |

The scene is lit by the fixtures themselves, with light falling on walls, floor and furniture, plus bloom on bright emitters and a dim room otherwise. Materials are plain matte colors with no textures.

Editing: drag an item from the side panel into the room, then select it to move, rotate or resize it and set its properties (pixel count, color temperature limits, beam angle). Rooms are saved by title; a room can be created, renamed, duplicated and deleted.

Playing: opening a song in the Sim tab shows that song's show in the active room. On first open the active algorithm generates a show for the room's lights. Changing which program drives a light saves immediately, per song and per room. Reopening the song restores it. Regenerate replaces the room's show with a fresh one from a chosen algorithm and palette.

### Mapping refresh

The Mapping tab opens on the show:

- A toolbar with algorithm, palette and Generate. Generate replaces the show and can be undone.
- A list of program cards. Each card shows its color, source, style, assigned lights and a live level.
- A simple editor for the selected program: source (sorted by ranking score, with the reasons), style (Glow, Pulse, Flash, Strobe, Chase), color (palette slot or custom), floor and peak levels, smoothing, and which lights it drives.
- The channel and transform editor stays available under Advanced.

Patching a program to lights happens in the program card, so building a show no longer needs the Hardware tab.

### Palettes

A palette is an ordered list of 3 to 6 colors that go together: mostly one family, with at most one outlier that still fits. The catalog includes the default blue palette, a single-color mode for any chosen color, and about ten curated palettes. Applying a palette sets each program's hue and saturation from a palette slot. The outlier goes to the most salient accent program. A mapping remembers its palette, so new programs take the next slot. New mappings start on the blue palette.

## Usage

- Automatic mode publishes shows from the algorithm chosen in settings, `show_algorithm`, which defaults to `v1-baseline` until the user picks another.
- In the app: Generate on the Mapping tab, adjust cards, patch, publish. Sim tab to see the show in a room.
- In the lab: `pnpm lab generate|report|render`, then open the report and watch the comparison videos.

## Scope

- In: algorithm contract and registry, v1 to v3, the lab CLI, corpus fetch and headless analysis, HTML reports, headless video rendering, the simulator with room editing and per-song light assignments, the mapping tab refresh, palettes, the Beat This! beat tracker and the BS-Roformer-SW engine.
- Out: driving real DMX, Hue or other non-WLED fixtures; per-light fixture kinds on the real rig; re-ranking or republishing existing library songs; ML-based quality judgment.

## Open questions

- Which algorithm becomes the default `show_algorithm`, decided by the user from the lab output.
