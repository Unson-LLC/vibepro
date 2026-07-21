import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { createUsageReport } from '../src/usage-report.js';
import { buildReviewRepairPlan } from '../src/review-repair.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function role(name, overrides = {}) {
  return { role: name, status: 'missing', effective_status: 'missing', ...overrides };
}

function healthyRole(name) {
  return role(name, {
    status: 'pass',
    effective_status: 'pass',
    provenance_status: 'verified_agent',
    agent_provenance: { agent_system: 'claude_code', lifecycle: { agent_closed: true } }
  });
}

async function writeReviewSummary(root, storyId, stage, roles) {
  const dir = path.join(root, '.vibepro', 'reviews', storyId, stage);
  await mkdir(dir, { recursive: true });
  const summary = {
    schema_version: '0.1.0',
    story_id: storyId,
    stage,
    status: 'needs_review',
    updated_at: '2026-06-12T00:00:00.000Z',
    roles
  };
  await writeFile(path.join(dir, 'review-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return path.join(dir, 'review-summary.json');
}

async function setupRepairRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-review-repair-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root]);
  await writeReviewSummary(root, 'story-repair-broken', 'gate', [
    role('gate_evidence'),
    role('pr_split_scope', {
      status: 'pass',
      effective_status: 'stale',
      provenance_status: 'verified_agent',
      agent_provenance: { agent_system: 'codex', lifecycle: { agent_closed: true } }
    }),
    role('release_risk', {
      status: 'missing',
      effective_status: 'missing',
      lifecycle: {
        effective_status: 'timed_out',
        latest: {
          lifecycle_id: 'lifecycle-release-risk',
          status: 'running',
          effective_status: 'timed_out',
          agent_system: 'codex',
          agent_id: 'agent-release-risk'
        }
      }
    }),
    role('security_boundary', { status: 'pass', effective_status: 'pass' }),
    role('architecture_fit', {
      status: 'pass',
      effective_status: 'unverified_agent',
      provenance_status: 'agent_not_closed',
      lifecycle: {
        effective_status: 'running',
        latest: {
          lifecycle_id: 'lifecycle-architecture-fit-newer',
          status: 'running',
          effective_status: 'running',
          agent_system: 'codex',
          agent_id: 'newer-running-agent'
        }
      },
      agent_provenance: {
        system: 'claude_code',
        execution_mode: 'parallel_subagent',
        agent_id: 'agent-architecture-fit',
        lifecycle: { agent_closed: false }
      }
    }),
    healthyRole('code_quality')
  ]);
  await writeReviewSummary(root, 'story-repair-healthy', 'gate', [healthyRole('gate_evidence')]);
  return root;
}

test('review repair reads the configured review canonical for an explicit story', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-review-repair-routed-'));
  const storyId = 'story-routed-review';
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeFile(path.join(root, '.vibepro', 'config.json'), `${JSON.stringify({
    artifact_routing: {
      schema_version: '0.1.0',
      artifacts: { review: { canonical: 'artifacts/{feature_slug}/review-evidence' } }
    }
  }, null, 2)}\n`);
  const stageDir = path.join(root, 'artifacts', 'routed-review', 'review-evidence', 'gate');
  await mkdir(stageDir, { recursive: true });
  await writeFile(path.join(stageDir, 'review-summary.json'), `${JSON.stringify({
    story_id: storyId,
    stage: 'gate',
    roles: [role('gate_evidence')]
  }, null, 2)}\n`);

  const plan = await buildReviewRepairPlan(root, { storyId, dryRun: true });
  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.candidates[0].story_id, storyId);
  assert.equal(plan.candidates[0].role, 'gate_evidence');
});

function findCandidate(result, storyId, roleName) {
  return result.candidates.find((item) => item.story_id === storyId && item.role === roleName);
}

test('missing role becomes a run_review candidate with full command chain', async () => {
  const root = await setupRepairRepo();
  const { result } = await runCli(['review', 'repair', root, '--json']);
  const candidate = findCandidate(result, 'story-repair-broken', 'gate_evidence');
  assert.ok(candidate, 'missing gate_evidence must be a candidate');
  assert.equal(candidate.action, 'run_review');
  assert.equal(candidate.stage, 'gate');
  const joined = candidate.next_commands.join('\n');
  assert.match(joined, /review prepare .*--stage gate --role gate_evidence/);
  assert.match(joined, /review start /);
  assert.match(joined, /review record .*--agent-closed/);
  assert.match(joined, /review record .*--inspection-input <inspection-input>/);
  assert.match(joined, /review record .*--judgment-delta/);
  assert.match(joined, /review record .*--agent-thread-id "<subagent-thread-id>"/);
  assert.match(joined, /review record .*--agent-transcript <artifact>/);
  assert.match(joined, /review record .*--agent-close-evidence <close-evidence>/);
});

test('stale role becomes rerun_stale_review and timed_out becomes replace_timed_out_review', async () => {
  const root = await setupRepairRepo();
  const { result } = await runCli(['review', 'repair', root, '--json']);
  assert.equal(findCandidate(result, 'story-repair-broken', 'pr_split_scope').action, 'rerun_stale_review');
  const timedOut = findCandidate(result, 'story-repair-broken', 'release_risk');
  assert.equal(timedOut.action, 'replace_timed_out_review');
  assert.equal(timedOut.effective_status, 'missing');
  assert.match(timedOut.reason, /lifecycle timed out/);
  assert.match(timedOut.next_commands.join('\n'), /review close .*--agent-id "agent-release-risk".*--close-reason timeout.*--close-evidence <close-evidence>/);
  assert.match(timedOut.next_commands.join('\n'), /review start .*--agent-system codex.*--replacement-for lifecycle-release-risk/);
});

test('pass without provenance and unclosed lifecycle are repair candidates', async () => {
  const root = await setupRepairRepo();
  const { result } = await runCli(['review', 'repair', root, '--json']);
  assert.equal(findCandidate(result, 'story-repair-broken', 'security_boundary').action, 'rerecord_with_provenance');
  const openLifecycle = findCandidate(result, 'story-repair-broken', 'architecture_fit');
  assert.equal(openLifecycle.action, 'close_and_rerecord');
  assert.equal(openLifecycle.effective_status, 'unverified_agent');
  assert.match(openLifecycle.next_commands.join('\n'), /review close .*--agent-id "agent-architecture-fit".*--close-reason manual_shutdown.*--close-evidence <close-evidence>/);
  assert.doesNotMatch(openLifecycle.next_commands.join('\n'), /newer-running-agent/);
});

test('healthy verified closed roles are not candidates', async () => {
  const root = await setupRepairRepo();
  const { result } = await runCli(['review', 'repair', root, '--json']);
  assert.equal(findCandidate(result, 'story-repair-broken', 'code_quality'), undefined);
  assert.ok(!result.candidates.some((item) => item.story_id === 'story-repair-healthy'));
});

test('--story-id filters candidates', async () => {
  const root = await setupRepairRepo();
  const { result } = await runCli(['review', 'repair', root, '--story-id', 'story-repair-healthy', '--json']);
  assert.equal(result.candidates.length, 0);
});

test('repair writes repair-plan.json unless dry-run, and never mutates review summaries', async () => {
  const root = await setupRepairRepo();
  const summaryPath = path.join(root, '.vibepro', 'reviews', 'story-repair-broken', 'gate', 'review-summary.json');
  const planPath = path.join(root, '.vibepro', 'reviews', 'story-repair-broken', 'gate', 'repair-plan.json');
  const before = await readFile(summaryPath, 'utf8');

  const dry = await runCli(['review', 'repair', root, '--dry-run', '--json']);
  assert.equal(dry.result.dry_run, true);
  assert.equal(await fileExists(planPath), false, 'dry-run must not write repair-plan.json');

  await runCli(['review', 'repair', root, '--json']);
  assert.equal(await fileExists(planPath), true, 'repair must write repair-plan.json');
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  assert.ok(plan.candidates.length >= 5);

  const after = await readFile(summaryPath, 'utf8');
  assert.equal(after, before, 'review-summary.json must not be mutated');
});

test('usage report incomplete review gap points to review repair', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-review-repair-report-'));
  const storyDir = path.join(root, 'docs', 'management', 'stories', 'active');
  await mkdir(storyDir, { recursive: true });
  await writeFile(
    path.join(storyDir, 'story-repair-broken.md'),
    '---\nstory_id: story-repair-broken\ntitle: broken\nstatus: active\n---\n\n# story\n'
  );
  await writeReviewSummary(root, 'story-repair-broken', 'gate', [role('gate_evidence')]);
  const report = await createUsageReport(root);
  const story = report.stories.find((item) => item.story_id === 'story-repair-broken');
  const gap = story.traceability_gaps.find((item) => item.kind === 'traceability_incomplete_review_evidence');
  assert.ok(gap, 'incomplete review evidence gap must exist');
  assert.match(gap.next_command, /vibepro review repair \. --story-id story-repair-broken/);
});
