// pushguard 的純判斷邏輯。不讀 stdin、不印東西；「目前分支」可注入，測試不碰真的 repo。
import { execFileSync } from 'node:child_process';

const BRANCH_RE = /^(task|fix|poc)\/[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const WRAPPERS = new Set(['env', 'command', 'builtin', 'time', 'timeout', 'nice', 'nohup', 'xargs']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'pwsh', 'powershell', 'cmd', 'eval', 'invoke-expression', 'iex']);
const DENIED_FILE_TOOLS = new Set(['cat', 'grep', 'head', 'ls', 'sed']);
const GIT_OPTS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path']);
const GH_READONLY = [
  ['run', 'list'], ['run', 'view'], ['run', 'watch'],
  ['pr', 'view'], ['pr', 'list'], ['pr', 'checks'],
  ['auth', 'status'],
];
const STRICT_FORBIDDEN = /[`<>*?[~\\'"]|\$\(|\$\{/;
const CHAIN_CHARS = /[;&|\n]/;
const SUBSHELL_GIT = /(\$\(|`)[^)`]*\b(git\s+(-\S+\s+)*(push|merge|pull)|gh)\b/;

const deny = (reason) => ({ decision: 'deny', reason: `pushguard: ${reason}` });
const GOOD_PUSH = 'only "git push [-u] origin <current task/, fix/ or poc/ branch>" is allowed';

/** 取目前分支；取不到（detached HEAD、不在 git repo、逾時）回傳 null。 */
export function getCurrentBranch(cwd) {
  try {
    const out = execFileSync('git', ['-C', cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD'], {
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const name = out.toString('utf8').trim();
    return name === '' ? null : name;
  } catch {
    return null;
  }
}

/** 簡易 shell 斷詞。回傳 string[][]（每段一組字）；引號不成對回傳 null。 */
export function tokenize(command) {
  const segments = [];
  let words = [];
  let cur = '';
  let inWord = false;
  let quote = null;
  const endWord = () => {
    if (inWord) words.push(cur);
    cur = '';
    inWord = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length > 0) segments.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else cur += c;
    } else if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === '\\' && i + 1 < command.length) cur += command[++i];
      else cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (c === '\\') {
      if (i + 1 < command.length) {
        cur += command[++i];
        inWord = true;
      }
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
    } else if (c === ';' || c === '&' || c === '|' || c === '\n' || c === '(' || c === ')' || c === '`') {
      endSegment();
    } else {
      cur += c;
      inWord = true;
    }
  }
  if (quote !== null) return null;
  endSegment();
  return segments;
}

const baseName = (word) => word.split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();

/** 去掉開頭的環境變數與包裝指令。回傳 { words, prefixed }。 */
function stripPrefix(words) {
  let w = words.slice();
  let prefixed = false;
  for (;;) {
    if (w.length === 0) break;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) {
      w.shift();
      prefixed = true;
      continue;
    }
    if (['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{'].includes(w[0])) {
      w.shift();
      prefixed = true;
      continue;
    }
    const name = baseName(w[0]);
    if (WRAPPERS.has(name)) {
      w.shift();
      prefixed = true;
      let first = true;
      while (w.length > 0) {
        if (w[0].startsWith('-')) {
          const opt = w.shift();
          if (name === 'nice' && opt === '-n' && w.length > 0) w.shift();
        } else if (first && name === 'timeout' && /^[0-9.]+[smhd]?$/.test(w[0])) {
          w.shift();
        } else if (name === 'env' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) {
          w.shift();
        } else break;
        first = false;
      }
      continue;
    }
    break;
  }
  return { words: w, prefixed };
}

function pushReason(words, branch) {
  if (words.some((x) => x.includes(':'))) return `${GOOD_PUSH}; got refspec with ":"`;
  if (words.some((x) => x.startsWith('+'))) return `${GOOD_PUSH}; "+" (force) refspec is not allowed`;
  if (words.some((x) => /^(-f|--force.*|--mirror|--all|--tags|--follow-tags|--delete|-d|--prune)$/.test(x))) {
    return `${GOOD_PUSH}; force, delete, mirror, all and tags options are not allowed`;
  }
  if (branch === null) return `${GOOD_PUSH}; current branch cannot be determined (detached HEAD or not a git repo)`;
  if (!BRANCH_RE.test(branch)) return `${GOOD_PUSH}; current branch "${branch}" is not task/, fix/ or poc/`;
  return `${GOOD_PUSH}; got "${words.slice(1).join(' ')}"`;
}

/** 嚴格白名單：成立回傳 true。 */
function isStrictAllowedPush(raw, segments, seg, prefixed, branch) {
  if (segments.length !== 1 || prefixed) return false;
  if (STRICT_FORBIDDEN.test(raw) || CHAIN_CHARS.test(raw.trim())) return false;
  if (seg[0] !== 'git' || seg[1] !== 'push') return false;
  const rest = seg.slice(2);
  let target;
  if (rest.length === 2 && rest[0] === 'origin') target = rest[1];
  else if (rest.length === 3 && (rest[0] === '-u' || rest[0] === '--set-upstream') && rest[1] === 'origin') target = rest[2];
  else return false;
  if (branch === null || !BRANCH_RE.test(branch)) return false;
  if (target.includes(':') || target.startsWith('+') || target === 'HEAD' || target === 'main' || target === 'master') return false;
  if (!BRANCH_RE.test(target) || target.includes('..') || target.endsWith('.lock')) return false;
  return target === branch;
}

function evalGit(raw, segments, words, prefixed, getBranch) {
  let i = 1;
  while (i < words.length && words[i].startsWith('-')) {
    i += GIT_OPTS_WITH_VALUE.has(words[i]) ? 2 : 1;
  }
  const sub = words[i];
  if (sub === undefined) return null;
  const args = words.slice(i + 1);
  switch (sub) {
    case 'push': {
      const branch = getBranch();
      const seg = words;
      if (isStrictAllowedPush(raw, segments, seg, prefixed, branch)) return { decision: 'allow', reason: 'pushguard: current task/fix/poc branch' };
      if (i > 1) return deny(`${GOOD_PUSH}; git global options (e.g. -C, -c) before "push" are not allowed`);
      return deny(pushReason(words.slice(i), branch));
    }
    case 'merge':
      return deny('git merge is not allowed; merging is done by a human on GitHub');
    case 'pull':
      return args.includes('--ff-only') ? null : deny('only "git pull --ff-only" is allowed (a plain pull can create a merge commit)');
    case 'commit': {
      const branch = getBranch();
      if (branch === null || branch === 'main' || branch === 'master') {
        return deny(`committing on "${branch ?? 'unknown branch'}" is not allowed; work on a task/, fix/ or poc/ branch`);
      }
      return null;
    }
    default:
      return null;
  }
}

function evalGh(words) {
  const pair = [words[1], words[2]];
  const ok = GH_READONLY.some(([a, b]) => a === pair[0] && b === pair[1]);
  return ok ? null : deny('gh is read-only here: only "gh run list|view|watch", "gh pr view|list|checks" and "gh auth status" are allowed (no PR creation or merge)');
}

/** 無法解析時的保守判斷（引號不成對、stdin 不是 JSON）。 */
export function fallbackDecision(text) {
  const hasGit = /\bgit\b/.test(text);
  const hasGh = /\bgh\b/.test(text);
  if ((hasGit && /\b(push|merge|pull)\b/.test(text)) || hasGh) {
    return deny('cannot parse the command safely and it looks like git push/merge/pull or gh; run it yourself or use the exact allowed form');
  }
  return null;
}

/**
 * @param {{command: string, getBranch: () => (string|null)}} input
 * @returns {{decision: 'allow'|'deny', reason: string} | null}  null = 不表示意見
 */
export function evaluate({ command, getBranch }) {
  const raw = String(command ?? '');
  const segments = tokenize(raw);
  if (segments === null) return fallbackDecision(raw);
  if (SUBSHELL_GIT.test(raw)) return deny('git push/merge/pull or gh inside a command substitution is not allowed');
  let allow = null;
  for (const seg of segments) {
    const { words, prefixed } = stripPrefix(seg);
    if (words.length === 0) continue;
    const name = baseName(words[0]);
    let result = null;
    if (SHELLS.has(name) && /push|merge|gh /.test(raw)) {
      result = deny(`wrapping git/gh in "${words[0]}" cannot be checked safely; run the command directly`);
    } else if (DENIED_FILE_TOOLS.has(name)) {
      result = deny(`Bash(${name}) is denied; use the Read / Glob / Grep tools (task rule #15)`);
    } else if (name === 'git') {
      result = evalGit(raw, segments, words, prefixed || words[0] !== 'git', getBranch);
    } else if (name === 'gh') {
      result = evalGh(words);
    }
    if (result?.decision === 'deny') return result;
    if (result?.decision === 'allow') allow = result;
  }
  return allow;
}
