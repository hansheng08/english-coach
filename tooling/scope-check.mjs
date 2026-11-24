// 分支變更範圍檢查（O-008）：變更檔只能落在任務單「檔案範圍」。fail-closed。
import {
  failure,
  isMain,
  loadTasks,
  matchGlob,
  parseArgs,
  readText,
  runCli,
  success,
  tasksForBranch,
  usageFailure,
} from './task-file.mjs';

const TOOL = 'scope-check';

export function checkScope({ branch, tasks, changed }) {
  const set = tasksForBranch(branch, tasks);
  if (set.length === 0) return [{ file: branch, line: 0, rule: 'SC-NOTASK', message: `找不到分支 ${branch} 對應的任務單` }];

  const parseFindings = set
    .filter((x) => !x.parsed.hasDo)
    .map((x) => ({ file: x.task.path, line: 1, rule: 'SC-PARSE', message: '任務單缺少「### 要做」，無法判斷檔案範圍' }));
  if (parseFindings.length > 0) return parseFindings;

  const files = changed.map((c) => c.trim()).filter((c) => c !== '');
  if (files.length === 0) return [{ file: branch, line: 0, rule: 'SC-EMPTY', message: '變更清單為空' }];

  const allow = [];
  const deny = [];
  for (const x of set) {
    allow.push(...x.parsed.allow, `docs/reports/${x.task.id}.md`, `docs/qa/mutants/${x.task.id}.json`);
    deny.push(...x.parsed.deny);
  }

  const findings = [];
  files.forEach((f, i) => {
    const denied = deny.find((p) => matchGlob(p, f));
    if (denied !== undefined) {
      findings.push({ file: f, line: i + 1, rule: 'SC-DENY', message: `符合範圍外 ${denied}` });
    } else if (!allow.some((p) => matchGlob(p, f))) {
      findings.push({ file: f, line: i + 1, rule: 'SC-OUT', message: '不在任務單允許的檔案範圍內' });
    }
  });
  return findings;
}

export function run(argv) {
  const args = parseArgs(argv, { options: ['branch', 'changed', 'tasks-dir'], positional: false });
  if (!args.ok) return usageFailure(TOOL, 'USAGE', args.message);
  const { branch, changed } = args.values;
  if (branch === undefined || changed === undefined) {
    return usageFailure(TOOL, 'USAGE', 'usage: scope-check.mjs --branch <name> --changed <file-list.txt> [--tasks-dir <dir>]');
  }
  const list = readText(changed);
  if (!list.ok) return usageFailure(TOOL, 'INPUT', list.message);
  const loaded = loadTasks(args.values['tasks-dir'] ?? 'docs/tasks');
  if (!loaded.ok) return usageFailure(TOOL, 'INPUT', loaded.message);
  const findings = checkScope({ branch, tasks: loaded.tasks, changed: list.text.split(/\r?\n/) });
  return findings.length > 0 ? failure(TOOL, findings) : success(TOOL, [branch]);
}

if (isMain(import.meta.url)) runCli(TOOL, run);
