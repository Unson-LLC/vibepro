import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { JUDGMENT_RUN_ID_PATTERN } from '../src/judgment-run-authenticity.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-reject-nongenuine-judgment';

function silentIo() {
  return {
    stdout: { write() {} },
    stderr: { write() {} },
    env: { ...process.env }
  };
}

function capturingIo() {
  const stderrChunks = [];
  return {
    io: {
      stdout: { write() {} },
      stderr: { write(chunk) { stderrChunks.push(chunk); } },
      env: { ...process.env }
    },
    stderrText() {
      return stderrChunks.join('');
    }
  };
}

async function setupRepo(suffix) {
  const root = await mkdtemp(path.join(os.tmpdir(), `vibepro-genuine-judgment-${suffix}-`));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'index.js'), 'export const value = 1;\n');
  await execFileAsync('git', ['add', 'index.js'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initialize repository'], { cwd: root });
  const initialized = await runCli([
    'init', root,
    '--story-id', STORY_ID,
    '--title', 'Reject non-genuine judgment runs'
  ], silentIo());
  assert.equal(initialized.exitCode, 0);
  const applicability = await runCli([
    'judgment', 'applicability', 'record', root,
    '--id', STORY_ID,
    '--applicable', 'yes',
    '--reason', 'The fix can bind adoption to the prepared artifact or keep accepting hand-made input.',
    '--recorded-by', 'test-agent',
    '--json'
  ], silentIo());
  assert.equal(applicability.exitCode, 0);
  return root;
}

async function prepare(root) {
  const prepared = await runCli([
    'judgment', 'prepare', root,
    '--id', STORY_ID,
    '--json'
  ], silentIo());
  assert.equal(prepared.exitCode, 0, prepared.error ?? 'prepare failed');
  return prepared.result;
}

function adoptArgs(root, inputPath) {
  return [
    'judgment', 'input', 'adopt', root,
    '--id', STORY_ID,
    '--input', inputPath,
    '--reviewed-by', 'test-agent',
    '--authority', 'story-and-repository-evidence',
    '--summary', 'Reviewed the prepared judgment input.',
    '--json'
  ];
}

function evaluateArgs(root, inputPath) {
  return [
    'judgment', 'evaluate', root,
    '--id', STORY_ID,
    '--input', inputPath,
    '--json'
  ];
}

async function expectRefusal(args, pattern) {
  const captured = capturingIo();
  const result = await runCli(args, captured.io);
  assert.notEqual(result.exitCode, 0);
  assert.match(captured.stderrText(), pattern);
  return captured.stderrText();
}

async function makeActionable(root, artifact) {
  const absolute = path.join(root, artifact);
  const input = JSON.parse(await readFile(absolute, 'utf8'));
  input.problem_frame = {
    status: 'valid',
    statement: 'Adopt and evaluate accept judgment input that was not prepared by vibepro.',
    reason: 'brainbase-organization adoptions used hand-made run ids and source paths outside .vibepro.'
  };
  input.development_cycle.current_constraint = {
    kind: 'value_constraint',
    status: 'verified',
    statement: 'The prepared artifact is not bound to adoption.',
    source_refs: ['src/judgment-operations.js'],
    decision_evidence: {
      status: 'sufficient',
      reason: 'adoptJudgmentInput stores input.run_id without reading drafts/<runId>.json.',
      source_refs: ['src/judgment-operations.js']
    }
  };
  input.decision_profile = {
    materiality: 'medium',
    reversibility: 'easy',
    blast_radius: 'local'
  };
  input.options = [{
    id: 'option-bind-receipt',
    summary: 'Refuse adoption unless the draft receipt, run id, and .vibepro source match.',
    action: 'fix',
    addresses: [],
    violates: [],
    residual_risk: 'low'
  }];
  await writeFile(absolute, `${JSON.stringify(input, null, 2)}\n`);
  return absolute;
}

test('judgment prepare refuses public --run-id and accepts a generated genuine id', async () => {
  const root = await setupRepo('public-run-id');
  const refused = await expectRefusal([
    'judgment', 'prepare', root,
    '--id', STORY_ID,
    '--run-id', 'judgment-20260101000001-0a0a0a01',
    '--json'
  ], /refuses --run-id/);
  assert.match(refused, /VIBEPRO_ALLOW_JUDGMENT_RUN_ID/);

  const captured = capturingIo();
  captured.io.env = { ...process.env, VIBEPRO_ALLOW_JUDGMENT_RUN_ID: '1' };
  const bad = await runCli([
    'judgment', 'prepare', root,
    '--id', STORY_ID,
    '--run-id', 'judgment-20261014080730-operator',
    '--json'
  ], captured.io);
  assert.notEqual(bad.exitCode, 0);
  assert.match(captured.stderrText(), /not genuine/);

  const prepared = await prepare(root);
  assert.match(prepared.run_id, JUDGMENT_RUN_ID_PATTERN);
  assert.match(prepared.draft_receipt, new RegExp(`drafts/${prepared.run_id}\\.json$`));
  const receipt = JSON.parse(await readFile(path.join(root, prepared.draft_receipt), 'utf8'));
  assert.equal(receipt.run_id, prepared.run_id);
  assert.equal(receipt.artifact, prepared.artifact);
  assert.match(receipt.input_sha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.lineage_sha256, /^[a-f0-9]{64}$/);
});

test('adopt and evaluate refuse a missing receipt, a bad run id, an outside source, a hash mismatch, and an artifact mismatch', async () => {
  const root = await setupRepo('refusals');
  const prepared = await prepare(root);
  const artifact = path.join(root, prepared.artifact);
  const originalInput = await readFile(artifact, 'utf8');
  const originalReceipt = await readFile(path.join(root, prepared.draft_receipt), 'utf8');

  await rm(path.join(root, prepared.draft_receipt));
  await expectRefusal(adoptArgs(root, artifact), /draft receipt drafts\/.+ is missing/);
  await expectRefusal(evaluateArgs(root, artifact), /draft receipt drafts\/.+ is missing/);
  const restored = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    run_id: prepared.run_id,
    artifact: prepared.artifact,
    input_sha256: '0'.repeat(64),
    lineage_sha256: '1'.repeat(64),
    source_head_sha: prepared.source_head_sha,
    feedback: null,
    prepared_at: new Date().toISOString(),
    advisory: true,
    blocking: false
  };
  await mkdir(path.dirname(path.join(root, prepared.draft_receipt)), { recursive: true });
  await writeFile(path.join(root, prepared.draft_receipt), `${JSON.stringify(restored, null, 2)}\n`);

  const forgedId = JSON.parse(await readFile(artifact, 'utf8'));
  forgedId.run_id = 'judgment-20261014080730-operator';
  const forgedPath = path.join(root, '.vibepro', 'forged-run.json');
  await writeFile(forgedPath, `${JSON.stringify(forgedId, null, 2)}\n`);
  await expectRefusal(adoptArgs(root, forgedPath), /not genuine/);
  await expectRefusal(evaluateArgs(root, forgedPath), /not genuine/);

  const outsideDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-outside-judgment-'));
  const outsidePath = path.join(outsideDir, 'input.json');
  await writeFile(outsidePath, await readFile(artifact, 'utf8'));
  await expectRefusal(adoptArgs(root, outsidePath), /must stay inside \.vibepro/);
  await expectRefusal(evaluateArgs(root, outsidePath), /must stay inside \.vibepro/);

  const linkedPath = path.join(root, '.vibepro', 'linked-input.json');
  await symlink(outsidePath, linkedPath);
  await expectRefusal(adoptArgs(root, linkedPath), /must stay inside \.vibepro/);
  await expectRefusal(evaluateArgs(root, linkedPath), /must stay inside \.vibepro/);

  const changedGoal = JSON.parse(await readFile(artifact, 'utf8'));
  changedGoal.goal = { ...changedGoal.goal, statement: 'A different goal' };
  await writeFile(artifact, `${JSON.stringify(changedGoal, null, 2)}\n`);
  await expectRefusal(adoptArgs(root, artifact), /input hash does not match/);
  await expectRefusal(evaluateArgs(root, artifact), /input hash does not match/);
  await writeFile(artifact, originalInput);
  await writeFile(path.join(root, prepared.draft_receipt), originalReceipt);

  const copyPath = path.join(root, '.vibepro', 'copied-input.json');
  await writeFile(copyPath, await readFile(artifact, 'utf8'));
  await expectRefusal(adoptArgs(root, copyPath), /artifact .+ does not match the adopted input/);
  await expectRefusal(evaluateArgs(root, copyPath), /artifact .+ does not match the adopted input/);
});

test('a genuine prepare, evidence edit, adopt, and evaluate passes judgment audit', async () => {
  const root = await setupRepo('legitimate');
  const prepared = await prepare(root);
  assert.match(prepared.run_id, JUDGMENT_RUN_ID_PATTERN);
  const adoptedInput = await makeActionable(root, prepared.artifact);
  const adopted = await runCli(adoptArgs(root, adoptedInput), silentIo());
  assert.equal(adopted.exitCode, 0, adopted.error ?? 'adopt failed');
  assert.equal(adopted.result.adoption.source_input.startsWith('.vibepro/'), true);
  const receipt = JSON.parse(await readFile(path.join(root, prepared.draft_receipt), 'utf8'));
  assert.equal(receipt.input_sha256, adopted.result.adoption.input_sha256);

  const evaluated = await runCli([
    'judgment', 'evaluate', root,
    '--id', STORY_ID,
    '--input', adopted.result.adoption.adopted_input,
    '--json'
  ], silentIo());
  assert.equal(evaluated.exitCode, 0, evaluated.error ?? 'evaluate failed');
  assert.equal(evaluated.result.operational.actionable, true);
  assert.equal(evaluated.result.operational.recommendation, 'proceed');
  assert.ok(evaluated.result.operational.viable_options.some((option) => option.id === 'option-bind-receipt'));

  const outside = path.join(os.tmpdir(), `vibepro-eval-outside-${prepared.run_id}.json`);
  await writeFile(outside, await readFile(path.join(root, adopted.result.adoption.adopted_input), 'utf8'));
  await expectRefusal([
    'judgment', 'evaluate', root,
    '--id', STORY_ID,
    '--input', outside,
    '--json'
  ], /must stay inside \.vibepro/);

  const audit = await runCli(['judgment', 'audit', root, '--json'], silentIo());
  assert.equal(audit.exitCode, 0);
  assert.equal(audit.result.ok, true);
  assert.equal(audit.result.scanned, 1);

  const currentPath = path.join(root, adopted.result.adoption.artifact.replace(/judgment-[^/]+\.json$/, 'current.json'));
  const current = JSON.parse(await readFile(currentPath, 'utf8'));
  current.source_input = '../tmp/hand-made.json';
  current.run_id = 'judgment-20261014080730-operator';
  await writeFile(currentPath, `${JSON.stringify(current, null, 2)}\n`);
  const failed = await runCli(['judgment', 'audit', root, '--json'], silentIo());
  assert.notEqual(failed.exitCode, 0);
  assert.equal(failed.result.ok, false);
  const codes = failed.result.findings.flatMap((finding) => finding.issues.map((issue) => issue.code));
  assert.ok(codes.includes('run_id_format'));
  assert.ok(codes.includes('source_input_outside_vibepro'));
  assert.ok(codes.includes('receipt_missing') || codes.includes('artifact_mismatch') || codes.includes('input_hash_mismatch'));
});
