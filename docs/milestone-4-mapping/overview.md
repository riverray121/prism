# Sound → Light Mapping — Overview

Maps an analyzed song's features (`profile.json`) to lighting behavior. This is Stage 2 of the project vision (see milestone-1 `design.md` → "Next Steps"), seeded here as an M2 subfeature. Pre-`/spec`; not yet a plan.

Doc set:

- `overview.md` (this file) — core model, fixtures, channels, macro layer
- `catalog.md` — every feature → channel mapping, complex data shapes, transforms
- `formats.md` — the mapping doc and cue file schemas, versioning and rollback
- `visualization.md` — confirming mappings against playback; usability principles

---

## Core model

**A feature drives a channel of a fixture, through a transform.**

```
feature (from profile.json)
   → [transform]        normalize / threshold / envelope / colormap / smooth
   → channel            one controllable parameter of a light
   → fixture            a physical light (or group)
```

- **Fixture** — a light, or a group treated as one. Its _type_ determines which channels exist. Fixtures live in the app-level **rig**, not in mappings.
- **Channel** — one controllable parameter of a fixture type. The atomic target of a mapping.
- **Program** — a named, fixture-agnostic recipe: a set of channel bindings (`source feature → transform → channel`). A light's look is whichever program is patched onto it.
- **Patch** — the per-song binding of programs to rig fixtures (active program + saved shortlist per light). Done in the Sim/Hardware tabs, not while authoring.
- **Transform** — converts feature values/units into the channel's range and behavior (see `catalog.md`).
- **Derivation** — a named, saved threshold result (onsets/gates derived from any continuous feature) that any program can reference as a source. Absorbs the M2 onset-derivation idea; see `catalog.md` → Derivations and `formats.md`.

Channel-level binding is what makes mixed cases fall out without special rules:

| Case                                  | Expression                                                             |
| ------------------------------------- | ---------------------------------------------------------------------- |
| Drums: onset + intensity, fixed color | program: onset→`gate`, energy→`brightness`, `hue` = static constant    |
| Color-varying only                    | program: pitch→`hue`, `brightness` = static constant                   |
| Add / remove an element               | add / delete one channel binding in a program                          |
| Feature → light _type_                | not a channel binding — it is which fixtures the program is patched to |
| Try several looks on one light        | shortlist of programs per fixture in the patch; one active             |

---

## Fixtures and channels

| Channel       | Range / type                  | Notes                                                      |
| ------------- | ----------------------------- | ---------------------------------------------------------- |
| `gate`        | on/off                        | light on at onset, off at release                          |
| `brightness`  | 0–1                           | master dim                                                 |
| `hue`         | 0–360°                        | color                                                      |
| `saturation`  | 0–1                           | colored ↔ white                                            |
| `color_temp`  | warm ↔ cool                   | alternative to hue; natural target for spectral brightness |
| `strobe_rate` | Hz                            | strobe / shutter fixtures                                  |
| `position`    | pixel index / pan-tilt        | addressable strips and movers                              |
| `motion`      | chase / sweep / pulse + speed | animation primitive the fixture plays                      |

Fixture types (a type = which channels exist): `led_strip`, `led_strip_addressable`, `strobe`, `wash`, `mover`.

An addressable strip is _N pixels_, not one light — a 1-D array. This unlocks spatial mapping: a heatmap (freq×time) maps 1:1 onto a strip (pixel×time).

---

## Micro + macro layers

- **Micro** — the per-channel bindings in `catalog.md`.
- **Macro** — two things layered over all micro mappings:
  - **Scenes from `sections`.** A section change (intro→drop) swaps a preset: brighter, faster, fuller palette; breakdown = sparse, cool, slow. Structure choreographs the show; micro features paint within it.
  - **Master brightness with adaptive normalization.** A master scales every fixture. The reference for "how bright is bright" is chooseable:

| Mode       | Reference                                                 | Feel                                                    |
| ---------- | --------------------------------------------------------- | ------------------------------------------------------- |
| `absolute` | the song's global max                                     | quiet parts stay dark, drops blow out — honest dynamics |
| `windowed` | rolling N-second max                                      | every moment uses its full range — always lively        |
| `share`    | this feature ÷ sum of all active features at that instant | loudest element right now wins brightness               |

`share` handles the drums-alone case: drums alone → full brightness; other elements return → drums yield proportionally. Default `windowed` with a few-second window.

---

## Open questions for `/spec`

- Live re-bake vs. on-demand: can the frontend render cues at the 100 Hz grid live, or does baking go to the sidecar? (Direction: frontend — see `../milestone-2-ui-rework/ui/architecture.md`.)
- ~~Rig definition~~ — answered: user-defined rooms/fixtures in an app-level rig (`formats.md`, `../milestone-2-ui-rework/ui/architecture.md`).
- ~~In-app or separate tool~~ — answered: Mapping and Sim are tabs in the Prism workspace (`../milestone-2-ui-rework/ui/overview.md`).
- Color model for colormaps: HSV vs. RGB vs. perceptual (OKLCH).
- True note-duration extraction (`catalog.md` → onset duration, option 3) — deferred until threshold gating proves insufficient.
- On-disk location of mapping docs and versions (alongside `profile.json`? a `mappings/` subfolder?).
