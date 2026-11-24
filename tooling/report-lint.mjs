// 報告檢查（O-009）：docs/reports/<編號>.md 的格式、長度、不貼測試輸出、不手打數字。fail-closed。
import { basename } from 'node:path';
import { failure, isMain, parseArgs, readText, runCli, splitLines, success, usageFailure } from './task-file.mjs';

const TOOL = 'report-lint';

const MAX_LINES = 80;
const SECTIONS = ['## 完成摘要', '## 未完成事項', '## 需要人類決定的問題', '## 權限被拒'];
const DENIED = '## 權限被拒';

const PASTE_RES = [
  /^\s*(?:Test Files|Tests|Start at|Duration) {2,}/,
  /^\s*[✓✗×❯]\s/u,
  /passed \(\d+\)/,
  /^\s*Files=\d+, Tests=\d+/,
  /^\s*Result: (?:PASS|FAIL)/,
];
const NUMBER_RE = /(?<![-A-Za-z0-9.])\d+\s*[個項支]?\s*(?:(?:tests?|passed|failed|skipped|mutants?)(?![A-Za-z])|測試|突變)/i;

export function lintReport({ id, path, text }) {
  const lines = splitLines(text);
  const findings = [];
  const add = (line, rule, message) => findings.push({ file: path, line, rule, message });

  if ((lines[0] ?? '') !== `# ${id} 報告`) add(1, 'RL-TITLE', `第 1 行必須是「# ${id} 報告」`);
  for (const s of SECTIONS) {
    if (!lines.some((l) => l.startsWith(s))) add(1, 'RL-SECTION', `缺少「${s}」`);
  }
  if (lines.length > MAX_LINES) add(MAX_LINES + 1, 'RL-LINES', `全文 ${String(lines.length)} 行，超過 ${String(MAX_LINES)} 行`);

  let inDenied = false;
  lines.forEach((l, i) => {
    if (l.startsWith('## ')) inDenied = l.startsWith(DENIED);
    if (PASTE_RES.some((re) => re.test(l))) add(i + 1, 'RL-PASTE', '疑似貼上的測試輸出；測試結果以 CI 與自動驗證摘要為準');
    if (!inDenied && NUMBER_RE.test(l)) add(i + 1, 'RL-NUMBER', '疑似手打的測試或突變數字；數字以自動驗證摘要為準');
  });
  return findings;
}

export function run(argv) {
  const args = parseArgs(argv, { options: [], positional: true });
  if (!args.ok) return usageFailure(TOOL, 'USAGE', args.message);
  if (args.positionals.length === 0) return usageFailure(TOOL, 'USAGE', 'usage: report-lint.mjs <report.md> [<report.md> ...]');
  const findings = [];
  for (const path of args.positionals) {
    const raw = readText(path);
    if (!raw.ok) return usageFailure(TOOL, 'INPUT', raw.message);
    findings.push(...lintReport({ id: basename(path, '.md'), path, text: raw.text }));
  }
  return findings.length > 0 ? failure(TOOL, findings) : success(TOOL, args.positionals);
}

if (isMain(import.meta.url)) runCli(TOOL, run);
