import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { getMultiTenantApplicabilityAuditPath } from '../src/multi-tenant-applicability-audit.js';
import { writePreSpecReadiness } from '../src/spec-store.js';
import { validateSpec } from '../src/spec-validator.js';
import { runCli } from '../src/cli.js';

function minimalSpec(storyId, multiTenancy) {
  return {
    schema_version: '0.1.0',
    story_id: storyId,
    clauses: [{
      id: 'LOCAL-1',
      type: 'scenario',
      statement: 'ローカルCLIの表示色を変更する。',
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
  const record = JSON.parse(lines.at(-1));
  assert.equal(record.story_id, storyId);
  assert.equal(record.accepted, true);
  assert.equal(record.reason, spec.multi_tenancy.reason);
  assert.equal(record.evidence_ref, spec.multi_tenancy.evidence_ref);
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

test('strong multi-tenant signals refuse reasoned not_applicable', async () => {
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

test('spec write --final accepts reasoned not_applicable from spec multi_tenancy block', async () => {
  const storyId = 'story-cli-reasoned-na';
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-cli-reasoned-na-'));
  await seedRepo(repo, storyId);
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
  assert.ok(auditLines.length >= 1);
  const record = JSON.parse(auditLines.at(-1));
  assert.equal(record.story_id, storyId);
  assert.equal(record.accepted, true);
});
