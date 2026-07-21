import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { preparePullRequest } from '../src/pr-manager.js';
import {
  buildResponsibilityAuthorityGate,
  resolveResponsibilityAuthority
} from '../src/responsibility-authority.js';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  assert.deepEqual(result.matched_responsibilities[0].matched_by.sort(), ['domain_contract', 'path', 'risk_surface'].sort());
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

test('resolver accepts verify-record git context and observed values as current responsibility evidence', async () => {
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
          command: 'npm test',
          summary: 'full suite passed for responsibility contracts',
          git_context: {
            head_sha: 'abc123',
            dirty: false
          },
          observation: {
            targets: ['test/**/*.js', 'docs/contracts/generation-state.json', 'GEN-STATE-001'],
            scenarios: ['full responsibility authority regression suite'],
            values: {
              unit_regression: 'pass',
              cleanup_recovery_replay: 'pass'
            }
          }
        }
      ]
    }
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.summary.missing_evidence_count, 0);
  assert.equal(buildResponsibilityAuthorityGate(result).status, 'passed');
});

test('resolver accepts evidence whose user scope is clean while generated artifacts leave the raw worktree dirty', async () => {
  const repo = await makeFixtureRepo();
  await writeResponsibilityFixture(repo);
  await writeFile(path.join(repo, 'src', 'cleanup-worker.js'), 'export const symbol = "metadata.awaitingProductionGenerationStart";\n');

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/cleanup-worker.js'] },
    fileGroups: { source: { files: ['src/cleanup-worker.js'] } },
    changeClassification: { risk_surfaces: ['core_workflow_state'] },
    verificationEvidence: {
      commands: [{
        kind: 'unit',
        status: 'pass',
        command: 'npm test',
        summary: 'unit_regression cleanup_recovery_replay GEN-STATE-001',
        git_context: {
          head_sha: 'abc123',
          // `dirty` is the user-dirty scope. `raw_dirty` remains diagnostic
          // evidence that a current generated projection was rendered.
          dirty: false,
          raw_dirty: true,
          user_status_fingerprint_hash: 'generated-projection-excluded'
        },
        observation: {
          targets: ['GEN-STATE-001'],
          scenarios: ['cleanup recovery replay']
        }
      }]
    }
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.summary.missing_evidence_count, 0);
});

test('resolver still rejects current-head evidence when the user-dirty scope contains a manual edit', async () => {
  const repo = await makeFixtureRepo();
  await writeResponsibilityFixture(repo);
  await writeFile(path.join(repo, 'src', 'cleanup-worker.js'), 'export const symbol = "metadata.awaitingProductionGenerationStart";\n');

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/cleanup-worker.js'] },
    fileGroups: { source: { files: ['src/cleanup-worker.js'] } },
    changeClassification: { risk_surfaces: ['core_workflow_state'] },
    verificationEvidence: {
      commands: [{
        kind: 'unit',
        status: 'pass',
        command: 'npm test',
        summary: 'unit_regression cleanup_recovery_replay GEN-STATE-001',
        git_context: {
          head_sha: 'abc123',
          dirty: true,
          raw_dirty: true,
          user_status_fingerprint_hash: 'manual-edit'
        },
        observation: {
          targets: ['GEN-STATE-001'],
          scenarios: ['cleanup recovery replay']
        }
      }]
    }
  });

  assert.equal(result.status, 'stale');
  assert.deepEqual(result.matched_responsibilities[0].stale_evidence.sort(), ['cleanup_recovery_replay', 'current_head_verification', 'unit_regression'].sort());
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

test('resolver accepts generic current unit evidence for read-only audit reporting responsibilities', async () => {
  const repo = await makeFixtureRepo();
  await writeReadOnlyReportingResponsibilityFixture(repo);
  await writeFile(path.join(repo, 'src', 'evidence-reuse.js'), 'export const artifact_value_ledger = "read-only report";\n');

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/evidence-reuse.js'] },
    fileGroups: { source: { files: ['src/evidence-reuse.js'] } },
    changeClassification: { risk_surfaces: ['audit_reporting'] },
    verificationEvidence: {
      commands: [
        {
          kind: 'unit',
          status: 'pass',
          command: 'node --test test/evidence-summary-reuse.test.js',
          summary: 'unit_regression read_only_audit_reporting_regression',
          binding: { status: 'current' },
          observation: {
            targets: ['src/evidence-reuse.js'],
            scenarios: ['artifact value ledger read-only reporting remains current-head bound']
          }
        }
      ]
    }
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.summary.matched_responsibility_count, 1);
  assert.deepEqual(result.matched_responsibilities[0].required_evidence, ['unit_regression', 'current_head_verification']);
  assert.equal(result.summary.missing_evidence_count, 0);
  assert.equal(buildResponsibilityAuthorityGate(result).status, 'passed');
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

test('resolver uses the accepted Run-lineage Architecture registry contract', async () => {
  const result = await resolveResponsibilityAuthority(REPO_ROOT, {
    git: {
      changed_files: [
        'src/human-decision-checkpoint.js',
        'src/run-context-capsule.js',
        'src/run-lineage.js'
      ]
    },
    fileGroups: {
      source: {
        files: [
          'src/human-decision-checkpoint.js',
          'src/run-context-capsule.js',
          'src/run-lineage.js'
        ]
      }
    },
    changeClassification: {
      risk_surfaces: ['core_workflow_state', 'verification_evidence', 'review_lifecycle']
    },
    storySource: {
      title: 'Thread分離に依存せずRun lineageでstory attributionを確定する',
      content: 'Guarded Run lineage authority and context capsule handoff',
      acceptance_criteria: []
    }
  });

  const matched = result.matched_responsibilities.find((item) => item.id === 'vibepro.run_lineage.explicit_attribution');
  assert.ok(matched);
  assert.equal(matched.primary_authority.ref, 'docs/architecture/story-vibepro-explicit-run-attribution-lineage.md#architecture');
  assert.deepEqual(matched.owned_surfaces.paths, [
    'src/run-lineage.js',
    'src/run-context-capsule.js',
    'src/human-decision-checkpoint.js'
  ]);
  assert.equal(result.unregistered_candidates.some((item) => item.paths.some((file) => matched.owned_surfaces.paths.includes(file))), false);
});

test('resolver does not classify derive-only workspace status as an unregistered state responsibility', async () => {
  const repo = await makeFixtureRepo();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeReviewedWorkspaceStatus(repo);

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/workspace-status.js'] },
    fileGroups: { source: { files: ['src/workspace-status.js'] } },
    changeClassification: { risk_surfaces: ['polling_retry'] },
    storySource: { content: 'derive readiness without writes or polling', acceptance_criteria: [] }
  });

  assert.equal(result.status, 'not_applicable');
  assert.equal(result.summary.unregistered_candidate_count, 0);
  assert.equal(buildResponsibilityAuthorityGate(result).status, 'not_applicable');
});

test('resolver fails closed when workspace status contains a state mutation', async () => {
  const repo = await makeFixtureRepo();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'workspace-status.js'), `
export function updateStatus(task) {
  task.status = 'active_ready';
}
`);

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/workspace-status.js'] },
    fileGroups: { source: { files: ['src/workspace-status.js'] } },
    changeClassification: { risk_surfaces: ['core_workflow_state'] },
    storySource: { content: 'workspace status updates task state', acceptance_criteria: [] }
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.summary.unregistered_candidate_count, 1);
  assert.equal(result.unregistered_candidates[0].id, 'no_registered_authority');
  assert.deepEqual(result.unregistered_candidates[0].paths, ['src/workspace-status.js']);
});

test('resolver applies workspace status exemption without hiding unregistered CLI wiring', async () => {
  const repo = await makeFixtureRepo();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeReviewedWorkspaceStatus(repo);
  await writeFile(path.join(repo, 'src', 'cli.js'), 'export { status } from "./workspace-status.js";\n');

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/workspace-status.js', 'src/cli.js'] },
    fileGroups: { source: { files: ['src/workspace-status.js', 'src/cli.js'] } },
    changeClassification: { risk_surfaces: ['polling_retry'] },
    storySource: { content: 'derive readiness without writes or polling', acceptance_criteria: [] }
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.summary.unregistered_candidate_count, 1);
  assert.deepEqual(result.unregistered_candidates[0].paths, ['src/cli.js']);
});

test('resolver retains a mixed worker candidate beside read-only workspace status', async () => {
  const repo = await makeFixtureRepo();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeReviewedWorkspaceStatus(repo);
  await writeFile(path.join(repo, 'src', 'recovery-worker.js'), 'export function recover(task) { task.status = "CANCELED"; }\n');

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/workspace-status.js', 'src/recovery-worker.js'] },
    fileGroups: { source: { files: ['src/workspace-status.js', 'src/recovery-worker.js'] } },
    changeClassification: { risk_surfaces: ['queue_worker'] },
    storySource: { content: 'derive status while a recovery worker updates state', acceptance_criteria: [] }
  });

  assert.equal(result.status, 'needs_review');
  assert.deepEqual(result.unregistered_candidates[0].paths, ['src/recovery-worker.js']);
});

test('resolver fails closed when reviewed workspace status gains an indirect git side effect', async () => {
  const repo = await makeFixtureRepo();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  const reviewedSource = await readFile(path.join(REPO_ROOT, 'src', 'workspace-status.js'), 'utf8');
  await writeFile(
    path.join(repo, 'src', 'workspace-status.js'),
    `${reviewedSource}\nexport async function refresh(repo) { return git(repo, ['fetch']); }\n`
  );

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/workspace-status.js'] },
    fileGroups: { source: { files: ['src/workspace-status.js'] } },
    changeClassification: { risk_surfaces: ['core_workflow_state'] },
    storySource: { content: 'derive readiness after refreshing remote state', acceptance_criteria: [] }
  });

  assert.equal(result.status, 'needs_review');
  assert.deepEqual(result.unregistered_candidates[0].paths, ['src/workspace-status.js']);
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

test('root registry resolves VibePro core responsibility authorities with contract-bound evidence', async () => {
  const cases = [
    {
      id: 'vibepro.pr_lifecycle.execution',
      changedPath: 'src/merge-manager.js',
      evidence: 'pr_lifecycle_regression',
      clause: 'VIBE-CORE-PR-001'
    },
    {
      id: 'vibepro.agent_review.lifecycle',
      changedPath: 'src/agent-review.js',
      evidence: 'agent_review_lifecycle_regression',
      clause: 'VIBE-CORE-AR-001'
    },
    {
      id: 'vibepro.verification.evidence_lifecycle',
      changedPath: 'src/verification-evidence.js',
      evidence: 'evidence_lifecycle_regression',
      clause: 'VIBE-CORE-EV-001'
    },
    {
      id: 'vibepro.story_source.integrity',
      changedPath: 'src/story-manager.js',
      evidence: 'story_source_integrity_regression',
      clause: 'VIBE-CORE-STORY-001'
    },
    {
      id: 'vibepro.repo_status.guidance',
      changedPath: 'src/repo-status.js',
      evidence: ['unit_regression', 'typecheck'],
      clause: 'VIBE-CORE-STATUS-001'
    },
    {
      id: 'vibepro.engineering_judgment.route_axes',
      changedPath: 'src/change-risk-classifier.js',
      evidence: 'engineering_judgment_regression',
      clause: 'VIBE-CORE-JUDGE-001'
    },
    {
      id: 'vibepro.managed_worktree.execution_locality',
      changedPath: 'src/managed-worktree-gate.js',
      evidence: 'managed_worktree_regression',
      clause: 'VIBE-CORE-WT-001'
    }
  ];

  for (const item of cases) {
    const evidenceTokens = Array.isArray(item.evidence) ? item.evidence : [item.evidence];
    const evidenceSummary = evidenceTokens.join(' ');
    const result = await resolveResponsibilityAuthority(REPO_ROOT, {
      git: { changed_files: [item.changedPath] },
      fileGroups: { source: { files: [item.changedPath] } },
      changeClassification: { risk_surfaces: [] },
      storySource: {
        content: `${item.id} ${item.clause}`,
        acceptance_criteria: []
      },
      verificationEvidence: {
        commands: [
          {
            kind: 'unit',
            status: 'pass',
            command: `node --test test/responsibility-authority.test.js -- ${evidenceSummary}`,
            summary: `${evidenceSummary} covers ${item.clause}`,
            binding: { status: 'current' },
            observation: {
              targets: [item.changedPath, item.clause],
              scenarios: evidenceTokens
            }
          }
        ]
      }
    });

    const matched = result.matched_responsibilities.find((responsibility) => responsibility.id === item.id);
    assert.ok(matched, `${item.id} should match ${item.changedPath}`);
    assert.equal(matched.evidence_status, 'passed');
    assert.deepEqual(matched.missing_evidence, []);
    assert.equal(matched.contract_clauses.some((clause) => clause.ref.endsWith(`#${item.clause}`)), true);
    for (const evidenceToken of evidenceTokens) {
      assert.equal(matched.matched_evidence.some((evidence) => evidence.evidence === evidenceToken), true);
    }
  }
});

test('resolver does not fan out a shared risk surface across path-anchored responsibilities', async () => {
  const repo = await makeFixtureRepo();
  await writeFile(path.join(repo, 'responsibility-authority.json'), `${JSON.stringify({
    responsibilities: [
      responsibilityEntry('generation.retry', ['src/retry-worker.js'], ['queue_worker']),
      responsibilityEntry('billing.worker', ['src/billing-worker.js'], ['queue_worker'])
    ]
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'src', 'retry-worker.js'), 'export function retry() { return true; }\n');

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/retry-worker.js'] },
    fileGroups: { source: { files: ['src/retry-worker.js'] } },
    changeClassification: { risk_surfaces: ['queue_worker'] }
  });

  assert.deepEqual(result.matched_responsibilities.map((item) => item.id), ['generation.retry']);
  assert.deepEqual(result.matched_responsibilities[0].matched_by.sort(), ['path', 'risk_surface']);
});

test('resolver preserves standalone risk matching for an explicitly risk-only responsibility', async () => {
  const repo = await makeFixtureRepo();
  await writeFile(path.join(repo, 'responsibility-authority.json'), `${JSON.stringify({
    responsibilities: [responsibilityEntry('operations.queue', [], ['queue_worker'])]
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'src', 'retry-worker.js'), 'export const value = true;\n');

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/retry-worker.js'] },
    fileGroups: { source: { files: ['src/retry-worker.js'] } },
    changeClassification: { risk_surfaces: ['queue_worker'] }
  });

  assert.deepEqual(result.matched_responsibilities.map((item) => item.id), ['operations.queue']);
  assert.deepEqual(result.matched_responsibilities[0].matched_by, ['risk_surface']);
  assert.equal(result.summary.unregistered_candidate_count, 0);
  assert.equal(result.status, 'needs_evidence');
});

test('resolver lets a contract clause path supplement a non-matching registry path', async () => {
  const repo = await makeFixtureRepo();
  await mkdir(path.join(repo, 'docs', 'contracts'), { recursive: true });
  await writeFile(path.join(repo, 'responsibility-authority.json'), `${JSON.stringify({
    responsibilities: [responsibilityEntry('generation.retry', ['src/legacy-retry.js'], ['queue_worker'], 'docs/contracts/retry.json#RETRY-001')]
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'docs', 'contracts', 'retry.json'), `${JSON.stringify({
    domain: 'generation',
    clauses: [{
      id: 'RETRY-001',
      statement: 'retry scheduling remains bounded',
      applies_to: { responsibility: 'generation.retry', paths: ['src/retry-scheduler.js'], risk_surfaces: ['queue_worker'] }
    }]
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'src', 'retry-scheduler.js'), 'export function scheduleRetry() { return true; }\n');

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/retry-scheduler.js'] },
    fileGroups: { source: { files: ['src/retry-scheduler.js'] } },
    changeClassification: { risk_surfaces: ['queue_worker'] }
  });

  assert.deepEqual(result.matched_responsibilities.map((item) => item.id), ['generation.retry']);
  assert.deepEqual(result.matched_responsibilities[0].matched_by, ['domain_contract']);
  assert.equal(result.matched_responsibilities[0].contract_clauses[0].id, 'RETRY-001');
});

test('resolver matches symbols only in changed production lines', async () => {
  const repo = await makeFixtureRepo();
  await writeFile(path.join(repo, 'responsibility-authority.json'), `${JSON.stringify({
    responsibilities: [{
      ...responsibilityEntry('generation.retry', [], []),
      owned_surfaces: { paths: [], symbols: ['scheduleRetry'], risk_surfaces: [] }
    }]
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'src', 'retry.js'), 'export function scheduleRetry() { return 1; }\nexport const unchanged = true;\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'Add retry fixture']);
  const { stdout: baseSha } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repo });
  await writeFile(path.join(repo, 'src', 'retry.js'), 'export function scheduleRetry() { return 1; }\nexport const unchanged = false;\n');

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/retry.js'], merge_base_sha: baseSha.trim() },
    fileGroups: { source: { files: ['src/retry.js'] } },
    changeClassification: { risk_surfaces: [] }
  });

  assert.equal(result.summary.matched_responsibility_count, 0);
});

test('resolver matches a symbol added on a changed production line', async () => {
  const repo = await makeFixtureRepo();
  await writeFile(path.join(repo, 'responsibility-authority.json'), `${JSON.stringify({
    responsibilities: [{
      ...responsibilityEntry('generation.retry', [], []),
      owned_surfaces: { paths: [], symbols: ['scheduleRetry'], risk_surfaces: [] }
    }]
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'src', 'retry.js'), 'export const unchanged = true;\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'Add retry fixture']);
  const { stdout: baseSha } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repo });
  await writeFile(path.join(repo, 'src', 'retry.js'), 'export const unchanged = true;\nexport function scheduleRetry() { return 1; }\n');

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/retry.js'], merge_base_sha: baseSha.trim() },
    fileGroups: { source: { files: ['src/retry.js'] } },
    changeClassification: { risk_surfaces: [] }
  });

  assert.deepEqual(result.matched_responsibilities.map((item) => item.id), ['generation.retry']);
  assert.deepEqual(result.matched_responsibilities[0].matched_by, ['symbol']);
});

test('resolver fails closed for symbol matching when the production diff cannot be read', async () => {
  const repo = await makeFixtureRepo();
  await writeFile(path.join(repo, 'responsibility-authority.json'), `${JSON.stringify({
    responsibilities: [{
      ...responsibilityEntry('generation.retry', [], []),
      owned_surfaces: { paths: [], symbols: ['scheduleRetry'], risk_surfaces: [] }
    }]
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'src', 'retry.js'), 'export function scheduleRetry() { return 1; }\n');

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/retry.js'], merge_base_sha: 'not-a-valid-revision' },
    fileGroups: { source: { files: ['src/retry.js'] } },
    changeClassification: { risk_surfaces: [] }
  });

  assert.equal(result.summary.matched_responsibility_count, 0);
});

test('resolver fails closed for symbol matching when no diff base is provided', async () => {
  const repo = await makeFixtureRepo();
  await writeFile(path.join(repo, 'responsibility-authority.json'), `${JSON.stringify({
    responsibilities: [{
      ...responsibilityEntry('generation.retry', [], []),
      owned_surfaces: { paths: [], symbols: ['scheduleRetry'], risk_surfaces: [] }
    }]
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'src', 'retry.js'), 'export function scheduleRetry() { return 1; }\n');

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/retry.js'] },
    fileGroups: { source: { files: ['src/retry.js'] } },
    changeClassification: { risk_surfaces: [] }
  });

  assert.equal(result.summary.matched_responsibility_count, 0);
});

test('resolver compares an explicit head even when another branch is checked out', async () => {
  const repo = await makeFixtureRepo();
  await writeFile(path.join(repo, 'responsibility-authority.json'), `${JSON.stringify({
    responsibilities: [{
      ...responsibilityEntry('generation.retry', [], []),
      owned_surfaces: { paths: [], symbols: ['scheduleRetry'], risk_surfaces: [] }
    }]
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'src', 'retry.js'), 'export const unchanged = true;\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'Add base fixture']);
  const { stdout: baseSha } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repo });
  await git(repo, ['switch', '-c', 'target-head']);
  await writeFile(path.join(repo, 'src', 'retry.js'), 'export const unchanged = true;\nexport function scheduleRetry() { return 1; }\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'Add retry symbol']);
  const { stdout: headSha } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repo });
  await git(repo, ['switch', 'main']);

  const result = await resolveResponsibilityAuthority(repo, {
    git: {
      changed_files: ['src/retry.js'],
      merge_base_sha: baseSha.trim(),
      head_sha: headSha.trim(),
      includes_dirty_in_changed_files: false
    },
    fileGroups: { source: { files: ['src/retry.js'] } },
    changeClassification: { risk_surfaces: [] }
  });

  assert.deepEqual(result.matched_responsibilities.map((item) => item.id), ['generation.retry']);
});

test('resolver matches a symbol in an untracked production file', async () => {
  const repo = await makeFixtureRepo();
  await writeFile(path.join(repo, 'responsibility-authority.json'), `${JSON.stringify({
    responsibilities: [{
      ...responsibilityEntry('generation.retry', [], []),
      owned_surfaces: { paths: [], symbols: ['scheduleRetry'], risk_surfaces: [] }
    }]
  }, null, 2)}\n`);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'Add registry fixture']);
  const { stdout: baseSha } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repo });
  await writeFile(path.join(repo, 'src', 'retry.js'), 'export function scheduleRetry() { return 1; }\n');

  const result = await resolveResponsibilityAuthority(repo, {
    git: {
      changed_files: ['src/retry.js'],
      merge_base_sha: baseSha.trim(),
      includes_dirty_in_changed_files: true
    },
    fileGroups: { source: { files: ['src/retry.js'] } },
    changeClassification: { risk_surfaces: [] }
  });

  assert.deepEqual(result.matched_responsibilities.map((item) => item.id), ['generation.retry']);
});

test('resolver ignores registered symbols that appear only in test files or story text', async () => {
  const repo = await makeFixtureRepo();
  await writeFile(path.join(repo, 'responsibility-authority.json'), `${JSON.stringify({
    responsibilities: [{
      ...responsibilityEntry('generation.retry', [], []),
      owned_surfaces: { paths: [], symbols: ['scheduleRetry'], risk_surfaces: [] }
    }]
  }, null, 2)}\n`);
  await mkdir(path.join(repo, 'test'), { recursive: true });
  await writeFile(path.join(repo, 'test', 'retry.test.js'), 'assert.equal(scheduleRetry(), true);\n');

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['test/retry.test.js'] },
    fileGroups: { tests: { files: ['test/retry.test.js'] } },
    changeClassification: { risk_surfaces: [] },
    storySource: { content: 'scheduleRetry must remain covered', acceptance_criteria: [] }
  });

  assert.equal(result.summary.matched_responsibility_count, 0);
});

test('resolver does not match a contract from responsibility reference alone', async () => {
  const repo = await makeFixtureRepo();
  await mkdir(path.join(repo, 'docs', 'contracts'), { recursive: true });
  await writeFile(path.join(repo, 'responsibility-authority.json'), `${JSON.stringify({
    responsibilities: [responsibilityEntry('generation.retry', ['src/retry-worker.js'], ['queue_worker'], 'docs/contracts/retry.json#RETRY-001')]
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'docs', 'contracts', 'retry.json'), `${JSON.stringify({
    domain: 'generation',
    clauses: [{
      id: 'RETRY-001',
      statement: 'retry scheduling remains bounded',
      applies_to: { responsibility: 'generation.retry', paths: ['src/retry-worker.js'], risk_surfaces: ['queue_worker'] }
    }]
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'src', 'other-worker.js'), 'export function work() { return true; }\n');

  const result = await resolveResponsibilityAuthority(repo, {
    git: { changed_files: ['src/other-worker.js'] },
    fileGroups: { source: { files: ['src/other-worker.js'] } },
    changeClassification: { risk_surfaces: ['queue_worker'] }
  });

  assert.equal(result.summary.matched_responsibility_count, 0);
  assert.equal(result.status, 'needs_review');
  assert.equal(result.unregistered_candidates[0].id, 'no_registered_authority');
});

test('pr prepare keeps shared-risk authority matching precise through Gate DAG and Requirement synthesis', async () => {
  const repo = await makeFixtureRepo();
  await writeStoryDocs(repo);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'Add story docs']);
  await git(repo, ['switch', '-c', 'feature/responsibility-authority-fixture']);
  await writeResponsibilityFixture(repo);
  const registryPath = path.join(repo, 'responsibility-authority.json');
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  registry.responsibilities.push({
    ...responsibilityEntry(
      'billing.cleanup.cancellation_policy',
      ['src/billing-worker.js'],
      ['core_workflow_state'],
      'docs/specs/billing-cleanup.md'
    ),
    required_evidence: ['unit_regression', 'current_head_verification']
  });
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
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
  const authority = preparation.pr_context.responsibility_authority;
  const requirementAuthority = preparation.pr_context.requirement_consistency.responsibility_authority;

  assert.ok(gate);
  assert.equal(gate.type, 'responsibility_authority_gate');
  assert.equal(gate.status, 'needs_evidence');
  assert.equal(gate.required, true);
  assert.equal(authority.summary.matched_responsibility_count, 1);
  assert.deepEqual(authority.matched_responsibilities.map((item) => item.id), [
    'generation.cleanup.cancellation_policy'
  ]);
  assert.deepEqual(gate.matched_responsibilities.map((item) => item.id), [
    'generation.cleanup.cancellation_policy'
  ]);
  assert.deepEqual(requirementAuthority.matched_responsibilities.map((item) => item.id), [
    'generation.cleanup.cancellation_policy'
  ]);
  assert.ok(edge);
  assert.equal(gateDag.summary.responsibility_authority_status, 'needs_evidence');
  assert.equal(preparation.gate_status.ready_for_pr_create, false);
  assert.equal(preparation.pr_context.requirement_consistency.summary.responsibility_authority_ref_count, 1);
});

async function writeReviewedWorkspaceStatus(repo) {
  const source = await readFile(path.join(REPO_ROOT, 'src', 'workspace-status.js'), 'utf8');
  await writeFile(path.join(repo, 'src', 'workspace-status.js'), source);
}

function responsibilityEntry(id, paths, riskSurfaces, authorityRef = 'docs/specs/responsibility.md') {
  return {
    id,
    primary_authority: authorityRef,
    owned_surfaces: {
      paths,
      symbols: [],
      risk_surfaces: riskSurfaces
    },
    required_evidence: ['unit_regression'],
    unknown_policy: 'block_or_review'
  };
}

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

async function writeReadOnlyReportingResponsibilityFixture(repo) {
  await mkdir(path.join(repo, 'docs', 'contracts'), { recursive: true });
  await writeFile(path.join(repo, 'responsibility-authority.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    responsibilities: [
      {
        id: 'vibepro.evidence_reuse.reporting',
        primary_authority: {
          kind: 'domain_contract',
          ref: 'docs/contracts/audit-reporting.json#AUDIT-REPORT-001'
        },
        supporting_authority: ['docs/architecture/rar-fixture.md'],
        owned_surfaces: {
          paths: ['src/evidence-reuse.js'],
          symbols: ['artifact_value_ledger'],
          risk_surfaces: ['audit_reporting']
        },
        required_evidence: ['unit_regression', 'deep_review_required', 'current_head_verification'],
        unknown_policy: 'block_or_review'
      }
    ]
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'docs', 'contracts', 'audit-reporting.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    domain: 'audit-reporting',
    clauses: [
      {
        id: 'AUDIT-REPORT-001',
        statement: 'read-only audit reporting must stay current-head bound without requiring high-risk workflow replay',
        applies_to: {
          responsibility: 'vibepro.evidence_reuse.reporting',
          paths: ['src/evidence-reuse.js'],
          symbols: ['artifact_value_ledger'],
          risk_surfaces: ['audit_reporting']
        },
        evidence_requirements: ['read_only_audit_reporting_regression']
      }
    ]
  }, null, 2)}\n`);
}

async function git(cwd, args) {
  await execFileAsync('git', args, { cwd });
}
