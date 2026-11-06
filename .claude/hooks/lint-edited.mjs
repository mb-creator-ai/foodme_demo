// PostToolUse hook: lints the edited file and reports the result back to Claude.
// It is report-only and never changes a file. The repo has no formatter, oxlint --fix
// doesn't reformat, and rewriting a file makes Claude's next Edit fail as stale.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { absolutePath, projectRoot, readInput, repoPath } from './lib.mjs';

const REPORT_LIMIT = 2000;

// Linters run through node directly: Windows refuses to spawn .cmd files without a shell.
const LINTERS = [
  {
    prefix: 'apps/web/',
    files: /\.(?:ts|tsx|js|jsx|mjs|cjs)$/,
    entry: 'apps/web/node_modules/oxlint/bin/oxlint',
    // Depending on the environment, a clean run prints nothing or a zero summary.
    clean: (output) => output.trim() === '' || /Found 0 warnings and 0 errors/.test(output),
  },
  {
    prefix: 'apps/admin/',
    files: /\.(?:js|jsx|mjs|cjs)$/,
    entry: 'apps/admin/node_modules/eslint/bin/eslint.js',
    clean: (output) => output.trim() === '',
  },
];

function lint(input) {
  const filePath = input.tool_response?.filePath ?? input.tool_input?.file_path;
  if (typeof filePath !== 'string') return;
  const file = repoPath(input, filePath);
  if (file === null || file.includes('/node_modules/')) return;

  const linter = LINTERS.find((candidate) => file.startsWith(candidate.prefix) && candidate.files.test(file));
  if (!linter) return;

  const root = projectRoot(input);
  const entry = path.join(root, linter.entry);
  if (!fs.existsSync(entry)) return; // Dependencies aren't installed for this app.

  const result = spawnSync(process.execPath, [entry, absolutePath(input, filePath)], {
    cwd: path.join(root, linter.prefix),
    encoding: 'utf8',
    timeout: 25000,
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.error) return;

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (linter.clean(output)) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `Lint report for ${file}:\n${output.trim().slice(0, REPORT_LIMIT)}`,
    },
  }));
}

try {
  lint(readInput());
} catch (error) {
  process.stderr.write(`[lint-edited] skipped: ${error.message}\n`);
}
