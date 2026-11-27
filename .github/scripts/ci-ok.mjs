// ci-ok：彙總所有 job 的結果，決定整體算不算過。只用 Node.js 內建模組。
// O-015：4 個小 job 併成 ci-guard；依 ci-guard 決定的模式（full／docs／light）
// 檢查「這個模式該跑的 job」一定是 success（retro §3.7 C5），不再把 skipped 一律當通過。
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REQUIRED = ['ci-guard'];
export const CONDITIONAL = ['check', 'bundle', 'db', 'e2e', 'taskcheck'];
const MODES = ['full', 'docs', 'light'];
const EVENTS = ['push', 'pull_request', 'workflow_dispatch'];
const FLAG_KEYS = ['hasNode', 'hasWeb', 'hasSupabase', 'hasE2e', 'tasksChanged'];
const isBranch = (r) => typeof r === 'string' && (r.startsWith('task/') || r.startsWith('fix/'));

/** 讀 env 的原始字串，轉成 ctx；格式不對的欄位保留原值，由 validateContext 判失敗。 */
export function contextFromEnv(env) {
  const flag = (v) => (v === 'true' ? true : v === 'false' ? false : v);
  return {
    mode: env.CI_MODE,
    event: env.EVENT_NAME ?? env.GITHUB_EVENT_NAME,
    refName: env.REF_NAME,
    headRef: env.HEAD_REF ?? '',
    prNumber: env.PR_NUMBER ?? '',
    modeReason: env.MODE_REASON ?? '',
    hasNode: flag(env.HAS_NODE),
    hasWeb: flag(env.HAS_WEB),
    hasSupabase: flag(env.HAS_SUPABASE),
    hasE2e: flag(env.HAS_E2E),
    tasksChanged: flag(env.TASKS_CHANGED),
  };
}

export function validateContext(ctx) {
  const problems = [];
  if (ctx === null || typeof ctx !== 'object') return ['context: missing'];
  if (!MODES.includes(ctx.mode)) problems.push(`mode: ${String(ctx.mode)} (must be full, docs or light)`);
  if (!EVENTS.includes(ctx.event)) problems.push(`event: ${String(ctx.event)}`);
  if (typeof ctx.refName !== 'string' || ctx.refName === '') problems.push('ref: missing');
  for (const k of FLAG_KEYS) if (typeof ctx[k] !== 'boolean') problems.push(`${k}: ${String(ctx[k])} (must be true or false)`);
  if (problems.length > 0) return problems;
  if (ctx.event !== 'push' && ctx.mode !== 'full') problems.push(`mode ${ctx.mode} on ${ctx.event} (only push may skip; ${ctx.event} must be full)`);
  if (ctx.mode === 'docs' && ctx.refName !== 'main') problems.push(`mode docs on ref ${ctx.refName} (docs mode is main only)`);
  if (ctx.mode === 'light') {
    if (!isBranch(ctx.refName)) problems.push(`mode light on ref ${ctx.refName} (light is task/** and fix/** only)`);
    // O-028: light has two reasons. tests-only-no-pr = task/** push that only touches QA files and has
    // no PR yet (PR number must be empty); branch-with-open-pr needs the PR number. Anything else fails.
    if (ctx.modeReason === 'tests-only-no-pr') {
      if (!String(ctx.refName).startsWith('task/')) problems.push(`light tests-only-no-pr on ref ${ctx.refName} (task/** only)`);
      if (ctx.prNumber !== '') problems.push(`light tests-only-no-pr with a PR number (${String(ctx.prNumber)})`);
    } else if (ctx.modeReason === 'branch-with-open-pr') {
      if (!/^[1-9][0-9]*$/.test(String(ctx.prNumber))) problems.push(`mode light without a PR number (${String(ctx.prNumber)})`);
    } else {
      problems.push(`light with unknown reason ${String(ctx.modeReason)} (must be branch-with-open-pr or tests-only-no-pr)`);
    }
  }
  return problems;
}

/** 這個模式下「必須 success」的 job（和 ci.yml 各 job 的 if 一致）。 */
export function expectedJobs(ctx) {
  const full = ctx.mode === 'full';
  const pr = ctx.event === 'pull_request';
  const push = ctx.event === 'push';
  const exp = new Set();
  if (full && ctx.hasNode) exp.add('check');
  if (full && ctx.hasWeb) exp.add('bundle');
  if (full && ctx.hasSupabase && pr) exp.add('db');
  if (full && ctx.hasE2e && pr) exp.add('e2e');
  const taskRef = (push && (ctx.refName === 'main' || isBranch(ctx.refName))) || (pr && isBranch(ctx.headRef));
  if (ctx.hasNode && ((full && taskRef) || (ctx.mode === 'docs' && ctx.tasksChanged))) exp.add('taskcheck');
  return exp;
}

/**
 * @param {Record<string, {result?: string}>} needs `toJSON(needs)` 的內容
 * @param {object} ctx contextFromEnv 的結果
 */
export function evaluateNeeds(needs, ctx) {
  const failures = [];
  const skippedConditional = [];
  const ctxProblems = validateContext(ctx);
  failures.push(...ctxProblems.map((p) => `context: ${p}`));
  const expected = ctxProblems.length === 0 ? expectedJobs(ctx) : new Set();
  for (const name of [...REQUIRED, ...CONDITIONAL]) {
    const result = needs?.[name]?.result;
    if (result === 'success') continue;
    if (result === 'skipped') {
      if (REQUIRED.includes(name)) failures.push(`${name}: skipped (required job must run)`);
      else if (expected.has(name)) failures.push(`${name}: skipped (mode ${String(ctx.mode)} requires it)`);
      else skippedConditional.push(name);
      continue;
    }
    failures.push(`${name}: ${result ?? 'missing'}`);
  }
  // needs 裡出現的其他 job 也要成功或略過
  for (const [name, v] of Object.entries(needs ?? {})) {
    if (REQUIRED.includes(name) || CONDITIONAL.includes(name)) continue;
    if (v?.result !== 'success' && v?.result !== 'skipped') failures.push(`${name}: ${v?.result ?? 'missing'}`);
  }
  return { ok: failures.length === 0, failures, skippedConditional };
}

export function renderSummary({ ok, failures, skippedConditional }, ctx = {}) {
  const event = ctx.event ?? '';
  const lines = [`## ci-ok: ${ok ? 'PASS' : 'FAIL'}`, '', `Mode: ${String(ctx.mode)}（event ${event}, ref ${String(ctx.refName)}）`, ''];
  if (failures.length > 0) lines.push('Failed:', ...failures.map((f) => `- ${f}`), '');
  lines.push(
    skippedConditional.length > 0
      ? `Skipped (not verified): ${skippedConditional.join(', ')}`
      : 'Skipped (not verified): none',
  );
  if (ctx.mode === 'docs') lines.push('docs 模式：只改文件，check、bundle、e2e 依路徑略過（未驗證）；以下一個 pull_request run 為準。');
  if (ctx.mode === 'light' && ctx.modeReason === 'tests-only-no-pr') {
    lines.push('light 模式（O-028：只改測試／QA 檔、尚未開 PR）：本 push run 只跑 ci-guard，本 push run 綠燈不算數，以之後 G3 PR 的 pull_request run 為準。');
  } else if (ctx.mode === 'light') {
    lines.push(`light 模式：PR #${String(ctx.prNumber)} 的 pull_request run 為準；本 push run 只跑 ci-guard，綠燈不算數。`);
  }
  // C4 (O-004): push runs never count as green; db only runs on pull_request.
  if (event === 'push') {
    lines.push('push run：檢查名稱是 `ci-ok (push)`，不是必過的 `ci-ok`；綠燈不算數，以 pull_request run 為準。');
    if (skippedConditional.includes('db')) lines.push('db: 未驗證（push 事件不跑 db job；以 pull_request 的 CI 為準）');
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  let needs;
  try {
    needs = JSON.parse(process.env.NEEDS_JSON ?? '');
  } catch {
    console.error('ci-ok: NEEDS_JSON is missing or not valid JSON');
    process.exitCode = 1;
    return;
  }
  const ctx = contextFromEnv(process.env);
  const result = evaluateNeeds(needs, ctx);
  const summary = renderSummary(result, ctx);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
