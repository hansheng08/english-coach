// Post the run-task summary to an existing PR, or as a commit comment.
// If commenting on the PR returns HTTP 403, fall back to a commit comment.
// Never opens a new PR.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function looksLike403(status, stdout, stderr) {
  if (status === 0) return false;
  const text = `${stdout ?? ''}\n${stderr ?? ''}`;
  return /HTTP\s*403\b/i.test(text)
    || /status[:\s]+403\b/i.test(text)
    || /Resource not accessible/i.test(text);
}

function defaultRunGh(args, opts = {}) {
  return spawnSync('gh', args, {
    encoding: 'utf8',
    input: opts.input,
    env: process.env,
  });
}

function failFrom(r, what) {
  const text = `${r.stderr ?? ''}\n${r.stdout ?? ''}`.trim() || `${what} exit ${r.status}`;
  throw new Error(text);
}

export function commitExistsOnRemote({ repo, sha, runGh }) {
  if (!sha || !repo) return false;
  const r = runGh(['api', `repos/${repo}/commits/${sha}`]);
  return r.status === 0;
}

export function postCommitComment({ repo, sha, bodyFile, runGh }) {
  if (!sha) throw new Error('commit SHA is required for a commit comment');
  if (!repo) throw new Error('repository is required');
  if (!bodyFile || !existsSync(bodyFile)) throw new Error(`body file missing: ${bodyFile ?? ''}`);
  const body = readFileSync(bodyFile, 'utf8');
  const payload = JSON.stringify({ body });
  const r = runGh(
    ['api', '--method', 'POST', `repos/${repo}/commits/${sha}/comments`, '--input', '-'],
    { input: payload },
  );
  if (r.status !== 0) failFrom(r, 'gh api commit comment');
  return { posted: 'commit', sha };
}

export function postRunTaskComment({ repo, prNumber, sha, bodyFile, runGh }) {
  const gh = runGh ?? defaultRunGh;
  if (!bodyFile || !existsSync(bodyFile)) {
    throw new Error(`body file missing: ${bodyFile ?? ''}`);
  }
  if (prNumber) {
    const r = gh(['pr', 'comment', String(prNumber), '--repo', repo, '--body-file', bodyFile]);
    if (r.status === 0) return { posted: 'pr', prNumber: String(prNumber) };
    if (looksLike403(r.status, r.stdout, r.stderr)) {
      // O-026: fallback commit comments only on a SHA that is on the remote.
      if (!commitExistsOnRemote({ repo, sha, runGh: gh })) {
        return { posted: 'skipped', reason: 'sha-not-on-remote', sha, prNumber: String(prNumber), prError: '403' };
      }
      const fallback = postCommitComment({ repo, sha, bodyFile, runGh: gh });
      return { ...fallback, posted: 'commit-fallback', prNumber: String(prNumber), prError: '403' };
    }
    failFrom(r, 'gh pr comment');
  }
  if (!commitExistsOnRemote({ repo, sha, runGh: gh })) {
    return { posted: 'skipped', reason: 'sha-not-on-remote', sha };
  }
  return postCommitComment({ repo, sha, bodyFile, runGh: gh });
}

function parseArgs(argv) {
  const out = { repo: '', pr: '', sha: '', bodyFile: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--repo') { out.repo = next; i++; }
    else if (a === '--pr') { out.pr = next; i++; }
    else if (a === '--sha') { out.sha = next; i++; }
    else if (a === '--body-file') { out.bodyFile = next; i++; }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = postRunTaskComment({
      repo: args.repo || process.env.GITHUB_REPOSITORY,
      prNumber: args.pr || '',
      sha: args.sha || '',
      bodyFile: args.bodyFile,
    });
    console.log(`Posted run-task summary as ${result.posted}${result.prNumber ? ` on PR #${result.prNumber}` : ''}${result.sha ? ` (${result.sha})` : ''}`);
  } catch (err) {
    console.error(`post-run-task-comment: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
