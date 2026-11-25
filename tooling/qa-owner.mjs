// QA 擁有檔（O-012）：命名慣例、commit 清單解析與擁有者檢查。只用 node: 與 ./；不丟例外；fail-closed。
import { matchGlob } from './task-file.mjs';

const QA_TEST_GLOBS = ['**/*.qa.test.ts', 'supabase/tests/qa_*.sql'];
export const QA_GLOBS = [...QA_TEST_GLOBS, 'docs/qa/mutants/*.json'];
export const BOT_EMAILS = [
  'claude[bot]@users.noreply.github.com',
  '209825114+claude[bot]@users.noreply.github.com',
  'noreply@anthropic.com',
  'github-actions[bot]@users.noreply.github.com',
  '41898282+github-actions[bot]@users.noreply.github.com',
];

const QA_PREFIX = '[QA] ';
const SHA_RE = /^[0-9a-f]{40}$/;

export function isQaOwned(path) {
  return typeof path === 'string' && QA_GLOBS.some((g) => matchGlob(g, path));
}

export function isQaTestFile(path) {
  return typeof path === 'string' && QA_TEST_GLOBS.some((g) => matchGlob(g, path));
}

function isBotEmail(email) {
  const e = email.trim().toLowerCase();
  return BOT_EMAILS.some((b) => b.toLowerCase() === e) || e.includes('[bot]');
}

export function isQaCommit(c) {
  return c.subject.startsWith(QA_PREFIX) && !isBotEmail(c.authorEmail) && !isBotEmail(c.committerEmail);
}

export function parseCommitLog(text, file) {
  const commits = [];
  const errors = [];
  const bad = (message) => errors.push({ file, line: 0, rule: 'SC-LOG', message });
  const records = text.replace(/\r\n/g, '\n').split('\x1e');
  const head = records.shift() ?? '';
  if (head.trim() !== '') bad('commit 清單開頭不是記錄分隔符號 (\\x1e)');
  records.forEach((rec, idx) => {
    const lines = rec.split('\n');
    const fields = (lines.shift() ?? '').split('\x1f');
    if (fields.length !== 4) {
      bad(`第 ${String(idx + 1)} 筆標頭欄數為 ${String(fields.length)}，應為 4`);
      return;
    }
    const [sha = '', authorEmail = '', committerEmail = '', subject = ''] = fields;
    if (!SHA_RE.test(sha)) {
      bad(`第 ${String(idx + 1)} 筆 sha 不是 40 位十六進位`);
      return;
    }
    const files = [];
    let ok = true;
    for (const line of lines) {
      if (line.trim() === '') continue;
      const cols = line.split('\t');
      const status = cols[0] ?? '';
      const paths = cols.slice(1).filter((p) => p !== '');
      if (!/^[A-Z]+\d*$/.test(status) || paths.length === 0) {
        bad(`${sha.slice(0, 7)} 的檔案行格式錯誤：${JSON.stringify(line)}`);
        ok = false;
        continue;
      }
      files.push({ status, paths });
    }
    if (ok) commits.push({ sha, authorEmail, committerEmail, subject, files });
  });
  return { commits, errors };
}

function prefixOf(subject) {
  return /^\[[^\]]*\]/.exec(subject)?.[0] ?? '(無前綴)';
}

export function checkQaOwnership({ changed, commits, allNonQa }) {
  const findings = [];
  const qaChanged = changed.map((c) => c.trim()).filter((c) => c !== '' && isQaOwned(c));
  if (commits === null || commits === undefined) {
    for (const p of qaChanged) {
      findings.push({ file: p, line: 0, rule: 'SC-QA-NOLOG', message: '變更含 QA 擁有檔但沒有 commit 清單（--commits），無法確認是誰改的' });
    }
    return findings;
  }
  const seen = new Set();
  for (const c of commits) {
    const nonQa = allNonQa === true || !isQaCommit(c);
    for (const f of c.files) {
      for (const p of f.paths) {
        if (!isQaOwned(p)) continue;
        seen.add(p);
        if (nonQa) {
          findings.push({
            file: p,
            line: 0,
            rule: 'SC-QA-OWNER',
            message: `${c.sha.slice(0, 7)} ${prefixOf(c.subject)} 不是 QA commit，不得變動 QA 擁有檔（${f.status}）`,
          });
        }
      }
    }
  }
  for (const p of qaChanged) {
    if (!seen.has(p)) {
      findings.push({ file: p, line: 0, rule: 'SC-QA-NOLOG', message: 'commit 清單沒有任何一筆碰到這個 QA 擁有檔，無法查證' });
    }
  }
  return findings;
}
