// TAP 解析（O-010）：把 pgTAP／pg_prove 的輸出轉成測試結果。解析函式不丟例外。
import { basename } from 'node:path';

const PLAN_RE = /^1\.\.(\d+)\s*$/;
const TEST_RE = /^(not ok|ok)\s+(\d+)(.*)$/;
const DIRECTIVE_RE = /#\s*(SKIP|TODO)\b\s*(.*)$/i;

export function parseTap(text, file) {
  const errors = [];
  const tests = [];
  const plans = [];
  let bail = false;
  let firstTestIdx = -1;
  let lastTestIdx = -1;
  let orderReported = false;

  const add = (line, rule, message) => errors.push({ file, line, rule, message });
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  lines.forEach((raw, idx) => {
    const line = idx + 1;
    if (raw.startsWith('Bail out!')) {
      bail = true;
      add(line, 'TAP-BAIL', raw.trim());
      return;
    }
    const plan = PLAN_RE.exec(raw);
    if (plan !== null) {
      plans.push({ n: Number(plan[1]), idx });
      return;
    }
    const m = TEST_RE.exec(raw);
    if (m === null) return;
    const rest = m[3] ?? '';
    if (rest !== '' && !/^[\s#-]/.test(rest)) return;
    const n = Number(m[2]);
    let description = rest.replace(/^\s*-\s?/, '').trim();
    let directive = null;
    const d = DIRECTIVE_RE.exec(rest);
    if (d !== null) {
      directive = (d[1] ?? '').toUpperCase();
      const before = rest.slice(0, d.index).replace(/^\s*-\s?/, '').trim();
      description = before !== '' ? before : (d[2] ?? '').trim();
    }
    if (firstTestIdx < 0) firstTestIdx = idx;
    lastTestIdx = idx;
    if (n !== tests.length + 1 && !orderReported) {
      orderReported = true;
      add(line, 'TAP-ORDER', `測試編號應為 ${String(tests.length + 1)}，實際為 ${String(n)}`);
    }
    tests.push({ n, ok: m[1] === 'ok', description, directive });
  });

  if (bail) return { file, plan: null, tests, errors };
  if (tests.length === 0) {
    add(1, 'TAP-EMPTY', '沒有任何測試行');
    return { file, plan: null, tests, errors };
  }
  let plan = null;
  if (plans.length === 0) {
    add(1, 'TAP-PLAN', '缺少計畫行 1..N');
  } else if (plans.length > 1) {
    add((plans[1]?.idx ?? 0) + 1, 'TAP-PLAN', '計畫行重複');
  } else {
    const p = plans[0];
    plan = p?.n ?? null;
    const inside = p !== undefined && p.idx > firstTestIdx && p.idx < lastTestIdx;
    if (inside) add(p.idx + 1, 'TAP-PLAN', '計畫行必須在測試行之前或之後');
    if (plan !== tests.length) add((p?.idx ?? 0) + 1, 'TAP-PLAN', `計畫 ${String(plan)} 筆，實際 ${String(tests.length)} 筆`);
  }
  return { file, plan, tests, errors };
}

export function tapToTests(r) {
  const base = basename(r.file);
  return r.tests.map((t) => {
    let status;
    if (t.directive !== null) status = 'skipped';
    else status = t.ok ? 'passed' : 'failed';
    return { name: `${base}: ${t.description}`, status };
  });
}
