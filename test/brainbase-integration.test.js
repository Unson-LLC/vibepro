import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { resolvePrArtifactFile } from '../src/artifact-routing.js';
import {
  bindBrainbaseContext,
  canonicalManagedHandoffPayload,
  canonicalJson,
  createBrainbaseKnowledgeEvent,
  doctorBrainbaseIntegration,
  enqueueBrainbaseLearningCandidate,
  ensureBrainbaseStoryBinding,
  getBrainbaseIntegrationStatus,
  inspectManagedV2OutcomeCaseProjection,
  reconcileBrainbaseOutbox,
  renderBrainbaseDoctor,
  renderBrainbaseIntegrationStatus,
  sha256,
} from '../src/brainbase-integration.js';
import { collectGitContext } from '../src/git-fingerprint.js';
import { runCli } from '../src/cli.js';
import { addStory, renderStoryReport, selectStory } from '../src/story-manager.js';
import { preparePullRequest } from '../src/pr-manager.js';
import { initWorkspace } from '../src/workspace.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-brainbase-runtime-context-handoff';
const TEST_HANDOFF_HMAC_SECRET = 'vibepro-test-handoff-hmac-secret';
const OUTCOME_CASE_BINDING_STORY_ID = 'story-vibepro-brainbase-outcome-case-binding-v2';

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function makeRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-brainbase-integration-'));
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

function judgmentReceipt({ contentType = 'team_document', audience = 'team' } = {}) {
  return {
    resolution_id: 'jr_test',
    resolved_at: '2026-08-30T00:00:00.000Z',
    turn_id: 'turn-test',
    request_digest: 'a'.repeat(64),
    context_digest: 'b'.repeat(64),
    status: 'resolved',
    autonomy_decision: 'continue',
    autonomy_reason_code: 'routine_in_scope',
    autonomy_policy_ids: [],
    allowed_runtime_escalation_reasons: [
      'irreversible_action',
      'missing_authority',
      'owner_value_choice',
      'required_input_unavailable',
      'evidenced_terminal_blocker',
    ],
    runtime_version: 'judgment-runtime-2.4.4',
    manifest_digest: 'c'.repeat(64),
    host_binding: {
      adapter_id: 'brainbase-mcp',
      adapter_version: '1',
      status: 'managed',
      enforcement_level: 'host_contract',
    },
    project_code: 'brainbase',
    classification: {
      intent: 'implement',
      domains: ['engineering'],
      action_kind: 'write',
      risk: 'medium',
      confidence: 'confirmed',
      signals: [],
    },
    classification_evidence: {
      source: 'current_request',
      source_turn_ids: ['turn-test'],
      matcher_ids: ['engineering'],
    },
    classification_assurance: 'verified',
    reconciliation_reasons: [],
    selected_dag_ids: ['engineering.v1', 'authority.v1'],
    applicable_policies: [{
      id: 'global.smallest-change.v1',
      version: '1',
      priority: 100,
      strength: 'hard',
      scope: { type: 'global', id: null },
      visibility: 'organization',
      owner_person_id: null,
      evidence_requirement: 'affected tests',
      effect: { decision: 'require', target: 'affected-tests' },
      instruction: 'Run affected tests.',
    }],
    suppressed_policies: [],
    required_capabilities: [{
      capability: 'knowledge.resolve',
      status: 'required',
      input: {
        intent: 'lookup',
        audience,
        content_type: contentType,
        project_code: 'brainbase',
      },
      receipt_required: true,
    }],
    active_nodes: ['entry', 'reconcile', 'goal', 'implementation', 'receipt'],
    active_edges: [
      ['entry', 'reconcile'],
      ['reconcile', 'goal'],
      ['goal', 'implementation'],
      ['implementation', 'receipt'],
    ],
    active_node_definitions: [],
    unresolved: [],
    rationale: ['bounded'],
    plan_digest: 'd'.repeat(64),
  };
}

function handoff(overrides = {}) {
  const receipt = overrides.receipt ?? judgmentReceipt();
  const storyId = overrides.story_id ?? STORY_ID;
  const capabilityInput = receipt.required_capabilities[0]?.input;
  const route = capabilityInput?.content_type === 'canonical_fact'
    ? { source_class: 'graph', retrieval_capability: 'graph.search', source_ref: 'graph://decision/decision-1' }
    : { source_class: 'owning_repo', retrieval_capability: 'repository.read', source_ref: 'github://Unson-LLC/brainbase-unson/docs/guide.md' };
  return {
    schema_version: 'brainbase-vibepro-context-handoff.v1',
    story_id: storyId,
    project_code: 'brainbase',
    episode: {
      schema_version: 'brainbase-judgment-episode-v1',
      episode_id: 'je_test',
      state: 'open',
      initial_route_receipt_digest: sha256(canonicalJson(receipt)),
      initial_route_receipt: receipt,
    },
    knowledge: capabilityInput ? [{
      capability_input: capabilityInput,
      routing_receipt: {
        resolution_id: 'kr_test',
        resolved_at: '2026-08-30T00:00:01.000Z',
        project_code: 'brainbase',
        content_type: capabilityInput.content_type,
        status: 'resolved',
        source_class: route.source_class,
        canonical_location: route.source_class === 'graph'
          ? { scope: 'brainbase', entity_types: ['decision'] }
          : { repository: 'project:brainbase', path: 'docs/' },
        retrieval_capability: route.retrieval_capability,
        searched_scope: [],
        absence_confirmed: false,
        excluded_sources: [],
        not_searched: [],
        next_route: route.source_class,
        confidence: 0.95,
        rationale: 'deterministic',
      },
      references: [{
        source_class: route.source_class,
        retrieval_capability: route.retrieval_capability,
        source_ref: route.source_ref,
        content_digest: 'e'.repeat(64),
      }],
    }] : [],
  };
}

function v2Handoff(overrides = {}) {
  return {
    ...handoff(overrides),
    schema_version: 'brainbase-vibepro-context-handoff.v2',
    case_id: 'outcome-case-test-1',
    outcome_case_ref: 'brainbase://outcome-cases/outcome-case-test-1',
    judgment_receipt_ref: 'brainbase://judgment-receipts/jr_test',
    decision_digest: 'f'.repeat(64),
    user_observable_outcome: '利用者が成果ケースの技術証跡を確認できる。',
    technical_acceptance: [{
      id: 'TA-1',
      criterion: 'v2の成果ケース契約がStoryとPR準備へ保存される。'
    }],
    production_probe: {
      id: 'probe-production-readback',
      procedure: '本番で保存済みの成果ケース表示を再読込する。',
      terminal_receipt_target: 'brainbase://production-probes/probe-production-readback/receipt'
    },
    ...overrides
  };
}

function outcomeCase(overrides = {}) {
  const value = v2Handoff(overrides);
  return {
    case_id: value.case_id,
    outcome_case_ref: value.outcome_case_ref,
    judgment_receipt_ref: value.judgment_receipt_ref,
    decision_digest: value.decision_digest,
    user_observable_outcome: value.user_observable_outcome,
    technical_acceptance: value.technical_acceptance,
    production_probe: value.production_probe
  };
}

function invalidManagedV2OutcomeCases() {
  const cases = [];
  const missingFields = [
    'case_id',
    'outcome_case_ref',
    'judgment_receipt_ref',
    'decision_digest',
    'user_observable_outcome',
    'technical_acceptance',
    'production_probe'
  ];
  for (const field of missingFields) {
    const value = structuredClone(outcomeCase());
    delete value[field];
    cases.push({ name: `missing ${field}`, value });
  }

  const blankPaths = [
    ['case_id'],
    ['outcome_case_ref'],
    ['judgment_receipt_ref'],
    ['decision_digest'],
    ['user_observable_outcome'],
    ['technical_acceptance', 0, 'id'],
    ['technical_acceptance', 0, 'criterion'],
    ['production_probe', 'id'],
    ['production_probe', 'procedure'],
    ['production_probe', 'terminal_receipt_target']
  ];
  for (const pathParts of blankPaths) {
    const value = structuredClone(outcomeCase());
    let target = value;
    for (const part of pathParts.slice(0, -1)) target = target[part];
    target[pathParts.at(-1)] = '   ';
    cases.push({ name: `blank ${pathParts.join('.')}`, value });
  }

  cases.push({
    name: 'empty technical_acceptance',
    value: outcomeCase({ technical_acceptance: [] })
  });
  cases.push({
    name: 'duplicate technical_acceptance ids',
    value: outcomeCase({
      technical_acceptance: [
        { id: 'TA-1', criterion: '最初の基準' },
        { id: 'TA-1', criterion: '重複した基準' }
      ]
    })
  });
  return cases;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function runCliCaptured(args, io = {}) {
  let stdout = '';
  let stderr = '';
  const result = await runCli(args, {
    ...io,
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: (chunk) => { stderr += chunk; } }
  });
  return { ...result, stdout, stderr };
}

async function managedBindingMutationSnapshot(root, storyId) {
  const relativePaths = [
    '.vibepro/config.json',
    `.vibepro/integrations/brainbase/${storyId}/context.json`,
    `.vibepro/integrations/brainbase/${storyId}/bind-receipt.json`,
    `.vibepro/integrations/brainbase/${storyId}/bind-commit.json`,
    '.vibepro/integrations/brainbase/handoff-consumption-ledger.json',
    `.vibepro/integrations/brainbase/publications/${storyId}.json`,
    `.vibepro/pr/${storyId}/traceability.json`,
    `.vibepro/pr/${storyId}/pr-prepare.json`,
    `.vibepro/pr/${storyId}/pr-body.md`
  ];
  return Object.fromEntries(await Promise.all(relativePaths.map(async (relativePath) => [
    relativePath,
    await readFile(path.join(root, relativePath), 'utf8').catch(() => null)
  ])));
}

async function managedTrustSourceMutationSnapshot(root, storyId) {
  const relativePaths = [
    '.vibepro/config.json',
    '.vibepro/integrations/brainbase/inbox/handoff.json',
    `.vibepro/integrations/brainbase/${storyId}/context.json`,
    `.vibepro/integrations/brainbase/${storyId}/bind-receipt.json`,
    `.vibepro/integrations/brainbase/${storyId}/bind-commit.json`,
    '.vibepro/integrations/brainbase/handoff-consumption-ledger.json',
    `.vibepro/integrations/brainbase/publications/${storyId}.json`
  ];
  return Object.fromEntries(await Promise.all(relativePaths.map(async (relativePath) => [
    relativePath,
    await readFile(path.join(root, relativePath), 'utf8').catch(() => null)
  ])));
}

function refreshContextDigest(context) {
  const stable = { ...context };
  delete stable.context_digest;
  delete stable.bound_at;
  context.context_digest = sha256(canonicalJson(stable));
  return context.context_digest;
}

function managedHandoff({
  // Brainbase emits this receipt before VibePro creates the Story. The
  // Story-specific bind receipt fixes the id after the handoff is consumed.
  storyId = null,
  projectCode = 'brainbase',
  baseSha,
  repositoryRoot = '.',
  issuedAt = '2026-08-29T00:00:00.000Z',
  expiresAt = '2026-09-30T00:00:00.000Z',
  keyId = 'brainbase-vibepro-handoff-hmac-v1',
  hmacSecret = TEST_HANDOFF_HMAC_SECRET,
  schemaVersion = 'brainbase-vibepro-managed-handoff.v1',
  managedOutcomeCase = null
} = {}) {
  const payload = {
    schema_version: schemaVersion,
    repository: 'github://Unson-LLC/example',
    repository_root: repositoryRoot,
    project_code: projectCode,
    base_sha: baseSha,
    issued_at: issuedAt,
    expires_at: expiresAt,
    turn_id: 'turn-test',
    resolution_id: 'jr_test',
    story_id: storyId,
    authorized: false,
    graph_promotion_allowed: false,
    ...(schemaVersion === 'brainbase-vibepro-managed-handoff.v2' ? { outcome_case: managedOutcomeCase ?? outcomeCase() } : {})
  };
  const canonicalPayload = canonicalManagedHandoffPayload(payload);
  const receiptDigest = sha256(canonicalPayload);
  return {
    ...payload,
    receipt_digest: receiptDigest,
    signature: {
      algorithm: 'hmac-sha256',
      key_id: keyId,
      value: createHmac('sha256', hmacSecret).update(canonicalPayload).digest('hex')
    }
  };
}

async function configureManagedBrainbase(root, overrides = {}) {
  const configPath = path.join(root, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.brainbase = {
    ...(config.brainbase ?? {}),
    managed: true,
    project_code: 'brainbase',
    repository: 'github://Unson-LLC/example',
    handoff_hmac_key_id: 'brainbase-vibepro-handoff-hmac-v1',
    handoff_hmac_key_file: '.vibepro/integrations/brainbase/handoff-hmac.key',
    ...overrides
  };
  await writeJson(configPath, config);
  await mkdir(path.join(root, '.vibepro', 'integrations', 'brainbase'), { recursive: true });
  await writeFile(
    path.join(root, '.vibepro', 'integrations', 'brainbase', 'handoff-hmac.key'),
    TEST_HANDOFF_HMAC_SECRET,
    { mode: 0o600 }
  );
  const head = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const receipt = managedHandoff({ baseSha: head, ...overrides.receipt });
  await writeJson(path.join(root, '.vibepro', 'integrations', 'brainbase', 'inbox', 'handoff.json'), receipt);
  return { config, head, receipt };
}

test('Brainbase judgment・routing receipt・retrieval referencesをlocal contextへ束縛する', async () => {
  const root = await makeRepo();
  const input = path.join(root, 'handoff.json');
  await writeJson(input, handoff());

  const result = await bindBrainbaseContext(root, {
    storyId: STORY_ID,
    input: 'handoff.json',
    now: () => new Date('2026-08-30T00:00:02.000Z'),
  });
  assert.equal(result.status, 'bound');
  assert.equal(result.knowledge_reference_count, 1);

  const context = JSON.parse(await readFile(path.join(root, result.artifact), 'utf8'));
  assert.equal(context.schema_version, 'vibepro-brainbase-context.v1');
  assert.equal(context.judgment.authority, 'brainbase');
  assert.equal(context.judgment.snapshot_not_authority, true);
  assert.deepEqual(context.judgment.autonomy_policy_ids, []);
  assert.equal(context.knowledge[0].references[0].source_ref, 'github://Unson-LLC/brainbase-unson/docs/guide.md');
  assert.equal('initial_route_receipt' in context.judgment, false);
  assert.equal(context.context_digest.length, 64);
});

test('v1 context-only StoryのPR準備は未連携として扱い、v2復旧を案内しない', async () => {
  const root = await makeRepo();
  await addStory(root, { story_id: STORY_ID, title: 'v1 context-only Story' });
  await writeJson(path.join(root, 'handoff.json'), handoff());
  await bindBrainbaseContext(root, {
    storyId: STORY_ID,
    input: 'handoff.json',
    now: () => new Date('2026-08-30T00:00:02.000Z')
  });

  const prepared = await preparePullRequest(root, { storyId: STORY_ID, baseRef: 'HEAD' });
  assert.equal(prepared.preparation.outcome_case, undefined);
  assert.equal(prepared.preparation.outcome_case_status, 'none');
  assert.equal(prepared.preparation.outcome_case_reason_code, 'not_linked');
  assert.equal(prepared.preparation.outcome_case_recovery, undefined);
  const body = await readFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'pr-body.md'), 'utf8');
  assert.doesNotMatch(body, /再bind\/復旧判断/);
});

test('署名済みmanaged v1の完全publishを通したStoryのPR準備は未連携として扱い、v2復旧を案内しない', async () => {
  const root = await makeRepo();
  await addStory(root, { story_id: STORY_ID, title: 'managed v1 full publish Story' });
  const { config } = await configureManagedBrainbase(root);
  const result = await bindBrainbaseContext(root, {
    storyId: STORY_ID,
    input: '.vibepro/integrations/brainbase/inbox/handoff.json',
    config,
    now: () => new Date('2026-08-30T00:00:02.000Z')
  });
  assert.equal(result.status, 'bound');
  await assert.doesNotReject(readFile(path.join(root, '.vibepro', 'integrations', 'brainbase', STORY_ID, 'bind-receipt.json'), 'utf8'));
  await assert.doesNotReject(readFile(path.join(root, '.vibepro', 'integrations', 'brainbase', STORY_ID, 'bind-commit.json'), 'utf8'));

  const prepared = await preparePullRequest(root, { storyId: STORY_ID, baseRef: 'HEAD' });
  assert.equal(prepared.preparation.outcome_case, undefined);
  assert.equal(prepared.preparation.outcome_case_status, 'none');
  assert.equal(prepared.preparation.outcome_case_reason_code, 'not_linked');
  assert.equal(prepared.preparation.outcome_case_recovery, undefined);
  const body = await readFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'pr-body.md'), 'utf8');
  assert.doesNotMatch(body, /再bind\/復旧判断/);
});

test('署名済みmanaged v2成果ケース契約をcontextと既存Storyメタデータへ投影する', async () => {
  const root = await makeRepo();
  await addStory(root, { story_id: STORY_ID, title: 'Outcome case binding' });
  const { config } = await configureManagedBrainbase(root, {
    receipt: { schemaVersion: 'brainbase-vibepro-managed-handoff.v2' }
  });

  const result = await bindBrainbaseContext(root, {
    storyId: STORY_ID,
    input: '.vibepro/integrations/brainbase/inbox/handoff.json',
    config,
    now: () => new Date('2026-09-03T00:00:02.000Z'),
  });
  assert.equal(result.status, 'bound');
  assert.equal(result.story_metadata_updated, true);
  assert.equal(result.outcome_case.case_id, 'outcome-case-test-1');

  const context = JSON.parse(await readFile(path.join(root, result.artifact), 'utf8'));
  assert.equal(context.schema_version, 'vibepro-brainbase-context.v2');
  assert.equal(context.outcome_case.production_probe.id, 'probe-production-readback');
  assert.equal(context.outcome_case.technical_acceptance[0].id, 'TA-1');

  const projectedConfig = JSON.parse(await readFile(path.join(root, '.vibepro', 'config.json'), 'utf8'));
  const story = projectedConfig.brainbase.stories.find((item) => item.story_id === STORY_ID);
  assert.deepEqual(story.outcome_case, context.outcome_case);
  assert.equal('outcome_case_status' in context, false);
});

test('managed v2はOutcomeCase必須7項目・空値・受入ID重複をbind前に拒否し、StoryやPRへ投影しない', async () => {
  for (const invalidCase of invalidManagedV2OutcomeCases()) {
    const root = await makeRepo();
    await addStory(root, { story_id: STORY_ID, title: `Reject ${invalidCase.name}` });
    const { config } = await configureManagedBrainbase(root, {
      receipt: {
        schemaVersion: 'brainbase-vibepro-managed-handoff.v2',
        managedOutcomeCase: invalidCase.value
      }
    });
    const configPath = path.join(root, '.vibepro', 'config.json');
    const beforeConfig = await readFile(configPath, 'utf8');

    await assert.rejects(
      bindBrainbaseContext(root, {
        storyId: STORY_ID,
        input: '.vibepro/integrations/brainbase/inbox/handoff.json',
        config,
        now: () => new Date('2026-09-03T00:00:02.000Z')
      }),
      undefined,
      invalidCase.name
    );

    assert.equal(await readFile(configPath, 'utf8'), beforeConfig, `${invalidCase.name}: config must be unchanged`);
    const bindingDir = path.join(root, '.vibepro', 'integrations', 'brainbase', STORY_ID);
    for (const artifact of ['context.json', 'bind-receipt.json', 'bind-commit.json']) {
      assert.equal(
        await readFile(path.join(bindingDir, artifact), 'utf8').catch(() => null),
        null,
        `${invalidCase.name}: ${artifact} must not be written`
      );
    }

    const prepared = await preparePullRequest(root, { storyId: STORY_ID, baseRef: 'HEAD' });
    assert.equal(prepared.preparation.outcome_case, undefined, invalidCase.name);
    assert.equal(prepared.preparation.outcome_case_status, 'none', invalidCase.name);
    assert.equal(prepared.preparation.outcome_case_reason_code, 'not_linked', invalidCase.name);
  }
});

test('managed v2 Story addも不完全OutcomeCaseを原子的に拒否し、Storyやbind成果物を残さない', async () => {
  const representativeCases = invalidManagedV2OutcomeCases().filter(({ name }) => [
    'missing production_probe',
    'blank user_observable_outcome',
    'empty technical_acceptance',
    'duplicate technical_acceptance ids'
  ].includes(name));

  for (const invalidCase of representativeCases) {
    const root = await makeRepo();
    await configureManagedBrainbase(root, {
      receipt: {
        schemaVersion: 'brainbase-vibepro-managed-handoff.v2',
        managedOutcomeCase: invalidCase.value
      }
    });
    const configPath = path.join(root, '.vibepro', 'config.json');
    const beforeConfig = await readFile(configPath, 'utf8');

    await assert.rejects(
      addStory(root, { story_id: STORY_ID, title: `Reject ${invalidCase.name}` }),
      undefined,
      invalidCase.name
    );

    assert.equal(await readFile(configPath, 'utf8'), beforeConfig, `${invalidCase.name}: Story add must not write config`);
    const persisted = JSON.parse(await readFile(configPath, 'utf8'));
    assert.equal(persisted.brainbase.stories.some((story) => story.story_id === STORY_ID), false, invalidCase.name);
    const bindingDir = path.join(root, '.vibepro', 'integrations', 'brainbase', STORY_ID);
    for (const artifact of ['context.json', 'bind-receipt.json', 'bind-commit.json']) {
      assert.equal(
        await readFile(path.join(bindingDir, artifact), 'utf8').catch(() => null),
        null,
        `${invalidCase.name}: ${artifact} must not be written`
      );
    }
  }
});

test('CLI integration bindは不正なmanaged v2を理由付きで拒否し、公開状態を原子的に維持する', async () => {
  const cases = [
    {
      name: 'missing production_probe',
      stderr: /managed handoff\.outcome_case\.production_probe (?:is required|must be an object)/
    },
    {
      name: 'blank user_observable_outcome',
      stderr: /managed handoff\.outcome_case\.user_observable_outcome is required/
    },
    {
      name: 'duplicate technical_acceptance ids',
      stderr: /managed handoff\.outcome_case\.technical_acceptance must not contain duplicate ids/
    }
  ];

  for (const invalidCase of cases) {
    const root = await makeRepo();
    await addStory(root, { story_id: STORY_ID, title: `CLI bind reject ${invalidCase.name}` });
    const managedOutcomeCase = invalidManagedV2OutcomeCases().find(({ name }) => name === invalidCase.name).value;
    await configureManagedBrainbase(root, {
      receipt: { schemaVersion: 'brainbase-vibepro-managed-handoff.v2', managedOutcomeCase }
    });
    const before = await managedBindingMutationSnapshot(root, STORY_ID);

    const result = await runCliCaptured([
      'integration', 'brainbase', 'bind', root,
      '--id', STORY_ID,
      '--input', '.vibepro/integrations/brainbase/inbox/handoff.json'
    ], { env: { ...process.env, BRAINBASE_VIBEPRO_HANDOFF_HMAC_SECRET: TEST_HANDOFF_HMAC_SECRET } });

    assert.equal(result.exitCode, 1, invalidCase.name);
    assert.equal(result.stdout, '', invalidCase.name);
    assert.match(result.stderr, invalidCase.stderr, invalidCase.name);
    assert.deepEqual(await managedBindingMutationSnapshot(root, STORY_ID), before, invalidCase.name);
  }
});

test('CLI Story addは不正なmanaged v2を理由付きで拒否し、Story・公開状態・PR投影を残さない', async () => {
  const cases = [
    {
      name: 'missing production_probe',
      stderr: /managed handoff\.outcome_case\.production_probe (?:is required|must be an object)/
    },
    {
      name: 'blank user_observable_outcome',
      stderr: /managed handoff\.outcome_case\.user_observable_outcome is required/
    },
    {
      name: 'duplicate technical_acceptance ids',
      stderr: /managed handoff\.outcome_case\.technical_acceptance must not contain duplicate ids/
    }
  ];

  for (const invalidCase of cases) {
    const root = await makeRepo();
    const managedOutcomeCase = invalidManagedV2OutcomeCases().find(({ name }) => name === invalidCase.name).value;
    await configureManagedBrainbase(root, {
      receipt: { schemaVersion: 'brainbase-vibepro-managed-handoff.v2', managedOutcomeCase }
    });
    const before = await managedBindingMutationSnapshot(root, STORY_ID);

    const result = await runCliCaptured([
      'story', 'add', root,
      '--id', STORY_ID,
      '--title', `CLI Story add reject ${invalidCase.name}`
    ], { env: { ...process.env, BRAINBASE_VIBEPRO_HANDOFF_HMAC_SECRET: TEST_HANDOFF_HMAC_SECRET } });

    assert.equal(result.exitCode, 1, invalidCase.name);
    assert.equal(result.stdout, '', invalidCase.name);
    assert.match(result.stderr, invalidCase.stderr, invalidCase.name);
    assert.deepEqual(await managedBindingMutationSnapshot(root, STORY_ID), before, invalidCase.name);
    const config = JSON.parse(await readFile(path.join(root, '.vibepro', 'config.json'), 'utf8'));
    assert.equal(config.brainbase.stories.some((story) => story.story_id === STORY_ID), false, invalidCase.name);
  }
});

test('非managed v2は成果ケース値の前にfail closedする', async () => {
  const root = await makeRepo();
  await writeJson(path.join(root, 'untrusted-v2.json'), v2Handoff());
  await assert.rejects(
    bindBrainbaseContext(root, { storyId: STORY_ID, input: 'untrusted-v2.json' }),
    /requires a signed brainbase-vibepro-managed-handoff\.v2/
  );
  assert.equal(await readFile(path.join(root, '.vibepro', 'integrations', 'brainbase', STORY_ID, 'context.json'), 'utf8').catch(() => null), null);
});

test('managed v2はStory未作成時にcontextを書かず、v2からv1への再bindも拒否する', async () => {
  const root = await makeRepo();
  const { config } = await configureManagedBrainbase(root, {
    receipt: { schemaVersion: 'brainbase-vibepro-managed-handoff.v2' }
  });
  await assert.rejects(
    bindBrainbaseContext(root, {
      storyId: STORY_ID,
      input: '.vibepro/integrations/brainbase/inbox/handoff.json',
      config,
      now: () => new Date('2026-09-03T00:00:02.000Z')
    }),
    /requires existing Story.*before any write/
  );
  assert.equal(await readFile(path.join(root, '.vibepro', 'integrations', 'brainbase', STORY_ID, 'context.json'), 'utf8').catch(() => null), null);

  await assert.rejects(
    bindBrainbaseContext(root, {
      storyId: STORY_ID,
      input: '.vibepro/integrations/brainbase/inbox/handoff.json',
      config,
      storyDeclaration: { story_id: STORY_ID, title: 'Injected declaration', status: 'active' },
      now: () => new Date('2026-09-03T00:00:02.000Z')
    }),
    (error) => error?.code === 'BRAINBASE_STORY_DECLARATION_FORBIDDEN'
  );
  assert.equal(await readFile(path.join(root, '.vibepro', 'integrations', 'brainbase', STORY_ID, 'context.json'), 'utf8').catch(() => null), null);
  const afterRejectedDeclaration = JSON.parse(await readFile(path.join(root, '.vibepro', 'config.json'), 'utf8'));
  assert.equal(afterRejectedDeclaration.brainbase.stories.some((story) => story.story_id === STORY_ID), false);
  await assert.rejects(
    ensureBrainbaseStoryBinding(root, {
      storyId: STORY_ID,
      config,
      storyDeclaration: { story_id: STORY_ID, title: 'Injected declaration', status: 'active' }
    }),
    (error) => error?.code === 'BRAINBASE_STORY_DECLARATION_FORBIDDEN'
  );

  // Simulate the already-declared Story state. Creating it through addStory
  // would correctly reject this v2 receipt before the Story exists.
  const existingConfigPath = path.join(root, '.vibepro', 'config.json');
  const existingConfig = JSON.parse(await readFile(existingConfigPath, 'utf8'));
  existingConfig.brainbase.stories.push({ story_id: STORY_ID, title: 'Existing Story', status: 'active' });
  await writeJson(existingConfigPath, existingConfig);
  await bindBrainbaseContext(root, {
    storyId: STORY_ID,
    input: '.vibepro/integrations/brainbase/inbox/handoff.json',
    config,
    now: () => new Date('2026-09-03T00:00:02.000Z')
  });
  await writeJson(path.join(root, 'v1.json'), handoff());
  await assert.rejects(
    bindBrainbaseContext(root, { storyId: STORY_ID, input: 'v1.json' }),
    /cannot be rebound to v1/
  );
  const context = JSON.parse(await readFile(path.join(root, '.vibepro', 'integrations', 'brainbase', STORY_ID, 'context.json'), 'utf8'));
  assert.equal(context.schema_version, 'vibepro-brainbase-context.v2');
});

test('signed managed v2の成果ケース参照はcaseとissuerに一致しなければならない', async () => {
  const cases = [
    [
      'cross-case',
      outcomeCase({ outcome_case_ref: 'brainbase://outcome-cases/another-case' }),
      /does not identify the signed outcome case/
    ],
    [
      'unknown-issuer',
      outcomeCase({ judgment_receipt_ref: 'https://issuer.example/jr_test' }),
      /canonical Brainbase reference/
    ],
    [
      'foreign-receipt',
      outcomeCase({ judgment_receipt_ref: 'brainbase://judgment-receipts/other-resolution' }),
      /does not identify the signed outcome case/
    ]
  ];
  for (const [name, managedOutcomeCase, expected] of cases) {
    const root = await makeRepo();
    await addStory(root, { story_id: STORY_ID, title: 'Outcome validation' });
    const { config } = await configureManagedBrainbase(root, {
      receipt: { schemaVersion: 'brainbase-vibepro-managed-handoff.v2', managedOutcomeCase }
    });
    await assert.rejects(
      bindBrainbaseContext(root, {
        storyId: STORY_ID,
        input: '.vibepro/integrations/brainbase/inbox/handoff.json',
        config,
        now: () => new Date('2026-09-03T00:00:02.000Z')
      }),
      expected
    );
  }
});

test('trusted v2 bindはContext・Story・PR準備へ同じ7項目を投影し、技術完了を推測しない', async () => {
  const root = await makeRepo();
  await addStory(root, { story_id: STORY_ID, title: 'End-to-end outcome case' });
  const expectedOutcomeCase = outcomeCase();
  const { config } = await configureManagedBrainbase(root, {
    receipt: { schemaVersion: 'brainbase-vibepro-managed-handoff.v2', managedOutcomeCase: expectedOutcomeCase }
  });
  await bindBrainbaseContext(root, {
    storyId: STORY_ID,
    input: '.vibepro/integrations/brainbase/inbox/handoff.json',
    config,
    now: () => new Date('2026-09-03T00:00:02.000Z')
  });
  const context = JSON.parse(await readFile(path.join(root, '.vibepro', 'integrations', 'brainbase', STORY_ID, 'context.json'), 'utf8'));
  const stored = JSON.parse(await readFile(path.join(root, '.vibepro', 'config.json'), 'utf8'))
    .brainbase.stories.find((story) => story.story_id === STORY_ID);
  assert.deepEqual(context.outcome_case, expectedOutcomeCase);
  assert.deepEqual(stored.outcome_case, expectedOutcomeCase);
  const prepared = await preparePullRequest(root, { storyId: STORY_ID, baseRef: 'HEAD' });
  const projected = prepared.preparation.outcome_case;
  for (const field of ['case_id', 'outcome_case_ref', 'judgment_receipt_ref', 'decision_digest', 'user_observable_outcome', 'technical_acceptance', 'production_probe']) {
    assert.deepEqual(projected[field], expectedOutcomeCase[field]);
  }
  assert.equal(projected.technical_complete, false);
});

test('PR準備は共謀して書換えたContext・receipt・Story・commit markerを署名なしでは投影しない', async () => {
  const root = await makeRepo();
  await addStory(root, { story_id: STORY_ID, title: 'Tamper-resistant outcome case' });
  const expectedOutcomeCase = outcomeCase();
  const { config } = await configureManagedBrainbase(root, {
    receipt: { schemaVersion: 'brainbase-vibepro-managed-handoff.v2', managedOutcomeCase: expectedOutcomeCase }
  });
  await bindBrainbaseContext(root, {
    storyId: STORY_ID,
    input: '.vibepro/integrations/brainbase/inbox/handoff.json',
    config,
    now: () => new Date('2026-09-03T00:00:02.000Z')
  });

  const integration = path.join(root, '.vibepro', 'integrations', 'brainbase');
  const contextPath = path.join(integration, STORY_ID, 'context.json');
  const receiptPath = path.join(integration, STORY_ID, 'bind-receipt.json');
  const markerPath = path.join(integration, STORY_ID, 'bind-commit.json');
  const configPath = path.join(root, '.vibepro', 'config.json');
  const context = JSON.parse(await readFile(contextPath, 'utf8'));
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const marker = JSON.parse(await readFile(markerPath, 'utf8'));
  const persisted = JSON.parse(await readFile(configPath, 'utf8'));
  const forged = structuredClone(expectedOutcomeCase);
  forged.user_observable_outcome = '攻撃者がローカル成果ケースを差し替えた。';

  // Simulate a colluding local writer that updates every mutable projection
  // and digest, but cannot produce a new HMAC with Brainbase's trusted key.
  receipt.managed_handoff.outcome_case = forged;
  receipt.managed_handoff.receipt_digest = sha256(canonicalManagedHandoffPayload(receipt.managed_handoff));
  receipt.receipt_digest = receipt.managed_handoff.receipt_digest;
  context.outcome_case = forged;
  context.source.handoff_digest = sha256(canonicalJson(receipt.managed_handoff));
  const contextDigest = refreshContextDigest(context);
  receipt.context_digest = contextDigest;
  context.bind_receipt.receipt_digest = receipt.receipt_digest;
  marker.context_digest = contextDigest;
  marker.receipt_digest = receipt.receipt_digest;
  persisted.brainbase.stories.find((story) => story.story_id === STORY_ID).outcome_case = forged;
  await Promise.all([
    writeJson(contextPath, context),
    writeJson(receiptPath, receipt),
    writeJson(markerPath, marker),
    writeJson(configPath, persisted)
  ]);

  const prepared = await preparePullRequest(root, { storyId: STORY_ID, baseRef: 'HEAD' });
  assert.equal(prepared.preparation.outcome_case, undefined);
  assert.equal(prepared.preparation.outcome_case_status, 'untrusted');
  assert.match(prepared.preparation.outcome_case_reason_code, /digest_mismatch|signature_invalid|identity_mismatch/);
});

test('PR準備は未連携・partial成果ケース・期限切れ署名を区別して安全な復旧判断を表示する', async () => {
  const noneRoot = await makeRepo();
  await addStory(noneRoot, { story_id: STORY_ID, title: 'No outcome case link' });
  const none = await preparePullRequest(noneRoot, { storyId: STORY_ID, baseRef: 'HEAD' });
  assert.equal(none.preparation.outcome_case_status, 'none');
  assert.equal(none.preparation.outcome_case_reason_code, 'not_linked');

  const partialRoot = await makeRepo();
  await addStory(partialRoot, { story_id: STORY_ID, title: 'Partial outcome case' });
  const partialConfigPath = path.join(partialRoot, '.vibepro', 'config.json');
  const partialConfig = JSON.parse(await readFile(partialConfigPath, 'utf8'));
  partialConfig.brainbase.stories.find((story) => story.story_id === STORY_ID).outcome_case = { case_id: 'partial-only' };
  await writeJson(partialConfigPath, partialConfig);
  const partial = await preparePullRequest(partialRoot, { storyId: STORY_ID, baseRef: 'HEAD' });
  assert.equal(partial.preparation.outcome_case, undefined);
  assert.equal(partial.preparation.outcome_case_status, 'partial');
  assert.equal(partial.preparation.outcome_case_reason_code, 'outcome_case_partial');
  assert.equal(partial.preparation.outcome_case_recovery.decision, 'recover_or_rebind');

  const expiredRoot = await makeRepo();
  await addStory(expiredRoot, { story_id: STORY_ID, title: 'Expired outcome case' });
  const { config } = await configureManagedBrainbase(expiredRoot, {
    receipt: {
      schemaVersion: 'brainbase-vibepro-managed-handoff.v2',
      expiresAt: '2026-09-03T00:00:00.000Z'
    }
  });
  await bindBrainbaseContext(expiredRoot, {
    storyId: STORY_ID,
    input: '.vibepro/integrations/brainbase/inbox/handoff.json',
    config,
    now: () => new Date('2026-09-02T00:00:00.000Z')
  });
  const expired = await preparePullRequest(expiredRoot, {
    storyId: STORY_ID,
    baseRef: 'HEAD',
    now: () => new Date('2026-09-04T00:00:00.000Z')
  });
  assert.equal(expired.preparation.outcome_case, undefined);
  assert.equal(expired.preparation.outcome_case_status, 'untrusted');
  assert.equal(expired.preparation.outcome_case_reason_code, 'managed_handoff_expired');
  assert.match(await readFile(path.join(expiredRoot, '.vibepro', 'pr', STORY_ID, 'pr-body.md'), 'utf8'), /再bind\/復旧判断/);
});

test('managed v2 publish is journal-recoverable and never projects a partial transaction as trusted', async () => {
  for (const failurePoint of ['context', 'receipt', 'ledger']) {
    const root = await makeRepo();
    await addStory(root, { story_id: STORY_ID, title: `Recovery at ${failurePoint}` });
    const expectedOutcomeCase = outcomeCase();
    const { config } = await configureManagedBrainbase(root, {
      receipt: { schemaVersion: 'brainbase-vibepro-managed-handoff.v2', managedOutcomeCase: expectedOutcomeCase }
    });
    const bindOptions = {
      storyId: STORY_ID,
      input: '.vibepro/integrations/brainbase/inbox/handoff.json',
      config,
      now: () => new Date('2026-09-03T00:00:02.000Z')
    };
    await assert.rejects(
      bindBrainbaseContext(root, { ...bindOptions, publishFailureAt: [failurePoint, 'rollback'] }),
      (error) => error?.code === 'BRAINBASE_BIND_PUBLICATION_INJECTED_FAILURE'
    );
    const partial = await preparePullRequest(root, { storyId: STORY_ID, baseRef: 'HEAD' });
    assert.equal(partial.preparation.outcome_case, undefined, `${failurePoint} must not be trusted before recovery`);
    assert.equal(partial.preparation.outcome_case_status, 'partial');
    assert.equal(partial.preparation.outcome_case_reason_code, 'commit_marker_missing');
    const journalPath = path.join(root, '.vibepro', 'integrations', 'brainbase', 'publications', `${STORY_ID}.json`);
    assert.notEqual(await readFile(journalPath, 'utf8').catch(() => null), null);

    // A new invocation first recovers the durable transaction, then performs
    // its idempotent bind. The ledger remains one receipt-to-one Story entry.
    const rebound = await bindBrainbaseContext(root, bindOptions);
    assert.equal(rebound.status, 'bound');
    const prepared = await preparePullRequest(root, { storyId: STORY_ID, baseRef: 'HEAD' });
    assert.equal(prepared.preparation.outcome_case.case_id, expectedOutcomeCase.case_id);
    assert.equal(prepared.preparation.outcome_case.user_observable_outcome, expectedOutcomeCase.user_observable_outcome);
    assert.equal(prepared.preparation.outcome_case.technical_complete, false);
    assert.equal(await readFile(journalPath, 'utf8').catch(() => null), null);
    const ledger = JSON.parse(await readFile(path.join(root, '.vibepro', 'integrations', 'brainbase', 'handoff-consumption-ledger.json'), 'utf8'));
    assert.equal(ledger.entries.length, 1);
  }
});

test('managed v2 process recovery can fail closed and resume idempotently', async () => {
  const root = await makeRepo();
  await addStory(root, { story_id: STORY_ID, title: 'Process recovery' });
  const expectedOutcomeCase = outcomeCase();
  const { config } = await configureManagedBrainbase(root, {
    receipt: { schemaVersion: 'brainbase-vibepro-managed-handoff.v2', managedOutcomeCase: expectedOutcomeCase }
  });
  const bindOptions = {
    storyId: STORY_ID,
    input: '.vibepro/integrations/brainbase/inbox/handoff.json',
    config,
    now: () => new Date('2026-09-03T00:00:02.000Z')
  };
  await assert.rejects(bindBrainbaseContext(root, { ...bindOptions, publishFailureAt: 'receipt' }));
  await assert.rejects(
    bindBrainbaseContext(root, { ...bindOptions, publishFailureAt: 'recovery' }),
    /publication failure at recovery/
  );
  const partial = await preparePullRequest(root, { storyId: STORY_ID, baseRef: 'HEAD' });
  assert.equal(partial.preparation.outcome_case, undefined);
  await bindBrainbaseContext(root, bindOptions);
  const prepared = await preparePullRequest(root, { storyId: STORY_ID, baseRef: 'HEAD' });
  assert.equal(prepared.preparation.outcome_case.case_id, expectedOutcomeCase.case_id);
  assert.equal(prepared.preparation.outcome_case.user_observable_outcome, expectedOutcomeCase.user_observable_outcome);
  assert.equal(prepared.preparation.outcome_case.technical_complete, false);
});

test('managed handoff sourceは外部・traversal・encoded・symlinkを一切のbinding write前に拒否する', async () => {
  const root = await makeRepo();
  const { config, receipt } = await configureManagedBrainbase(root, {
    receipt: { schemaVersion: 'brainbase-vibepro-managed-handoff.v2' }
  });
  await addStory(root, { story_id: STORY_ID, title: 'Confined handoff source' });
  const outsidePath = path.join(path.dirname(root), `${path.basename(root)}-outside-handoff.json`);
  await writeJson(outsidePath, receipt);
  const traversal = `safe/../../${path.basename(outsidePath)}`;
  const backslashTraversal = `safe\\..\\..\\${path.basename(outsidePath)}`;
  await writeJson(path.resolve(root, backslashTraversal), receipt);
  const encodedTraversal = 'safe/%2e%2e/%2e%2e/handoff.json';
  await writeJson(path.resolve(root, encodedTraversal), receipt);
  const deeplyEncodedTraversal = 'safe/%25252e%25252e/%25252e%25252e/handoff.json';
  await writeJson(path.resolve(root, deeplyEncodedTraversal), receipt);
  const symlinkPath = path.join(root, 'symlink-handoff.json');
  await symlink(outsidePath, symlinkPath);
  const before = await managedBindingMutationSnapshot(root, STORY_ID);

  for (const input of [outsidePath, traversal, backslashTraversal, encodedTraversal, deeplyEncodedTraversal, 'symlink-handoff.json']) {
    await assert.rejects(
      bindBrainbaseContext(root, {
        storyId: STORY_ID,
        input,
        config,
        now: () => new Date('2026-09-03T00:00:02.000Z')
      }),
      /repository-relative|canonical repository-relative|remain within the repository|symbolic links/i,
      input
    );
    assert.deepEqual(
      await managedBindingMutationSnapshot(root, STORY_ID),
      before,
      `${input} must not mutate the ledger or any binding/PR projection`
    );
  }
});

test('tampered consumption ledger source_artifactは読戻しでtrustedへ昇格しない', async () => {
  const variants = [
    (root, outsidePath) => `safe/../../${path.basename(outsidePath)}`,
    (_root, outsidePath) => outsidePath,
    () => 'safe/%252e%252e/%252e%252e/outside.json',
    () => 'safe/%25252e%25252e/%25252e%25252e/outside.json',
    () => 'symlink-handoff.json'
  ];
  for (const sourceArtifact of variants) {
    const root = await makeRepo();
    const { config, receipt } = await configureManagedBrainbase(root, {
      receipt: { schemaVersion: 'brainbase-vibepro-managed-handoff.v2' }
    });
    await addStory(root, { story_id: STORY_ID, title: 'Ledger source confinement' });
    await bindBrainbaseContext(root, {
      storyId: STORY_ID,
      input: '.vibepro/integrations/brainbase/inbox/handoff.json',
      config,
      now: () => new Date('2026-09-03T00:00:02.000Z')
    });
    const outsidePath = path.join(path.dirname(root), `${path.basename(root)}-consumed.json`);
    await writeJson(outsidePath, receipt);
    await symlink(outsidePath, path.join(root, 'symlink-handoff.json'));
    const tamperedSourceArtifact = sourceArtifact(root, outsidePath);
    if (tamperedSourceArtifact.includes('%')) {
      await writeJson(path.resolve(root, tamperedSourceArtifact), receipt);
    }
    const ledgerPath = path.join(root, '.vibepro', 'integrations', 'brainbase', 'handoff-consumption-ledger.json');
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
    ledger.entries[0].source_artifact = tamperedSourceArtifact;
    await writeJson(ledgerPath, ledger);
    const configPath = path.join(root, '.vibepro', 'config.json');
    const stored = JSON.parse(await readFile(configPath, 'utf8'))
      .brainbase.stories.find((story) => story.story_id === STORY_ID);
    const before = await managedBindingMutationSnapshot(root, STORY_ID);

    const inspection = await inspectManagedV2OutcomeCaseProjection(
      root,
      STORY_ID,
      stored.outcome_case,
      { now: () => new Date('2026-09-03T00:00:03.000Z') }
    );
    assert.notEqual(inspection.status, 'trusted');
    assert.deepEqual(await managedBindingMutationSnapshot(root, STORY_ID), before);
  }
});

test('PR準備はcanonical source receipt欠損をuntrustedとして投影せずtrust sourceを変更しない', async () => {
  const root = await makeRepo();
  const { config } = await configureManagedBrainbase(root, {
    receipt: { schemaVersion: 'brainbase-vibepro-managed-handoff.v2' }
  });
  await addStory(root, { story_id: STORY_ID, title: 'Missing canonical source receipt' });
  await bindBrainbaseContext(root, {
    storyId: STORY_ID,
    input: '.vibepro/integrations/brainbase/inbox/handoff.json',
    config,
    now: () => new Date('2026-09-03T00:00:02.000Z')
  });
  await unlink(path.join(root, '.vibepro', 'integrations', 'brainbase', 'inbox', 'handoff.json'));
  const before = await managedTrustSourceMutationSnapshot(root, STORY_ID);

  const prepared = await preparePullRequest(root, { storyId: STORY_ID, baseRef: 'HEAD' });

  assert.equal(prepared.preparation.outcome_case, undefined);
  assert.equal(prepared.preparation.outcome_case_status, 'untrusted');
  assert.equal(prepared.preparation.outcome_case_reason_code, 'consumption_source_missing');
  assert.deepEqual(await managedTrustSourceMutationSnapshot(root, STORY_ID), before);
});

test('PR準備はcanonical source receipt改ざんをuntrustedとして投影せずtrust sourceを変更しない', async () => {
  const root = await makeRepo();
  const { config } = await configureManagedBrainbase(root, {
    receipt: { schemaVersion: 'brainbase-vibepro-managed-handoff.v2' }
  });
  await addStory(root, { story_id: STORY_ID, title: 'Tampered canonical source receipt' });
  await bindBrainbaseContext(root, {
    storyId: STORY_ID,
    input: '.vibepro/integrations/brainbase/inbox/handoff.json',
    config,
    now: () => new Date('2026-09-03T00:00:02.000Z')
  });
  const sourcePath = path.join(root, '.vibepro', 'integrations', 'brainbase', 'inbox', 'handoff.json');
  const sourceReceipt = JSON.parse(await readFile(sourcePath, 'utf8'));
  sourceReceipt.project_code = 'tampered-project';
  await writeJson(sourcePath, sourceReceipt);
  const before = await managedTrustSourceMutationSnapshot(root, STORY_ID);

  const prepared = await preparePullRequest(root, { storyId: STORY_ID, baseRef: 'HEAD' });

  assert.equal(prepared.preparation.outcome_case, undefined);
  assert.equal(prepared.preparation.outcome_case_status, 'untrusted');
  assert.equal(prepared.preparation.outcome_case_reason_code, 'consumption_ledger_mismatch');
  assert.deepEqual(await managedTrustSourceMutationSnapshot(root, STORY_ID), before);
});

test('PR準備はcanonical source receipt署名改ざんをuntrustedとして投影せずtrust sourceを変更しない', async () => {
  const root = await makeRepo();
  const { config } = await configureManagedBrainbase(root, {
    receipt: { schemaVersion: 'brainbase-vibepro-managed-handoff.v2' }
  });
  await addStory(root, { story_id: STORY_ID, title: 'Tampered canonical source receipt signature' });
  await bindBrainbaseContext(root, {
    storyId: STORY_ID,
    input: '.vibepro/integrations/brainbase/inbox/handoff.json',
    config,
    now: () => new Date('2026-09-03T00:00:02.000Z')
  });
  const sourcePath = path.join(root, '.vibepro', 'integrations', 'brainbase', 'inbox', 'handoff.json');
  const sourceReceipt = JSON.parse(await readFile(sourcePath, 'utf8'));
  sourceReceipt.signature.value = '0'.repeat(64);
  await writeJson(sourcePath, sourceReceipt);
  const before = await managedTrustSourceMutationSnapshot(root, STORY_ID);

  const prepared = await preparePullRequest(root, { storyId: STORY_ID, baseRef: 'HEAD' });

  assert.equal(prepared.preparation.outcome_case, undefined);
  assert.equal(prepared.preparation.outcome_case_status, 'untrusted');
  assert.equal(prepared.preparation.outcome_case_reason_code, 'managed_handoff_signature_invalid');
  assert.deepEqual(await managedTrustSourceMutationSnapshot(root, STORY_ID), before);
});

test('tampered recovery journal ledger is rejected before replay mutates any publication document', async () => {
  const root = await makeRepo();
  await addStory(root, { story_id: STORY_ID, title: 'Recovery source confinement' });
  const { config } = await configureManagedBrainbase(root, {
    receipt: { schemaVersion: 'brainbase-vibepro-managed-handoff.v2' }
  });
  const bindOptions = {
    storyId: STORY_ID,
    input: '.vibepro/integrations/brainbase/inbox/handoff.json',
    config,
    now: () => new Date('2026-09-03T00:00:02.000Z')
  };
  await assert.rejects(bindBrainbaseContext(root, { ...bindOptions, publishFailureAt: 'receipt' }));
  const journalPath = path.join(root, '.vibepro', 'integrations', 'brainbase', 'publications', `${STORY_ID}.json`);
  const journal = JSON.parse(await readFile(journalPath, 'utf8'));
  journal.documents.ledger.entries[0].source_artifact = 'safe/../../outside.json';
  journal.publication_digest = sha256(canonicalJson({
    schema_version: journal.schema_version,
    transaction_id: journal.transaction_id,
    story_id: journal.story_id,
    documents: journal.documents
  }));
  journal.commit_marker.publication_digest = journal.publication_digest;
  await writeJson(journalPath, journal);
  const before = await managedBindingMutationSnapshot(root, STORY_ID);

  await assert.rejects(bindBrainbaseContext(root, bindOptions), /remain within the repository/i);
  assert.deepEqual(await managedBindingMutationSnapshot(root, STORY_ID), before);
  assert.equal(await readFile(journalPath, 'utf8'), `${JSON.stringify(journal, null, 2)}\n`);
});

test('routingだけ・personal knowledge・未要求entryを受け入れない', async () => {
  const root = await makeRepo();

  const missingReferences = handoff();
  missingReferences.knowledge[0].references = [];
  await writeJson(path.join(root, 'missing.json'), missingReferences);
  await assert.rejects(
    bindBrainbaseContext(root, { storyId: STORY_ID, input: 'missing.json' }),
    /routing receipt alone is not knowledge retrieval/,
  );

  const personalReceipt = judgmentReceipt({ contentType: 'personal_knowledge', audience: 'personal' });
  const personal = handoff();
  personal.episode.initial_route_receipt = personalReceipt;
  personal.episode.initial_route_receipt_digest = sha256(canonicalJson(personalReceipt));
  personal.knowledge[0].capability_input = personalReceipt.required_capabilities[0].input;
  await writeJson(path.join(root, 'personal.json'), personal);
  await assert.rejects(
    bindBrainbaseContext(root, { storyId: STORY_ID, input: 'personal.json' }),
    /cannot persist personal knowledge/,
  );

  const extra = handoff();
  extra.knowledge.push(structuredClone(extra.knowledge[0]));
  await writeJson(path.join(root, 'extra.json'), extra);
  await assert.rejects(
    bindBrainbaseContext(root, { storyId: STORY_ID, input: 'extra.json' }),
    /entries that were not required/,
  );
});

test('current git stateに一致するcomputed passing evidenceから非昇格Knowledge Eventを生成する', async () => {
  const root = await makeRepo();
  await writeJson(path.join(root, 'handoff.json'), handoff());
  await bindBrainbaseContext(root, {
    storyId: STORY_ID,
    input: 'handoff.json',
    now: () => new Date('2026-08-30T00:00:02.000Z'),
  });

  const gitContext = await collectGitContext(root);
  const verificationPath = await resolvePrArtifactFile(root, STORY_ID, 'verification-evidence.json');
  await writeJson(verificationPath, {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    updated_at: '2026-08-30T00:00:04.000Z',
    commands: [{
      kind: 'unit',
      status: 'pass',
      command: 'node --test test/example.test.js',
      summary: 'pass',
      evidence_source: 'runner_direct',
      executed_at: '2026-08-30T00:00:03.000Z',
      git_context: gitContext,
    }],
  });

  const result = await createBrainbaseKnowledgeEvent(root, {
    storyId: STORY_ID,
    summary: 'Keep the accepted Brainbase context bound through verification.',
    now: () => new Date('2026-08-30T00:00:05.000Z'),
  });
  const event = JSON.parse(await readFile(path.join(root, result.artifact), 'utf8'));
  assert.equal(event.schema_version, 'knowledge_event.v1');
  assert.equal(event.subject.type, 'development_learning');
  assert.equal(event.decision_authority.authorized, false);
  assert.equal(event.decision_authority.graph_promotion_allowed, false);
  assert.equal(event.permission_snapshot.external_action, false);
  assert.equal(event.payload.verification_evidence.evidence_sources[0], 'runner_direct');
  assert.equal(event.body_hash, sha256(canonicalJson(event.payload)));
  assert.match(event.source.ref, /^github:\/\/Unson-LLC\/example@/);
  assert.match(event.event_id, /^kev_[a-f0-9]{64}$/);
});

test('self-reported・stale・context以前のpassing evidenceからeventを作らない', async () => {
  const root = await makeRepo();
  await writeJson(path.join(root, 'handoff.json'), handoff());
  await bindBrainbaseContext(root, {
    storyId: STORY_ID,
    input: 'handoff.json',
    now: () => new Date('2026-08-30T00:00:02.000Z'),
  });
  const gitContext = await collectGitContext(root);
  const verificationPath = await resolvePrArtifactFile(root, STORY_ID, 'verification-evidence.json');

  await writeJson(verificationPath, {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    commands: [{
      kind: 'unit',
      status: 'pass',
      evidence_source: 'self_reported',
      executed_at: '2026-08-30T00:00:03.000Z',
      git_context: gitContext,
    }],
  });
  await assert.rejects(
    createBrainbaseKnowledgeEvent(root, { storyId: STORY_ID, summary: 'This should fail.' }),
    /computed passing verification evidence/,
  );

  await writeJson(verificationPath, {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    commands: [{
      kind: 'unit',
      status: 'pass',
      evidence_source: 'runner_direct',
      executed_at: '2026-08-30T00:00:01.000Z',
      git_context: gitContext,
    }],
  });
  await assert.rejects(
    createBrainbaseKnowledgeEvent(root, { storyId: STORY_ID, summary: 'This should also fail.' }),
    /computed passing verification evidence/,
  );

  await writeFile(path.join(root, 'index.js'), 'export const value = 2;\n');
  await writeJson(verificationPath, {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    commands: [{
      kind: 'unit',
      status: 'pass',
      evidence_source: 'runner_direct',
      executed_at: '2026-08-30T00:00:03.000Z',
      git_context: gitContext,
    }],
  });
  await assert.rejects(
    createBrainbaseKnowledgeEvent(root, { storyId: STORY_ID, summary: 'This is stale.' }),
    /computed passing verification evidence/,
  );
});

test('managed inboxを自動検出し、Story add前にreceipt bindを完了する', async () => {
  const root = await makeRepo();
  const { head } = await configureManagedBrainbase(root);

  const story = await addStory(root, {
    story_id: STORY_ID,
    title: 'Managed Brainbase handoff'
  });
  assert.equal(story.story_id, STORY_ID);

  const contextPath = path.join(root, '.vibepro', 'integrations', 'brainbase', STORY_ID, 'context.json');
  const bindReceiptPath = path.join(root, '.vibepro', 'integrations', 'brainbase', STORY_ID, 'bind-receipt.json');
  const context = JSON.parse(await readFile(contextPath, 'utf8'));
  const bindReceipt = JSON.parse(await readFile(bindReceiptPath, 'utf8'));
  assert.equal(context.story_id, STORY_ID);
  assert.equal(context.repository, 'github://Unson-LLC/example');
  assert.equal(context.base_sha, head);
  assert.equal(bindReceipt.resolution_id, 'jr_test');
  assert.equal(bindReceipt.story_id, STORY_ID);
  assert.equal(bindReceipt.repository, 'github://Unson-LLC/example');
  assert.equal(bindReceipt.base_sha, head);
  const inboxReceipt = JSON.parse(await readFile(path.join(root, '.vibepro', 'integrations', 'brainbase', 'inbox', 'handoff.json'), 'utf8'));
  assert.equal(inboxReceipt.story_id, null);
});

test('公開importは不完全Story宣言を渡せず、標準CLI Story addだけが署名済みmanaged v2を原子的に宣言・検証・投影する', async () => {
  const root = await makeRepo();
  const expectedOutcomeCase = outcomeCase();
  await configureManagedBrainbase(root, {
    receipt: { schemaVersion: 'brainbase-vibepro-managed-handoff.v2', managedOutcomeCase: expectedOutcomeCase }
  });

  // The declaration capability is not an exported binding API. The one public
  // add operation accepts normalized CLI fields only, so an importer cannot
  // smuggle an incomplete prebuilt Story into the v2 publication transaction.
  const integration = await import('../src/brainbase-integration.js');
  assert.equal(Object.hasOwn(integration, 'ensureBrainbaseStoryAddBinding'), false);
  await assert.rejects(
    integration.addBrainbaseBoundStory(root, {
      story_id: STORY_ID,
      title: 'Attempted direct declaration',
      storyDeclaration: { story_id: STORY_ID }
    }),
    (error) => error?.code === 'BRAINBASE_STORY_DECLARATION_FORBIDDEN'
  );
  const beforeCli = JSON.parse(await readFile(path.join(root, '.vibepro', 'config.json'), 'utf8'));
  assert.equal(beforeCli.brainbase.stories.some((story) => story.story_id === STORY_ID), false);

  const result = await runCli(['story', 'add', root, '--id', STORY_ID, '--title', 'Managed v2 CLI declaration']);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.story.outcome_case, expectedOutcomeCase);

  const config = JSON.parse(await readFile(path.join(root, '.vibepro', 'config.json'), 'utf8'));
  const stored = config.brainbase.stories.find((story) => story.story_id === STORY_ID);
  const context = JSON.parse(await readFile(path.join(root, '.vibepro', 'integrations', 'brainbase', STORY_ID, 'context.json'), 'utf8'));
  const marker = JSON.parse(await readFile(path.join(root, '.vibepro', 'integrations', 'brainbase', STORY_ID, 'bind-commit.json'), 'utf8'));
  assert.deepEqual(stored.outcome_case, expectedOutcomeCase);
  assert.deepEqual(context.outcome_case, expectedOutcomeCase);
  assert.equal(marker.context_digest, context.context_digest);
  const traceability = JSON.parse(await readFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'traceability.json'), 'utf8'));
  assert.equal(traceability.source, 'story_add');
  assert.equal(traceability.lifecycle, 'declared_not_started');
  const prepared = await preparePullRequest(root, { storyId: STORY_ID, baseRef: 'HEAD' });
  assert.equal(prepared.preparation.outcome_case_status, 'trusted');
  assert.equal(prepared.preparation.outcome_case.case_id, expectedOutcomeCase.case_id);
  assert.equal(prepared.preparation.outcome_case.technical_complete, false);
});

test('managed v2 Story addはtraceability失敗後に同一の完全宣言だけを冪等に再開する', async () => {
  const root = await makeRepo();
  const expectedOutcomeCase = outcomeCase();
  await configureManagedBrainbase(root, {
    receipt: { schemaVersion: 'brainbase-vibepro-managed-handoff.v2', managedOutcomeCase: expectedOutcomeCase }
  });
  const storyOptions = {
    story_id: STORY_ID,
    title: 'Resume managed v2 traceability'
  };

  await assert.rejects(
    addStory(root, { ...storyOptions, traceabilityFailureAt: 'traceability' }),
    (error) => error?.code === 'BRAINBASE_STORY_TRACEABILITY_INJECTED_FAILURE'
  );

  const configPath = path.join(root, '.vibepro', 'config.json');
  const contextPath = path.join(root, '.vibepro', 'integrations', 'brainbase', STORY_ID, 'context.json');
  const markerPath = path.join(root, '.vibepro', 'integrations', 'brainbase', STORY_ID, 'bind-commit.json');
  const ledgerPath = path.join(root, '.vibepro', 'integrations', 'brainbase', 'handoff-consumption-ledger.json');
  const traceabilityPath = path.join(root, '.vibepro', 'pr', STORY_ID, 'traceability.json');
  const persisted = JSON.parse(await readFile(configPath, 'utf8'));
  const stored = persisted.brainbase.stories.find((story) => story.story_id === STORY_ID);
  assert.deepEqual(stored.outcome_case, expectedOutcomeCase);
  assert.equal(JSON.parse(await readFile(contextPath, 'utf8')).outcome_case.case_id, expectedOutcomeCase.case_id);
  assert.notEqual(await readFile(markerPath, 'utf8').catch(() => null), null);
  assert.equal(await readFile(traceabilityPath, 'utf8').catch(() => null), null);
  const beforeResume = await Promise.all([readFile(configPath, 'utf8'), readFile(contextPath, 'utf8'), readFile(markerPath, 'utf8'), readFile(ledgerPath, 'utf8')]);

  const resumed = await addStory(root, storyOptions);
  assert.deepEqual(resumed, stored);
  const traceability = JSON.parse(await readFile(traceabilityPath, 'utf8'));
  assert.equal(traceability.source, 'story_add');
  assert.equal(traceability.lifecycle, 'declared_not_started');
  const afterResume = await Promise.all([readFile(configPath, 'utf8'), readFile(contextPath, 'utf8'), readFile(markerPath, 'utf8'), readFile(ledgerPath, 'utf8')]);
  assert.deepEqual(afterResume, beforeResume, 'resume must not repeat managed publication side effects');
  assert.equal(JSON.parse(afterResume[3]).entries.length, 1);
});

test('Story add traceability再開は宣言不一致・未信頼v2・v1を拒否する', async () => {
  const mismatchedRoot = await makeRepo();
  await configureManagedBrainbase(mismatchedRoot, {
    receipt: { schemaVersion: 'brainbase-vibepro-managed-handoff.v2', managedOutcomeCase: outcomeCase() }
  });
  await assert.rejects(
    addStory(mismatchedRoot, { story_id: STORY_ID, title: 'Exact declaration', traceabilityFailureAt: 'traceability' }),
    (error) => error?.code === 'BRAINBASE_STORY_TRACEABILITY_INJECTED_FAILURE'
  );
  await assert.rejects(
    addStory(mismatchedRoot, { story_id: STORY_ID, title: 'Different declaration' }),
    (error) => error?.code === 'BRAINBASE_STORY_ADD_RESUME_NOT_ELIGIBLE'
  );

  const untrustedRoot = await makeRepo();
  await configureManagedBrainbase(untrustedRoot, {
    receipt: { schemaVersion: 'brainbase-vibepro-managed-handoff.v2', managedOutcomeCase: outcomeCase() }
  });
  await assert.rejects(
    addStory(untrustedRoot, { story_id: STORY_ID, title: 'Untrusted resume', traceabilityFailureAt: 'traceability' }),
    (error) => error?.code === 'BRAINBASE_STORY_TRACEABILITY_INJECTED_FAILURE'
  );
  const untrustedConfigPath = path.join(untrustedRoot, '.vibepro', 'config.json');
  const untrustedConfig = JSON.parse(await readFile(untrustedConfigPath, 'utf8'));
  untrustedConfig.brainbase.stories.find((story) => story.story_id === STORY_ID).outcome_case.user_observable_outcome = 'tampered but structurally valid';
  await writeJson(untrustedConfigPath, untrustedConfig);
  await assert.rejects(
    addStory(untrustedRoot, { story_id: STORY_ID, title: 'Untrusted resume' }),
    (error) => error?.code === 'BRAINBASE_STORY_ADD_RESUME_NOT_ELIGIBLE'
  );

  const v1Root = await makeRepo();
  await writeJson(path.join(v1Root, 'handoff.json'), handoff());
  await addStory(v1Root, { story_id: STORY_ID, title: 'v1 resume' });
  await bindBrainbaseContext(v1Root, { storyId: STORY_ID, input: 'handoff.json' });
  await unlink(path.join(v1Root, '.vibepro', 'pr', STORY_ID, 'traceability.json'));
  await assert.rejects(
    addStory(v1Root, { story_id: STORY_ID, title: 'v1 resume' }),
    (error) => error?.code === 'BRAINBASE_STORY_ADD_RESUME_NOT_ELIGIBLE'
  );
});

test('対象Storyのcanonical Specはmanaged v2 traceability再開契約と改訂メタデータを直接保持する', async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const specPath = path.join(repoRoot, '.vibepro', 'spec', OUTCOME_CASE_BINDING_STORY_ID, 'spec.json');
  const spec = JSON.parse(await readFile(specPath, 'utf8'));
  const clause = spec.clauses.find((item) => item.id === 'C-003');
  assert.equal(spec.story_id, OUTCOME_CASE_BINDING_STORY_ID);
  assert.match(clause.statement, /traceability.*再開/);
  assert.ok(clause.origin.test_refs.some((reference) => (
    reference.file === 'test/brainbase-integration.test.js'
    && reference.case === 'managed v2 Story addはtraceability失敗後に同一の完全宣言だけを冪等に再開する'
  )));
  assert.ok(Number.isFinite(Date.parse(clause.last_revised_at)));
  assert.ok(Number.isFinite(Date.parse(spec.generated_at)));
  assert.equal(clause.last_revised_at, spec.generated_at);
});

test('未結合receiptの複数候補と消費済みreceiptの別Story再利用をfail closedする', async () => {
  const ambiguousRoot = await makeRepo();
  await configureManagedBrainbase(ambiguousRoot);
  const inbox = path.join(ambiguousRoot, '.vibepro', 'integrations', 'brainbase', 'inbox');
  const firstReceipt = JSON.parse(await readFile(path.join(inbox, 'handoff.json'), 'utf8'));
  await writeJson(path.join(inbox, 'second.json'), firstReceipt);
  await assert.rejects(
    addStory(ambiguousRoot, { story_id: STORY_ID, title: 'Ambiguous managed handoff' }),
    /ambiguous/i
  );
  const ambiguousConfig = JSON.parse(await readFile(path.join(ambiguousRoot, '.vibepro', 'config.json'), 'utf8'));
  assert.equal(ambiguousConfig.brainbase.stories.some((story) => story.story_id === STORY_ID), false);

  const consumedRoot = await makeRepo();
  await configureManagedBrainbase(consumedRoot);
  await addStory(consumedRoot, { story_id: STORY_ID, title: 'Consumed managed handoff' });
  const consumedConfigPath = path.join(consumedRoot, '.vibepro', 'config.json');
  const consumedConfig = JSON.parse(await readFile(consumedConfigPath, 'utf8'));
  consumedConfig.brainbase.stories.push({ story_id: 'another-story', title: 'Should not reuse receipt', status: 'active' });
  await writeJson(consumedConfigPath, consumedConfig);
  await assert.rejects(
    selectStory(consumedRoot, 'another-story'),
    /already consumed|already bound/i
  );
  const ledger = JSON.parse(await readFile(path.join(consumedRoot, '.vibepro', 'integrations', 'brainbase', 'handoff-consumption-ledger.json'), 'utf8'));
  assert.equal(ledger.entries.length, 1);
  assert.equal(ledger.entries[0].story_id, STORY_ID);
});

test('managed設定でhandoff inboxがない場合はStory addをfail closedする', async () => {
  const root = await makeRepo();
  const configPath = path.join(root, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.brainbase = {
    ...(config.brainbase ?? {}),
    managed: true,
    project_code: 'brainbase',
    repository: 'github://Unson-LLC/example'
  };
  await writeJson(configPath, config);

  await assert.rejects(
    addStory(root, { story_id: STORY_ID, title: 'Missing managed handoff' }),
    /handoff.*(missing|required)|managed.*receipt/i
  );
  const unchanged = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(unchanged.brainbase.stories.some((item) => item.story_id === STORY_ID), false);
});

test('managed handoffのproject_code不一致はStory select前にfail closedする', async () => {
  const root = await makeRepo();
  await configureManagedBrainbase(root, { receipt: { projectCode: 'other-project' } });
  const configPath = path.join(root, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.brainbase.stories.push({ story_id: STORY_ID, title: 'Project mismatch', status: 'active' });
  await writeJson(configPath, config);

  await assert.rejects(
    selectStory(root, STORY_ID),
    /project[_ ]code.*mismatch|project.*mismatch/i
  );
  const unchanged = JSON.parse(await readFile(configPath, 'utf8'));
  assert.notEqual(unchanged.brainbase.current_story_id, STORY_ID);
});

test('managed handoffのbase_shaがcurrent HEADと一致しない場合はStory addをfail closedする', async () => {
  const root = await makeRepo();
  await configureManagedBrainbase(root, { receipt: { baseSha: '0'.repeat(40) } });

  await assert.rejects(
    addStory(root, { story_id: STORY_ID, title: 'HEAD mismatch' }),
    /HEAD.*mismatch|base_sha.*mismatch|base.*HEAD/i
  );
});

test('managed handoffの期限切れ・不正HMAC・自己申告trustedはStory addをfail closedする', async (t) => {
  const expiredRoot = await makeRepo();
  await configureManagedBrainbase(expiredRoot, {
    receipt: { expiresAt: '2026-08-30T00:00:00.000Z' }
  });
  await assert.rejects(
    addStory(expiredRoot, {
      story_id: STORY_ID,
      title: 'Expired managed handoff',
      now: () => new Date('2026-09-01T00:00:00.000Z')
    }),
    /expired/i
  );

  const invalidRoot = await makeRepo();
  await configureManagedBrainbase(invalidRoot);
  const invalidPath = path.join(invalidRoot, '.vibepro', 'integrations', 'brainbase', 'inbox', 'handoff.json');
  const invalid = JSON.parse(await readFile(invalidPath, 'utf8'));
  invalid.signature.value = '0'.repeat(64);
  await writeJson(invalidPath, invalid);
  await assert.rejects(
    addStory(invalidRoot, { story_id: STORY_ID, title: 'Invalid HMAC' }),
    /HMAC|signature/i
  );

  const selfClaimRoot = await makeRepo();
  await configureManagedBrainbase(selfClaimRoot);
  const selfClaimPath = path.join(selfClaimRoot, '.vibepro', 'integrations', 'brainbase', 'inbox', 'handoff.json');
  const selfClaim = JSON.parse(await readFile(selfClaimPath, 'utf8'));
  selfClaim.signature = { algorithm: 'sha256', value: selfClaim.receipt_digest, trusted: true };
  await writeJson(selfClaimPath, selfClaim);
  await assert.rejects(
    addStory(selfClaimRoot, { story_id: STORY_ID, title: 'Self claimed trust' }),
    /HMAC|signature|trusted/i
  );
  t.diagnostic('managed receipt validation rejects expiry, forged HMAC, and self-reported trust');
});

async function writeComputedPassingEvidence(root, storyId, executedAt = '2026-08-30T00:00:04.000Z') {
  const gitContext = await collectGitContext(root);
  const verificationPath = await resolvePrArtifactFile(root, storyId, 'verification-evidence.json');
  await writeJson(verificationPath, {
    schema_version: '0.1.0',
    story_id: storyId,
    updated_at: executedAt,
    commands: [{
      kind: 'unit',
      status: 'pass',
      command: 'node --test test/brainbase-integration.test.js',
      summary: 'computed pass',
      evidence_source: 'runner_direct',
      executed_at: executedAt,
      git_context: gitContext,
    }],
  });
  return {
    command: JSON.parse(await readFile(verificationPath, 'utf8')).commands[0],
    evidence: JSON.parse(await readFile(verificationPath, 'utf8')),
    gitContext,
  };
}

test('computed passing verificationはcurrent HEADでLearning Candidateを一度だけoutboxへ積む', async () => {
  const root = await makeRepo();
  await configureManagedBrainbase(root);
  await addStory(root, {
    story_id: STORY_ID,
    title: 'Learning candidate',
    now: () => new Date('2026-08-30T00:00:02.000Z')
  });
  const { command, evidence, gitContext } = await writeComputedPassingEvidence(root, STORY_ID);

  const first = await enqueueBrainbaseLearningCandidate(root, {
    storyId: STORY_ID,
    command,
    previousCommand: null,
    evidence,
    gitContext,
    now: () => new Date('2026-08-30T00:00:05.000Z')
  });
  assert.equal(first.status, 'generated');
  assert.equal(first.outbox_status, 'enqueued');

  const second = await enqueueBrainbaseLearningCandidate(root, {
    storyId: STORY_ID,
    command,
    previousCommand: command,
    evidence,
    gitContext,
    now: () => new Date('2026-08-30T00:00:06.000Z')
  });
  assert.equal(second.status, 'not_applicable');
  const eventPath = path.join(root, '.vibepro', 'integrations', 'brainbase', STORY_ID, 'knowledge-event.json');
  const event = JSON.parse(await readFile(eventPath, 'utf8'));
  assert.equal(event.trace.turn_id, 'turn-test');
  assert.equal(event.trace.resolution_id, 'jr_test');
  assert.equal(event.trace.story_id, STORY_ID);
  assert.equal(event.trace.verified_head_sha, gitContext.head_sha);
  assert.equal(event.trace.reuse_receipt.status, 'unknown');
  assert.equal(event.trace.reuse_receipt.implementation, 'unimplemented');
  assert.equal(event.decision_authority.authorized, false);
  assert.equal(event.decision_authority.graph_promotion_allowed, false);
  const outboxFiles = (await readdir(path.join(root, '.vibepro', 'integrations', 'brainbase', 'outbox'))).filter((name) => name.endsWith('.json'));
  assert.equal(outboxFiles.length, 1);
});

test('Learning Candidate送信失敗はverify成功を止めずpending+retryにし、reconcileで送信する', async () => {
  const root = await makeRepo();
  await configureManagedBrainbase(root);
  await addStory(root, {
    story_id: STORY_ID,
    title: 'Transient candidate delivery',
    now: () => new Date('2026-08-30T00:00:02.000Z')
  });
  const { command, evidence, gitContext } = await writeComputedPassingEvidence(root, STORY_ID);
  let attempts = 0;
  const first = await enqueueBrainbaseLearningCandidate(root, {
    storyId: STORY_ID,
    command,
    previousCommand: null,
    evidence,
    gitContext,
    now: () => new Date('2026-08-30T00:00:05.000Z'),
    retryDelayMs: 1,
    send: async () => {
      attempts += 1;
      throw new Error('temporary transport failure');
    }
  });
  assert.equal(first.status, 'generated');
  assert.equal(first.delivery.status, 'partial');
  assert.equal(first.delivery.pending, 1);
  assert.equal(attempts, 1);

  const retried = await reconcileBrainbaseOutbox(root, {
    now: () => new Date('2026-08-30T00:00:06.000Z'),
    send: async () => {
      attempts += 1;
    }
  });
  assert.equal(retried.status, 'ok');
  assert.equal(retried.sent, 1);
  assert.equal(attempts, 2);
  const outboxFile = (await readdir(path.join(root, '.vibepro', 'integrations', 'brainbase', 'outbox'))).find((name) => name.endsWith('.json'));
  const outbox = JSON.parse(await readFile(path.join(root, '.vibepro', 'integrations', 'brainbase', 'outbox', outboxFile), 'utf8'));
  assert.equal(outbox.delivery_status, 'sent');
  assert.equal(outbox.attempts, 2);
});

test('status/doctor/reconcile CLIはmanaged inboxと旧bind/event入口を互換表示する', async () => {
  const root = await makeRepo();
  await configureManagedBrainbase(root);
  const output = () => {
    let value = '';
    return { stream: { write: (chunk) => { value += chunk; } }, get value() { return value; } };
  };
  const statusOut = output();
  const status = await runCli(['integration', 'brainbase', 'status', root, '--id', STORY_ID, '--json'], {
    stdout: statusOut.stream,
    stderr: output().stream,
    env: {}
  });
  assert.equal(status.exitCode, 0);
  assert.equal(JSON.parse(statusOut.value).status, 'managed');

  const doctorOut = output();
  const doctorBeforeBind = await runCli(['integration', 'brainbase', 'doctor', root, '--id', STORY_ID, '--json'], {
    stdout: doctorOut.stream,
    stderr: output().stream,
    env: {}
  });
  assert.equal(doctorBeforeBind.exitCode, 1);
  assert.equal(JSON.parse(doctorOut.value).status, 'fail');

  await addStory(root, { story_id: STORY_ID, title: 'CLI managed story' });
  const doctorAfterBindOut = output();
  const doctorAfterBind = await runCli(['integration', 'brainbase', 'doctor', root, '--id', STORY_ID, '--json'], {
    stdout: doctorAfterBindOut.stream,
    stderr: output().stream,
    env: {}
  });
  assert.equal(doctorAfterBind.exitCode, 0);
  assert.equal(JSON.parse(doctorAfterBindOut.value).status, 'warn');

  const reconcileOut = output();
  const reconciled = await runCli(['integration', 'brainbase', 'reconcile', root, '--json'], {
    stdout: reconcileOut.stream,
    stderr: output().stream,
    env: {}
  });
  assert.equal(reconciled.exitCode, 0);
  assert.equal(JSON.parse(reconcileOut.value).status, 'ok');
});

test('status・doctor・Story reportは成果ケース信頼性を未評価と明示し、PR準備へ誘導する', async () => {
  const root = await makeRepo();
  await addStory(root, { story_id: STORY_ID, title: 'Outcome projection disclosure' });
  const { config } = await configureManagedBrainbase(root);
  await bindBrainbaseContext(root, {
    storyId: STORY_ID,
    input: '.vibepro/integrations/brainbase/inbox/handoff.json',
    config,
    now: () => new Date('2026-08-30T00:00:02.000Z')
  });

  const status = await getBrainbaseIntegrationStatus(root, { storyId: STORY_ID });
  assert.deepEqual(status.binding.outcome_case_projection, {
    status: 'not_evaluated',
    reason_code: 'pr_prepare_required',
    reference: `vibepro pr prepare ${root} --story-id ${STORY_ID}`
  });
  assert.match(renderBrainbaseIntegrationStatus(status), /Outcome case projection: not_evaluated/);
  assert.match(renderBrainbaseIntegrationStatus(status), /vibepro pr prepare/);
  const doctor = await doctorBrainbaseIntegration(root, { storyId: STORY_ID });
  assert.equal(doctor.status, 'warn');
  assert.deepEqual(doctor.checks.find((check) => check.id === 'outcome_case_projection'), {
    id: 'outcome_case_projection',
    status: 'unknown',
    code: 'OUTCOME_CASE_PROJECTION_NOT_EVALUATED',
    detail: 'outcome-case trust and commit marker are evaluated only by pr prepare',
    reference: `vibepro pr prepare ${root} --story-id ${STORY_ID}`
  });
  assert.match(renderBrainbaseDoctor(doctor), /unknown: outcome_case_projection/);
  assert.match(renderBrainbaseDoctor(doctor), /vibepro pr prepare/);

  const report = renderStoryReport({
    story: { story_id: STORY_ID, title: 'Outcome projection disclosure', status: 'active' },
    latestRun: { run_id: 'run-test', artifacts: {} },
    runs: [],
    evidence: {}
  });
  assert.match(report, /## Outcome Case Projection/);
  assert.match(report, /Status \| not_evaluated/);
  assert.match(report, /vibepro pr prepare/);
});
