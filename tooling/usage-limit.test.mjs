import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectUsageLimit, usageLimitStreak } from './usage-limit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fx = join(here, 'fixtures', 'o014');
const cli = join(here, 'usage-limit.mjs');
const readFx = (name) => JSON.parse(readFileSync(join(fx, name), 'utf8'));

const tmps = [];
afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});
const tmpFile = (name, text) => {
  const d = mkdtempSync(join(tmpdir(), 'o014-'));
  tmps.push(d);
  const p = join(d, name);
  writeFileSync(p, text);
  return p;
};

const LIMIT_RESULT = { type: 'result', is_error: true, api_error: 'usage_limit_reached', api_error_status: 429 };
const rejected = (info = {}) => ({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1795584000, rateLimitType: 'five_hour', ...info } });
const warning = () => ({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', resetsAt: 1795584000, rateLimitType: 'five_hour' } });
const NOT = { usageLimit: false, resetsAt: null, limitType: null };

describe('detectUsageLimit', () => {
  it('(AC-O14-1) (TC-1) reproduces the T-023 incident', () => {
    expect(detectUsageLimit(readFx('t023-usage-limit.json'))).toEqual({ usageLimit: true, resetsAt: '2026-11-25T05:20:00Z', limitType: 'five_hour' });
  });

  it('(AC-O14-1) (TC-2) uses the last rejected event', () => {
    const r = detectUsageLimit([rejected({ resetsAt: 1795584000 }), rejected({ resetsAt: 1795602000 }), LIMIT_RESULT]);
    expect(r.resetsAt).toBe('2026-11-25T10:20:00Z');
  });

  it('(AC-O14-2) (TC-3) a generic API error is not a usage limit', () => {
    expect(detectUsageLimit(readFx('overloaded-error.json'))).toEqual(NOT);
  });

  it('(AC-O14-2) (TC-4) a successful result is not a usage limit even with a rejected event', () => {
    expect(detectUsageLimit([rejected(), { type: 'result', is_error: false, api_error: null }])).toEqual(NOT);
  });

  it('(AC-O14-2) (TC-5) a missing or wrong field is not a usage limit', () => {
    const { is_error: _a, ...noIsError } = LIMIT_RESULT;
    const { api_error_status: _b, ...noStatus } = LIMIT_RESULT;
    for (const result of [noIsError, { ...LIMIT_RESULT, api_error_status: 500 }, noStatus]) {
      expect(detectUsageLimit([rejected(), result])).toEqual(NOT);
    }
  });

  it('(AC-O14-2) (TC-6) malformed input is not a usage limit', () => {
    for (const input of [[], [{ type: 'system' }], {}, null, 'x']) {
      expect(detectUsageLimit(input)).toEqual(NOT);
    }
  });

  it('(AC-O14-2) (TC-7) only the last result counts', () => {
    expect(detectUsageLimit([LIMIT_RESULT, { type: 'result', is_error: false, api_error: null }])).toEqual(NOT);
  });

  it('(AC-O14-3) (TC-8) no rate_limit_event → true with unknown reset', () => {
    expect(detectUsageLimit([LIMIT_RESULT])).toEqual({ usageLimit: true, resetsAt: null, limitType: null });
  });

  it('(AC-O14-3) (TC-9) only warnings → reset unknown', () => {
    expect(detectUsageLimit([warning(), warning(), LIMIT_RESULT])).toEqual({ usageLimit: true, resetsAt: null, limitType: null });
  });

  it('(AC-O14-3) (TC-10) bad resetsAt values → null', () => {
    const missing = { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' } };
    const cases = [missing, rejected({ resetsAt: 0 }), rejected({ resetsAt: -1 }), rejected({ resetsAt: 1.5 }), rejected({ resetsAt: '1795584000' }), rejected({ resetsAt: 2 ** 60 })];
    for (const ev of cases) {
      const r = detectUsageLimit([ev, LIMIT_RESULT]);
      expect(r.usageLimit).toBe(true);
      expect(r.resetsAt).toBeNull();
    }
  });

  it('(AC-O14-3) (TC-11) bad rateLimitType and odd elements do not throw', () => {
    expect(detectUsageLimit([rejected({ rateLimitType: 'Five Hour' }), LIMIT_RESULT]).limitType).toBeNull();
    const odd = [null, 3, 'x', { type: 'rate_limit_event', rate_limit_info: 3 }, { type: 'rate_limit_event' }, [], LIMIT_RESULT];
    expect(() => detectUsageLimit(odd)).not.toThrow();
    expect(detectUsageLimit(odd)).toEqual({ usageLimit: true, resetsAt: null, limitType: null });
    expect(() => detectUsageLimit([null, { type: 'result', is_error: true }])).not.toThrow();
  });
});

describe('usageLimitStreak', () => {
  it('(AC-O14-4) (TC-12) not a usage limit → 0 / none', () => {
    expect(usageLimitStreak(false, { outcome: 'usage_limit', usage_limit_streak: 1 })).toEqual({ streak: 0, action: 'none' });
  });

  it('(AC-O14-4) (TC-13) first time → 1 / reschedule', () => {
    expect(usageLimitStreak(true, null)).toEqual({ streak: 1, action: 'reschedule' });
    expect(usageLimitStreak(true, { outcome: 'failure' })).toEqual({ streak: 1, action: 'reschedule' });
  });

  it('(AC-O14-4) (TC-14) second time → 2 / stop', () => {
    expect(usageLimitStreak(true, { outcome: 'usage_limit', usage_limit_streak: 1 })).toEqual({ streak: 2, action: 'stop' });
  });

  it('(AC-O14-4) (TC-15) third time → 3 / stop', () => {
    expect(usageLimitStreak(true, { outcome: 'usage_limit', usage_limit_streak: 2 })).toEqual({ streak: 3, action: 'stop' });
  });

  it('(AC-O14-4) (TC-16) unknown previous → unknown / stop', () => {
    const cases = ['error', 42, {}, { outcome: 'usage_limit' }, { outcome: 'usage_limit', usage_limit_streak: 'unknown' }, { outcome: 'usage_limit', usage_limit_streak: 0 }, { outcome: 7 }];
    for (const p of cases) expect(usageLimitStreak(true, p)).toEqual({ streak: 'unknown', action: 'stop' });
  });
});

const exec = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const isJson = (s) => {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
};

describe('CLI', () => {
  it('(AC-O14-5) (TC-17) detect', () => {
    const ok = exec('detect', '--execution-file', join(fx, 't023-usage-limit.json'));
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout)).toEqual({ usage_limit: true, resets_at: '2026-11-25T05:20:00Z', limit_type: 'five_hour' });
    const generic = exec('detect', '--execution-file', join(fx, 'overloaded-error.json'));
    expect(generic.status).toBe(0);
    expect(JSON.parse(generic.stdout)).toEqual({ usage_limit: false, resets_at: null, limit_type: null });
    for (const path of [join(fx, 'does-not-exist.json'), tmpFile('bad.json', '{')]) {
      const r = exec('detect', '--execution-file', path);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('usage-limit: FAIL');
      expect(r.stderr).toContain('INPUT');
      expect(isJson(r.stdout)).toBe(false);
    }
  });

  it('(AC-O14-5) (TC-18) streak', () => {
    const cases = [
      [['--current', 'true', '--no-previous'], 1, 'reschedule'],
      [['--current', 'true', '--previous-file', join(fx, 'previous-usage-limit-1.json')], 2, 'stop'],
      [['--current', 'true', '--previous-file', tmpFile('bad.json', '{')], 'unknown', 'stop'],
      [['--current', 'true', '--previous-file', join(fx, 'does-not-exist.json')], 'unknown', 'stop'],
      [['--current', 'true', '--previous-file', tmpFile('null.json', 'null')], 'unknown', 'stop'],
      [['--current', 'true', '--previous-error'], 'unknown', 'stop'],
      [['--current', 'false', '--no-previous'], 0, 'none'],
    ];
    for (const [args, streak, action] of cases) {
      const r = exec('streak', ...args);
      expect(r.status, args.join(' ')).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ usage_limit_streak: streak, usage_limit_action: action });
    }
  });

  it('(AC-O14-5) (TC-19) usage errors fail closed', () => {
    const bad = [
      ['streak', '--current', 'yes', '--no-previous'],
      ['streak', '--current', 'true', '--no-previous', '--previous-error'],
      ['streak', '--current', 'true'],
      ['streak', '--current', 'true', '--current', 'false', '--no-previous'],
      ['streak', '--current'],
      ['detect'],
      ['detect', '--execution-file'],
      ['foo'],
      [],
    ];
    for (const args of bad) {
      const r = exec(...args);
      expect(r.status, args.join(' ')).toBe(1);
      expect(r.stderr).toContain('USAGE');
      expect(isJson(r.stdout)).toBe(false);
    }
  });
});

describe('sources', () => {
  const sources = [join(here, 'usage-limit.mjs'), join(here, 'usage-limit.test.mjs'), join(here, 'o014.test.mjs')];
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

  it('(AC-O14-7) (TC-21) imports are node: or relative only', () => {
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) {
        const spec = m[1];
        const allowed = spec.startsWith('node:') || spec.startsWith('./') || (spec === 'vitest' && file.endsWith('.test.mjs'));
        expect(allowed, `${file}: ${spec}`).toBe(true);
      }
    }
  });

  it('(AC-O14-7) (TC-21) no error-swallowing patterns in the tool', () => {
    const text = readFileSync(join(here, 'usage-limit.mjs'), 'utf8');
    for (const pattern of ['||' + ' true', 'continue-on' + '-error']) expect(text.includes(pattern)).toBe(false);
    expect(/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(text)).toBe(false);
  });

  it('(AC-O14-7) (TC-21) fixtures do not match QA-owned file patterns', () => {
    for (const file of walk(fx)) {
      expect(/\.qa\.test\.ts$/.test(file) || /qa_[^/]*\.sql$/.test(file) || /docs\/qa\/mutants\//.test(file), file).toBe(false);
    }
  });
});
