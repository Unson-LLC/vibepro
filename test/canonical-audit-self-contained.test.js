import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { promoteCanonicalAuditArtifacts } from '../src/canonical-audit.js';

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test('canonical audit bundle copies handoff references and reports unresolved references', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-canonical-self-contained-'));
  const storyId = 'story-canonical-self-contained';
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'), {
    schema_version: '0.1.0',
    story: { story_id: storyId },
    review_request: `.vibepro/reviews/${storyId}/gate/review-request-gate_evidence.md`,
    manual_result: `.vibepro/manual-verification/${storyId}/unit-result.json`,
    missing_result: `.vibepro/manual-verification/${storyId}/missing-result.json`
  });
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'gate-dag.json'), {
    story_id: storyId,
    verification: `.vibepro/pr/${storyId}/verification-evidence.json`
  });
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'verification-evidence.json'), {
    story_id: storyId,
    commands: [{
      status: 'pass',
      artifact: `.vibepro/manual-verification/${storyId}/unit-result.json`
    }]
  });
  await mkdir(path.join(root, '.vibepro', 'reviews', storyId, 'gate'), { recursive: true });
  await writeFile(
    path.join(root, '.vibepro', 'reviews', storyId, 'gate', 'review-request-gate_evidence.md'),
    '# Review request\n'
  );
  await writeJson(path.join(root, '.vibepro', 'manual-verification', storyId, 'unit-result.json'), {
    status: 'pass'
  });

  const promoted = await promoteCanonicalAuditArtifacts(root, { storyId });
  const bundle = promoted.bundle;
  assert.equal(bundle.handoff_replay_status, 'blocked');
  assert.equal(bundle.artifacts.some((item) => item.kind === 'review_request' && item.source.endsWith('review-request-gate_evidence.md')), true);
  assert.equal(bundle.resolved_references.some((item) => item.source.endsWith('review-request-gate_evidence.md')), true);
  assert.equal(bundle.copied_references.some((item) => item.source.endsWith('unit-result.json')), true);
  assert.equal(bundle.unresolved_references.some((item) => item.source.endsWith('missing-result.json')), true);
  assert.equal(
    await readJson(path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'references', 'vibepro', 'manual-verification', storyId, 'unit-result.json')).then((item) => item.status),
    'pass'
  );
});

test('canonical audit bundle promotes review requests even when no JSON references them', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-canonical-review-request-'));
  const storyId = 'story-review-request-omission';
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'), {
    schema_version: '0.1.0',
    story: { story_id: storyId }
  });
  await mkdir(path.join(root, '.vibepro', 'reviews', storyId, 'gate'), { recursive: true });
  await writeFile(
    path.join(root, '.vibepro', 'reviews', storyId, 'gate', 'review-request-gate_evidence.md'),
    '# Gate evidence review request\n'
  );

  const promoted = await promoteCanonicalAuditArtifacts(root, { storyId });
  const bundle = promoted.bundle;
  assert.equal(bundle.handoff_replay_status, 'ready');
  assert.equal(
    bundle.artifacts.some((item) => item.kind === 'review_request' && item.canonical_path.endsWith('review-request-gate_evidence.md')),
    true
  );
  assert.equal(
    await readFile(path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'reviews', 'gate', 'review-request-gate_evidence.md'), 'utf8'),
    '# Gate evidence review request\n'
  );
});

test('canonical audit bundle compacts over-budget evidence instead of copying full raw artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-canonical-budget-'));
  const storyId = 'story-over-budget-evidence';
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'), {
    schema_version: '0.1.0',
    created_at: '2026-06-23T00:00:00.000Z',
    story: { story_id: storyId },
    gate_status: {
      ready_for_pr_create: true,
      overall_status: 'ready_for_review',
      fast_lane: false,
      critical_unresolved_gates: []
    },
    large_gate_context: Array.from({ length: 1700 }, (_, index) => ({
      id: `gate-${index}`,
      status: 'passed'
    }))
  });

  const promoted = await promoteCanonicalAuditArtifacts(root, {
    storyId,
    merge: {
      status: 'merged',
      merged_at: '2026-06-23T00:05:00.000Z',
      merge_commit_sha: 'abc123',
      pr: { url: 'https://github.com/example/repo/pull/1' }
    }
  });
  const bundle = promoted.bundle;

  assert.equal(bundle.artifact_policy.compacted, true);
  assert.equal(bundle.evidence_depth, 'standard');
  assert.equal(bundle.cost_summary.budget_status, 'exceeded');
  assert.equal(bundle.artifacts.some((item) => item.kind === 'audit_index'), true);
  assert.equal(bundle.raw_artifacts.some((item) => item.kind === 'pr_prepare' && item.persisted === false), true);
  assert.equal(
    await readJson(path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'audit-index.json')).then((item) => item.pr_prepare.present),
    true
  );
  await assert.rejects(
    () => readFile(path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'pr', 'pr-prepare.json'), 'utf8'),
    /ENOENT/
  );
});
