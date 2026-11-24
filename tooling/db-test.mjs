// pgTAP 執行器（O-010）：以 psql 逐檔執行 supabase/tests，成敗只看 TAP。fail-closed。
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { failure, isMain, parseArgs, runCli, usageFailure } from './task-file.mjs';
import { parseTap, tapToTests } from './tap.mjs';

const TOOL = 'db-test';
const DEFAULT_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const TIMEOUT_MS = 300_000;
const BASE_ARGS = ['--no-psqlrc', '--no-align', '--quiet', '--pset', 'pager=off', '--pset', 'tuples_only=true', '--set', 'ON_ERROR_STOP=1'];

const realSpawn = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', timeout: TIMEOUT_MS, shell: false });

function okExit(r) {
  return r !== undefined && r !== null && r.status === 0 && !r.error;
}

export function runDbTest({ testsDir, tapDir, dbUrl, psql, reset, spawn = realSpawn }) {
  const findings = [];
  const out = [];
  const fail = (file, rule, message) => findings.push({ file, line: 0, rule, message });
  const done = (files, tests) => ({ findings, files, tests, output: out.join('') });

  let names;
  try {
    names = readdirSync(testsDir)
      .filter((n) => n.endsWith('.sql') || n.endsWith('.pg'))
      .sort();
  } catch (e) {
    fail(testsDir, 'INPUT', `cannot read tests dir: ${e instanceof Error ? e.message : String(e)}`);
    return done(0, 0);
  }

  if (reset) {
    if (!okExit(spawn('supabase', ['db', 'reset']))) {
      fail('supabase db reset', 'DB-RESET', 'supabase db reset 失敗');
      return done(0, 0);
    }
  }
  const ext = spawn(psql, [...BASE_ARGS, '--command', 'create extension if not exists pgtap with schema extensions', dbUrl]);
  if (!okExit(ext)) {
    fail(psql, 'DB-PSQL', '建立 pgtap extension 失敗');
    return done(0, 0);
  }
  if (names.length === 0) {
    fail(testsDir, 'DB-NOTESTS', '沒有任何 *.sql／*.pg 測試檔');
    return done(0, 0);
  }

  try {
    mkdirSync(tapDir, { recursive: true });
  } catch (e) {
    fail(tapDir, 'INPUT', `cannot create tap dir: ${e instanceof Error ? e.message : String(e)}`);
    return done(0, 0);
  }

  let tests = 0;
  for (const name of names) {
    const path = join(testsDir, name);
    const r = spawn(psql, [...BASE_ARGS, '--file', path, dbUrl]);
    const stdout = typeof r?.stdout === 'string' ? r.stdout : '';
    const tapPath = join(tapDir, `${basename(name, extname(name))}.tap`);
    try {
      writeFileSync(tapPath, stdout);
    } catch (e) {
      fail(tapPath, 'INPUT', `cannot write tap: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    out.push(stdout.endsWith('\n') || stdout === '' ? stdout : `${stdout}\n`);
    if (!okExit(r)) {
      fail(path, 'DB-PSQL', `psql 失敗（exit ${String(r?.status ?? 'null')}）`);
      continue;
    }
    // psql 在測試失敗時仍 exit 0，成敗只看 TAP。
    const tap = parseTap(stdout, path);
    if (tap.errors.length > 0) {
      for (const e of tap.errors) fail(path, 'DB-TAP', `${e.rule}: ${e.message}`);
      continue;
    }
    const results = tapToTests(tap);
    tests += results.length;
    for (const t of results) if (t.status === 'failed') fail(path, 'DB-FAIL', t.name);
  }
  return done(names.length, tests);
}

export function run(argv) {
  const rest = argv.filter((a) => a !== '--reset');
  if (argv.length - rest.length > 1) return usageFailure(TOOL, 'USAGE', 'duplicate option --reset');
  const args = parseArgs(rest, { options: ['tests-dir', 'tap-dir', 'db-url', 'psql'], positional: false });
  if (!args.ok) return usageFailure(TOOL, 'USAGE', args.message);
  const v = args.values;
  const r = runDbTest({
    testsDir: v['tests-dir'] ?? 'supabase/tests',
    tapDir: v['tap-dir'] ?? '.tmp/pgtap',
    dbUrl: v['db-url'] ?? DEFAULT_DB_URL,
    psql: v.psql ?? 'psql',
    reset: rest.length !== argv.length,
  });
  if (r.findings.length > 0) {
    const f = failure(TOOL, r.findings);
    return { ...f, stdout: r.output };
  }
  return { code: 0, stdout: `${r.output}${TOOL}: OK ${String(r.files)} file(s), ${String(r.tests)} test(s)\n`, stderr: '' };
}

if (isMain(import.meta.url)) runCli(TOOL, run);
