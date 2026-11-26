import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { looksLike403, postRunTaskComment } from './post-run-task-comment.mjs';

test('looksLike403 detects HTTP 403 and Resource not accessible', () => {
  assert.equal(looksLike403(1, '', 'HTTP 403: Resource not accessible by integration'), true);
  assert.equal(looksLike403(1, 'GraphQL: Resource not accessible by personal access token', ''), true);
  assert.equal(looksLike403(1, '', 'HTTP 404: Not Found'), false);
  assert.equal(looksLike403(0, '', 'HTTP 403'), false);
});

function withBody(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'post-sum-'));
  const bodyFile = join(dir, 'body.md');
  writeFileSync(bodyFile, '## run-task summary\n');
  try {
    return fn(bodyFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('posts to an existing PR when gh pr comment succeeds', () => {
  withBody((bodyFile) => {
    const calls = [];
    const result = postRunTaskComment({
      repo: 'o/r',
      prNumber: '18',
      sha: 'abc',
      bodyFile,
      runGh: (args) => {
        calls.push(args);
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(result.posted, 'pr');
    assert.equal(result.prNumber, '18');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 3), ['pr', 'comment', '18']);
  });
});

test('403 on gh pr comment falls back to a commit comment', () => {
  withBody((bodyFile) => {
    const calls = [];
    const result = postRunTaskComment({
      repo: 'o/r',
      prNumber: '18',
      sha: 'deadbeef',
      bodyFile,
      runGh: (args, opts = {}) => {
        calls.push({ args, input: opts.input });
        if (args[0] === 'pr') {
          return { status: 1, stdout: '', stderr: 'HTTP 403: Resource not accessible by integration' };
        }
        return { status: 0, stdout: '{"id":1}', stderr: '' };
      },
    });
    assert.equal(result.posted, 'commit-fallback');
    assert.equal(result.sha, 'deadbeef');
    assert.equal(result.prError, '403');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].args[0], 'pr');
    assert.equal(calls[1].args[0], 'api');
    assert.match(calls[1].args.join(' '), /repos\/o\/r\/commits\/deadbeef\/comments/);
    assert.match(calls[1].input, /run-task summary/);
  });
});

test('non-403 PR comment failure does not fall back and throws', () => {
  withBody((bodyFile) => {
    let commitCalled = false;
    assert.throws(() => postRunTaskComment({
      repo: 'o/r',
      prNumber: '18',
      sha: 'deadbeef',
      bodyFile,
      runGh: (args) => {
        if (args[0] === 'api') commitCalled = true;
        return { status: 1, stdout: '', stderr: 'HTTP 502: Bad Gateway' };
      },
    }), /HTTP 502/);
    assert.equal(commitCalled, false);
  });
});

test('no PR number posts a commit comment', () => {
  withBody((bodyFile) => {
    const result = postRunTaskComment({
      repo: 'o/r',
      prNumber: '',
      sha: 'cafe',
      bodyFile,
      runGh: (args) => {
        assert.equal(args[0], 'api');
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(result.posted, 'commit');
    assert.equal(result.sha, 'cafe');
  });
});

const UNPUSHED = '7fb74cce397e9b84de590497893677260662590c';
const PUSHED = '28367c8c2e7dace35fda16b7c697cda11f27e7ee';

// Fake gh: only PUSHED exists on the remote. Lookups of other SHAs are 404 and a
// POST to .../comments for them answers 422 (as GitHub does) and is recorded.
function fakeRemoteGh(posts) {
  return (args, opts = {}) => {
    const joined = args.join(' ');
    const isPost = args.includes('POST') && /\/comments(\s|$)/.test(joined);
    if (isPost) {
      posts.push({ args, input: opts.input });
      if (!joined.includes(PUSHED)) {
        return { status: 1, stdout: '', stderr: `gh: No commit found for SHA: ${UNPUSHED} (HTTP 422)` };
      }
      return { status: 0, stdout: '{"id":1}', stderr: '' };
    }
    if (args[0] === 'pr') return { status: 0, stdout: '', stderr: '' };
    if (joined.includes(PUSHED)) return { status: 0, stdout: `{"sha":"${PUSHED}"}`, stderr: '' };
    return { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
  };
}

test('(AC-O26-5) (TC-7) unpushed SHA gets no commit comment and does not throw', () => {
  withBody((bodyFile) => {
    const posts = [];
    const result = postRunTaskComment({
      repo: 'o/r', prNumber: '', sha: UNPUSHED, bodyFile, runGh: fakeRemoteGh(posts),
    });
    assert.equal(posts.length, 0);
    assert.notEqual(result.posted, 'commit');
    assert.notEqual(result.posted, 'commit-fallback');
  });
});

test('(AC-O26-5) (TC-7) PR 403 fallback with an unpushed SHA posts no commit comment', () => {
  withBody((bodyFile) => {
    const posts = [];
    const base = fakeRemoteGh(posts);
    const result = postRunTaskComment({
      repo: 'o/r', prNumber: '18', sha: UNPUSHED, bodyFile,
      runGh: (args, opts) => (args[0] === 'pr'
        ? { status: 1, stdout: '', stderr: 'HTTP 403: Resource not accessible by integration' }
        : base(args, opts)),
    });
    assert.equal(posts.length, 0);
    assert.notEqual(result.posted, 'commit-fallback');
  });
});

test('(AC-O26-5) pushed SHA still gets a commit comment', () => {
  withBody((bodyFile) => {
    const posts = [];
    const result = postRunTaskComment({
      repo: 'o/r', prNumber: '', sha: PUSHED, bodyFile, runGh: fakeRemoteGh(posts),
    });
    assert.equal(result.posted, 'commit');
    assert.equal(posts.length, 1);
    assert.match(posts[0].args.join(' '), new RegExp(`repos/o/r/commits/${PUSHED}/comments`));
  });
});

test('(AC-O26-5) pushed SHA with PR 403 still falls back to a commit comment', () => {
  withBody((bodyFile) => {
    const posts = [];
    const base = fakeRemoteGh(posts);
    const result = postRunTaskComment({
      repo: 'o/r', prNumber: '18', sha: PUSHED, bodyFile,
      runGh: (args, opts) => (args[0] === 'pr'
        ? { status: 1, stdout: '', stderr: 'HTTP 403: Resource not accessible by integration' }
        : base(args, opts)),
    });
    assert.equal(result.posted, 'commit-fallback');
    assert.equal(posts.length, 1);
  });
});

test('missing body file fails closed', () => {
  assert.throws(() => postRunTaskComment({
    repo: 'o/r',
    prNumber: '18',
    sha: 'abc',
    bodyFile: '/no/such/file.md',
    runGh: () => ({ status: 0, stdout: '', stderr: '' }),
  }), /body file missing/);
});

