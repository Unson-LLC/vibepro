import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import {
  bindBrainbaseContext,
  inspectManagedV2OutcomeCaseProjection,
} from '../src/brainbase-integration.js';
import { preparePullRequest } from '../src/pr-manager.js';
import { addStory } from '../src/story-manager.js';
import { initWorkspace } from '../src/workspace.js';

const execFileAsync = promisify(execFile);
const producerModulePath = process.env.BRAINBASE_PRODUCER_MODULE;
const STORY_ID = 'story-brainbase-producer-contract';
const SIGNING_KEY = 'brainbase-producer-contract-test-signing-key-0123456789';
const KEY_ID = 'brainbase-vibepro-handoff-hmac-v1';
const NOW = new Date('2026-09-04T00:00:02.000Z');

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function makeRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-brainbase-producer-contract-'));
  await writeFile(path.join(root, 'index.js'), 'export const value = 1;\n');
  await git(root, ['init']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await git(root, ['config', 'user.email', 'vibepro@example.invalid']);
  await git(root, ['remote', 'add', 'origin', 'https://github.com/Unson-LLC/example.git']);
  await git(root, ['add', 'index.js']);
  await git(root, ['commit', '-m', 'test fixture']);
  await initWorkspace(root);
  return root;
}

async function configureManagedBrainbase(root) {
  const configPath = path.join(root, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.brainbase = {
    ...(config.brainbase ?? {}),
    managed: true,
    project_code: 'brainbase',
    repository: 'github://Unson-LLC/example',
    handoff_hmac_key_id: KEY_ID,
    handoff_hmac_key_file: '.vibepro/integrations/brainbase/handoff-hmac.key',
  };
  await writeJson(configPath, config);
  const keyPath = path.join(root, '.vibepro', 'integrations', 'brainbase', 'handoff-hmac.key');
  await mkdir(path.dirname(keyPath), { recursive: true });
  await writeFile(keyPath, SIGNING_KEY, { mode: 0o600 });
  return config;
}

// This test executes the real OutcomeCaseService with an in-memory repository
// and deterministic resolvers. It intentionally does not reach a production
// database, authenticate a user, or claim an external source readback.
async function createOutcomeCaseSnapshot() {
  const servicePath = path.join(path.dirname(path.resolve(producerModulePath)), 'outcome-case-service.js');
  const { OutcomeCaseService } = await import(pathToFileURL(servicePath).href);
  const items = new Map();
  const actor = {
    person_id: 'per_producer_contract',
    projectCodes: ['brainbase'],
    organizationId: 'org_producer_contract',
  };
  const service = new OutcomeCaseService({
    repository: {
      async create(outcomeCase) {
        items.set(outcomeCase.case_id, structuredClone(outcomeCase));
        return structuredClone(outcomeCase);
      },
      async findByCaseId(caseId) {
        const outcomeCase = items.get(caseId);
        return outcomeCase ? structuredClone(outcomeCase) : null;
      },
      async update(outcomeCase) {
        items.set(outcomeCase.case_id, structuredClone(outcomeCase));
        return structuredClone(outcomeCase);
      },
    },
    readRunReceipt: async () => null,
    resolveOutcomeReferences: async ({ projectCode, capabilityId }) => ({
      project: { ref: projectCode, state: 'confirmed' },
      capability: { ref: capabilityId, state: 'confirmed' },
    }),
    resolveClosureAuthority: async ({ projectCode }) => ({
      state: 'confirmed',
      closure_authorized_person_ids: ['per_producer_contract'],
      provenance: { source: 'memory_test', project_code: projectCode },
    }),
    now: () => new Date('2026-09-04T00:00:00.000Z'),
  });
  const outcomeCase = await service.create({
    case_id: 'outcome-case-producer-contract-1',
    project_code: 'brainbase',
    capability_id: 'cap_outcome_control',
    user_observable_outcome: '利用者が本番の読戻しを確認して成果を評価できる。',
    protected_constraints: ['外部読戻しなしで閉鎖しない'],
    non_goals: ['汎用 workflow engine'],
    selected_domain_pack: 'delivery-control/v1',
    current_external_state: 'processing',
    technical_story_refs: ['story-outcome-case-v1'],
    run_receipt_refs: [],
    prior_attempt_refs: [],
    unresolved_failure_boundary: null,
  }, actor);
  return { outcomeCase, service, actor };
}

async function createProducerReceipt(root) {
  const moduleUrl = pathToFileURL(path.resolve(producerModulePath)).href;
  const producer = await import(moduleUrl);
  assert.equal(typeof producer.createVibeproManagedHandoff, 'function');
  const baseSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const { outcomeCase } = await createOutcomeCaseSnapshot();
  const receipt = producer.createVibeproManagedHandoff({
    outcomeCase,
    decision: {
      turn_id: 'turn-producer-contract',
      resolution_id: 'jr_producer_contract',
      project_code: 'brainbase',
      case_id: 'outcome-case-producer-contract-1',
      decision: 'continue',
    },
    target: {
      repository: 'github://Unson-LLC/example',
      repository_root: '.',
      project_code: 'brainbase',
      base_sha: baseSha,
      story_id: null,
    },
    technicalAcceptance: [{
      id: 'TA-producer-contract',
      criterion: 'Brainbase producerの実出力をVibeProが検証・投影する。',
    }],
    productionProbe: {
      id: 'probe-producer-contract',
      procedure: '外部実行後に保存済みの読戻し証跡を確認する。',
    },
    signingKey: SIGNING_KEY,
    keyId: KEY_ID,
    issuedAt: '2026-09-04T00:00:00.000Z',
    expiresAt: '2026-09-05T00:00:00.000Z',
  });
  return { receipt, outcomeCase };
}

async function createIssuerReceipt(root) {
  const issuerPath = path.join(path.dirname(path.resolve(producerModulePath)), 'vibepro-handoff-issuer.js');
  const { createVibeproHandoffIssuer } = await import(pathToFileURL(issuerPath).href);
  assert.equal(typeof createVibeproHandoffIssuer, 'function');
  const baseSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const { outcomeCase, service, actor } = await createOutcomeCaseSnapshot();
  const issuer = createVibeproHandoffIssuer({
    outcomeCaseService: service,
    // Deliberately an in-memory adopted-source fixture: this test does not
    // exercise production persistence, token authentication, or readback.
    readAdoptedHandoff: async ({ caseId, resolutionId, organizationId, projectCode, actor: sourceActor }) => {
      assert.deepEqual({ caseId, resolutionId, organizationId, projectCode }, {
        caseId: outcomeCase.case_id,
        resolutionId: 'jr_issuer_contract',
        organizationId: outcomeCase.organization_id,
        projectCode: outcomeCase.project_code,
      });
      assert.deepEqual(sourceActor, actor);
      return {
        status: 'adopted',
        organization_id: outcomeCase.organization_id,
        project_code: outcomeCase.project_code,
        case_id: outcomeCase.case_id,
        resolution_id: resolutionId,
        outcome_case_revision: outcomeCase.revision,
        decision: {
          turn_id: 'turn-issuer-contract',
          resolution_id: resolutionId,
          project_code: outcomeCase.project_code,
          case_id: outcomeCase.case_id,
          decision: 'continue',
        },
        target: {
          case_id: outcomeCase.case_id,
          repository: 'github://Unson-LLC/example',
          repository_root: '.',
          project_code: outcomeCase.project_code,
          base_sha: baseSha,
          story_id: null,
        },
        technicalAcceptance: [{
          id: 'TA-issuer-contract',
          criterion: '採用済みsourceからのissuer出力をVibeProが検証・投影する。',
        }],
        productionProbe: {
          id: 'probe-issuer-contract',
          procedure: '外部実行後に保存済みの読戻し証跡を確認する。',
        },
      };
    },
    signingKey: SIGNING_KEY,
    keyId: KEY_ID,
    clock: () => new Date('2026-09-04T00:00:00.000Z'),
    ttlMs: 60 * 60 * 1000,
  });
  return {
    receipt: await issuer.issue({ caseId: outcomeCase.case_id, resolutionId: 'jr_issuer_contract' }, actor),
    outcomeCase,
  };
}

async function writeProducerReceipt(root, receipt) {
  const input = '.vibepro/integrations/brainbase/inbox/producer-handoff.json';
  await writeJson(path.join(root, input), receipt);
  return input;
}

const skipWithoutProducer = producerModulePath
  ? false
  : 'BRAINBASE_PRODUCER_MODULE must point to the Brainbase producer module';

test('Brainbase producer output binds through the managed inbox and projects exactly seven OutcomeCase fields', { skip: skipWithoutProducer }, async () => {
  const root = await makeRepo();
  await addStory(root, { story_id: STORY_ID, title: 'Producer contract' });
  const config = await configureManagedBrainbase(root);
  const { receipt, outcomeCase } = await createProducerReceipt(root);
  const input = await writeProducerReceipt(root, receipt);

  const result = await bindBrainbaseContext(root, { storyId: STORY_ID, input, config, now: () => NOW });
  assert.equal(result.status, 'bound');
  const boundOutcomeCase = result.outcome_case;
  assert.deepEqual(boundOutcomeCase, receipt.outcome_case);
  assert.deepEqual(Object.keys(boundOutcomeCase).sort(), [
    'case_id', 'decision_digest', 'judgment_receipt_ref', 'outcome_case_ref',
    'production_probe', 'technical_acceptance', 'user_observable_outcome',
  ]);
  const prepared = await preparePullRequest(root, { storyId: STORY_ID, baseRef: 'HEAD', now: () => NOW });
  assert.equal(prepared.preparation.outcome_case_status, 'trusted');
  const projected = prepared.preparation.outcome_case;
  assert.deepEqual(
    Object.fromEntries(Object.entries(projected).filter(([key]) => !['technical_complete', 'technical_completion_status', 'evidence'].includes(key))),
    receipt.outcome_case,
  );
  assert.equal(projected.case_id, 'outcome-case-producer-contract-1');
  assert.equal(projected.user_observable_outcome, outcomeCase.user_observable_outcome);
  assert.equal(outcomeCase.closure_status, 'open');
  assert.equal(projected.judgment_receipt_ref, 'brainbase://judgment-receipts/jr_producer_contract');
  assert.equal(projected.production_probe.terminal_receipt_target, 'brainbase://production-probes/probe-producer-contract/receipt');
  assert.equal(projected.technical_complete, false);
});

test('a modified Brainbase producer receipt is rejected before a VibePro binding is published', { skip: skipWithoutProducer }, async () => {
  const root = await makeRepo();
  await addStory(root, { story_id: STORY_ID, title: 'Tampered producer contract' });
  const config = await configureManagedBrainbase(root);
  const { receipt } = await createProducerReceipt(root);
  receipt.outcome_case.user_observable_outcome = '署名後に書き換えられた成果';
  const input = await writeProducerReceipt(root, receipt);
  const configPath = path.join(root, '.vibepro', 'config.json');
  const before = await readFile(configPath, 'utf8');

  await assert.rejects(
    bindBrainbaseContext(root, { storyId: STORY_ID, input, config, now: () => NOW }),
    /digest|HMAC|signature/i,
  );
  assert.equal(await readFile(configPath, 'utf8'), before);
  assert.equal(await readFile(path.join(root, '.vibepro', 'integrations', 'brainbase', STORY_ID, 'context.json'), 'utf8').catch(() => null), null);
});

test('a consumed producer source that disappears cannot be projected as trusted', { skip: skipWithoutProducer }, async () => {
  const root = await makeRepo();
  await addStory(root, { story_id: STORY_ID, title: 'Missing producer source' });
  const config = await configureManagedBrainbase(root);
  const { receipt } = await createProducerReceipt(root);
  const input = await writeProducerReceipt(root, receipt);
  await bindBrainbaseContext(root, { storyId: STORY_ID, input, config, now: () => NOW });
  await unlink(path.join(root, input));

  const inspection = await inspectManagedV2OutcomeCaseProjection(
    root,
    STORY_ID,
    JSON.parse(await readFile(path.join(root, '.vibepro', 'config.json'), 'utf8')).brainbase.stories.find((story) => story.story_id === STORY_ID).outcome_case,
    { now: () => NOW },
  );
  assert.equal(inspection.status, 'untrusted');
  assert.equal(inspection.reason_code, 'consumption_source_missing');
});

test('an adopted Brainbase issuer receipt binds through the managed inbox and remains technically incomplete', { skip: skipWithoutProducer }, async () => {
  const root = await makeRepo();
  await addStory(root, { story_id: STORY_ID, title: 'Issuer contract' });
  const config = await configureManagedBrainbase(root);
  const { receipt, outcomeCase } = await createIssuerReceipt(root);
  const input = await writeProducerReceipt(root, receipt);

  const bound = await bindBrainbaseContext(root, { storyId: STORY_ID, input, config, now: () => NOW });
  assert.equal(bound.status, 'bound');
  assert.deepEqual(Object.keys(bound.outcome_case).sort(), [
    'case_id', 'decision_digest', 'judgment_receipt_ref', 'outcome_case_ref',
    'production_probe', 'technical_acceptance', 'user_observable_outcome',
  ]);

  const prepared = await preparePullRequest(root, { storyId: STORY_ID, baseRef: 'HEAD', now: () => NOW });
  assert.equal(prepared.preparation.outcome_case_status, 'trusted');
  const projected = prepared.preparation.outcome_case;
  assert.deepEqual(
    Object.fromEntries(Object.entries(projected).filter(([key]) => !['technical_complete', 'technical_completion_status', 'evidence'].includes(key))),
    receipt.outcome_case,
  );
  assert.equal(projected.case_id, outcomeCase.case_id);
  assert.equal(projected.judgment_receipt_ref, 'brainbase://judgment-receipts/jr_issuer_contract');
  assert.equal(projected.technical_complete, false);
});
