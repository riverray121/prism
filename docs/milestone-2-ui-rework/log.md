# UI Overhaul — Dev Log

Development context for resuming work. Keep entries to one line. Not a changelog.

## Completed

<none yet>

## Todo

- [ ] Slice 1 — Shell + theme tokens
- [ ] Slice 2 — Global transport
- [ ] Slice 3 — Graph kit core
- [ ] Slice 4 — Graph kit complete
- [ ] Slice 5 — Analysis tab layout
- [ ] Slice 6 — Favorites
- [ ] Slice 7 — Onset lanes
- [ ] Slice 8 — Analyze popup + engine capabilities
- [ ] Slice 9 — Library management
- [ ] Slice 10 — YouTube import
- [ ] Slice 11 — Split view

## Notes

- Mapping system, Sim, and Hardware are M3+; M2's obligation is architectural only (graph kit reusable for M3 ribbon lanes, global transport, split-capable workspace). Background in `mapping/`, `ui/`, `library/`, `cleanup/`.
- No test suite existed at M2 start; vitest arrives in slice 3, pytest in slice 7.
- ffmpeg is a required system dependency (yt-dlp); documented in README, checked at import.
