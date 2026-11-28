// supabase start 失敗分類與重試決策（O-031）。只用 Node 內建模組；判斷不了一律 fatal（fail-closed）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MAX_ATTEMPTS = 3;
export const RETRY_DELAYS_SEC = Object.freeze([10, 20]);

const PORT_BIND = ['failed to bind host port', 'address already in use', 'port is already allocated'];
const REGISTRY = [
  'error from registry',
  'rate exceeded',
  'data limit exceeded',
  'toomanyrequests',
  'tls handshake timeout',
  'unexpected eof',
  'i/o timeout',
];

export function classifyStartFailure(output) {
  const text = typeof output === 'string' ? output.toLowerCase() : '';
  if (PORT_BIND.some((s) => text.includes(s))) return 'port-bind';
  if (REGISTRY.some((s) => text.includes(s))) return 'registry';
  return 'fatal';
}

export function decideRetry({ attempt, kind, portHeldByOther }) {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_ATTEMPTS) {
    throw new RangeError(`attempt must be an integer in 1..${MAX_ATTEMPTS}`);
  }
  if (kind !== 'port-bind' && kind !== 'registry') return { retry: false, reason: `not retryable: ${kind}` };
  if (portHeldByOther === true) return { retry: false, reason: 'port held by a non-Docker process' };
  if (attempt >= MAX_ATTEMPTS) return { retry: false, reason: 'attempts exhausted' };
  const delaySec = RETRY_DELAYS_SEC[attempt - 1];
  if (delaySec === undefined) return { retry: false, reason: 'no delay configured' };
  return { retry: true, delaySec };
}

const KINDS = ['port-bind', 'registry', 'fatal'];
const USAGE = 'usage: supabase-start-policy.mjs classify <file> | decide <attempt> <kind> <held 0|1>';

const bad = (message) => ({ code: 2, stdout: '', stderr: `supabase-start-policy: ${message}\n` });

export function run(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'classify') {
    if (rest.length !== 1 || rest[0] === undefined || rest[0] === '') return bad(USAGE);
    let text;
    try {
      text = readFileSync(rest[0], 'utf8');
    } catch {
      return bad(`cannot read ${rest[0]}`);
    }
    return { code: 0, stdout: `${classifyStartFailure(text)}\n`, stderr: '' };
  }
  if (cmd === 'decide') {
    if (rest.length !== 3) return bad(USAGE);
    const [a, kind, held] = rest;
    if (!/^\d+$/.test(a)) return bad('attempt must be an integer');
    const attempt = Number(a);
    if (attempt < 1 || attempt > MAX_ATTEMPTS) return bad(`attempt must be 1..${MAX_ATTEMPTS}`);
    if (!KINDS.includes(kind)) return bad(`unknown kind ${kind}`);
    if (held !== '0' && held !== '1') return bad('held must be 0 or 1');
    const d = decideRetry({ attempt, kind, portHeldByOther: held === '1' });
    const line = d.retry ? `retry ${d.delaySec}` : `stop ${d.reason}`;
    return { code: 0, stdout: `${line}\n`, stderr: '' };
  }
  return bad(USAGE);
}

const entry = process.argv[1];
if (typeof entry === 'string' && entry !== '' && import.meta.url === pathToFileURL(resolve(entry)).href) {
  const r = run(process.argv.slice(2));
  if (r.stdout !== '') process.stdout.write(r.stdout);
  if (r.stderr !== '') process.stderr.write(r.stderr);
  process.exitCode = r.code;
}
