// PreToolUse guard for Write and Edit: protects applied migrations and the hooks.
// Tests run with Flyway off, so they can't catch a changed migration. A changed
// checksum would surface at deploy time, when production starts.
import { spawnSync } from 'node:child_process';
import { projectRoot, repoPath, runGuard } from './lib.mjs';

const MIGRATION = /^apps\/backend\/src\/main\/resources\/db\/migration\/V[^/]*\.sql$/i;
const HOOK_FILES = /^\.claude\/(settings\.json$|hooks\/)/i;
const LOCAL_SETTINGS = /^\.claude\/settings\.local\.json$/i;

runGuard('guard-paths', (input) => {
  const filePath = input.tool_input?.file_path;
  if (typeof filePath !== 'string') return null;
  const file = repoPath(input, filePath);
  if (file === null) return null;

  if (HOOK_FILES.test(file)) {
    return { decision: 'deny', reason: `${file} controls the hooks that guard this project. Change it by hand.` };
  }
  if (LOCAL_SETTINGS.test(file)) {
    return { decision: 'ask', reason: `${file} controls the hooks that guard this project.` };
  }
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
