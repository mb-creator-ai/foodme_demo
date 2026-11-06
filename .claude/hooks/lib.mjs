// Shared helpers for the FoodMe Claude Code hooks. Node standard library only.
import fs from 'node:fs';
import path from 'node:path';

const LOG_COMMAND_LIMIT = 300;

// Reads the JSON Claude Code sends on stdin. Throws on empty or invalid input,
// so a guard exits through runGuard and fails closed.
export function readInput() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^﻿/, ''));
  if (input === null || typeof input !== 'object') {
    throw new Error('hook input is not a JSON object');
  }
  return input;
}

// CLAUDE_PROJECT_DIR uses / or \ depending on how the hook was started, and the
// process working directory isn't reliable, so never use process.cwd() here.
export function projectRoot(input) {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd);
}

export function absolutePath(input, filePath) {
  return path.resolve(input.cwd || projectRoot(input), filePath);
}

// Returns a forward-slash path relative to the project, or null when outside it.
export function repoPath(input, filePath) {
  const relative = path.relative(projectRoot(input), absolutePath(input, filePath));
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}

export function normalizeNewlines(text) {
  return text.replaceAll('\r\n', '\n');
}

// Returns '' for a file that doesn't exist yet. Other read errors propagate.
export function readIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

export function redact(text) {
  return text
    .replace(/\bBearer\s+\S+/gi, 'Bearer <redacted>')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]+|sk-[A-Za-z0-9_-]+)/g, '<redacted>')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<redacted>')
    .replace(/:\/\/([^:/\s]+):[^@/\s]+@/g, '://$1:<redacted>@')
    .replace(
      /(--?(?:password|passwd|token|secret|api-?key)[= ]|\b(?:password|passwd|pwd|secret|token|api[_-]?key|authorization)\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi,
      '$1<redacted>',
    );
}

export function truncateCommand(command) {
  const clean = redact(command);
  return clean.length > LOG_COMMAND_LIMIT ? `${clean.slice(0, LOG_COMMAND_LIMIT)}...` : clean;
}

export function appendLog(input, entry) {
  const now = new Date();
  const directory = path.join(projectRoot(input), '.claude', 'logs');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `actions-${now.toISOString().slice(0, 10)}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify({ ts: now.toISOString(), ...entry })}\n`);
}

// Keeps the strictest result: deny beats ask, and ask beats no finding.
export function strictest(findings) {
  return findings.find((finding) => finding.decision === 'deny')
    ?? findings.find((finding) => finding.decision === 'ask')
    ?? null;
}

// Runs a PreToolUse guard. A guard returns a { decision, reason } finding or null.
// Output uses exitCode rather than process.exit, because stdout pipes on Windows are
// asynchronous and exiting straight away can cut the JSON short.
export function runGuard(name, check) {
  let input;
  try {
    input = readInput();
    const finding = check(input);
    if (!finding) return;
    const reason = `[${name}] ${finding.reason}`;
    try {
      appendLog(input, {
        event: 'GuardDecision',
        guard: name,
        decision: finding.decision,
        reason,
        session: input.session_id,
        tool: input.tool_name,
        file: input.tool_input?.file_path,
        command: input.tool_input?.command ? truncateCommand(input.tool_input.command) : undefined,
      });
    } catch {
      // A logging problem must never change the decision.
    }
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: finding.decision,
        permissionDecisionReason: reason,
      },
    }));
  } catch (error) {
    // Exit code 2 blocks the tool call: a guard that can't decide must not allow it.
    process.stderr.write(`[${name}] guard error, blocking: ${error.message}\n`);
    process.exitCode = 2;
  }
}
