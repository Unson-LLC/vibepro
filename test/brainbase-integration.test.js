import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { resolvePrArtifactFile } from '../src/artifact-routing.js';
import {
  bindBrainbaseContext,
  canonicalJson,
  createBrainbaseKnowledgeEvent,
  sha256,
} from '../src/brainbase-integration.js';
import { collectGitContext } from '../src/git-fingerprint.js';
import { initWorkspace } from '../src/workspace.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-brainbase-runtime-context-handoff';

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
    allowed_runtime_escalation_reasons: [
      'irreversible_action',
      'missing_authority',
      'owner_value_choice',
      'required_input_unavailable',
      'evidenced_terminal_blocker',
    ],
    runtime_version: '2.1.0',
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
  const capabilityInput = receipt.required_capabilities[0]?.input;
  const route = capabilityInput?.content_type === 'canonical_fact'
    ? { source_class: 'graph', retrieval_capability: 'graph.search', source_ref: 'graph://decision/decision-1' }
    : { source_class: 'owning_repo', retrieval_capability: 'repository.read', source_ref: 'github://Unson-LLC/brainbase-unson/docs/guide.md' };
  return {
    schema_version: 'brainbase-vibepro-context-handoff.v1',
    story_id: STORY_ID,
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
