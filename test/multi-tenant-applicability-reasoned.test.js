import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { promisify } from 'node:util';

import { getMultiTenantApplicabilityAuditPath, buildMultiTenantApplicabilityAuditDedupKey } from '../src/multi-tenant-applicability-audit.js';
import { isPlausibleMultiTenantEvidenceRef } from '../src/multi-tenant-architecture.js';
import { writeInferredSpec, writePreSpecReadiness } from '../src/spec-store.js';
import { validateSpec } from '../src/spec-validator.js';
import { runCli } from '../src/cli.js';
import { resolvePrArtifactFile } from '../src/artifact-routing.js';

const execFileAsync = promisify(execFile);

function minimalSpec(storyId, multiTenancy, clauseOverrides = {}) {
  return {
    schema_version: '0.1.0',
    story_id: storyId,
    clauses: [{
      id: 'LOCAL-1',
      type: 'scenario',
      statement: clauseOverrides.statement ?? 'ローカルCLIの表示色を変更する。',
      origin: { code_refs: [{ file: 'cli.js', anchor: 'color' }] }
    }],
    multi_tenancy: multiTenancy
  };
}

async function seedRepo(repo, storyId) {
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'cli.js'), 'export const color = "blue";\n');
  await writeFile(
    path.join(repo, 'docs', 'management', 'stories', 'active', `${storyId}.md`),
    `---\nstory_id: ${storyId}\n---\n単一利用者向けローカルCLIの表示色を変更する。\n`
  );
}

async function initGit(repo) {
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: repo });
  await execFileAsync('git', ['add', '.'], { cwd: repo });
  await execFileAsync('git', ['commit', '-m', 'chore: bootstrap'], { cwd: repo });
}

test('isPlausibleMultiTenantEvidenceRef accepts and rejects expected shapes', () => {
  for (const rejected of [
    'x', 'n/a', 'N/A', 'none', '///', '/', '../..', 'http://', 'https://', '-/-', 'a.b', 'x-y', 'na', 'tbd'
  ]) {
    assert.equal(isPlausibleMultiTenantEvidenceRef(rejected), false, `expected reject: ${rejected}`);
  }
  assert.equal(isPlausibleMultiTenantEvidenceRef('docs/x.md'), true);
  assert.equal(
    isPlausibleMultiTenantEvidenceRef('https://github.com/owner/repo/blob/main/docs/x.md'),
    true
  );
  assert.equal(isPlausibleMultiTenantEvidenceRef('ADR-012'), true);
});

test('reasoned not_applicable declaration passes spec validation in final mode', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-reasoned-na-'));
  const storyId = 'story-reasoned-na-ok';
  await writeFile(path.join(repo, 'cli.js'), 'export const color = "blue";\n');
  const storyContext = '単一利用者向けローカルCLIの表示色を変更する。';
  const spec = minimalSpec(storyId, {
    applicability: 'not_applicable',
    reason: '単一利用者ローカルCLIの表示変更でありテナント境界は存在しない',
    evidence_ref: 'docs/management/stories/active/story-reasoned-na-ok.md'
  });

  const result = await validateSpec(repo, spec, { mode: 'final', storyContext });
  assert.equal(result.ok, true);
  assert.equal(result.multi_tenant_architecture.implementation_readiness.status, 'ready');
  assert.equal(result.multi_tenant_architecture.implementation_readiness.evidence_status, 'reasoned_declaration');

  const auditPath = getMultiTenantApplicabilityAuditPath(repo);
  const lines = (await readFile(auditPath, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.story_id, storyId);
  assert.equal(record.accepted, true);
  assert.equal(record.reason, spec.multi_tenancy.reason);
  assert.equal(record.evidence_ref, spec.multi_tenancy.evidence_ref);
});

test('draft mode does not write applicability audit records', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-reasoned-na-draft-'));
  const storyId = 'story-reasoned-na-draft';
  const storyContext = '単一利用者向けローカルCLIの表示色を変更する。';
  const spec = minimalSpec(storyId, {
    applicability: 'not_applicable',
    reason: 'out of scope',
    evidence_ref: 'docs/example.md'
  });
  await validateSpec(repo, spec, { mode: 'draft', storyContext });
  await assert.rejects(
    () => access(getMultiTenantApplicabilityAuditPath(repo)),
    (error) => error.code === 'ENOENT'
  );
});

test('duplicate final validations append only one audit line per commit', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-reasoned-na-dedup-'));
  const storyId = 'story-reasoned-na-dedup';
  const storyContext = '単一利用者向けローカルCLIの表示色を変更する。';
  const spec = minimalSpec(storyId, {
    applicability: 'not_applicable',
    reason: 'no tenant boundary',
    evidence_ref: 'docs/example.md'
  });
  const head = 'b'.repeat(40);
  const options = { mode: 'final', storyContext, headCommit: head };
  await validateSpec(repo, spec, options);
  await validateSpec(repo, spec, options);
  const lines = (await readFile(getMultiTenantApplicabilityAuditPath(repo), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).head_commit, head);

  await validateSpec(repo, spec, { ...options, headCommit: 'c'.repeat(40) });
  const linesAfterHeadChange = (await readFile(getMultiTenantApplicabilityAuditPath(repo), 'utf8')).trim().split('\n');
  assert.equal(linesAfterHeadChange.length, 2);
});

test('distinct refusal reasons for the same spec each produce an audit line', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-reasoned-na-refusal-dedup-'));
  const storyId = 'story-reasoned-na-refusal-dedup';
  const spec = minimalSpec(storyId, {
    applicability: 'not_applicable',
    reason: 'claimed out of scope',
    evidence_ref: 'docs/example.md'
  });
  const head = 'd'.repeat(40);
  await validateSpec(repo, spec, {
    mode: 'final',
    storyContext: 'tenant_idをcross-tenant境界で分離する。',
    headCommit: head
  });
  await validateSpec(repo, spec, { mode: 'final', storyContext: '', headCommit: head });
  const lines = (await readFile(getMultiTenantApplicabilityAuditPath(repo), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 2);
  const refusalReasons = lines.map((line) => JSON.parse(line).refusal_reason);
  assert.ok(refusalReasons.includes('strong_signal_present'));
  assert.ok(refusalReasons.includes('story_missing'));
  assert.notEqual(
    buildMultiTenantApplicabilityAuditDedupKey(JSON.parse(lines[0])),
    buildMultiTenantApplicabilityAuditDedupKey(JSON.parse(lines[1]))
  );
});

test('empty reason refuses reasoned not_applicable and writes audit', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-reasoned-na-empty-'));
  const storyId = 'story-reasoned-na-empty';
  const storyContext = '単一利用者向けローカルCLIの表示色を変更する。';
  const spec = minimalSpec(storyId, {
    applicability: 'not_applicable',
    reason: '   ',
    evidence_ref: 'docs/example.md'
  });

  const result = await validateSpec(repo, spec, { mode: 'final', storyContext });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'multi_tenant_applicability_reason_required'));

  const record = JSON.parse((await readFile(getMultiTenantApplicabilityAuditPath(repo), 'utf8')).trim());
  assert.equal(record.accepted, false);
  assert.equal(record.refusal_reason, 'reason_required');
});

test('invalid evidence_ref format is refused', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-reasoned-na-bad-ref-'));
  const storyId = 'story-reasoned-na-bad-ref';
  const storyContext = '単一利用者向けローカルCLIの表示色を変更する。';
  const spec = minimalSpec(storyId, {
    applicability: 'not_applicable',
    reason: 'no tenant boundary in this change',
    evidence_ref: 'x'
  });
  const result = await validateSpec(repo, spec, { mode: 'final', storyContext });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'multi_tenant_applicability_evidence_ref_invalid'));
});

test('strong multi-tenant signals in Story refuse reasoned not_applicable', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-reasoned-na-strong-'));
  const storyId = 'story-reasoned-na-strong';
  const storyContext = '複数テナントのqueueとcredential境界をtenant_idで分離する。';
  const spec = minimalSpec(storyId, {
    applicability: 'not_applicable',
    reason: 'out of scope for this sprint',
    evidence_ref: 'docs/example.md'
  });

  const result = await validateSpec(repo, spec, { mode: 'final', storyContext });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'multi_tenant_applicability_strong_signal_conflict'));

  const record = JSON.parse((await readFile(getMultiTenantApplicabilityAuditPath(repo), 'utf8')).trim());
  assert.equal(record.accepted, false);
  assert.equal(record.refusal_reason, 'strong_signal_present');
  assert.ok(record.strong_signals.length > 0);
});

test('strong multi-tenant signals in spec clauses refuse reasoned not_applicable', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-reasoned-na-clause-'));
  const storyId = 'story-reasoned-na-clause';
  const storyContext = '単一利用者向けローカルCLIの表示色を変更する。';
  const spec = minimalSpec(storyId, {
    applicability: 'not_applicable',
    reason: 'claimed out of scope',
    evidence_ref: 'docs/example.md'
  }, {
    statement: 'separate cross-tenant credential boundaries with tenant_id propagation.'
  });

  const result = await validateSpec(repo, spec, { mode: 'final', storyContext });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'multi_tenant_applicability_strong_signal_conflict'));
});

test('validateSpec without storyContext refuses reasoned not_applicable fail-safe', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-reasoned-na-no-arg-'));
  const storyId = 'story-reasoned-na-no-arg';
  const spec = minimalSpec(storyId, {
    applicability: 'not_applicable',
    reason: 'no tenant boundary',
    evidence_ref: 'docs/example.md'
  });
  const result = await validateSpec(repo, spec, { mode: 'final' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'multi_tenant_applicability_story_missing'));
});

test('strong signals in clause semantic_contract refuse reasoned not_applicable', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-reasoned-na-semantic-'));
  const storyId = 'story-reasoned-na-semantic';
  const storyContext = '単一利用者向けローカルCLIの表示色を変更する。';
  const spec = minimalSpec(storyId, {
    applicability: 'not_applicable',
    reason: 'claimed out of scope',
    evidence_ref: 'docs/example.md'
  });
  spec.clauses[0].statement = 'Update CLI colors only.';
  spec.clauses[0].semantic_contract = {
    summary: 'cross-tenant credential isolation via tenant_id'
  };

  const result = await validateSpec(repo, spec, { mode: 'final', storyContext });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'multi_tenant_applicability_strong_signal_conflict'));
});

test('missing Story (empty storyContext) refuses reasoned not_applicable fail-safe', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-reasoned-na-no-story-'));
  const storyId = 'story-reasoned-na-no-story';
  const spec = minimalSpec(storyId, {
    applicability: 'not_applicable',
    reason: 'no tenant boundary',
    evidence_ref: 'docs/example.md'
  });
  spec.story_context = '単一利用者向けローカルCLIの表示色を変更する。';

  const result = await validateSpec(repo, spec, { mode: 'final', storyContext: '' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'multi_tenant_applicability_story_missing'));
});

test('spec write --final accepts reasoned not_applicable from spec multi_tenancy block', async () => {
  const storyId = 'story-cli-reasoned-na';
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-cli-reasoned-na-'));
  await seedRepo(repo, storyId);
  await initGit(repo);
  await runCli(['init', repo, '--story-id', storyId, '--title', 'local cli color']);
  await writePreSpecReadiness(repo, storyId, {
    schema_version: '0.1.0',
    story_id: storyId,
    created_at: new Date().toISOString(),
    status: 'ready',
    git: { head_sha: null },
    checks: [
      { id: 'story_selected', status: 'pass', reason: 'test story exists' },
      { id: 'graphify_context', status: 'pass', reason: 'test graph context exists' },
      { id: 'story_diagnosis', status: 'pass', reason: 'test diagnosis exists' },
      { id: 'architecture_check', status: 'pass', reason: 'test architecture check exists' },
      { id: 'engineering_judgment', status: 'pass', reason: 'test engineering judgment exists' }
    ]
  });

  const spec = JSON.stringify(minimalSpec(storyId, {
    applicability: 'not_applicable',
    reason: 'ローカルCLIの配色のみでマルチテナント境界は該当しない',
    evidence_ref: `docs/management/stories/active/${storyId}.md`
  }));

  let stdout = '';
  const result = await runCli(
    ['spec', 'write', repo, '--id', storyId, '--from-stdin', '--final', '--caller', 'test'],
    {
      stdin: Readable.from([spec]),
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: () => {} }
    }
  );
  const output = JSON.parse(stdout);
  assert.equal(result.exitCode, 0);
  assert.equal(output.ok, true);
  assert.equal(output.multi_tenant_architecture.implementation_readiness.status, 'ready');

  const auditLines = (await readFile(getMultiTenantApplicabilityAuditPath(repo), 'utf8')).trim().split('\n');
  assert.equal(auditLines.length, 1);
  const record = JSON.parse(auditLines[0]);
  assert.equal(record.story_id, storyId);
  assert.equal(record.accepted, true);
  assert.match(record.head_commit ?? '', /^[0-9a-f]{40}$/i);
});

test('pr prepare records reasoned declaration in pr-prepare.json and pr-body.md', async () => {
  const storyId = 'story-pr-reasoned-declaration';
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-pr-reasoned-decl-'));
  await seedRepo(repo, storyId);
  await initGit(repo);
  await runCli(['init', repo, '--story-id', storyId, '--title', 'reasoned declaration pr']);
  await writeInferredSpec(repo, storyId, {
    schema_version: '0.1.0',
    story_id: storyId,
    generated_at: new Date().toISOString(),
    clauses: [{
      id: 'LOCAL-1',
      type: 'scenario',
      statement: 'ローカルCLIの表示色を変更する。',
      origin: { code_refs: [{ file: 'cli.js', anchor: 'color' }] }
    }],
    multi_tenancy: {
      applicability: 'not_applicable',
      reason: 'ローカルCLI配色のみでテナント境界は該当しない',
      evidence_ref: `docs/management/stories/active/${storyId}.md`
    }
  });

  const prepare = await runCli(['pr', 'prepare', repo, '--story-id', storyId, '--base', 'main']);
  assert.equal(prepare.exitCode, 0);

  const jsonPath = await resolvePrArtifactFile(repo, storyId, 'pr-prepare.json');
  const preparation = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.ok(preparation.multi_tenant_non_applicability_declaration);
  assert.equal(preparation.multi_tenant_non_applicability_declaration.verdict, 'accepted');
  assert.equal(preparation.multi_tenant_non_applicability_declaration.spec_id, storyId);
  assert.ok(preparation.multi_tenant_non_applicability_declaration.head_commit);

  const bodyPath = await resolvePrArtifactFile(repo, storyId, 'pr-body.md');
  const body = await readFile(bodyPath, 'utf8');
  assert.match(body, /reasoned non-applicability declaration/);
  assert.match(body, /ローカルCLI配色のみでテナント境界は該当しない/);
  assert.match(body, new RegExp(preparation.multi_tenant_non_applicability_declaration.head_commit));
});
