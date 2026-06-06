# Claude Instructions

Guidance for Claude when working on this project.

## Session start

All design and process documentation lives in `docs/`. At the start of each session, read in this order before starting new work:

1. `docs/dev-log.md` — current state: what's done, what's next, any notes
2. `docs/build-order.md` — the active milestone and what it contains
3. Whichever design docs are relevant to the active task (`docs/design-doc.md`, `docs/feature-catalog.md`, `docs/profile-schema.md`, `docs/development.md`)

This grounds you in where the project actually is before proposing or doing anything.

## Development log

Maintain `docs/dev-log.md`. Update it as work progresses. Three sections:

- **Completed** — what's been built, brief context
- **Todo** — what's next (drawn from `build-order.md` or new work)
- **Notes** — decisions made during development, gotchas, future considerations

Keep it simple and concise. One line per entry where possible. Move entries from Todo → Completed as work finishes. Append to Notes when something is worth remembering but isn't actionable.

The dev log is for *development context* that doesn't belong in the design docs. Design changes go into the design docs themselves.

## Code comments

Comment frequently but not excessively. Comments must be concise, precise, accurate, and complete.

- Precede each modular block of code with a comment describing what that block does.
- State facts: the purpose of the code. Nothing more.
- Never reference conversations, history, or decisions external to the code.
- Only when something about a decision is non-obvious from the code itself, note it.

## Git

- Commit frequently — small, focused commits over large ones.
- When working **autonomously**, commit on your own as work completes.
- When working **interactively** with the user, ask permission before committing.
- **Never** include Claude as a `Co-Authored-By:` in commit messages. Commits are authored by the user only.

## Source of truth

Design and process are documented in `docs/`:
- `docs/design-doc.md` — overall design
- `docs/feature-catalog.md` — every analyzed feature
- `docs/profile-schema.md` — JSON profile spec
- `docs/build-order.md` — milestones
- `docs/development.md` — tooling and engineering practices

Update these docs when decisions change. Don't let them drift.
