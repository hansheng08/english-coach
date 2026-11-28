// O-015 static workflow check (retro §3.7 C4, C6, C7; task W-5, W-6). Only node: built-ins.
// O-016 adds the CI cost lint (CL-1 timeout-minutes 1-60 on every job, CL-2 a top-level
// concurrency group on every workflow, CL-3 job count <= .github/ci-budget.json), the
// --no-renames check on the taskcheck / post-check diffs, and the PR-description step.
// O-031 adds the Supabase start freeze (checkSupabaseStart: wrapper-only starts, policy-only classification).
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
// O-029 (AC-O29-9): frozen bundle scan step.
export const BUNDLE_SCAN_STEP = 'Scan build output for key names';
export const BUNDLE_SCAN_RUN = 'node tooling/bundle-name-scan.mjs apps/web/dist';
// O-031 (AC-O31-5 / AC-O31-7): every local Supabase start in ci.yml goes through the
// retry wrapper with today's flags; the wrapper classifies only via the policy module.
export const SB_WRAPPER = '.github/scripts/supabase-start.sh';
export const SB_POLICY = 'tooling/supabase-start-policy.mjs';
export const SB_E2E_RUN = 'bash .github/scripts/supabase-start.sh -x studio,imgproxy,logflare,vector';
export const SB_TASKCHECK_RUN = 'psql --version\nbash .github/scripts/supabase-start.sh -x studio,imgproxy,logflare,vector,mailpit,realtime,postgres-meta,supavisor';
export const SB_DB_LINE = 'bash "$(dirname "${BASH_SOURCE[0]}")/supabase-start.sh" --workdir "$WORKDIR" -x "$EXCLUDES"';
export const SB_DB_EXCLUDES = 'EXCLUDES="studio,imgproxy,logflare,vector,mailpit,realtime,postgres-meta,supavisor"';
export const SB_TIMEOUTS = { taskcheck: '40', db: '20', e2e: '20' };
const SB_TASKCHECK_IF = "hashFiles('supabase/config.toml') != '' && !(github.event_name == 'push' && github.ref_name == 'main')";
// A direct start: `supabase [--workdir X] start` outside a comment / echo.
const SB_DIRECT = /(^|[\s;&|(])supabase(\s+--workdir\s+\S+)?\s+start\b/;
// Failure-text markers only the policy module may know (no shell classifier, AC-O31-7).
const SB_MARKERS = ['failed to bind host port', 'address already in use', 'port is already allocated', 'error from registry', 'rate exceeded', 'data limit exceeded', 'toomanyrequests', 'tls handshake timeout', 'unexpected eof', 'i/o timeout'];
const SETUP_CLI = /^supabase\/setup-cli@[0-9a-f]{40}$/;
// O-028 item 3: the push-superseded note (commit status; never a required check).
export const SUPERSEDE_WF = 'ci-supersede.yml';
export const SUPERSEDE_CONTEXT = 'ci-push-superseded';
const SUPERSEDE_PERMS = { contents: 'read', actions: 'read', statuses: 'write' };
const SUPERSEDE_FORK_GUARD = 'github.event.workflow_run.head_repository.full_name == github.repository';
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
            step = { name: null, id: null, if: null, uses: null, run: '', env: {}, continueOnError: null, workingDirectory: null };
            job.steps.push(step);
            body = t.slice(2);
          } else if (ind === 8 && step) body = t;
          if (body !== null) {
            const km = /^([A-Za-z_-]+):\s*(.*)$/.exec(body);
            if (km && ['name', 'id', 'if', 'run', 'uses'].includes(km[1])) {
              const s = scalarAt(lines, i, km[2]);
              step[km[1]] = km[1] === 'run' ? s.text : unquote(s.text);
              i = s.next; continue;
            }
            // O-029: the bundle scan step is frozen, so these two keys must be visible to the check.
            if (km && km[1] === 'continue-on-error') { step.continueOnError = unquote(km[2].replace(/\s+#.*$/, '')); i += 1; continue; }
            if (km && km[1] === 'working-directory') { step.workingDirectory = unquote(km[2].replace(/\s+#.*$/, '')); i += 1; continue; }
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

/** O-031 freeze (AC-O31-5, AC-O31-7, AC-O31-10; TC-15, TC-17). */
function checkSupabaseStart(root, ci, add) {
  const tag = '(O-031)';
  // AC-O31-5: no direct `supabase start` in ci.yml steps or .github/scripts shell scripts
  // (the wrapper and its test excepted; .mjs files only mention the command).
  for (const job of ci.jobs.values()) {
    for (const st of job.steps) {
      st.run.split('\n').forEach((l) => {
        if (!/^\s*(#|echo\b)/.test(l) && SB_DIRECT.test(l)) add(`ci.yml: job ${job.id} runs supabase start directly; use bash ${SB_WRAPPER} ${tag}: ${l.trim()}`);
      });
    }
  }
  const scriptsDir = join(root, '.github/scripts');
  for (const n of readdirSync(scriptsDir).filter((x) => x.endsWith('.sh')).sort()) {
    if (n === 'supabase-start.sh' || n === 'supabase-start-test.sh') continue;
    readFileSync(join(scriptsDir, n), 'utf8').split(/\r?\n/).forEach((l, k) => {
      if (!/^\s*(#|echo\b)/.test(l) && SB_DIRECT.test(l)) add(`.github/scripts/${n}:${String(k + 1)}: supabase start outside ${SB_WRAPPER} ${tag}`);
    });
  }
  // The call sites, exact and fail-closed (no continue-on-error, conditions unchanged).
  const site = (jobId, stepName, want) => {
    const j = ci.jobs.get(jobId);
    if (!j) return null;
    const st = j.steps.find((x) => x.name === stepName);
    if (!st) { add(`ci.yml: ${jobId} step "${stepName}" missing ${tag}`); return null; }
    if (st.run !== want) add(`ci.yml: ${jobId} step "${stepName}" must run exactly ${JSON.stringify(want)} ${tag}`);
    if (st.continueOnError !== null) add(`ci.yml: ${jobId} step "${stepName}" must not set continue-on-error ${tag}`);
    return st;
  };
  const e = site('e2e', 'Start local Supabase', SB_E2E_RUN);
  if (e && e.if !== null) add(`ci.yml: e2e step "Start local Supabase" must not have an if ${tag}`);
  const t = site('taskcheck', 'Start local Supabase for pnpm db:test', SB_TASKCHECK_RUN);
  if (t && t.if !== SB_TASKCHECK_IF) add(`ci.yml: taskcheck Supabase start must keep if: ${SB_TASKCHECK_IF} ${tag}`);
  // db: the wrapper runs inside db-job-verify.sh and needs node for the policy module;
  // setup-cli guarantees Node >= 20, so the verify step must come after it (TC-17).
  const db = ci.jobs.get('db');
  if (db) {
    const cli = db.steps.findIndex((x) => x.uses !== null && SETUP_CLI.test(x.uses.replace(/\s+#.*$/, '')));
    const ver = db.steps.findIndex((x) => x.run === 'bash .github/scripts/db-job-verify.sh');
    if (cli < 0) add(`ci.yml: db job must use supabase/setup-cli (pinned) ${tag}`);
    if (ver < 0) add(`ci.yml: db job must run bash .github/scripts/db-job-verify.sh ${tag}`);
    else {
      if (cli > ver) add(`ci.yml: db job must run setup-cli (provides Node for the policy module) before db-job-verify.sh ${tag}`);
      if (db.steps[ver].if !== null || db.steps[ver].continueOnError !== null) add(`ci.yml: db verify step must have no if / continue-on-error ${tag}`);
    }
  }
  const dbv = readFileSync(join(scriptsDir, 'db-job-verify.sh'), 'utf8').split(/\r?\n/);
  if (dbv.filter((l) => l.trim() === SB_DB_LINE).length !== 1) add(`db-job-verify.sh: must start Supabase exactly once via: ${SB_DB_LINE} ${tag}`);
  if (!dbv.some((l) => l.trim() === SB_DB_EXCLUDES)) add(`db-job-verify.sh: excludes must stay ${SB_DB_EXCLUDES} ${tag}`);
  for (const [id, want] of Object.entries(SB_TIMEOUTS)) {
    const j = ci.jobs.get(id);
    if (j && j.timeout !== want) add(`ci.yml: ${id} timeout-minutes must stay ${want} ${tag}`);
  }
  // AC-O31-7: the wrapper delegates classify + decide to the policy module; no shell classifier.
  let w = '';
  try { w = readFileSync(join(root, SB_WRAPPER), 'utf8'); } catch { add(`${SB_WRAPPER}: missing ${tag}`); return; }
  const code = w.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
  if (!code.includes('kind="$(node "$POLICY" classify "$log")"')) add(`${SB_WRAPPER}: must classify via node "$POLICY" classify ${tag}`);
  if (!code.includes('decision="$(node "$POLICY" decide "$attempt" "$kind" "$held")"')) add(`${SB_WRAPPER}: must decide via node "$POLICY" decide ${tag}`);
  if (!code.includes(`POLICY="\${SUPABASE_START_POLICY:-$HERE/../../${SB_POLICY}}"`)) add(`${SB_WRAPPER}: POLICY must default to ${SB_POLICY} ${tag}`);
  const low = code.toLowerCase();
  for (const m of SB_MARKERS) if (low.includes(m)) add(`${SB_WRAPPER}: contains failure marker "${m}"; classification belongs to ${SB_POLICY} only ${tag}`);
  if (!code.includes('supabase "${pre[@]}" stop --no-backup')) add(`${SB_WRAPPER}: must clean up with supabase stop --no-backup before a retry ${tag}`);
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
  // O-028: the script now has several diffs (main C1, task QA list, previous push); every one needs --no-renames.
  modeScript.split(/\r?\n/).forEach((l, n) => {
    if (!/^\s*(#|note )/.test(l) && /\bgit diff\b/.test(l) && !l.includes('git diff --no-renames ')) add(`ci-guard-mode.sh:${String(n + 1)}: git diff without --no-renames (C1)`);
  });

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
  // O-027: e2e must invoke Playwright reporters without a literal `--`,
  // which Playwright would treat as test-file filters (no JSON written).
  const e2e = ci.jobs.get('e2e');
  if (e2e) {
    const run = e2e.steps.find((x) => x.name === 'Run e2e (fake providers)')?.run ?? '';
    const want = 'pnpm e2e --reporter=list --reporter=json';
    if (run !== want) add(`ci.yml: e2e step must run exactly ${want} (no -- between e2e and --reporter)`);
  }
  // O-029 (AC-O29-9): the bundle job scans the build output for key names right after Build,
  // before the gitleaks value scan. Fail-closed: no `if`, no continue-on-error, exact command.
  const bundle = ci.jobs.get('bundle');
  if (bundle) {
    const idx = (n) => bundle.steps.findIndex((x) => x.name === n);
    const scans = bundle.steps.filter((x) => x.run.includes('bundle-name-scan'));
    const scan = bundle.steps.find((x) => x.name === BUNDLE_SCAN_STEP);
    if (!scan) add(`ci.yml: bundle step "${BUNDLE_SCAN_STEP}" missing (O-029)`);
    else {
      if (scan.run !== BUNDLE_SCAN_RUN) add(`ci.yml: bundle scan step must run exactly ${BUNDLE_SCAN_RUN} (O-029)`);
      if (scan.continueOnError !== null) add('ci.yml: bundle scan step must not set continue-on-error (O-029)');
      if (scan.if !== null) add('ci.yml: bundle scan step must not have an if (O-029)');
      if (scan.workingDirectory !== null) add('ci.yml: bundle scan step must not set working-directory (O-029)');
      if (idx('Build') < 0 || idx(BUNDLE_SCAN_STEP) < idx('Build')) add('ci.yml: bundle scan step must come after the Build step (O-029)');
      if (idx('Scan build output') < 0 || idx(BUNDLE_SCAN_STEP) > idx('Scan build output')) add('ci.yml: bundle scan step must come before the gitleaks "Scan build output" step (O-029)');
    }
    if (scans.length !== 1) add(`ci.yml: bundle must have exactly one step running bundle-name-scan, found ${String(scans.length)} (O-029)`);
    if (bundle.timeout !== '10') add('ci.yml: bundle timeout-minutes must stay 10 (O-029)');
  }
  checkSupabaseStart(root, ci, add);
  const ok = ci.jobs.get('ci-ok');
  if (ok) {
    if (ok.name !== CI_OK_NAME_EXPR) add(`ci.yml: ci-ok name must be ${CI_OK_NAME_EXPR} (C4)`);
    if (JSON.stringify([...(ok.needs ?? [])].sort()) !== JSON.stringify([...CI_OK_NEEDS].sort())) add(`ci.yml: ci-ok needs must be exactly ${CI_OK_NEEDS.join(', ')}`);
    if (ok.if !== 'always()') add('ci.yml: ci-ok must be if: always()');
    const dec = ok.steps.find((x) => x.name === 'Decide');
    if (!dec || dec.env.CI_MODE !== '${{ needs.ci-guard.outputs.mode }}' || dec.run !== 'node .github/scripts/ci-ok.mjs') add('ci.yml: ci-ok Decide step must pass CI_MODE and run ci-ok.mjs');
    // O-028: ci-ok must know why light was chosen (tests-only-no-pr has no PR number).
    if (!dec || dec.env.MODE_REASON !== '${{ needs.ci-guard.outputs.mode_reason }}') add('ci.yml: ci-ok Decide step must pass MODE_REASON: ${{ needs.ci-guard.outputs.mode_reason }} (O-028)');
  }
  const ciText = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  if (!ciText.includes('      mode_reason: ${{ steps.mode.outputs.mode_reason }}')) add('ci.yml: ci-guard must output mode_reason from the mode step (O-028)');

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
        if (f === 'ci.yml' && n !== 7) add(`ci.yml: budget must stay 7 jobs in ${BUDGET_FILE} (O-031), got ${String(n)}`);
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

  // O-028 (AC-O28-9): ci-supersede.yml runs on workflow_run with a write token from
  // the default branch, so freeze: trigger, minimal permissions, fork guard, no PR
  // checkout (`ref:`), persist-credentials: false, no secrets, and a context name
  // that cannot be mistaken for the required ci-ok.
  const sw = workflows.get(SUPERSEDE_WF);
  if (!sw) add(`${SUPERSEDE_WF}: missing (O-028)`);
  else {
    const text = readFileSync(join(wfDir, SUPERSEDE_WF), 'utf8');
    const tag = `${SUPERSEDE_WF} (O-028)`;
    if (JSON.stringify(sw.events) !== JSON.stringify(['workflow_run'])) add(`${tag}: on: must be exactly workflow_run`);
    if (!sw.onLines.some((l) => l.trim() === 'workflows: [ci]') || !sw.onLines.some((l) => l.trim() === 'types: [completed]')) add(`${tag}: workflow_run must be workflows: [ci], types: [completed]`);
    if (!/^permissions: \{\}\s*$/m.test(text)) add(`${tag}: top-level permissions must be {}`);
    if (sw.jobs.size !== 1) add(`${tag}: exactly one job`);
    for (const job of sw.jobs.values()) {
      const p = job.permissions;
      const okPerm = p && typeof p === 'object' && Object.keys(p).length === Object.keys(SUPERSEDE_PERMS).length
        && Object.entries(SUPERSEDE_PERMS).every(([k, v]) => p[k] === v);
      if (!okPerm) add(`${tag}: job ${job.id} permissions must be exactly contents: read, actions: read, statuses: write`);
      if (typeof job.if !== 'string' || !job.if.startsWith(`${SUPERSEDE_FORK_GUARD} &&`)) add(`${tag}: job ${job.id} if must start with ${SUPERSEDE_FORK_GUARD} && (skip forks)`);
      const runs = job.steps.filter((x) => x.run !== '').map((x) => x.run);
      if (JSON.stringify(runs) !== JSON.stringify(['bash .github/scripts/ci-supersede.sh'])) add(`${tag}: job ${job.id} must only run bash .github/scripts/ci-supersede.sh`);
    }
    const lines = text.split(/\r?\n/);
    lines.forEach((l, n) => {
      if (/^\s+ref\s*:/.test(l)) add(`${tag}:${String(n + 1)}: no ref: (never check out the PR head with a write token)`);
      if (/secrets\./.test(l)) add(`${tag}:${String(n + 1)}: no secrets`);
      if (/pull_request_target/.test(l)) add(`${tag}:${String(n + 1)}: no pull_request_target`);
      if (/actions\/checkout@/.test(l)) {
        const block = lines.slice(n + 1, n + 4).join('\n');
        if (!/^\s+persist-credentials: false\s*$/m.test(block)) add(`${tag}:${String(n + 1)}: checkout must set persist-credentials: false`);
      }
    });
  }
  let sup = '';
  try { sup = readFileSync(join(root, '.github/scripts/ci-supersede.sh'), 'utf8'); } catch { add('.github/scripts/ci-supersede.sh: missing (O-028)'); }
  if (sup !== '') {
    const m = /^CONTEXT="([^"]*)"$/m.exec(sup);
    if (!m || m[1] !== SUPERSEDE_CONTEXT) add(`ci-supersede.sh: CONTEXT must be exactly "${SUPERSEDE_CONTEXT}" (O-028)`);
    if (m && /^ci-ok/i.test(m[1])) add('ci-supersede.sh: status context must not start with ci-ok (would look like the required check)');
  }
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
