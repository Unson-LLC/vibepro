import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CONTRACT_TEST = 'test/run-context-capsule.test.js';

test('story-vibepro-run-context-capsule AC-1 through AC-7 and S-001 acceptance artifact replay', async () => {
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...childEnv } = process.env;
  const result = await execFileAsync(process.execPath, ['--test', CONTRACT_TEST], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: childEnv,
    maxBuffer: 4 * 1024 * 1024
  });

  assert.match(result.stdout, /# pass 14\b/);
  assert.match(result.stdout, /# fail 0\b/);

  const acceptanceBindings = [
    ['AC-1 AC-2 AC-3', /capsule is typed, bounded, and accounts for every reduced section/],
    ['AC-4', /refresh is byte-stable until a meaningful source changes/],
    ['AC-5', /stale HEAD and missing sources fail closed without rewriting the capsule/],
    ['AC-5 source-set freshness', /newly available optional source stales the old capsule and explicit rebuild recovers it/],
    ['AC-5 parse failure', /malformed capsule and malformed optional JSON fail closed without projection mutation/],
    ['AC-5 authority failure', /atomic authority failure preserves the previous capsule bytes/],
    ['AC-5 mirror failure', /mirror failure is typed after the authority commits/],
    ['AC-5 active Run ambiguity', /multiple active runs produce an explicit ambiguous result/],
    ['AC-5 Story binding', /mismatched Story frontmatter fails closed before capsule creation/],
    ['AC-6 S-001 restart', /fresh-process recovery reconstructs the blocker and decision context without transcript input/],
    ['AC-4 AC-6 S-001 handoff', /managed refresh mirrors exact bytes and a new process recovers decisions/],
    ['AC-7 contract matrix', /dependency contract is closed and authoritative bytes override caller snapshots/]
  ];

  for (const [binding, pattern] of acceptanceBindings) {
    assert.match(result.stdout, pattern, `${binding} must remain executable from the Story acceptance replay`);
  }

  assert.match(result.stdout, /capsule is typed, bounded, and accounts for every reduced section/, 'story-vibepro-run-context-capsule ac:1 typed bounded projection remains executable');
  assert.match(result.stdout, /capsule is typed, bounded, and accounts for every reduced section/, 'story-vibepro-run-context-capsule ac:2 required fields and truncation accounting remain executable');
  assert.match(result.stdout, /capsule is typed, bounded, and accounts for every reduced section/, 'story-vibepro-run-context-capsule ac:3 context budget remains executable');
  assert.match(result.stdout, /refresh is byte-stable until a meaningful source changes/, 'story-vibepro-run-context-capsule ac:4 deterministic refresh remains executable');
  assert.match(result.stdout, /stale HEAD and missing sources fail closed without rewriting the capsule/, 'story-vibepro-run-context-capsule ac:5 stale and missing source recovery remains executable');
  assert.match(result.stdout, /fresh-process recovery reconstructs the blocker and decision context without transcript input/, 'story-vibepro-run-context-capsule ac:6 restart and handoff recovery remains executable');
  assert.match(result.stdout, /dependency contract is closed and authoritative bytes override caller snapshots/, 'story-vibepro-run-context-capsule ac:7 closed dependency contract remains executable');

  assert.match(
    result.stdout,
    /fresh-process recovery reconstructs the blocker and decision context without transcript input/,
    'story-vibepro-run-context-capsule S-001: After a process restart or managed-worktree handoff, a fresh process reconstructs the current blocker, open decisions, evidence references, budget, and progress from persisted files without transcript input.'
  );
});
