# UI Overhaul — Architecture

## Stack

Unchanged: Tauri 2 shell · Svelte 5 + SvelteKit (static SPA) · Tailwind v4 · uPlot · Python 3.12 sidecar with JSON-lines IPC and the snapshot model.

Added:

- **bits-ui** — headless UI primitives (dialog, select, popover, tooltip) for the fiddly interactive behavior (focus traps, keyboard nav, positioning); all styling in-house. Chosen over shadcn-svelte: no default styling to fight when applying a strong custom aesthetic.
- **yt-dlp** — sidecar dependency for YouTube import.
- **ffmpeg** — required system dependency (audio extraction/conversion for yt-dlp). Not bundled; a missing binary surfaces as a clear import error, and installation is documented in the README getting-started steps.

## Key decisions

- **Graph kit, not per-tab graphs.** One shared time-axis interaction layer (zoom, scrub, wheel, playhead — currently duplicated across the graph components) plus one renderer per render mode (continuous, event, segment, heatmap, tags, onset-dots). Renderers know nothing about interaction; the layer knows nothing about data shape. Lives outside the Analysis tab's component tree because milestone 3's mapping lanes consume it too.
- **Transport in the durable state layer.** Web Audio ownership, play state, playhead clock, zoom window, and follow mode move out of `InspectionView` into `lib/state`. Panes subscribe; no component touches audio directly.
- **Workspace state drives the shell.** Open song, tab layout (single tab or a pair), and sidebar state live in `lib/state`. Split view is the shell rendering two tab hosts from this state — CSS grid, no windowing library.
- **Keep uPlot.** The duplication problem was in our wrappers, not the chart library. Replacing it is churn without benefit.
- **Theme tokens, dark-first.** CSS custom properties defined on the dark theme via Tailwind v4 `@theme`; light values derive through the existing `light-dark()` mechanism. No new tooling.
- **Sidecar onset pass.** A derive module owns the threshold/peak-pick primitive and runs over every continuous feature at the end of extraction. Output: an optional onset field (times + strengths) on the continuous feature envelope, specified in `profile-schema.md` when implemented; minor `schema_version` bump. Profiles without the field render without the lane — no forced re-analysis. Milestone 3 re-implements the same primitive client-side for live tuning; keeping the algorithms twinned is deliberate.
- **New IPC commands fit the snapshot model.** YouTube import, metadata update, and retry each mutate and emit a fresh `library.songs` snapshot — no new event channels. Engine labels/capabilities are sent from the sidecar (settings event) instead of hard-coded in the frontend — the analyze popup consumes them.
- **Structural cleanup rides along with the areas it touches** (`cleanup/ideas.md`): A2/A5/L4 land with the graph-kit and transport extraction; A7 and A3 land with the analyze popup and settings work; A4 with storage changes; A6 with the shell.

## Structure

Frontend (`src/lib/`):

- `graphs/` — the kit: interaction layer + renderers. No IPC, no state imports.
- `state/` — transport, workspace, library, song (profile + derived data); actions only, no presentation.
- `ipc/` — commands/events + zod schemas, extended for the new commands and the `onsets` envelope field.
- `components/` — shell (top bar, tabs, split host, sidebar), Analysis tab, stub tabs, library dialogs. Dumb: render state, call actions.

Sidecar (`sidecar/`):

- `features/derive.py` — threshold/peak-pick primitive + per-feature onset pass.
- YouTube download/convert alongside the existing import path; engine-selection resolution moved from `library.py` into a settings/separation helper.

## Breakouts

None.

## Risks / unknowns

- **Lane-count rendering cost.** The Analysis tab already stacks many uPlot instances; collapse-by-default and lazy mounting are the levers if full parity plus onset lanes strains it.
- **yt-dlp fragility.** YouTube changes break extractors periodically; imports may fail until the dependency is updated. Acceptable for a personal tool.
- **No test suite exists** despite milestone-1 practice docs describing one. The graph kit and derive module are the first well-shaped test targets; establish vitest/pytest coverage with them.
