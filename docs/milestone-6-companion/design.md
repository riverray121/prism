# Companion — Design

## Summary

Prism can connect to one companion server: a service on the network that keeps a queue of songs to analyze and a store of published shows. Connected, Prism lists the queue, imports requested songs, publishes analyzed and mapped songs as show bundles, and pulls published shows back for editing. Disconnected, nothing in the app changes. Prism owns the contract ([`../companion-api.md`](../companion-api.md)); the server is a separate project. This milestone also changes what Prism does to a hub when playback stops: it restores the hub's prior state instead of turning it off.

## How it works

Connection: settings hold one companion URL and token. Prism is connected when the last `/v1/info` call succeeded; it retries every 60 s while a companion is configured. The library panel shows the connection state.

Requests: a Requested section in the library panel lists the companion's open requests (title, artist). Import runs the existing YouTube import with the artist and title as the search query, marks the request `analyzing`, and records the request id and external ids on the song. Reject marks the request `rejected`. Requests already `analyzing`, `published`, or `rejected` are hidden.

Publish: a song with a mapping doc and at least one patched light has a Publish action. Prism renders every patched light at its own pixel count over the whole song at the bundle frame rate, packs the bundle, and uploads it under the song id. Publishing again replaces the show. A song linked to a request marks the request `published`.

Pull: a Shows section lists published shows that are not in the library, or whose companion copy is newer than the local publish. Pull downloads the bundle and restores the project into the library under the same song id, replacing the local profile and mapping after a confirmation.

Restore on stop: before the first frame of a play run Prism reads each target hub's power state. On stop it stops sending. A hub that was on returns to its own look once its realtime timeout expires; a hub that was off gets a blackout frame and is powered off. Nothing else about streaming changes.

## Usage

- Settings, Companion section: URL, token, Connect. A connected companion shows its name and version.
- Library panel: Requested (import, reject) and Shows (pull) sections, present only while connected.
- Song: Publish in the song's actions. Enabled when the song has a patch. Publishing shows progress and the result.

## Scope

- In: one companion; connection settings; Requested and Shows sections; import from a request; publish; pull; request status updates; restore-on-stop.
- Out: playing shows (the companion's job); more than one companion; creating requests from Prism; merging a pulled project with local edits (pull overwrites after confirmation); any companion-specific UI.

## Architecture

Stack:

- No new runtime dependencies. Frontend HTTP through `tauri-plugin-http` (already scoped to `http://*:*`), zod schemas for every companion response. Sidecar zip building with `zipfile`, upload and download with `urllib` (streaming, no JSON-line IPC for bundle bytes).
- One Tauri command writes rendered frame bytes to disk. Frames are rendered in the frontend, where the evaluator lives, and sent to Rust as raw bytes (Tauri 2 `invoke` with an `ArrayBuffer` body), never through the sidecar's JSON lines.

Key decisions:

- The companion is a client-side module with one interface, `src/lib/companion/client.ts`, that speaks the Companion API and nothing else. No code outside `companion/` and `state/companion.svelte.ts` knows a companion exists; the library panel and song actions render companion sections only when the state says connected. A Prism without a companion configured has no new behavior.
- Frames are rendered by the existing evaluator (`evaluatePixels` at each patched light's pixel count) and sampled with `frameIndexAt` at the bundle rate, so a published show matches what the live streamer sends. The bundle frame rate is a constant, `SHOW_FRAME_RATE_HZ = 40`.
- Bundle assembly and transfer live in the sidecar (`sidecar/companion.py`): it owns the library folder, can stream large files, and already has the song's metadata. The frontend hands it a song id and the manifest; the frames are already on disk under `songs/{id}/show/`.
- Companion settings (`companion_url`, `companion_token`) are library settings in the sidecar's key-value store, alongside engine settings, so they travel with the library and never enter the frontend bundle.
- Song to request links live in a new `companion_links` table (`song_id`, `request_id`, `external` JSON, `published_at`). The songs table is unchanged.
- Pull restores by song id: the bundle's `project/` replaces the song folder's profile, sidecars, and mapping; `audio.<ext>` becomes `source.<ext>`; a missing song row is created from the manifest.
- Restore-on-stop replaces the blackout-then-power-off stop sequence: `streamTick` records each hub's `on` state from the power-on read it already does; `stopStream` turns off only hubs that were off. The hub's realtime timeout does the rest.
- The state module graph stays acyclic: `state/companion.svelte.ts` sits downstream of `library`, `mapping`, `hardware`, and `evaluation`; nothing imports it except components.

Structure:

- `src/lib/companion/client.ts`: fetch wrappers and zod schemas for every endpoint. `bundle.ts`: manifest builder and frame rendering (`renderShowFrames(doc, profile, rig, patch)` returning `{key, pixelCount, bytes}[]`). Pure, vitest-covered.
- `src/lib/state/companion.svelte.ts`: connection state, requests, shows, refresh timer, actions (`connect`, `importRequest`, `rejectRequest`, `publish`, `pull`).
- `src/lib/components/library/CompanionSections.svelte`: Requested and Shows sections inside `LibraryPanel`. Settings fields in the existing settings dialog. Publish in the song actions.
- `src-tauri/src/show.rs`: `write_show_frames(song_id, key, bytes)` writes `songs/{id}/show/frames/{key}.bin`, `clear_show_frames(song_id)`.
- `sidecar/companion.py`: `companion.publish {song_id, manifest}` (pack and PUT, progress events), `companion.pull {show_id}` (GET, restore, library row), settings and links accessors. Routed through `ipc.py` like the other command families.

Contract: [`../companion-api.md`](../companion-api.md), the wire format and the show bundle.

Risks:

- YouTube search for an artist and title can pick the wrong recording. The owner reviews in Prism before publishing; a wrong pick is a re-import.
- A bundle upload over WiFi can be tens of megabytes. Publish reports progress and a failed upload leaves the previous show intact (PUT is atomic on the companion side).
- Raw-byte `invoke` bodies are the only way to move frame bytes without base64. If a Tauri version drops it, the fallback is writing frames from the sidecar after receiving them in chunks.
