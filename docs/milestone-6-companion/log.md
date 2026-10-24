# Companion — Dev Log

Development context for resuming work. Keep entries to one line. Not a changelog.

## Completed

- Slice 1 — Connect: companion URL + token as sidecar settings (`settings.get_companion`/`set_companion`, in the settings event), `companion/client.ts` (zod schemas, bearer fetch, `CompanionError`), `state/companion.svelte.ts` (status off/connecting/connected/unauthorized/incompatible/unreachable, re-check on settings change + 60 s), `CompanionDialog` behind the ⇄ top-bar button with a status dot. Bench check against prism-player pending user run.
- Slice 2 — Requested section: `companion_links` table (song_id, request_id, external, published_at; `request_id` joined into the songs listing), `companion.import` command (YouTube `ytsearch1:` for artist + title, import under the request's metadata, link row, import events keyed `request:{id}`), companion state `requests`/`refreshRequests`/`importRequest`/`rejectRequest`, `RequestedSection` above the song list.
- Slice 3 — Restore on stop: `getHubPower` reads `/json/state` before the power-on; `stopStream` blacks out and powers off only hubs that were off, hubs that were on are left to WLED's realtime timeout. Bench check pending user run.
- Slice 4 — Publish: `companion/bundle.ts` (`showLights`, `renderShowFrames` per distinct pixel count via `evaluateDoc` + `applyMacro`, `buildManifest`), `hardware/frame.ts` (solid-frame math shared with the streamer), `show.rs` (`write_show_frames` raw-body invoke, `clear_show_frames`), `sidecar/companion.py` (`pack`: manifest + audio + frames + project mirror minus stems/show, `upload` PUT, request PATCH to published), `companion.publish` command and `companion.publish_result` event, Publish button in the top bar with stage labels. Bench publish to prism-player pending user run.
- Slice 5 — Shows section and pull: `companion.pull` command (`companion.download` + `restore`: audio to `source.<ext>`, `project/` replaces profile, sidecars and mapping, row created or marked analyzed, link restored from the manifest's `request_id`), `published_at` in the songs listing, `pullableShows` (missing locally, or newer on the companion than the local publish), `ShowsSection` with a replace confirmation. Bench pull pending user run.

- Automatic mode: `companion_auto` setting, `companion/automation.ts` (`nextAction`, `roundRobinPatch`, pure), `automationTick` every 10 s in companion state (import, queue, open + auto-map + patch + wait for tracks + publish; skip with reason on failure or 180 s timeout), checkbox and status line in the dialog, sidecar emits a songs snapshot after publish so `published_at` lands.

- Automatic mode retries a failed request import twice (request back to `open`): the second try repeats the search, the third takes the second result of the query with title and artist swapped (`youtube.search_url`, `attempt` on `companion.import`); searches use the lead artist only, because comma-joined feature credits make YouTube's search return nothing; a failure after that rejects the request, so a YouTube miss never leaves a request in `analyzing`.

## Todo

- [x] Slice 1 — Connect
- [x] Slice 2 — Requested section
- [x] Slice 3 — Restore on stop
- [x] Slice 4 — Publish
- [x] Slice 5 — Shows section and pull

## Notes

- The bench companion is prism-player on the Pi 5 (`http://192.168.8.2:8760`); its token is in the home-brain deployment, never in this repo.
- The bundle frame rate is 40 Hz; the analysis frame rate stays 100 Hz. Rendering samples with `frameIndexAt`, the same as the live streamer.
