# Rules for other agents

The rule files live once, in `.claude/rules/`, because Claude Code loads them from
there. If your tool doesn't load them automatically, read the file for the area you're
changing:

| When you touch | Read |
|---|---|
| `apps/backend/**` | `.claude/rules/backend.md` |
| `apps/web/**` | `.claude/rules/web.md` |
| `apps/admin/**` | `.claude/rules/admin.md` |
| Any test file | `.claude/rules/testing.md` |

The `paths` block at the top of each file is what scopes it for Claude Code.
