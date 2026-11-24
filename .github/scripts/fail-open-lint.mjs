// C2: reject fail-open `|| true`, `|| :`, `|| exit 0`, and `continue-on-error` in verification
// paths, unless a same-line or immediately previous line comment contains
// `o004-allow:` plus a justification.
//
// Scope (defined here; keep this comment in sync with docs/tasks/O-004.md):
//   - all `.github/workflows/*.yml`
//   - all `.github/scripts/*.{sh,mjs,js}`
// Cleanup / best-effort diagnostics may use `|| true` only with `o004-allow:`.
// Verification conclusions (Verify push, ci-ok, key checks, resplit, health
// expected codes) must not.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Allow comments must include a non-empty reason after the colon.
const ALLOW = /o004-allow:\s*\S/;
const OR_TRUE = /\|\|\s*true\b/;
const OR_COLON = /\|\|\s*:(?:\s|$)/;
const OR_EXIT0 = /\|\|\s*exit\s+0\b/;
const CONTINUE = /^\s*continue-on-error\s*:/;

export function lintText(text, filename) {
  const lines = text.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : '';
    const allowed = ALLOW.test(line) || ALLOW.test(prev);
    const commentOnly = /^\s*(#|\/\/)/.test(line);
    if (commentOnly) continue;
    if (OR_TRUE.test(line) && !allowed) {
      hits.push({ file: filename, line: i + 1, text: line.trim(), kind: '|| true' });
    }
    if (OR_COLON.test(line) && !allowed) {
      hits.push({ file: filename, line: i + 1, text: line.trim(), kind: '|| :' });
    }
    if (OR_EXIT0.test(line) && !allowed) {
      hits.push({ file: filename, line: i + 1, text: line.trim(), kind: '|| exit 0' });
    }
    if (CONTINUE.test(line) && !allowed) {
      hits.push({ file: filename, line: i + 1, text: line.trim(), kind: 'continue-on-error' });
    }
  }
  return hits;
}

export function defaultRoots(repoRoot) {
  const files = [];
  const wf = join(repoRoot, '.github/workflows');
  if (statExists(wf)) {
    for (const name of readdirSync(wf)) {
      if (/\.ya?ml$/.test(name)) files.push(join(wf, name));
    }
  }
  const scripts = join(repoRoot, '.github/scripts');
  if (statExists(scripts)) {
    for (const name of readdirSync(scripts)) {
      // Tests and this linter mention "|| true" as data/comments; they are not
      // production verification steps.
      if (/\.test\.mjs$|-test\.sh$|^fail-open-lint\.mjs$/.test(name)) continue;
      if (/\.(sh|mjs|js)$/.test(name)) files.push(join(scripts, name));
    }
  }
  return files;
}

function statExists(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function lintRepo(repoRoot) {
  const hits = [];
  for (const file of defaultRoots(repoRoot)) {
    const rel = relative(repoRoot, file);
    hits.push(...lintText(readFileSync(file, 'utf8'), rel));
  }
  return hits;
}

export function formatHits(hits) {
  if (hits.length === 0) return 'fail-open-lint: no unallowlisted || true, || :, || exit 0, or continue-on-error\n';
  const lines = [
    'ERROR: fail-open-lint: unallowlisted || true, || :, || exit 0, or continue-on-error in a verification path.',
    'Add `# o004-allow: <reason>` on the same or previous line, or remove the fail-open.',
    '',
  ];
  for (const h of hits) {
    lines.push(`${h.file}:${h.line}: ${h.kind}: ${h.text}`);
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const root = process.argv[2] ?? process.cwd();
  const hits = lintRepo(root);
  process.stdout.write(formatHits(hits));
  process.exitCode = hits.length > 0 ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
