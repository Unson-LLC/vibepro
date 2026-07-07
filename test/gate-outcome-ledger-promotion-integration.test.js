// Integration coverage for RML-CONTRACT-001 ("promotion rides the existing
// persistence commit") and RML-CONTRACT-002/003 (dedupe + deterministic
// serialization) at the real-git level. The unit tests in
// test/gate-outcome-ledger-central-promotion.test.js exercise
// computeCentralLedgerPromotion() purely in-memory; this file drives the same
// production function through an actual git worktree/commit/push sequence
// (mirroring src/merge-manager.js's persistCanonicalAuditToBase wiring) to
// prove the ledger write really lands inside the same commit as the other
// persisted artifacts, not a follow-up commit.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH,
  computeCentralLedgerPromotion
} from '../src/gate-outcome-ledger.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

function entry(overrides = {}) {
  return {
    schema_version: '0.1.0',
    entry_key: 'story-x|gate:requirement|needs_review|passed|prev|curr',
    story_id: 'story-x',
    gate_id: 'gate:requirement',
    outcome: 'source_fix',
    classification: 'resolving_diff_contains_source_changes',
    resolved_at: '2026-07-07T00:00:00.000Z',
    ...overrides
  };
}

// Mirrors the relevant slice of persistCanonicalAuditToBase in
// src/merge-manager.js: add a detached worktree on the base ref, write the
// canonical-audit bundle path and (if promotable) the central ledger path,
// stage both, and commit exactly once.
async function commitCanonicalAuditAndLedgerPromotion(remote, {
  auditRelativeDir,
  auditFileContents,
  localEntries
}) {
  const worktreeParent = await mkdtemp(path.join(os.tmpdir(), 'vibepro-rml-integration-worktree-'));
  const worktree = path.join(worktreeParent, 'repo');
  await git(process.cwd(), ['clone', remote, worktree]);

  const auditDestination = path.join(worktree, auditRelativeDir);
  await mkdir(auditDestination, { recursive: true });
  await writeFile(path.join(auditDestination, 'bundle.json'), auditFileContents);

  const centralPath = path.join(worktree, CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH);
  const centralText = await readFile(centralPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const promotion = computeCentralLedgerPromotion({ localEntries, centralText });

  const stagePaths = [auditRelativeDir];
  if (promotion.status === 'promoted' && promotion.serialized !== null) {
    await mkdir(path.dirname(centralPath), { recursive: true });
    await writeFile(centralPath, promotion.serialized);
    stagePaths.push(CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH);
  }

  await git(worktree, ['add', '--', ...stagePaths]);
  await git(worktree, ['commit', '-m', 'docs: persist VibePro audit artifacts + roi ledger promotion']);
  const commitSha = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(worktree, ['push', 'origin', 'HEAD:main']);

  return { worktree, commitSha, promotion };
}

test('RML-CONTRACT-001 (integration): ledger promotion lands in the same commit as canonical audit persistence, not a follow-up commit', async () => {
  const remote = await mkdtemp(path.join(os.tmpdir(), 'vibepro-rml-integration-remote-'));
  await git(remote, ['init', '--bare', '-b', 'main']);

  const seedCloneParent = await mkdtemp(path.join(os.tmpdir(), 'vibepro-rml-integration-seed-'));
  const seedClone = path.join(seedCloneParent, 'repo');
  await git(process.cwd(), ['clone', remote, seedClone]);
  await git(seedClone, ['config', 'user.email', 'vibepro@example.com']);
  await git(seedClone, ['config', 'user.name', 'VibePro Test']);
  await writeFile(path.join(seedClone, 'README.md'), '# fixture\n');
  await git(seedClone, ['add', 'README.md']);
  await git(seedClone, ['commit', '-m', 'chore: seed base']);
  await git(seedClone, ['push', 'origin', 'HEAD:main']);

  const localEntries = [
    entry({ entry_key: 'k1', gate_id: 'gate:a' }),
    entry({ entry_key: 'k2', gate_id: 'gate:b' })
  ];

  const { worktree, commitSha, promotion } = await commitCanonicalAuditAndLedgerPromotion(remote, {
    auditRelativeDir: 'docs/management/audit-artifacts/story-x',
    auditFileContents: JSON.stringify({ story_id: 'story-x' }, null, 2),
    localEntries
  });
  await git(worktree, ['config', 'user.email', 'vibepro@example.com']);
  await git(worktree, ['config', 'user.name', 'VibePro Test']);

  assert.equal(promotion.status, 'promoted');
  assert.equal(promotion.promoted_count, 2);
  assert.equal(promotion.duplicate_count, 0);

  // Exactly one new commit on top of the seed commit: no separate ledger commit.
  const log = await git(remote, ['log', '--format=%H', 'main']);
  const commits = log.stdout.trim().split('\n');
  assert.equal(commits[0], commitSha, 'the promotion commit is the tip of main');
  assert.equal(commits.length, 2, 'exactly one new commit landed (seed + this one), no follow-up ledger commit');

  // Both the canonical audit bundle and the central ledger are present in that one commit.
  const showResult = await git(remote, [
    '--git-dir', remote,
    'show', '--name-only', '--format=', commitSha
  ]);
  const changedPaths = showResult.stdout.trim().split('\n').filter(Boolean);
  assert.ok(
    changedPaths.includes('docs/management/audit-artifacts/story-x/bundle.json'),
    'canonical audit bundle path is part of the promotion commit'
  );
  assert.ok(
    changedPaths.includes(CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH),
    'central ledger path is part of the same promotion commit'
  );

  // Fetch the pushed central ledger content back and confirm entry_key sort order (RML-CONTRACT-003).
  const pushedLedgerRaw = (await git(worktree, ['show', `${commitSha}:${CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH}`])).stdout;
  const pushedLedger = JSON.parse(pushedLedgerRaw);
  assert.deepEqual(pushedLedger.entries.map((item) => item.entry_key), ['k1', 'k2']);
});

test('RML-CONTRACT-002 (integration): re-promoting an already-present entry_key against the real pushed ledger dedupes instead of growing it', async () => {
  const remote = await mkdtemp(path.join(os.tmpdir(), 'vibepro-rml-integration-remote-'));
  await git(remote, ['init', '--bare', '-b', 'main']);

  const seedCloneParent = await mkdtemp(path.join(os.tmpdir(), 'vibepro-rml-integration-seed-'));
  const seedClone = path.join(seedCloneParent, 'repo');
  await git(process.cwd(), ['clone', remote, seedClone]);
  await git(seedClone, ['config', 'user.email', 'vibepro@example.com']);
  await git(seedClone, ['config', 'user.name', 'VibePro Test']);
  await writeFile(path.join(seedClone, 'README.md'), '# fixture\n');
  await git(seedClone, ['add', 'README.md']);
  await git(seedClone, ['commit', '-m', 'chore: seed base']);
  await git(seedClone, ['push', 'origin', 'HEAD:main']);

  const first = await commitCanonicalAuditAndLedgerPromotion(remote, {
    auditRelativeDir: 'docs/management/audit-artifacts/story-x',
    auditFileContents: JSON.stringify({ story_id: 'story-x', run: 1 }, null, 2),
    localEntries: [entry({ entry_key: 'k1', gate_id: 'gate:a' })]
  });
  await git(first.worktree, ['config', 'user.email', 'vibepro@example.com']);
  await git(first.worktree, ['config', 'user.name', 'VibePro Test']);
  assert.equal(first.promotion.status, 'promoted');
  assert.equal(first.promotion.promoted_count, 1);

  const second = await commitCanonicalAuditAndLedgerPromotion(remote, {
    auditRelativeDir: 'docs/management/audit-artifacts/story-x-rerun',
    auditFileContents: JSON.stringify({ story_id: 'story-x', run: 2 }, null, 2),
    localEntries: [entry({ entry_key: 'k1', gate_id: 'gate:a' })]
  });
  await git(second.worktree, ['config', 'user.email', 'vibepro@example.com']);
  await git(second.worktree, ['config', 'user.name', 'VibePro Test']);

  // duplicate entry_key: promotion.status stays a no-op write ('promoted' with
  // 0 promoted / 1 duplicate, or 'no_entries' style depending on serialized
  // diff), but the ledger entry count must not grow.
  assert.equal(second.promotion.duplicate_count, 1);
  assert.equal(second.promotion.promoted_count, 0);

  const finalLedgerRaw = (await git(second.worktree, ['show', `${second.commitSha}:${CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH}`]))
    .stdout;
  const finalLedger = JSON.parse(finalLedgerRaw);
  assert.equal(finalLedger.entries.length, 1, 'entry_key dedupe keeps the ledger at one entry across two promotion commits');
});
