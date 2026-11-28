import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKEND_NAMES = Object.freeze([
  'GEMINI_API_KEY',
  'GEMINI_PAID_API_KEY',
  'GROQ_API_KEY',
  'AZURE_SPEECH_KEY',
  'SUPABASE_SECRET_KEYS',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
]);

export const ALLOWED_VITE_NAMES = Object.freeze([
  'VITE_DATA_MODE',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
]);

const VITE_NAME = /VITE_[A-Za-z0-9_]*/g;

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function scanText(text) {
  if (typeof text !== 'string') {
    throw new TypeError('scanText: text must be a string');
  }
  const found = new Map();
  for (const name of BACKEND_NAMES) {
    if (text.includes(name)) found.set(name, 'backend');
  }
  for (const name of text.match(VITE_NAME) ?? []) {
    if (!ALLOWED_VITE_NAMES.includes(name)) found.set(name, 'vite');
  }
  return [...found].map(([name, kind]) => ({ name, kind })).sort(byName);
}

function collect(dir, rel, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return `cannot read directory: ${rel === '' ? '.' : rel}`;
  }
  for (const entry of entries) {
    const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isSymbolicLink()) return `symbolic link not allowed: ${relPath}`;
    if (entry.isDirectory()) {
      const failure = collect(join(dir, entry.name), relPath, out);
      if (failure !== null) return failure;
    } else if (entry.isFile()) {
      out.push(relPath);
    }
  }
  return null;
}

export function scanDir(dir) {
  if (typeof dir !== 'string' || dir === '') {
    return { error: 'INPUT', reason: 'directory path is required' };
  }
  let stat;
  try {
    stat = lstatSync(dir);
  } catch {
    return { error: 'INPUT', reason: 'path does not exist' };
  }
  if (stat.isSymbolicLink()) return { error: 'INPUT', reason: 'path is a symbolic link' };
  if (!stat.isDirectory()) return { error: 'INPUT', reason: 'path is not a directory' };

  const files = [];
  const failure = collect(dir, '', files);
  if (failure !== null) return { error: 'INPUT', reason: failure };
  if (files.length === 0) return { error: 'INPUT', reason: 'no files to scan' };

  const findings = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(join(dir, file)).toString('latin1');
    } catch {
      return { error: 'INPUT', reason: `cannot read file: ${file}` };
    }
    for (const { name, kind } of scanText(text)) findings.push({ file, name, kind });
  }
  findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : byName(a, b)));
  if (findings.length > 0) return { ok: false, findings };
  return { ok: true, files: files.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    process.stderr.write('bundle-name-scan: usage: node tooling/bundle-name-scan.mjs <dir>\n');
    process.exit(2);
  }
  const r = scanDir(args[0]);
  if ('error' in r) {
    process.stderr.write(`bundle-name-scan: INPUT: ${r.reason}\n`);
    process.exit(2);
  }
  if (!r.ok) {
    for (const f of r.findings) process.stdout.write(`${f.file} ${f.name} ${f.kind}\n`);
    process.exit(1);
  }
  process.stdout.write(`bundle-name-scan: OK (${r.files} files)\n`);
}
