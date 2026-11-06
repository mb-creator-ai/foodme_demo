// Logs important Claude Code actions to .claude/logs/actions-YYYY-MM-DD.jsonl.
// Records metadata only: never file contents or prompts. Commands are shortened and
// likely secrets are redacted, which is best effort, so the logs stay gitignored.
// Logging must never interfere with the session, so every failure is ignored.
import { appendLog, readInput, repoPath, truncateCommand } from './lib.mjs';

try {
  const input = readInput();
  const toolInput = input.tool_input ?? {};
  const filePath = toolInput.file_path ?? input.file_path;
  const entry = {
    event: input.hook_event_name,
    session: input.session_id,
    tool: input.tool_name,
    toolUseId: input.tool_use_id,
    permissionMode: input.permission_mode,
    durationMs: input.duration_ms,
    source: input.source,
    reason: input.reason,
    loadReason: input.load_reason,
    memoryType: input.memory_type,
    globs: input.globs,
    triggerFile: input.trigger_file_path,
  };
  if (typeof filePath === 'string') entry.file = repoPath(input, filePath) ?? filePath;
  if (typeof toolInput.command === 'string') entry.command = truncateCommand(toolInput.command);
  appendLog(input, entry);
} catch {
  // Ignored on purpose.
}
