// O-015 (retro §3.7 C2, C3): which changed doc paths must be treated as code.
// Usage: node ci-referenced.mjs --sha <commit> --changed <file with one path per line>
// Prints the referenced paths (one per line) and exits 0; any git or input
// error exits 1 with nothing on stdout (the caller then passes --changed-error
// to tooling/ci-mode.mjs, which means full mode).
//   C2: every changed path under docs/ that is not *.md counts as referenced.
//   C3: a changed doc path (*.md) counts as referenced when its literal path
//       appears in any non-doc blob of the <sha> tree (not the work tree).
//       Deleted docs are searched too.
// Only node: built-ins and ../../tooling/ci-mode.mjs (isDocPath).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isDocPath } from '../../tooling/ci-mode.mjs';

const fail = (msg) => {
  process.stderr.write(`ci-referenced: ERROR: ${msg}\n`);
  process.exit(1);
};

function git(args, input) {
  const r = spawnSync('git', args, { input, maxBuffer: 512 * 1024 * 1024 });
  if (r.error) fail(`git ${args[0]}: ${r.error.message}`);
  if (r.status !== 0) fail(`git ${args.join(' ')} exited ${String(r.status)}: ${r.stderr.toString().trim()}`);
  return r.stdout;
}

const argv = process.argv.slice(2);
if (argv.length !== 4 || argv[0] !== '--sha' || argv[2] !== '--changed') fail('usage: ci-referenced.mjs --sha <commit> --changed <file>');
const sha = argv[1];
if (!/^[0-9a-f]{40}$/.test(sha)) fail('--sha must be a 40-hex commit id');
let changedText;
try {
  changedText = readFileSync(argv[3], 'utf8');
} catch (e) {
  fail(`cannot read --changed: ${e.message}`);
}
const changed = changedText.split('\n').filter((l) => l !== '');

// Searchable = every blob in the <sha> tree except doc files (*.md that isDocPath accepts).
const isDocMd = (p) => isDocPath(p) && p.endsWith('.md');
const tree = new Map();
for (const rec of git(['ls-tree', '-r', '-z', '--full-tree', sha]).toString('utf8').split('\0')) {
  if (rec === '') continue;
  const tab = rec.indexOf('\t');
  if (tab < 0) fail(`unexpected ls-tree record: ${rec}`);
  const [, type, oid] = rec.slice(0, tab).split(' ');
  if (oid === undefined) fail(`unexpected ls-tree record: ${rec}`);
  tree.set(rec.slice(tab + 1), { type, oid });
}
const searchOids = [...tree.entries()].filter(([p, e]) => e.type === 'blob' && !isDocMd(p)).map(([, e]) => e.oid);
const blobs = [];
if (searchOids.length > 0) {
  const out = git(['cat-file', '--batch'], `${searchOids.join('\n')}\n`);
  let pos = 0;
  for (let n = 0; n < searchOids.length; n += 1) {
    const nl = out.indexOf(0x0a, pos);
    if (nl < 0) fail('truncated cat-file output');
    const header = out.subarray(pos, nl).toString('utf8').split(' ');
    if (header[1] !== 'blob') fail(`cat-file: ${header.join(' ')}`);
    const size = Number(header[2]);
    if (!Number.isSafeInteger(size)) fail('cat-file: bad size');
    blobs.push(out.subarray(nl + 1, nl + 1 + size));
    pos = nl + 1 + size + 1;
  }
}

const candidates = changed; // C3: deleted docs are searched too (no existence filter)
const referenced = [];
for (const p of candidates) {
  if (p.startsWith('docs/') && !p.endsWith('.md')) {
    referenced.push(p); // C2
    continue;
  }
  if (!isDocMd(p)) continue; // code paths are already full in ci-mode (code-path)
  const needle = Buffer.from(p, 'utf8');
  if (blobs.some((b) => b.includes(needle))) referenced.push(p);
}
process.stdout.write(referenced.map((p) => `${p}\n`).join(''));
