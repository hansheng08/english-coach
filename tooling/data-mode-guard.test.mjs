import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDataModeEnv } from './data-mode-guard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const GUARD = join(here, 'data-mode-guard.mjs');
const root = join(here, '..');

const FAKE_URL = 'https://example.invalid';
const FAKE_KEY = 'fake-publishable-value-xyz';

const runCli = (env) =>
  spawnSync(process.execPath, [GUARD], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8' });

const SUPA = { VITE_DATA_MODE: 'supabase', VITE_SUPABASE_URL: FAKE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: FAKE_KEY };

const FAIL_CASES = [
  { VITE_DATA_MODE: 'mock', VITE_SUPABASE_URL: FAKE_URL },
  { VITE_DATA_MODE: 'mock', VITE_SUPABASE_URL: '' },
  { VITE_DATA_MODE: 'mock', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
  { VITE_DATA_MODE: 'mock', VITE_SUPABASE_ANON_KEY: '' },
  { VITE_DATA_MODE: 'mock', VITE_SUPABASE_ANON_KEY: '   ' },
  {},
  { VITE_DATA_MODE: '' },
  { VITE_DATA_MODE: 'MOCK' },
  { VITE_DATA_MODE: 'staging' },
  { VITE_DATA_MODE: 'supabase', VITE_SUPABASE_PUBLISHABLE_KEY: FAKE_KEY },
  { VITE_DATA_MODE: 'supabase', VITE_SUPABASE_URL: FAKE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: '' },
  { VITE_DATA_MODE: 'supabase', VITE_SUPABASE_URL: FAKE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: '  ' },
];
const PASS_CASES = [{ VITE_DATA_MODE: 'mock' }, SUPA];

const behavesCorrectly = (fn) =>
  FAIL_CASES.every((e) => fn(e).ok === false) && PASS_CASES.every((e) => fn(e).ok === true);

const jobBlock = (yml, name) => {
  const m = yml.match(new RegExp(`^  ${name}:\\n((?:    .*\\n|\\n)*)`, 'm'));
  return m ? m[1] : '';
};

describe('data-mode-guard', () => {
  it('(AC-O23-1) (TC-1) mock without supabase vars -> ok; CLI exit 0', () => {
    expect(assertDataModeEnv({ VITE_DATA_MODE: 'mock' })).toEqual({ ok: true, mode: 'mock' });
    const r = runCli({ VITE_DATA_MODE: 'mock' });
    expect(r.status).toBe(0);
  });

  it('(AC-O23-1) (TC-2) supabase with both required non-empty -> ok', () => {
    expect(assertDataModeEnv(SUPA)).toEqual({ ok: true, mode: 'supabase' });
    expect(runCli(SUPA).status).toBe(0);
  });

  it('(AC-O23-2) (TC-3) mock plus non-empty URL -> fail; CLI exit 1; stderr has no value', () => {
    const env = { VITE_DATA_MODE: 'mock', VITE_SUPABASE_URL: FAKE_URL };
    expect(assertDataModeEnv(env).ok).toBe(false);
    const r = runCli(env);
    expect(r.status).toBe(1);
    expect(r.stderr).not.toContain(FAKE_URL);
    expect(r.stderr).toContain('VITE_SUPABASE_URL');
  });

  it('(AC-O23-2) (TC-4) mock plus empty or blank VITE_SUPABASE_* -> fail', () => {
    for (const k of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_FUTURE']) {
      for (const v of ['', '  ']) {
        const env = { VITE_DATA_MODE: 'mock', [k]: v };
        expect(assertDataModeEnv(env).ok, `${k}=${JSON.stringify(v)}`).toBe(false);
        expect(runCli(env).status).toBe(1);
      }
    }
  });

  it('(AC-O23-3) (TC-5) missing or invalid VITE_DATA_MODE -> fail, never mock', () => {
    for (const env of [{}, { VITE_DATA_MODE: '' }, { VITE_DATA_MODE: 'MOCK' }, { VITE_DATA_MODE: 'staging' }]) {
      expect(assertDataModeEnv(env).ok).toBe(false);
      expect(runCli(env).status).toBe(1);
    }
  });

  it('(AC-O23-3) (TC-6) supabase missing URL or blank key -> fail', () => {
    const noUrl = { VITE_DATA_MODE: 'supabase', VITE_SUPABASE_PUBLISHABLE_KEY: FAKE_KEY };
    expect(assertDataModeEnv(noUrl).ok).toBe(false);
    for (const key of ['', '   ']) {
      expect(assertDataModeEnv({ ...SUPA, VITE_SUPABASE_PUBLISHABLE_KEY: key }).ok).toBe(false);
    }
  });

  it('(AC-O23-4) (TC-7) ci.yml / ci-budget.json contract holds without apps/web', () => {
    const yml = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
    const bundle = jobBlock(yml, 'bundle');
    expect(bundle).toMatch(/^    if: .*has_web == 'true'/m);
    expect(bundle).toMatch(/^    timeout-minutes: 10$/m);
    const jobsSection = yml.split(/^jobs:\n/m)[1] ?? '';
    const jobCount = (jobsSection.match(/^  [A-Za-z0-9_-]+:\s*$/gm) ?? []).length;
    expect(jobCount).toBeLessThanOrEqual(7);
    const budget = JSON.parse(readFileSync(join(root, '.github/ci-budget.json'), 'utf8'));
    expect(budget.max_jobs['ci.yml']).toBe(7);
  });

  it('(AC-O23-5) (TC-8) non-object env fails closed; own files have no fail-open escapes',() => {
    for (const bad of [null, undefined, 'mock', 42, ['VITE_DATA_MODE']]) {
      expect(assertDataModeEnv(bad).ok).toBe(false);
    }
    for (const f of ['data-mode-guard.mjs', 'data-mode-guard.test.mjs']) {
      const forbidden = new RegExp(['\\|\\|\\s*tr' + 'ue', 'continue-on-' + 'error'].join('|'));
      const hits = readFileSync(join(here, f), 'utf8')
        .split('\n')
        .filter((l) => forbidden.test(l));
      expect(hits, f).toEqual([]);
    }
  });

  it('(AC-O23-6) (TC-9) weakened implementations are caught by the case table', () => {
    expect(behavesCorrectly(assertDataModeEnv)).toBe(true);
    const mutants = {
      emptyAsUnset: (env) => {
        const e = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
        return assertDataModeEnv(e);
      },
      defaultMock: (env) => assertDataModeEnv({ VITE_DATA_MODE: 'mock', ...env }),
      onlyNonEmptySupabase: (env) => {
        if (env.VITE_DATA_MODE === 'mock') {
          const hit = Object.entries(env).some(([k, v]) => k.startsWith('VITE_SUPABASE_') && v.trim() !== '');
          return hit ? { ok: false } : { ok: true, mode: 'mock' };
        }
        return assertDataModeEnv(env);
      },
      acceptUpperCase: (env) =>
        assertDataModeEnv({ ...env, ...(typeof env.VITE_DATA_MODE === 'string' ? { VITE_DATA_MODE: env.VITE_DATA_MODE.toLowerCase() } : {}) }),
    };
    for (const [name, fn] of Object.entries(mutants)) {
      expect(behavesCorrectly(fn), `mutant ${name} survived`).toBe(false);
    }
  });
});
