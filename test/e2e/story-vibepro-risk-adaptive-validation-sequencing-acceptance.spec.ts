import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { runCli } from '../../src/cli.js';
import { readValidationSequence } from '../../src/validation-sequencing.js';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const unitResult = (async () => {
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...childEnv } = process.env;
  return execFileAsync(process.execPath, ['--test', 'test/validation-sequencing.test.js'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: childEnv
  });
})();
const ciResult = (async () => {
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...childEnv } = process.env;
  return execFileAsync(process.execPath, ['--test', 'test/ci-evidence-import.test.js'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: childEnv
  });
})();

test('public sequence help exposes phase order and terminal dispositions', async () => {
  let stdout = '';
  const result = await runCli(['sequence', '--help', '--language', 'en'], {
    stdout: { write: (chunk) => { stdout += chunk; } }
  });
  assert.equal(result.exitCode, 0);
  assert.match(stdout, /targeted_validation -> preflight_review -> code_frozen -> expensive_verification -> final_review/);
  assert.match(stdout, /accepted\|rejected\|duplicate\|deferred\|false_positive/);
  stdout = '';
  assert.equal((await runCli(['--help', '--language', 'en'], { stdout: { write: (chunk) => { stdout += chunk; } } })).exitCode, 0);
  assert.match(stdout, /vibepro sequence/);
  stdout = '';
  assert.equal((await runCli(['--help', '--language', 'ja'], { stdout: { write: (chunk) => { stdout += chunk; } } })).exitCode, 0);
  assert.match(stdout, /vibepro sequence/);
  stdout = '';
  assert.equal((await runCli(['sequence', '--help', '--language', 'ja'], { stdout: { write: (chunk) => { stdout += chunk; } } })).exitCode, 0);
  assert.match(stdout, /follow_up_command/);
});

test('AC-1 high-risk work receives a boundary-specific preflight plan', async () => {
  const result = await unitResult;
  assert.match(result.stdout, /high-risk plan schedules one canonical aggregate boundary preflight/, 'ac-1 RVS-S-1');
});

test('AC-2 preflight review is advisory and cannot satisfy final review', async () => {
  const result = await unitResult;
  assert.match(result.stdout, /advisory preflight never satisfies final review/, 'ac-2 RVS-S-2');
});

test('AC-3 code freeze requires targeted validation and preflight disposition', async () => {
  const result = await unitResult;
  assert.match(result.stdout, /freeze waits for its disposition/, 'ac-3 RVS-S-3');
});

test('AC-4 exact frozen binding reuses expensive verification', async () => {
  const result = await unitResult;
  assert.match(result.stdout, /expensive verification is reused only at the exact frozen binding/, 'ac-4 RVS-S-4');
});

test('AC-5 documentation changes invalidate only downstream phases', async () => {
  const result = await unitResult;
  assert.match(result.stdout, /mutation invalidates scoped phases and unknown surfaces fail closed/, 'ac-5 RVS-S-5');
});

test('AC-6 unclassified mutations fail closed', async () => {
  const result = await unitResult;
  assert.match(result.stdout, /unknown surfaces fail closed/, 'ac-6 RVS-S-6');
});

test('AC-7 final review must bind to current HEAD', async () => {
  const result = await unitResult;
  assert.match(result.stdout, /final readiness requires final review at current HEAD even when CI supplied expensive evidence/, 'ac-7 RVS-S-7');
});

test('AC-8 imported current-head CI is reusable expensive verification', async () => {
  const result = await ciResult;
  assert.match(result.stdout, /public path records frozen node test coverage/, 'ac-8 RVS-S-8');
});

test('AC-9 S-001 acceptance matrix executes without failures', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-sequence-e2e-'));
  await writeFile(path.join(root, 'index.js'), 'export const sequence = true;\n');
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await runCli(['init', root, '--story-id', 'story-sequence-e2e', '--title', 'Sequence E2E']);
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'test: initialize sequence fixture'], { cwd: root });
  const { stdout: head } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const headSha = head.trim();
  const common = [root, '--id', 'story-sequence-e2e', '--head', headSha, '--command', 'node --test', '--test-fingerprint', 'suite-v1', '--json'];
  const plan = await runCli(['sequence', 'plan', ...common, '--risk-profile', 'workflow_heavy', '--surface', 'core_workflow_state']);
  assert.equal(plan.exitCode, 0);
  assert.equal(plan.result.evaluation.next_required_action.phase, 'targeted_validation');

  let stderr = '';
  const premature = await runCli(['sequence', 'record', ...common, '--phase', 'code_frozen'], {
    stderr: { write: (chunk) => { stderr += chunk; } }
  });
  assert.equal(premature.exitCode, 1);
  assert.match(stderr, /code_frozen requires passed targeted validation/);

  const evidenceRef = '.vibepro/pr/story-sequence-e2e/verification-evidence.json';
  const resultArtifact = path.join(root, 'test-results.json');
  await writeFile(resultArtifact, JSON.stringify({ numTotalTests: 1, numFailedTests: 0, success: true }));
  assert.equal((await runCli(['verify', 'record', root, '--id', 'story-sequence-e2e', '--kind', 'unit', '--status', 'pass', '--command', 'node --test', '--artifact', 'test-results.json', '--target', 'index.js', '--scenario', 'targeted sequence suite passed', '--observed', 'test_fingerprint=suite-v1', '--observed', 'validation_phase=targeted_validation', '--strict-head-binding', '--json'])).exitCode, 0);
  assert.equal((await runCli(['sequence', 'record', ...common, '--phase', 'targeted_validation', '--evidence', evidenceRef])).exitCode, 0);

  const transcript = path.join(root, '.vibepro', 'reviews', 'story-sequence-e2e', 'architecture_spec', 'transcript.md');
  await mkdir(path.dirname(transcript), { recursive: true });
  await writeFile(transcript, '# workflow review\ncurrent-head workflow boundary inspected\n');
  await runCli(['review', 'prepare', root, '--id', 'story-sequence-e2e', '--stage', 'architecture_spec', '--role', 'architecture_boundary']);
  assert.equal((await runCli(['review', 'start', root, '--id', 'story-sequence-e2e', '--stage', 'architecture_spec', '--role', 'architecture_boundary', '--agent-system', 'codex', '--agent-id', 'workflow-reviewer-1'])).exitCode, 0);
  assert.equal((await runCli(['review', 'close', root, '--id', 'story-sequence-e2e', '--stage', 'architecture_spec', '--role', 'architecture_boundary', '--agent-id', 'workflow-reviewer-1', '--close-reason', 'completed', '--close-evidence', '.vibepro/reviews/story-sequence-e2e/architecture_spec/transcript.md'])).exitCode, 0);
  let reviewError = '';
  const review = await runCli(['review', 'record', root, '--id', 'story-sequence-e2e', '--stage', 'architecture_spec', '--role', 'architecture_boundary', '--status', 'pass', '--summary', 'workflow boundary passes', '--inspection-summary', 'inspected sequence transition boundary; risk_surfaces=core_workflow_state', '--inspection-input', 'index.js', '--judgment-delta', 'unverified boundary became verified', '--agent-system', 'codex', '--execution-mode', 'parallel_subagent', '--agent-id', 'workflow-reviewer-1', '--agent-transcript', '.vibepro/reviews/story-sequence-e2e/architecture_spec/transcript.md', '--agent-closed', '--agent-close-evidence', '.vibepro/reviews/story-sequence-e2e/architecture_spec/transcript.md', '--json'], { stderr: { write: (chunk) => { reviewError += chunk; } } });
  assert.equal(review.exitCode, 0, reviewError);
  const preflightRef = '.vibepro/reviews/story-sequence-e2e/architecture_spec/review-result-architecture_boundary.json';
  stderr = '';
  const invalidDisposition = await runCli(['sequence', 'record', ...common, '--phase', 'preflight_review', '--status', 'dispositioned', '--finding', 'boundary-1', '--disposition', 'boundary-1:open', '--evidence', preflightRef], {
    stderr: { write: (chunk) => { stderr += chunk; } }
  });
  assert.equal(invalidDisposition.exitCode, 1);
  assert.match(stderr, /disposition status must be terminal/);
  assert.equal((await readValidationSequence(root, 'story-sequence-e2e')).phases.preflight_review.status, 'pending');
  assert.equal((await runCli(['sequence', 'record', ...common, '--phase', 'preflight_review', '--status', 'dispositioned', '--finding', 'boundary-1', '--disposition', 'boundary-1:accepted', '--evidence', preflightRef])).exitCode, 0);
  assert.equal((await runCli(['sequence', 'record', ...common, '--phase', 'code_frozen'])).exitCode, 0);
  assert.equal((await runCli(['verify', 'record', root, '--id', 'story-sequence-e2e', '--kind', 'e2e', '--status', 'pass', '--command', 'node --test', '--artifact', 'test-results.json', '--target', 'index.js', '--scenario', 'post-freeze expensive suite passed', '--observed', 'test_fingerprint=suite-v1', '--observed', 'validation_phase=expensive_verification', '--strict-head-binding', '--json'])).exitCode, 0);
  assert.equal((await runCli(['sequence', 'record', ...common, '--phase', 'expensive_verification', '--evidence', evidenceRef])).exitCode, 0);
  const awaitingFinalReview = await runCli(['sequence', 'status', root, '--id', 'story-sequence-e2e', '--json']);
  assert.deepEqual(awaitingFinalReview.result.evaluation.blocking_phases, ['final_review', 'final_review_binding']);
  assert.equal(awaitingFinalReview.result.evaluation.next_required_action.phase, 'final_review');
  assert.match(awaitingFinalReview.result.evaluation.next_required_action.command, /sequence record .*--phase final_review/);
  assert.doesNotMatch(awaitingFinalReview.result.evaluation.next_required_action.command, /sequence invalidate/);
  stderr = '';
  const duplicateExpensive = await runCli(['sequence', 'record', ...common, '--phase', 'expensive_verification', '--evidence', evidenceRef], {
    stderr: { write: (chunk) => { stderr += chunk; } }
  });
  assert.equal(duplicateExpensive.exitCode, 1);
  assert.match(stderr, /reuse existing evidence/);

  const finalReviewPath = path.join(root, '.vibepro', 'reviews', 'story-sequence-e2e', 'implementation', 'review-result-runtime_contract.json');
  await mkdir(path.dirname(finalReviewPath), { recursive: true });
  await writeFile(finalReviewPath, JSON.stringify({
    schema_version: '0.1.0',
    status: 'pass', story_id: 'story-sequence-e2e', role: 'runtime_contract', stage: 'implementation',
    inspection: { summary: 'current-head runtime contract inspected', inputs: ['src/validation-sequencing.js'] },
    git_context: { head_sha: 'abc123' },
    agent_provenance: {
      system: 'codex', execution_mode: 'parallel_subagent', evidence_strength: 'strong',
      lifecycle: { agent_closed: true },
      request_artifact: '.vibepro/reviews/story-sequence-e2e/implementation/review-request-runtime_contract.md',
      transcript_artifact: '.vibepro/reviews/story-sequence-e2e/implementation/transcript-runtime_contract.md'
    }
  }));

  stderr = '';
  const mismatched = await runCli(['sequence', 'record', root, '--id', 'story-sequence-e2e', '--head', 'abc123', '--command', 'npm test', '--test-fingerprint', 'suite-v1', '--phase', 'final_review', '--source', 'agent_review', '--evidence', '.vibepro/reviews/story-sequence-e2e/implementation/review-result-runtime_contract.json', '--json'], {
    stderr: { write: (chunk) => { stderr += chunk; } }
  });
  assert.equal(mismatched.exitCode, 1);
  assert.match(stderr, /canonical Agent Review lifecycle|initialized VibePro workspace/);
  assert.equal((await readValidationSequence(root, 'story-sequence-e2e')).phases.final_review.status, 'pending');

  const scoped = await runCli(['sequence', 'invalidate', root, '--id', 'story-sequence-e2e', '--head', 'abc123', '--surface', 'spec_docs', '--file', 'docs/specs/example.md', '--reason', 'spec changed', '--json']);
  assert.equal(scoped.result.state.phases.targeted_validation.status, 'passed');
  assert.equal(scoped.result.state.phases.preflight_review.status, 'invalidated');
  const unknown = await runCli(['sequence', 'invalidate', root, '--id', 'story-sequence-e2e', '--head', 'abc123', '--reason', 'unknown change', '--json']);
  assert.equal(unknown.result.state.phases.targeted_validation.status, 'invalidated');

  const optimistic = await runCli(['sequence', 'invalidate', root, '--id', 'story-sequence-e2e', '--head', 'abc123', '--surface', 'spec_docs', '--file', 'src/validation-sequencing.js', '--reason', 'mislabeled runtime change', '--json']);
  assert.equal(optimistic.result.state.phases.targeted_validation.status, 'invalidated', 'ac-9 S-001 full sequence replay');
});
