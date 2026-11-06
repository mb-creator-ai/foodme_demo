@AGENTS.md

## Claude Code notes

- `AGENTS.md`, imported above, holds the shared project instructions. Update it
  rather than repeating its content here.
- Path-scoped rules live in `.claude/rules/`. They may not load automatically, so follow
  "Area rules" in `AGENTS.md`.
- Skills live in `.claude/skills/`. `.agents/skills/` holds thin pointers to them for
  other agents, so edit the `.claude` copy and keep each pointer's `description` in sync.
- Node and Java may be missing from the PATH of a terminal that was opened before they
  were installed. Open a new terminal rather than reinstalling them.
