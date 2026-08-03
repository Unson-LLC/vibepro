// Draft E2E test for story-vibepro-strict-head-binding-origin-guard.
// Intended final location: test/e2e/story-vibepro-strict-head-binding-origin-guard-main.test.js
//
// Template: test/e2e/story-vibepro-review-status-required-only-main.test.js
// (chosen over the thin subprocess-wrapper style of
// test/e2e/story-vibepro-content-scoped-evidence-freshness-main.test.js because that
// wrapper only re-runs an existing unit file and asserts on stdout test-title strings;
// review-status-required-only-main.test.js instead builds a real git fixture and drives
// the CLI in-process via `runCli` imported from '../../src/cli.js', which is what this
// story's acceptance criteria need to observe (exit codes, stderr text, JSON gate output,
// and on-disk artifact content). Helper functions below (`git`, `makeGitRepoWithStory`)
// are adapted from test/content-scoped-evidence-freshness.test.js's `git` /
// `makeGitRepoWithStory` (same fixture shape: one `src/*.js` file, one `docs/notes.md`
// file, a `test/*.test.js` file, story id `story-content-binding` renamed here to avoid
// collision). AC test naming + `// story-<id> ac:N` marker convention and the `S-00N`
// scenario-id suffix in test titles follow
// test/e2e/story-vibepro-execution-judgment-status-integrity-main.test.js (e.g.
// `ac:1 ac:2 S-001 ...`). The `SHBO-S-N` scenario ids themselves are the ones already
// established in test/content-scoped-evidence-freshness.test.js's SHBO-prefixed test
// titles for this same story, reused here for continuity between unit and e2e coverage.

import '../support/scratch-tmpdir.js';

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../../src/cli.js';
import {
  buildValidationSequencePlan,
  createValidationSequenceState,
  writeValidationSequence
} from '../../src/validation-sequencing.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function captureRunCli(args) {
  let stdout = '';
  let stderr = '';
  const result = await runCli(args, {
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: (chunk) => { stderr += chunk; } }
  });
  return { ...result, stdout, stderr };
}

async function makeGitRepoWithStory(storyId) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-strict-head-origin-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli([
    'init',
    repo,
    '--story-id',
    storyId,
    '--title',
    'Strict HEAD binding origin guard',
    '--view',
    'dev',
    '--period',
    '2026-W31'
  ]);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'strict-head-target.js'), 'export const value = 1;\n');
  await writeFile(path.join(repo, 'docs', 'notes.md'), '# Notes\n');
  await mkdir(path.join(repo, 'test'), { recursive: true });
  await writeFile(
    path.join(repo, 'test', 'strict-head.test.js'),
    "import test from 'node:test';\ntest('strict head target', () => {});\n"
  );
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init strict head origin fixture']);
  await git(repo, ['switch', '-c', 'feature/strict-head-origin']);
  return repo;
}

function reviewRecordArgs(repo, storyId, { stage, role, status, summary, judgmentDelta, agentId, extra = [] }) {
  return [
    'review', 'record', repo,
    '--id', storyId,
    '--stage', stage,
    '--role', role,
    '--status', status,
    '--summary', summary,
    '--inspection-summary', 'read the strict head target implementation',
    '--inspection-input', 'src/strict-head-target.js',
    '--judgment-delta', judgmentDelta,
    '--agent-system', 'codex',
    '--execution-mode', 'parallel_subagent',
    '--agent-id', agentId,
    '--agent-closed',
    ...extra
  ];
}

function findGate(prPrepareResult, id) {
  return prPrepareResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === id);
}

test('story-vibepro-strict-head-binding-origin-guard ac:1 S-001 unauthorized CLI override on a content_surface role is rejected fail-closed', async () => {
  const storyId = 'story-strict-head-origin-ac1';
  const repo = await makeGitRepoWithStory(storyId);
  await runCli(['review', 'prepare', repo, '--id', storyId, '--stage', 'preview', '--role', 'human_usability']);

  const baseArgs = reviewRecordArgs(repo, storyId, {
    stage: 'preview',
    role: 'human_usability',
    status: 'needs_changes',
    summary: 'attempted unauthorized strict override on an ordinary content-scoped role',
    judgmentDelta: 'unknown -> attempted cli_override strict binding rejected',
    agentId: 'codex-shbo-ac1-review',
    extra: ['--strict-head-binding']
  });

  // story-vibepro-strict-head-binding-origin-guard ac:1 content_surface role
  // rejects unauthorized cli_override strict binding without a reason
  const missingReason = await captureRunCli(baseArgs);
  assert.equal(
    missingReason.exitCode,
    1,
    'ac:1 unauthorized cli_override strict binding must fail fast: missing --strict-head-reason should reject before origin/policy checks run'
  );
  assert.match(
    missingReason.stderr,
    /requires --strict-head-reason/,
    'ac:1 rejection message must explain that --strict-head-binding requires --strict-head-reason'
  );

  // story-vibepro-strict-head-binding-origin-guard ac:1 content_surface role
  // rejects unauthorized cli_override strict binding even with a reason supplied
  const rejected = await captureRunCli([
    ...baseArgs,
    '--strict-head-reason',
    'trying to force strict binding on an ordinary content-scoped review'
  ]);
  assert.equal(
    rejected.exitCode,
    1,
    'ac:1 rejected cli_override: an arbitrary --strict-head-binding on a content_surface role must fail closed even with a reason'
  );
  assert.match(
    rejected.stderr,
    /--strict-head-binding is not authorized for preview:human_usability/,
    'ac:1 rejected cli_override policy violation message must name the unauthorized stage:role'
  );
  assert.match(
    rejected.stderr,
    /Configured freshness for this role is content_surface/,
    'ac:1 rejected cli_override policy violation message must state the role stays content_surface'
  );

  const status = await runCli(['review', 'status', repo, '--id', storyId, '--stage', 'preview', '--json']);
  const role = status.result.stages[0].roles.find((item) => item.role === 'human_usability');
  assert.equal(
    role.status,
    'missing',
    'ac:1 rejected cli_override must not leave a review-status artifact behind'
  );
});

test('story-vibepro-strict-head-binding-origin-guard ac:2 S-002 frozen validation-sequence final_review records strict_head from source validation_sequence', async () => {
  const storyId = 'story-strict-head-origin-ac2';
  const repo = await makeGitRepoWithStory(storyId);
  const { stdout: headOut } = await git(repo, ['rev-parse', 'HEAD']);
  const headSha = headOut.trim();
  const plan = buildValidationSequencePlan({ storyId, riskProfile: 'workflow_heavy', riskSurfaces: [] });
  const state = {
    ...createValidationSequenceState({ plan, headSha, testFingerprint: 'tests-v1', verificationCommand: 'node --test' }),
    frozen_binding: { head_sha: headSha, test_fingerprint: 'tests-v1', verification_command: 'node --test' }
  };
  await writeValidationSequence(repo, state);

  await runCli(['review', 'prepare', repo, '--id', storyId, '--stage', 'implementation', '--role', 'runtime_contract']);

  // story-vibepro-strict-head-binding-origin-guard ac:2 the frozen
  // validation-sequence implementation:runtime_contract final_review target
  // is authorized to record strict HEAD binding from source validation_sequence
  const recorded = await runCli(reviewRecordArgs(repo, storyId, {
    stage: 'implementation',
    role: 'runtime_contract',
    status: 'pass',
    summary: 'final frozen-HEAD runtime contract review passed',
    judgmentDelta: 'content-scoped default -> strict because this is the frozen validation-sequence final_review target',
    agentId: 'codex-shbo-ac2-review',
    extra: ['--strict-head-binding', '--strict-head-reason', 'bind final review to the frozen release candidate']
  }));
  assert.equal(
    recorded.exitCode,
    0,
    'ac:2 frozen validation sequence final_review strict HEAD binding must be authorized and recorded'
  );
  assert.equal(
    recorded.result.review.freshness_policy.effective_mode,
    'strict_head',
    'ac:2 frozen validation sequence final_review must record effective_mode strict_head'
  );
  assert.equal(
    recorded.result.review.freshness_policy.source,
    'validation_sequence',
    'ac:2 frozen validation sequence final_review strict HEAD binding origin must be source validation_sequence'
  );
});

test('story-vibepro-strict-head-binding-origin-guard ac:3 S-003 role policy strict_head with freshness_reason records source role_policy', async () => {
  const storyId = 'story-strict-head-origin-ac3';
  const repo = await makeGitRepoWithStory(storyId);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.agent_reviews = {
    roles: {
      runtime_contract: { freshness_mode: 'strict_head' }
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await runCli(['review', 'prepare', repo, '--id', storyId, '--stage', 'implementation', '--role', 'runtime_contract']);

  const args = reviewRecordArgs(repo, storyId, {
    stage: 'implementation',
    role: 'runtime_contract',
    status: 'pass',
    summary: 'runtime contract reviewed as a full-head role policy exception',
    judgmentDelta: 'content-scoped default -> strict because the role policy declares strict_head',
    agentId: 'codex-shbo-ac3-review'
  });

  // story-vibepro-strict-head-binding-origin-guard ac:3 role policy
  // freshness_mode strict_head without freshness_reason is rejected
  const missingReason = await captureRunCli(args);
  assert.equal(
    missingReason.exitCode,
    1,
    'ac:3 role policy strict_head must require an explicit freshness_reason before it can be recorded'
  );
  assert.match(
    missingReason.stderr,
    /configures strict_head freshness without freshness_reason/,
    'ac:3 rejection message must name the missing role_policy freshness_reason'
  );

  config.agent_reviews.roles.runtime_contract.freshness_reason = 'runtime compatibility spans the complete release head';
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  // story-vibepro-strict-head-binding-origin-guard ac:3 role policy
  // strict_head with an explicit freshness_reason is authorized without any
  // --strict-head-binding CLI flag and records source role_policy
  const recorded = await runCli(args);
  assert.equal(
    recorded.exitCode,
    0,
    'ac:3 role policy strict_head with freshness_reason must be recorded successfully'
  );
  assert.equal(
    recorded.result.review.freshness_policy.source,
    'role_policy',
    'ac:3 role policy strict_head with freshness_reason must record origin source role_policy'
  );
  assert.equal(
    recorded.result.review.freshness_policy.reason,
    'runtime compatibility spans the complete release head',
    'ac:3 role policy strict_head must persist its configured freshness_reason'
  );
});

test('story-vibepro-strict-head-binding-origin-guard ac:4 S-004 review prepare and parallel-dispatch.md never propagate --strict-head-binding', async () => {
  const storyId = 'story-strict-head-origin-ac4';
  const repo = await makeGitRepoWithStory(storyId);
  const { stdout: headOut } = await git(repo, ['rev-parse', 'HEAD']);
  const headSha = headOut.trim();
  const plan = buildValidationSequencePlan({ storyId, riskProfile: 'workflow_heavy', riskSurfaces: [] });
  const state = {
    ...createValidationSequenceState({ plan, headSha, testFingerprint: 'tests-v1', verificationCommand: 'node --test' }),
    frozen_binding: { head_sha: headSha, test_fingerprint: 'tests-v1', verification_command: 'node --test' }
  };
  // Even though this makes implementation:runtime_contract currently
  // authorized for strict binding (see ac:2), review prepare / parallel
  // dispatch must still never suggest --strict-head-binding: dispatch always
  // records the ordinary review-record command and lets the per-role policy
  // check re-authorize strict binding at record time, not at dispatch time.
  await writeValidationSequence(repo, state);

  const prepared = await runCli(['review', 'prepare', repo, '--id', storyId, '--stage', 'implementation', '--role', 'runtime_contract', '--json']);
  assert.equal(prepared.exitCode, 0);

  // story-vibepro-strict-head-binding-origin-guard ac:4 parallel-dispatch
  // does not propagate --strict-head-binding to a dispatched role, even one
  // that would currently be authorized to record strict HEAD at record time
  assert.doesNotMatch(
    prepared.result.plan.parallel_dispatch.record_commands.runtime_contract,
    /--strict-head-binding/,
    'ac:4 review prepare parallel_dispatch.record_commands must not propagate --strict-head-binding to any dispatched role'
  );

  // The rendered coordinator-instructions prose is allowed to *explain* the
  // strict-head-binding authorization rule (naming the flag so an operator
  // understands when it is/is not accepted); what C-002 forbids is the flag
  // being embedded into an actual dispatched record command. So this checks
  // only the backtick-quoted `vibepro review record ...` command strings
  // inside parallel-dispatch.md, not the file's prose in aggregate.
  const dispatchMarkdownPath = path.join(repo, prepared.result.artifacts.parallel_dispatch);
  const dispatchMarkdown = await readFile(dispatchMarkdownPath, 'utf8');
  const dispatchRecordCommands = dispatchMarkdown.match(/`vibepro review record[^`]*`/g) ?? [];
  assert.ok(
    dispatchRecordCommands.length > 0,
    'ac:4 parallel-dispatch.md must contain at least one rendered review record command to check'
  );
  for (const recordCommand of dispatchRecordCommands) {
    assert.doesNotMatch(
      recordCommand,
      /--strict-head-binding/,
      'ac:4 parallel-dispatch.md on disk must not propagate --strict-head-binding into any subagent record command'
    );
  }

  const requestMarkdownPath = path.join(repo, prepared.result.artifacts.requests.runtime_contract);
  const requestMarkdown = await readFile(requestMarkdownPath, 'utf8');
  const requestRecordCommands = requestMarkdown.match(/`vibepro review record[^`]*`/g) ?? [];
  assert.ok(
    requestRecordCommands.length > 0,
    'ac:4 per-role review-request markdown must contain at least one rendered review record command to check'
  );
  for (const recordCommand of requestRecordCommands) {
    assert.doesNotMatch(
      recordCommand,
      /--strict-head-binding/,
      'ac:4 per-role review-request markdown must not propagate --strict-head-binding into the remediation/record command'
    );
  }
});

test('story-vibepro-strict-head-binding-origin-guard ac:5 S-005 pr prepare explains strict binding origin as validation_sequence, role_policy, or rejected cli_override', async () => {
  const storyId = 'story-strict-head-origin-ac5';
  const repo = await makeGitRepoWithStory(storyId);
  const { stdout: headOut } = await git(repo, ['rev-parse', 'HEAD']);
  const headSha = headOut.trim();
  const plan = buildValidationSequencePlan({ storyId, riskProfile: 'workflow_heavy', riskSurfaces: [] });
  const state = {
    ...createValidationSequenceState({ plan, headSha, testFingerprint: 'tests-v1', verificationCommand: 'node --test' }),
    frozen_binding: { head_sha: headSha, test_fingerprint: 'tests-v1', verification_command: 'node --test' }
  };
  await writeValidationSequence(repo, state);
  await runCli(['review', 'prepare', repo, '--id', storyId, '--stage', 'implementation', '--role', 'runtime_contract']);
  const recorded = await runCli(reviewRecordArgs(repo, storyId, {
    stage: 'implementation',
    role: 'runtime_contract',
    status: 'pass',
    summary: 'final frozen-HEAD runtime contract review passed',
    judgmentDelta: 'content-scoped default -> strict because this is the frozen validation-sequence final_review target',
    agentId: 'codex-shbo-ac5-review',
    extra: ['--strict-head-binding', '--strict-head-reason', 'bind final review to the frozen release candidate']
  }));
  assert.equal(recorded.exitCode, 0);

  const prepared = await runCli(['pr', 'prepare', repo, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(prepared.exitCode, 0);
  const gate = findGate(prepared, 'gate:pr_freshness');
  const binding = gate.content_binding_details.bindings.find(
    (item) => item.artifact_type === 'agent_review_result' && item.role === 'runtime_contract'
  );

  // story-vibepro-strict-head-binding-origin-guard ac:5 pr prepare explains
  // the origin of a validation_sequence-authorized strict HEAD binding
  assert.ok(
    binding,
    'ac:5 pr prepare validation_sequence origin explanation requires a bound gate:pr_freshness entry for the strict review'
  );
  assert.equal(
    binding.strict_head_origin,
    'validation_sequence',
    'ac:5 pr prepare must explain strict binding origin as validation_sequence for the frozen final_review target'
  );
});

test('story-vibepro-strict-head-binding-origin-guard ac:6 S-006 pr prepare emits a migration warning for a legacy cli_override strict artifact', async () => {
  const storyId = 'story-strict-head-origin-ac6';
  const repo = await makeGitRepoWithStory(storyId);
  await runCli(['review', 'prepare', repo, '--id', storyId, '--stage', 'preview', '--role', 'human_usability']);
  const recorded = await runCli(reviewRecordArgs(repo, storyId, {
    stage: 'preview',
    role: 'human_usability',
    status: 'pass',
    summary: 'human usability reviewed against an explicit content surface',
    judgmentDelta: 'unknown -> content-scoped review of the implementation surface is sufficient',
    agentId: 'codex-shbo-ac6-review'
  }));
  assert.equal(recorded.exitCode, 0);
  assert.equal(recorded.result.review.freshness_policy.effective_mode, 'content_surface');

  // The current CLI (this story's own fail-closed guard) can no longer
  // *produce* an unauthorized cli_override strict artifact -- that is the
  // point of ac:1. A "legacy" artifact predating the guard, or one that
  // bypassed it before this story shipped, is simulated here by editing the
  // recorded review-result JSON directly on disk (path taken from the
  // record response's own `artifact` field), exactly as an artifact written
  // before this story would look on disk today.
  const reviewResultPath = path.join(repo, recorded.result.artifact);
  const reviewResult = JSON.parse(await readFile(reviewResultPath, 'utf8'));
  reviewResult.content_binding.mode = 'strict_head';
  reviewResult.freshness_policy = {
    schema_version: '0.1.0',
    configured_mode: 'content_surface',
    effective_mode: 'strict_head',
    source: 'cli_override',
    reason: 'legacy pre-guard override'
  };
  await writeFile(reviewResultPath, `${JSON.stringify(reviewResult, null, 2)}\n`);

  const prepared = await runCli(['pr', 'prepare', repo, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(prepared.exitCode, 0);
  const gate = findGate(prepared, 'gate:pr_freshness');
  const binding = gate.content_binding_details.bindings.find(
    (item) => item.artifact_type === 'agent_review_result' && item.role === 'human_usability'
  );

  // story-vibepro-strict-head-binding-origin-guard ac:6 pr prepare surfaces
  // a migration warning for a legacy cli_override strict artifact on a
  // content_surface-configured role
  assert.equal(
    binding.strict_head_origin,
    'cli_override',
    'ac:6 legacy artifact strict_head_origin must be classified cli_override'
  );
  assert.ok(
    gate.warnings.some((warning) => (
      warning.startsWith('VibePro strict HEAD binding origin:')
      && warning.includes('preview:human_usability')
      && warning.includes('cli_override')
    )),
    'ac:6 gate:pr_freshness must emit a migration warning naming the legacy cli_override strict artifact'
  );
});

test('story-vibepro-strict-head-binding-origin-guard ac:7 S-007 unrelated HEAD change keeps human_usability current, surface change stales it, and frozen runtime_contract final_review stales on any HEAD change', async () => {
  const storyId = 'story-strict-head-origin-ac7';
  const repo = await makeGitRepoWithStory(storyId);

  // content_surface role: unrelated HEAD movement must not stale it.
  await runCli(['review', 'prepare', repo, '--id', storyId, '--stage', 'preview', '--role', 'human_usability']);
  const humanUsabilityRecorded = await runCli(reviewRecordArgs(repo, storyId, {
    stage: 'preview',
    role: 'human_usability',
    status: 'pass',
    summary: 'human usability reviewed against an explicit content surface',
    judgmentDelta: 'unknown -> content-scoped review of the implementation surface is sufficient',
    agentId: 'codex-shbo-ac7-human-usability'
  }));
  assert.equal(humanUsabilityRecorded.exitCode, 0);

  // frozen final_review role: strict HEAD binding authorized via validation_sequence.
  const { stdout: headOut } = await git(repo, ['rev-parse', 'HEAD']);
  const headSha = headOut.trim();
  const plan = buildValidationSequencePlan({ storyId, riskProfile: 'workflow_heavy', riskSurfaces: [] });
  const state = {
    ...createValidationSequenceState({ plan, headSha, testFingerprint: 'tests-v1', verificationCommand: 'node --test' }),
    frozen_binding: { head_sha: headSha, test_fingerprint: 'tests-v1', verification_command: 'node --test' }
  };
  await writeValidationSequence(repo, state);
  await runCli(['review', 'prepare', repo, '--id', storyId, '--stage', 'implementation', '--role', 'runtime_contract']);
  const runtimeContractRecorded = await runCli(reviewRecordArgs(repo, storyId, {
    stage: 'implementation',
    role: 'runtime_contract',
    status: 'pass',
    summary: 'final frozen-HEAD runtime contract review passed',
    judgmentDelta: 'content-scoped default -> strict because this is the frozen validation-sequence final_review target',
    agentId: 'codex-shbo-ac7-runtime-contract',
    extra: ['--strict-head-binding', '--strict-head-reason', 'bind final review to the frozen release candidate']
  }));
  assert.equal(runtimeContractRecorded.exitCode, 0);

  await writeFile(path.join(repo, 'docs', 'notes.md'), '# Notes\n\nUnrelated advance.\n');
  await git(repo, ['add', 'docs/notes.md']);
  await git(repo, ['commit', '-m', 'docs: advance outside the reviewed surface']);

  const currentPreviewStatus = await runCli(['review', 'status', repo, '--id', storyId, '--stage', 'preview', '--json']);
  const currentHumanUsability = currentPreviewStatus.result.stages[0].roles.find((item) => item.role === 'human_usability');
  const currentImplementationStatus = await runCli(['review', 'status', repo, '--id', storyId, '--stage', 'implementation', '--json']);
  const currentRuntimeContract = currentImplementationStatus.result.stages[0].roles.find((item) => item.role === 'runtime_contract');

  // story-vibepro-strict-head-binding-origin-guard ac:7 unrelated HEAD
  // change keeps the content_surface human_usability review current, while
  // the frozen final_review runtime_contract review is already stale after
  // any HEAD change (strict HEAD binding tolerates zero drift)
  assert.equal(
    currentHumanUsability.binding_status,
    'current',
    'ac:7 unrelated HEAD change must keep content_surface human_usability current'
  );
  assert.equal(
    currentRuntimeContract.binding_status,
    'stale',
    'ac:7 frozen final_review runtime_contract must go stale after any HEAD change, unrelated or not'
  );

  await writeFile(path.join(repo, 'src', 'strict-head-target.js'), 'export const value = 42;\n');
  const staleSurfaceStatus = await runCli(['review', 'status', repo, '--id', storyId, '--stage', 'preview', '--json']);
  const staleHumanUsability = staleSurfaceStatus.result.stages[0].roles.find((item) => item.role === 'human_usability');

  // story-vibepro-strict-head-binding-origin-guard ac:7 human_usability
  // goes stale once its actually-reviewed surface changes
  assert.equal(
    staleHumanUsability.binding_status,
    'stale',
    'ac:7 human_usability review must go stale once its inspected surface content changes'
  );
});
