import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { persistCanonicalArtifactsToBase } from '../src/canonical-persistence.js';

const execFileAsync = promisify(execFile);

test('GDL-CONTRACT-008 persists prepared files atomically and dedupes identical revisions', async () => {
  const fixture = await createRepository();
  const relativeDir = 'docs/management/audit-artifacts/story-outcome';
  const revisionPath = `${relativeDir}/decision-outcomes/trace-1/rev-1.json`;
  const input = {
    repoRoot: fixture.root,
    storyId: 'story-outcome',
    relativeDir,
    allowedRoots: [relativeDir],
    baseBranch: 'main',
    mergeCommitSha: fixture.head,
    prepare: async () => ({ files: new Map([[revisionPath, '{"revision":1}\n']]), metadata: { revision: 1 } })
  };
  const first = await persistCanonicalArtifactsToBase(input);
  assert.equal(first.summary.status, 'pushed');
  assert.deepEqual(first.prepared, { revision: 1 });
  const second = await persistCanonicalArtifactsToBase(input);
  assert.equal(second.summary.status, 'already_present');
  assert.equal(second.summary.cleanup.removed, true);

  const changed = await persistCanonicalArtifactsToBase({
    ...input,
    prepare: async () => ({
      files: new Map([[`${relativeDir}/decision-outcomes/trace-1/rev-2.json`, '{"revision":2}\n']]),
      metadata: { revision: 2 }
    })
  });
  assert.equal(changed.summary.status, 'pushed');
  assert.deepEqual(changed.prepared, { revision: 2 });
});

test('GDL-CONTRACT-008 rejects prepared files outside canonical roots and cleans the worktree', async () => {
  const fixture = await createRepository();
  const relativeDir = 'docs/management/audit-artifacts/story-outcome';
  const result = await persistCanonicalArtifactsToBase({
    repoRoot: fixture.root,
    storyId: 'story-outcome',
    relativeDir,
    allowedRoots: [relativeDir],
    baseBranch: 'main',
    mergeCommitSha: fixture.head,
    prepare: async () => ({ files: new Map([['src/untrusted.js', 'nope\n']]), metadata: null })
  });
  assert.equal(result.summary.status, 'failed');
  assert.equal(result.summary.reason, 'canonical_path_not_allowed');
  assert.equal(result.summary.cleanup.removed, true);
});

test('GDL-CONTRACT-008 rejects a concurrent canonical base advance and cleans the worktree', async () => {
  const fixture = await createRepository();
  const relativeDir = 'docs/management/audit-artifacts/story-outcome';
  const result = await persistCanonicalArtifactsToBase({
    repoRoot: fixture.root,
    storyId: 'story-outcome',
    relativeDir,
    allowedRoots: [relativeDir],
    baseBranch: 'main',
    mergeCommitSha: fixture.head,
    prepare: async () => ({ files: new Map([[`${relativeDir}/bundle.json`, '{}\n']]), metadata: { revision: 1 } }),
    options: {
      beforePush: async () => {
        await writeFile(path.join(fixture.root, 'CONCURRENT.md'), 'advance\n');
        await git(fixture.root, ['add', 'CONCURRENT.md']);
        await git(fixture.root, ['commit', '-m', 'test: advance canonical base']);
        await git(fixture.root, ['push', 'origin', 'main']);
      }
    }
  });
  assert.equal(result.summary.status, 'failed');
  assert.equal(result.summary.reason, 'canonical_audit_concurrent_base_update');
  assert.equal(result.summary.cleanup.removed, true);
});

test('GDL-CONTRACT-008 reports prepare and write failures without changing the remote base', async () => {
  for (const scenario of [
    {
      reason: 'canonical_audit_prepare_failed',
      overrides: { prepare: async () => { throw new Error('prepare fault'); } }
    },
    {
      reason: 'canonical_audit_write_failed',
      overrides: { options: { writeFile: async () => { throw new Error('write fault'); } } }
    }
  ]) {
    const fixture = await createRepository();
    const before = await remoteHead(fixture.root);
    const result = await persistCanonicalArtifactsToBase({
      ...canonicalInput(fixture),
      ...scenario.overrides,
      options: scenario.overrides.options ?? {}
    });
    assert.equal(result.summary.reason, scenario.reason);
    assert.equal(result.summary.status, 'failed');
    assert.equal(result.summary.pushed, false);
    assert.equal(result.summary.cleanup.attempted, true);
    assert.equal(result.summary.cleanup.removed, true);
    assert.equal(await remoteHead(fixture.root), before);
    assert.equal(await exists(result.summary.worktree_path), false);
  }
});

test('GDL-CONTRACT-008 reports stage commit push and pre-push fetch failures without partial push', async () => {
  for (const scenario of [
    { match: 'git add --', occurrence: 1, reason: 'canonical_audit_git_add_failed' },
    { match: 'git commit -m', occurrence: 1, reason: 'canonical_audit_commit_failed' },
    { match: 'git fetch origin main', occurrence: 2, reason: 'canonical_audit_pre_push_base_fetch_failed' },
    { match: 'git push origin HEAD:main', occurrence: 1, reason: 'canonical_audit_push_failed' }
  ]) {
    const fixture = await createRepository();
    const before = await remoteHead(fixture.root);
    const commandRunner = failCommand(scenario.match, scenario.occurrence);
    const result = await persistCanonicalArtifactsToBase({
      ...canonicalInput(fixture),
      options: { commandRunner }
    });
    assert.equal(result.summary.reason, scenario.reason, scenario.match);
    assert.equal(result.summary.status, 'failed');
    assert.equal(result.summary.pushed, false);
    assert.equal(result.summary.cleanup.removed, true);
    assert.ok(result.summary.commands.some((command) => command.includes(scenario.match.replace(' --', ''))));
    assert.ok(result.summary.results.some((entry) => entry.exit_code !== 0));
    assert.equal(await remoteHead(fixture.root), before);
    assert.equal(await exists(result.summary.worktree_path), false);
  }
});

test('GDL-CONTRACT-008 reports initial fetch and cleanup failures with honest diagnostics', async () => {
  const fetchFixture = await createRepository();
  const fetchBefore = await remoteHead(fetchFixture.root);
  const fetchFailure = await persistCanonicalArtifactsToBase({
    ...canonicalInput(fetchFixture),
    options: { commandRunner: failCommand('git fetch origin main', 1) }
  });
  assert.equal(fetchFailure.summary.reason, 'canonical_audit_post_merge_base_fetch_failed');
  assert.equal(fetchFailure.summary.cleanup.attempted, false);
  assert.equal(fetchFailure.summary.pushed, false);
  assert.equal(await remoteHead(fetchFixture.root), fetchBefore);

  const cleanupFixture = await createRepository();
  const cleanupFailure = await persistCanonicalArtifactsToBase({
    ...canonicalInput(cleanupFixture),
    options: { commandRunner: failCommand('git worktree remove --force', 1) }
  });
  assert.equal(cleanupFailure.summary.status, 'failed');
  assert.equal(cleanupFailure.summary.pushed, true);
  assert.match(cleanupFailure.summary.reason, /cleanup_failed/);
  assert.equal(cleanupFailure.summary.cleanup.attempted, true);
  assert.equal(cleanupFailure.summary.cleanup.removed, false);
  assert.equal(cleanupFailure.summary.cleanup.exit_code, 97);
  assert.equal(cleanupFailure.summary.cleanup.status, 'failed');
  assert.ok(cleanupFailure.summary.results.some((entry) => entry.command.includes('worktree remove') && entry.exit_code === 97));
  await git(cleanupFixture.root, ['worktree', 'remove', '--force', cleanupFailure.summary.worktree_path]);
  await rm(cleanupFailure.summary.worktree_path, { recursive: true, force: true });
});

test('GDL-CONTRACT-010 applies an outer deadline to injected runners and preserves primary cleanup state', async () => {
  const fixture = await createRepository();
  const startedAt = Date.now();
  const result = await persistCanonicalArtifactsToBase({
    ...canonicalInput(fixture),
    options: {
      commandTimeoutMs: 50,
      commandRunner: ({ command, runDefault }) => {
        const rendered = [command[0], ...command[1]].join(' ');
        return rendered.includes('git fetch origin main') ? new Promise(() => {}) : runDefault();
      }
    }
  });

  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(result.summary.status, 'failed');
  assert.equal(result.summary.reason, 'canonical_audit_post_merge_base_fetch_failed');
  assert.equal(result.summary.failure.failure_kind, 'runner_timeout');
  assert.equal(result.summary.cleanup.status, 'not_required');
  assert.equal(result.summary.cleanup.attempted, false);
});

test('GDL-CONTRACT-010 cleans a partially acquired worktree within an independent deadline', async () => {
  const fixture = await createRepository();
  let addApplied = false;
  const result = await persistCanonicalArtifactsToBase({
    ...canonicalInput(fixture),
    options: {
      commandTimeoutMs: 750,
      cleanupTimeoutMs: 500,
      commandRunner: async ({ command, runDefault }) => {
        const rendered = [command[0], ...command[1]].join(' ');
        if (rendered.includes('git worktree add') && !addApplied) {
          addApplied = true;
          const applied = await runDefault();
          assert.equal(applied.exit_code, 0);
          return new Promise(() => {});
        }
        return runDefault();
      }
    }
  });

  assert.equal(result.summary.status, 'failed');
  assert.equal(result.summary.reason, 'canonical_audit_worktree_add_failed');
  assert.equal(result.summary.primary.failure.failure_kind, 'runner_timeout');
  assert.equal(result.summary.resource.acquisition, 'partially_acquired');
  assert.equal(result.summary.cleanup.status, 'removed');
  assert.equal(result.summary.cleanup.removed, true);
  assert.equal(await exists(result.summary.worktree_path), false);
});

test('GDL-CONTRACT-008 cleans a worktree created before an ordinary nonzero add result', async () => {
  const fixture = await createRepository();
  let addApplied = false;
  const result = await persistCanonicalArtifactsToBase({
    ...canonicalInput(fixture),
    options: {
      commandRunner: async ({ command, runDefault }) => {
        const rendered = [command[0], ...command[1]].join(' ');
        if (rendered.includes('git worktree add') && !addApplied) {
          addApplied = true;
          const applied = await runDefault();
          assert.equal(applied.exit_code, 0);
          return { ...applied, status: 'failed', exit_code: 1, stderr: 'post-add hook failed' };
        }
        return runDefault();
      }
    }
  });

  assert.equal(result.summary.primary.reason, 'canonical_audit_worktree_add_failed');
  assert.equal(result.summary.resource.acquisition, 'partially_acquired');
  assert.equal(result.summary.cleanup.status, 'removed');
  assert.equal(result.summary.cleanup.removed, true);
  assert.equal(await exists(result.summary.worktree_path), false);
});

test('GDL-CONTRACT-010 bounds cleanup independently without replacing the primary result', async () => {
  const fixture = await createRepository();
  const result = await persistCanonicalArtifactsToBase({
    ...canonicalInput(fixture),
    options: {
      commandTimeoutMs: 500,
      cleanupTimeoutMs: 50,
      commandRunner: ({ command, runDefault }) => {
        const rendered = [command[0], ...command[1]].join(' ');
        return rendered.includes('git worktree remove --force') ? new Promise(() => {}) : runDefault();
      }
    }
  });

  assert.equal(result.summary.status, 'failed');
  assert.equal(result.summary.pushed, true);
  assert.equal(result.summary.primary.status, 'pushed');
  assert.equal(result.summary.cleanup.status, 'timed_out');
  assert.equal(result.summary.cleanup.failure.failure_kind, 'runner_timeout');
  assert.match(result.summary.reason, /cleanup_failed/);
  await git(fixture.root, ['worktree', 'remove', '--force', result.summary.worktree_path]);
  await rm(result.summary.worktree_path, { recursive: true, force: true });
});

test('GDL-CONTRACT-011 resolves timed-out push postconditions as applied not_applied or indeterminate', async () => {
  for (const expected of ['applied', 'not_applied', 'indeterminate']) {
    const fixture = await createRepository();
    const before = await remoteHead(fixture.root);
    let pushSeen = false;
    const result = await persistCanonicalArtifactsToBase({
      ...canonicalInput(fixture),
      options: {
        commandTimeoutMs: 5_000,
        pushTimeoutMs: 5_000,
        // Real git ls-remote can exceed the push deadline on a loaded host.
        // Keep only the deliberately hung push short while giving setup Git
        // commands and observable postconditions independent realistic budgets.
        postconditionTimeoutMs: expected === 'indeterminate' ? 100 : 5_000,
        commandRunner: async ({ command, runDefault }) => {
          const rendered = [command[0], ...command[1]].join(' ');
          if (rendered.includes('git push origin HEAD:main') && !pushSeen) {
            pushSeen = true;
            if (expected === 'applied') {
              const pushed = await runDefault();
              assert.equal(pushed.exit_code, 0);
            }
            return new Promise(() => {});
          }
          if (pushSeen && expected === 'indeterminate' && rendered.includes('git ls-remote origin refs/heads/main')) {
            return new Promise(() => {});
          }
          return runDefault();
        }
      }
    });

    assert.equal(result.summary.push_postcondition.status, expected);
    if (expected === 'applied') {
      assert.equal(result.summary.status, 'pushed');
      assert.equal(result.summary.pushed, true);
      assert.equal(await remoteHead(fixture.root), result.summary.commit_sha);
    } else {
      assert.equal(result.summary.status, 'failed');
      assert.equal(result.summary.pushed, false);
      assert.equal(await remoteHead(fixture.root), before);
      assert.equal(result.summary.reason, expected === 'not_applied'
        ? 'canonical_audit_push_failed'
        : 'canonical_audit_push_indeterminate');
    }
    assert.equal(result.summary.cleanup.removed, true);
  }
});

function canonicalInput(fixture) {
  const relativeDir = 'docs/management/audit-artifacts/story-outcome';
  return {
    repoRoot: fixture.root,
    storyId: 'story-outcome',
    relativeDir,
    allowedRoots: [relativeDir],
    baseBranch: 'main',
    mergeCommitSha: fixture.head,
    prepare: async () => ({ files: new Map([[`${relativeDir}/bundle.json`, '{}\n']]), metadata: { revision: 1 } })
  };
}

function failCommand(fragment, occurrence) {
  let seen = 0;
  return async ({ command, runDefault }) => {
    const rendered = [command[0], ...command[1]].join(' ');
    if (rendered.includes(fragment) && ++seen === occurrence) {
      const now = new Date().toISOString();
      return { command: rendered, started_at: now, finished_at: now, exit_code: 97, stdout: '', stderr: `injected ${fragment} fault` };
    }
    return runDefault();
  };
}

async function remoteHead(root) {
  return (await git(root, ['ls-remote', 'origin', 'refs/heads/main'])).stdout.split(/\s+/)[0];
}

async function exists(target) {
  try { await access(target); return true; } catch { return false; }
}

async function createRepository() {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'vibepro-canonical-persistence-'));
  const root = path.join(parent, 'repo');
  const remote = path.join(parent, 'remote.git');
  await mkdir(root);
  await git(parent, ['init', '--bare', remote]);
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await git(root, ['config', 'user.email', 'vibepro@example.test']);
  await writeFile(path.join(root, 'README.md'), 'fixture\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-m', 'test: initialize fixture']);
  await git(root, ['remote', 'add', 'origin', remote]);
  await git(root, ['push', '-u', 'origin', 'main']);
  const head = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  return { root, head };
}

function git(cwd, args) {
  return execFileAsync('git', args, { cwd, encoding: 'utf8' });
}
