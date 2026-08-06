import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  MERGE_GATE_DIAGNOSIS_STOP_REASONS,
  diagnoseMergeGateAuthorization
} from '../../src/merge-gate-diagnosis.js';
import { PUBLIC_RECONCILIATION_REASONS } from '../../src/merge-public-projection.js';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI_BIN = path.join(root, 'bin', 'vibepro.js');
const STORY_ID = 'story-merge-gate-diagnosis-e2e';
const AUTHORITY_URL = 'https://github.example.test/unson/vibepro.git';

// story-vibepro-merge-gate-stop-reason-diagnosis: replay the whole workflow the
// 2026-08-01 PR #406 landing actually went through -- prepare and create the PR
// at one HEAD, advance HEAD with a follow-up commit, then try to merge -- and
// assert each workflow state names its own cause. Before this Story every state
// below reported the same `gate_not_ready`.
async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo });
}

async function cli(args, env) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_BIN, ...args], {
      env: env ?? process.env,
      maxBuffer: 64 * 1024 * 1024
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    return { exitCode: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

async function makeWorkflowRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-mgd-e2e-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await writeFile(path.join(repo, '.gitignore'), '.vibepro/*\n!.vibepro/config.json\n');
  await execFileAsync(process.execPath, [
    CLI_BIN, 'init', repo,
    '--story-id', STORY_ID,
    '--title', 'merge gate diagnosis workflow replay',
    '--view', 'dev',
    '--period', '2026-W31'
  ]);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.execution = { managed_worktree: 'disabled' };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: workflow fixture']);

  const remote = await mkdtemp(path.join(os.tmpdir(), 'vibepro-mgd-e2e-remote-'));
  await execFileAsync('git', ['init', '--bare'], { cwd: remote });
  await git(repo, ['remote', 'add', 'origin', remote]);
  await git(repo, ['push', '-u', 'origin', 'main']);
  await git(repo, ['config', `url.${remote}.insteadOf`, AUTHORITY_URL]);
  await git(repo, ['remote', 'set-url', 'origin', AUTHORITY_URL]);
  return repo;
}

async function makeGhStub() {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-mgd-e2e-bin-'));
  const ghCallLog = path.join(binDir, 'gh-called.log');
  await writeFile(path.join(binDir, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(ghCallLog)}, process.argv.slice(2).join(' ') + '\\n');
process.exit(99);
`);
  await chmod(path.join(binDir, 'gh'), 0o755);
  return { binDir, ghCallLog };
}

const GATE_DAG = {
  overall_status: 'needs_verification',
  nodes: [{ id: 'gate:validation_sequencing', required: true, status: 'needs_evidence' }]
};

const WAIVER = {
  allowed: true,
  waiver_policy: 'cli_reason',
  reason: 'noncritical validation sequencing waiver recorded at PR creation',
  unresolved_gates: [{ id: 'gate:validation_sequencing' }],
  critical_unresolved_gates: []
};

async function writePrPrepare(prDir, headSha) {
  await writeFile(path.join(prDir, 'pr-prepare.json'), `${JSON.stringify({
    story: { story_id: STORY_ID, title: 'merge gate diagnosis workflow replay' },
    gate_status: {
      overall_status: 'needs_verification',
      ready_for_pr_create: false,
      unresolved_gates: [{ id: 'gate:validation_sequencing' }],
      critical_unresolved_gates: []
    },
    pr_context: { gate_dag: GATE_DAG },
    git: { base_ref: 'main', head_sha: headSha },
    artifact_freshness: {
      kind: 'pr_prepare', status: 'current', artifact_head_sha: headSha, current_head_sha: headSha
    }
  }, null, 2)}\n`);
}

async function writePrCreate(prDir, headSha) {
  await writeFile(path.join(prDir, 'pr-create.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    mode: 'pr_create',
    dry_run: false,
    story: { story_id: STORY_ID, title: 'merge gate diagnosis workflow replay' },
    gate_override: WAIVER,
    base: 'main',
    pr_url: 'https://github.example.test/unson/vibepro/pull/1',
    current_head_sha: headSha,
    artifact_freshness: {
      kind: 'pr_create', status: 'current', artifact_head_sha: headSha, current_head_sha: headSha
    }
  }, null, 2)}\n`);
}

async function explain(repo, env) {
  const result = await cli(
    ['execute', 'merge', repo, '--story-id', STORY_ID, '--explain', '--json'],
    env
  );
  return { exitCode: result.exitCode, explained: JSON.parse(result.stdout) };
}

test('MGD-E2E-1 the merge workflow reports a distinct cause for each state it can stop in, and only gate evidence yields gate_not_ready', async () => {
  const repo = await makeWorkflowRepo();
  const { binDir, ghCallLog } = await makeGhStub();
  const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` };
  const prDir = path.join(repo, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });

  // State 1: nothing prepared yet.
  const empty = await explain(repo, env);
  assert.equal(empty.exitCode, 2, 'ac-1: a story with no gate evidence still exits blocked');
  assert.equal(
    empty.explained.gate_authorization_diagnosis.stop_reason,
    'gate_evidence_missing',
    'ac-1: absent evidence reports gate_evidence_missing, never gate_not_ready'
  );

  // State 2: pr prepare exists, PR not created yet. The gate DAG is not ready
  // and nothing is waived, so the gates -- not the absent artifact -- are the
  // repair; the absent artifact is still visible in artifact_bindings.
  const firstHead = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  await writePrPrepare(prDir, firstHead);
  const prepared = await explain(repo, env);
  assert.equal(
    prepared.explained.gate_authorization_diagnosis.stop_reason,
    'gate_not_ready',
    'ac-1 ac-2: with no waiver and unresolved gates, the gates are named, not the absent pr-create'
  );
  assert.equal(
    prepared.explained.gate_authorization_diagnosis.artifact_bindings
      .find((binding) => binding.artifact === 'pr_create').status,
    'missing',
    'ac-5: the absent pr-create is still reported in artifact_bindings'
  );

  // State 3: PR created with an auditable noncritical waiver at this HEAD.
  await writePrCreate(prDir, firstHead);
  const created = await explain(repo, env);
  assert.equal(created.exitCode, 0, 'ac-6: --explain exits 0 when the merge is authorized');
  assert.equal(created.explained.gate_ready, true, 'ac-6: --explain reports the authorized verdict');
  assert.equal(created.explained.gate_authorization.source, 'pr_create_gate_override');
  assert.equal(created.explained.gate_authorization_diagnosis.status, 'authorized');
  assert.equal(created.explained.gate_authorization_diagnosis.stop_reason, null);

  // State 4: a follow-up commit advances HEAD. Both lifecycle artifacts fall out
  // of binding; pr-prepare is reported first because merge authority cannot even
  // resolve the current gate status without it.
  await writeFile(path.join(repo, 'follow-up.txt'), 'review feedback\n');
  await git(repo, ['add', 'follow-up.txt']);
  await git(repo, ['commit', '-m', 'fix: address review feedback']);
  const secondHead = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const advanced = await explain(repo, env);
  assert.equal(
    advanced.explained.gate_authorization_diagnosis.stop_reason,
    'pr_prepare_artifact_stale',
    'ac-3 S-006: when both lifecycle artifacts lapse, the repair that must run first is named'
  );
  assert.equal(advanced.explained.current_head_sha, secondHead);

  // State 5: pr prepare is re-run for the new HEAD but the PR body was not
  // re-created, so only the waiver is stale. This is the PR #406 state: the
  // artifact really did carry the merge authority, so the artifact is named.
  await writePrPrepare(prDir, secondHead);
  const stalePrCreate = await explain(repo, env);
  assert.equal(
    stalePrCreate.explained.gate_authorization_diagnosis.stop_reason,
    'pr_create_artifact_stale',
    'ac-2 S-007: a stale pr-create waiver reports pr_create_artifact_stale'
  );
  assert.equal(
    stalePrCreate.explained.gate_authorization_diagnosis.artifact_bindings
      .find((binding) => binding.artifact === 'pr_prepare').status,
    'current',
    'ac-5 S-007: the diagnosis states which artifact is current and which is stale'
  );
  assert.equal(
    stalePrCreate.explained.gate_authorization_diagnosis.artifact_bindings
      .find((binding) => binding.artifact === 'pr_create').artifact_head_sha,
    firstHead,
    'ac-5 S-007: the stale binding carries the older artifact_head_sha'
  );

  // The same state through the real merge command persists the same cause, and
  // the public JSON projection carries it instead of collapsing it.
  const merge = await cli(
    ['execute', 'merge', repo, '--story-id', STORY_ID, '--base', 'main', '--pr', '1', '--dry-run', '--json'],
    env
  );
  assert.equal(merge.exitCode, 2);
  const publicMerge = JSON.parse(merge.stdout);
  assert.equal(
    publicMerge.stop_reason,
    'pr_create_artifact_stale',
    'ac-7: the public JSON projection carries the new stop reason'
  );
  assert.equal(
    publicMerge.gate_authorization_diagnosis.cause,
    'pr_create_artifact_stale',
    'ac-7 CON-001: the public JSON projection carries the whole diagnosis, not a collapsed placeholder'
  );
  const persisted = JSON.parse(await readFile(path.join(prDir, 'pr-merge.json'), 'utf8'));
  assert.equal(persisted.gate_authorization_diagnosis.cause, 'pr_create_artifact_stale');

  // State 6a: a waiver that is present but incomplete.
  await writePrCreate(prDir, secondHead);
  await writeFile(path.join(prDir, 'pr-create.json'), `${JSON.stringify({
    ...JSON.parse(await readFile(path.join(prDir, 'pr-create.json'), 'utf8')),
    gate_override: { allowed: true, waiver_policy: 'cli_reason', reason: 'targets omitted', critical_unresolved_gates: [] }
  }, null, 2)}\n`);
  const incompleteWaiver = await explain(repo, env);
  assert.equal(
    incompleteWaiver.explained.gate_authorization_diagnosis.stop_reason,
    'gate_waiver_incomplete',
    'ac-4 S-001: an incomplete waiver reports gate_waiver_incomplete'
  );

  // State 6b: the waiver is complete but no longer matches the gate surface it
  // claims to waive.
  await writeFile(path.join(prDir, 'pr-create.json'), `${JSON.stringify({
    ...JSON.parse(await readFile(path.join(prDir, 'pr-create.json'), 'utf8')),
    gate_override: { ...WAIVER, unresolved_gates: [{ id: 'gate:some_other_gate' }] }
  }, null, 2)}\n`);
  const staleWaiver = await explain(repo, env);
  assert.equal(
    staleWaiver.explained.gate_authorization_diagnosis.stop_reason,
    'gate_waiver_stale',
    'ac-4 S-001: a waiver whose targets no longer match reports gate_waiver_stale'
  );

  // State 6c: a routed gate-dag.json describes a different authorization surface
  // than the prepared one.
  await writePrCreate(prDir, secondHead);
  await writeFile(path.join(prDir, 'gate-dag.json'), `${JSON.stringify({
    overall_status: 'needs_verification',
    nodes: [{ id: 'gate:e2e', type: 'e2e', required: true, critical: true, status: 'needs_evidence' }]
  }, null, 2)}\n`);
  const routedMismatch = await explain(repo, env);
  assert.equal(
    routedMismatch.explained.gate_authorization_diagnosis.stop_reason,
    'gate_status_unresolved',
    'ac-3 S-002: a routed gate-dag surface mismatch reports gate_status_unresolved'
  );
  await rm(path.join(prDir, 'gate-dag.json'));

  // State 7: no waiver at all, with the gate DAG still not ready. This -- and
  // only this -- is gate_not_ready.
  await writeFile(path.join(prDir, 'pr-create.json'), `${JSON.stringify({
    ...JSON.parse(await readFile(path.join(prDir, 'pr-create.json'), 'utf8')),
    gate_override: undefined
  }, null, 2)}\n`);
  const noWaiver = await explain(repo, env);
  assert.equal(
    noWaiver.explained.gate_authorization_diagnosis.cause,
    'gates_unresolved',
    'ac-1 INV-001: unresolved gate evidence is the only cause that keeps gate_not_ready'
  );
  assert.equal(
    noWaiver.explained.gate_authorization_diagnosis.stop_reason,
    'gate_not_ready',
    'ac-1 INV-001: gate_not_ready is reserved for unresolved gate evidence'
  );
  assert.deepEqual(
    noWaiver.explained.gate_authorization_diagnosis.blocking_gates.map((gate) => gate.id),
    ['gate:validation_sequencing'],
    'ac-5: a gate_not_ready verdict names the gate that blocks it'
  );

  // State 8: a lifecycle artifact that cannot be parsed at all.
  await writeFile(path.join(prDir, 'pr-create.json'), '{ this is not json\n');
  const unreadable = await explain(repo, env);
  assert.equal(
    unreadable.explained.gate_authorization_diagnosis.stop_reason,
    'artifact_unreadable',
    'ac-1 ac-6 S-008: a malformed artifact is diagnosed by name, not surfaced as a raw parse error'
  );
  assert.equal(
    unreadable.explained.gate_authorization_diagnosis.artifact_bindings
      .find((binding) => binding.artifact === 'pr_create').status,
    'unreadable',
    'ac-5 S-008: the unparseable artifact is reported as unreadable, not as missing'
  );

  // State 9: a valid waiver would authorize, but a routed gate-dag.json cannot
  // be parsed. The authority function treats it as absent; the diagnosis must
  // not report authorized where the real merge would fail closed.
  await writePrCreate(prDir, secondHead);
  await writeFile(path.join(prDir, 'gate-dag.json'), '{ not json either\n');
  const unreadableOverAuthorized = await explain(repo, env);
  assert.equal(
    unreadableOverAuthorized.exitCode,
    2,
    'ac-6 S-009: an unparseable routed artifact blocks even when the waiver would authorize'
  );
  assert.equal(
    unreadableOverAuthorized.explained.gate_authorization_diagnosis.stop_reason,
    'artifact_unreadable',
    'ac-1 S-009: unreadable input outranks an otherwise-authorizing waiver'
  );
  assert.equal(
    unreadableOverAuthorized.explained.gate_ready,
    false,
    'ac-6 S-009: gate_ready follows the diagnosis, not the raw authority verdict'
  );
  await rm(path.join(prDir, 'gate-dag.json'));

  // No state in this replay reached the provider.
  const ghCalls = await readFile(ghCallLog, 'utf8').catch(() => '');
  assert.equal(ghCalls.includes('pr merge'), false);
});

test('MGD-E2E-2 --explain is read-only, and the stop reason taxonomy is pinned by regression tests', async () => {
  const repo = await makeWorkflowRepo();
  const { binDir, ghCallLog } = await makeGhStub();
  const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` };
  const prDir = path.join(repo, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const headSha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  await writePrPrepare(prDir, headSha);
  await writePrCreate(prDir, '0'.repeat(40));

  const before = (await git(repo, ['status', '--porcelain'])).stdout;
  const explained = await explain(repo, env);
  assert.equal(explained.exitCode, 2, 'ac-6 S-004: --explain exits 2 on a blocked merge');
  assert.ok(
    explained.explained.gate_authorization_diagnosis.next_actions.length > 0,
    'ac-6 S-004: --explain prints next actions'
  );
  await assert.rejects(
    () => readFile(path.join(prDir, 'pr-merge.json'), 'utf8'),
    { code: 'ENOENT' },
    'ac-6 S-004: --explain writes no pr-merge.json'
  );
  await assert.rejects(
    () => readFile(ghCallLog, 'utf8'),
    { code: 'ENOENT' },
    'ac-6 S-004: --explain invokes no gh command'
  );
  assert.equal(
    (await git(repo, ['status', '--porcelain'])).stdout,
    before,
    'ac-6 S-004: --explain leaves the repository unchanged'
  );

  // The unrecognised-authorization-reason default is unreachable through
  // artifacts by construction -- buildMergeGateAuthorization only emits reasons
  // this classifier knows -- so it is pinned at the module boundary instead.
  const degraded = diagnoseMergeGateAuthorization({
    storyId: STORY_ID,
    gateAuthorization: { allowed: false, source: 'none', reason: 'reason_added_after_this_story', gate_override: null },
    currentHeadSha: headSha
  });
  assert.equal(
    degraded.stop_reason,
    'gate_authorization_denied',
    'ac-1 S-005: an unrecognised authorization reason degrades without reacquiring gate_not_ready'
  );

  // Every stop reason in the taxonomy is asserted somewhere in the regression
  // suite; a reason nobody pins can silently change meaning.
  const suiteSources = await Promise.all([
    'test/merge-gate-diagnosis.test.js',
    'test/integration/story-vibepro-merge-gate-stop-reason-diagnosis.test.js',
    'test/e2e/story-vibepro-merge-gate-stop-reason-diagnosis-main.spec.js'
  ].map((relative) => readFile(path.join(root, relative), 'utf8')));
  // A comment or a fixture literal is not a regression pin: strip comments,
  // then require the reason on a line that is part of an assert call.
  const assertionLines = suiteSources
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .reduce((lines, line, index, all) => {
      const opensAssert = /(^|[^\w.])assert\b/.test(line);
      const continuesAssert = all
        .slice(Math.max(0, index - 4), index)
        .some((previous) => /(^|[^\w.])assert\b/.test(previous))
        && !/^\s*$/.test(line);
      if (opensAssert || continuesAssert) lines.push(line);
      return lines;
    }, [])
    .join('\n');
  const unpinned = [...MERGE_GATE_DIAGNOSIS_STOP_REASONS]
    .filter((reason) => !assertionLines.includes(`'${reason}'`));
  assert.deepEqual(unpinned, [], 'ac-8: every merge gate stop reason is pinned by a regression assertion');

  // Nothing otherwise binds the taxonomy to the public projection allow-list, so
  // a new cause would be silently collapsed to merge_reconciliation_required on
  // the public JSON surface while stop_reason itself passed through.
  const unprojectable = [...MERGE_GATE_DIAGNOSIS_STOP_REASONS]
    .filter((reason) => !PUBLIC_RECONCILIATION_REASONS.has(reason));
  assert.deepEqual(
    unprojectable,
    [],
    'ac-7: every merge gate stop reason survives the public reconciliation projection'
  );
});
