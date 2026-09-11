# Companion — Dev Log

Development context for resuming work. Keep entries to one line. Not a changelog.

## Completed

- Slice 1 — Connect: companion URL + token as sidecar settings (`settings.get_companion`/`set_companion`, in the settings event), `companion/client.ts` (zod schemas, bearer fetch, `CompanionError`), `state/companion.svelte.ts` (status off/connecting/connected/unauthorized/incompatible/unreachable, re-check on settings change + 60 s), `CompanionDialog` behind the ⇄ top-bar button with a status dot. Bench check against prism-player pending user run.

## Todo

- [x] Slice 1 — Connect
- [ ] Slice 2 — Requested section
- [ ] Slice 3 — Restore on stop
- [ ] Slice 4 — Publish
- [ ] Slice 5 — Shows section and pull

## Notes

- The bench companion is prism-player on the Pi 5 (`http://192.168.8.2:8760`); its token is in the home-brain deployment, never in this repo.
- The bundle frame rate is 40 Hz; the analysis frame rate stays 100 Hz. Rendering samples with `frameIndexAt`, the same as the live streamer.
