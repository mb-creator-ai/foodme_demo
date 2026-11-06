// PreToolUse guard for Write and Edit: stops new test code breaking the testing rules.
// It works out the file's content after the change and only reacts when a pattern
// occurs more often, so existing seeded flakes can be edited or removed.
// PreToolUse has no originalFile field, so the "before" content comes from disk.
import path from 'node:path';
import {
  absolutePath, normalizeNewlines, readIfExists, repoPath, runGuard, strictest,
} from './lib.mjs';

const TEST_RUNNER_DEPENDENCY = /"(?:vitest|jest|mocha|ava|jasmine|ts-jest|@vitest\/[^"]+|@jest\/[^"]+)"\s*:/g;

const TEST_FILE_RULES = [
  { decision: 'deny', pattern: /\.waitForTimeout\s*\(/g, reason: 'Fixed waits are flaky (FM-FLAKE-01). Use a web-first assertion.' },
  { decision: 'deny', pattern: /\b(?:test|it|describe)(?:\.\w+)*\.only\b/g, reason: '.only silently skips every other test.' },
  { decision: 'deny', pattern: /\b(?:test|it|describe)(?:\.\w+)*\.(?:skip|fixme)\s*\(/g, reason: 'testing.md: don\'t skip a test to make a run pass.' },
  { decision: 'deny', pattern: /@Disabled\b/g, reason: 'testing.md: don\'t skip a test to make a run pass.' },
  { decision: 'deny', pattern: /@TestMethodOrder\b/g, reason: 'Tests must not depend on execution order (FM-FLAKE-02).' },
  { decision: 'deny', pattern: /@Order\s*\(/g, reason: 'Tests must not depend on execution order (FM-FLAKE-02).' },
  { decision: 'deny', pattern: /\bFM-\d{6}\b/g, reason: 'Read order numbers from the response instead of hardcoding them (FM-FLAKE-02).' },
  { decision: 'ask', pattern: /\bLocalDate\s*\.\s*now\s*\(/g, reason: 'LocalDate.now() can fail around midnight or across time zones (FM-FLAKE-04).' },
];

function isTestFile(file) {
  return file.startsWith('apps/backend/src/test/')
    || file.startsWith('apps/web/e2e/')
    || file.startsWith('apps/admin/e2e/')
    || /\.(?:test|spec)\.[^/]+$/.test(file);
}

function countMatches(text, pattern) {
  return (text.match(pattern) ?? []).length;
}

// Returns the new content, or null when old_string can't be located exactly.
function contentAfterEdit(before, toolInput) {
  const oldText = normalizeNewlines(toolInput.old_string ?? '');
  const newText = normalizeNewlines(toolInput.new_string ?? '');
  if (oldText === '' || !before.includes(oldText)) return null;
  if (toolInput.replace_all) return before.split(oldText).join(newText);
  return before.replace(oldText, () => newText); // A function keeps "$&" literal.
}

function addedLines(before, after) {
  const remaining = new Map();
  for (const line of before.split('\n')) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  return after.split('\n').filter((line) => {
    const count = remaining.get(line) ?? 0;
    if (count > 0) {
      remaining.set(line, count - 1);
      return false;
    }
    return line.trim() !== '' && !line.trim().startsWith('--');
  });
}

runGuard('guard-tests', (input) => {
  const toolInput = input.tool_input ?? {};
  if (typeof toolInput.file_path !== 'string') return null;
  const file = repoPath(input, toolInput.file_path);
  if (file === null) return null;

  const isTest = isTestFile(file);
  const isDataSql = file === 'apps/backend/src/test/resources/data.sql';
  const isPackageJson = /^apps\/[^/]+\/package\.json$/.test(file);
  if (!isTest && !isPackageJson) return null;

  let before = normalizeNewlines(readIfExists(absolutePath(input, toolInput.file_path)));
  let after = input.tool_name === 'Write'
    ? normalizeNewlines(toolInput.content ?? '')
    : contentAfterEdit(before, toolInput);

  // Fallback when the edit can't be simulated: compare the two snippets themselves.
  if (after === null) {
    before = normalizeNewlines(toolInput.old_string ?? '');
    after = normalizeNewlines(toolInput.new_string ?? '');
  }

  const findings = [];
  if (isPackageJson && countMatches(after, TEST_RUNNER_DEPENDENCY) > countMatches(before, TEST_RUNNER_DEPENDENCY)) {
    findings.push({ decision: 'ask', reason: 'testing.md: adding a test runner needs approval.' });
  }
  if (isTest) {
    for (const rule of TEST_FILE_RULES) {
      if (countMatches(after, rule.pattern) > countMatches(before, rule.pattern)) {
        findings.push({ decision: rule.decision, reason: rule.reason });
      }
    }
    if (/^flake-.*\.spec\./.test(path.posix.basename(file)) && addedLines(before, after).length > 0) {
      findings.push({ decision: 'ask', reason: 'flake-*.spec.ts files are course exercises, so don\'t add to them.' });
    }
    if (isDataSql && addedLines(before, after).length > 0) {
      findings.push({ decision: 'ask', reason: 'Create test data through the API; other tests assert on data.sql rows.' });
    }
  }
  return strictest(findings);
});
