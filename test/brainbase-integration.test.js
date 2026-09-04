import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { resolvePrArtifactFile } from '../src/artifact-routing.js';
import {
  bindBrainbaseContext,
  canonicalManagedHandoffPayload,
  canonicalJson,
  createBrainbaseKnowledgeEvent,
  doctorBrainbaseIntegration,
  enqueueBrainbaseLearningCandidate,
  getBrainbaseIntegrationStatus,
  reconcileBrainbaseOutbox,
  sha256,
} from '../src/brainbase-integration.js';
import { collectGitContext } from '../src/git-fingerprint.js';
import { runCli } from '../src/cli.js';
import { addStory, selectStory } from '../src/story-manager.js';
import { initWorkspace } from '../src/workspace.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-brainbase-runtime-context-handoff';
const TEST_HANDOFF_HMAC_SECRET = 'vibepro-test-handoff-hmac-secret';

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

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
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
  hmacSecret = TEST_HANDOFF_HMAC_SECRET
} = {}) {
  const payload = {
    schema_version: 'brainbase-vibepro-managed-handoff.v1',
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
    graph_promotion_allowed: false
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
  assert.equal(retried.status, 'pending');
  assert.equal(retried.unconfirmed, 1);
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
  assert.equal(JSON.parse(doctorAfterBindOut.value).status, 'pass');

  const reconcileOut = output();
  const reconciled = await runCli(['integration', 'brainbase', 'reconcile', root, '--json'], {
    stdout: reconcileOut.stream,
    stderr: output().stream,
    env: {}
  });
  assert.equal(reconciled.exitCode, 0);
  assert.equal(JSON.parse(reconcileOut.value).status, 'ok');
});
