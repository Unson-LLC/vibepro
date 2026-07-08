import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import {
  promoteCanonicalAuditArtifacts,
  replayCanonicalAuditBundle
} from '../src/canonical-audit.js';

// Focused regression tests for story-vibepro-idempotent-audit-persistence.
// Contracts exercised: IAP-CONTRACT-001 (deterministic bundle bytes),
// IAP-CONTRACT-002 (stable promoted_at on unchanged content),
// IAP-CONTRACT-003 (at most one persistence commit per merge),
// IAP-CONTRACT-004 (fail toward duplication, never loss),
// IAP-CONTRACT-005 (replay compatibility).

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function snapshotDir(dir) {
  const out = {};
  const walk = async (current, base = '') => {
    const entries = (await readdir(current, { withFileTypes: true }))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else {
        out[rel] = (await readFile(full)).toString('base64');
      }
    }
  };
  await walk(dir);
  return out;
}

function differingFiles(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((key) => a[key] !== b[key]).sort();
}

// Builds the .vibepro/pr source inputs a merge would have produced. `overBudget`
// inflates the inputs so promotion takes the compact (compressed replay bundle)
// path, which is the path that produces `audit-replay-bundle.json.gz`.
async function seedMergeInputs(root, storyId, { overBudget = false } = {}) {
  const prDir = path.join(root, '.vibepro', 'pr', storyId);
  await writeJson(path.join(prDir, 'pr-prepare.json'), {
    schema_version: '0.1.0',
    story: { story_id: storyId },
    gate_status: { overall_status: 'ready_for_review', ready_for_pr_create: true }
  });
  await writeJson(path.join(prDir, 'gate-dag.json'), {
    story_id: storyId,
    overall_status: 'ready_for_review',
    nodes: [],
    summary: { needs_evidence_count: 0 }
  });
  await writeJson(path.join(prDir, 'pr-create.json'), {
    schema_version: '0.1.0',
    status: 'created',
    pr_url: 'https://example.test/pr/1'
  });
  if (overBudget) {
    // A large verification-evidence artifact pushes promotion over the audit line
    // budget, taking the compact path that emits the gzip replay bundle.
    await writeJson(path.join(prDir, 'verification-evidence.json'), {
      schema_version: '0.1.0',
      story_id: storyId,
      commands: Array.from({ length: 700 }, (_, index) => ({
        id: `verification-${index}`,
        kind: 'unit',
        status: 'pass',
        command: `node --test test/example-${index}.test.js`,
        summary: `Audit-relevant verification summary ${index}`,
        target: [`src/example-${index}.js`],
        scenario: [`IAP-VERIFY-${index}`],
        observed: { result: 'pass' },
        recorded_at: '2026-06-28T00:00:00.000Z'
      }))
    });
  }
}

function baseMerge() {
  return {
    status: 'merged',
    merge_commit_sha: 'a'.repeat(40),
    merged_at: '2026-06-07T00:32:55Z',
    pr: { url: 'https://example.test/pr/1' },
    current_head_sha: 'b'.repeat(40),
    cost_accounting: { status: 'available' }
  };
}

// Simulates the self-referential canonical_audit bookkeeping that execute merge
// injects into pr-merge.json between the first and second persistence passes.
function withCanonicalAuditBookkeeping(merge, storyId) {
  return {
    ...merge,
    canonical_audit: {
      bundle: `docs/management/audit-artifacts/${storyId}/audit-bundle.json`,
      directory: `docs/management/audit-artifacts/${storyId}`,
      artifact_count: 7,
      missing_artifact_count: 0,
      persistence: {
        status: 'pushed',
        pushed: true,
        commit_sha: 'c'.repeat(40),
        base_head_sha: 'd'.repeat(40),
        worktree_path: `/tmp/vibepro-canonical-audit-${storyId}-${Date.now()}`
      }
    },
    // merge-manager.js attaches ROI ledger promotion bookkeeping to the merge
    // object between the two promotion passes via the same mechanism as
    // canonical_audit; it must be excluded from the promoted view too, or the
    // second pass diverges on the compact path (reviewer-found regression).
    roi_ledger_promotion: {
      status: 'promoted',
      promoted_count: 2,
      duplicate_count: 0,
      central_ledger_path: 'docs/management/roi-ledger/ledger.json',
      commit_sha: 'c'.repeat(40)
    }
  };
}

async function writePrMerge(root, storyId, merge) {
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-merge.json'), merge);
}

for (const overBudget of [false, true]) {
  const label = overBudget ? 'compact' : 'full';

  test(`IAP-CONTRACT-001 IAP-CONTRACT-002 IAP-CONTRACT-003 IAP-S-1 (${label}) the second execute-merge promotion pass regenerates byte-identical canonical artifacts so persistence dedupe yields already_present`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `vibepro-iap-${label}-`));
    const storyId = `story-iap-${label}`;
    await seedMergeInputs(root, storyId, { overBudget });

    const mergePass1 = baseMerge();
    await writePrMerge(root, storyId, mergePass1);
    const promoted1 = await promoteCanonicalAuditArtifacts(root, { storyId, merge: mergePass1 });
    const firstPass = await snapshotDir(promoted1.canonical_dir);

    // Execute merge sets merge.canonical_audit (persist-to-base bookkeeping) after
    // the first promotion, then re-runs writePrMergeArtifacts + promotion.
    const mergePass2 = withCanonicalAuditBookkeeping(mergePass1, storyId);
    await writePrMerge(root, storyId, mergePass2);
    const promoted2 = await promoteCanonicalAuditArtifacts(root, { storyId, merge: mergePass2 });
    const secondPass = await snapshotDir(promoted2.canonical_dir);

    assert.deepEqual(
      differingFiles(firstPass, secondPass),
      [],
      'IAP-CONTRACT-003: second persistence pass must be byte-identical (already_present)'
    );
    // IAP-CONTRACT-002: promoted_at is carried forward, not re-stamped.
    assert.equal(promoted2.bundle.promoted_at, promoted1.bundle.promoted_at);
    // The self-referential bookkeeping is excluded from the promoted view.
    assert.equal(
      JSON.stringify(promoted2.bundle).includes('vibepro-canonical-audit-'),
      false,
      'canonical_audit persistence bookkeeping must not leak into the promoted bundle'
    );
  });

  test(`IAP-CONTRACT-001 IAP-S-2 IAP-S-3 (${label}) regenerating from unchanged inputs produces byte-identical files including the gzip member`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `vibepro-iap-rerun-${label}-`));
    const storyId = `story-iap-rerun-${label}`;
    await seedMergeInputs(root, storyId, { overBudget });
    const merge = withCanonicalAuditBookkeeping(baseMerge(), storyId);
    await writePrMerge(root, storyId, merge);

    const first = await promoteCanonicalAuditArtifacts(root, { storyId, merge });
    const firstSnap = await snapshotDir(first.canonical_dir);
    const second = await promoteCanonicalAuditArtifacts(root, { storyId, merge });
    const secondSnap = await snapshotDir(second.canonical_dir);

    assert.deepEqual(differingFiles(firstSnap, secondSnap), []);
    if (overBudget) {
      const gzRel = 'audit-replay-bundle.json.gz';
      assert.ok(firstSnap[gzRel], 'compact path must produce a gzip replay bundle');
      assert.equal(firstSnap[gzRel], secondSnap[gzRel], 'IAP-CONTRACT-001: gzip member must be byte-identical');
    }
  });

  test(`IAP-CONTRACT-003 IAP-S-4 (${label}) a genuine change to the final merge artifacts recommits with a fresh promoted_at`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `vibepro-iap-delta-${label}-`));
    const storyId = `story-iap-delta-${label}`;
    await seedMergeInputs(root, storyId, { overBudget });

    const merge = withCanonicalAuditBookkeeping(baseMerge(), storyId);
    await writePrMerge(root, storyId, merge);
    const promotedA = await promoteCanonicalAuditArtifacts(root, { storyId, merge });
    const snapA = await snapshotDir(promotedA.canonical_dir);

    // A genuine logical change: the merge commit sha differs.
    const changed = { ...merge, merge_commit_sha: 'e'.repeat(40) };
    await writePrMerge(root, storyId, changed);
    const promotedB = await promoteCanonicalAuditArtifacts(root, { storyId, merge: changed });
    const snapB = await snapshotDir(promotedB.canonical_dir);

    assert.notDeepEqual(
      differingFiles(snapA, snapB),
      [],
      'IAP-CONTRACT-003: a real delta must change the persisted bytes (a single delta commit)'
    );
    assert.notEqual(promotedB.bundle.promoted_at, promotedA.bundle.promoted_at);
    assert.equal(promotedB.bundle.merge.merge_commit_sha, 'e'.repeat(40));
  });

  test(`IAP-CONTRACT-005 IAP-S-5 (${label}) audit replay succeeds against the deterministic bundle`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `vibepro-iap-replay-${label}-`));
    const storyId = `story-iap-replay-${label}`;
    await seedMergeInputs(root, storyId, { overBudget });
    const merge = withCanonicalAuditBookkeeping(baseMerge(), storyId);
    await writePrMerge(root, storyId, merge);
    await promoteCanonicalAuditArtifacts(root, { storyId, merge });

    const replay = await replayCanonicalAuditBundle(root, { storyId });
    if (overBudget) {
      // Compact promotion writes the compressed replay bundle audit replay consumes.
      assert.equal(replay.status, 'ready', 'IAP-CONTRACT-005: replay must succeed on the compact deterministic bundle');
      assert.equal(replay.story_id, storyId);
      // Sanity: the compressed member is valid gzip carrying the story id.
      const gz = await readFile(path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'audit-replay-bundle.json.gz'));
      assert.match(gunzipSync(gz).toString('utf8'), new RegExp(storyId));
    } else {
      // The full path does not emit a compressed replay bundle (pre-existing behavior).
      assert.equal(replay.status, 'blocked');
    }
  });
}

test('IAP-CONTRACT-004 an unparseable existing canonical bundle falls back to fresh generation without aborting', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-iap-fallback-'));
  const storyId = 'story-iap-fallback';
  await seedMergeInputs(root, storyId, { overBudget: true });
  const merge = withCanonicalAuditBookkeeping(baseMerge(), storyId);
  await writePrMerge(root, storyId, merge);
  const first = await promoteCanonicalAuditArtifacts(root, { storyId, merge });

  // Corrupt the persisted bundle so logical-content comparison cannot run.
  await writeFile(path.join(first.canonical_dir, 'audit-bundle.json'), '{ this is not valid json');

  const recovered = await promoteCanonicalAuditArtifacts(root, { storyId, merge });
  assert.ok(recovered.bundle, 'IAP-CONTRACT-004: regeneration must proceed despite an unparseable existing bundle');
  assert.equal(typeof recovered.bundle.promoted_at, 'string');
  assert.equal(recovered.bundle.story_id, storyId);
});
