import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assessMultiTenantArchitecture,
  compareDeploymentVariants,
  detectMultiTenantApplicability,
  multiTenantReviewLenses,
  summarizeMultiTenantAdvisoryRun
} from '../src/multi-tenant-architecture.js';
import {
  readMultiTenantContract,
  writeInferredSpec,
  writeMultiTenantContract
} from '../src/spec-store.js';
import { validateSpec } from '../src/spec-validator.js';

const fixtureRoot = path.join(import.meta.dirname, 'fixtures', 'multi-tenant-architecture');

async function fixture(name) {
  return JSON.parse(await readFile(path.join(fixtureRoot, `${name}.json`), 'utf8'));
}

test('曖昧なStoryをneeds_reviewへ保ち、copy-onlyと一般CLIは対象外にする', () => {
  assert.equal(detectMultiTenantApplicability('workspaceの設定方式を変更する。').status, 'needs_review');
  assert.equal(detectMultiTenantApplicability('画面にtenantという説明文を追加する。').status, 'not_applicable');
  assert.equal(detectMultiTenantApplicability('一般的なローカルCLIのhelpを改善する。').status, 'not_applicable');
  assert.equal(
    assessMultiTenantArchitecture({ storyText: 'workspaceの設定方式を変更する。' }).status,
    'needs_review'
  );
});

test('ContractをStory IDで保存・読込し、不正Contractは保存前に拒否する', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-tenant-contract-'));
  const storyId = 'story-tenant-contract-storage';
  await writeInferredSpec(repo, storyId, {
    schema_version: '0.1.0',
    story_id: storyId,
    story_context: '複数テナントのqueue、state、credential境界をtenant_idで分離する。',
    clauses: []
  });
  const contract = await fixture('pooled');
  await writeMultiTenantContract(repo, storyId, contract);
  assert.deepEqual(await readMultiTenantContract(repo, storyId), contract);

  const invalid = structuredClone(contract);
  delete invalid.tenant_identity.canonical_key;
  await assert.rejects(() => writeMultiTenantContract(repo, storyId, invalid), /tenant_identity_key/);
  assert.deepEqual(await readMultiTenantContract(repo, storyId), contract);
});

test('Graph/scanner証拠の不足、検査不能、cross-tenant negative証拠欠落を別findingにする', async () => {
  const contract = await fixture('pooled');
  const evidence = structuredClone(contract.verification.evidence);
  evidence.propagation_surfaces = evidence.propagation_surfaces.filter((surface) => surface !== 'queue');
  evidence.graph.tenant_entities = [];
  evidence.graph.boundary_edges = [];
  evidence.negative_scenarios = evidence.negative_scenarios.filter((scenario) => scenario !== 'cross_tenant_candidate');
  evidence.scanner_results.sandbox_isolation = 'inconclusive';

  const report = assessMultiTenantArchitecture({
    storyText: 'tenant_idをqueue、state、sandboxへ伝播する。',
    contract,
    evidence
  });
  assert.equal(report.status, 'invalid');
  assert.ok(report.findings.some((finding) => finding.code === 'tenant_propagation_unverified' && finding.path.endsWith('.queue')));
  assert.ok(report.findings.some((finding) => finding.code === 'tenant_graph_entities'));
  assert.ok(report.findings.some((finding) => finding.code === 'tenant_graph_edges'));
  assert.ok(report.findings.some((finding) => finding.code === 'cross_tenant_negative_evidence'));
  assert.ok(report.findings.some((finding) => finding.code === 'scanner_inconclusive'));
  assert.equal(report.coverage.status, 'inconclusive');
});

test('tenant key・曖昧resolution・fallback・共有state・sandbox residueのnegative fixtureをfail-closedで検出する', async () => {
  for (const name of [
    'negative-tenant-key',
    'negative-ambiguous-resolution',
    'negative-cross-tenant-fallback',
    'negative-state-key',
    'negative-sandbox-residue'
  ]) {
    const negative = await fixture(name);
    const contract = await fixture(negative.base_fixture);
    if (negative.resource_patch) {
      contract.resources[negative.resource_index] = {
        ...contract.resources[negative.resource_index],
        ...negative.resource_patch
      };
    }
    if (negative.contract_path) {
      const [section, field] = negative.contract_path.split('.');
      contract[section][field] = negative.value;
    }
    const report = assessMultiTenantArchitecture({
      storyText: '複数テナントのstateとsandboxをtenant_idで分離する。',
      contract
    });
    assert.equal(report.status, 'invalid', name);
    assert.ok(report.findings.some((finding) => finding.code === negative.expected_finding), name);
  }
});

test('ContractとGraph・Spec・実装のtenant key、sharing、deployment driftを報告する', async () => {
  const contract = await fixture('pooled');
  const evidence = structuredClone(contract.verification.evidence);
  evidence.graph.tenant_key = 'workspace_id';
  evidence.spec.sharing_modes = ['dedicated'];
  evidence.implementation.deployment_modes = ['managed_dedicated'];
  const report = assessMultiTenantArchitecture({
    storyText: '複数テナントの共有runtimeをtenant_idで分離する。',
    contract,
    evidence
  });
  assert.equal(report.status, 'invalid');
  assert.ok(report.findings.some((finding) => finding.code === 'tenant_key_drift' && finding.source === 'graph'));
  assert.ok(report.findings.some((finding) => finding.code === 'sharing_mode_drift' && finding.source === 'spec'));
  assert.ok(report.findings.some((finding) => finding.code === 'deployment_mode_drift' && finding.source === 'implementation'));
});

test('migration系Storyでrollbackとoperator actionが両方なければ最終Specを拒否する', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-tenant-migration-'));
  await writeFile(path.join(repo, 'migration.js'), 'export const migrate = true;\n');
  const contract = await fixture('customer-managed');
  delete contract.data.rollback;
  delete contract.data.operator_action;
  const spec = {
    schema_version: '0.1.0',
    story_id: 'story-tenant-migration',
    clauses: [{
      id: 'MIGRATE-1',
      type: 'contract',
      statement: 'tenant dataを移行する。',
      origin: { code_refs: [{ file: 'migration.js', anchor: 'migrate' }] }
    }],
    multi_tenancy: contract
  };
  const result = await validateSpec(repo, spec, {
    mode: 'final',
    storyContext: 'tenant dataをexportして別regionへmigrationする。'
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'multi_tenant_migration_recovery'));
});

test('cross-tenant findingは下書きでは警告、最終Specではerrorとなり迂回できない', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-tenant-cross-boundary-'));
  await writeFile(path.join(repo, 'authorization.js'), 'export const tenantBoundary = "deny_and_audit";\n');
  const contract = await fixture('pooled');
  contract.credentials.cross_tenant_fallback = 'allowed';
  const spec = {
    schema_version: '0.1.0',
    story_id: 'story-tenant-cross-boundary',
    clauses: [{
      id: 'BOUNDARY-1',
      type: 'contract',
      statement: 'tenant_idが異なる接続へのfallbackを拒否する。',
      origin: { code_refs: [{ file: 'authorization.js', anchor: 'tenantBoundary' }] }
    }],
    multi_tenancy: contract
  };

  const draft = await validateSpec(repo, spec, {
    mode: 'draft',
    storyContext: '複数テナント間の接続fallbackを拒否する。'
  });
  assert.equal(draft.ok, true);
  assert.ok(draft.warnings.some((warning) => warning.code === 'multi_tenant_cross_tenant_credential_fallback'));

  const final = await validateSpec(repo, spec, {
    mode: 'final',
    storyContext: '複数テナント間の接続fallbackを拒否する。'
  });
  assert.equal(final.ok, false);
  assert.ok(final.errors.some((error) => error.code === 'multi_tenant_cross_tenant_credential_fallback'));
});

test('resource・credential・data・deploymentの契約不足を別findingで返す', async () => {
  const contract = await fixture('pooled');
  delete contract.resources[0].partition_key;
  delete contract.credentials.scope;
  delete contract.data.canonical_owners;
  contract.deployment_modes = [];

  const report = assessMultiTenantArchitecture({
    storyText: '複数テナントの保存先、認証情報、データ所有者、配備を分離する。',
    contract
  });
  assert.equal(report.status, 'invalid');
  assert.ok(report.findings.some((finding) => finding.code === 'state_partition_key'));
  assert.ok(report.findings.some((finding) => finding.code === 'credential_scope'));
  assert.ok(report.findings.some((finding) => finding.code === 'tenant_data_owners'));
  assert.ok(report.findings.some((finding) => finding.code === 'tenant_deployment_modes'));
});

test('6ビューは証拠を含み、配備形態を比較し、review lensはfindingと未確認点を持つ', async () => {
  const contracts = await Promise.all(['pooled', 'dedicated', 'customer-managed'].map(fixture));
  const report = assessMultiTenantArchitecture({
    storyText: '複数テナントのmanaged、dedicated、customer-managed配備を比較する。',
    contract: contracts[2]
  });
  assert.equal(Object.keys(report.views).length, 6);
  assert.equal(report.views.trust_data_boundary.resources[0].data_owner, 'customer_database');
  assert.equal(report.views.trust_data_boundary.resources[0].credential_scope, 'customer_connection');
  assert.equal(report.views.tenant_resolution.evidence.tenant_key, 'workspace_id');

  const variants = compareDeploymentVariants(contracts);
  assert.deepEqual(variants.map((variant) => variant.tenancy_model), ['pooled', 'dedicated', 'customer_managed']);
  assert.deepEqual(variants.map((variant) => variant.deployment_modes[0]), [
    'managed_shared',
    'managed_dedicated',
    'customer_managed'
  ]);

  const reviewReport = structuredClone(report);
  reviewReport.status = 'needs_review';
  reviewReport.findings = [{ severity: 'review', code: 'scanner_inconclusive', path: 'verification.scanners' }];
  const lenses = multiTenantReviewLenses(reviewReport);
  assert.equal(lenses.length, 3);
  assert.ok(lenses.every((lens) => lens.status === 'needs_review'));
  assert.ok(lenses.every((lens) => lens.unconfirmed.length > 0));
});

test('advisory runは状態と誤検知・見逃し候補を別々に集計する', () => {
  const summary = summarizeMultiTenantAdvisoryRun([
    { status: 'ready' },
    { status: 'needs_review', false_positive_candidate: true },
    { status: 'inconclusive' },
    { status: 'not_applicable', false_negative_candidate: true }
  ]);
  assert.deepEqual(summary, {
    total: 4,
    applicable: 3,
    pass: 1,
    needs_review: 1,
    inconclusive: 1,
    not_applicable: 1,
    false_positive_candidates: 1,
    false_negative_candidates: 1
  });
});

test('customer-managed fixtureでContractから6ビュー・3 lens・最終Spec判定まで再現する', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-customer-managed-'));
  await writeFile(path.join(repo, 'connector.js'), 'export const workspaceId = "workspace_id";\n');
  const contract = await fixture('customer-managed');
  const result = await validateSpec(repo, {
    schema_version: '0.1.0',
    story_id: 'story-customer-managed',
    clauses: [{
      id: 'BYOC-1',
      type: 'contract',
      statement: 'workspace_idで顧客管理接続を選ぶ。',
      origin: { code_refs: [{ file: 'connector.js', anchor: 'workspaceId' }] }
    }],
    multi_tenancy: contract
  }, {
    mode: 'final',
    storyContext: 'workspace_idでcustomer-managed接続とcredentialを分離する。'
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.multi_tenant_architecture.status, 'ready');
  assert.equal(Object.keys(result.multi_tenant_architecture.views).length, 6);
  assert.equal(multiTenantReviewLenses(result.multi_tenant_architecture).length, 3);
});
