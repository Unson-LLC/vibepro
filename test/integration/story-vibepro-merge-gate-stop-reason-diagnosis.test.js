import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI_BIN = path.join(root, 'bin', 'vibepro.js');
const STORY_ID = 'story-merge-gate-diagnosis-integration';

// story-vibepro-merge-gate-stop-reason-diagnosis: the PR #406 landing state --
// every gate resolved, a valid noncritical waiver, but a pr-create artifact
// bound to an older commit -- has to reach the operator as the artifact-binding
// failure it is, on every output surface the operator actually reads: the
// process exit, the public JSON, the persisted pr-merge.json, and the
// pr-merge.html review surface.
async function makeMergeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-mgd-integration-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: repo });
  await writeFile(path.join(repo, '.gitignore'), '.vibepro/*\n!.vibepro/config.json\n');
  await execFileAsync(process.execPath, [
    CLI_BIN, 'init', repo,
    '--story-id', STORY_ID,
    '--title', 'merge gate diagnosis integration',
    '--view', 'dev',
    '--period', '2026-W31'
  ]);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.execution = { managed_worktree: 'disabled' };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await execFileAsync('git', ['add', '.'], { cwd: repo });
  await execFileAsync('git', ['commit', '-m', 'chore: fixture'], { cwd: repo });
  // Route the GitHub authority URL at a local bare repository so the merge path
  // resolves a parseable owner/repo without reaching the network.
  const remote = await mkdtemp(path.join(os.tmpdir(), 'vibepro-mgd-integration-remote-'));
  const authorityUrl = 'https://github.example.test/unson/vibepro.git';
  await execFileAsync('git', ['init', '--bare'], { cwd: remote });
  await execFileAsync('git', ['remote', 'add', 'origin', remote], { cwd: repo });
  await execFileAsync('git', ['push', '-u', 'origin', 'main'], { cwd: repo });
  await execFileAsync('git', ['config', `url.${remote}.insteadOf`, authorityUrl], { cwd: repo });
  await execFileAsync('git', ['remote', 'set-url', 'origin', authorityUrl], { cwd: repo });
  const headSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
  return { repo, headSha };
}

async function writeResolvedGatesWithStaleWaiver(repo, headSha, staleSha) {
  const prDir = path.join(repo, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'pr-prepare.json'), `${JSON.stringify({
    story: { story_id: STORY_ID, title: 'merge gate diagnosis integration' },
    gate_status: {
      overall_status: 'needs_verification',
      ready_for_pr_create: false,
      unresolved_gates: [{ id: 'gate:validation_sequencing' }],
      critical_unresolved_gates: []
    },
    pr_context: {
      gate_dag: {
        overall_status: 'needs_verification',
        nodes: [{ id: 'gate:validation_sequencing', required: true, status: 'needs_evidence' }]
      }
    },
    git: { base_ref: 'main', head_sha: headSha },
    artifact_freshness: {
      kind: 'pr_prepare', status: 'current', artifact_head_sha: headSha, current_head_sha: headSha
    }
  }, null, 2)}\n`);
  await writeFile(path.join(prDir, 'pr-create.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    mode: 'pr_create',
    dry_run: false,
    story: { story_id: STORY_ID, title: 'merge gate diagnosis integration' },
    gate_override: {
      allowed: true,
      waiver_policy: 'cli_reason',
      reason: 'noncritical waiver recorded when the PR was created',
      unresolved_gates: [{ id: 'gate:validation_sequencing' }],
      critical_unresolved_gates: []
    },
    base: 'main',
    pr_url: 'https://github.example.test/unson/vibepro/pull/1',
    current_head_sha: staleSha,
    artifact_freshness: {
      kind: 'pr_create', status: 'stale', artifact_head_sha: staleSha, current_head_sha: headSha
    }
  }, null, 2)}\n`);
  return prDir;
}

const NOT_READY_GATE_DAG = {
  overall_status: 'needs_verification',
  nodes: [{ id: 'gate:validation_sequencing', required: true, status: 'needs_evidence' }]
};

const NONCRITICAL_WAIVER = {
  allowed: true,
  waiver_policy: 'cli_reason',
  reason: 'noncritical waiver recorded when the PR was created',
  unresolved_gates: [{ id: 'gate:validation_sequencing' }],
  critical_unresolved_gates: []
};

const UNRESOLVED_GATE_STATUS = {
  overall_status: 'needs_verification',
  ready_for_pr_create: false,
  unresolved_gates: [{ id: 'gate:validation_sequencing' }],
  critical_unresolved_gates: []
};

function currentFreshness(kind, headSha) {
  return { kind, status: 'current', artifact_head_sha: headSha, current_head_sha: headSha };
}

async function makeRecordingGhBin() {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-mgd-integration-bin-'));
  const ghCallLog = path.join(binDir, 'gh-called.log');
  await writeFile(path.join(binDir, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(ghCallLog)}, process.argv.slice(2).join(' ') + '\\n');
process.exit(99);
`);
  await chmod(path.join(binDir, 'gh'), 0o755);
  return { binDir, ghCallLog };
}

async function runCli(args, { env } = {}) {
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

test('MGD-INT-1 a stale pr-create waiver reaches every merge output surface as an artifact-binding failure, not as gate_not_ready', async () => {
  const { repo, headSha } = await makeMergeRepo();
  const staleSha = '0'.repeat(40);
  const prDir = await writeResolvedGatesWithStaleWaiver(repo, headSha, staleSha);
  const { binDir, ghCallLog } = await makeRecordingGhBin();

  const result = await runCli(
    ['execute', 'merge', repo, '--story-id', STORY_ID, '--base', 'main', '--pr', '1', '--dry-run', '--json'],
    { env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` } }
  );

  assert.equal(result.exitCode, 2);
  await assert.rejects(() => readFile(ghCallLog, 'utf8'), { code: 'ENOENT' });

  // Public JSON projection: the new stop reason and the whole diagnosis survive
  // the projection that collapses warnings to one fixed sentence.
  const publicMerge = JSON.parse(result.stdout);
  assert.equal(publicMerge.stop_reason, 'pr_create_artifact_stale');
  assert.equal(publicMerge.preconditions.gate_ready, false);
  assert.equal(publicMerge.gate_authorization_diagnosis.cause, 'pr_create_artifact_stale');
  assert.equal(publicMerge.gate_authorization_diagnosis.authorization_reason, 'gate_override_not_allowed');
  assert.equal(
    publicMerge.gate_authorization_diagnosis.artifact_bindings
      .find((binding) => binding.artifact === 'pr_create').status,
    'stale'
  );
  assert.equal(
    publicMerge.gate_authorization_diagnosis.artifact_bindings
      .find((binding) => binding.artifact === 'pr_prepare').status,
    'current'
  );
  assert.ok(publicMerge.gate_authorization_diagnosis.next_actions.some((action) => action.includes('pr create')));

  // Persisted execution artifact.
  const artifact = JSON.parse(await readFile(path.join(prDir, 'pr-merge.json'), 'utf8'));
  assert.equal(artifact.stop_reason, 'pr_create_artifact_stale');
  assert.equal(artifact.gate_authorization_diagnosis.stop_reason, 'pr_create_artifact_stale');
  assert.equal(artifact.gate_authorization_diagnosis.artifact_bindings
    .find((binding) => binding.artifact === 'pr_create').artifact_head_sha, staleSha);

  // Review surface: the human-facing report names the cause and the binding.
  const html = await readFile(path.join(prDir, 'pr-merge.html'), 'utf8');
  assert.match(html, /Diagnosis cause/);
  assert.match(html, /pr_create_artifact_stale/);
  assert.match(html, /pr_create=stale/);
});

test('MGD-INT-2 execute merge --explain reports the same verdict read-only, and reports missing evidence as missing evidence', async () => {
  const { repo, headSha } = await makeMergeRepo();
  const staleSha = '0'.repeat(40);
  const prDir = await writeResolvedGatesWithStaleWaiver(repo, headSha, staleSha);
  const { binDir, ghCallLog } = await makeRecordingGhBin();
  const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` };

  const explain = await runCli(
    ['execute', 'merge', repo, '--story-id', STORY_ID, '--explain', '--json'],
    { env }
  );
  assert.equal(explain.exitCode, 2);
  const explained = JSON.parse(explain.stdout);
  assert.equal(explained.gate_ready, false);
  assert.equal(explained.gate_authorization_diagnosis.stop_reason, 'pr_create_artifact_stale');
  assert.equal(explained.current_head_sha, headSha);
  await assert.rejects(() => readFile(ghCallLog, 'utf8'), { code: 'ENOENT' });
  await assert.rejects(() => readFile(path.join(prDir, 'pr-merge.json'), 'utf8'), { code: 'ENOENT' });

  const human = await runCli(
    ['execute', 'merge', repo, '--story-id', STORY_ID, '--explain'],
    { env }
  );
  assert.equal(human.exitCode, 2);
  assert.match(human.stdout, /gate_diagnosis_cause: pr_create_artifact_stale/);
  assert.match(human.stdout, /pr_create: stale/);

  // Negative path: a story with no gate evidence at all must say so rather than
  // implying that gate evaluation ran and failed.
  const empty = await runCli(
    ['execute', 'merge', repo, '--story-id', 'story-merge-gate-diagnosis-absent', '--explain', '--json'],
    { env }
  );
  assert.equal(empty.exitCode, 2);
  const emptyExplained = JSON.parse(empty.stdout);
  assert.equal(emptyExplained.gate_authorization_diagnosis.cause, 'gate_evidence_missing');
  assert.equal(emptyExplained.gate_authorization_diagnosis.stop_reason, 'gate_evidence_missing');
  assert.deepEqual(
    emptyExplained.gate_authorization_diagnosis.artifact_bindings.map((binding) => binding.status),
    ['missing', 'missing', 'missing']
  );
  await assert.rejects(() => readFile(ghCallLog, 'utf8'), { code: 'ENOENT' });
});

test('MGD-INT-3 --explain and execute merge agree on an unparseable artifact: neither reports it authorized', async () => {
  const { repo, headSha } = await makeMergeRepo();
  const prDir = path.join(repo, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  // A state whose waiver WOULD authorize the merge, spoiled by a routed gate-dag
  // that cannot be parsed. buildMergeGateAuthorization treats it as absent.
  await writeFile(path.join(prDir, 'pr-prepare.json'), `${JSON.stringify({
    story: { story_id: STORY_ID },
    gate_status: UNRESOLVED_GATE_STATUS,
    pr_context: { gate_dag: NOT_READY_GATE_DAG },
    git: { base_ref: 'main', head_sha: headSha },
    artifact_freshness: currentFreshness('pr_prepare', headSha)
  }, null, 2)}\n`);
  await writeFile(path.join(prDir, 'pr-create.json'), `${JSON.stringify({
    story: { story_id: STORY_ID },
    gate_override: NONCRITICAL_WAIVER,
    pr_url: 'https://github.example.test/unson/vibepro/pull/1',
    current_head_sha: headSha,
    artifact_freshness: currentFreshness('pr_create', headSha)
  }, null, 2)}\n`);
  await writeFile(path.join(prDir, 'gate-dag.json'), '{ this is not json\n');

  const { binDir, ghCallLog } = await makeRecordingGhBin();
  const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` };

  const explained = await runCli(
    ['execute', 'merge', repo, '--story-id', STORY_ID, '--explain', '--json'],
    { env }
  );
  assert.equal(explained.exitCode, 2);
  const explain = JSON.parse(explained.stdout);
  assert.equal(explain.gate_ready, false);
  assert.equal(explain.gate_authorization_diagnosis.status, 'blocked');
  assert.equal(explain.gate_authorization_diagnosis.stop_reason, 'artifact_unreadable');
  assert.equal(
    explain.gate_authorization_diagnosis.artifact_bindings
      .find((binding) => binding.artifact === 'gate_dag').status,
    'unreadable'
  );

  // The real command fails closed on the same state rather than merging.
  const merged = await runCli(
    ['execute', 'merge', repo, '--story-id', STORY_ID, '--base', 'main', '--pr', '1', '--json'],
    { env }
  );
  assert.notEqual(merged.exitCode, 0);
  await assert.rejects(() => readFile(ghCallLog, 'utf8'), { code: 'ENOENT' });
});
