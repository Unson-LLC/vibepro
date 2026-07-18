import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import { runCli } from '../../src/cli.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-vibepro-fake-value-hardening';

async function git(repo, args) {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      return await execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
    } catch (error) {
      if (error.code !== 'EAGAIN' || attempt === 10) throw error;
      await delay(250 * attempt);
    }
  }
  throw new Error('unreachable git retry state');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function runCliWithOutput(args) {
  let stdout = '';
  let stderr = '';
  const result = await runCli(args, {
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: (chunk) => { stderr += chunk; } }
  });
  return { ...result, stdout, stderr };
}

async function makeStoryRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-fvh-e2e-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', STORY_ID, '--title', 'VibePro fake-value hardening', '--view', 'dev', '--period', '2026-06']);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init story repo']);
  await git(repo, ['switch', '-c', 'feature/fake-value-hardening']);

  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'test'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`), `---
story_id: ${STORY_ID}
title: VibePro fake-value hardening
architecture_docs:
  - docs/architecture/fake-value-hardening.md
spec_docs:
  - docs/specs/fake-value-hardening.md
---

# VibePro fake-value hardening

## User Story

I want VibePro to avoid fake green gate artifacts for accepted follow-up, review provenance, and gate evidence handoff.

## Acceptance Criteria

- [ ] active axisにmissing evidenceが残る場合、Gate DAG node statusはpassedではなくaccepted_followupまたはneeds_evidenceになる
- [ ] accepted_followupはPR readinessを止めないが、Gate DAG/PR artifact上で通常のpassedと区別できる
- [ ] axis waiver decisionにartifact linkまたはcurrent-safety artifactがない場合、missing evidenceはactive_needs_evidenceのまま残る
- [ ] Codex/Claude Code subagent reviewはagent_idだけではverifiedにならず、thread/session/call idまたはtranscript artifactが必要になる
- [ ] required gate evidence reviewのpassは、inspection summary、inspection inputs、judgment deltaがない場合に記録時点で拒否される
- [ ] 既存review artifactの読み取り互換性は壊さず、新規pass記録の最低要件だけを厳格化する
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'fake-value-hardening.md'), `# Fake-value hardening Architecture

Compatibility impact: PR body output and Gate DAG output change, but accepted_followup remains non-blocking.
Boundary: review record, review status, pr prepare, gate-dag, pr-body, review cockpit, and html-report must agree.
Failure mode: fake green artifact, missing evidence hidden as passed, weak provenance, and unreconstructable review handoff.
`);
  await writeFile(path.join(repo, 'docs', 'specs', 'fake-value-hardening.md'), `# Fake-value hardening Spec

- FVH-AXIS-001: Missing evidence with artifact-backed accepted decision becomes accepted_followup, never passed.
- FVH-AXIS-002: Missing evidence without artifact-backed accepted decision remains active_needs_evidence.
- FVH-REVIEW-001: agent_id alone is declared provenance, not strong provenance.
- FVH-REVIEW-002: gate_evidence pass requires inspection summary, inspection inputs, and judgment delta.
- FVH-SCENARIO-001: Given active_needs_evidence, when an accepted decision includes a reason and artifact, then the Gate DAG transition is accepted_followup.
- FVH-SCENARIO-002: Given an existing review artifact stores evidence_strength=strong, when it lacks thread/session/call/transcript, then review status treats it as unverified_agent.
`);
  await writeFile(path.join(repo, 'src', 'fake-value-workflow.js'), 'export const fakeValueWorkflow = "agent workflow gate-dag pr-prepare review provenance accepted_followup";\n');
  await writeFile(path.join(repo, 'test', 'fake-value-workflow.test.js'), 'export const fakeValueRegression = "flow_replay scenario_clause_e2e gate-dag review artifact";\n');
  await git(repo, ['add', 'docs/management/stories/active', 'docs/architecture/fake-value-hardening.md', 'docs/specs/fake-value-hardening.md', 'src/fake-value-workflow.js', 'test/fake-value-workflow.test.js']);
  await git(repo, ['commit', '-m', 'feat: add fake-value workflow fixture']);
  return repo;
}

function nodeById(prepare, id) {
  return prepare.pr_context.gate_dag.nodes.find((node) => node.id === id);
}

test('story-vibepro-fake-value-hardening exercises accepted_followup and active_needs_evidence artifacts', async () => {
  const followupRepo = await makeStoryRepo();
  const followupDecision = await runCli([
    'decision',
    'record',
    followupRepo,
    '--id',
    STORY_ID,
    '--type',
    'waiver',
    '--summary',
    'current public contract behavior is safe; defer remaining verification',
    '--source',
    'gate:judgment_axis_public_contract',
    '--reason',
    'bounded follow-up tracked in architecture artifact',
    '--artifact',
    'docs/architecture/fake-value-hardening.md',
    '--status',
    'accepted',
    '--json'
  ]);
  assert.equal(followupDecision.exitCode, 0);

  const followupResult = await runCli([
    'pr', 'prepare', followupRepo, '--base', 'main', '--story-id', STORY_ID, '--json',
    '--evidence-depth', 'standard',
    '--evidence-depth-reason', 'verify accepted follow-up reviewer surfaces',
    '--evidence-depth-consumer', 'fake-value-hardening-e2e',
    '--evidence-depth-target', 'gate-dag.html',
    '--evidence-depth-target', 'pr-prepare.html',
    '--evidence-depth-target', 'review-cockpit.html'
  ]);
  assert.equal(followupResult.exitCode, 0);
  const followupPrepare = followupResult.result.preparation;
  const acceptedAxis = followupPrepare.pr_context.engineering_judgment.judgment_axes.find((item) => item.axis === 'public_contract');
  assert.equal(acceptedAxis.status, 'active_accepted_followup');
  assert.equal(acceptedAxis.missing_evidence.includes('current_verification'), true);
  const acceptedGate = nodeById(followupPrepare, 'gate:judgment_axis_public_contract');
  assert.equal(acceptedGate.status, 'accepted_followup');
  assert.equal(acceptedGate.axis_status, 'active_accepted_followup');
  assert.notEqual(acceptedGate.status, 'passed');
  assert.equal(followupPrepare.pr_context.gate_dag.summary.judgment_axis_accepted_followup_count >= 1, true);
  assert.equal(
    acceptedGate.status !== 'passed' && ['accepted_followup', 'needs_evidence'].includes(acceptedGate.status),
    true,
    'story-vibepro-fake-value-hardening ac:1 active axisにmissing evidenceが残る場合、Gate DAG node statusはpassedではなくaccepted_followupまたはneeds_evidenceになる'
  );
  assert.equal(
    followupPrepare.gate_status.execution_gate.blocking_gates.some((gate) => gate.id === 'gate:judgment_axis_public_contract'),
    false,
    'story-vibepro-fake-value-hardening ac:2 accepted_followupはPR readinessを止めないが、Gate DAG/PR artifact上で通常のpassedと区別できる'
  );
  assert.equal(
    acceptedGate.status === 'accepted_followup' && acceptedGate.status !== 'passed',
    true,
    'story-vibepro-fake-value-hardening S-001 Given an active public_contract axis with missing current_verification evidence, when an accepted decision has an artifact-backed follow-up, pr prepare emits gate:judgment_axis_public_contract with status accepted_followup.'
  );
  assert.equal(
    acceptedGate.axis_status === 'active_accepted_followup' && acceptedGate.status === 'accepted_followup',
    true,
    'story-vibepro-fake-value-hardening S-002 Given a workflow gate state for an active public_contract axis is active_needs_evidence, when an accepted decision includes both a safety reason and artifact-backed follow-up, then the Gate DAG state transition becomes accepted_followup instead of passed.'
  );

  const prBody = await readFile(path.join(followupRepo, '.vibepro', 'pr', STORY_ID, 'pr-body.md'), 'utf8');
  const gateDagHtml = await readFile(path.join(followupRepo, '.vibepro', 'pr', STORY_ID, 'gate-dag.html'), 'utf8');
  const prPrepareHtml = await readFile(path.join(followupRepo, '.vibepro', 'pr', STORY_ID, 'pr-prepare.html'), 'utf8');
  const reviewCockpitHtml = await readFile(path.join(followupRepo, '.vibepro', 'pr', STORY_ID, 'review-cockpit.html'), 'utf8');
  assert.match(prBody, /証跡: \[\.vibepro\/pr\/story-vibepro-fake-value-hardening\/\]\(\.vibepro\/pr\/story-vibepro-fake-value-hardening\/\)/);
  assert.doesNotMatch(prBody, /public_contract:[^\n]*active_accepted_followup/);
  assert.match(gateDagHtml, /gate:judgment_axis_public_contract[\s\S]{0,600}accepted_followup/);
  assert.doesNotMatch(gateDagHtml, /gate:judgment_axis_public_contract[\s\S]{0,600}passed/);
  assert.match(prPrepareHtml, /accepted_followup/);
  assert.match(reviewCockpitHtml, /accepted_followup/);

  const missingRepo = await makeStoryRepo();
  const artifactlessDecision = await runCli([
    'decision',
    'record',
    missingRepo,
    '--id',
    STORY_ID,
    '--type',
    'waiver',
    '--summary',
    'current public contract behavior is safe; defer remaining verification',
    '--source',
    'gate:judgment_axis_public_contract',
    '--reason',
    'no artifact was supplied',
    '--status',
    'accepted',
    '--json'
  ]);
  assert.equal(artifactlessDecision.exitCode, 0);
  const missingResult = await runCli([
    'pr', 'prepare', missingRepo, '--base', 'main', '--story-id', STORY_ID, '--json',
    '--evidence-depth', 'standard',
    '--evidence-depth-reason', 'verify missing-evidence reviewer surfaces',
    '--evidence-depth-consumer', 'fake-value-hardening-e2e',
    '--evidence-depth-target', 'gate-dag.html',
    '--evidence-depth-target', 'pr-prepare.html',
    '--evidence-depth-target', 'review-cockpit.html'
  ]);
  assert.equal(missingResult.exitCode, 0);
  const missingPrepare = missingResult.result.preparation;
  const missingAxis = missingPrepare.pr_context.engineering_judgment.judgment_axes.find((item) => item.axis === 'public_contract');
  assert.equal(missingAxis.status, 'active_needs_evidence');
  assert.equal(missingAxis.ignored_accepted_decision.missing_fields.includes('artifact'), true);
  const missingGate = nodeById(missingPrepare, 'gate:judgment_axis_public_contract');
  assert.equal(missingGate.status, 'needs_evidence');
  assert.equal(
    missingAxis.status === 'active_needs_evidence' && missingAxis.ignored_accepted_decision.missing_fields.includes('artifact'),
    true,
    'story-vibepro-fake-value-hardening ac:3 axis waiver decisionにartifact linkまたはcurrent-safety artifactがない場合、missing evidenceはactive_needs_evidenceのまま残る'
  );

  const missingPrBody = await readFile(path.join(missingRepo, '.vibepro', 'pr', STORY_ID, 'pr-body.md'), 'utf8');
  const missingGateDagHtml = await readFile(path.join(missingRepo, '.vibepro', 'pr', STORY_ID, 'gate-dag.html'), 'utf8');
  const missingPrPrepareHtml = await readFile(path.join(missingRepo, '.vibepro', 'pr', STORY_ID, 'pr-prepare.html'), 'utf8');
  const missingReviewCockpitHtml = await readFile(path.join(missingRepo, '.vibepro', 'pr', STORY_ID, 'review-cockpit.html'), 'utf8');
  assert.match(missingPrBody, /証跡: \[\.vibepro\/pr\/story-vibepro-fake-value-hardening\/\]\(\.vibepro\/pr\/story-vibepro-fake-value-hardening\/\)/);
  assert.doesNotMatch(missingPrBody, /public_contract: active_needs_evidence[\s\S]*?missing=/);
  assert.match(missingGateDagHtml, /gate:judgment_axis_public_contract[\s\S]{0,600}needs_evidence/);
  assert.doesNotMatch(missingGateDagHtml, /gate:judgment_axis_public_contract[\s\S]{0,600}passed/);
  assert.match(missingPrPrepareHtml, /public_contract: active_needs_evidence[\s\S]{0,300}gate=needs_evidence/);
  assert.doesNotMatch(missingPrPrepareHtml, /public_contract: active_needs_evidence[\s\S]{0,300}gate=passed/);
  assert.match(missingReviewCockpitHtml, /public_contract: active_needs_evidence[\s\S]{0,300}gate=needs_evidence/);
  assert.doesNotMatch(missingReviewCockpitHtml, /public_contract: active_needs_evidence[\s\S]{0,300}gate=passed/);
});

test('story-vibepro-fake-value-hardening exercises review provenance and gate evidence handoff gates', async () => {
  const repo = await makeStoryRepo();
  await runCli(['review', 'prepare', repo, '--id', STORY_ID, '--stage', 'implementation', '--role', 'runtime_contract']);

  const agentIdOnlyRecord = await runCli([
    'review',
    'record',
    repo,
    '--id',
    STORY_ID,
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--status',
    'pass',
    '--summary',
    'agent id only must not verify',
    '--inspection-summary',
    'inspected the fake-value workflow fixture before evaluating provenance',
    '--inspection-evidence',
    'runtime contract provenance fixture',
    '--inspection-input',
    'src/fake-value-workflow.js',
    '--judgment-delta',
    'runtime contract present -> provenance remains unverified because only an agent id was supplied',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-agent-id-only',
    '--agent-closed'
  ]);
  assert.equal(agentIdOnlyRecord.exitCode, 0);
  assert.equal(agentIdOnlyRecord.result.review.agent_provenance.evidence_strength, 'declared');

  const statusWithAgentIdOnly = await runCli(['review', 'status', repo, '--id', STORY_ID, '--stage', 'implementation', '--json']);
  const agentIdOnlyRole = statusWithAgentIdOnly.result.stages[0].roles.find((role) => role.role === 'runtime_contract');
  assert.equal(agentIdOnlyRole.effective_status, 'unverified_agent');
  assert.equal(agentIdOnlyRole.provenance_status, 'weak_agent_provenance');
  assert.equal(
    agentIdOnlyRole.effective_status === 'unverified_agent' && agentIdOnlyRole.provenance_status === 'weak_agent_provenance',
    true,
    'story-vibepro-fake-value-hardening ac:4 Codex/Claude Code subagent reviewはagent_idだけではverifiedにならず、thread/session/call idまたはtranscript artifactが必要になる'
  );

  const resultPath = path.join(repo, '.vibepro', 'reviews', STORY_ID, 'implementation', 'review-result-runtime_contract.json');
  const legacyStrongReview = await readJson(resultPath);
  legacyStrongReview.agent_provenance.evidence_strength = 'strong';
  await writeJson(resultPath, legacyStrongReview);
  const statusWithLegacyStrong = await runCli(['review', 'status', repo, '--id', STORY_ID, '--stage', 'implementation', '--json']);
  const legacyStrongRole = statusWithLegacyStrong.result.stages[0].roles.find((role) => role.role === 'runtime_contract');
  assert.equal(legacyStrongRole.effective_status, 'unverified_agent');
  assert.equal(legacyStrongRole.provenance_status, 'weak_agent_provenance');
  assert.equal(
    legacyStrongRole.effective_status === 'unverified_agent' && legacyStrongRole.provenance_status === 'weak_agent_provenance',
    true,
    'story-vibepro-fake-value-hardening ac:6 既存review artifactの読み取り互換性は壊さず、新規pass記録の最低要件だけを厳格化する'
  );

  await runCli(['review', 'prepare', repo, '--id', STORY_ID, '--stage', 'gate', '--role', 'gate_evidence']);
  const rejectedGatePass = await runCliWithOutput([
    'review',
    'record',
    repo,
    '--id',
    STORY_ID,
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    'pass',
    '--summary',
    'gate evidence pass without handoff must be rejected',
    '--inspection-summary',
    'looked at gate evidence',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'gate-evidence-agent',
    '--agent-thread-id',
    'thread-gate-evidence-agent',
    '--agent-closed'
  ]);
  assert.notEqual(rejectedGatePass.exitCode, 0);
  assert.match(
    `${rejectedGatePass.stderr}\n${rejectedGatePass.stdout}`,
    /inspection inputs|judgment delta|gate_evidence/,
    'story-vibepro-fake-value-hardening ac:5 required gate evidence reviewのpassは、inspection summary、inspection inputs、judgment deltaがない場合に記録時点で拒否される'
  );

  const validGatePass = await runCli([
    'review',
    'record',
    repo,
    '--id',
    STORY_ID,
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    'pass',
    '--summary',
    'gate evidence handoff is reconstructable',
    '--inspection-summary',
    'read the workflow source that drives Gate DAG and verification evidence',
    '--inspection-input',
    'src/fake-value-workflow.js',
    '--judgment-delta',
    'missing handoff -> concrete input and judgment delta recorded',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'gate-evidence-agent-verified',
    '--agent-thread-id',
    'thread-gate-evidence-agent-verified',
    '--agent-closed'
  ]);
  assert.equal(validGatePass.exitCode, 0);
  assert.deepEqual(validGatePass.result.review.inspection.inputs, ['src/fake-value-workflow.js']);
  assert.equal(validGatePass.result.review.judgment_delta.length, 1);
});

test('story-vibepro-fake-value-hardening exercises failure-mode coverage with current artifact evidence', async () => {
  const repo = await makeStoryRepo();
  await mkdir(path.join(repo, 'artifacts'), { recursive: true });
  await writeFile(path.join(repo, 'artifacts', 'failure-mode-coverage.json'), JSON.stringify({ status: 'pass', coverage: 'current' }, null, 2));
  const unresolved = await runCli([
    'pr', 'prepare', repo, '--base', 'main', '--story-id', STORY_ID, '--json',
    '--evidence-depth', 'standard',
    '--evidence-depth-reason', 'replay failure-mode gate artifacts',
    '--evidence-depth-consumer', 'fake-value-hardening-e2e',
    '--evidence-depth-target', 'gate-dag.json',
    '--evidence-depth-target', 'review-cockpit.html'
  ]);
  assert.equal(unresolved.exitCode, 0);
  const unresolvedFailureGate = nodeById(unresolved.result.preparation, 'gate:failure_mode_coverage');
  assert.equal(unresolvedFailureGate.high_risk, true);
  assert.equal(unresolvedFailureGate.candidate_count >= 1, true);
  assert.notEqual(unresolvedFailureGate.reason, 'No route-specific failure mode candidates were detected');
  assert.equal(unresolvedFailureGate.status, 'missing_coverage');
  assert.equal(unresolvedFailureGate.missing_modes.includes('evidence_lifecycle_regression'), true);

  const partialVerification = await runCli([
    'verify',
    'record',
    repo,
    '--id',
    STORY_ID,
    '--kind',
    'integration',
    '--status',
    'pass',
    '--command',
    'node --test test/e2e/story-vibepro-fake-value-hardening-main.spec.js --grep flow_replay scenario_clause_e2e gate-dag review artifact',
    '--summary',
    'scenario-only evidence claims evidence_lifecycle_regression, workflow_state_regression, flow_replay, scenario_clause_e2e, gate-dag review artifact coverage but lacks an inspected target',
    '--artifact',
    'artifacts/failure-mode-coverage.json',
    '--scenario',
    'evidence_lifecycle_regression',
    '--scenario',
    'workflow_state_regression',
    '--json'
  ]);
  assert.equal(partialVerification.exitCode, 0);
  assert.equal(partialVerification.result.evidence.commands.at(-1).observation_check.status, 'partial');

  const stillUnresolved = await runCli([
    'pr', 'prepare', repo, '--base', 'main', '--story-id', STORY_ID, '--json',
    '--evidence-depth', 'standard',
    '--evidence-depth-reason', 'replay partial failure-mode gate artifacts',
    '--evidence-depth-consumer', 'fake-value-hardening-e2e',
    '--evidence-depth-target', 'gate-dag.json',
    '--evidence-depth-target', 'review-cockpit.html'
  ]);
  assert.equal(stillUnresolved.exitCode, 0);
  const partialFailureGate = nodeById(stillUnresolved.result.preparation, 'gate:failure_mode_coverage');
  assert.equal(partialFailureGate.status, 'missing_coverage');
  assert.equal(partialFailureGate.missing_modes.includes('evidence_lifecycle_regression'), true);
  const partialSpineGate = nodeById(stillUnresolved.result.preparation, 'gate:common_judgment_spine');
  assert.equal(partialSpineGate.status, 'needs_evidence');
  assert.equal(
    partialSpineGate.subchecks.find((check) => check.id === 'current_reality').status,
    'needs_evidence'
  );
  assert.equal(
    partialSpineGate.subchecks.find((check) => check.id === 'failure_modes').status,
    'needs_evidence'
  );
  assert.equal(
    partialSpineGate.subchecks.find((check) => check.id === 'done_evidence').status,
    'needs_evidence'
  );
  const partialPathSurfaceGate = nodeById(stillUnresolved.result.preparation, 'gate:path_surface_matrix');
  assert.notEqual(partialPathSurfaceGate.status, 'passed');
  assert.equal(partialPathSurfaceGate.missing_surfaces.includes('review_surface'), true);

  const verification = await runCli([
    'verify',
    'record',
    repo,
    '--id',
    STORY_ID,
    '--kind',
    'e2e',
    '--status',
    'pass',
    '--command',
    'node --test test/e2e/story-vibepro-fake-value-hardening-main.spec.js',
    '--summary',
    'current executable evidence for story failure-mode gates',
    '--artifact',
    'artifacts/failure-mode-coverage.json',
    '--target',
    'src/fake-value-workflow.js',
    '--target',
    `.vibepro/pr/${STORY_ID}/gate-dag.json`,
    '--target',
    `.vibepro/pr/${STORY_ID}/review-cockpit.html`,
    '--scenario',
    'evidence_lifecycle_regression',
    '--scenario',
    'workflow_state_regression',
    '--scenario',
    'flow_replay',
    '--scenario',
    'artifact_replay',
    '--scenario',
    'scenario_clause_e2e',
    '--json'
  ]);
  assert.equal(verification.exitCode, 0);

  const resolved = await runCli([
    'pr', 'prepare', repo, '--base', 'main', '--story-id', STORY_ID, '--json',
    '--evidence-depth', 'standard',
    '--evidence-depth-reason', 'replay resolved failure-mode gate artifacts',
    '--evidence-depth-consumer', 'fake-value-hardening-e2e',
    '--evidence-depth-target', 'gate-dag.json',
    '--evidence-depth-target', 'review-cockpit.html'
  ]);
  assert.equal(resolved.exitCode, 0);
  const resolvedFailureGate = nodeById(resolved.result.preparation, 'gate:failure_mode_coverage');
  assert.equal(resolvedFailureGate.candidate_count >= 1, true);
  assert.equal(resolvedFailureGate.status, 'missing_coverage');
  assert.deepEqual(resolvedFailureGate.missing_modes, ['parse_failure']);
  assert.equal(
    resolvedFailureGate.modes.every((mode) => mode.id === 'parse_failure' || mode.status === 'covered' || mode.status === 'not_required'),
    true
  );
  const resolvedSpineGate = nodeById(resolved.result.preparation, 'gate:common_judgment_spine');
  assert.equal(resolvedSpineGate.status, 'passed');
  assert.equal(
    resolvedSpineGate.subchecks
      .filter((check) => ['current_reality', 'failure_modes', 'done_evidence'].includes(check.id))
      .every((check) => check.status === 'passed'),
    true
  );
  const resolvedPathSurfaceGate = nodeById(resolved.result.preparation, 'gate:path_surface_matrix');
  assert.equal(resolvedPathSurfaceGate.status, 'passed');
  assert.equal(resolvedPathSurfaceGate.missing_surface_count, 0);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'pr', STORY_ID, 'gate-dag.json')), true);
  assert.equal(createHash('sha256').update(JSON.stringify(resolvedFailureGate.modes)).digest('hex').length, 64);
});
