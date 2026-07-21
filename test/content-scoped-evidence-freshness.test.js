import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { buildContentBinding } from '../src/content-binding.js';

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

async function makeGitRepoWithStory() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-content-binding-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli([
    'init',
    repo,
    '--story-id',
    'story-content-binding',
    '--title',
    'Content scoped evidence freshness',
    '--view',
    'dev',
    '--period',
    '2026-W27'
  ]);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'content-binding-target.js'), 'export const value = 1;\n');
  await writeFile(path.join(repo, 'docs', 'notes.md'), '# Notes\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init content binding fixture']);
  await git(repo, ['switch', '-c', 'feature/content-binding']);
  return repo;
}

function findGate(result, id) {
  return result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === id);
}

test('content binding fails closed on unreadable inspection inputs without exposing the repository root', async () => {
  const repo = await makeGitRepoWithStory();
  const target = path.join(repo, 'src', 'content-binding-target.js');
  await chmod(target, 0o000);
  try {
    await assert.rejects(
      buildContentBinding(repo, {
        inspectionInputs: ['src/content-binding-target.js'],
        gitContext: { head_sha: 'test-head' }
      }),
      (error) => {
        assert.equal(error.code, 'CONTENT_BINDING_READ_FAILED');
        assert.equal(error.cause_code, 'EACCES');
        assert.equal(error.message, 'cannot read content binding surface: src/content-binding-target.js');
        assert.equal(error.message.includes(repo), false);
        return true;
      }
    );
  } finally {
    await chmod(target, 0o600);
  }
});

test('CEF-S-1/2/5 verification evidence stays current for docs-only commits and stales on bound surface changes', async () => {
  const repo = await makeGitRepoWithStory();
  await writeFile(path.join(repo, 'docs', 'verification-result.json'), '{"status":"pass"}\n');
  await git(repo, ['add', 'docs/verification-result.json']);
  await git(repo, ['commit', '-m', 'test: add verification result artifact']);
  const recordResult = await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-content-binding',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--command',
    'node --test test/content-binding.test.js',
    '--summary',
    'content binding unit coverage passed',
    '--artifact',
    'docs/verification-result.json',
    '--target',
    'src/content-binding-target.js',
    '--scenario',
    'content binding remains scoped',
    '--observed',
    'tests=1'
  ]);
  assert.equal(recordResult.exitCode, 0);
  assert.equal(recordResult.result.evidence.commands[0].content_binding.mode, 'content_surface');

  await writeFile(path.join(repo, 'docs', 'notes.md'), '# Notes\n\nDocs-only continuation.\n');
  await git(repo, ['add', 'docs/notes.md']);
  await git(repo, ['commit', '-m', 'docs: continue after evidence']);

  const docsOnly = await runCli(['pr', 'prepare', repo, '--story-id', 'story-content-binding', '--base', 'main', '--json']);
  assert.equal(docsOnly.exitCode, 0);
  const docsGate = findGate(docsOnly, 'gate:artifact_consistency');
  const docsVerification = docsGate.artifacts.find((artifact) => artifact.artifact_type === 'verification_command');
  assert.equal(docsVerification.status, 'current');
  assert.deepEqual(docsVerification.content_binding.surface_files, [
    'docs/verification-result.json',
    'src/content-binding-target.js'
  ]);
  const freshnessGate = findGate(docsOnly, 'gate:pr_freshness');
  const freshnessBinding = freshnessGate.content_binding_details.bindings.find((binding) => binding.artifact_type === 'verification_command');
  assert.equal(freshnessBinding.status, 'current');
  assert.deepEqual(freshnessBinding.surface_files, [
    'docs/verification-result.json',
    'src/content-binding-target.js'
  ]);
  assert.deepEqual(freshnessBinding.changed_files, []);

  await writeFile(path.join(repo, 'src', 'content-binding-target.js'), 'export const value = 2;\n');
  await git(repo, ['add', 'src/content-binding-target.js']);
  await git(repo, ['commit', '-m', 'feat: change bound evidence surface']);

  const sourceChanged = await runCli(['pr', 'prepare', repo, '--story-id', 'story-content-binding', '--base', 'main', '--json']);
  assert.equal(sourceChanged.exitCode, 0);
  const staleGate = findGate(sourceChanged, 'gate:artifact_consistency');
  const staleVerification = staleGate.inconsistent_artifacts.find((artifact) => artifact.artifact_type === 'verification_command');
  assert.equal(staleVerification.status, 'stale');
  assert.match(staleVerification.reason, /content-bound evidence surface changed/);
  assert.deepEqual(staleVerification.content_binding.changed_files, ['src/content-binding-target.js']);
  const staleDetail = staleGate.stale_artifact_details.find((detail) => detail.artifact_type === 'verification_command');
  assert.deepEqual(staleDetail.content_binding.changed_files, ['src/content-binding-target.js']);
  const sourceFreshnessGate = findGate(sourceChanged, 'gate:pr_freshness');
  const sourceFreshnessBinding = sourceFreshnessGate.content_binding_details.bindings.find((binding) => (
    binding.artifact_type === 'verification_command'
  ));
  assert.equal(sourceFreshnessBinding.status, 'stale');
  assert.match(sourceFreshnessBinding.reason, /content-bound evidence surface changed/);
  assert.deepEqual(sourceFreshnessBinding.changed_files, ['src/content-binding-target.js']);
  assert.deepEqual(sourceFreshnessBinding.missing_files, []);
  assert.notEqual(sourceFreshnessBinding.current_surface_hash, sourceFreshnessBinding.recorded_surface_hash);
  assert.notEqual(sourceFreshnessBinding.current_head_sha, sourceFreshnessBinding.recorded_head_sha);

  const recoveryCommand = staleDetail.remediation_commands.find((command) => command.startsWith('vibepro verify record'));
  assert.ok(recoveryCommand);
  assert.match(recoveryCommand, /--summary 'content binding unit coverage passed'/);
  assert.match(recoveryCommand, /--artifact docs\/verification-result\.json/);
  assert.match(recoveryCommand, /--target src\/content-binding-target\.js/);
  assert.match(recoveryCommand, /--scenario 'content binding remains scoped'/);
  assert.match(recoveryCommand, /--observed tests=1/);
  const executableRecovery = recoveryCommand.replace(
    /^vibepro\b/,
    `${JSON.stringify(process.execPath)} ${JSON.stringify(path.resolve('bin/vibepro.js'))}`
  );
  await execFileAsync('/bin/sh', ['-c', executableRecovery], { cwd: repo, encoding: 'utf8' });

  const recoveredEvidence = JSON.parse(await readFile(path.join(
    repo,
    '.vibepro',
    'pr',
    'story-content-binding',
    'verification-evidence.json'
  ), 'utf8'));
  const recoveredCommand = recoveredEvidence.commands.find((command) => command.kind === 'unit');
  assert.equal(recoveredCommand.artifact, 'docs/verification-result.json');
  assert.deepEqual(recoveredCommand.observation.targets, ['src/content-binding-target.js']);
  assert.deepEqual(recoveredCommand.observation.scenarios, ['content binding remains scoped']);
  assert.equal(recoveredCommand.observation.values.tests, '1');
  assert.equal(recoveredCommand.content_binding.mode, 'content_surface');
});

test('CEF-S-2/5 deleted bound files stale evidence with an operator-visible missing-file reason', async () => {
  const repo = await makeGitRepoWithStory();
  const recordResult = await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-content-binding',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--command',
    'node --test test/content-binding.test.js',
    '--summary',
    'content binding unit coverage passed',
    '--target',
    'src/content-binding-target.js'
  ]);
  assert.equal(recordResult.exitCode, 0);

  await rm(path.join(repo, 'src', 'content-binding-target.js'));
  await git(repo, ['add', '-u', 'src/content-binding-target.js']);
  await git(repo, ['commit', '-m', 'refactor: remove bound evidence surface']);

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-content-binding', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  const artifactGate = findGate(result, 'gate:artifact_consistency');
  const staleVerification = artifactGate.inconsistent_artifacts.find((artifact) => artifact.artifact_type === 'verification_command');
  assert.equal(staleVerification.status, 'stale');
  assert.match(staleVerification.reason, /file\(s\) are missing: src\/content-binding-target\.js/);
  assert.deepEqual(staleVerification.content_binding.missing_files, ['src/content-binding-target.js']);
  assert.deepEqual(staleVerification.content_binding.changed_files, ['src/content-binding-target.js']);

  const freshnessGate = findGate(result, 'gate:pr_freshness');
  const freshnessBinding = freshnessGate.content_binding_details.bindings.find((binding) => binding.artifact_type === 'verification_command');
  assert.equal(freshnessBinding.status, 'stale');
  assert.deepEqual(freshnessBinding.missing_files, ['src/content-binding-target.js']);
  assert.match(freshnessBinding.reason, /file\(s\) are missing/);
});

test('agent review minimal recovery emits an executable inspection-aware pass command', async () => {
  const repo = await makeGitRepoWithStory();
  await writeFile(path.join(repo, 'src', 'content-binding-target.js'), 'export const value = 2;\n');
  await git(repo, ['add', 'src/content-binding-target.js']);
  await git(repo, ['commit', '-m', 'feat: change runtime contract']);

  const prepared = await runCli(['pr', 'prepare', repo, '--story-id', 'story-content-binding', '--base', 'main', '--json']);
  assert.equal(prepared.exitCode, 0);
  const reviewGate = findGate(prepared, 'gate:agent_review');
  const recovery = reviewGate.minimal_recovery_plan.current_stage_work[0];
  const recordCommand = recovery.next_commands.find((command) => command.startsWith('vibepro review record'));
  assert.ok(recordCommand);
  assert.match(recordCommand, /--inspection-summary "<inspection-summary>"/);
  assert.match(recordCommand, /--inspection-evidence '<inspection-evidence>'/);
  assert.match(recordCommand, /--inspection-input '<inspection-input>'/);
  assert.match(recordCommand, /--judgment-delta "<initial judgment -> final judgment because evidence>"/);
  assert.match(recordCommand, /--status '<pass\|needs_changes\|block>'/);

  const executable = recordCommand
    .replace(/^vibepro\b/, `${JSON.stringify(process.execPath)} ${JSON.stringify(path.resolve('bin/vibepro.js'))}`)
    .replace('<summary>', 'recovery review passed')
    .replace('<inspection-summary>', 'inspected the runtime contract source')
    .replace('<inspection-evidence>', 'src/content-binding-target.js')
    .replace('<inspection-input>', 'src/content-binding-target.js')
    .replace('<initial judgment -> final judgment because evidence>', 'initial risk -> accepted after inspecting the runtime contract source')
    .replace('<pass|needs_changes|block>', 'pass')
    .replace('<replacement-agent-id>', 'agent-minimal-recovery')
    .replace('<replacement-agent-thread-id>', 'thread-minimal-recovery')
    .replace('<replacement-agent-session-id>', 'session-minimal-recovery')
    .replace('<implementation-session-id>', 'session-implementation')
    .replace('<replacement-agent-transcript>', 'src/content-binding-target.js')
    .replace('<replacement-agent-close-evidence>', 'src/content-binding-target.js');
  await runCli(['review', 'start', repo, '--id', 'story-content-binding', '--stage', recovery.stage, '--role', recovery.role, '--agent-system', 'codex', '--agent-id', 'agent-minimal-recovery', '--agent-thread-id', 'thread-minimal-recovery', '--agent-session-id', 'session-minimal-recovery']);
  await runCli(['review', 'close', repo, '--id', 'story-content-binding', '--stage', recovery.stage, '--role', recovery.role, '--agent-id', 'agent-minimal-recovery', '--close-reason', 'completed', '--close-evidence', 'src/content-binding-target.js']);
  await execFileAsync('/bin/sh', ['-c', executable], { cwd: repo, encoding: 'utf8' });

  const status = await runCli(['review', 'status', repo, '--id', 'story-content-binding', '--stage', recovery.stage, '--json']);
  const recoveredRole = status.result.stages[0].roles.find((role) => role.role === recovery.role);
  assert.equal(recoveredRole.effective_status, 'pass');
});

test('CEF-S-3 review evidence uses inspected input content binding across docs-only commits', async () => {
  const repo = await makeGitRepoWithStory();
  await runCli(['review', 'prepare', repo, '--id', 'story-content-binding', '--stage', 'implementation']);
  const recordResult = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-content-binding',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--status',
    'pass',
    '--summary',
    'runtime contract reviewed',
    '--inspection-summary',
    'read the runtime surface',
    '--inspection-input',
    'src/content-binding-target.js',
    '--judgment-delta',
    'generic pass -> accepted after inspected input review',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-content-binding-review',
    '--agent-closed'
  ]);
  assert.equal(recordResult.exitCode, 0);
  assert.equal(recordResult.result.review.content_binding.mode, 'content_surface');
  assert.equal(recordResult.result.review.freshness_policy.effective_mode, 'content_surface');
  assert.equal(recordResult.result.review.freshness_policy.source, 'content_surface_default');

  await writeFile(path.join(repo, 'docs', 'notes.md'), '# Notes\n\nReview still current.\n');
  await git(repo, ['add', 'docs/notes.md']);
  await git(repo, ['commit', '-m', 'docs: update review-adjacent notes']);

  const status = await runCli(['review', 'status', repo, '--id', 'story-content-binding', '--stage', 'implementation', '--json']);
  const role = status.result.stages[0].roles.find((item) => item.role === 'runtime_contract');
  assert.equal(role.binding_status, 'current');
  assert.deepEqual(role.content_binding.surface_files, ['src/content-binding-target.js']);

  const docsPrepared = await runCli(['pr', 'prepare', repo, '--story-id', 'story-content-binding', '--base', 'main', '--json']);
  const docsFreshnessGate = findGate(docsPrepared, 'gate:pr_freshness');
  const docsReviewBinding = docsFreshnessGate.content_binding_details.bindings.find((binding) => (
    binding.artifact_type === 'agent_review_result'
      && binding.stage === 'implementation'
      && binding.role === 'runtime_contract'
  ));
  assert.equal(docsReviewBinding.status, 'current');
  assert.equal(docsReviewBinding.binding_mode, 'content_surface');
  assert.deepEqual(docsReviewBinding.surface_files, ['src/content-binding-target.js']);
  assert.deepEqual(docsReviewBinding.changed_files, []);
  assert.deepEqual(docsReviewBinding.missing_files, []);
  assert.match(docsReviewBinding.recorded_surface_hash, /^[a-f0-9]{64}$/);
  assert.equal(docsReviewBinding.current_surface_hash, docsReviewBinding.recorded_surface_hash);
  assert.match(docsReviewBinding.recorded_head_sha, /^[a-f0-9]{40}$/);
  assert.match(docsReviewBinding.current_head_sha, /^[a-f0-9]{40}$/);
  assert.notEqual(docsReviewBinding.current_head_sha, docsReviewBinding.recorded_head_sha);

  await writeFile(path.join(repo, 'src', 'content-binding-target.js'), 'export const value = 3;\n');
  const staleStatus = await runCli(['review', 'status', repo, '--id', 'story-content-binding', '--stage', 'implementation', '--json']);
  const staleRole = staleStatus.result.stages[0].roles.find((item) => item.role === 'runtime_contract');
  assert.equal(staleRole.binding_status, 'stale');
  assert.match(staleRole.stale_reason, /content-bound evidence surface changed/);
  assert.deepEqual(staleRole.content_binding.changed_files, ['src/content-binding-target.js']);

  const sourcePrepared = await runCli(['pr', 'prepare', repo, '--story-id', 'story-content-binding', '--base', 'main', '--json']);
  const sourceFreshnessGate = findGate(sourcePrepared, 'gate:pr_freshness');
  const sourceReviewBinding = sourceFreshnessGate.content_binding_details.bindings.find((binding) => (
    binding.artifact_type === 'agent_review_result'
      && binding.stage === 'implementation'
      && binding.role === 'runtime_contract'
  ));
  assert.equal(sourceReviewBinding.status, 'stale');
  assert.match(sourceReviewBinding.reason, /content-bound evidence surface changed/);
  assert.deepEqual(sourceReviewBinding.surface_files, ['src/content-binding-target.js']);
  assert.deepEqual(sourceReviewBinding.changed_files, ['src/content-binding-target.js']);
  assert.deepEqual(sourceReviewBinding.missing_files, []);
  assert.notEqual(sourceReviewBinding.current_surface_hash, sourceReviewBinding.recorded_surface_hash);
  assert.notEqual(sourceReviewBinding.current_head_sha, sourceReviewBinding.recorded_head_sha);
});

test('review freshness policy keeps every built-in high-risk gate role strict, preserves inspected files, and invalidates on HEAD movement', async () => {
  for (const role of ['gate_evidence', 'release_risk']) {
    const repo = await makeGitRepoWithStory();
    await runCli(['review', 'prepare', repo, '--id', 'story-content-binding', '--stage', 'gate', '--role', role]);
    const recordResult = await runCli([
      'review',
      'record',
      repo,
      '--id',
      'story-content-binding',
      '--stage',
      'gate',
      '--role',
      role,
      '--status',
      'pass',
      '--summary',
      `${role} reviewed`,
      '--inspection-summary',
      'read the implementation surface and gate inputs',
      '--inspection-input',
      'src/content-binding-target.js',
      '--judgment-delta',
      'generic pass -> accepted after inspecting the implementation surface',
      '--agent-system',
      'codex',
      '--execution-mode',
      'parallel_subagent',
      '--agent-id',
      `codex-${role}-freshness-review`,
      '--agent-closed'
    ]);
    assert.equal(recordResult.exitCode, 0);
    assert.equal(recordResult.result.review.freshness_policy.effective_mode, 'strict_head');
    assert.equal(recordResult.result.review.freshness_policy.source, 'built_in_exception');
    assert.equal(recordResult.result.review.content_binding.mode, 'strict_head');
    assert.deepEqual(
      recordResult.result.review.content_binding.surface_files.map((file) => file.path),
      ['src/content-binding-target.js']
    );
    assert.match(recordResult.result.review.content_binding.surface_hash, /^[a-f0-9]{64}$/);

    await writeFile(path.join(repo, 'docs', 'notes.md'), `# Notes\n\n${role} must stale.\n`);
    await git(repo, ['add', 'docs/notes.md']);
    await git(repo, ['commit', '-m', `docs: advance head after ${role}`]);
    const status = await runCli(['review', 'status', repo, '--id', 'story-content-binding', '--stage', 'gate', '--json']);
    const staleRole = status.result.stages[0].roles.find((item) => item.role === role);
    assert.equal(staleRole.binding_status, 'stale');
    assert.match(staleRole.stale_reason, /recorded for .*current head/);
  }
});

test('role policy can explicitly narrow a built-in strict exception to content surface', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.agent_reviews = {
    roles: {
      gate_evidence: {
        freshness_mode: 'content_surface'
      }
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await runCli(['review', 'prepare', repo, '--id', 'story-content-binding', '--stage', 'gate', '--role', 'gate_evidence']);
  const recordResult = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-content-binding',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    'pass',
    '--summary',
    'gate evidence reviewed against an explicit surface',
    '--inspection-summary',
    'read the implementation surface',
    '--inspection-input',
    'src/content-binding-target.js',
    '--judgment-delta',
    'built-in strict default -> content scoped because the role policy names a complete file surface',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-gate-content-policy-review',
    '--agent-closed'
  ]);
  assert.equal(recordResult.exitCode, 0);
  assert.equal(recordResult.result.review.freshness_policy.effective_mode, 'content_surface');
  assert.equal(recordResult.result.review.freshness_policy.source, 'role_policy');
  assert.equal(recordResult.result.review.content_binding.mode, 'content_surface');

  await writeFile(path.join(repo, 'docs', 'notes.md'), '# Notes\n\nContent-scoped review remains current.\n');
  await git(repo, ['add', 'docs/notes.md']);
  await git(repo, ['commit', '-m', 'docs: advance outside the explicit review surface']);
  const docsStatus = await runCli(['review', 'status', repo, '--id', 'story-content-binding', '--stage', 'gate', '--json']);
  const currentRole = docsStatus.result.stages[0].roles.find((item) => item.role === 'gate_evidence');
  assert.equal(currentRole.binding_status, 'current');

  await writeFile(path.join(repo, 'src', 'content-binding-target.js'), 'export const value = 3;\n');
  const sourceStatus = await runCli(['review', 'status', repo, '--id', 'story-content-binding', '--stage', 'gate', '--json']);
  const staleRole = sourceStatus.result.stages[0].roles.find((item) => item.role === 'gate_evidence');
  assert.equal(staleRole.binding_status, 'stale');
  assert.deepEqual(staleRole.content_binding.changed_files, ['src/content-binding-target.js']);
});

test('global content-surface default cannot weaken a built-in strict role', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.agent_reviews = {
    defaults: {
      freshness_mode: 'content_surface'
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await runCli(['review', 'prepare', repo, '--id', 'story-content-binding', '--stage', 'gate', '--role', 'gate_evidence']);
  const recordResult = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-content-binding',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    'pass',
    '--summary',
    'gate evidence keeps its built-in strict policy',
    '--inspection-summary',
    'read the implementation surface',
    '--inspection-input',
    'src/content-binding-target.js',
    '--judgment-delta',
    'global content default -> built-in strict policy retained',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-gate-global-default-review',
    '--agent-closed'
  ]);
  assert.equal(recordResult.exitCode, 0);
  assert.equal(recordResult.result.review.freshness_policy.effective_mode, 'strict_head');
  assert.equal(recordResult.result.review.freshness_policy.source, 'built_in_exception');
});

test('review strict HEAD CLI override requires and records an explicit reason', async () => {
  const repo = await makeGitRepoWithStory();
  await runCli(['review', 'prepare', repo, '--id', 'story-content-binding', '--stage', 'implementation', '--role', 'runtime_contract']);
  const baseArgs = [
    'review',
    'record',
    repo,
    '--id',
    'story-content-binding',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--status',
    'pass',
    '--summary',
    'runtime contract reviewed',
    '--inspection-summary',
    'read the runtime implementation',
    '--inspection-input',
    'src/content-binding-target.js',
    '--judgment-delta',
    'content-scoped default -> strict because the complete release head is the review subject',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-cli-strict-review',
    '--agent-closed',
    '--strict-head-binding'
  ];
  const missingReason = await captureRunCli(baseArgs);
  assert.equal(missingReason.exitCode, 1);
  assert.match(missingReason.stderr, /requires --strict-head-reason/);

  const recorded = await runCli([
    ...baseArgs,
    '--strict-head-reason',
    'the complete release candidate head is the inspected contract'
  ]);
  assert.equal(recorded.exitCode, 0);
  assert.equal(recorded.result.review.freshness_policy.effective_mode, 'strict_head');
  assert.equal(recorded.result.review.freshness_policy.source, 'cli_override');
  assert.equal(
    recorded.result.review.freshness_policy.reason,
    'the complete release candidate head is the inspected contract'
  );
  assert.match(recorded.result.review.content_binding.surface_hash, /^[a-f0-9]{64}$/);

  await writeFile(path.join(repo, 'docs', 'notes.md'), '# Notes\n\nAdvance the release head.\n');
  await git(repo, ['add', 'docs/notes.md']);
  await git(repo, ['commit', '-m', 'docs: advance strict review head']);
  const prepared = await runCli(['pr', 'prepare', repo, '--story-id', 'story-content-binding', '--base', 'main', '--json']);
  const artifactGate = findGate(prepared, 'gate:artifact_consistency');
  const staleReview = artifactGate.stale_artifact_details.find((item) => item.role === 'runtime_contract');
  const recoveryCommand = staleReview.remediation_commands.find((command) => command.startsWith('vibepro review record'));
  assert.match(recoveryCommand, /--status '<pass\|needs_changes\|block>'/);
  assert.match(recoveryCommand, /--strict-head-binding/);
  assert.match(recoveryCommand, /--strict-head-reason "preserve the recorded strict HEAD freshness policy during recovery"/);
  const freshnessGate = findGate(prepared, 'gate:pr_freshness');
  const strictReviewBinding = freshnessGate.content_binding_details.bindings.find((binding) => (
    binding.artifact_type === 'agent_review_result'
      && binding.stage === 'implementation'
      && binding.role === 'runtime_contract'
  ));
  assert.equal(strictReviewBinding.status, 'stale');
  assert.equal(strictReviewBinding.binding_mode, 'strict_head');
  assert.match(strictReviewBinding.reason, /recorded for .*current head/);
  assert.deepEqual(strictReviewBinding.surface_files, ['src/content-binding-target.js']);
  assert.deepEqual(strictReviewBinding.changed_files, []);
  assert.deepEqual(strictReviewBinding.missing_files, []);
  assert.match(strictReviewBinding.recorded_surface_hash, /^[a-f0-9]{64}$/);
  assert.equal(strictReviewBinding.current_surface_hash, null);
  assert.notEqual(strictReviewBinding.current_head_sha, strictReviewBinding.recorded_head_sha);

  const executableRecovery = recoveryCommand
    .replace(/^vibepro\b/, `${JSON.stringify(process.execPath)} ${JSON.stringify(path.resolve('bin/vibepro.js'))}`)
    .replace('<summary>', 'strict recovery review passed')
    .replace('<inspection-summary>', 're-inspected the complete release candidate')
    .replace('<inspection-evidence>', 'src/content-binding-target.js')
    .replace('<inspection-input>', 'src/content-binding-target.js')
    .replace('<initial judgment -> final judgment because evidence>', 'stale strict review -> accepted after complete candidate re-inspection')
    .replace('<pass|needs_changes|block>', 'pass')
    .replace('<agent-id>', 'agent-strict-recovery')
    .replace('<agent-thread-id>', 'thread-strict-recovery')
    .replace('<agent-session-id>', 'session-strict-recovery')
    .replace('<implementation-session-id>', 'session-implementation')
    .replace('<agent-transcript>', 'src/content-binding-target.js')
    .replace('<agent-close-evidence>', 'src/content-binding-target.js');
  await runCli(['review', 'start', repo, '--id', 'story-content-binding', '--stage', 'implementation', '--role', 'runtime_contract', '--agent-system', 'codex', '--agent-id', 'agent-strict-recovery', '--agent-thread-id', 'thread-strict-recovery', '--agent-session-id', 'session-strict-recovery']);
  await runCli(['review', 'close', repo, '--id', 'story-content-binding', '--stage', 'implementation', '--role', 'runtime_contract', '--agent-id', 'agent-strict-recovery', '--close-reason', 'completed', '--close-evidence', 'src/content-binding-target.js']);
  await execFileAsync('/bin/sh', ['-c', executableRecovery], { cwd: repo, encoding: 'utf8' });

  const status = await runCli(['review', 'status', repo, '--id', 'story-content-binding', '--stage', 'implementation', '--json']);
  const recoveredRole = status.result.stages[0].roles.find((item) => item.role === 'runtime_contract');
  assert.equal(recoveredRole.effective_status, 'pass');
  assert.equal(recoveredRole.binding_status, 'current');
  assert.equal(recoveredRole.content_binding.mode, 'strict_head');
  const recoveredArtifact = JSON.parse(await readFile(path.join(
    repo,
    '.vibepro',
    'reviews',
    'story-content-binding',
    'implementation',
    'review-result-runtime_contract.json'
  ), 'utf8'));
  assert.equal(recoveredArtifact.freshness_policy.effective_mode, 'strict_head');
  assert.equal(recoveredArtifact.freshness_policy.reason, 'preserve the recorded strict HEAD freshness policy during recovery');
});

test('custom strict HEAD role policy requires and persists its rationale', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.agent_reviews = {
    roles: {
      runtime_contract: { freshness_mode: 'strict_head' }
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await runCli(['review', 'prepare', repo, '--id', 'story-content-binding', '--stage', 'implementation', '--role', 'runtime_contract']);
  const args = [
    'review', 'record', repo,
    '--id', 'story-content-binding',
    '--stage', 'implementation',
    '--role', 'runtime_contract',
    '--status', 'pass',
    '--summary', 'runtime contract reviewed as a full-head exception',
    '--inspection-summary', 'read the runtime implementation',
    '--inspection-input', 'src/content-binding-target.js',
    '--judgment-delta', 'content surface default -> strict because the runtime contract spans the release head',
    '--agent-system', 'codex',
    '--execution-mode', 'parallel_subagent',
    '--agent-id', 'codex-config-strict-review',
    '--agent-closed'
  ];
  const missingReason = await captureRunCli(args);
  assert.equal(missingReason.exitCode, 1);
  assert.match(missingReason.stderr, /configures strict_head freshness without freshness_reason/);

  config.agent_reviews.roles.runtime_contract.freshness_reason = 'runtime compatibility spans the complete release head';
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const recorded = await runCli(args);
  assert.equal(recorded.exitCode, 0);
  assert.equal(recorded.result.review.freshness_policy.source, 'role_policy');
  assert.equal(recorded.result.review.freshness_policy.reason, 'runtime compatibility spans the complete release head');
});

test('global strict HEAD default is rejected so ordinary roles remain content-scoped', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.agent_reviews = {
    defaults: {
      freshness_mode: 'strict_head',
      freshness_reason: 'apply strict binding to every role'
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const rejected = await captureRunCli([
    'review', 'prepare', repo,
    '--id', 'story-content-binding',
    '--stage', 'implementation',
    '--role', 'runtime_contract'
  ]);

  assert.equal(rejected.exitCode, 1);
  assert.match(rejected.stderr, /defaults\.freshness_mode cannot be strict_head/);
  assert.match(rejected.stderr, /each high-risk role/);
});

test('content-scoped pass rejects generated workspace artifacts as the only inspection input', async () => {
  const repo = await makeGitRepoWithStory();
  await runCli(['review', 'prepare', repo, '--id', 'story-content-binding', '--stage', 'implementation', '--role', 'runtime_contract']);
  const result = await captureRunCli([
    'review',
    'record',
    repo,
    '--id',
    'story-content-binding',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--status',
    'pass',
    '--summary',
    'generated request only',
    '--inspection-summary',
    'read only the generated review request',
    '--inspection-input',
    '.vibepro/reviews/story-content-binding/implementation/review-request-runtime_contract.md',
    '--artifact',
    'src/content-binding-target.js',
    '--judgment-delta',
    'generic pass -> unsupported because no implementation input was inspected',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-generated-only-review',
    '--agent-closed'
  ]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /actual inspected surface is captured/);
});

test('CEF-S-4 strict HEAD binding still invalidates docs-only commits', async () => {
  const repo = await makeGitRepoWithStory();
  const recordResult = await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-content-binding',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--command',
    'node --test test/content-binding.test.js',
    '--summary',
    'strict evidence passed',
    '--target',
    'src/content-binding-target.js',
    '--strict-head-binding'
  ]);
  assert.equal(recordResult.exitCode, 0);
  assert.equal(recordResult.result.evidence.commands[0].content_binding.mode, 'strict_head');

  await writeFile(path.join(repo, 'docs', 'notes.md'), '# Notes\n\nStrict evidence should stale.\n');
  await git(repo, ['add', 'docs/notes.md']);
  await git(repo, ['commit', '-m', 'docs: advance strict head']);

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-content-binding', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  const gate = findGate(result, 'gate:artifact_consistency');
  const artifact = gate.inconsistent_artifacts.find((item) => item.artifact_type === 'verification_command');
  assert.equal(artifact.status, 'stale');
  assert.match(artifact.reason, /recorded for .*current head/);
  const detail = gate.stale_artifact_details.find((item) => item.artifact_type === 'verification_command');
  const recoveryCommand = detail.remediation_commands.find((command) => command.startsWith('vibepro verify record'));
  assert.ok(recoveryCommand);
  assert.match(recoveryCommand, /--target src\/content-binding-target\.js/);
  assert.match(recoveryCommand, /--strict-head-binding/);
  const executableRecovery = recoveryCommand.replace(
    /^vibepro\b/,
    `${JSON.stringify(process.execPath)} ${JSON.stringify(path.resolve('bin/vibepro.js'))}`
  );
  await execFileAsync('/bin/sh', ['-c', executableRecovery], { cwd: repo, encoding: 'utf8' });
  const recoveredEvidence = JSON.parse(await readFile(path.join(
    repo,
    '.vibepro',
    'pr',
    'story-content-binding',
    'verification-evidence.json'
  ), 'utf8'));
  const recoveredCommand = recoveredEvidence.commands.find((command) => command.kind === 'unit');
  assert.equal(recoveredCommand.content_binding.mode, 'strict_head');
  assert.deepEqual(recoveredCommand.observation.targets, ['src/content-binding-target.js']);
  assert.equal(recoveredCommand.artifact, null);
});
