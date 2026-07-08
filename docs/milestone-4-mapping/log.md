# Dev Log

## Completed

- [x] Slice 0 — Shared zoom window (M2 debt): x-window + follow mode lifted into `transport.svelte.ts` (`view` state), `TimeAxis` converted to a controlled component (`window` prop in, `onWindowChange` out, footer controls removed), all lane renderers thread the shared window, Follow/Reset moved to the transport bar, overview lane opts out (full extent).

## Todo

- [ ] Slice 1 — Color module
- [ ] Slice 2 — Mapping doc schema + persistence
- [ ] Slice 3 — Derivations: engine + editor
- [ ] Slice 4 — Transforms + evaluator (point channels)
- [ ] Slice 5 — Program editor + ribbon preview
- [ ] Slice 6 — Pixel dimension + motion
- [ ] Slice 7 — Live light preview
- [ ] Slice 8 — Macro layer
- [ ] Slice 9 — Auto-map (on demand)

## Notes

- The repo-wide `/clean` deferred from M2 is deferred again to M5 (user call at slice-0 time); M4 is slice work only.
- Decisions made at spec time: generic fixture includes the pixel dimension and motion primitives; mini live preview lives in the Mapping tab; full macro layer in; OKLCH color model; `quantize` transform deferred; cue files deferred (the evaluator is the bake).
- Sources are favorites-only everywhere — programs, derivations, and auto-map all draw from the starred subfeatures. Auto-map is strictly on-demand (Generate button): hand authoring is the primary flow, songs open with an empty doc, and a generate never removes or rewrites existing entries.
