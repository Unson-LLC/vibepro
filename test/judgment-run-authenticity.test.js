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
import { JUDGMENT_TEST_ENV } from './support/judgment-test-env.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-reject-nongenuine-judgment';

function silentIo() {
  return {
    stdout: { write() {} },
    stderr: { write() {} },
    env: { ...process.env, ...JUDGMENT_TEST_ENV }
  };
}

function capturingIo() {
  const stderrChunks = [];
  return {
    io: {
      stdout: { write() {} },
      stderr: { write(chunk) { stderrChunks.push(chunk); } },
      env: { ...process.env, ...JUDGMENT_TEST_ENV }
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
    '--reviewed-by', 'agent:test-agent',
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
  captured.io.env = { ...process.env, ...JUDGMENT_TEST_ENV, VIBEPRO_ALLOW_JUDGMENT_RUN_ID: '1' };
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
  assert.match(receipt.receipt_hmac, /^[a-f0-9]{64}$/);
  assert.equal(receipt.pr_number, 573);
  assert.equal(receipt.source_head_sha, prepared.source_head_sha);
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
  await expectRefusal(adoptArgs(root, artifact), /Hand-made receipts are refused/);
  await writeFile(path.join(root, prepared.draft_receipt), originalReceipt);

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

test('a genuine prepare, unchanged adopt, and evaluate passes judgment audit', async () => {
  const root = await setupRepo('legitimate');
  const prepared = await prepare(root);
  assert.match(prepared.run_id, JUDGMENT_RUN_ID_PATTERN);
  const preparedReceipt = await readFile(path.join(root, prepared.draft_receipt), 'utf8');
  const adopted = await runCli(adoptArgs(root, path.join(root, prepared.artifact)), silentIo());
  assert.equal(adopted.exitCode, 0, adopted.error ?? 'adopt failed');
  assert.equal(adopted.result.adoption.source_input.startsWith('.vibepro/'), true);
  assert.deepEqual(adopted.result.adoption.reviewed_by, { kind: 'agent', id: 'test-agent' });
  assert.equal(adopted.result.adoption.pr_number, 573);
  const receipt = JSON.parse(await readFile(path.join(root, prepared.draft_receipt), 'utf8'));
  assert.equal(receipt.input_sha256, adopted.result.adoption.input_sha256);
  assert.match(adopted.result.adoption.adoption_hmac, /^[a-f0-9]{64}$/);
  assert.equal(await readFile(path.join(root, prepared.draft_receipt), 'utf8'), preparedReceipt);

  const evaluated = await runCli([
    'judgment', 'evaluate', root,
    '--id', STORY_ID,
    '--input', adopted.result.adoption.adopted_input,
    '--json'
  ], silentIo());
  assert.equal(evaluated.exitCode, 0, evaluated.error ?? 'evaluate failed');
  assert.equal(evaluated.result.operational.actionable, false);

  const outside = path.join(os.tmpdir(), `vibepro-eval-outside-${prepared.run_id}.json`);
  await writeFile(outside, await readFile(path.join(root, adopted.result.adoption.adopted_input), 'utf8'));
  await expectRefusal([
    'judgment', 'evaluate', root,
    '--id', STORY_ID,
    '--input', outside,
    '--json'
  ], /must stay inside \.vibepro/);

  const draftRel = prepared.draft_receipt;
  const runRel = draftRel.replace(/\/drafts\/([^/]+)\.json$/, '/runs/$1.json');
  const sourceRel = adopted.result.adoption.source_input;
  assert.equal(await readFile(path.join(root, draftRel), 'utf8').then(() => true), true);
  assert.equal(await readFile(path.join(root, runRel), 'utf8').then(() => true), true);
  const uncommitted = await runCli(['judgment', 'audit', root, '--json'], silentIo());
  assert.notEqual(uncommitted.exitCode, 0);
  const missingMessages = uncommitted.result.findings.flatMap((finding) => finding.issues
    .filter((issue) => issue.code === 'missing_from_committed_tree')
    .map((issue) => issue.message));
  for (const relative of [draftRel, runRel, sourceRel]) {
    assert.ok(missingMessages.some((message) => message.includes(relative)), missingMessages.join('\n'));
  }

  await execFileAsync('git', ['add', '-f', '--', draftRel, runRel, sourceRel], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'track judgment draft, run, and source input'], { cwd: root });
  const audit = await runCli(['judgment', 'audit', root, '--json'], silentIo());
  assert.equal(audit.exitCode, 0, JSON.stringify(audit.result?.findings ?? audit.error));
  assert.equal(audit.result.ok, true);
  assert.equal(audit.result.advisory, true);
  assert.equal(audit.result.blocking, false);
  assert.equal(audit.result.scanned, 1);

  const currentPath = path.join(root, adopted.result.adoption.artifact.replace(/judgment-[^/]+\.json$/, 'current.json'));
  const current = JSON.parse(await readFile(currentPath, 'utf8'));
  current.source_input = '../tmp/hand-made.json';
  current.run_id = 'judgment-20261014080730-operator';
  await writeFile(currentPath, `${JSON.stringify(current, null, 2)}\n`);
  const failed = await runCli(['judgment', 'audit', root, '--json'], silentIo());
  assert.notEqual(failed.exitCode, 0);
  assert.equal(failed.result.ok, false);
  assert.equal(failed.result.advisory, false);
  assert.equal(failed.result.blocking, true);
  const codes = failed.result.findings.flatMap((finding) => finding.issues.map((issue) => issue.code));
  assert.ok(codes.includes('run_id_format'));
  assert.ok(codes.includes('source_input_outside_vibepro'));
  assert.ok(codes.includes('receipt_missing') || codes.includes('artifact_mismatch') || codes.includes('input_hash_mismatch'));
});

test('prepare refuses a missing receipt key and audit reports blocking instead of advisory', async () => {
  const root = await setupRepo('missing-key');
  const missing = capturingIo();
  delete missing.io.env.VIBEPRO_JUDGMENT_RECEIPT_HMAC_KEY;
  const prepared = await runCli(['judgment', 'prepare', root, '--id', STORY_ID, '--json'], missing.io);
  assert.notEqual(prepared.exitCode, 0);
  assert.match(missing.stderrText(), /VIBEPRO_JUDGMENT_RECEIPT_HMAC_KEY/);
  assert.match(missing.stderrText(), /Infisical/);

  const stdout = [];
  const audit = await runCli(['judgment', 'audit', root], {
    stdout: { write(chunk) { stdout.push(chunk); } },
    stderr: { write() {} },
    env: missing.io.env
  });
  assert.equal(audit.exitCode, 1);
  assert.equal(audit.result.advisory, false);
  assert.equal(audit.result.blocking, true);
  assert.match(stdout.join(''), /Advisory: false\nBlocking: true/);
  assert.ok(audit.result.findings.some((finding) => finding.issues.some((issue) => issue.code === 'receipt_key_missing')));
});

test('adopt refuses a tampered signature, another PR, another head, a bare reviewer, and a rewritten input hash', async () => {
  const root = await setupRepo('receipt-binding');
  const prepared = await prepare(root);
  const artifact = path.join(root, prepared.artifact);
  const originalInput = await readFile(artifact, 'utf8');
  const receiptPath = path.join(root, prepared.draft_receipt);
  const originalReceiptText = await readFile(receiptPath, 'utf8');
  const originalReceipt = JSON.parse(originalReceiptText);

  const tampered = { ...originalReceipt, receipt_hmac: `${originalReceipt.receipt_hmac.slice(0, -1)}${originalReceipt.receipt_hmac.endsWith('a') ? 'b' : 'a'}` };
  await writeFile(receiptPath, `${JSON.stringify(tampered, null, 2)}\n`);
  await expectRefusal(adoptArgs(root, artifact), /signature is not valid/);
  await expectRefusal(evaluateArgs(root, artifact), /signature is not valid/);
  await writeFile(receiptPath, originalReceiptText);

  const otherPr = capturingIo();
  otherPr.io.env = { ...otherPr.io.env, VIBEPRO_JUDGMENT_PR_NUMBER: '574' };
  const otherPrAdopt = await runCli(adoptArgs(root, artifact), otherPr.io);
  assert.notEqual(otherPrAdopt.exitCode, 0);
  assert.match(otherPr.stderrText(), /cannot be used on PR 574/);

  await execFileAsync('git', ['commit', '--allow-empty', '-m', 'move head'], { cwd: root });
  await expectRefusal(adoptArgs(root, artifact), /cannot be used at head/);
  const afterHead = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(afterHead.input_sha256, originalReceipt.input_sha256);
  assert.equal(afterHead.receipt_hmac, originalReceipt.receipt_hmac);
  assert.equal(afterHead.source_head_sha, originalReceipt.source_head_sha);
  await execFileAsync('git', ['reset', '--hard', 'HEAD~1'], { cwd: root });

  const bare = adoptArgs(root, artifact);
  bare[bare.indexOf('agent:test-agent')] = 'DevDirector';
  await expectRefusal(bare, /human:<id> or agent:<id>/);

  const edited = JSON.parse(await readFile(artifact, 'utf8'));
  edited.problem_frame = { ...edited.problem_frame, statement: 'Edited after prepare' };
  await writeFile(artifact, `${JSON.stringify(edited, null, 2)}\n`);
  await expectRefusal(adoptArgs(root, artifact), /does not overwrite it/);
  const afterEdit = await readFile(receiptPath, 'utf8');
  assert.equal(afterEdit, originalReceiptText);

  await writeFile(artifact, originalInput);
  for (const [field, value] of [['prepared_at', '2020-01-01T00:00:00.000Z'], ['advisory', false], ['blocking', true]]) {
    const shifted = { ...originalReceipt, [field]: value };
    await writeFile(receiptPath, `${JSON.stringify(shifted, null, 2)}\n`);
    await expectRefusal(adoptArgs(root, artifact), /signature is not valid/);
  }
  await writeFile(receiptPath, originalReceiptText);
});

test('audit refuses an adoption whose reviewed_by was rewritten', async () => {
  const root = await setupRepo('adoption-mac');
  const prepared = await prepare(root);
  const adopted = await runCli(adoptArgs(root, path.join(root, prepared.artifact)), silentIo());
  assert.equal(adopted.exitCode, 0, adopted.error ?? 'adopt failed');
  assert.match(adopted.result.adoption.adoption_hmac, /^[a-f0-9]{64}$/);
  const draftRel = prepared.draft_receipt;
  const runRel = draftRel.replace(/\/drafts\/([^/]+)\.json$/, '/runs/$1.json');
  const sourceRel = adopted.result.adoption.source_input;
  await runCli([
    'judgment', 'evaluate', root,
    '--id', STORY_ID,
    '--input', adopted.result.adoption.adopted_input,
    '--json'
  ], silentIo());
  await execFileAsync('git', ['add', '-f', '--', draftRel, runRel, sourceRel], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'track judgment evidence'], { cwd: root });

  const currentPath = path.join(root, adopted.result.adoption.artifact.replace(/judgment-[^/]+\.json$/, 'current.json'));
  const current = JSON.parse(await readFile(currentPath, 'utf8'));
  current.reviewed_by = { kind: 'human', id: 'forged-reviewer' };
  await writeFile(currentPath, `${JSON.stringify(current, null, 2)}\n`);
  const failed = await runCli(['judgment', 'audit', root, '--json'], silentIo());
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.result.advisory, false);
  assert.equal(failed.result.blocking, true);
  const codes = failed.result.findings.flatMap((finding) => finding.issues.map((issue) => issue.code));
  assert.ok(codes.includes('adoption_signature_invalid'), codes.join(','));
});

test('prepare refuses a receipt key shorter than 32 characters', async () => {
  const root = await setupRepo('short-key');
  const short = capturingIo();
  short.io.env = { ...short.io.env, VIBEPRO_JUDGMENT_RECEIPT_HMAC_KEY: 'short-test-key-31-chars-xxxxxxx' };
  const prepared = await runCli(['judgment', 'prepare', root, '--id', STORY_ID, '--json'], short.io);
  assert.notEqual(prepared.exitCode, 0);
  assert.match(short.stderrText(), /at least 32 characters/);
  assert.doesNotMatch(short.stderrText(), /short-test-key/);
});
