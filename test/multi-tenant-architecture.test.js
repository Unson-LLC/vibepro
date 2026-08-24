import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  assessMultiTenantArchitecture,
  detectMultiTenantApplicability,
  projectMultiTenantViews
} from '../src/multi-tenant-architecture.js';
import { validateSpec } from '../src/spec-validator.js';
import { runCli } from '../src/cli.js';

const fixtureRoot = path.join(import.meta.dirname, 'fixtures', 'multi-tenant-architecture');

async function fixture(name) {
  return JSON.parse(await readFile(path.join(fixtureRoot, `${name}.json`), 'utf8'));
}

test('Story固有の境界シグナルがある場合だけmulti-tenant契約を有効化する', () => {
  const active = detectMultiTenantApplicability(`
    複数テナントで共有するジョブキューへ tenant_id を伝播し、
    テナント別credentialとstorage境界を強制する。
  `);
  assert.equal(active.applicable, true);
  assert.ok(active.reasons.length > 0);

  const copyOnly = detectMultiTenantApplicability('設定画面の説明文へ「テナント」という語を追加するだけ。');
  assert.equal(copyOnly.applicable, false);

  const localCli = detectMultiTenantApplicability('単一利用者向けローカルCLIの色とヘルプ文を変更する。');
  assert.equal(localCli.applicable, false);

  const conflictingOverride = detectMultiTenantApplicability(
    'tenant_idでcross-tenant storage境界を分離する。',
    { explicit: false }
  );
  assert.equal(conflictingOverride.applicable, true);
  assert.ok(conflictingOverride.reasons.includes('explicit_non_applicability_conflict'));
});

test('明示的な非該当は弱い語に上書きされず、fresh exact-HEAD caller evidenceだけが実装readyになる', () => {
  const contract = { applicability: 'not_applicable' };
  const storyText = 'account設定の表示順を変更する。';
  const expectedHeadCommit = 'a'.repeat(40);
  const freshEvidence = {
    source: 'caller',
    status: 'verified',
    head_commit: expectedHeadCommit,
    required_surfaces: ['story', 'spec', 'implementation'],
    verified_surfaces: ['story', 'spec', 'implementation']
  };

  const ready = assessMultiTenantArchitecture({
    storyText,
    contract,
    applicabilityEvidence: freshEvidence,
    expectedHeadCommit
  });
  assert.equal(ready.status, 'not_applicable');
  assert.equal(ready.implementation_readiness.status, 'ready');

  for (const [label, applicabilityEvidence] of [
    ['missing', null],
    ['stale', { ...freshEvidence, status: 'stale' }],
    ['wrong-head', { ...freshEvidence, head_commit: 'b'.repeat(40) }],
    ['self-asserted', { ...freshEvidence, source: 'contract' }],
    ['missing-surface', { ...freshEvidence, verified_surfaces: ['story', 'spec'] }]
  ]) {
    const report = assessMultiTenantArchitecture({ storyText, contract, applicabilityEvidence, expectedHeadCommit });
    assert.equal(report.status, 'not_applicable', label);
    assert.equal(report.implementation_readiness.status, 'needs_review', label);
  }
});

test('strong signalと不正なcaller projectionは非該当宣言でもfail closedになる', () => {
  const expectedHeadCommit = 'a'.repeat(40);
  const strong = assessMultiTenantArchitecture({
    storyText: 'tenant_idでcross-tenant storage境界を分離する。',
    contract: { applicability: 'not_applicable' },
    applicabilityEvidence: {
      source: 'caller', status: 'verified', head_commit: expectedHeadCommit,
      required_surfaces: ['story'], verified_surfaces: ['story']
    },
    expectedHeadCommit
  });
  assert.equal(strong.status, 'invalid');
  assert.ok(strong.findings.some((finding) => finding.code === 'applicability_evidence_inconsistent'));
});

test('共有・専用・顧客管理の代表契約をreadyと判定して6ビューへ投影する', async () => {
  for (const name of ['pooled', 'dedicated', 'customer-managed']) {
    const contract = await fixture(name);
    const report = assessMultiTenantArchitecture({
      storyText: '複数テナントの実行・credential・storage境界を定義する。',
      contract,
      mode: 'final'
    });
    assert.equal(report.status, 'ready', `${name}: ${JSON.stringify(report.findings)}`);
    assert.equal(report.findings.length, 0);
    assert.deepEqual(Object.keys(report.views), [
      'system_context',
      'tenant_resolution',
      'trust_data_boundary',
      'runtime_execution',
      'deployment_variants',
      'migration_rollback'
    ]);
  }
});

test('queue伝播欠落とglobal credential fallbackを不合格にする', async () => {
  const contract = await fixture('pooled');
  contract.propagation.verified_surfaces = ['http', 'storage', 'tool', 'memory'];
  contract.credentials.cross_tenant_fallback = 'allowed';

  const report = assessMultiTenantArchitecture({
    storyText: 'tenant_idをHTTPからqueue jobへ伝播する。',
    contract,
    mode: 'final'
  });

  assert.equal(report.status, 'invalid');
  assert.ok(report.findings.some((finding) => finding.code === 'tenant_propagation_unverified' && finding.path.includes('queue')));
  assert.ok(report.findings.some((finding) => finding.code === 'cross_tenant_credential_fallback'));
});

test('資源とcredentialがcanonical tenant keyからずれた契約を不合格にする', async () => {
  const contract = await fixture('pooled');
  contract.resources[0].tenant_key = 'workspace_id';
  contract.credentials.lookup_key = 'account_id';

  const report = assessMultiTenantArchitecture({
    storyText: 'tenant_idで資源とcredentialを分離する。',
    contract,
    mode: 'final'
  });

  assert.equal(report.status, 'invalid');
  assert.ok(report.findings.some((finding) => finding.code === 'tenant_resource_key_mismatch'));
  assert.ok(report.findings.some((finding) => finding.code === 'credential_lookup_key_mismatch'));
});

test('検査範囲が不明なら契約を合格にせずneeds_reviewにする', async () => {
  const contract = await fixture('dedicated');
  contract.verification.scanner_coverage = 'unknown';

  const report = assessMultiTenantArchitecture({
    storyText: 'テナントごとの専用runtimeとdatabaseを配備する。',
    contract,
    mode: 'final'
  });

  assert.equal(report.status, 'needs_review');
  assert.ok(report.findings.some((finding) => finding.code === 'scanner_coverage_unknown'));
});

test('最終Specは不足契約を拒否し、下書きは同じ不足を警告として保存できる', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-tenant-spec-'));
  await writeFile(path.join(repo, 'implementation.js'), 'export const tenantKey = "tenant_id";\n');
  await writeFile(path.join(repo, 'implementation.test.js'), 'test("tenant boundary", () => {});\n');
  const spec = {
    schema_version: '0.1.0',
    story_id: 'story-tenant-boundary',
    clauses: [{
      id: 'TENANT-1',
      type: 'contract',
      statement: 'tenant_idを全実行境界へ伝播する。',
      origin: {
        code_refs: [{ file: 'implementation.js', anchor: 'tenantKey' }],
        test_refs: [{ file: 'implementation.test.js' }]
      }
    }],
    multi_tenancy: {
      schema_version: '0.1.0',
      tenancy_model: 'pooled'
    }
  };
  const storyContext = '複数テナントのqueue、credential、storage境界をtenant_idで分離する。';

  const finalResult = await validateSpec(repo, spec, { mode: 'final', storyContext });
  assert.equal(finalResult.ok, false);
  assert.equal(finalResult.multi_tenant_architecture.status, 'invalid');
  assert.ok(finalResult.errors.some((error) => error.code.startsWith('multi_tenant_')));

  const draftResult = await validateSpec(repo, spec, { mode: 'draft', storyContext });
  assert.equal(draftResult.ok, true);
  assert.equal(draftResult.multi_tenant_architecture.status, 'invalid');
  assert.ok(draftResult.warnings.some((warning) => warning.code.startsWith('multi_tenant_')));
});

test('非該当Storyはmulti_tenancy契約なしでSpecを検証できる', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-local-spec-'));
  await writeFile(path.join(repo, 'cli.js'), 'export const color = "blue";\n');
  const result = await validateSpec(repo, {
    schema_version: '0.1.0',
    story_id: 'story-local-cli-copy',
    clauses: [{
      id: 'COPY-1',
      type: 'scenario',
      statement: 'ローカルCLIの表示色を変更する。',
      origin: { code_refs: [{ file: 'cli.js', anchor: 'color' }] }
    }]
  }, { mode: 'final', storyContext: '単一利用者向けローカルCLIの表示色を変更する。' });

  assert.equal(result.ok, true);
  assert.equal(result.multi_tenant_architecture.status, 'not_applicable');
  assert.deepEqual(projectMultiTenantViews(null), {});
});

test('spec writeはStory本文を読み、finalを拒否してdraftへ警告を保存する', async () => {
  const storyId = 'story-cli-tenant-boundary';
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-tenant-cli-'));
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'implementation.js'), 'export const tenantKey = "tenant_id";\n');
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', `${storyId}.md`), `---\nstory_id: ${storyId}\n---\n複数テナントのqueueとcredential境界をtenant_idで分離する。\n`);
  await runCli(['init', repo, '--story-id', storyId, '--title', 'tenant boundary']);
  const spec = JSON.stringify({
    schema_version: '0.1.0',
    story_id: storyId,
    clauses: [{
      id: 'TENANT-1',
      type: 'contract',
      statement: 'tenant_idを実行境界へ伝播する。',
      origin: { code_refs: [{ file: 'implementation.js', anchor: 'tenantKey' }] }
    }],
    multi_tenancy: { schema_version: '0.1.0', tenancy_model: 'pooled' }
  });
  const invoke = async (mode) => {
    let stdout = '';
    const result = await runCli(
      ['spec', 'write', repo, '--id', storyId, '--from-stdin', mode, '--caller', 'test'],
      {
        stdin: Readable.from([spec]),
        stdout: { write: (text) => { stdout += text; } },
        stderr: { write: () => {} }
      }
    );
    return { result, output: JSON.parse(stdout) };
  };

  const finalWrite = await invoke('--final');
  assert.equal(finalWrite.result.exitCode, 2);
  assert.equal(finalWrite.output.multi_tenant_architecture.status, 'invalid');

  const draftWrite = await invoke('--draft');
  assert.equal(draftWrite.result.exitCode, 0);
  assert.equal(draftWrite.output.multi_tenant_architecture.status, 'invalid');
  assert.ok(draftWrite.output.warnings.some((warning) => warning.code.startsWith('multi_tenant_')));
});
