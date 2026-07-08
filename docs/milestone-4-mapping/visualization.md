# Mapping Visualization & Usability

Two views, both on the existing shared time axis, both synced to playback. Reuses the milestone-1 graph / playhead stack. The requirement: see the synced feature data against the playing song, confirm it makes sense, then confirm the light behavior mapped from it makes sense — all at a glance.

---

## Analytical lanes (scrub and diagnose)

Per program (and per patched fixture in Sim), a **lit ribbon** lane; optionally the source feature's normal graph stacked under it for comparison:

- **Lit segments** (dark background between) → `gate` and its duration. The width of a lit run is the on-duration — an onset rendered wider than a point.
- **Fill color** → the mapped `hue` / `saturation`.
- **Glow / opacity** → `brightness`. Reads as light; a glowing colored ribbon looks like what the fixture does, so "does this match the audio" is answerable at a glance.
- **Thin overlay value-line** → exact brightness values, toggled on demand, for when opacity is too coarse to read.

Addressable fixtures get a 2-D lane (pixel index × time, color = pixel color) — the existing heatmap renderer, reused.

## Live fixture preview (feel)

A rendered widget of the rig — a glowing bar per strip, a pixel row per addressable strip, a flash box per strobe — animating in real time with playback. Lanes are for scrubbing and diagnosis; the preview is for "yes, that's the kick."

---

## Usability principles

Power is easy; simple-and-powerful is the work.

- **Start from a working auto-map, never a blank canvas.** Opening a profile generates a sensible default: one program per stem (`{stem}_energy` → brightness smoothed, drum onsets → gate, `spectral_centroid` → color temp), `sections` → scenes, auto-patched onto the rig. The user edits a working show. The single most important usability decision.
- **Progressive disclosure.** Default authoring = pick source + target, done. Transforms collapse behind an advanced affordance with good defaults; the macro layer stays hidden until asked for.
- **Default transforms.** Continuous → brightness silently gets `normalize` + `smooth`; opened only to tweak.
- **One mental model.** Everything is feature → transform → channel. No second paradigm.
- **Direct manipulation.** Tweak a mapping → re-bake → judge against playback immediately. The tiny-recipe / fast-bake split in `formats.md` is what keeps this loop instant.
