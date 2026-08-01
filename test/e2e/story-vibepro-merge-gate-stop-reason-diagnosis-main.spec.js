import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

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
  assert.equal(empty.exitCode, 2);
  assert.equal(empty.explained.gate_authorization_diagnosis.stop_reason, 'gate_evidence_missing');

  // State 2: pr prepare exists, PR not created yet.
  const firstHead = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  await writePrPrepare(prDir, firstHead);
  const prepared = await explain(repo, env);
  assert.equal(prepared.explained.gate_authorization_diagnosis.stop_reason, 'pr_create_artifact_missing');

  // State 3: PR created with an auditable noncritical waiver at this HEAD.
  await writePrCreate(prDir, firstHead);
  const created = await explain(repo, env);
  assert.equal(created.exitCode, 0);
  assert.equal(created.explained.gate_ready, true);
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
  assert.equal(advanced.explained.gate_authorization_diagnosis.stop_reason, 'pr_prepare_artifact_stale');
  assert.equal(advanced.explained.current_head_sha, secondHead);

  // State 5: pr prepare is re-run for the new HEAD but the PR body was not
  // re-created, so only the waiver is stale. This is the PR #406 state.
  await writePrPrepare(prDir, secondHead);
  const stalePrCreate = await explain(repo, env);
  assert.equal(stalePrCreate.explained.gate_authorization_diagnosis.stop_reason, 'pr_create_artifact_stale');
  assert.equal(
    stalePrCreate.explained.gate_authorization_diagnosis.artifact_bindings
      .find((binding) => binding.artifact === 'pr_prepare').status,
    'current'
  );

  // The same state through the real merge command persists the same cause.
  const merge = await cli(
    ['execute', 'merge', repo, '--story-id', STORY_ID, '--base', 'main', '--pr', '1', '--dry-run', '--json'],
    env
  );
  assert.equal(merge.exitCode, 2);
  assert.equal(JSON.parse(merge.stdout).stop_reason, 'pr_create_artifact_stale');
  const persisted = JSON.parse(await readFile(path.join(prDir, 'pr-merge.json'), 'utf8'));
  assert.equal(persisted.gate_authorization_diagnosis.cause, 'pr_create_artifact_stale');

  // State 6: the waiver is re-created at the new HEAD but no longer matches the
  // gate surface it claims to waive.
  await writePrCreate(prDir, secondHead);
  await writeFile(path.join(prDir, 'pr-create.json'), `${JSON.stringify({
    ...JSON.parse(await readFile(path.join(prDir, 'pr-create.json'), 'utf8')),
    gate_override: { ...WAIVER, unresolved_gates: [{ id: 'gate:some_other_gate' }] }
  }, null, 2)}\n`);
  const staleWaiver = await explain(repo, env);
  assert.equal(staleWaiver.explained.gate_authorization_diagnosis.stop_reason, 'gate_waiver_stale');

  // State 7: no waiver at all, with the gate DAG still not ready. This -- and
  // only this -- is gate_not_ready.
  await writeFile(path.join(prDir, 'pr-create.json'), `${JSON.stringify({
    ...JSON.parse(await readFile(path.join(prDir, 'pr-create.json'), 'utf8')),
    gate_override: undefined
  }, null, 2)}\n`);
  const noWaiver = await explain(repo, env);
  assert.equal(noWaiver.explained.gate_authorization_diagnosis.cause, 'gates_unresolved');
  assert.equal(noWaiver.explained.gate_authorization_diagnosis.stop_reason, 'gate_not_ready');
  assert.deepEqual(
    noWaiver.explained.gate_authorization_diagnosis.blocking_gates.map((gate) => gate.id),
    ['gate:validation_sequencing']
  );

  // No state in this replay reached the provider.
  const ghCalls = await readFile(ghCallLog, 'utf8').catch(() => '');
  assert.equal(ghCalls.includes('pr merge'), false);
});
