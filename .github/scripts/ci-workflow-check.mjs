// O-015 static workflow check (retro §3.7 C4, C6, C7; task W-5, W-6). Only node: built-ins.
// O-016 adds the CI cost lint (CL-1 timeout-minutes 1-60 on every job, CL-2 a top-level
// concurrency group on every workflow, CL-3 job count <= .github/ci-budget.json), the
// --no-renames check on the taskcheck / post-check diffs, and the PR-description step.
// Usage: node ci-workflow-check.mjs <repo root>   -> exit 0 "ci-workflow-check: OK", else exit 1 with findings.
// The workflows are parsed line by line (2-space YAML as written in this repo); anything the
// parser does not understand is a finding (fail-closed), never a pass.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CI_OK_NAME_EXPR = "${{ github.event_name == 'pull_request' && 'ci-ok' || format('ci-ok ({0})', github.event_name) }}";
const SECURITY_STEPS = ['actionlint', 'pushguard tests', 'gitleaks (full history)', 'secret scanner self-test'];
const NOT_CANCELLED = '${{ !cancelled() }}';
const HEAVY = ['check', 'bundle', 'db', 'e2e'];
const FULL_GUARD = "needs.ci-guard.outputs.mode == 'full' && ";
const DOCS_TASKS = "(needs.ci-guard.outputs.mode == 'docs' && needs.ci-guard.outputs.tasks_changed == 'true')";
const CI_OK_NEEDS = ['ci-guard', 'check', 'bundle', 'db', 'e2e', 'taskcheck'];
const REMOVED_JOBS = ['detect', 'actionlint', 'pushguard', 'secrets', 'guard'];
export const BUDGET_FILE = '.github/ci-budget.json';
const TIMEOUT_MAX = 60;
// O-016 (retro M5): every `git diff` in these scripts must use --no-renames, otherwise a
// rename lists only the new path (scope-check misses the old one; --diff-filter=AM drops R).
export const NO_RENAMES_SCRIPTS = { '.github/scripts/taskcheck.sh': 3, '.github/scripts/run-task-post-check.sh': 1 };
export const PR_BODY_STEP = 'PR description: Actions 分鐘數影響';
const PR_BODY_IF = "${{ !cancelled() && github.event_name == 'pull_request' }}";
const PR_BODY_ENV = {
  GH_TOKEN: '${{ github.token }}',
  REPO: '${{ github.repository }}',
  PR_NUMBER: '${{ github.event.pull_request.number }}',
  BASE_SHA: '${{ github.event.pull_request.base.sha }}',
  HEAD_SHA: '${{ github.event.pull_request.head.sha }}',
};

const indentOf = (l) => l.length - l.trimStart().length;
const unquote = (v) => {
  const t = v.trim();
  return (t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"')) ? t.slice(1, -1) : t;
};

/** Collect a scalar that may be folded (`>-`, `|`) into one string. */
function scalarAt(lines, i, value) {
  if (value !== '>-' && value !== '|' && value !== '>') return { text: value, next: i + 1 };
  const base = indentOf(lines[i]);
  const parts = [];
  let j = i + 1;
  for (; j < lines.length && (lines[j].trim() === '' || indentOf(lines[j]) > base); j += 1) parts.push(lines[j].trim());
  return { text: parts.join(value === '|' ? '\n' : ' ').trim(), next: j };
}

export function parseWorkflow(text) {
  const lines = text.split(/\r?\n/);
  const wf = { events: [], onLines: [], jobs: new Map(), problems: [], concurrency: null };
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^on:\s*$/.test(l)) {
      i += 1;
      for (; i < lines.length && (lines[i].trim() === '' || indentOf(lines[i]) > 0); i += 1) {
        wf.onLines.push(lines[i]);
        const m = /^ {2}([A-Za-z_]+):/.exec(lines[i]);
        if (m) wf.events.push(m[1]);
      }
      continue;
    }
    if (/^on:/.test(l)) wf.problems.push('`on:` must be a block (inline forms are not understood)');
    const cm = /^concurrency:\s*(.*)$/.exec(l);
    if (cm) {
      // CL-2: only the block form (group: / cancel-in-progress:) is understood.
      wf.concurrency = { inline: cm[1].replace(/\s+#.*$/, '').trim(), group: null, cancel: null };
      i += 1;
      for (; i < lines.length && (lines[i].trim() === '' || indentOf(lines[i]) > 0); i += 1) {
        const km = /^ {2}(group|cancel-in-progress):\s*(.*)$/.exec(lines[i]);
        if (km) wf.concurrency[km[1] === 'group' ? 'group' : 'cancel'] = unquote(km[2]);
      }
      continue;
    }
    if (/^jobs:\s*$/.test(l)) {
      i += 1;
      let job = null;
      let step = null;
      let section = null;
      while (i < lines.length && (lines[i].trim() === '' || indentOf(lines[i]) > 0)) {
        const line = lines[i];
        const ind = indentOf(line);
        const t = line.trim();
        if (t === '' || t.startsWith('#')) { i += 1; continue; }
        const jm = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
        if (jm) {
          job = { id: jm[1], name: null, if: null, needs: null, permissions: null, timeout: null, steps: [] };
          wf.jobs.set(job.id, job);
          section = null; step = null; i += 1; continue;
        }
        if (job === null) { wf.problems.push(`unparsed line under jobs: ${t}`); i += 1; continue; }
        if (ind === 4) {
          const km = /^([A-Za-z_-]+):\s*(.*)$/.exec(t);
          if (!km) { wf.problems.push(`${job.id}: unparsed line: ${t}`); i += 1; continue; }
          const [, key, rest] = km;
          section = key; step = null;
          if (key === 'name' || key === 'if') {
            const s = scalarAt(lines, i, rest);
            job[key] = unquote(s.text); i = s.next; continue;
          }
          if (key === 'needs') {
            job.needs = rest.startsWith('[') ? rest.replace(/[[\]]/g, '').split(',').map((x) => x.trim()).filter(Boolean) : [rest.trim()];
          }
          if (key === 'permissions') job.permissions = rest.trim() === '' ? {} : rest.trim();
          if (key === 'timeout-minutes') job.timeout = rest.replace(/\s+#.*$/, '').trim();
          i += 1; continue;
        }
        if (section === 'permissions' && ind === 6 && typeof job.permissions === 'object') {
          const pm = /^([a-z-]+):\s*(\S+)\s*(#.*)?$/.exec(t);
          if (pm) job.permissions[pm[1]] = pm[2];
          else wf.problems.push(`${job.id}: unparsed permission: ${t}`);
          i += 1; continue;
        }
        if (section === 'steps') {
          let body = null;
          if (ind === 6 && t.startsWith('- ')) {
            step = { name: null, id: null, if: null, run: '', env: {} };
            job.steps.push(step);
            body = t.slice(2);
          } else if (ind === 8 && step) body = t;
          if (body !== null) {
            const km = /^([A-Za-z_-]+):\s*(.*)$/.exec(body);
            if (km && ['name', 'id', 'if', 'run'].includes(km[1])) {
              const s = scalarAt(lines, i, km[2]);
              step[km[1]] = km[1] === 'run' ? s.text : unquote(s.text);
              i = s.next; continue;
            }
            if (km && km[1] === 'env') {
              i += 1;
              for (; i < lines.length && indentOf(lines[i]) >= 10; i += 1) {
                const em = /^([A-Z_]+):\s*(.*)$/.exec(lines[i].trim());
                if (em) step.env[em[1]] = em[2];
              }
              continue;
            }
          }
        }
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return wf;
}

/** Display name of a job (check-run name) for one event; null = not understood. */
export function displayName(job, event) {
  if (job.name === null) return job.id;
  if (!job.name.includes('${{')) return job.name;
  if (job.name === CI_OK_NAME_EXPR) return event === 'pull_request' ? 'ci-ok' : `ci-ok (${event})`;
  return null;
}

export function checkRepo(root) {
  const findings = [];
  const add = (f) => findings.push(f);
  const wfDir = join(root, '.github/workflows');
  const workflows = new Map();
  for (const f of readdirSync(wfDir).filter((n) => /\.ya?ml$/.test(n)).sort()) {
    const text = readFileSync(join(wfDir, f), 'utf8');
    // `${ x }` (one brace) is a plain string to Actions, not an expression (O-015 push run 45628097971).
    text.split(/\r?\n/).forEach((l, n) => {
      if (/\$\{\s+[A-Za-z!]/.test(l)) add(`${f}:${String(n + 1)}: single-brace \${ … } is not an expression: ${l.trim()}`);
    });
    const wf = parseWorkflow(text);
    for (const p of wf.problems) add(`${f}: ${p}`);
    workflows.set(f, wf);
  }
  const ci = workflows.get('ci.yml');
  if (!ci) return ['ci.yml: missing'];

  // W-5: no path filters on the workflows that carry required checks.
  for (const f of ['ci.yml', 'g3-comment-guard.yml']) {
    const wf = workflows.get(f);
    if (wf && wf.onLines.some((l) => /^\s*(paths|paths-ignore)\s*:/.test(l))) add(`${f}: on: must not use paths / paths-ignore (ci-ok would never appear)`);
  }
  for (const id of REMOVED_JOBS) if (ci.jobs.has(id)) add(`ci.yml: job ${id} must not exist (merged into ci-guard)`);
  for (const id of ['ci-guard', ...HEAVY, 'taskcheck', 'ci-ok']) if (!ci.jobs.has(id)) add(`ci.yml: job ${id} missing`);

  // C6: ci-guard permissions.
  const g = ci.jobs.get('ci-guard');
  if (g) {
    const p = g.permissions;
    const okPerm = p && typeof p === 'object' && Object.keys(p).length === 2 && p.contents === 'read' && p['pull-requests'] === 'read';
    if (!okPerm) add('ci.yml: ci-guard permissions must be exactly contents: read and pull-requests: read (C6)');
    // C7: security steps run in every mode, only `!cancelled()`.
    for (const name of SECURITY_STEPS) {
      const s = g.steps.find((x) => x.name === name);
      if (!s) { add(`ci.yml: ci-guard step "${name}" missing (C7)`); continue; }
      if (s.if !== NOT_CANCELLED) add(`ci.yml: ci-guard step "${name}" must have exactly if: ${NOT_CANCELLED} (C7), got ${String(s.if)}`);
    }
    const run = (n) => g.steps.find((x) => x.name === n)?.run ?? '';
    if (!/actionlint" -color$/m.test(run('actionlint'))) add('ci.yml: actionlint step does not run actionlint -color');
    if (!run('gitleaks (full history)').includes('gitleaks" git --config .gitleaks.toml --redact --no-banner')) add('ci.yml: gitleaks step does not scan the full git history');
    if (!run('secret scanner self-test').includes('node .github/scripts/secret-selftest.mjs')) add('ci.yml: self-test step does not run secret-selftest.mjs');
    const pg = run('pushguard tests');
    const scripts = readdirSync(join(root, '.github/scripts'));
    const want = [
      ...scripts.filter((n) => n.endsWith('-test.sh')).map((n) => `bash .github/scripts/${n}`),
      ...scripts.filter((n) => n.endsWith('.test.mjs')).map((n) => `.github/scripts/${n}`),
      ...readdirSync(join(root, '.claude/hooks/pushguard')).filter((n) => n.endsWith('.test.mjs')).map((n) => `.claude/hooks/pushguard/${n}`),
      'node .github/scripts/claude-permission-check.mjs .',
      'node .github/scripts/fail-open-lint.mjs .',
      'node .github/scripts/ci-workflow-check.mjs .',
    ];
    for (const w of want) if (!pg.split('\n').some((l) => l.replace(/\s*\\$/, '').trim() === w)) add(`ci.yml: pushguard tests step does not run: ${w}`);
    const mode = g.steps.find((x) => x.id === 'mode');
    if (!mode || mode.run !== 'bash .github/scripts/ci-guard-mode.sh') add('ci.yml: ci-guard mode step (id: mode) must run bash .github/scripts/ci-guard-mode.sh');
    else {
      const env = { REF_NAME: '${{ github.ref_name }}', EVENT_NAME: '${{ github.event_name }}', BEFORE_SHA: '${{ github.event.before }}', SHA: '${{ github.sha }}', REPO: '${{ github.repository }}', GH_TOKEN: '${{ github.token }}' };
      for (const [k, v] of Object.entries(env)) if (mode.env[k] !== v) add(`ci.yml: mode step env ${k} must be ${v} (C3: short ref name)`);
    }
  }
  const modeScript = readFileSync(join(root, '.github/scripts/ci-guard-mode.sh'), 'utf8');
  if (!modeScript.includes('git diff --no-renames --name-only "$BEFORE_SHA" "$SHA"')) add('ci-guard-mode.sh: changed files must come from git diff --no-renames --name-only (C1)');

  // Heavy jobs only in full mode; taskcheck also for docs + docs/tasks.
  for (const id of HEAVY) {
    const j = ci.jobs.get(id);
    if (!j) continue;
    if (JSON.stringify(j.needs) !== JSON.stringify(['ci-guard'])) add(`ci.yml: ${id} must need ci-guard`);
    if (typeof j.if !== 'string' || !j.if.startsWith(FULL_GUARD)) add(`ci.yml: ${id} if must start with ${FULL_GUARD.trim()}`);
  }
  const tc = ci.jobs.get('taskcheck');
  if (tc) {
    // O-025: taskcheck needs e2e to download Playwright JSON, but must still
    // run when e2e is skipped or failed (a skipped needed job would otherwise
    // skip taskcheck; a failed e2e must not hide a missing JSON).
    if (JSON.stringify(tc.needs) !== JSON.stringify(['ci-guard', 'e2e'])) add('ci.yml: taskcheck must need ci-guard and e2e');
    if (typeof tc.if !== 'string' || !tc.if.includes(FULL_GUARD.trim()) || !tc.if.includes(DOCS_TASKS)) add('ci.yml: taskcheck if must allow full mode and docs mode with tasks_changed only');
    if (typeof tc.if !== 'string' || !tc.if.includes("needs.e2e.result == 'success'") || !tc.if.includes("needs.e2e.result == 'failure'") || !tc.if.includes("needs.e2e.result == 'skipped'")) add('ci.yml: taskcheck if must run when e2e is success, failure, or skipped');
  }
  const ok = ci.jobs.get('ci-ok');
  if (ok) {
    if (ok.name !== CI_OK_NAME_EXPR) add(`ci.yml: ci-ok name must be ${CI_OK_NAME_EXPR} (C4)`);
    if (JSON.stringify([...(ok.needs ?? [])].sort()) !== JSON.stringify([...CI_OK_NEEDS].sort())) add(`ci.yml: ci-ok needs must be exactly ${CI_OK_NEEDS.join(', ')}`);
    if (ok.if !== 'always()') add('ci.yml: ci-ok must be if: always()');
    const dec = ok.steps.find((x) => x.name === 'Decide');
    if (!dec || dec.env.CI_MODE !== '${{ needs.ci-guard.outputs.mode }}' || dec.run !== 'node .github/scripts/ci-ok.mjs') add('ci.yml: ci-ok Decide step must pass CI_MODE and run ci-ok.mjs');
  }

  // W-6 / C4: check-run names unique per event across all workflows; `ci-ok` only from pull_request.
  const byEvent = new Map();
  for (const [f, wf] of workflows) {
    for (const ev of wf.events) {
      for (const job of wf.jobs.values()) {
        const n = displayName(job, ev);
        if (n === null) { add(`${f}: job ${job.id} name uses an expression this check does not understand`); continue; }
        if (!byEvent.has(ev)) byEvent.set(ev, []);
        byEvent.get(ev).push({ n, where: `${f}:${job.id}` });
      }
    }
  }
  for (const [ev, list] of byEvent) {
    const seen = new Map();
    for (const { n, where } of list) {
      if (seen.has(n)) add(`event ${ev}: job name "${n}" is used by ${seen.get(n)} and ${where} (must be unique, C4)`);
      else seen.set(n, where);
    }
    const okCount = list.filter((x) => x.n === 'ci-ok').length;
    if (ev === 'pull_request' && okCount !== 1) add(`event pull_request: exactly one job must be named ci-ok (found ${String(okCount)})`);
    if (ev !== 'pull_request' && okCount !== 0) add(`event ${ev}: no job may be named ci-ok (C4: only the pull_request run produces the required check)`);
  }
  if (!byEvent.has('pull_request')) add('no workflow runs on pull_request');

  // O-016 CL-1: every job of every workflow has timeout-minutes, an integer 1..60
  // (GitHub's default is 360 minutes; a hung job bills all of it).
  for (const [f, wf] of workflows) {
    for (const job of wf.jobs.values()) {
      const t = job.timeout;
      if (t === null) { add(`${f}: job ${job.id} has no timeout-minutes (CL-1)`); continue; }
      if (!/^[0-9]+$/.test(t) || Number(t) < 1 || Number(t) > TIMEOUT_MAX) add(`${f}: job ${job.id} timeout-minutes must be an integer 1..${String(TIMEOUT_MAX)} (CL-1), got ${t}`);
    }
    // CL-2: top-level concurrency with a group.
    const c = wf.concurrency;
    if (c === null) add(`${f}: no top-level concurrency (CL-2)`);
    else if (c.inline !== '') add(`${f}: concurrency must be a block with group: (CL-2), got inline ${c.inline}`);
    else if (!c.group) add(`${f}: concurrency has no group (CL-2)`);
  }
  // CL-3: job count per workflow <= .github/ci-budget.json (every workflow listed, nothing stale).
  let budget = null;
  try {
    budget = JSON.parse(readFileSync(join(root, BUDGET_FILE), 'utf8'));
  } catch (e) {
    add(`${BUDGET_FILE}: cannot read or parse (CL-3): ${e instanceof Error ? e.message : String(e)}`);
  }
  if (budget !== null) {
    const max = budget && typeof budget === 'object' ? budget.max_jobs : undefined;
    if (!max || typeof max !== 'object' || Array.isArray(max)) add(`${BUDGET_FILE}: must be { "max_jobs": { "<workflow file>": <n> } } (CL-3)`);
    else {
      for (const [f, wf] of workflows) {
        const n = max[f];
        if (n === undefined) { add(`${BUDGET_FILE}: workflow ${f} is not listed (CL-3)`); continue; }
        if (!Number.isInteger(n) || n < 1) { add(`${BUDGET_FILE}: ${f} limit must be a positive integer (CL-3), got ${JSON.stringify(n)}`); continue; }
        if (wf.jobs.size > n) add(`${f}: ${String(wf.jobs.size)} jobs exceed the budget of ${String(n)} in ${BUDGET_FILE} (CL-3)`);
      }
      for (const f of Object.keys(max)) if (!workflows.has(f)) add(`${BUDGET_FILE}: ${f} is not a workflow (stale entry, CL-3)`);
    }
  }

  // O-016 (retro M5): --no-renames on every git diff of taskcheck.sh / run-task-post-check.sh.
  for (const [rel, want] of Object.entries(NO_RENAMES_SCRIPTS)) {
    let text;
    try { text = readFileSync(join(root, rel), 'utf8'); } catch { add(`${rel}: missing`); continue; }
    const diffs = text.split(/\r?\n/).map((l, n) => ({ l, n: n + 1 })).filter(({ l }) => !/^\s*#/.test(l) && /\bgit diff\b/.test(l));
    if (diffs.length !== want) add(`${rel}: expected ${String(want)} git diff call(s), found ${String(diffs.length)} (update NO_RENAMES_SCRIPTS with the new call)`);
    for (const { l, n } of diffs) if (!l.includes('git diff --no-renames ')) add(`${rel}:${String(n)}: git diff without --no-renames (a rename would hide the old path)`);
  }

  // O-016: the PR-description step (pr-body-lint on the CURRENT description) runs on pull_request only.
  const guard = ci.jobs.get('ci-guard');
  if (guard) {
    const s = guard.steps.find((x) => x.name === PR_BODY_STEP);
    if (!s) add(`ci.yml: ci-guard step "${PR_BODY_STEP}" missing (O-016)`);
    else {
      if (s.if !== PR_BODY_IF) add(`ci.yml: "${PR_BODY_STEP}" must have exactly if: ${PR_BODY_IF}, got ${String(s.if)}`);
      if (s.run !== 'bash .github/scripts/pr-body-check.sh') add(`ci.yml: "${PR_BODY_STEP}" must run bash .github/scripts/pr-body-check.sh`);
      for (const [k, v] of Object.entries(PR_BODY_ENV)) if (s.env[k] !== v) add(`ci.yml: "${PR_BODY_STEP}" env ${k} must be ${v}`);
    }
  }
  const prOn = [];
  let inPr = false;
  for (const l of ci.onLines) {
    if (/^ {2}[A-Za-z_]+:/.test(l)) inPr = /^ {2}pull_request:/.test(l);
    else if (inPr) prOn.push(l);
  }
  if (prOn.some((l) => /\btypes\s*:/.test(l))) add('ci.yml: pull_request must keep the default types (no edited: a description edit would re-run all of CI)');
  return findings;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (!root || process.argv.length !== 3) {
    console.error('usage: ci-workflow-check.mjs <repo root>');
    process.exit(1);
  }
  const f = checkRepo(root);
  if (f.length > 0) {
    for (const x of f) console.error(`ci-workflow-check: FAIL ${x}`);
    process.exit(1);
  }
  console.log('ci-workflow-check: OK');
}
