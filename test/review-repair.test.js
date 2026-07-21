import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { createUsageReport } from '../src/usage-report.js';
import { buildReviewRepairPlan, renderReviewRepair } from '../src/review-repair.js';

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
    role('human_usability', {
      status: 'pass',
      effective_status: 'stale',
      stale: true,
      provenance_status: 'verified_agent',
      lifecycle: {
        effective_status: 'running',
        latest: {
          lifecycle_id: 'lifecycle-human-usability-running',
          status: 'running',
          effective_status: 'running',
          agent_system: 'codex',
          agent_id: 'agent-human-usability-running'
        }
      },
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

test('plain-text repair plan renders actionable next commands', () => {
  const rendered = renderReviewRepair({
    dry_run: true,
    candidates: [{ story_id: 'story-render', stage: 'gate', role: 'gate_evidence', action: 'rereview', reason: 'missing', next_commands: ['vibepro review prepare . --id story-render --stage gate --role gate_evidence'] }],
    plans: []
  });
  assert.match(rendered, /vibepro review prepare \. --id story-render --stage gate --role gate_evidence/);
  assert.doesNotMatch(rendered, /(?:^|\s)<[^>]+>/m, 'template placeholders must be shell-quoted instead of parsed as redirection');
});

function findCandidate(result, storyId, roleName) {
  return result.candidates.find((item) => item.story_id === storyId && item.role === roleName);
}

function parseEmittedReviewCommand(command, repoRoot) {
  const tokens = [];
  for (const match of command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  assert.equal(tokens.shift(), 'vibepro');
  const repoIndex = tokens.indexOf('.');
  if (repoIndex >= 0) tokens[repoIndex] = repoRoot;
  return tokens;
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
  assert.match(joined, /review start .*--agent-thread-id "<replacement-agent-thread-id>".*--agent-session-id "<replacement-agent-session-id>"/);
  assert.match(joined, /review record .*--agent-closed/);
  assert.match(joined, /review record .*--inspection-input "<inspection-input>"/);
  assert.match(joined, /review record .*--judgment-delta/);
  assert.match(joined, /review record .*--agent-id "<replacement-agent-id>".*--agent-thread-id "<replacement-agent-thread-id>"/);
  assert.match(joined, /review record .*--agent-session-id "<replacement-agent-session-id>"/);
  assert.match(joined, /review record .*--implementation-session-id "<implementation-session-id>".*--reviewer-identity separate_session/);
  assert.match(joined, /review record .*--agent-transcript "<replacement-agent-transcript>"/);
  assert.match(joined, /review record .*--agent-close-evidence "<replacement-agent-close-evidence>"/);
  assert.doesNotMatch(joined, /(?:^|\s)<[^>]+>/m, 'all emitted placeholders must be shell-quoted');
});

test('architecture boundary repair emits all aggregate inspection inputs', async () => {
  const root = await setupRepairRepo();
  await writeReviewSummary(root, 'story-repair-broken', 'architecture_spec', [
    role('architecture_boundary')
  ]);
  const { result } = await runCli(['review', 'repair', root, '--json']);
  const candidate = result.candidates.find((item) => item.stage === 'architecture_spec' && item.role === 'architecture_boundary');
  assert.ok(candidate, 'aggregate architecture boundary repair must be emitted');
  const recordCommand = candidate.next_commands.find((command) => command.startsWith('vibepro review record'));
  assert.match(recordCommand, /--inspection-input "<design-story-spec-path>"/);
  assert.match(recordCommand, /--inspection-input "<runtime-source-path>"/);
  assert.match(recordCommand, /--inspection-input "<test-path>"/);
});

test('emitted repair chain executes with one replacement lifecycle identity', async () => {
  const root = await setupRepairRepo();
  const { result } = await runCli(['review', 'repair', root, '--json']);
  const candidate = findCandidate(result, 'story-repair-broken', 'gate_evidence');
  const transcript = '.vibepro/reviews/story-repair-broken/gate/replacement-transcript.md';
  await writeFile(path.join(root, transcript), '# independent replacement review\n');
  const replacements = new Map([
    ['<codex|claude_code>', 'codex'],
    ['<replacement-agent-id>', 'replacement-agent-1'],
    ['<replacement-agent-thread-id>', 'replacement-thread-1'],
    ['<replacement-agent-session-id>', 'replacement-session-1'],
    ['<pass|needs_changes|block>', 'pass'],
    ['<summary>', 'replacement review passed'],
    ['<inspection-summary>', 'inspected index.html recovery surface'],
    ['<inspection-evidence>', transcript],
    ['<inspection-input>', 'index.html'],
    ['<initial judgment -> final judgment because evidence>', 'unverified to pass because replacement evidence is closed'],
    ['<implementation-session-id>', 'implementation-session-1'],
    ['<replacement-agent-transcript>', transcript],
    ['<replacement-agent-close-evidence>', transcript]
  ]);
  for (const emitted of candidate.next_commands) {
    let executable = emitted;
    for (const [placeholder, value] of replacements) executable = executable.replaceAll(placeholder, value);
    const executed = await runCli(parseEmittedReviewCommand(executable, root));
    assert.equal(executed.exitCode, 0, `emitted command must execute: ${executable}\n${JSON.stringify(executed)}`);
  }
  const summary = JSON.parse(await readFile(path.join(root, '.vibepro', 'reviews', 'story-repair-broken', 'gate', 'review-summary.json'), 'utf8'));
  const recorded = summary.roles.find((item) => item.role === 'gate_evidence');
  assert.equal(recorded.agent_provenance.agent_id, 'replacement-agent-1');
  assert.equal(recorded.agent_provenance.thread_id, 'replacement-thread-1');
  assert.equal(recorded.agent_provenance.session_id, 'replacement-session-1');
  assert.equal(recorded.agent_provenance.lifecycle.agent_closed, true);
  assert.equal(recorded.agent_provenance.transcript_artifact, transcript);
});

test('stale role becomes rerun_stale_review and timed_out becomes replace_timed_out_review', async () => {
  const root = await setupRepairRepo();
  const { result } = await runCli(['review', 'repair', root, '--json']);
  assert.equal(findCandidate(result, 'story-repair-broken', 'pr_split_scope').action, 'rerun_stale_review');
  const timedOut = findCandidate(result, 'story-repair-broken', 'release_risk');
  assert.equal(timedOut.action, 'replace_timed_out_review');
  assert.equal(timedOut.effective_status, 'missing');
  assert.match(timedOut.reason, /lifecycle timed out/);
  assert.match(timedOut.next_commands.join('\n'), /review close .*--agent-id "agent-release-risk".*--close-reason timeout.*--close-evidence "<close-evidence>"/);
  assert.match(timedOut.next_commands.join('\n'), /review start .*--agent-system codex.*--replacement-for lifecycle-release-risk/);
  const recovery = timedOut.next_commands.join('\n');
  assert.match(recovery, /review start .*--agent-thread-id "<replacement-agent-thread-id>".*--agent-session-id "<replacement-agent-session-id>"/);
  assert.match(recovery, /review start[\s\S]*review close .*--agent-id "<replacement-agent-id>".*--close-reason completed[\s\S]*review record/);
  assert.match(recovery, /review record .*--agent-id "<replacement-agent-id>".*--agent-thread-id "<replacement-agent-thread-id>".*--agent-session-id "<replacement-agent-session-id>"/);
  assert.match(recovery, /review record .*--agent-transcript "<replacement-agent-transcript>".*--agent-close-evidence "<replacement-agent-close-evidence>"/, 'one replacement lifecycle identity and its evidence must survive the full emitted chain');
});

test('stale result with a latest running lifecycle closes and replaces that lifecycle', async () => {
  const root = await setupRepairRepo();
  const { result } = await runCli(['review', 'repair', root, '--json']);
  const candidate = findCandidate(result, 'story-repair-broken', 'human_usability');
  assert.equal(candidate.action, 'close_and_rerecord');
  assert.match(candidate.reason, /lifecycle is not closed/);
  const chain = candidate.next_commands.join('\n');
  assert.match(chain, /review close .*--agent-id "agent-human-usability-running".*--close-reason manual_shutdown/);
  assert.match(chain, /review start .*--replacement-for lifecycle-human-usability-running(?:\s|$)/);
});

test('pass without provenance and unclosed lifecycle are repair candidates', async () => {
  const root = await setupRepairRepo();
  const { result } = await runCli(['review', 'repair', root, '--json']);
  assert.equal(findCandidate(result, 'story-repair-broken', 'security_boundary').action, 'rerecord_with_provenance');
  const openLifecycle = findCandidate(result, 'story-repair-broken', 'architecture_fit');
  assert.equal(openLifecycle.action, 'close_and_rerecord');
  assert.equal(openLifecycle.effective_status, 'unverified_agent');
  assert.match(openLifecycle.next_commands.join('\n'), /review close .*--agent-id "newer-running-agent".*--close-reason manual_shutdown.*--close-evidence "<close-evidence>"/);
  assert.match(openLifecycle.next_commands.join('\n'), /review start .*--replacement-for lifecycle-architecture-fit-newer(?:\s|$)/, 'manual shutdown close and replacement must use the same latest lifecycle');
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
