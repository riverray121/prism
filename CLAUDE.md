# Claude Instructions

Guidance for Claude when working on this project.

## Session start

At the start of each session, read in this order before starting new work:

1. `dev-log.md` — current state: what's done, what's next, any notes
2. `build-order.md` — the active milestone and what it contains
3. Whichever design docs are relevant to the active task (`music-analysis-design-doc.md`, `feature-catalog.md`, `profile-schema.md`, `development.md`)

This grounds you in where the project actually is before proposing or doing anything.

## Development log

Maintain `dev-log.md` at the repo root. Update it as work progresses. Three sections:

- **Completed** — what's been built, brief context
- **Todo** — what's next (drawn from `build-order.md` or new work)
- **Notes** — decisions made during development, gotchas, future considerations

Keep it simple and concise. One line per entry where possible. Move entries from Todo → Completed as work finishes. Append to Notes when something is worth remembering but isn't actionable.

The dev log is for *development context* that doesn't belong in the design docs. Design changes go into the design docs themselves.

## Git

- Commit frequently — small, focused commits over large ones.
- When working **autonomously**, commit on your own as work completes.
- When working **interactively** with the user, ask permission before committing.
- **Never** include Claude as a `Co-Authored-By:` in commit messages. Commits are authored by the user only.

## Source of truth

Design and process are documented in:
- `music-analysis-design-doc.md` — overall design
- `feature-catalog.md` — every analyzed feature
- `profile-schema.md` — JSON profile spec
- `build-order.md` — milestones
- `development.md` — tooling and engineering practices

Update these docs when decisions change. Don't let them drift.
