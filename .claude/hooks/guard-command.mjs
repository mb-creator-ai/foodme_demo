// PreToolUse guard for shell commands: protected-branch pushes and destructive deletes.
// This parses common command forms. It is a safety net, not a security boundary: a
// script file, node -e or a command built from variables can still get past it.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { isProtectedConfigPath, projectRoot, runGuard, strictest } from './lib.mjs';

const PROTECTED_BRANCHES = new Set(['main', 'master']);
const GENERATED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'playwright-report', 'test-results']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
const POWERSHELLS = new Set(['powershell', 'pwsh']);
const DELETE_COMMANDS = new Set(['rm', 'remove-item', 'ri', 'del', 'erase', 'rd', 'rmdir']);
const LOCATION_COMMANDS = new Set(['cd', 'set-location', 'sl', 'chdir', 'pushd']);
const SKIPPED_PREFIXES = new Set([
  'if', 'then', 'elif', 'else', 'do', 'while', 'until', 'time', '!', 'exec', 'command',
  'builtin', 'nohup', 'sudo', 'env',
]);
const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);
const PUSH_OPTIONS_WITH_VALUE = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
const MAX_DEPTH = 4;

// Commands that may name a protected Claude config file without changing it. Anything
// else that names one is denied, so an unknown command fails safe.
const READ_ONLY_COMMANDS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'ls', 'dir', 'stat',
  'file', 'wc', 'sha256sum', 'sha1sum', 'md5sum', 'diff', 'cmp', 'echo', 'printf', 'type',
  'get-content', 'gc', 'select-string', 'sls', 'get-item', 'gi', 'get-childitem', 'gci',
  'test-path', 'get-filehash', 'gh', 'node',
]);
const READ_ONLY_GIT_COMMANDS = new Set([
  'add', 'status', 'diff', 'log', 'show', 'ls-files', 'blame', 'check-ignore', 'commit', 'grep',
  'rev-parse',
]);
const PROTECTED_CONFIG_TEXT = /\.claude\/(?:settings(?:\.local)?\.json(?![\w.-])|hooks(?:\/|$|['"`\s)])|[^/'"`\s]*[*?[])/i;
const CLAUDE_FOLDER = /(?:^|\/)\.claude\/?$/i;

// Every finding here is a deny: in auto mode an ask doesn't stop the command.
const deny = (reason) => ({ decision: 'deny', reason });

// Removes heredoc and here-string bodies, which are data, so a commit message that
// mentions rm -rf isn't treated as a command. Feeding one to a shell is reported.
function stripHereDocuments(command) {
  const lines = command.split(/\r?\n/);
  const kept = [];
  let feedsShell = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heredoc = /(?<!<)<<-?\s*(['"]?)([A-Za-z_]\w*)\1/.exec(line);
    const hereString = /@['"]\s*$/.test(line);
    let end = -1;

    if (heredoc) {
      end = lines.findIndex((candidate, at) => at > index && candidate.trim() === heredoc[2]);
      if (end !== -1 && /\b(bash|sh|zsh|dash|pwsh|powershell)\b[^|;&]*<</.test(line)) feedsShell = true;
    } else if (hereString) {
      end = lines.findIndex((candidate, at) => at > index && /^['"]@/.test(candidate));
    }

    if (end === -1) {
      kept.push(line);
    } else {
      kept.push(heredoc ? line.replace(heredoc[0], '') : line.replace(/@['"]\s*$/, "''"));
      kept.push(lines[end].replace(heredoc ? heredoc[2] : /^['"]@/, ''));
      index = end;
    }
  }
  return { text: kept.join('\n'), feedsShell };
}

function closingParenthesis(text, open) {
  let depth = 0;
  let quote = null;
  for (let index = open; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

// Splits a command line into segments of tokens, respecting quotes, and collects the
// contents of $(...) and backtick substitutions so they can be checked too.
function tokenize(text, shell) {
  const segments = [];
  const substitutions = [];
  let tokens = [];
  let current = '';
  let hasToken = false;
  let quote = null;
  let piped = false;

  const flushToken = () => {
    if (hasToken) tokens.push(current);
    current = '';
    hasToken = false;
  };
  const endSegment = (nextPiped = false) => {
    flushToken();
    if (tokens.length > 0) segments.push({ tokens, piped });
    tokens = [];
    piped = nextPiped;
  };
  const addCharacter = (character) => {
    current += character;
    hasToken = true;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (quote === "'") {
      if (character === "'") quote = null;
      else addCharacter(character);
      continue;
    }

    // Line continuations. stripHereDocuments has already turned \r\n into \n. Bash joins
    // the two lines, while a PowerShell backtick outside quotes acts as a word break.
    if (character === '\\' && next === '\n' && shell === 'bash') {
      index += 1;
      continue;
    }
    if (character === '`' && next === '\n' && shell === 'powershell' && quote === null) {
      flushToken();
      index += 1;
      continue;
    }

    if (character === '$' && next === '(') {
      const close = closingParenthesis(text, index + 1);
      if (close !== -1) {
        substitutions.push(text.slice(index + 2, close));
        addCharacter('$');
        index = close;
        continue;
      }
    }

    if (character === '`' && shell === 'bash') {
      const close = text.indexOf('`', index + 1);
      if (close !== -1) {
        substitutions.push(text.slice(index + 1, close));
        addCharacter('$');
        index = close;
        continue;
      }
    }

    if (quote === '"') {
      if (character === '\\' && shell === 'bash' && '"\\$`'.includes(next ?? ' ')) {
        addCharacter(next);
        index += 1;
      } else if (character === '"') {
        quote = null;
      } else {
        addCharacter(character);
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      hasToken = true;
    } else if (character === '\n') {
      endSegment();
    } else if (/\s/.test(character)) {
      flushToken();
    } else if (character === '#' && !hasToken) {
      while (index + 1 < text.length && text[index + 1] !== '\n') index += 1;
    } else if (character === '`' && shell === 'powershell') {
      if (next !== undefined) addCharacter(next);
      index += 1;
    } else if (character === '\\' && shell === 'bash' && next !== undefined && /[\s'"]/.test(next)) {
      addCharacter(next);
      index += 1;
    } else if (character === '$' && next === '{') {
      const close = text.indexOf('}', index);
      addCharacter(close === -1 ? text.slice(index) : text.slice(index, close + 1));
      index = close === -1 ? text.length : close;
    } else if (character === '{' && current.endsWith('@')) {
      const close = text.indexOf('}', index);
      addCharacter(close === -1 ? text.slice(index) : text.slice(index, close + 1));
      index = close === -1 ? text.length : close;
    } else if (';(){}'.includes(character)) {
      endSegment();
    } else if (character === '&') {
      if (next === '>' || text[index - 1] === '>') {
        addCharacter(character);
      } else {
        if (next === '&') index += 1;
        endSegment();
      }
    } else if (character === '|') {
      if (next === '|') {
        index += 1;
        endSegment();
      } else {
        endSegment(true);
      }
    } else {
      addCharacter(character);
    }
  }
  endSegment();
  return { segments, substitutions };
}

function commandName(token) {
  const base = token.replaceAll('\\', '/').split('/').pop().toLowerCase();
  return base.replace(/\.(exe|cmd|bat)$/, '');
}

function withoutRedirections(tokens) {
  const kept = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (/^\d*(>>?|<)$|^&>>?$/.test(tokens[index])) index += 1;
    else if (!/^\d*(>>?|<|&>>?)/.test(tokens[index])) kept.push(tokens[index]);
  }
  return kept;
}

function withoutPrefixes(tokens) {
  const rest = [...tokens];
  while (rest.length > 0) {
    const name = commandName(rest[0]);
    if (SKIPPED_PREFIXES.has(name) || /^[A-Za-z_]\w*=/.test(rest[0])) rest.shift();
    else break;
  }
  return rest;
}

function toNativePath(value) {
  const drive = /^\/(?:cygdrive\/)?([a-zA-Z])(\/.*)?$/.exec(value);
  return drive ? `${drive[1]}:${drive[2] ?? '/'}` : value;
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 4000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

function branchName(ref) {
  return ref.replace(/^\+/, '').replace(/^refs\/heads\//, '').toLowerCase();
}

function currentBranchFinding(context, cwd) {
  if (context.locationUnknown) return deny('Unable to tell which folder this push runs in.');
  const branch = runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch === null) return deny('Unable to determine the current git branch.');
  if (branch === 'HEAD') return deny('This push runs from a detached HEAD.');
  if (PROTECTED_BRANCHES.has(branch.toLowerCase())) return deny(`This push targets ${branch}, which deploys to production.`);

  const upstream = runGit(cwd, ['rev-parse', '--abbrev-ref', '@{upstream}']);
  if (upstream !== null && PROTECTED_BRANCHES.has(upstream.split('/').pop().toLowerCase())) {
    return deny(`Branch ${branch} tracks ${upstream}, so this push would update a protected branch.`);
  }
  return null;
}

function checkPush(args, context, cwd) {
  const findings = [];
  const positional = [];
  let force = false;
  let deleting = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') {
      positional.push(...args.slice(index + 1));
      break;
    }
    if (PUSH_OPTIONS_WITH_VALUE.has(argument)) {
      index += 1;
    } else if (/^--(all|branches|mirror|prune)$/.test(argument)) {
      findings.push(deny(`git push ${argument} can update protected branches.`));
    } else if (/^--force(-with-lease|-if-includes)?(=|$)/.test(argument)) {
      force = true;
    } else if (argument === '--delete') {
      deleting = true;
    } else if (/^-[a-zA-Z]+$/.test(argument)) {
      if (argument.includes('f')) force = true;
      if (argument.includes('d')) deleting = true;
    } else if (!argument.startsWith('-')) {
      positional.push(argument);
    }
  }

  const [remote, ...refspecs] = positional;
  if (remote?.toLowerCase() === 'upstream') findings.push(deny('This pushes to the upstream repository.'));
  if (refspecs.length === 0) findings.push(currentBranchFinding(context, cwd));

  for (const refspec of refspecs) {
    if (refspec.startsWith('+')) force = true;
    if (refspec.includes('*')) {
      findings.push(deny('Wildcard refspecs can update protected branches.'));
      continue;
    }
    if (refspec.includes('$')) {
      findings.push(deny('The push target contains a variable, so it can\'t be checked.'));
      continue;
    }
    const separator = refspec.indexOf(':');
    const source = separator === -1 ? refspec : refspec.slice(0, separator);
    const target = separator === -1 ? refspec : refspec.slice(separator + 1);
    if (branchName(source) === '' && separator !== -1) deleting = true;
    if (['head', '@'].includes(branchName(target))) findings.push(currentBranchFinding(context, cwd));
    else if (PROTECTED_BRANCHES.has(branchName(target))) {
      findings.push(deny(`This push targets ${branchName(target)}, which deploys to production.`));
    }
  }

  if (force) findings.push(deny('This is a force push.'));
  if (deleting) findings.push(deny('This push deletes a remote branch.'));
  return strictest(findings.filter(Boolean));
}

function checkGit(args, context) {
  let cwd = context.cwd;
  let index = 0;
  while (index < args.length && args[index].startsWith('-')) {
    if (args[index] === '-C') cwd = path.resolve(cwd, toNativePath(args[index + 1] ?? '.'));
    index += GIT_GLOBAL_OPTIONS_WITH_VALUE.has(args[index]) ? 2 : 1;
  }
  const subcommand = args[index];
  const rest = args.slice(index + 1);

  if (subcommand === 'push') return checkPush(rest, context, cwd);
  if (subcommand === 'reset' && rest.includes('--hard')) return deny('git reset --hard discards local changes.');
  if (subcommand === 'clean' && rest.some((argument) => /^-[a-zA-Z]*f|^--force$/.test(argument))) {
    return deny('git clean permanently deletes untracked files.');
  }
  return null;
}

// Only generated output inside the repo may be deleted recursively.
function isSafeDeleteTarget(target, context) {
  if (context.locationUnknown || /[$*?~%`]/.test(target)) return false;
  const root = context.root;
  const absolute = path.resolve(context.cwd, toNativePath(target));
  const relative = path.relative(root, absolute);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  const parts = relative.split(path.sep);
  return !parts.includes('src') && !parts.includes('.git')
    && parts.some((part) => GENERATED_DIRECTORIES.has(part));
}

// Any recursive delete counts, with or without force: rm -r doesn't prompt when there is
// no terminal, and PowerShell removes a tree with -Recurse alone.
function checkDelete(name, args, context) {
  let recursive = false;
  const targets = [];

  for (const argument of args) {
    const [flag, value] = argument.toLowerCase().split(':'); // -Recurse:$true has a value.
    if (flag.startsWith('--')) {
      if (flag.length >= 3 && 'recursive'.startsWith(flag.slice(2))) recursive = true; // GNU allows --rec.
    } else if (flag === '/s') {
      recursive = true;
    } else if (/^\/[qfa]$/.test(flag)) {
      continue;
    } else if (flag.length >= 3 && flag.startsWith('-') && 'recurse'.startsWith(flag.slice(1))) {
      if (value !== '$false') recursive = true;
    } else if (/^-[rfdvi]+$/.test(flag)) {
      if (flag.includes('r')) recursive = true;
    } else if (!argument.startsWith('-')) {
      targets.push(argument);
    }
  }

  if (!recursive) return null;
  if (targets.length > 0 && targets.every((target) => isSafeDeleteTarget(target, context))) return null;
  return deny(`Recursive delete blocked (${name}). Only generated folders inside the repo are allowed: ${[...GENERATED_DIRECTORIES].join(', ')}.`);
}

function checkFind(args) {
  if (args.includes('-delete') || args.some((argument, index) => argument === '-exec'
    && DELETE_COMMANDS.has(commandName(args[index + 1] ?? '')))) {
    return deny('find is set to delete files.');
  }
  return null;
}

function namesProtectedConfig(token, context) {
  const slashes = (value) => value.replaceAll('\\', '/');
  if (PROTECTED_CONFIG_TEXT.test(slashes(token))) return true;
  if (context.locationUnknown || /[$`%~]/.test(token)) return false;
  const absolute = path.resolve(context.cwd, toNativePath(token));
  return isProtectedConfigPath(context.input, absolute)
    || PROTECTED_CONFIG_TEXT.test(slashes(absolute))
    || CLAUDE_FOLDER.test(slashes(absolute));
}

function redirectionTargets(tokens) {
  const targets = [];
  tokens.forEach((token, index) => {
    const redirect = /^\d*&?>>?(.*)$/.exec(token);
    if (!redirect) return;
    const target = redirect[1] || tokens[index + 1];
    if (target !== undefined && !target.startsWith('&')) targets.push(target);
  });
  return targets;
}

function gitSubcommand(args) {
  let index = 0;
  while (index < args.length && args[index].startsWith('-')) {
    index += GIT_GLOBAL_OPTIONS_WITH_VALUE.has(args[index]) ? 2 : 1;
  }
  return args[index];
}

function isReadOnly(name, args) {
  if (name === 'git') return READ_ONLY_GIT_COMMANDS.has(gitSubcommand(args));
  if (name === 'sed') return !args.some((argument) => /^(-[a-z]*i|--in-place)/i.test(argument));
  if (name === 'node') return !args.some((argument) => /^(-e|-p|--eval|--print)/.test(argument));
  return READ_ONLY_COMMANDS.has(name);
}

const PROTECTED_CONFIG_REASON = 'Claude settings and hook files must be changed by hand.';

function innerScript(args, flags) {
  const position = args.findIndex((argument) => flags.includes(argument.toLowerCase()));
  return position === -1 ? null : args.slice(position + 1).join(' ');
}

function checkSegment(segment, context, depth) {
  if (redirectionTargets(segment.tokens).some((target) => namesProtectedConfig(target, context))) {
    return deny(PROTECTED_CONFIG_REASON);
  }

  let tokens = withoutPrefixes(withoutRedirections(segment.tokens));
  if (tokens.length === 0) return null;

  let name = commandName(tokens[0]);
  if (name === 'xargs') {
    const inner = tokens.slice(1).findIndex((token) => !token.startsWith('-'));
    tokens = inner === -1 ? [] : tokens.slice(inner + 1);
    if (tokens.length === 0) return null;
    name = commandName(tokens[0]);
  }
  const args = tokens.slice(1);

  if (LOCATION_COMMANDS.has(name)) {
    const target = args.find((argument) => !argument.startsWith('-'));
    if (target === undefined) return null;
    if (/[$`~%]/.test(target)) context.locationUnknown = true;
    else context.cwd = path.resolve(context.cwd, toNativePath(target));
    return null;
  }

  if (SHELLS.has(name)) {
    const script = innerScript(args, ['-c', '-lc', '-ic']);
    if (script !== null) return checkCommand(script, context, 'bash', depth + 1);
    if (segment.piped) return deny('This pipes content into a shell, so it can\'t be checked.');
    return null;
  }
  if (POWERSHELLS.has(name)) {
    if (args.some((argument) => /^-e(nc|ncodedcommand)?$/i.test(argument))) {
      return deny('Encoded PowerShell commands can\'t be checked.');
    }
    const script = innerScript(args, ['-command', '-c']);
    if (script !== null) return checkCommand(script, context, 'powershell', depth + 1);
    if (segment.piped) return deny('This pipes content into a shell, so it can\'t be checked.');
    return null;
  }
  if (name === 'cmd') {
    const script = innerScript(args, ['/c', '/k']);
    return script === null ? null : checkCommand(script, context, 'powershell', depth + 1);
  }
  if (name === 'eval' || name === 'invoke-expression' || name === 'iex') {
    return checkCommand(args.join(' '), context, context.shell, depth + 1);
  }

  if (!isReadOnly(name, args) && args.some((argument) => namesProtectedConfig(argument, context))) {
    return deny(PROTECTED_CONFIG_REASON);
  }

  if (name === 'git') return checkGit(args, context);
  if (name === 'gh' && args[0] === 'pr' && args[1] === 'merge') {
    return deny('gh pr merge can deploy to production.');
  }
  if (DELETE_COMMANDS.has(name)) return checkDelete(name, args, context);
  if (name === 'find') return checkFind(args);
  return null;
}

function checkCommand(command, context, shell, depth) {
  if (depth > MAX_DEPTH) return deny('This command is nested too deeply to check.');
  const scoped = { ...context, shell };
  const { text, feedsShell } = stripHereDocuments(command);
  const { segments, substitutions } = tokenize(text, shell);
  const findings = [];

  if (feedsShell) findings.push(deny('This feeds a heredoc into a shell, so it can\'t be checked.'));
  for (const substitution of substitutions) findings.push(checkCommand(substitution, scoped, shell, depth + 1));
  for (const segment of segments) findings.push(checkSegment(segment, scoped, depth));
  context.cwd = scoped.cwd;
  context.locationUnknown = scoped.locationUnknown;
  return strictest(findings.filter(Boolean));
}

runGuard('guard-command', (input) => {
  const command = input.tool_input?.command;
  if (typeof command !== 'string' || command.trim() === '') return null;
  const shell = input.tool_name === 'PowerShell' || input.tool_name === 'mcp__terminal__run_in_terminal'
    ? 'powershell'
    : 'bash';
  const root = projectRoot(input);
  const context = { input, root, cwd: path.resolve(input.cwd || root), locationUnknown: false, shell };
  return checkCommand(command, context, shell, 0);
});
