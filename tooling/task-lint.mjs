// 任務單格式檢查（O-008）。fail-closed：任何無法判斷的輸入都是失敗。
import { basename } from 'node:path';
import {
  acPrefix,
  failure,
  findSection,
  isMain,
  parseArgs,
  parseTaskFile,
  readText,
  runCli,
  scanFences,
  splitLines,
  success,
  usageFailure,
} from './task-file.mjs';

const TOOL = 'task-lint';
const REQUIRED_SECTIONS = ['分支', '背景', '目標', '介面', '驗收標準', '測試案例', '檔案範圍', '限制', '驗證方式', '結束時'];
const SQL_LANGS = new Set(['sql', 'pgsql', 'plpgsql', 'psql']);
const CODE_PATTERNS = [
  /\breturn\s/,
  /=>\s*\{/,
  /\bif\s*\(/,
  /\bfor\s*\(/,
  /\bwhile\s*\(/,
  /\bdescribe\s*\(/,
  /\bit\s*\(/,
  /\btest\s*\(/,
  /\bexpect\s*\(/,
  /\binsert\s+into\b/i,
  /\bcreate\s+(table|function|policy|index|view|trigger|schema|extension|or)\b/i,
];
// 禁用詞以「・」分隔書寫，避免本檔與任務單自己觸發；比對時去掉「・」。
const FORBIDDEN_PHRASES = ['照・抄', '逐字・寫出', '逐位・元組', '逐字・照貼', '自核・數字'].map((p) => p.replaceAll('・', ''));
const MAX_LINES = 250;
const MAX_BLOCK = 15;
const MAX_TOTAL = 40;

export function lintTask(task) {
  const file = task.path;
  const findings = [];
  const add = (line, rule, message) => findings.push({ file, line, rule, message });
  const lines = splitLines(task.text);
  const { blocks, inFence } = scanFences(lines);
  const outside = (i) => !inFence[i];

  // TL-TITLE
  const first = lines[0] ?? '';
  const title = /^# ([^：\s]+)：/.exec(first);
  if (title === null) add(1, 'TL-TITLE', '第 1 行必須是「# <編號>：<標題>」');
  else if (title[1] !== task.id) add(1, 'TL-TITLE', `標題編號 ${title[1] ?? ''} 與檔名編號 ${task.id} 不同`);

  // TL-RULES
  let firstH2 = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    if (outside(i) && (lines[i] ?? '').startsWith('## ')) {
      firstH2 = i;
      break;
    }
  }
  let ruleHead = -1;
  for (let i = 0; i < firstH2; i += 1) {
    if ((lines[i] ?? '').startsWith('> ## ⚠️ 強制工作規則')) {
      ruleHead = i;
      break;
    }
  }
  if (ruleHead < 0) {
    add(1, 'TL-RULES', '第一個「## 」標題之前缺少「> ## ⚠️ 強制工作規則」');
  } else {
    const nums = [];
    for (let i = ruleHead + 1; i < lines.length && (lines[i] ?? '').startsWith('>'); i += 1) {
      const m = /^>\s*(\d+)\.\s/.exec(lines[i] ?? '');
      if (m !== null) nums.push(Number(m[1]));
    }
    const expected = Array.from({ length: 12 }, (_, k) => k + 1);
    if (nums.length !== expected.length || nums.some((n, k) => n !== expected[k])) {
      add(ruleHead + 1, 'TL-RULES', `強制工作規則必須依序各出現一次 > 1.～> 12.（實際：${nums.join(',') || '無'}）`);
    }
  }

  // TL-SECTION
  for (const name of REQUIRED_SECTIONS) {
    if (findSection(lines, inFence, `## ${name}`) === null) add(1, 'TL-SECTION', `缺少「## ${name}」`);
  }

  // TL-HEADING
  lines.forEach((text, i) => {
    if (outside(i) && /^#{1,6}\s/.test(text) && (text.includes('特別規則') || text.includes('突變表'))) {
      add(i + 1, 'TL-HEADING', '標題不得含「特別規則」或「突變表」');
    }
  });

  // TL-LINES
  if (lines.length > MAX_LINES) add(lines.length, 'TL-LINES', `全文 ${String(lines.length)} 行，超過 ${String(MAX_LINES)} 行`);

  // 程式碼區塊
  let total = 0;
  let totalReported = false;
  for (const b of blocks) {
    if (!b.closed) add(b.open, 'TL-FENCE', '程式碼區塊未關閉');
    if (b.content.length > MAX_BLOCK) {
      add(b.open, 'TL-BLOCK-SIZE', `區塊內容 ${String(b.content.length)} 行，超過 ${String(MAX_BLOCK)} 行`);
    }
    total += b.content.length;
    if (total > MAX_TOTAL && !totalReported) {
      totalReported = true;
      add(b.open, 'TL-BLOCK-TOTAL', `區塊內容合計 ${String(total)} 行，超過 ${String(MAX_TOTAL)} 行`);
    }
    if (SQL_LANGS.has(b.lang)) add(b.open, 'TL-SQL', `不得有 ${b.lang} 區塊`);
    for (const c of b.content) {
      const hit = CODE_PATTERNS.find((re) => re.test(c.text));
      if (hit !== undefined) add(c.n, 'TL-CODE', `區塊內疑似實作程式（${String(hit)}）`);
    }
  }

  // TL-PHRASE
  lines.forEach((text, i) => {
    for (const p of FORBIDDEN_PHRASES) {
      if (text.includes(p)) add(i + 1, 'TL-PHRASE', `出現禁用詞「${p}」`);
    }
  });

  // TL-AC
  const parsed = parseTaskFile(task);
  const prefix = acPrefix(task.id);
  const acSec = findSection(lines, inFence, '## 驗收標準');
  if (acSec === null || parsed.acDefs.length === 0) {
    add(acSec === null ? 1 : acSec.start + 1, 'TL-AC', '「## 驗收標準」沒有任何 AC 定義');
  }
  const seen = new Set();
  for (const d of parsed.acDefs) {
    if (seen.has(d.id)) add(d.line, 'TL-AC', `AC 定義重複：${d.id}`);
    seen.add(d.id);
  }
  if (acSec !== null) {
    for (let i = acSec.start + 1; i < acSec.end; i += 1) {
      for (const m of (lines[i] ?? '').matchAll(/AC-([A-Za-z]+\d+)-\d+/g)) {
        if (m[1] !== prefix) add(i + 1, 'TL-AC', `出現其他任務前綴的 AC：${m[0]}`);
      }
    }
  }

  // TL-TC
  const tcSec = findSection(lines, inFence, '## 測試案例');
  if (tcSec !== null) {
    if (!parsed.hasTcHeader) {
      add(tcSec.start + 1, 'TL-TC', '缺少表頭為「| TC | 對應 AC | 情境 | 輸入 | 預期輸出／錯誤 |」的表格');
    } else {
      const tcSeen = new Set();
      const covered = new Set();
      for (const r of parsed.tcRows) {
        if (!/^TC-\d+$/.test(r.tc)) add(r.line, 'TL-TC', `TC 欄格式錯誤：${r.tc}`);
        else if (tcSeen.has(r.tc)) add(r.line, 'TL-TC', `TC 重複：${r.tc}`);
        tcSeen.add(r.tc);
        if (r.acs.length === 0) add(r.line, 'TL-TC', `${r.tc} 的對應 AC 欄為空`);
        for (const a of r.acs) {
          covered.add(a);
          if (!seen.has(a)) add(r.line, 'TL-TC', `${r.tc} 引用未定義的 AC：${a}`);
        }
      }
      for (const d of parsed.acDefs) {
        if (!covered.has(d.id)) add(d.line, 'TL-TC', `${d.id} 沒有出現在任何測試案例列`);
      }
    }
  }

  // TL-SCOPE
  const scopeSec = findSection(lines, inFence, '## 檔案範圍');
  let doStart = -1;
  let doEnd = scopeSec === null ? 0 : scopeSec.end;
  if (scopeSec !== null) {
    for (let i = scopeSec.start + 1; i < scopeSec.end; i += 1) {
      if (!outside(i)) continue;
      if (doStart < 0 && (lines[i] ?? '').startsWith('### 要做')) doStart = i;
      else if (doStart >= 0 && (lines[i] ?? '').startsWith('### ')) {
        doEnd = i;
        break;
      }
    }
  }
  let doItems = 0;
  if (doStart >= 0) {
    for (let i = doStart + 1; i < doEnd; i += 1) {
      if (/^- (?:\[[ xX]\] )?`/.test(lines[i] ?? '')) doItems += 1;
    }
  }
  if (scopeSec === null || doStart < 0) add(scopeSec === null ? 1 : scopeSec.start + 1, 'TL-SCOPE', '「## 檔案範圍」缺少「### 要做」');
  else if (doItems === 0) add(doStart + 1, 'TL-SCOPE', '「### 要做」沒有以反引號路徑開頭的列表項');

  return findings.map((f, k) => ({ f, k })).sort((a, b) => a.f.line - b.f.line || a.k - b.k).map((x) => x.f);
}

export function run(argv) {
  const args = parseArgs(argv, { options: [], positional: true });
  if (!args.ok) return usageFailure(TOOL, 'USAGE', args.message);
  if (args.positionals.length === 0) return usageFailure(TOOL, 'USAGE', 'usage: task-lint.mjs <task.md> [<task.md> ...]');
  const all = [];
  for (const path of args.positionals) {
    const r = readText(path);
    if (!r.ok) {
      all.push({ file: path, line: 0, rule: 'INPUT', message: r.message });
      continue;
    }
    all.push(...lintTask({ id: basename(path, '.md'), path, text: r.text }));
  }
  return all.length > 0 ? failure(TOOL, all) : success(TOOL, args.positionals);
}

if (isMain(import.meta.url)) runCli(TOOL, run);
