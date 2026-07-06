# UI Overhaul — Overview

Complete overhaul of the frontend into a project-centric workspace. Pre-`/spec`; direction settled, details left to implementation.

Doc set:

- `overview.md` (this file) — workspace model, layout, style language
- `tabs.md` — the four tabs in detail
- `architecture.md` — backend and format changes the overhaul requires

Scope note: this pulls Stage 2 (mapping) and Stage 3 (sim/hardware controller) of the project vision into the app as tabs, rather than separate tools. The milestone-1 layering contract (durable `ipc`/`state`, disposable components) is what makes the overhaul tractable — the presentation layer is replaced wholesale.

---

## Workspace model

Photoshop-like: **one song open at a time, worked as a project** through pipeline stages. Stages are tabs; the song, its analysis, its programs, and its patches are the project.

```
┌──────────────────────────────────────────────────────────────┐
│ ▌rail  │  Song title — artist   [Analysis][Mapping][Sim][HW] │  top bar
│        │  ── global transport: play/pause ▸ playhead ▸ zoom ──│
├────────┼─────────────────────────────────────────────────────┤
│ library│                                                     │
│ (colla-│                active tab view                      │
│  psible│           (or two tabs split-screen)                │
│  side- │                                                     │
│  bar)  │                                                     │
└────────┴─────────────────────────────────────────────────────┘
```

- **Tabs:** `Analysis` · `Mapping` · `Sim` · `Hardware`. One focused tab, or any two side by side.
- **Split view is a first-class workflow**, not a convenience: Analysis|Mapping is how sources are curated (favorite on the left, appears as a mapping source on the right), Mapping|Sim is how mappings are tuned against visible light output. Fullscreen either pane at any time.
- **Global transport, owned by the shell.** One playhead/play state for the whole app, in the top bar. Every tab renders against the same clock: scrub in Analysis and a split Sim animates in sync. No per-tab transports.
- **Opening a song** (from the library sidebar) switches the whole workspace to that project; its name sits in the top bar.

## Library sidebar

- **Collapsed (default):** a thin rail showing only status — a progress ring (pie) per song currently queued/analyzing, plus the active song's indicator. Analysis progress stays glanceable without costing space.
- **Expanded:** the full library — every song as a project row (title, artist, status), searchable and filterable. Click to open. Import lives here.
- Library polish items (metadata editing, filters, error/retry UX, YouTube import) render inside this sidebar — see [`../library/ideas.md`](../library/ideas.md).

## Style language

Inspiration: the **Zed editor**. Minimal chrome that fades into the background; the content (graphs, light previews) is the interface.

- Flat surfaces, thin 1px borders, no gradients, no glass, no rounded-blob styling, no shadows beyond functional elevation.
- Dense but calm: small crisp type, restrained spacing, muted grays; color is reserved for data (feature graphs, light output) and status.
- Subtle, fast transitions only (collapse/expand, tab switch); nothing decorative.
- **Dark-first.** The token system is designed on the dark theme — the natural mode for judging simulated light output — and the light theme derives from the same tokens, following the OS as today.
- Tokens via the existing Tailwind v4 + shadcn-svelte CSS-variable theming; shadcn-svelte components restyled to the flat language, not used stock.
