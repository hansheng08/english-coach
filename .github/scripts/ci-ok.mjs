// ci-ok：彙總所有 job 的結果，決定整體算不算過。只用 Node.js 內建模組。
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REQUIRED = ['detect', 'actionlint', 'pushguard', 'secrets'];
export const CONDITIONAL = ['check', 'bundle', 'db', 'e2e'];

/** @param {Record<string, {result?: string}>} needs  `toJSON(needs)` 的內容 */
export function evaluateNeeds(needs) {
  const failures = [];
  const skippedConditional = [];
  for (const name of [...REQUIRED, ...CONDITIONAL]) {
    const result = needs?.[name]?.result;
    if (result === 'success') continue;
    if (result === 'skipped') {
      if (REQUIRED.includes(name)) failures.push(`${name}: skipped (required job must run)`);
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

export function renderSummary({ ok, failures, skippedConditional }, { eventName } = {}) {
  const lines = [`## ci-ok: ${ok ? 'PASS' : 'FAIL'}`, ''];
  if (failures.length > 0) lines.push('Failed:', ...failures.map((f) => `- ${f}`), '');
  lines.push(
    skippedConditional.length > 0
      ? `Skipped (not verified): ${skippedConditional.join(', ')}`
      : 'Skipped (not verified): none',
  );
  // C4: on push runs, db is skipped by design (only runs on pull_request).
  // That must not be read as "db was verified green".
  const event = eventName ?? process.env.GITHUB_EVENT_NAME ?? '';
  if (event === 'push' && skippedConditional.includes('db')) {
    lines.push('db: 未驗證（push 事件不跑 db job；以 pull_request 的 CI 為準）');
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
  const result = evaluateNeeds(needs);
  const summary = renderSummary(result, { eventName: process.env.GITHUB_EVENT_NAME ?? '' });
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
