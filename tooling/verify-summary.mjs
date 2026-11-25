// 自動驗證摘要（O-009）：數字一律由輸入計算，輸出 Markdown。fail-closed。
import { baseTaskId, failure, isMain, mutantsPathFor, parseArgs, readText, runCli, usageFailure } from './task-file.mjs';

const TOOL = 'verify-summary';
const STATUSES = ['killed', 'survived', 'unexpected'];

function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isMutantsReport(m) {
  return (
    isRecord(m) &&
    typeof m.task === 'string' &&
    Number.isInteger(m.total) &&
    Number.isInteger(m.killed) &&
    Array.isArray(m.survived) &&
    m.survived.every((s) => typeof s === 'string') &&
    Array.isArray(m.results) &&
    m.results.every(
      (r) =>
        isRecord(r) &&
        typeof r.id === 'string' &&
        STATUSES.includes(r.status) &&
        Array.isArray(r.failedTests) &&
        r.failedTests.every((t) => typeof t === 'string'),
    )
  );
}

// 回傳錯誤訊息或 null。
export function validateSummaryInput(o) {
  if (typeof o.task !== 'string' || o.task === '') return 'task 不可為空';
  if (typeof o.sha !== 'string' || !/^[0-9a-fA-F]{7,40}$/.test(o.sha)) return 'sha 必須是 7～40 位十六進位';
  if (!isRecord(o.vitest) || !Array.isArray(o.vitest.testResults)) return 'Vitest JSON 缺少 testResults 陣列';
  for (const tr of o.vitest.testResults) {
    if (!isRecord(tr) || !Array.isArray(tr.assertionResults)) return 'testResults[] 缺少 assertionResults 陣列';
    if (!tr.assertionResults.every((a) => isRecord(a) && typeof a.status === 'string')) return 'assertionResults[] 缺少 status';
  }
  if (!Array.isArray(o.changed) || !o.changed.every((c) => typeof c === 'string')) return 'changed 必須是字串陣列';
  if (o.execution !== undefined) {
    if (!Array.isArray(o.execution)) return 'execution 不是陣列';
    const results = o.execution.filter((e) => isRecord(e) && e.type === 'result');
    if (results.length === 0) return 'execution 沒有 result 事件';
    for (const e of results) {
      if (e.permission_denials !== undefined && !Array.isArray(e.permission_denials)) return 'permission_denials 不是陣列';
    }
  }
  if (o.mutants !== undefined && !isMutantsReport(o.mutants)) return 'mutants 不符 MutantsReport';
  return null;
}

function testSection(vitest) {
  let files = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const tr of vitest.testResults) {
    files += 1;
    for (const a of tr.assertionResults) {
      if (a.status === 'passed') passed += 1;
      else if (a.status === 'failed') failed += 1;
      else if (a.status === 'pending' || a.status === 'todo' || a.status === 'skipped') skipped += 1;
    }
  }
  return [
    '### 測試',
    `- 測試檔：${String(files)}`,
    `- passed：${String(passed)}`,
    `- failed：${String(failed)}`,
    `- skipped：${String(skipped)}`,
    failed > 0 ? '結果：失敗' : '結果：通過',
  ];
}

function mutantSection(task, mutants) {
  const out = ['### 突變'];
  if (mutants === undefined) {
    out.push(`未執行（沒有 ${mutantsPathFor(task) ?? `docs/qa/mutants/${task}.json`}）`);
    return out;
  }
  out.push(`- killed／total：${String(mutants.killed)}／${String(mutants.total)}`);
  for (const r of mutants.results) {
    if (r.status !== 'killed') out.push(`- ${r.id}：${r.status}`);
  }
  return out;
}

function deniedSection(execution) {
  const out = ['### 權限被拒'];
  if (execution === undefined) {
    out.push('不適用（未提供 execution 紀錄）');
    return out;
  }
  const denials = execution
    .filter((e) => isRecord(e) && e.type === 'result')
    .flatMap((e) => (Array.isArray(e.permission_denials) ? e.permission_denials : []));
  out.push(`- 次數：${String(denials.length)}`);
  for (const d of denials) {
    const name = isRecord(d) && typeof d.tool_name === 'string' ? d.tool_name : '-';
    const cmd = isRecord(d) && isRecord(d.tool_input) && typeof d.tool_input.command === 'string' ? d.tool_input.command : '-';
    out.push(`- \`${name}\`：\`${cmd.replace(/\r?\n/g, ' ')}\``);
  }
  return out;
}

export function renderSummary(o) {
  const changed = o.changed.map((c) => c.trim()).filter((c) => c !== '');
  const lines = [
    `## 自動驗證摘要（${o.task} @ ${o.sha.slice(0, 7)}）`,
    '',
    ...testSection(o.vitest),
    '',
    ...mutantSection(o.task, o.mutants),
    '',
    ...deniedSection(o.execution),
    '',
    '### 變更檔案',
    `- 數量：${String(changed.length)}`,
    ...changed.map((c) => `- \`${c}\``),
  ];
  return `${lines.join('\n')}\n`;
}

function readJson(path) {
  const raw = readText(path);
  if (!raw.ok) return { error: raw.message };
  try {
    return { json: JSON.parse(raw.text) };
  } catch (e) {
    return { error: `JSON 無法解析 ${path}：${e instanceof Error ? e.message : String(e)}` };
  }
}

export function run(argv) {
  const args = parseArgs(argv, { options: ['task', 'sha', 'vitest', 'changed', 'execution', 'mutants'], positional: false });
  if (!args.ok) return usageFailure(TOOL, 'USAGE', args.message);
  const v = args.values;
  if (v.task === undefined || v.sha === undefined || v.vitest === undefined || v.changed === undefined) {
    return usageFailure(
      TOOL,
      'USAGE',
      'usage: verify-summary.mjs --task <id> --sha <sha> --vitest <json> --changed <list.txt> [--execution <json>] [--mutants <report.json>]',
    );
  }
  if (baseTaskId(v.task) === null) return usageFailure(TOOL, 'USAGE', `--task ${v.task} 不是合格的任務編號`);
  const vitest = readJson(v.vitest);
  if (vitest.error !== undefined) return usageFailure(TOOL, 'INPUT', vitest.error);
  const changed = readText(v.changed);
  if (!changed.ok) return usageFailure(TOOL, 'INPUT', changed.message);
  const input = { task: v.task, sha: v.sha, vitest: vitest.json, changed: changed.text.split(/\r?\n/) };
  if (v.execution !== undefined) {
    const e = readJson(v.execution);
    if (e.error !== undefined) return usageFailure(TOOL, 'INPUT', e.error);
    input.execution = e.json;
  }
  if (v.mutants !== undefined) {
    const m = readJson(v.mutants);
    if (m.error !== undefined) return usageFailure(TOOL, 'INPUT', m.error);
    input.mutants = m.json;
  }
  const problem = validateSummaryInput(input);
  if (problem !== null) return failure(TOOL, [{ file: '-', line: 0, rule: 'INPUT', message: problem }]);
  return { code: 0, stdout: renderSummary(input), stderr: '' };
}

if (isMain(import.meta.url)) runCli(TOOL, run);
