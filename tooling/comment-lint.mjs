// G3 PR 留言違規檢查（O-009）：只看開頭文字分角色。fail-closed。
import { failure, isMain, parseArgs, readText, runCli, usageFailure } from './task-file.mjs';

const TOOL = 'comment-lint';

const LEADING_RE = /^[\s#*_>`~【[「]+/;
const TECHLEAD_RE = /^techlead\s*review/i;
const QA_RE = /^QA(?![A-Za-z])/;
const LOCAL_MARKERS = ['本機', '重跑', 'box', 'worktree', 'locally', 'rerun', 're-run'];
const COMMANDS = ['pnpm check', 'pnpm db:test', 'pg_prove', 'supabase test db'];

function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function lintComments(comments) {
  if (!Array.isArray(comments)) return [{ file: '-', line: 0, rule: 'INPUT', message: '輸入不是陣列' }];
  for (const [i, c] of comments.entries()) {
    if (!isRecord(c) || (typeof c.id !== 'number' && typeof c.id !== 'string')) {
      return [{ file: '-', line: 0, rule: 'INPUT', message: `第 ${String(i)} 筆留言缺少 id` }];
    }
    if (typeof c.body !== 'string' && c.body !== null) {
      return [{ file: '-', line: 0, rule: 'INPUT', message: `第 ${String(i)} 筆留言的 body 不是字串或 null` }];
    }
  }
  const findings = [];
  for (const c of comments) {
    const body = c.body ?? '';
    const file = `comment/${String(c.id)}`;
    const head = body.replace(LEADING_RE, '');
    if (TECHLEAD_RE.test(head)) {
      findings.push({ file, line: 1, rule: 'CM-TECHLEAD', message: 'G3 PR 上不得出現 TechLead Review 留言（驗收結論只留在 PR 的指定位置）' });
    }
    if (QA_RE.test(head)) {
      const hit = body.split(/\r?\n/).some((line) => {
        const l = line.toLowerCase();
        return LOCAL_MARKERS.some((m) => l.includes(m)) && COMMANDS.some((cmd) => l.includes(cmd));
      });
      if (hit) findings.push({ file, line: 1, rule: 'CM-QA-RERUN', message: 'QA 留言提到在本機重跑指令；只能引用 CI run' });
    }
  }
  return findings;
}

export function run(argv) {
  const args = parseArgs(argv, { options: ['comments'], positional: false });
  if (!args.ok) return usageFailure(TOOL, 'USAGE', args.message);
  const { comments } = args.values;
  if (comments === undefined) return usageFailure(TOOL, 'USAGE', 'usage: comment-lint.mjs --comments <comments.json>');
  const raw = readText(comments);
  if (!raw.ok) return usageFailure(TOOL, 'INPUT', raw.message);
  let json;
  try {
    json = JSON.parse(raw.text);
  } catch (e) {
    return usageFailure(TOOL, 'INPUT', `JSON 無法解析：${e instanceof Error ? e.message : String(e)}`);
  }
  const findings = lintComments(json);
  if (findings.length > 0) return failure(TOOL, findings);
  return { code: 0, stdout: `${TOOL}: OK ${String(json.length)} comment(s)\n`, stderr: '' };
}

if (isMain(import.meta.url)) runCli(TOOL, run);
