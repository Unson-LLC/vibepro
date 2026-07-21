import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const storyId = 'story-vibepro-atomic-scope-review-contract';
const expectedNestedTests = [
  'unrelated changed target',
  'legacy surface-signal',
  'reviewable small PR on the legacy single-PR readiness path',
  'legacy keyword evidence for atomic',
  'every changed path in one surface row',
  'CLI state persistence',
  'does not initialize or dirty an uninitialized PR branch',
  'automatic split advice until',
  'every required verification command',
  'passed split resolution gate',
  'foreign work-item lineage',
  'accepts a versioned branch merge only when canonical remote topology resolves to a merge parent',
  'independent repo-control unsafe for atomic scope',
  'incomplete typed atomic',
  'prose-only atomic',
  'malformed or disconnected',
  'common judgment spine requires',
  'resolver prefers contract-bound evidence over an earlier unqualified scenario match',
  'change classifier selects workflow_heavy for cross-surface workflow changes',
  'gate evidence classifier normalizes canonical token variants across observation fields',
  'review record persists explicit reviewer identity declaration',
  'pr prepare blocks timed out required review lifecycle even when review result passed',
  'pr prepare marks dispatch preflight for running manual shutdown and unverified review evidence',
  'atomic owner map ignores optional roles for both blocking and ownership'
];
const patterns = expectedNestedTests.join('|');

async function runPublicCli(childEnv: NodeJS.ProcessEnv, args: string[]) {
  return execFileAsync(process.execPath, [path.join(repoRoot, 'bin/vibepro.js'), ...args], {
    cwd: repoRoot,
    env: childEnv,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
}

async function assertPublicCliRejected(childEnv: NodeJS.ProcessEnv, args: string[], message: string, expectedOutput?: RegExp) {
  await assert.rejects(runPublicCli(childEnv, args), (error: NodeJS.ErrnoException & { stdout?: string; stderr?: string }) => {
    if (expectedOutput) {
      assert.match(`${error.stdout ?? ''}\n${error.stderr ?? ''}\n${error.message ?? ''}`, expectedOutput, message);
    }
    return true;
  }, message);
}

test('ASR-E2E-001 replays the complete atomic review workflow contract', async () => {
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...childEnv } = process.env;
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ['--test', '--test-concurrency=1', `--test-name-pattern=${patterns}`, 'test/vibepro-cli.test.js', 'test/responsibility-authority.test.js', 'test/risk-adaptive-gate.test.js', 'test/agent-review-independence.test.js'],
    { cwd: repoRoot, env: childEnv, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  );
  const tap = `${stdout}\n${stderr}`;

  assert.match(tap, /keeps automatic split advice until a typed atomic scope has current-head reviewer ownership evidence/, `${storyId} ac:2 strict current-head owner map is executable`);
  assert.match(tap, /keeps every required verification command after current-head reviewers accept an atomic scope/, `${storyId} ac:3 ac:4 cumulative atomic HEAD and final validation commands are executable`);
  assert.match(tap, /resolver prefers contract-bound evidence over an earlier unqualified scenario match/, `${storyId} ac:8 contract-bound evidence selection is executable`);
  assert.match(tap, /change classifier selects workflow_heavy for cross-surface workflow changes/, `${storyId} ac:12 compound gate-review risk and adjacent negative profiles are executable`);
  assert.match(tap, /gate evidence classifier normalizes canonical token variants across observation fields/, `${storyId} ac:13 failure-mode coverage requires an executed structured assertion`);
  assert.match(tap, /keeps every required verification command after current-head reviewers accept an atomic scope/, `${storyId} ac:14 canonical Story registration remains reviewable while independent repo-control stays unsafe`);
  assert.match(tap, /accepts a versioned branch merge only when canonical remote topology resolves to a merge parent/, `${storyId} ac:15 canonical versioned merge lineage is executable`);
  for (const expectedTest of expectedNestedTests) {
    assert.match(tap, new RegExp(expectedTest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${storyId} executes nested contract test: ${expectedTest}`);
  }
  const testCount = tap.match(/(?:#|ℹ) tests (\d+)\b/);
  const passCount = tap.match(/(?:#|ℹ) pass (\d+)\b/);
  assert.ok(testCount && Number(testCount[1]) >= expectedNestedTests.length, `${storyId} ac:1 ac:2 ac:3 ac:4 ac:13 ac:14 S-001 workflow state transition and atomic scope validation replay`);
  assert.equal(passCount?.[1], testCount[1], `${storyId} ac:5 ac:6 ac:7 ac:8 ac:13 ac:14 S-002 target-bound evidence and cumulative readiness replay`);
  assert.match(tap, /(?:#|ℹ) fail 0\b/, `${storyId} ac:9 ac:10 ac:11 S-003 lifecycle identity lineage and failure-mode replay`);

  const entrypoint = await execFileAsync(process.execPath, ['bin/vibepro.js', '--help'], {
    cwd: repoRoot,
    env: childEnv,
    encoding: 'utf8'
  });
  assert.match(entrypoint.stdout, /vibepro pr prepare/, `${storyId} ac:7 user-facing bin entrypoint completes and exposes the audited workflow`);

  const cliRepo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-asr-cli-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: cliRepo, env: childEnv });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: cliRepo, env: childEnv });
  await execFileAsync('git', ['config', 'user.name', 'VibePro E2E'], { cwd: cliRepo, env: childEnv });
  await writeFile(path.join(cliRepo, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: cliRepo, env: childEnv });
  await execFileAsync('git', ['commit', '-m', 'chore: initialize fixture'], { cwd: cliRepo, env: childEnv });
  await runPublicCli(childEnv, ['init', cliRepo, '--language', 'ja', '--story-id', storyId, '--title', 'Atomic scope CLI replay']);
  const fixtureConfigPath = path.join(cliRepo, '.vibepro', 'config.json');
  const fixtureConfig = JSON.parse(await readFile(fixtureConfigPath, 'utf8'));
  fixtureConfig.agent_reviews = {
    ...(fixtureConfig.agent_reviews ?? {}),
    roles: {
      ...(fixtureConfig.agent_reviews?.roles ?? {}),
      pr_split_scope: { mode: 'optional' },
      e2e_ux: { mode: 'optional' },
      release_risk: { mode: 'optional' }
    }
  };
  await writeFile(fixtureConfigPath, `${JSON.stringify(fixtureConfig, null, 2)}\n`);
  await writeFile(path.join(cliRepo, 'package.json'), `${JSON.stringify({ type: 'module', scripts: { test: 'node --test test/change.test.js', typecheck: 'node --check src/change.js' } }, null, 2)}\n`);
  await execFileAsync('git', ['add', '.gitignore', '.vibepro/config.json', 'package.json'], { cwd: cliRepo, env: childEnv });
  await execFileAsync('git', ['commit', '-m', 'chore: establish VibePro fixture baseline'], { cwd: cliRepo, env: childEnv });
  await execFileAsync('git', ['branch', 'fixture-base'], { cwd: cliRepo, env: childEnv });
  await mkdir(path.join(cliRepo, 'src'), { recursive: true });
  await mkdir(path.join(cliRepo, 'test'), { recursive: true });
  await mkdir(path.join(cliRepo, 'docs', 'stories'), { recursive: true });
  await writeFile(path.join(cliRepo, 'src', 'change.js'), 'export const changed = true;\n');
  await writeFile(path.join(cliRepo, 'test', 'change.test.js'), 'import assert from "node:assert/strict"; import test from "node:test"; import { changed } from "../src/change.js"; test("public atomic behavior", () => assert.equal(changed, true));\n');
  const fixtureStoryPath = path.join('docs', 'stories', `${storyId}.md`);
  await writeFile(path.join(cliRepo, fixtureStoryPath), `---
story_id: ${storyId}
title: Atomic scope CLI replay
status: active
pr_scope_strategy: atomic_single_pr
pr_scope_reason: The requirements SSOT and runtime behavior must remain one current-head contract so reviewers can reject incomplete ownership before release.
pr_scope_review_facets:
  - requirements-ssot
  - runtime-behavior
pr_scope_dependency_boundaries:
  - requirements-ssot->runtime-behavior
---
`);
  await execFileAsync('git', ['add', 'src/change.js', 'test/change.test.js', fixtureStoryPath], { cwd: cliRepo, env: childEnv });
  await execFileAsync('git', ['commit', '-m', 'feat: add atomic fixture change'], { cwd: cliRepo, env: childEnv });
  for (const [kind, command] of [['unit', 'npm test'], ['typecheck', 'npm run typecheck']]) {
    await execFileAsync('npm', command === 'npm test' ? ['test'] : ['run', 'typecheck'], { cwd: cliRepo, env: childEnv, encoding: 'utf8' });
    await runPublicCli(childEnv, ['verify', 'record', cliRepo, '--id', storyId, '--kind', kind, '--status', 'pass', '--command', command, '--summary', `${kind} passed through the public CLI fixture`]);
  }
  const prepared = await runPublicCli(childEnv, ['pr', 'prepare', cliRepo, '--base', 'fixture-base', '--story-id', storyId, '--json']);
  const preparedOutput = JSON.parse(prepared.stdout);
  assert.equal(preparedOutput.story.story_id, storyId, `${storyId} public CLI process boundary runs pr prepare`);
  const prPrepare = JSON.parse(await readFile(path.join(cliRepo, '.vibepro', 'pr', storyId, 'pr-prepare.json'), 'utf8'));
  assert.equal(prPrepare.story.story_id, storyId, `${storyId} public CLI persists the workflow artifact`);
  assert.equal(prPrepare.split_plan.atomic_scope.status, 'rejected', `${storyId} public CLI keeps atomic scope fail closed without current-head owner evidence`);
  assert.deepEqual(prPrepare.split_plan.atomic_scope.generated_lane_ids.sort(), ['requirements-ssot', 'runtime-behavior']);
  assert.match(prPrepare.split_plan.atomic_scope.rejection_reasons.join(' '), /review|owner/i);
  assert.deepEqual(prPrepare.split_plan.atomic_scope.next_actions.map((action: { type: string }) => action.type), [
    'record_current_head_review_owners',
    'rerun_atomic_scope_decision'
  ], `${storyId} keeps atomic repair steps beside the rejection reason`);
  const ownerRepair = prPrepare.split_plan.atomic_scope.next_actions[0];
  assert.deepEqual(ownerRepair.missing_required_roles, []);
  assert.ok(ownerRepair.roles_requiring_surface_coverage.length > 0);
  assert.deepEqual(ownerRepair.unowned_review_facets.sort(), ['requirements-ssot', 'runtime-behavior']);
  assert.ok(ownerRepair.uncovered_paths.length > 0);
  assert.equal(ownerRepair.prepare_commands.length, ownerRepair.roles_requiring_surface_coverage.length);
  assert.ok(ownerRepair.prepare_commands.every((command: string) => /review prepare/.test(command)));
  assert.ok(ownerRepair.prepare_commands.every((command: string) => !/[<>]|\.\.\./.test(command)));
  assert.equal(ownerRepair.command, ownerRepair.prepare_commands[0]);
  assert.match(ownerRepair.follow_up_command, /review status/);
  assert.doesNotMatch(ownerRepair.follow_up_command, /[<>]|\.\.\./);
  assert.equal(ownerRepair.follow_up, ownerRepair.follow_up_command);
  const prBody = await readFile(path.join(cliRepo, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(prBody, /owner repair roles:/);
  assert.match(prBody, /uncovered paths:/);
  assert.match(prBody, /vibepro review prepare/);
  assert.match(prBody, /vibepro review status/);
  assert.match(prPrepare.split_plan.atomic_scope.next_actions[1].command, /pr prepare/);

  const changedInputs = ['docs/stories/' + storyId + '.md', 'src/change.js', 'test/change.test.js'];
  const requiredReviewKeys = new Set([
    ...prPrepare.pr_context.agent_reviews.required_reviews,
    ...prPrepare.pr_context.agent_reviews.checkpoint_required_reviews
  ].map((review: { stage: string; role: string }) => `${review.stage}:${review.role}`));
  assert.ok(requiredReviewKeys.size > 0, `${storyId} fixture must exercise independently bound required reviewers`);
  assert.equal(requiredReviewKeys.has('gate:pr_split_scope'), false, `${storyId} configured optional reviewer must not become a required owner`);
  assert.equal(prPrepare.pr_context.agent_reviews.stages.flatMap((stage: { roles: { role: string }[] }) => stage.roles).some((role: { role: string }) => role.role === 'pr_split_scope'), false, `${storyId} optional reviewer remains missing before required ownership is recorded`);
  let recoveryTarget: { stage: string; role: string } | null = null;
  for (const stage of prPrepare.pr_context.agent_reviews.stages) {
    const roles = stage.roles
      .map((role: { role: string }) => role.role)
      .filter((role: string) => requiredReviewKeys.has(`${stage.stage}:${role}`));
    if (roles.length === 0) continue;
    await runPublicCli(childEnv, ['review', 'prepare', cliRepo, '--id', storyId, '--stage', stage.stage, ...roles.flatMap((role: string) => ['--role', role])]);
    recoveryTarget ??= { stage: stage.stage, role: roles[0] };
    for (const role of roles) {
      const agentId = `public-${stage.stage}-${role}-agent`;
      const reviewerThreadId = `public-${stage.stage}-${role}-thread`;
      const reviewerSessionId = `public-${stage.stage}-${role}-session`;
      const replacementSessionId = `public-${stage.stage}-${role}-replacement-session`;
      const openAgentId = `public-${stage.stage}-${role}-open-agent`;
      const openStart = JSON.parse((await runPublicCli(childEnv, ['review', 'start', cliRepo, '--id', storyId, '--stage', stage.stage, '--role', role, '--agent-system', 'codex', '--agent-id', openAgentId, '--json'])).stdout);
      await assertPublicCliRejected(childEnv, [
        'review', 'record', cliRepo, '--id', storyId, '--stage', stage.stage, '--role', role,
        '--status', 'pass', '--summary', 'open lifecycle must not own atomic scope',
        '--agent-system', 'codex', '--execution-mode', 'parallel_subagent', '--agent-id', openAgentId,
        '--agent-session-id', openAgentId, '--implementation-session-id', 'public-implementation-session',
        '--reviewer-identity', 'separate_session', '--inspection-summary', 'negative open lifecycle fixture',
        ...changedInputs.flatMap((input) => ['--inspection-input', input]), '--judgment-delta', 'open -> rejected',
        '--strict-head-binding', '--strict-head-reason', 'negative lifecycle fixture', '--agent-closed'
      ], `${storyId} rejects a review whose lifecycle is still open`, /lifecycle is running|vibepro review close/);
      const openRejected = JSON.parse((await runPublicCli(childEnv, ['pr', 'prepare', cliRepo, '--base', 'fixture-base', '--story-id', storyId, '--json'])).stdout);
      assert.equal(openRejected.split_plan.atomic_scope.status, 'rejected');
      assert.equal(openRejected.split_plan.atomic_scope.review_owner_map_verified, false);
      await runPublicCli(childEnv, ['review', 'close', cliRepo, '--id', storyId, '--stage', stage.stage, '--role', role, '--agent-id', openAgentId, '--close-reason', 'manual_shutdown', '--close-evidence', `agent:${openAgentId}:negative-fixture-manual-shutdown`]);
      const recoveryPrepared = JSON.parse((await runPublicCli(childEnv, ['pr', 'prepare', cliRepo, '--base', 'fixture-base', '--story-id', storyId, '--json'])).stdout);
      const recoveryPreflight = recoveryPrepared.pr_context.gate_dag.nodes.find((node: { id: string }) => node.id === `review:preflight:${stage.stage}:${role}`);
      assert.equal(recoveryPreflight.preflight_kind, 'lifecycle_recovery');
      assert.match(recoveryPreflight.reason, /manual_shutdown/);
      assert.match(recoveryPreflight.reason, /closure|replacement/);

      await runPublicCli(childEnv, [
        'review', 'start', cliRepo, '--id', storyId, '--stage', stage.stage, '--role', role,
        '--agent-system', 'codex', '--agent-id', agentId,
        '--agent-thread-id', reviewerThreadId, '--agent-session-id', reviewerSessionId,
        '--replacement-for', openStart.lifecycle.lifecycle_id
      ]);
      await runPublicCli(childEnv, ['review', 'close', cliRepo, '--id', storyId, '--stage', stage.stage, '--role', role, '--agent-id', agentId, '--close-reason', 'completed', '--close-evidence', `agent:${agentId}:completed`]);
      await assertPublicCliRejected(childEnv, [
        'review', 'record', cliRepo, '--id', storyId, '--stage', stage.stage, '--role', role,
        '--status', 'pass', '--summary', 'foreign record agent must not own atomic scope',
        '--agent-system', 'codex', '--execution-mode', 'parallel_subagent', '--agent-id', `${agentId}-foreign`,
        '--agent-session-id', `${agentId}-foreign`, '--implementation-session-id', 'public-implementation-session',
        '--reviewer-identity', 'separate_session', '--inspection-summary', 'negative foreign agent fixture',
        ...changedInputs.flatMap((input) => ['--inspection-input', input]), '--judgment-delta', 'foreign -> rejected',
        '--strict-head-binding', '--strict-head-reason', 'negative lifecycle identity fixture', '--agent-closed'
      ], `${storyId} rejects a record agent that does not match the closed lifecycle`, /does not match|latest closed review lifecycle/);
      await assertPublicCliRejected(childEnv, [
        'review', 'record', cliRepo, '--id', storyId, '--stage', stage.stage, '--role', role,
        '--status', 'pass', '--summary', 'agent id alone must not impersonate a reviewer session',
        '--agent-system', 'codex', '--execution-mode', 'parallel_subagent', '--agent-id', agentId,
        '--agent-session-id', agentId, '--implementation-session-id', 'public-implementation-session',
        '--reviewer-identity', 'separate_session', '--inspection-summary', 'negative agent-id alias fixture',
        ...changedInputs.flatMap((input) => ['--inspection-input', input]), '--judgment-delta', 'agent id alias -> rejected',
        '--strict-head-binding', '--strict-head-reason', 'negative lifecycle session binding fixture', '--agent-closed'
      ], `${storyId} rejects an agent id that was never recorded as the lifecycle session or thread`, /session\/thread id|latest closed review lifecycle/);
      await runPublicCli(childEnv, [
        'review', 'start', cliRepo, '--id', storyId, '--stage', stage.stage, '--role', role,
        '--agent-system', 'codex', '--agent-id', agentId,
        '--agent-thread-id', reviewerThreadId, '--agent-session-id', replacementSessionId
      ]);
      const originalChange = await readFile(path.join(cliRepo, 'src', 'change.js'), 'utf8');
      await writeFile(path.join(cliRepo, 'src', 'change.js'), `${originalChange.trimEnd()} // running-surface-change\n`);
      const runningStalePrepared = JSON.parse((await runPublicCli(childEnv, ['pr', 'prepare', cliRepo, '--base', 'fixture-base', '--story-id', storyId, '--json'])).stdout);
      const runningStalePreflight = runningStalePrepared.pr_context.gate_dag.nodes.find((node: { id: string }) => node.id === `review:preflight:${stage.stage}:${role}`);
      assert.equal(runningStalePreflight.preflight_kind, 'dedupe_running', `${storyId} running lifecycle takes precedence over stale review evidence`);
      assert.match(runningStalePreflight.reason, /already running/);
      await writeFile(path.join(cliRepo, 'src', 'change.js'), originalChange);
      await assertPublicCliRejected(childEnv, [
        'review', 'record', cliRepo, '--id', storyId, '--stage', stage.stage, '--role', role,
        '--status', 'pass', '--summary', 'an older closed session must not authenticate a newer running lifecycle',
        '--agent-system', 'codex', '--execution-mode', 'parallel_subagent', '--agent-id', agentId,
        '--agent-session-id', reviewerSessionId, '--implementation-session-id', 'public-implementation-session',
        '--reviewer-identity', 'separate_session', '--inspection-summary', 'negative stale lifecycle fixture',
        ...changedInputs.flatMap((input) => ['--inspection-input', input]), '--judgment-delta', 'old closed session plus new running lifecycle -> rejected',
        '--strict-head-binding', '--strict-head-reason', 'negative latest lifecycle binding fixture', '--agent-closed'
      ], `${storyId} rejects an older closed session when the same agent has a newer running lifecycle`, /latest matching lifecycle is running[\s\S]*vibepro review close/);
      await runPublicCli(childEnv, ['review', 'close', cliRepo, '--id', storyId, '--stage', stage.stage, '--role', role, '--agent-id', agentId, '--close-reason', 'completed', '--close-evidence', `agent:${agentId}:replacement-completed`]);
      await runPublicCli(childEnv, [
        'review', 'record', cliRepo, '--id', storyId, '--stage', stage.stage, '--role', role,
        '--status', 'pass', '--summary', `${stage.stage}:${role} independently passed the public CLI fixture`,
        '--agent-system', 'codex', '--execution-mode', 'parallel_subagent', '--agent-id', agentId,
        '--agent-thread-id', reviewerThreadId, '--agent-session-id', replacementSessionId,
        '--implementation-session-id', 'public-implementation-session', '--reviewer-identity', 'separate_session',
        '--inspection-summary', `inspected all atomic lanes for ${stage.stage}:${role}`,
        ...changedInputs.flatMap((input) => ['--inspection-input', input]),
        '--judgment-delta', `unowned atomic lane -> ${stage.stage}:${role} independently accepted current HEAD`,
        '--strict-head-binding', '--strict-head-reason', `${stage.stage}:${role} owns the complete atomic HEAD`, '--agent-closed'
      ]);
    }
  }

  assert.ok(recoveryTarget, `${storyId} recovery fixture requires at least one required review role`);
  for (const closeReason of ['timeout', 'manual_shutdown']) {
    const { stage, role } = recoveryTarget;
    const failedAgentId = `public-${stage}-${role}-agent`;
    const replacementAgentId = `${failedAgentId}-replacement`;
    const failedStart = JSON.parse((await runPublicCli(childEnv, [
      'review', 'start', cliRepo, '--id', storyId, '--stage', stage, '--role', role,
      '--agent-system', 'codex', '--agent-id', failedAgentId,
      '--agent-thread-id', `${failedAgentId}-thread`, '--agent-session-id', `${failedAgentId}-session`, '--json'
    ])).stdout);
    await runPublicCli(childEnv, [
      'review', 'close', cliRepo, '--id', storyId, '--stage', stage, '--role', role,
      '--agent-id', failedAgentId, '--close-reason', closeReason, '--close-evidence', `agent:${failedAgentId}:${closeReason}`
    ]);
    await runPublicCli(childEnv, [
      'review', 'start', cliRepo, '--id', storyId, '--stage', stage, '--role', role,
      '--agent-system', 'codex', '--agent-id', replacementAgentId,
      '--agent-thread-id', `${replacementAgentId}-thread`, '--agent-session-id', `${replacementAgentId}-session`,
      '--replacement-for', failedStart.lifecycle.lifecycle_id
    ]);
    await runPublicCli(childEnv, [
      'review', 'close', cliRepo, '--id', storyId, '--stage', stage, '--role', role,
      '--agent-id', replacementAgentId, '--close-reason', 'completed', '--close-evidence', `agent:${replacementAgentId}:completed`
    ]);
    await runPublicCli(childEnv, [
      'review', 'record', cliRepo, '--id', storyId, '--stage', stage, '--role', role,
      '--status', 'pass', '--summary', `${closeReason} replacement completed through the public CLI`,
      '--agent-system', 'codex', '--execution-mode', 'parallel_subagent', '--agent-id', replacementAgentId,
      '--agent-thread-id', `${replacementAgentId}-thread`, '--agent-session-id', `${replacementAgentId}-session`,
      '--implementation-session-id', 'public-implementation-session', '--reviewer-identity', 'separate_session',
      '--inspection-summary', `${closeReason} recovery inspected the complete atomic surface`,
      ...changedInputs.flatMap((input) => ['--inspection-input', input]),
      '--judgment-delta', `${closeReason} lifecycle -> closed replacement lifecycle and accepted current HEAD`,
      '--agent-transcript', `agent:${replacementAgentId}:transcript`, '--agent-close-evidence', `agent:${replacementAgentId}:completed`,
      '--strict-head-binding', '--strict-head-reason', `${closeReason} recovery is bound to the complete atomic HEAD`, '--agent-closed'
    ]);
  }

  const accepted = await runPublicCli(childEnv, ['pr', 'prepare', cliRepo, '--base', 'fixture-base', '--story-id', storyId, '--json']);
  const acceptedOutput = JSON.parse(accepted.stdout);
  assert.equal(acceptedOutput.split_plan.atomic_scope.status, 'accepted', `${storyId} public CLI lifecycle changes the atomic decision to accepted`);
  assert.equal(acceptedOutput.split_plan.atomic_scope.review_owner_map_verified, true);
  assert.equal(acceptedOutput.pr_context.agent_reviews.required_reviews.some((review: { stage: string; role: string }) => review.stage === 'gate' && review.role === 'pr_split_scope'), false);
  assert.equal(acceptedOutput.pr_context.agent_reviews.stages.flatMap((stage: { roles: { role: string }[] }) => stage.roles).some((role: { role: string }) => role.role === 'pr_split_scope'), false, `${storyId} required owners accept while configured optional role remains missing`);
  assert.equal(acceptedOutput.split_plan.atomic_scope.review_owner_map.flatMap((facet: { owners: unknown[] }) => facet.owners).every((owner: { reviewer_identity: string }) => owner.reviewer_identity === 'separate_session'), true);
  const reloaded = await runPublicCli(childEnv, ['pr', 'prepare', cliRepo, '--base', 'fixture-base', '--story-id', storyId, '--json']);
  assert.equal(JSON.parse(reloaded.stdout).split_plan.atomic_scope.status, 'accepted', `${storyId} a fresh public CLI process reloads accepted lifecycle evidence`);

  await writeFile(path.join(cliRepo, 'src', 'change.js'), 'export const changed = "new-head";\n');
  await execFileAsync('git', ['add', 'src/change.js'], { cwd: cliRepo, env: childEnv });
  await execFileAsync('git', ['commit', '-m', 'feat: change atomic head after review'], { cwd: cliRepo, env: childEnv });
  const stale = await runPublicCli(childEnv, ['pr', 'prepare', cliRepo, '--base', 'fixture-base', '--story-id', storyId, '--json']);
  assert.equal(JSON.parse(stale.stdout).split_plan.atomic_scope.status, 'rejected', `${storyId} public CLI rejects strict reviews after HEAD changes`);
});
