import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { preparePullRequest } from '../src/pr-manager.js';
import {
  buildResponsibilityAuthorityGate,
  resolveResponsibilityAuthority
} from '../src/responsibility-authority.js';

const execFileAsync = promisify(execFile);

test('resolver matches cleanup responsibility contract and blocks without current evidence', async () => {
  const repo = await makeFixtureRepo();
  await writeResponsibilityFixture(repo);
  await writeFile(path.join(repo, 'src', 'cleanup-worker.js'), `
export function cleanup(task) {
  if (task.projectStatus !== 'processable') return 'CANCELED';
  return task.status;
}
`);

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/cleanup-worker.js'] },
    fileGroups: { source: { files: ['src/cleanup-worker.js'] } },
    changeClassification: { risk_surfaces: ['core_workflow_state', 'queue_worker'] },
    storySource: {
      title: 'Protect pending production generation',
      content: 'GenerationTask.PENDING with metadata.awaitingProductionGenerationStart=true must not be canceled by cleanup.',
      acceptance_criteria: []
    }
  });

  assert.equal(result.status, 'needs_evidence');
  assert.equal(result.summary.matched_responsibility_count, 1);
  assert.equal(result.matched_responsibilities[0].id, 'generation.cleanup.cancellation_policy');
  assert.deepEqual(result.matched_responsibilities[0].matched_by.sort(), ['domain_contract', 'path', 'risk_surface', 'symbol'].sort());
  assert.equal(result.matched_responsibilities[0].contract_clauses[0].ref, 'docs/contracts/generation-state.json#GEN-STATE-001');
  assert.deepEqual(result.matched_responsibilities[0].missing_evidence.sort(), ['cleanup_recovery_replay', 'current_head_verification', 'unit_regression'].sort());

  const gate = buildResponsibilityAuthorityGate(result);
  assert.equal(gate.id, 'gate:responsibility_authority');
  assert.equal(gate.status, 'needs_evidence');
  assert.equal(gate.required, true);
  assert.equal(gate.missing_evidence.length, 3);
});

test('resolver passes matched contract when current-head evidence is bound to required observations', async () => {
  const repo = await makeFixtureRepo();
  await writeResponsibilityFixture(repo);
  await writeFile(path.join(repo, 'src', 'cleanup-worker.js'), 'export const symbol = "metadata.awaitingProductionGenerationStart";\n');

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/cleanup-worker.js'] },
    fileGroups: { source: { files: ['src/cleanup-worker.js'] } },
    changeClassification: { risk_surfaces: ['core_workflow_state'] },
    verificationEvidence: {
      commands: [
        {
          kind: 'unit',
          status: 'pass',
          command: 'npm test -- cleanup-recovery',
          summary: 'unit regression for cleanup recovery replay GEN-STATE-001',
          binding: { status: 'current' },
          observation: {
            targets: ['GEN-STATE-001'],
            scenarios: ['cleanup recovery replay preserves pending production generation']
          }
        }
      ]
    }
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.summary.missing_evidence_count, 0);
  assert.equal(buildResponsibilityAuthorityGate(result).status, 'passed');
});

test('resolver does not satisfy contract evidence with unrelated generic unit pass', async () => {
  const repo = await makeFixtureRepo();
  await writeResponsibilityFixture(repo);
  await writeFile(path.join(repo, 'src', 'cleanup-worker.js'), 'export const symbol = "metadata.awaitingProductionGenerationStart";\n');

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/cleanup-worker.js'] },
    fileGroups: { source: { files: ['src/cleanup-worker.js'] } },
    changeClassification: { risk_surfaces: ['core_workflow_state'] },
    verificationEvidence: {
      commands: [
        {
          kind: 'unit',
          status: 'pass',
          command: 'node --test unrelated.test.js',
          summary: 'unrelated smoke test',
          binding: { status: 'current' },
          observation: {
            targets: ['test/unrelated.test.js'],
            scenarios: ['unrelated smoke path']
          }
        }
      ]
    }
  });

  assert.equal(result.status, 'needs_evidence');
  assert.deepEqual(result.matched_responsibilities[0].missing_evidence.sort(), ['cleanup_recovery_replay', 'unit_regression'].sort());
  assert.deepEqual(result.matched_responsibilities[0].matched_evidence.map((item) => item.evidence), ['current_head_verification']);
  assert.equal(buildResponsibilityAuthorityGate(result).status, 'needs_evidence');
});

test('resolver emits no_registered_authority for unregistered high-risk state surfaces', async () => {
  const repo = await makeFixtureRepo();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'recovery-worker.js'), 'export function recover(task) { task.status = "CANCELED"; }\n');

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/recovery-worker.js'] },
    fileGroups: { source: { files: ['src/recovery-worker.js'] } },
    changeClassification: { risk_surfaces: ['queue_worker'] },
    storySource: { content: 'recovery worker updates task state', acceptance_criteria: [] }
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.summary.unregistered_candidate_count, 1);
  assert.equal(result.unregistered_candidates[0].id, 'no_registered_authority');
  assert.equal(buildResponsibilityAuthorityGate(result).status, 'needs_review');
});

test('resolver keeps no_registered_authority for mixed matched and unregistered high-risk paths', async () => {
  const repo = await makeFixtureRepo();
  await writeResponsibilityFixture(repo);
  await writeFile(path.join(repo, 'src', 'cleanup-worker.js'), 'export const symbol = "metadata.awaitingProductionGenerationStart";\n');
  await writeFile(path.join(repo, 'src', 'payment-status-worker.js'), 'export function markPaid(task) { task.status = "PAID"; }\n');

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/cleanup-worker.js', 'src/payment-status-worker.js'] },
    fileGroups: { source: { files: ['src/cleanup-worker.js', 'src/payment-status-worker.js'] } },
    changeClassification: { risk_surfaces: ['core_workflow_state', 'queue_worker'] },
    verificationEvidence: {
      commands: [
        {
          kind: 'unit',
          status: 'pass',
          command: 'npm test -- cleanup-recovery',
          summary: 'unit regression for cleanup recovery replay GEN-STATE-001',
          binding: { status: 'current' },
          observation: {
            targets: ['GEN-STATE-001'],
            scenarios: ['cleanup recovery replay preserves pending production generation']
          }
        }
      ]
    }
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.summary.matched_responsibility_count, 1);
  assert.equal(result.summary.unregistered_candidate_count, 1);
  assert.deepEqual(result.unregistered_candidates[0].paths, ['src/payment-status-worker.js']);
  assert.equal(buildResponsibilityAuthorityGate(result).status, 'needs_review');
});

test('resolver fails closed when matched registry entry is missing required fields', async () => {
  const repo = await makeFixtureRepo();
  await writeFile(path.join(repo, 'responsibility-authority.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    responsibilities: [
      {
        id: 'billing.payment_status',
        owned_surfaces: {
          paths: ['src/*payment*']
        }
      }
    ]
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'src', 'payment-status-worker.js'), 'export function markPaid(task) { task.status = "PAID"; }\n');

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/payment-status-worker.js'] },
    fileGroups: { source: { files: ['src/payment-status-worker.js'] } },
    changeClassification: { risk_surfaces: ['queue_worker'] }
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.summary.invalid_registry_entry_count, 1);
  assert.equal(result.matched_responsibilities[0].evidence_status, 'invalid_registry');
  assert.deepEqual(result.matched_responsibilities[0].validation_errors.sort(), [
    'primary_authority is required',
    'required_evidence is required',
    'unknown_policy is required'
  ].sort());
  const gate = buildResponsibilityAuthorityGate(result);
  assert.equal(gate.status, 'needs_review');
  assert.deepEqual(gate.invalid_registry_entries[0].validation_errors.sort(), result.matched_responsibilities[0].validation_errors.sort());
});

test('resolver fails closed on malformed responsibility registry JSON', async () => {
  const repo = await makeFixtureRepo();
  await writeFile(path.join(repo, 'responsibility-authority.json'), '{ "responsibilities": [');

  await assert.rejects(
    () => resolveResponsibilityAuthority(repo, {
      git: { changed_files: ['src/cleanup-worker.js'] },
      fileGroups: { source: { files: ['src/cleanup-worker.js'] } },
      changeClassification: { risk_surfaces: ['core_workflow_state'] }
    }),
    SyntaxError
  );
});

test('pr prepare projects responsibility authority into Gate DAG before Requirement Gate', async () => {
  const repo = await makeFixtureRepo();
  await writeStoryDocs(repo);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'Add story docs']);
  await git(repo, ['switch', '-c', 'feature/responsibility-authority-fixture']);
  await writeResponsibilityFixture(repo);
  await writeFile(path.join(repo, 'src', 'cleanup-worker.js'), `
export function cleanup(task) {
  if (task.projectStatus !== 'processable') return 'CANCELED';
  return task.status;
}
`);

  const result = await preparePullRequest(repo, {
    storyId: 'story-rar-fixture',
    baseRef: 'main',
    branchName: 'feature/responsibility-authority-fixture',
    evidenceDepth: 'summary'
  });
  const preparation = result.preparation;
  const gateDag = preparation.pr_context.gate_dag;
  const gate = gateDag.nodes.find((node) => node.id === 'gate:responsibility_authority');
  const edge = gateDag.edges.find((item) => item.from === 'gate:responsibility_authority' && item.to === 'gate:requirement');

  assert.ok(gate);
  assert.equal(gate.type, 'responsibility_authority_gate');
  assert.equal(gate.status, 'needs_evidence');
  assert.equal(gate.required, true);
  assert.ok(edge);
  assert.equal(gateDag.summary.responsibility_authority_status, 'needs_evidence');
  assert.equal(preparation.gate_status.ready_for_pr_create, false);
  assert.ok(preparation.pr_context.requirement_consistency.summary.responsibility_authority_ref_count >= 1);
});

async function makeFixtureRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-rar-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await git(repo, ['config', 'user.name', 'Test User']);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'README.md'), '# Fixture\n');
  await git(repo, ['add', 'README.md']);
  await git(repo, ['commit', '-m', 'Initial commit']);
  return repo;
}

async function writeStoryDocs(repo) {
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-rar-fixture.md'), `---
story_id: story-rar-fixture
title: Responsibility authority fixture
architecture_docs:
  - docs/architecture/rar-fixture.md
spec_docs:
  - docs/specs/rar-fixture.md
---

# Responsibility authority fixture

## Background

Cleanup must preserve pending production generation tasks.

## Acceptance Criteria

- GenerationTask.PENDING with metadata.awaitingProductionGenerationStart=true is not canceled by cleanup/recovery.
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'rar-fixture.md'), '# RAR fixture architecture\n\nADR不要: fixture keeps existing boundaries.\n');
  await writeFile(path.join(repo, 'docs', 'specs', 'rar-fixture.md'), '# RAR fixture spec\n\nThe cleanup contract must preserve pending production generation state.\n');
}

async function writeResponsibilityFixture(repo) {
  await mkdir(path.join(repo, 'docs', 'contracts'), { recursive: true });
  await writeFile(path.join(repo, 'responsibility-authority.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    responsibilities: [
      {
        id: 'generation.cleanup.cancellation_policy',
        primary_authority: {
          kind: 'domain_contract',
          ref: 'docs/contracts/generation-state.json#GEN-STATE-001'
        },
        supporting_authority: ['docs/architecture/rar-fixture.md'],
        owned_surfaces: {
          paths: ['src/*cleanup*', 'src/*recovery*'],
          symbols: ['GenerationTask.PENDING', 'metadata.awaitingProductionGenerationStart'],
          risk_surfaces: ['core_workflow_state']
        },
        required_evidence: ['unit_regression', 'cleanup_recovery_replay', 'current_head_verification'],
        unknown_policy: 'block_or_review'
      }
    ]
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'docs', 'contracts', 'generation-state.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    domain: 'generation',
    clauses: [
      {
        id: 'GEN-STATE-001',
        statement: 'cleanup/recovery must not cancel GenerationTask.PENDING while metadata.awaitingProductionGenerationStart=true',
        applies_to: {
          responsibility: 'generation.cleanup.cancellation_policy',
          paths: ['src/*cleanup*', 'src/*recovery*'],
          symbols: ['GenerationTask.PENDING', 'metadata.awaitingProductionGenerationStart'],
          risk_surfaces: ['core_workflow_state']
        },
        evidence_requirements: ['cleanup_recovery_replay']
      }
    ]
  }, null, 2)}\n`);
}

async function git(cwd, args) {
  await execFileAsync('git', args, { cwd });
}
