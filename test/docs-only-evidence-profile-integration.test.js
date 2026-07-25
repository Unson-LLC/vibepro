// Integration boundary for story-vibepro-docs-only-evidence-profile: the final
// output path from a merge result, through canonical audit promotion, into the
// usage report's evidence-cost metrics. The unit tests pin each contract in
// isolation; this test pins that the docs-only verdict and the recovered diff
// base actually survive serialization across those three modules.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { promoteCanonicalAuditArtifacts } from '../src/canonical-audit.js';
import { writeDecisionOutcomeLedger } from '../src/decision-outcome-ledger.js';
import { collectMergeDiffLineStats } from '../src/merge-manager.js';
import { createUsageReport } from '../src/usage-report.js';

const run = promisify(execFile);

async function git(cwd, ...args) {
  const { stdout } = await run('git', args, { cwd });
  return stdout.trim();
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function mergeArtifact(storyId, { diffStats, diffLineStats }) {
  return {
    schema_version: '0.1.0',
    mode: 'execute_merge',
    story: { story_id: storyId },
    status: 'merged',
    base: 'main',
    current_head_sha: diffStats.refs.head_sha,
    git: {
      base_branch: 'main',
      base_ref: diffStats.refs.base_ref,
      head_ref: diffStats.refs.head_ref,
      diff_stats: diffStats,
      diff_line_stats: diffLineStats
    },
    pr: { url: 'https://github.com/example/repo/pull/1', state: 'MERGED' },
    delivery: { status: 'merged', source: 'github_pr' },
    reconciliation: { status: 'reconciled', reasons: [] }
  };
}

// Builds a repo whose branch is already merged into origin/main, so the naive
// base is unusable and only the merge commit's first parent recovers the diff.
async function buildMergedRepo({ changedPaths }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-docs-only-integration-'));
  await git(root, 'init', '--initial-branch=main');
  await git(root, 'config', 'user.email', 'test@example.com');
  await git(root, 'config', 'user.name', 'VibePro Test');
  await writeFile(path.join(root, 'seed.txt'), 'seed\n');
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'base');

  await git(root, 'checkout', '-b', 'feature');
  for (const [filePath, body] of Object.entries(changedPaths)) {
    await mkdir(path.dirname(path.join(root, filePath)), { recursive: true });
    await writeFile(path.join(root, filePath), body);
  }
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'feature work');
  const headSha = await git(root, 'rev-parse', 'HEAD');

  await git(root, 'checkout', 'main');
  await git(root, 'merge', '--no-ff', 'feature', '-m', 'Merge pull request #1');
  const mergeCommitSha = await git(root, 'rev-parse', 'HEAD');
  await git(root, 'update-ref', 'refs/remotes/origin/main', mergeCommitSha);
  return { root, headSha, mergeCommitSha };
}

async function promoteFromMergedRepo({
  storyId,
  changedPaths,
  verificationCommandCount = 0,
  completeArtifacts = false
}) {
  const { root, headSha, mergeCommitSha } = await buildMergedRepo({ changedPaths });
  const collected = await collectMergeDiffLineStats(root, {
    baseBranch: 'main',
    currentHeadSha: headSha,
    pr: { base_ref_name: 'main', head_ref_oid: headSha },
    mergeCommitSha
  });
  const merge = mergeArtifact(storyId, {
    diffStats: collected.diff_stats,
    diffLineStats: collected.diff_line_stats
  });
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'), {
    schema_version: '0.1.0',
    story: { story_id: storyId }
  });
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-merge.json'), merge);
  if (completeArtifacts) {
    // No missing artifact, no merge warning, no unresolved gate node — the only
    // state in which the docs-only depth default is not outranked.
    for (const fileName of [
      'evidence-reuse.json',
      'pr-create.json',
      'gate-dag.json',
      'senior-gap-judgment.json',
      'traceability.json',
      'verification-evidence.json'
    ]) {
      await writeJson(path.join(root, '.vibepro', 'pr', storyId, fileName), {
        schema_version: '0.1.0',
        story_id: storyId
      });
    }
    // Built through the ledger's own writer so the digest and revision
    // fingerprints are the real ones rather than a hand-rolled approximation.
    await writeDecisionOutcomeLedger(root, storyId, {
      currentHeadSha: merge.git.diff_stats.refs.head_sha,
      createdAt: '2026-07-25T00:00:00.000Z'
    });
  }
  if (verificationCommandCount > 0) {
    await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'verification-evidence.json'), {
      schema_version: '0.1.0',
      story_id: storyId,
      commands: Array.from({ length: verificationCommandCount }, (_, index) => ({
        id: `verification-${index}`,
        kind: 'unit',
        status: 'pass',
        command: `node --test test/example-${index}.test.js`,
        summary: `Audit-relevant verification summary ${index}`,
        target: [`docs/example-${index}.md`],
        scenario: [`DOCS-VERIFY-${index}`],
        observed: { result: 'pass' },
        recorded_at: '2026-07-25T00:00:00.000Z'
      }))
    });
  }
  const promoted = await promoteCanonicalAuditArtifacts(root, {
    storyId,
    source: 'execute_merge',
    merge
  });
  const index = JSON.parse(
    await readFile(path.join(promoted.canonical_dir, 'audit-index.json'), 'utf8')
  );
  return { root, promoted, index, collected };
}

test('docs-only merge promotes a docs_only-scoped canonical bundle with a recovered diff base', async (t) => {
  const storyId = 'story-integration-docs-only';
  const { root, index, collected } = await promoteFromMergedRepo({
    storyId,
    changedPaths: {
      'docs/management/stories/active/story-x.md': `${'story line\n'.repeat(40)}`,
      'docs/management/roadmap/plan.md': `${'roadmap line\n'.repeat(30)}`
    }
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  // The base branch could not serve as a diff base after the merge; the merge
  // commit's first parent did.
  assert.equal(collected.diff_stats.refs.base_authority, 'merge_commit_first_parent');

  const cost = index.cost_summary;
  assert.equal(cost.diff_stats_status, 'available');
  assert.equal(cost.change_surface.status, 'docs_only');
  assert.equal(cost.budget_scope, 'docs_only');
  assert.equal(cost.budget.profile, 'docs_only');
  assert.equal(cost.implementation_budget_status, 'not_applicable');
  // This fixture has missing canonical artifacts, so the pre-existing risk
  // escalation fires and keeps the depth it would have had before this change.
  // docs-only lightens the depth default, it does not override an escalation.
  assert.equal(cost.trigger_signals.length > 0, true);
  assert.equal(cost.evidence_depth, 'full');
  // Zero product-code lines here is a fact about the change, not a lost
  // measurement, and the persisted reason says so.
  assert.equal(cost.product_code_changed_lines, 0);
  assert.equal(cost.product_code_changed_lines_reason, 'docs_only');
});

test('implementation merge keeps the implementation budget scope through canonical promotion', async (t) => {
  const storyId = 'story-integration-implementation';
  const { root, index } = await promoteFromMergedRepo({
    storyId,
    changedPaths: {
      'src/feature.js': `${'export const line = 1;\n'.repeat(60)}`,
      'test/feature.test.js': `${'// assertion\n'.repeat(40)}`,
      'docs/management/stories/active/story-y.md': 'story\n'
    }
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const cost = index.cost_summary;
  assert.equal(cost.change_surface.status, 'product_change');
  assert.equal(cost.budget_scope, 'implementation');
  assert.equal(cost.docs_only_budget_status, 'not_applicable');
  assert.equal(cost.implementation_budget_status, cost.budget_status);
  assert.equal(cost.product_code_changed_lines, 100);
});

test('a docs-only promotion with no risk signal reaches the summary depth default end to end', async (t) => {
  // The depth default is only reachable when nothing escalated. Proving it
  // through promoteCanonicalAuditArtifacts (not just a direct call to the cost
  // builder) is what shows DOE-S-1 is wired into the real path — and how narrow
  // that path is: every missing artifact, merge warning, and unresolved gate
  // node raises a trigger signal that legitimately outranks the default.
  const storyId = 'story-integration-docs-only-low-risk';
  const { root, index } = await promoteFromMergedRepo({
    storyId,
    changedPaths: {
      'docs/management/stories/active/story-quiet.md': `${'story line\n'.repeat(40)}`,
      'docs/management/roadmap/plan.md': `${'roadmap line\n'.repeat(30)}`
    },
    completeArtifacts: true
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const cost = index.cost_summary;
  assert.deepEqual(cost.trigger_signals, [], 'fixture must carry no risk escalation');
  assert.deepEqual(index.missing_artifacts, []);
  assert.equal(cost.change_surface.status, 'docs_only');
  assert.equal(cost.budget_scope, 'docs_only');
  assert.equal(cost.evidence_depth, 'summary');
  assert.equal(cost.implementation_budget_status, 'not_applicable');
});

test('over-budget docs-only promotion keeps its scope through compact re-measurement', async (t) => {
  // The compact canonical writer re-measures its own persisted output. That
  // second accounting pass must reuse the same scope-separated verdict, or an
  // over-budget docs-only bundle would reappear on the implementation axis.
  const storyId = 'story-integration-docs-only-compact';
  const { root, promoted, index } = await promoteFromMergedRepo({
    storyId,
    changedPaths: {
      'docs/management/stories/active/story-big.md': `${'story line\n'.repeat(30)}`,
      'docs/management/roadmap/plan.md': `${'roadmap line\n'.repeat(20)}`
    },
    // Enough recorded evidence to push the bundle past the docs-only line budget.
    verificationCommandCount: 2400
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const cost = index.cost_summary;
  // `artifact_lines_source` is only set by the compact writer, so this proves
  // the raw bundle was over budget and the second accounting pass actually ran.
  assert.equal(cost.artifact_lines_source, 'persisted_canonical_compact');
  assert.equal(cost.raw_source_artifact_lines > cost.artifact_lines, true);
  // The re-measured verdict keeps the docs-only scope on both passes.
  assert.equal(cost.change_surface.status, 'docs_only');
  assert.equal(cost.budget_scope, 'docs_only');
  assert.equal(cost.implementation_budget_status, 'not_applicable');
  assert.equal(cost.docs_only_budget_status, cost.budget_status);
  // The ratio rule has no denominator for docs-only work and must not fire.
  assert.equal(cost.budget.artifact_code_ratio, null);
  assert.equal(cost.budget_exceeded_reasons.includes('artifact_code_ratio_exceeded'), false);
});

test('usage report separates docs-only evidence spend from the implementation signal', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-docs-only-usage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, 'init', '--initial-branch=main');
  await git(root, 'config', 'user.email', 'test@example.com');
  await git(root, 'config', 'user.name', 'VibePro Test');

  const bundle = (storyId, scope, budgetStatus) => ({
    schema_version: '0.1.0',
    story_id: storyId,
    generated_at: '2026-07-25T00:00:00.000Z',
    evidence_depth: scope === 'docs_only' ? 'summary' : 'standard',
    budget_status: budgetStatus,
    cost_summary: {
      schema_version: '0.1.0',
      evidence_depth: scope === 'docs_only' ? 'summary' : 'standard',
      artifact_lines: 3800,
      budget_scope: scope,
      budget_status: budgetStatus,
      implementation_budget_status: scope === 'docs_only' ? 'not_applicable' : budgetStatus,
      docs_only_budget_status: scope === 'docs_only' ? budgetStatus : 'not_applicable',
      product_changed_lines: 80,
      diff_stats_status: 'available'
    },
    artifacts: [],
    missing_artifacts: []
  });

  const legacy = bundle('story-legacy', undefined, 'exceeded');
  delete legacy.cost_summary.budget_scope;
  delete legacy.cost_summary.implementation_budget_status;
  delete legacy.cost_summary.docs_only_budget_status;

  for (const [storyId, data] of [
    ['story-docs', bundle('story-docs', 'docs_only', 'exceeded')],
    ['story-impl', bundle('story-impl', 'implementation', 'exceeded')],
    ['story-legacy', legacy]
  ]) {
    await writeJson(
      path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'audit-bundle.json'),
      data
    );
  }
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'canonical bundles');

  const report = await createUsageReport(root, {});
  const cost = report.evidence_cost;

  assert.equal(cost.budget_exceeded_count, 3);
  assert.equal(cost.docs_only_bundle_count, 1);
  assert.equal(cost.docs_only_budget_exceeded_count, 1);
  // The docs-only Story is excluded, and the legacy bundle without a
  // budget_scope stays on the implementation axis so historical counts hold.
  assert.equal(cost.implementation_budget_exceeded_count, 2);
});
