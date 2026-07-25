// Acceptance replay for story-vibepro-docs-only-evidence-profile.
//
// Replays the executable scenario for each acceptance criterion (DOE-S-1..4)
// and, separately, drives the real CLI over a fixture repository so the
// artifact path — canonical audit bundle promotion and `usage report` — is
// exercised end to end rather than through in-process calls only.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLI_BIN = path.join(REPO_ROOT, 'bin', 'vibepro.js');

function childEnv() {
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...rest } = process.env;
  return rest;
}

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return stdout.trim();
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test('story-vibepro-docs-only-evidence-profile DOE-S-1 through DOE-S-4 scenario clause replay', async () => {
  const result = await execFileAsync(process.execPath, [
    '--test',
    'test/docs-only-evidence-profile.test.js',
    'test/merge-diff-base-preservation.test.js',
    'test/docs-only-evidence-profile-integration.test.js'
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: childEnv(),
    maxBuffer: 16 * 1024 * 1024
  });

  assert.match(result.stdout, /(?:#|ℹ) fail 0\b/);
  for (const scenario of [
    { clause: 'AC-1 C-001', pattern: /DOE-S-1 detects a docs\/roadmap change with no src or test diff as docs-only/ },
    { clause: 'AC-1 C-001', pattern: /DOE-S-1 refuses to call an unclassified or empty change set docs-only/ },
    { clause: 'AC-1 C-002', pattern: /DOE-S-1 defaults a docs-only change to the lightest persistence depth/ },
    { clause: 'AC-1 C-002', pattern: /DOE-S-1 keeps an explicit depth escalation authoritative over the docs-only default/ },
    { clause: 'AC-2 C-003', pattern: /DOE-S-2 routes a docs-only overspend away from the implementation budget signal/ },
    { clause: 'AC-2 C-003', pattern: /DOE-S-2 keeps implementation overspend on the implementation budget signal/ },
    { clause: 'AC-3 C-004', pattern: /DOE-S-3 recovers the pre-merge base from the merge commit first parent/ },
    { clause: 'AC-3 C-004', pattern: /DOE-S-3 recovers the pre-merge base after a squash merge/ },
    { clause: 'AC-3 C-004', pattern: /DOE-S-3 refuses to report a post-merge base as an available zero-line diff/ },
    { clause: 'AC-3 C-005', pattern: /DOE-S-3 marks a docs-only zero as docs_only, not as a missing measurement/ },
    { clause: 'AC-4 C-006', pattern: /DOE-S-4 records docs-only detection as a planner input without changing the depth contract/ },
    { clause: 'AC-4 C-006', pattern: /DOE-S-4 keeps risk escalation intact for a docs-only change/ },
    { clause: 'AC-2 C-007', pattern: /usage report separates docs-only evidence spend from the implementation signal/ }
  ]) assert.match(result.stdout, scenario.pattern, `${scenario.clause} executable scenario replay`);
});

test('story-vibepro-docs-only-evidence-profile AC-2 usage report CLI reports docs-only spend on its own axis', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-docs-only-e2e-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, 'init', '--initial-branch=main');
  await git(root, 'config', 'user.email', 'test@example.com');
  await git(root, 'config', 'user.name', 'VibePro Test');

  const bundle = (storyId, scope) => ({
    schema_version: '0.1.0',
    story_id: storyId,
    generated_at: '2026-07-25T00:00:00.000Z',
    evidence_depth: scope === 'docs_only' ? 'summary' : 'standard',
    budget_status: 'exceeded',
    cost_summary: {
      schema_version: '0.1.0',
      evidence_depth: scope === 'docs_only' ? 'summary' : 'standard',
      artifact_lines: 4996,
      budget_scope: scope,
      budget_status: 'exceeded',
      implementation_budget_status: scope === 'docs_only' ? 'not_applicable' : 'exceeded',
      docs_only_budget_status: scope === 'docs_only' ? 'exceeded' : 'not_applicable',
      product_changed_lines: 81,
      diff_stats_status: 'available'
    },
    artifacts: [],
    missing_artifacts: []
  });

  for (const [storyId, scope] of [['story-docs-e2e', 'docs_only'], ['story-impl-e2e', 'implementation']]) {
    await writeJson(
      path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'audit-bundle.json'),
      bundle(storyId, scope)
    );
  }
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'canonical bundles');

  const { stdout } = await execFileAsync(process.execPath, [CLI_BIN, 'usage', 'report', root, '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: childEnv(),
    maxBuffer: 16 * 1024 * 1024
  });
  const report = JSON.parse(stdout);
  const cost = report.evidence_cost;

  assert.equal(cost.budget_exceeded_count, 2);
  assert.equal(cost.docs_only_bundle_count, 1);
  assert.equal(cost.docs_only_budget_exceeded_count, 1);
  // Documentation spend no longer inflates the implementation waste signal.
  assert.equal(cost.implementation_budget_exceeded_count, 1);
  const docsRow = cost.by_story.find((row) => row.story_id === 'story-docs-e2e');
  assert.equal(docsRow.budget_scope, 'docs_only');
  assert.equal(docsRow.implementation_budget_status, 'not_applicable');
});

test('story-vibepro-docs-only-evidence-profile AC-3 canonical artifact replay keeps the docs-only verdict stable', async (t) => {
  // Artifact replay: regenerating the canonical bundle from the same merge
  // artifact must reproduce the same docs-only verdict and the same reason for
  // a zero product-code line count. A verdict that drifted between promotions
  // would make a stale bundle indistinguishable from a fresh one.
  const { promoteCanonicalAuditArtifacts } = await import('../../src/canonical-audit.js');
  const storyId = 'story-replay-docs-only';
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-docs-only-replay-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const merge = {
    schema_version: '0.1.0',
    mode: 'execute_merge',
    story: { story_id: storyId },
    status: 'merged',
    base: 'main',
    git: {
      base_branch: 'main',
      base_ref: 'abc123^1',
      head_ref: 'def456',
      diff_stats: {
        status: 'available',
        source: 'git diff --numstat abc123^1...def456',
        refs: {
          base_ref: 'abc123^1',
          head_ref: 'def456',
          base_sha: 'abc123parent',
          head_sha: 'def456',
          merge_commit_sha: 'abc123',
          base_authority: 'merge_commit_first_parent'
        },
        collected_at: '2026-07-25T00:00:00.000Z',
        reason: null
      },
      diff_line_stats: {
        'docs/management/stories/active/story-replay.md': { additions: 48, deletions: 0 },
        'docs/management/roadmap/plan.md': { additions: 26, deletions: 4 },
        '.vibepro/config.json': { additions: 12, deletions: 0 }
      }
    },
    delivery: { status: 'merged', source: 'github_pr' },
    reconciliation: { status: 'reconciled', reasons: [] }
  };
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'), {
    schema_version: '0.1.0',
    story: { story_id: storyId }
  });
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-merge.json'), merge);

  const readCost = async () => {
    const promoted = await promoteCanonicalAuditArtifacts(root, { storyId, source: 'execute_merge', merge });
    const index = JSON.parse(await readFile(path.join(promoted.canonical_dir, 'audit-index.json'), 'utf8'));
    return index.cost_summary;
  };

  const first = await readCost();
  const second = await readCost();

  assert.equal(first.change_surface.status, 'docs_only');
  assert.equal(first.budget_scope, 'docs_only');
  // The fixture has missing canonical artifacts, so the pre-existing risk
  // escalation fires; docs-only lowers the depth *default*, it never overrides
  // an escalation. What must replay identically is the verdict, not a
  // hard-coded depth.
  assert.equal(first.trigger_signals.length > 0, true);
  assert.equal(first.evidence_depth, 'full');
  assert.equal(first.implementation_budget_status, 'not_applicable');
  assert.equal(first.product_code_changed_lines_reason, 'docs_only');
  assert.equal(first.diff_stats_refs.base_authority, 'merge_commit_first_parent');

  assert.equal(second.change_surface.status, first.change_surface.status);
  assert.equal(second.budget_scope, first.budget_scope);
  assert.equal(second.evidence_depth, first.evidence_depth);
  assert.equal(second.implementation_budget_status, first.implementation_budget_status);
  assert.equal(second.product_code_changed_lines_reason, first.product_code_changed_lines_reason);
  t.diagnostic(`canonical replay budget_scope=${second.budget_scope} depth=${second.evidence_depth}`);
});
