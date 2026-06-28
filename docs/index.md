# Docs index

Milestones in build order. Only the ACTIVE one is current.

| #   | Milestone                                           | Status   | Summary                                                                                                                                                                   |
| --- | --------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [analysis-pipeline](milestone-1-analysis-pipeline/) | shipped  | Full audio-analysis pipeline: import → multi-engine stem separation → mix + per-stem feature catalog (DSP + ML), rendered against synced playback. Reviewed and cleaned.  |
| 2   | [ui-rework](milestone-2-ui-rework/)                 | planning | Dashboard + graph-consolidation UI redesign, onset-derivation feature, favorites + library polish, and deferred structural cleanups. Ideas only — run `/spec` to plan it. |

Status: `planning` → `active` → `shipped`.

Cross-milestone references (not milestone-scoped): [`feature-catalog.md`](feature-catalog.md) (every analyzed feature), [`profile-schema.md`](profile-schema.md) (profile.json spec), [`ideas.md`](ideas.md) (unscoped backlog).
