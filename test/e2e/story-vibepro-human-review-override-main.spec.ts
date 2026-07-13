import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { assertHumanReviewOverride } from '../../src/human-review-override.js';
import { runCli } from '../../src/cli.js';
import { buildHumanReviewOverrideGate, buildPrPrepareGateStatus } from '../../src/pr-manager.js';
import { resolveCurrentHumanReviewRecommendation } from '../../src/merge-manager.js';

const storyId = 'story-vibepro-human-review-override';
const execFileAsync = promisify(execFile);

// story-vibepro-human-review-override ac:1
// story-vibepro-human-review-override ac:2
// story-vibepro-human-review-override ac:3
// story-vibepro-human-review-override ac:4
// story-vibepro-human-review-override ac:5

async function git(repo: string, args: string[]) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, 'utf8')) as Record<string, any>;
}

async function makeRuntimeRepo(options: { broadDiff?: boolean } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-human-review-override-e2e-'));
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'fixture.js'), 'export const fixture = true;\n');
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro E2E']);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'init runtime fixture']);
  await git(repo, ['switch', '-c', 'feature/human-review-override']);
  await writeFile(path.join(repo, 'src', 'fixture.js'), 'export const fixture = true;\nexport const changed = true;\n');
  if (options.broadDiff) {
    for (let index = 0; index < 13; index += 1) {
      const featureDir = path.join(repo, 'src', `feature-${index}`);
      await mkdir(featureDir, { recursive: true });
      await writeFile(path.join(featureDir, 'index.js'), `export const feature${index} = true;\n`);
    }
  }
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'exercise human review override']);

  const remote = await mkdtemp(path.join(os.tmpdir(), 'vibepro-human-review-override-remote-'));
  await git(remote, ['init', '--bare']);
  await git(repo, ['remote', 'add', 'origin', remote]);
  await git(repo, ['push', '-u', 'origin', 'main']);
  await git(repo, ['push', '-u', 'origin', 'feature/human-review-override']);

  const headSha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const prDir = path.join(repo, '.vibepro', 'pr', storyId);
  await mkdir(prDir, { recursive: true });
  const gateDag = {
    schema_version: '0.1.0',
    overall_status: 'ready_for_review',
    summary: { needs_evidence_count: 0 },
    nodes: []
  };
  await writeJson(path.join(prDir, 'gate-dag.json'), gateDag);
  await writeJson(path.join(prDir, 'pr-prepare.json'), {
    story: { story_id: storyId, title: 'Human review override runtime boundary' },
    git: { base_ref: 'main', head_sha: headSha },
    split_plan: { status: 'clean' },
    pr_context: { gate_dag: gateDag }
  });
  await writeJson(path.join(prDir, 'pr-create.json'), {
    schema_version: '0.1.0',
    mode: 'pr_create',
    story: { story_id: storyId },
    base: 'main',
    head: 'feature/human-review-override',
    pr_url: 'https://github.example.test/unson/vibepro/pull/301',
    current_head_sha: headSha,
    artifact_freshness: {
      status: 'current',
      artifact_head_sha: headSha,
      current_head_sha: headSha
    },
    gate_dag: gateDag
  });
  await writeJson(path.join(prDir, 'human-review.json'), { recommended_decision: 'proceed' });
  await writeJson(path.join(prDir, 'decision-records.json'), { decisions: [] });
  return { repo, prDir, headSha };
}

async function runCliCaptured(args: string[]) {
  let stdout = '';
  let stderr = '';
  const result = await runCli(args, {
    stdout: { write(chunk: string) { stdout += chunk; } },
    stderr: { write(chunk: string) { stderr += chunk; } }
  });
  return { ...result, stdout, stderr };
}

test('story-vibepro-human-review-override HRO-S2 AC-1 AC-3 AC-5 PR readiness exposes a current-HEAD override block', () => {
  // Given split_pr lacks an accepted current-HEAD reviewer, when PR readiness runs, then creation is blocked.
  const gate = buildHumanReviewOverrideGate({
    required: true,
    recommendation: 'split_pr',
    expected_source: 'human-review:split_pr',
    decision: null
  }, storyId);
  const readiness = buildPrPrepareGateStatus({ overall_status: 'ready_for_review', nodes: [gate] });
  assert.equal(readiness.ready_for_pr_create, false);
  assert.match(gate.reason, /before PR creation or merge/);
});

test('story-vibepro-human-review-override HRO-S3 AC-2 merge re-evaluates stale lifecycle and blocks visibly', async () => {
  // Given lifecycle evidence is stale, when merge runs, then it derives block and rejects the missing override.
  const recommendation = resolveCurrentHumanReviewRecommendation({
    currentHeadSha: 'head-2',
    prCreate: { artifact_freshness: { status: 'current', artifact_head_sha: 'head-1' } },
    prPrepare: { split_plan: { status: 'clean' } },
    gateDag: { overall_status: 'ready_for_review' },
    humanReview: { recommended_decision: 'proceed' }
  });
  assert.equal(recommendation, 'block');
  await assert.rejects(
    assertHumanReviewOverride('/missing-repo', storyId, 'head-2', 'merge', recommendation),
    /block override required before merge/
  );
});

test('story-vibepro-human-review-override HRO-S1 AC-4 proceed preserves the existing route for a current lifecycle', () => {
  // Given lifecycle evidence is current and clean, when merge evaluates it, then the existing proceed route remains.
  assert.equal(resolveCurrentHumanReviewRecommendation({
    currentHeadSha: 'head-1',
    prCreate: { artifact_freshness: { status: 'current', artifact_head_sha: 'head-1' } },
    prPrepare: { split_plan: { status: 'clean' } },
    gateDag: { overall_status: 'ready_for_review' },
    humanReview: { recommended_decision: 'proceed' }
  }), 'proceed');
});

test('story-vibepro-human-review-override HRO-001 HRO-002 ac:1 ac:2 ac:3 missing human review fails closed at the CLI/runtime boundary', async () => {
  // Workflow state transition: current lifecycle -> block when the review artifact is missing.
  const { repo, prDir } = await makeRuntimeRepo();
  await writeJson(path.join(prDir, 'pr-create.json'), {
    artifact_freshness: { status: 'current', artifact_head_sha: '0000000000000000000000000000000000000000' },
    pr_url: 'https://github.example.test/unson/vibepro/pull/300'
  });
  await rm(path.join(prDir, 'human-review.json'));
  const result = await runCliCaptured([
    'execute', 'merge', repo, '--story-id', storyId, '--base', 'main', '--dry-run', '--json'
  ]);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Human review block override required before merge/);
  await assert.rejects(readFile(path.join(prDir, 'pr-merge.json')), { code: 'ENOENT' });
});

test('story-vibepro-human-review-override HRO-002 ac:2 split and block require current accepted evidence at the CLI/runtime boundary', async () => {
  for (const recommendation of ['split_pr', 'block']) {
    const { repo, prDir, headSha } = await makeRuntimeRepo();
    await writeJson(path.join(prDir, 'human-review.json'), { recommended_decision: recommendation });
    await writeJson(path.join(prDir, 'decision-records.json'), { decisions: [] });
    const result = await runCliCaptured([
      'execute', 'merge', repo, '--story-id', storyId, '--base', 'main', '--dry-run', '--json'
    ]);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, new RegExp(`Human review ${recommendation} override required before merge`));
    assert.equal(headSha.length, 40);
  }
});

test('story-vibepro-human-review-override HRO-002 ac:2 split recommendation blocks the actual PR-create CLI boundary', async () => {
  const { repo, prDir } = await makeRuntimeRepo({ broadDiff: true });
  await writeJson(path.join(prDir, 'decision-records.json'), { decisions: [] });

  const result = await runCliCaptured([
    'pr', 'create', repo, '--story-id', storyId, '--base', 'main', '--max-files', '3',
    '--dry-run', '--json', '--allow-extra-files'
  ]);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Human review split_pr override required before PR creation/);
});

test('story-vibepro-human-review-override HRO-003 ac:3 ac:4 stale lifecycle blocks, current lifecycle transitions to dry-run merge and records artifacts', async () => {
  const stale = await makeRuntimeRepo();
  await writeJson(path.join(stale.prDir, 'pr-create.json'), {
    artifact_freshness: { status: 'current', artifact_head_sha: '0000000000000000000000000000000000000000' },
    pr_url: 'https://github.example.test/unson/vibepro/pull/302'
  });
  const staleResult = await runCliCaptured([
    'execute', 'merge', stale.repo, '--story-id', storyId, '--base', 'main', '--dry-run', '--json'
  ]);
  assert.equal(staleResult.exitCode, 1);
  assert.match(staleResult.stderr, /Human review block override required before merge/);

  const current = await makeRuntimeRepo();
  await writeJson(path.join(current.prDir, 'human-review.json'), { recommended_decision: 'proceed' });
  await writeJson(path.join(current.prDir, 'decision-records.json'), { decisions: [] });
  const currentResult = await runCliCaptured([
    'execute', 'merge', current.repo, '--story-id', storyId, '--base', 'main', '--dry-run', '--json'
  ]);
  assert.equal(currentResult.exitCode, 0);
  assert.equal(JSON.parse(currentResult.stdout).status, 'dry_run_planned');
  const mergeArtifact = await readJson(path.join(current.prDir, 'pr-merge.json'));
  assert.equal(mergeArtifact.human_review_override.required, false);
  assert.equal(mergeArtifact.dry_run, true);
  assert.match(await readFile(path.join(current.prDir, 'pr-merge.html'), 'utf8'), /data-vibepro-report="pr-merge"/);
});

test('story-vibepro-human-review-override HRO-003 ac:5 pr-create and pr-merge lifecycle artifacts remain visible after CLI transitions', async () => {
  const { repo, prDir, headSha } = await makeRuntimeRepo();
  await writeJson(path.join(prDir, 'human-review.json'), { recommended_decision: 'proceed' });
  await writeJson(path.join(prDir, 'decision-records.json'), { decisions: [] });

  const createResult = await runCliCaptured([
    'pr', 'create', repo, '--story-id', storyId, '--base', 'main', '--dry-run', '--json', '--allow-extra-files'
  ]);
  assert.equal(createResult.exitCode, 1);
  assert.match(createResult.stderr, /Pre-create gate check failed/);
  const preservedCreateArtifact = await readJson(path.join(prDir, 'pr-create.json'));
  assert.equal(preservedCreateArtifact.current_head_sha, headSha);
  assert.equal(preservedCreateArtifact.pr_url, 'https://github.example.test/unson/vibepro/pull/301');

  const mergeResult = await runCliCaptured([
    'execute', 'merge', repo, '--story-id', storyId, '--base', 'main', '--dry-run', '--json'
  ]);
  assert.equal(mergeResult.exitCode, 0, mergeResult.stderr);
  const mergeArtifact = await readJson(path.join(prDir, 'pr-merge.json'));
  assert.equal(mergeArtifact.dry_run, true);
  assert.equal(mergeArtifact.artifact_freshness.status, 'current');
  assert.match(await readFile(path.join(prDir, 'pr-merge.html'), 'utf8'), /data-vibepro-report="pr-merge"/);
});
