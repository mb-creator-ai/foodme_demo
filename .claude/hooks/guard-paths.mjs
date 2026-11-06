// PreToolUse guard for Write and Edit: protects applied migrations and the hooks.
// Tests run with Flyway off, so they can't catch a changed migration. A changed
// checksum would surface at deploy time, when production starts.
import { spawnSync } from 'node:child_process';
import {
  absolutePath, isProtectedConfigPath, projectRoot, repoPath, runGuard,
} from './lib.mjs';

const MIGRATION = /^apps\/backend\/src\/main\/resources\/db\/migration\/V[^/]*\.sql$/i;

runGuard('guard-paths', (input) => {
  const filePath = input.tool_input?.file_path;
  if (typeof filePath !== 'string') return null;

  // This comes first because user settings live outside the project.
  if (isProtectedConfigPath(input, absolutePath(input, filePath))) {
    return { decision: 'deny', reason: `${filePath} controls the hooks that guard this project. Change it by hand.` };
  }

  const file = repoPath(input, filePath);
  if (file === null) return null;
  if (!MIGRATION.test(file)) return null;

  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', file], {
    cwd: projectRoot(input),
    encoding: 'utf8',
    timeout: 4000,
  });
  if (tracked.status === 0) {
    return { decision: 'deny', reason: 'Never edit an applied migration. Add a new V<n>__description.sql file.' };
  }
  if (tracked.status === 1) return null; // Not tracked yet: this is a new migration.
  return { decision: 'ask', reason: 'Unable to tell whether this migration is already tracked.' };
});
