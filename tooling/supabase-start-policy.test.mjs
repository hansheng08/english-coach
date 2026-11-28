import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { MAX_ATTEMPTS, RETRY_DELAYS_SEC, classifyStartFailure, decideRetry } from './supabase-start-policy.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, 'supabase-start-policy.mjs');
const exec = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const tmp = mkdtempSync(join(tmpdir(), 'o031-'));
const file = (name, text) => {
  const p = join(tmp, name);
  writeFileSync(p, text);
  return p;
};

const BIND = 'failed to bind host port 0.0.0.0:54322/tcp: address already in use';
const REG = 'error from registry: Rate exceeded';

describe('classifyStartFailure', () => {
  it('(AC-O31-1) (TC-1) 埠被占用 → port-bind', () => {
    expect(classifyStartFailure(BIND)).toBe('port-bind');
    expect(classifyStartFailure('Bind for 0.0.0.0:54322 failed: port is already allocated')).toBe('port-bind');
    expect(classifyStartFailure('ADDRESS ALREADY IN USE')).toBe('port-bind');
  });

  it('(AC-O31-1) (TC-2) 映像速率限制 → registry', () => {
    expect(classifyStartFailure(REG)).toBe('registry');
    for (const s of ['Data limit exceeded', 'toomanyrequests: x', 'TLS handshake timeout', 'unexpected EOF', 'dial: i/o timeout']) {
      expect(classifyStartFailure(s)).toBe('registry');
    }
  });

  it('(AC-O31-1) (AC-O31-9) (TC-3) 兩者並存 → port-bind 優先；日誌混有其他行也命中', () => {
    expect(classifyStartFailure(`pulling...\n${REG}\nretrying\n${BIND}\nStopping containers...`)).toBe('port-bind');
    expect(classifyStartFailure(`${BIND}\n${REG}`)).toBe('port-bind');
    expect(classifyStartFailure(`noise\n${REG}\nmore noise`)).toBe('registry');
  });

  it('(AC-O31-1) (TC-4) 空字串與無法判斷 → fatal', () => {
    for (const s of ['', 'invalid config: foo', 'database is not healthy: timeout waiting', 'migration failed']) {
      expect(classifyStartFailure(s)).toBe('fatal');
    }
    expect(classifyStartFailure(undefined)).toBe('fatal');
  });
});

describe('decideRetry', () => {
  it('(AC-O31-2) (AC-O31-9) (TC-5) 第 1、2 次可重試，秒數取自 RETRY_DELAYS_SEC', () => {
    expect(MAX_ATTEMPTS).toBe(3);
    expect([...RETRY_DELAYS_SEC]).toEqual([10, 20]);
    for (const kind of ['port-bind', 'registry']) {
      expect(decideRetry({ attempt: 1, kind, portHeldByOther: false })).toEqual({ retry: true, delaySec: 10 });
      expect(decideRetry({ attempt: 2, kind, portHeldByOther: false })).toEqual({ retry: true, delaySec: 20 });
    }
  });

  it('(AC-O31-2) (AC-O31-9) (TC-6) 第 3 次、fatal、held=true → stop 並附原因', () => {
    const stops = [
      decideRetry({ attempt: 3, kind: 'port-bind', portHeldByOther: false }),
      decideRetry({ attempt: 3, kind: 'registry', portHeldByOther: false }),
      decideRetry({ attempt: 1, kind: 'fatal', portHeldByOther: false }),
      decideRetry({ attempt: 2, kind: 'fatal', portHeldByOther: false }),
      decideRetry({ attempt: 1, kind: 'port-bind', portHeldByOther: true }),
      decideRetry({ attempt: 2, kind: 'registry', portHeldByOther: true }),
    ];
    for (const d of stops) {
      expect(d.retry).toBe(false);
      expect(d.reason).toMatch(/\S/);
    }
  });

  it('(AC-O31-2) (TC-7) attempt 不是 1..MAX 的整數 → 丟錯', () => {
    for (const attempt of [0, 4, 1.5, Number.NaN, -1, '1', undefined]) {
      expect(() => decideRetry({ attempt, kind: 'port-bind', portHeldByOther: false })).toThrow();
    }
  });
});

describe('命令列', () => {
  it('(AC-O31-3) (TC-8) classify 與 decide 輸出格式與結束碼 0', () => {
    const f = file('bind.txt', `${REG}\n${BIND}\n`);
    const c = exec(['classify', f]);
    expect(c.status).toBe(0);
    expect(c.stdout).toBe('port-bind\n');
    expect(exec(['classify', file('empty.txt', '')]).stdout).toBe('fatal\n');
    const d1 = exec(['decide', '1', 'port-bind', '0']);
    expect([d1.status, d1.stdout]).toEqual([0, 'retry 10\n']);
    const d2 = exec(['decide', '2', 'registry', '0']);
    expect([d2.status, d2.stdout]).toEqual([0, 'retry 20\n']);
    const d3 = exec(['decide', '3', 'port-bind', '0']);
    expect(d3.status).toBe(0);
    expect(d3.stdout).toMatch(/^stop \S.*\n$/);
    expect(exec(['decide', '1', 'fatal', '0']).stdout).toMatch(/^stop /);
    expect(exec(['decide', '1', 'port-bind', '1']).stdout).toMatch(/^stop /);
  });

  it('(AC-O31-3) (TC-9) 壞輸入一律結束碼 2 且不印 retry', () => {
    const cases = [
      [],
      ['unknown'],
      ['classify'],
      ['classify', join(tmp, 'missing.txt')],
      ['classify', 'a', 'b'],
      ['decide'],
      ['decide', '1', 'port-bind'],
      ['decide', '1', 'bogus', '0'],
      ['decide', '1', 'port-bind', '2'],
      ['decide', '0', 'port-bind', '0'],
      ['decide', '4', 'port-bind', '0'],
      ['decide', '1.5', 'port-bind', '0'],
      ['decide', 'x', 'port-bind', '0'],
      ['decide', '1', 'port-bind', '0', 'extra'],
    ];
    for (const args of cases) {
      const r = exec(args);
      expect(r.status, args.join(' ')).toBe(2);
      expect(r.stdout).not.toContain('retry');
    }
  });
});
