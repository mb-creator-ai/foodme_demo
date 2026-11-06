@AGENTS.md

## Claude Code notes

- `AGENTS.md`, imported above, holds the shared project instructions. Update it
  rather than repeating its content here.
- Path-scoped rules live in `.claude/rules/`. They may not load automatically, so follow
  "Area rules" in `AGENTS.md`.
- Skills live in `.claude/skills/`. Each `SKILL.md` under `.agents/skills/` is a Git
  symlink to its canonical `.claude/skills/` file, so edit only the `.claude` copy.
  Without symlink support, Git checks them out as text files holding the target path.
- Node and Java may be missing from the PATH of a terminal that was opened before they
  were installed. Open a new terminal rather than reinstalling them.
