// O-033: static check of claude-run-task.yml. After the workflow switches the
// work tree to a task branch, every guard script and tool must run from the
// snapshot of the dispatch-time default branch (`$RUNNER_TEMP/trusted`), never
// from the work tree. Reads workflow text only; Node built-ins only; never throws.

const SNAPSHOT = 'Snapshot trusted scripts';
const ROOT = String.raw`(?:\$\{RUNNER_TEMP\}|\$RUNNER_TEMP|\$\{\{\s*runner\.temp\s*\}\})\/trusted`;
const ROOT_PATH_RE = new RegExp(`${ROOT}\\/(?:\\.github\\/scripts|tooling)`, 'g');
const ROOT_START_RE = new RegExp(`^${ROOT}(?:\\/|$)`);
const TOOLING_VALUE_RE = new RegExp(`^${ROOT}\\/tooling\\/?(?:\\s|$)`);
const SWITCH_RE = /actions\/checkout|\bgit(?:\s+-[A-Za-z]\s+\S+|\s+--\S+)*\s+(?:switch|checkout|reset|merge|rebase|pull|restore|clean)\b/;
const REPO_PATH_RE = /\.github\/scripts|\btooling\b/;
const TRUSTED_WRITE_RE = /(?<![\w.-])(?:cp|mv|rm|ln|chmod|rsync)(?![\w-])/;

/** Split the first `steps:` list (job-level, 4-space indent) into steps. */
export function stepsOf(yml) {
  if (typeof yml !== 'string') return null;
  const lines = yml
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l));
  const start = lines.findIndex((l) => /^ {4}steps:\s*$/.test(l));
  if (start < 0) return null;
  const blocks = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {6}- /.test(line)) blocks.push([line]);
    else if (line.trim() !== '' && !/^ {6}/.test(line)) break;
    else if (blocks.length > 0) blocks[blocks.length - 1].push(line);
  }
  if (blocks.length === 0) return null;
  return blocks.map((b, index) => {
    const text = b.join('\n');
    const m = /^ {6}(?:- | {2})name:[ \t]*(.*)$/m.exec(text) ?? /^ {6}(?:- | {2})uses:[ \t]*(.*)$/m.exec(text);
    const name = (m?.[1] ?? '').trim().replace(/^(["'])(.*)\1$/, '$2');
    return { index, name, text };
  });
}

const unquote = (s) => s.trim().replace(/^(["'])(.*)\1$/, '$2');

function snapshotProblems(step) {
  const out = [];
  const t = step.text;
  if (/^ {6}- (?:if|continue-on-error):|^ {8}(?:if|continue-on-error):/m.test(t)) {
    out.push(`"${SNAPSHOT}" must not have if or continue-on-error`);
  }
  if (/client_payload/.test(t)) out.push(`"${SNAPSHOT}" must not use the task id (client_payload)`);
  const cps = [...t.matchAll(/(?<![\w.-])cp((?:\s+-[A-Za-z-]+)+)\s+("[^"\n]*"|'[^'\n]*'|\S+)\s+("[^"\n]*"|'[^'\n]*'|\S+)/g)];
  for (const dir of ['.github/scripts', 'tooling']) {
    const mine = cps.filter(
      (m) => /R|r|a|--recursive/.test(m[1]) && unquote(m[2]).replace(/^\.\//, '').replace(/\/+$/, '') === dir,
    );
    if (mine.length === 0) out.push(`"${SNAPSHOT}" has no recursive cp of ${dir}`);
    else if (!mine.some((m) => ROOT_START_RE.test(unquote(m[3])))) {
      out.push(`"${SNAPSHOT}" copies ${dir} to somewhere other than the trusted root`);
    }
  }
  return out;
}

function toolingDirProblem(step) {
  const values = [...step.text.matchAll(/TOOLING_DIR[ \t]*[:=][ \t]*(.*)$/gm)].map((m) => unquote(m[1]));
  if (values.length === 0) return `step "${step.name}" runs a guard script without TOOLING_DIR under the trusted root`;
  if (values.some((v) => !TOOLING_VALUE_RE.test(v))) return `step "${step.name}" sets TOOLING_DIR to something other than <trusted root>/tooling`;
  return null;
}

/** [] = ok. One line per problem, no file paths. Never throws. */
export function trustedScriptProblems(yml) {
  if (typeof yml !== 'string' || yml.trim() === '') return ['workflow text is empty or not a string'];
  const steps = stepsOf(yml);
  if (steps === null) return ['steps not found in the workflow'];
  const problems = [];

  const first = steps[0];
  if (!first || !/uses:[ \t]*actions\/checkout@/.test(first.text)) problems.push('step 1 is not actions/checkout');
  else if (/^\s+(?:ref|repository):/m.test(first.text)) problems.push('step 1 checkout must not set ref or repository');

  const snap = steps.find((s) => s.name === SNAPSHOT);
  if (!snap) problems.push(`"${SNAPSHOT}" step is missing`);
  else {
    if (snap.index !== 1) problems.push(`"${SNAPSHOT}" must be step 2 (found at step ${snap.index + 1})`);
    problems.push(...snapshotProblems(snap));
  }

  for (const s of steps) {
    if (s.name === SNAPSHOT) continue;
    if (s.text.split('\n').some((l) => l.includes('/trusted') && TRUSTED_WRITE_RE.test(l))) {
      problems.push(`step "${s.name}" modifies the trusted root (only "${SNAPSHOT}" may)`);
    }
  }

  const boundary = steps.find((s) => s.index >= 2 && s.name !== SNAPSHOT && SWITCH_RE.test(s.text));
  if (!boundary) {
    problems.push('no branch-switch step found after step 2 (fail-closed)');
    return problems;
  }
  if (snap && snap.index >= boundary.index) problems.push(`"${SNAPSHOT}" comes after the branch switch "${boundary.name}"`);

  for (const s of steps) {
    if (s.index < boundary.index) continue;
    if (/^ {6}(?:- | {2})uses:[ \t]*["']?\.\//m.test(s.text)) {
      problems.push(`step "${s.name}" uses a local action after the branch switch`);
    } else if (REPO_PATH_RE.test(s.text.replace(ROOT_PATH_RE, ''))) {
      problems.push(`step "${s.name}" references work-tree .github/scripts or tooling after the branch switch`);
    }
    if (/run-task-post-check\.sh|run-task-usage-limit\.sh["']?\s+detect\b/.test(s.text)) {
      const p = toolingDirProblem(s);
      if (p) problems.push(p);
    }
  }
  return problems;
}
