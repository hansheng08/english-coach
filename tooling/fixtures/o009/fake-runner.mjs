// 假執行器（O-009 測試用）：依 scenario 規則決定結果。用法：node fake-runner.mjs <report> <scenario.json>
// 規則：{ file, contains, exit?, failed?, report?: 'none'|'bad', hang?, touch?: { file, content } }
// 工作目錄的 `file` 含有 `contains` 的第一條規則生效；沒有規則生效＝全部通過。
import { readFileSync, writeFileSync } from 'node:fs';

const [reportPath, scenarioPath] = process.argv.slice(2);
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
const rule = scenario.rules.find((r) => readFileSync(r.file, 'utf8').includes(r.contains));

const writeReport = (failed) => {
  const names = failed.length > 0 ? failed : ['suite (AC-X-1) passes'];
  const assertionResults = names.map((fullName) => ({ fullName, status: failed.length > 0 ? 'failed' : 'passed' }));
  writeFileSync(reportPath, JSON.stringify({ testResults: [{ name: 'x.test.mjs', assertionResults }] }));
};

if (rule === undefined) {
  writeReport([]);
} else {
  if (rule.touch !== undefined) writeFileSync(rule.touch.file, rule.touch.content);
  if (rule.hang === true) setTimeout(() => undefined, 60_000);
  else {
    if (rule.report === 'bad') writeFileSync(reportPath, '{nope');
    else if (rule.report !== 'none') writeReport(rule.failed ?? []);
    process.exitCode = rule.exit ?? 1;
  }
}
