import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as real from './bundle-name-scan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, 'bundle-name-scan.mjs');
const SELF = join(here, 'bundle-name-scan.test.mjs');

const BACKEND = [
  'GEMINI_API_KEY',
  'GEMINI_PAID_API_KEY',
  'GROQ_API_KEY',
  'AZURE_SPEECH_KEY',
  'SUPABASE_SECRET_KEYS',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
];
const ALLOWED = ['VITE_DATA_MODE', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];
const NOT_ALLOWED = [
  'VITE_',
  'VITE_DATA_MODE_X',
  'VITE_DATA_MODEx',
  'VITE_data_mode',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_API_TOKEN',
];
const FAKE = 'fake-value-o029';

const tmpRoots = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'o029-'));
  tmpRoots.push(d);
  return d;
};
afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
});

const put = (root, rel, data) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
};

const hitTree = () => {
  const d = tmp();
  put(d, 'a/b/c/deep.js', 'x GROQ_API_KEY y');
  put(d, 'a.js.map', 'GEMINI_API_KEY');
  put(d, 'index.html', '<p>VITE_SECRET_THING</p>');
  put(d, '.hidden', 'AZURE_SPEECH_KEY');
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  put(d, 'bin.dat', Buffer.concat([bytes, Buffer.from('SUPABASE_DB_URL'), bytes]));
  return d;
};
const HIT_FILES = ['.hidden', 'a.js.map', 'a/b/c/deep.js', 'bin.dat', 'index.html'];

const cleanTree = () => {
  const d = tmp();
  put(d, 'index.html', '<p>hello</p>');
  put(d, 'assets/app.js', 'VITE_DATA_MODE VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY');
  put(d, '.nojs', 'nothing');
  return d;
};

const cli = (script, ...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const names = (r) => r.map((x) => `${x.name}:${x.kind}`);

// Each check returns true when the module behaves as specified. Mutants must make at least one fail.
const checks = {
  tc1: (m) =>
    Object.isFrozen(m.BACKEND_NAMES) &&
    Object.isFrozen(m.ALLOWED_VITE_NAMES) &&
    m.BACKEND_NAMES.length === 8 &&
    m.ALLOWED_VITE_NAMES.length === 3 &&
    BACKEND.every((n) => m.BACKEND_NAMES.includes(n)) &&
    ALLOWED.every((n) => m.ALLOWED_VITE_NAMES.includes(n)),
  tc2: (m) =>
    BACKEND.every((n) => m.scanText(`a ${n} b`).some((x) => x.name === n && x.kind === 'backend')) &&
    BACKEND.every((n) => m.scanText(`X${n}_2`).some((x) => x.name === n)) &&
    m.scanText('XGROQ_API_KEY_2').some((x) => x.name === 'GROQ_API_KEY') &&
    names(m.scanText('SUPABASE_SECRET_KEYS')).join() ===
      'SUPABASE_SECRET_KEY:backend,SUPABASE_SECRET_KEYS:backend',
  tc3: (m) =>
    ALLOWED.every((n) => m.scanText(n).length === 0) &&
    m.scanText(ALLOWED.join(' ')).length === 0 &&
    m.scanText('vite_data_mode').length === 0,
  tc4: (m) =>
    NOT_ALLOWED.every((n) => {
      const r = m.scanText(`x ${n} y`);
      return r.length === 1 && r[0].kind === 'vite' && r[0].name === n;
    }) && m.scanText('VITE_DATA_MODE_X').every((x) => x.name !== 'VITE_DATA_MODE'),
  tc5: (m) => {
    const r = m.scanDir(hitTree());
    return r.ok === false && r.findings.map((f) => f.file).join() === HIT_FILES.join();
  },
  tc6: (m, script) => {
    const d = cleanTree();
    const r = m.scanDir(d);
    const c = cli(script, d);
    return r.ok === true && r.files === 3 && c.status === 0;
  },
  tc7: (_m, script) => cli(script, hitTree()).status === 1,
  tc8: (_m, script) => {
    const empty = tmp();
    const plainFile = join(tmp(), 'f.txt');
    writeFileSync(plainFile, 'x');
    const withLink = tmp();
    put(withLink, 'real.txt', 'hello');
    symlinkSync(join(withLink, 'real.txt'), join(withLink, 'link.txt'));
    const linkDir = tmp();
    put(linkDir, 'sub/f.txt', 'hello');
    symlinkSync(join(linkDir, 'sub'), join(linkDir, 'subLink'));
    const bad = [
      [],
      [cleanTree(), cleanTree()],
      [join(tmp(), 'missing')],
      [plainFile],
      [empty],
      [withLink],
      [linkDir],
    ];
    return bad.every((a) => cli(script, ...a).status === 2);
  },
  tc9: (_m, script) => {
    const d = tmp();
    put(d, 'x.js', `GROQ_API_KEY=${FAKE}\nVITE_X=${FAKE}\n`);
    const c = cli(script, d);
    return (
      c.status === 1 &&
      c.stdout.includes('GROQ_API_KEY') &&
      c.stdout.includes('VITE_X') &&
      !c.stdout.includes(FAKE) &&
      !c.stderr.includes(FAKE) &&
      c.stdout.trim().split('\n').every((l) => l.split(' ').length === 3)
    );
  },
  nonString: (m) => {
    for (const bad of [undefined, null, 1, {}, []]) {
      try {
        const r = m.scanText(bad);
        if (Array.isArray(r) && r.length === 0) return false;
        if (!r || r.error !== 'INPUT') return false;
      } catch {
        // throwing is allowed
      }
    }
    return true;
  },
};

const ALL = Object.keys(checks);
const failing = (m, script) => ALL.filter((k) => !checks[k](m, script));

describe('bundle-name-scan', () => {
  it('(AC-O29-1) (TC-1) name lists are frozen and exact', () => {
    expect(checks.tc1(real)).toBe(true);
    expect([...real.BACKEND_NAMES].sort()).toEqual([...BACKEND].sort());
    expect([...real.ALLOWED_VITE_NAMES].sort()).toEqual([...ALLOWED].sort());
    expect(() => real.BACKEND_NAMES.push('X')).toThrow();
  });

  it('(AC-O29-2) (TC-2) every backend name is found as a substring', () => {
    expect(checks.tc2(real)).toBe(true);
  });

  it('(AC-O29-3) (TC-3) allowed VITE names pass', () => {
    expect(checks.tc3(real)).toBe(true);
  });

  it('(AC-O29-3) (TC-4) other VITE names are findings', () => {
    expect(checks.tc4(real)).toBe(true);
  });

  it('(AC-O29-2) (TC-2) scanText rejects non-strings', () => {
    expect(checks.nonString(real)).toBe(true);
  });

  it('(AC-O29-4) (TC-5) scanDir finds names in nested, map, html, dot and binary files', () => {
    expect(checks.tc5(real, SRC)).toBe(true);
  });

  it('(AC-O29-5) (TC-6) clean folder is ok and exits 0', () => {
    expect(checks.tc6(real, SRC)).toBe(true);
  });

  it('(AC-O29-5) (TC-7) findings exit 1', () => {
    expect(checks.tc7(real, SRC)).toBe(true);
  });

  it('(AC-O29-5) (TC-8) input errors exit 2', () => {
    expect(checks.tc8(real, SRC)).toBe(true);
  });

  it('(AC-O29-6) (TC-9) output never contains values', () => {
    expect(checks.tc9(real, SRC)).toBe(true);
  });

  it('(AC-O29-7) (TC-10) the real module passes every check', () => {
    expect(failing(real, SRC)).toEqual([]);
  });

  const source = readFileSync(SRC, 'utf8');
  const mutants = [
    ...BACKEND.map((n) => [`drop ${n}`, `  '${n}',\n`, '']),
    [
      'startsWith allowlist',
      '!ALLOWED_VITE_NAMES.includes(name)',
      '!ALLOWED_VITE_NAMES.some((a) => name.startsWith(a))',
    ],
    ['case-insensitive allowlist', '!ALLOWED_VITE_NAMES.includes(name)', '!ALLOWED_VITE_NAMES.includes(name.toUpperCase())'],
    ['skip .map', 'else if (entry.isFile()) {', "else if (entry.isFile() && !entry.name.endsWith('.map')) {"],
    ['skip .html', 'else if (entry.isFile()) {', "else if (entry.isFile() && !entry.name.endsWith('.html')) {"],
    ['skip dot files', 'else if (entry.isFile()) {', "else if (entry.isFile() && !entry.name.startsWith('.')) {"],
    ['no recursion', 'const failure = collect(join(dir, entry.name), relPath, out);', 'const failure = null;'],
    [
      'empty folder passes',
      "if (files.length === 0) return { error: 'INPUT', reason: 'no files to scan' };",
      'if (files.length === 0) return { ok: true, files: 0 };',
    ],
    ['follow symlinks', 'if (entry.isSymbolicLink()) return', 'if (false) return'],
    ['exit 0 with findings', '    process.exit(1);', '    process.exit(0);'],
    [
      'print file content',
      '${f.file} ${f.name} ${f.kind}\\n',
      "${f.file} ${f.name} ${f.kind} ${readFileSync(join(args[0], f.file), 'latin1')}\\n",
    ],
  ];

  it.each(mutants)('(AC-O29-7) (TC-10) mutant is killed: %s', async (label, from, to) => {
    expect(source.includes(from), `pattern for "${label}" not found`).toBe(true);
    const dir = tmp();
    const script = join(dir, 'mutant.mjs');
    writeFileSync(script, source.replace(from, to));
    const m = await import(`${pathToFileURL(script).href}?m=${encodeURIComponent(label)}`);
    expect(failing(m, script).length).toBeGreaterThan(0);
  });

  it('(AC-O29-8) (TC-11) no unallowed fail-open constructs in new files', () => {
    const bad = [new RegExp('\\|\\|\\s*' + 'true'), new RegExp('continue-on' + '-error')];
    for (const f of [SRC, SELF]) {
      const text = readFileSync(f, 'utf8');
      for (const re of bad) expect(re.test(text), `${f} matches ${re}`).toBe(false);
    }
  });
});
