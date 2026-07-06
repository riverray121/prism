# Mapping Formats

Programs are authored **fixture-agnostic** and bound to lights separately (patching). Four artifacts:

- **Mapping doc** (per song) — derivations + programs. Small, declarative, hand-editable; what you author, iterate, and version.
- **Rig** (app-level) — rooms and their fixtures, shared across songs. Used by Sim and, later, Hardware.
- **Patch** (per song) — binds programs to rig fixtures: an active program per light plus a saved shortlist of candidates.
- **Cue file** (per song, baked) — rendered deterministically from `profile + mapping doc + patch`. What the visualizer plays and hardware reads. Never hand-edited; if it's wrong, fix the recipe and re-bake.

The split makes iteration and rollback cheap: versions apply to small recipes, and the heavy timeline is always reproducible.

---

## Mapping doc

```jsonc
{
  "schema_version": "0.1.0",
  "song_id": "f3a1c2b4-...", // binds to one profile.json
  "derivations": [
    {
      "id": "kick_hits",
      "source": "stems.htdemucs_ft.drums.features.drums_energy",
      "threshold": { "cutoff": 0.4, "mode": "segments" }, // or "events"
    },
  ],
  "programs": [
    {
      "id": "kick_strobe",
      "enabled": true,
      "channels": {
        "gate": { "source": "derived.kick_hits" },
        "brightness": {
          "source": "stems.htdemucs_ft.drums.features.drums_energy",
          "transform": [{ "smooth": {} }, { "normalize": {} }],
        },
        "hue": 0, // constant = static channel
      },
    },
    {
      "id": "vocal_wash",
      "enabled": true,
      "channels": {
        "hue": {
          "source": "stems.htdemucs_ft.vocals.features.vocals_pitch",
          "transform": [{ "colormap": { "palette": "pitch_wheel" } }],
        },
        "brightness": 0.6,
      },
    },
  ],
  "macro": {
    "scenes_from": "mix.sections", // section → preset switching
    "master": {
      "source": "mix.rms",
      "adaptive": { "mode": "windowed", "window_s": 4 },
    },
  },
}
```

- A **program** is a named recipe of channel bindings — no fixture reference. A channel binds a source through transforms, or holds a constant.
- `source` is a dot-path into `profile.json` — the same addressing `favorites` uses (`../../profile-schema.md`) — or a `derived.{id}` reference.
- `derivations` are named threshold results (see `catalog.md` → Derivations): declared once, referenced by any number of programs. They are **saved and independent** — editable at any time while working on a song, valid with zero consumers (a derivation is an artifact in its own right), and never deleted implicitly: removing a program or other consumer never removes a derivation. Deletion is always explicit.
- Programs and derivations have stable `id`s (versioning anchors); `enabled` mutes a program without deleting it.
- `macro` holds the two global layers: scene switching from a segment feature, and the adaptive master (see `overview.md`).

## Rig

App-level, not per song. Fixture ids are what patches reference.

```jsonc
{
  "rooms": [
    {
      "id": "studio",
      "fixtures": [
        {
          "id": "strip_main",
          "type": "led_strip_addressable",
          "pixels": 60,
          "position": [0, 2.4, 1],
        },
        { "id": "strobe_l", "type": "strobe", "position": [-2, 2.0, 0] },
      ],
    },
  ],
}
```

## Patch

Per song: which program each light plays, plus the saved shortlist of candidates per light.

```jsonc
{
  "song_id": "f3a1c2b4-...",
  "room": "studio",
  "patches": {
    "strobe_l": { "active": "kick_strobe", "shortlist": ["kick_strobe"] },
    "strip_main": {
      "active": "vocal_wash",
      "shortlist": ["vocal_wash", "kick_strobe"],
    },
  },
}
```

**Compatibility:** a fixture ignores channels its type lacks — any program is auditionable on any light (graceful degradation; maximum applicability, prune later).

## Cue file

Per-fixture channel timelines, baked from `profile + mapping doc + patch`. Continuous channels sampled on the profile's 100 Hz grid; gates as segment lists. Dense per-pixel data goes to `.npy` sidecars, reusing the profile's sidecar convention.

```jsonc
{
  "schema_version": "0.1.0",
  "song_id": "f3a1c2b4-...",
  "frame_rate_hz": 100,
  "fixtures": {
    "strobe_l": {
      "type": "strobe",
      "gate": [
        { "start": 0.7, "end": 0.78 },
        { "start": 1.2, "end": 1.27 },
      ],
      "brightness": [0.0, 0.0, 0.8, 0.6 /* frame-aligned */],
      "hue": 0,
    },
    "strip_main": {
      "type": "led_strip_addressable",
      "pixels": 60,
      "rgb": "cues/strip_main_rgb.npy", // per-pixel × time matrix
    },
  },
}
```

A hardware interface consumes only this file and its sidecars — it never needs to understand features, programs, or patches.

---

## Versioning and rollback

Version the recipes, not the bake. A snapshot captures **mapping doc + patch together** — the whole show for a song.

- **Global versions** — named snapshots (`v1`, "before the drop rework"). Roll the entire show back. Cheap: the recipes are tiny.
- **Individual rollback** — two mechanisms, no per-entry history store:
  1. The `enabled` toggle mutes a program without deleting it.
  2. **Cherry-pick across versions**: restore one program, derivation, or per-light patch by `id` from an older snapshot into the current doc. The global snapshots are the history.
- A per-`id` revision log is a fallback only if the above proves insufficient.
