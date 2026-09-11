# Companion — Implementation

Thin vertical slices in build order. Each is independently testable end-to-end.

## Slice 1 — Connect

- Goal: Prism holds one companion URL and token and shows whether it is connected.
- Touches: `sidecar/settings.py` (companion settings), `src/lib/companion/client.ts` (`info`, zod schemas), `state/companion.svelte.ts` (connection, 60 s retry), settings dialog fields, library panel status line.
- Acceptance: a mock companion answering `/v1/info` shows Connected with its name; a wrong token shows Unauthorized; no companion configured shows nothing new anywhere; vitest parses every schema; pytest covers the settings round trip.
- Out of scope: requests, shows, publish.

## Slice 2 — Requested section

- Goal: open requests are listed and can be imported or rejected.
- Touches: `client.ts` (`requests`, `patchRequest`), companion state (`importRequest`, `rejectRequest`), `CompanionSections.svelte`, `sidecar/companion.py` links table, YouTube import call with the request's artist and title.
- Acceptance: a request appears within one refresh; Import starts a YouTube import, marks the request `analyzing`, and the song carries the request link; Reject removes it from the list and the companion shows `rejected`; requests that are not `open` are hidden.
- Out of scope: publish, pull.

## Slice 3 — Restore on stop

- Goal: stopping playback returns each hub to the state it had before streaming.
- Touches: `state/hardware.svelte.ts` (`streamTick` records prior `on`, `stopStream` restores), `hardware.md` note in `docs/hardware/rig.md`.
- Acceptance: hub on with a preset before play: after stop the preset returns within the hub's realtime timeout, no power command sent; hub off before play: after stop it is off; vitest covers both orders and the offline-hub skip.
- Out of scope: any companion behavior.

## Slice 4 — Publish

- Goal: a patched song uploads as a show bundle.
- Touches: `companion/bundle.ts` (manifest, `renderShowFrames`), `src-tauri/src/show.rs`, `sidecar/companion.py` (`companion.publish`), companion state `publish`, Publish action in song actions with progress.
- Acceptance: the uploaded zip matches `companion-api.md` (pytest opens it and checks manifest, frame file sizes, project files); frame bytes at frame `i` equal the live streamer's frame at `i / 40` s (vitest on a two-light fixture); a republish replaces the show in place; a linked request becomes `published` with the show id; Publish is disabled without a patch.
- Out of scope: pull.

## Slice 5 — Shows section and pull

- Goal: published shows can be pulled back into the library.
- Touches: `client.ts` (`shows`, `bundle`), `sidecar/companion.py` (`companion.pull`, restore), companion state `pull`, `CompanionSections.svelte` Shows list with confirmation dialog.
- Acceptance: a show not in the library pulls into a new song with the manifest's title and artist and opens; a show newer than the local publish is marked and pull replaces profile and mapping after confirmation; a show equal to the local copy is not listed; pytest covers restore into an empty library and over an existing song.
- Out of scope: three-way merge of local edits.
