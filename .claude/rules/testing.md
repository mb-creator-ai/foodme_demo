---
paths:
  - "apps/backend/src/test/**"
  - "apps/web/e2e/**"
  - "apps/admin/e2e/**"
  - "**/*.test.*"
  - "**/*.spec.*"
---

# Testing rules

- Use the skill for the level you're writing: `writing-unit-tests`,
  `writing-integration-tests` or `writing-e2e-tests`.
- Prove that a regression test can fail: run it with the bug present, or with the fix
  temporarily reverted, and restore the fix afterwards.
- Assert the intended behaviour. Never pin a seeded `FM-BUG-*` as correct.
- Tests must not depend on execution order or on data left by other tests.
- Report failures honestly. Don't delete, skip or loosen a test to make a run pass
  unless the task asks for it.
- Don't add a test runner or dependency without approval.
