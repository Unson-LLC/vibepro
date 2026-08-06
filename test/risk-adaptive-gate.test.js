import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { classifyChangeRisk } from '../src/change-risk-classifier.js';
import { runCli } from '../src/cli.js';
import { bugPhysicsVerificationText, buildArtifactConsistencyGate } from '../src/pr-manager.js';

const execFileAsync = promisify(execFile);

test('artifact consistency preserves stale non-required reviews as nonblocking history', () => {
  const gate = buildArtifactConsistencyGate({
    git: {
      head_sha: 'current-head',
      status_fingerprint_hash: hashFingerprint('current'),
      user_status_fingerprint_hash: hashFingerprint('current-user'),
      dirty: false,
      raw_dirty: false
    },
    verificationEvidence: { commands: [] },
    agentReviews: {
      required_reviews: [{ stage: 'gate', role: 'gate_evidence' }],
      checkpoint_required_reviews: [],
      risk_adaptive_coverage: {
        duplicate_checkpoint_roles_suppressed: ['architecture_spec:architecture_boundary'],
        validation_sequence_review_roles: []
      },
      stages: [
        {
          stage: 'architecture_spec',
          roles: [{
            role: 'architecture_boundary',
            artifact: '.vibepro/reviews/story/architecture_spec/review-result-architecture_boundary.json',
            effective_status: 'stale',
            stale_reason: 'strict HEAD review was recorded for old-head, current head is current-head',
            git_context: { head_sha: 'old-head' }
          }]
        },
        {
          stage: 'gate',
          roles: [{
            role: 'gate_evidence',
            artifact: '.vibepro/reviews/story/gate/review-result-gate_evidence.json',
            effective_status: 'pass',
            git_context: { head_sha: 'current-head' }
          }]
        }
      ]
    },
    storyId: 'story'
  });

  assert.equal(gate.status, 'passed');
  assert.equal(gate.inconsistent_artifact_count, 0);
  assert.equal(
    gate.artifacts.find((artifact) => artifact.role === 'architecture_boundary').status,
    'historical_nonblocking'
  );
  assert.equal(
    gate.artifacts.find((artifact) => artifact.role === 'gate_evidence').status,
    'current'
  );
  assert.match(gate.reason, /historical nonblocking/);
});

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function hashFingerprint(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function cleanGitFingerprintHash() {
  return hashFingerprint('git-status --porcelain -uall\n\ngit-diff --binary\n');
}

async function gitFingerprintHash(repo) {
  const [status, diff, untracked] = await Promise.all([
    git(repo, ['status', '--porcelain', '-uall']),
    git(repo, ['diff', '--binary']),
    collectUntrackedFingerprint(repo)
  ]);
  const dirtyDiff = [diff.stdout.trimEnd(), untracked].filter(Boolean).join('\n');
  return hashFingerprint([
    'git-status --porcelain -uall',
    status.stdout.trimEnd(),
    'git-diff --binary',
    dirtyDiff
  ].join('\n'));
}

async function collectUntrackedFingerprint(repo) {
  const output = await git(repo, ['ls-files', '--others', '--exclude-standard']);
  const files = output.stdout.split('\n').filter(Boolean).sort().slice(0, 200);
  const chunks = [];
  for (const file of files) {
    chunks.push(`untracked:${file}\n${await readFile(path.join(repo, file), 'utf8')}`);
  }
  return chunks.join('\n');
}

async function makeGitRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-risk-gate-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Risk Gate</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli([
    'init',
    root,
    '--story-id',
    'story-risk-adaptive',
    '--title',
    'Risk Adaptive Gate',
    '--view',
    'dev',
    '--period',
    '2026-05'
  ]);
  const configPath = path.join(root, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.agent_reviews = {
    ...(config.agent_reviews ?? {}),
    defaults: {
      ...(config.agent_reviews?.defaults ?? {}),
      validation_sequence_owns_checkpoints: true
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'chore: init risk gate repo']);
  await git(root, ['switch', '-c', 'feature/risk-gate']);
  return root;
}

test('change classifier selects workflow_heavy for cross-surface workflow changes', () => {
  const result = classifyChangeRisk({
    storySource: {
      title: 'FORM sample preflight workflow',
      background: 'Start detection, poll status, retry failures, and resume generation across auth and v1 compatibility.',
      acceptance_criteria: ['Generation must wait until workflow state is ready.']
    },
    fileGroups: {
      source: {
        files: [
          'src/app/projects/[projectId]/components/PlanTab.tsx',
          'src/app/api/batch-jobs/[id]/generate-samples/route.ts',
          'src/lib/services/formProjectStartService.ts',
          'src/workers/formDetectionWorker.ts',
          'src/app/api/v1/projects/[projectId]/start/route.ts'
        ]
      },
      tests: { files: ['tests/e2e/story-risk-adaptive-flow.spec.ts'] },
      repo_control: { files: [] },
      story_docs: { files: [] },
      specifications: { files: [] }
    },
    networkContracts: { introduced_api_client_call_count: 1 }
  });

  assert.equal(result.profile, 'workflow_heavy');
  assert.equal(result.change_type, 'cross_surface_workflow_change');
  assert.ok(result.risk_surfaces.includes('frontend_interaction'));
  assert.ok(result.risk_surfaces.includes('server_api'));
  assert.ok(result.risk_surfaces.includes('queue_worker'));
  assert.ok(result.risk_surfaces.includes('legacy_v1_compatibility'));

  const gateDagChange = classifyChangeRisk({
    storySource: {
      title: 'Risk-adaptive Gate DAG',
      background: 'Gate workflow, review lifecycle, verification evidence, and release confidence must change together.'
    },
    fileGroups: {
      source: {
        files: [
          'src/pr-manager.js',
          'src/agent-review.js',
          'src/flow-verifier.js',
          'src/verification-evidence.js',
          'src/change-risk-classifier.js'
        ]
      },
      tests: { files: ['test/risk-adaptive-gate.test.js'] },
      repo_control: { files: [] },
      story_docs: { files: [] },
      specifications: { files: [] }
    }
  });
  assert.equal(gateDagChange.profile, 'workflow_heavy');
  assert.ok(gateDagChange.risk_surfaces.includes('gate_orchestration'));
  assert.ok(gateDagChange.risk_surfaces.includes('verification_evidence'));
  assert.ok(gateDagChange.risk_surfaces.includes('review_lifecycle'));

  const reviewRepairChange = classifyChangeRisk({
    fileGroups: {
      source: { files: ['src/agent-review.js'] },
      tests: { files: ['test/agent-review-independence.test.js'] }
    }
  });
  assert.ok(reviewRepairChange.risk_surfaces.includes('review_lifecycle'));

  const gateReviewBoundaryChange = classifyChangeRisk({
    storySource: {
      title: 'Atomic gate review contract',
      background: 'Gate evidence ownership and reviewer lifecycle must remain fail closed.'
    },
    fileGroups: {
      source: { files: ['src/pr-manager.js', 'src/agent-review.js'] },
      tests: { files: ['test/vibepro-cli.test.js'] }
    }
  });
  assert.equal(gateReviewBoundaryChange.profile, 'workflow_heavy');

  const gateOnlyBoundaryChange = classifyChangeRisk({
    storySource: { title: 'Atomic gate contract', background: 'Gate orchestration remains fail closed.' },
    fileGroups: {
      source: { files: ['src/pr-manager.js'] },
      tests: { files: ['test/vibepro-cli.test.js'] }
    }
  });
  assert.notEqual(gateOnlyBoundaryChange.profile, 'workflow_heavy');

  const validationSequenceOnlyChange = classifyChangeRisk({
    storySource: { title: 'Validation sequencing maintenance', background: 'Keep validation ordering correct.' },
    fileGroups: { source: { files: ['src/validation-sequencing.js'] }, tests: { files: [] } }
  });
  assert.ok(validationSequenceOnlyChange.risk_surfaces.includes('gate_orchestration'));

  const reviewOnlyBoundaryChange = classifyChangeRisk({
    storySource: { title: 'Review lifecycle contract', background: 'Reviewer lifecycle identity remains explicit.' },
    fileGroups: {
      source: { files: ['src/agent-review.js'] },
      tests: { files: ['test/agent-review-independence.test.js'] }
    }
  });
  assert.notEqual(reviewOnlyBoundaryChange.profile, 'workflow_heavy');

  const coreWorkflowChange = classifyChangeRisk({
    storySource: {
      title: 'Core workflow state transition hardening',
      background: 'Workflow preflight state transitions, resume replay, and release confidence change together.'
    },
    fileGroups: {
      source: {
        files: [
          'src/core/workflowStateMachine.ts',
          'src/core/preflightTransitionMatrix.ts',
          'src/core/resumeReplayController.ts'
        ]
      },
      tests: { files: ['tests/e2e/core-workflow-replay.spec.ts'] },
      repo_control: { files: [] },
      story_docs: { files: [] },
      specifications: { files: [] }
    }
  });
  assert.equal(coreWorkflowChange.profile, 'workflow_heavy');
  assert.ok(coreWorkflowChange.risk_surfaces.includes('core_workflow_state'));

  const executionStateChange = classifyChangeRisk({
    fileGroups: {
      source: { files: ['src/execution-state.js'] },
      tests: { files: [] }
    }
  });
  assert.equal(executionStateChange.profile, 'workflow_heavy');
  assert.ok(executionStateChange.risk_surfaces.includes('core_workflow_state'));
});

test('change classifier avoids workflow_heavy for narrow changes', () => {
  assert.equal(classifyChangeRisk({
    fileGroups: {
      source: { files: [] },
      tests: { files: [] },
      repo_control: { files: [] },
      story_docs: { files: ['docs/management/stories/active/story-doc-only.md'] },
      specifications: { files: [] }
    },
    storySource: {
      title: 'docs only',
      background: 'Document the queue retry auth legacy workflow state without changing runtime code.'
    }
  }).profile, 'light');

  assert.equal(classifyChangeRisk({
    fileGroups: {
      source: { files: ['src/app/api/users/route.ts'] },
      tests: { files: [] },
      repo_control: { files: [] },
      story_docs: { files: [] },
      specifications: { files: [] }
    },
    storySource: { title: 'API contract update' }
  }).profile, 'api_contract');

  assert.equal(classifyChangeRisk({
    fileGroups: {
      source: { files: ['src/components/UserCard.tsx'] },
      tests: { files: [] },
      repo_control: { files: [] },
      story_docs: { files: [] },
      specifications: { files: [] }
    },
    storySource: { title: 'UI label update' }
  }).profile, 'ui_interaction');

  assert.equal(classifyChangeRisk({
    fileGroups: {
      source: { files: ['src/components/UserCard.tsx'] },
      tests: { files: [] },
      repo_control: { files: [] },
      story_docs: { files: [] },
      specifications: { files: [] }
    },
    storySource: {
      title: 'UI card copy update',
      background: 'The product context mentions queue retry auth legacy workflow state, but this diff only changes a UI component.'
    }
  }).profile, 'ui_interaction');

  assert.equal(classifyChangeRisk({
    fileGroups: {
      source: { files: ['src/components/TaskStatusBadge.tsx'] },
      tests: { files: [] },
      repo_control: { files: [] },
      story_docs: { files: [] },
      specifications: { files: [] }
    },
    storySource: { title: 'Task status badge UI update' }
  }).profile, 'ui_interaction');
});

test('change classifier does not treat design authority files as auth boundary', () => {
  const authorityRegistry = classifyChangeRisk({
    fileGroups: {
      source: { files: ['src/responsibility-authority.js', 'src/pr-manager.js'] },
      tests: { files: [] },
      repo_control: { files: [] },
      story_docs: { files: [] },
      specifications: { files: [] }
    },
    storySource: {
      title: 'Responsibility Authority Registry',
      background: 'Resolve design authority for workflow gate contracts.'
    }
  });
  assert.equal(authorityRegistry.risk_surfaces.includes('auth_boundary'), false);
  assert.equal(authorityRegistry.risk_surfaces.includes('gate_orchestration'), true);

  const authRuntime = classifyChangeRisk({
    fileGroups: {
      source: { files: ['src/auth.js', 'src/authorization-scoring.js'] },
      tests: { files: [] },
      repo_control: { files: [] },
      story_docs: { files: [] },
      specifications: { files: [] }
    }
  });
  assert.equal(authRuntime.risk_surfaces.includes('auth_boundary'), true);
});

test('change classifier does not treat standalone session cost paths as auth boundary', () => {
  const sessionCost = classifyChangeRisk({
    fileGroups: {
      source: { files: ['src/session-cost.js'] },
      tests: { files: [] },
      repo_control: { files: [] },
      story_docs: { files: [] },
      specifications: { files: [] }
    },
    storySource: {
      title: 'Session Cost Accounting',
      background: 'Codex session-cost accounting parses session_meta elapsed-time events and LLM token usage.'
    }
  });
  assert.equal(sessionCost.risk_surfaces.includes('auth_boundary'), false);
  assert.equal(sessionCost.profile, 'light');
});

test('change classifier recognizes monorepo app runtime API source paths', () => {
  const result = classifyChangeRisk({
    fileGroups: {
      source: {
        files: [
          'apps/hono-api/src/lib/mastra/tools/zeims-knowledge-tool.ts',
          'apps/zeims-batch/src/routes/search/post.ts'
        ]
      },
      tests: { files: ['apps/zeims-batch/src/routes/search/post.spec.ts'] },
      repo_control: { files: [] },
      story_docs: { files: [] },
      specifications: { files: [] }
    },
    storySource: { title: 'Zeims tax judgment DAG' }
  });

  assert.equal(result.profile, 'api_contract');
  assert.ok(result.risk_surfaces.includes('server_api'));
  assert.ok(!result.reasons.includes('no runtime source files changed'));
});

test('change classifier marks Story Spec and test marker edits as low-risk evidence changes', () => {
  const docsOnly = classifyChangeRisk({
    fileGroups: {
      source: { files: [] },
      tests: { files: [] },
      story_docs: { files: ['docs/management/stories/active/story-risk-adaptive.md'] },
      specifications: { files: ['docs/specs/story-risk-adaptive.md'] }
    },
    storySource: {
      title: 'Risk-adaptive Gate DAG',
      background: 'Docs and Spec coverage are being clarified after existing runtime verification passed.'
    }
  });
  assert.equal(docsOnly.profile, 'light');
  assert.equal(docsOnly.change_type, 'low_risk_evidence_change');
  assert.equal(docsOnly.evidence_reuse_policy.allowed, true);
  assert.equal(docsOnly.evidence_reuse_policy.docs_only, true);
  assert.deepEqual(docsOnly.changed_surfaces.sort(), ['spec_docs', 'story_docs']);
  assert.deepEqual(docsOnly.changed_surface_files.spec_docs, ['docs/specs/story-risk-adaptive.md']);

  const markerOnly = classifyChangeRisk({
    fileGroups: {
      source: { files: [] },
      tests: { files: ['test/e2e/story-risk-adaptive-main.spec.ts'] },
      story_docs: { files: [] },
      specifications: { files: [] }
    },
    storySource: { title: 'Add AC marker coverage' }
  });
  assert.equal(markerOnly.change_type, 'low_risk_evidence_change');
  assert.deepEqual(markerOnly.evidence_reuse_policy.rerun_required_for, ['test/e2e/story-risk-adaptive-main.spec.ts']);
  assert.deepEqual(markerOnly.changed_surfaces, ['tests']);

  const metadataOnly = classifyChangeRisk({
    fileGroups: {
      source: { files: [] },
      tests: { files: [] },
      responsibility_authority_metadata: { files: ['responsibility-authority.json'] },
      contract_metadata: { files: ['docs/contracts/vibepro-core-responsibilities.json'] }
    }
  });
  assert.equal(metadataOnly.change_type, 'low_risk_evidence_change');
  assert.deepEqual(metadataOnly.changed_surfaces.sort(), ['contract_metadata', 'responsibility_authority_metadata']);
});

test('pr prepare groups monorepo apps src runtime files as source', async () => {
  const repo = await makeGitRepo();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'apps', 'hono-api', 'src', 'lib', 'mastra', 'tools'), { recursive: true });
  await mkdir(path.join(repo, 'apps', 'zeims-batch', 'src', 'routes', 'search'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-risk-adaptive.md'), `---
story_id: story-risk-adaptive
title: Zeims tax judgment DAG
architecture_docs:
  reason: monorepo runtime source fixture
---

# Zeims tax judgment DAG

## 背景

Tax judgment runtime changes span an API app and a batch route in a monorepo.

## 受け入れ基準

- [ ] Runtime source under apps/*/src is classified as source.
`);
  await writeFile(
    path.join(repo, 'apps', 'hono-api', 'src', 'lib', 'mastra', 'tools', 'zeims-knowledge-tool.ts'),
    'export function searchKnowledge(){ return "knowledge"; }\n'
  );
  await writeFile(
    path.join(repo, 'apps', 'zeims-batch', 'src', 'routes', 'search', 'post.ts'),
    'export async function POST(){ return { status: "ok" }; }\n'
  );
  await writeFile(
    path.join(repo, 'apps', 'zeims-batch', 'src', 'routes', 'search', 'post.spec.ts'),
    'import { test } from "node:test";\ntest("post route", () => {});\n'
  );

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  const prepare = result.result.preparation;

  assert.deepEqual(prepare.file_groups.source.files.sort(), [
    'apps/hono-api/src/lib/mastra/tools/zeims-knowledge-tool.ts',
    'apps/zeims-batch/src/routes/search/post.ts'
  ]);
  assert.deepEqual(prepare.file_groups.tests.files, ['apps/zeims-batch/src/routes/search/post.spec.ts']);
  assert.equal(prepare.file_groups.other.files.includes('apps/hono-api/src/lib/mastra/tools/zeims-knowledge-tool.ts'), false);
  assert.equal(prepare.pr_context.change_classification.profile, 'api_contract');
  assert.ok(!prepare.pr_context.change_classification.reasons.includes('no runtime source files changed'));
  assert.equal(prepare.pr_context.pr_route.route_type, 'runtime_change');
  assert.equal(prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'code').status, 'present');
});

test('bug physics triage requires probe evidence before selecting a timing gate profile', async () => {
  const repo = await makeGitRepo();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-risk-adaptive.md'), `---
story_id: story-risk-adaptive
title: Session switching race bug
architecture_docs:
  reason: triage fixture
---

# Session switching race bug

## 背景

Session switching is intermittent and looks like a race condition with async orphaned promise behavior.

## 受け入れ基準

- [ ] Race bugs are triaged before choosing verification gates
`);
  await writeFile(path.join(repo, 'src', 'session-switcher.js'), 'export function switchSession(){ return "race"; }\n');

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  const dag = result.result.preparation.pr_context.gate_dag;
  const triage = dag.nodes.find((node) => node.id === 'gate:bug_physics_triage');

  assert.equal(triage.status, 'needs_evidence');
  assert.deepEqual(triage.classes, ['timing']);
  assert.equal(result.result.preparation.gate_status.ready_for_pr_create, false);
});

test('bug physics verification text includes structured observation scenarios and values', () => {
  const text = bugPhysicsVerificationText({
    commands: [{
      kind: 'integration',
      status: 'pass',
      command: 'node --test lineage.test.js',
      summary: 'verification passed',
      observation: {
        scenarios: ['authoritative_signal_source is verification-evidence store'],
        values: {
          signal_availability: 'available',
          monitoring: 'current-head monitoring evidence'
        }
      }
    }]
  });

  assert.match(text, /authoritative_signal_source is verification-evidence store/);
  assert.match(text, /signal_availability available/);
  assert.match(text, /monitoring current-head monitoring evidence/);
});

test('observability bug physics accepts structured evidence bound by current git context', async () => {
  const repo = await makeGitRepo();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-risk-adaptive.md'), `---
story_id: story-risk-adaptive
title: Authoritative observability signal
architecture_docs:
  reason: observability fixture
---

# Authoritative observability signal

## 背景

Monitoring needs one authoritative signal source instead of ambiguous indicators.

## 受け入れ基準

- [ ] Current-head structured verification proves signal availability
`);
  await writeFile(path.join(repo, 'src', 'observability.js'), 'export const signalSource = "verification-evidence";\n');
  await mkdir(path.join(repo, 'test', 'integration'), { recursive: true });
  await writeFile(path.join(repo, 'test', 'integration', 'observability.test.js'), 'import test from "node:test";\ntest("observability signal", () => {});\n');
  await execFileAsync('git', ['add', '.'], { cwd: repo });
  await execFileAsync('git', ['commit', '-m', 'add observability fixture'], { cwd: repo });

  const recorded = await runCli([
    'verify', 'record', repo,
    '--id', 'story-risk-adaptive',
    '--kind', 'integration',
    '--status', 'pass',
    '--command', 'node --test test/integration/observability.test.js',
    '--target', 'src/observability.js',
    '--scenario', 'authoritative_signal_source is verification-evidence store',
    '--observed', 'signal_availability=available',
    '--strict-head-binding',
    '--strict-head-reason', 'observability proof must match the inspected runtime HEAD'
  ]);
  assert.equal(recorded.exitCode, 0, recorded.stderr);
  assert.equal(recorded.result.evidence.commands[0].binding, undefined);
  assert.equal(recorded.result.evidence.commands[0].content_binding.status, 'strict_head');
  assert.equal(recorded.result.evidence.commands[0].git_context.dirty, false);

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  const gate = result.result.preparation.pr_context.gate_dag.nodes
    .find((node) => node.id === 'gate:bug_physics_observability_signal_source');
  assert.equal(gate.status, 'passed');
});

test('pr prepare reuses same-head passing verification for low-risk evidence changes only', async () => {
  const repo = await makeGitRepo();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-risk-adaptive.md'), `---
story_id: story-risk-adaptive
title: Risk Adaptive Gate
spec_docs:
  - ../../../specs/story-risk-adaptive.md
architecture_docs:
  reason: existing gate policy only
---

# Risk Adaptive Gate

## 受け入れ基準

- [ ] Low-risk evidence edits can reuse current-head verification.
`);
  await writeFile(path.join(repo, 'docs', 'specs', 'story-risk-adaptive.md'), `---
story_id: story-risk-adaptive
title: Risk Adaptive Gate Spec
---

# Spec

## Invariants

- INV-001: Low-risk evidence edits do not change runtime behavior.
`);
  await git(repo, ['add', 'docs']);
  await git(repo, ['commit', '-m', 'docs: add risk adaptive sources']);

  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-risk-adaptive',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'npm run test:e2e',
    '--summary', 'E2E passed before Spec wording clarification'
  ])).exitCode, 0);

  await writeFile(path.join(repo, 'docs', 'specs', 'story-risk-adaptive.md'), `---
story_id: story-risk-adaptive
title: Risk Adaptive Gate Spec
---

# Spec

## Invariants

- INV-001: Low-risk evidence edits do not change runtime behavior.

## Verification

- Existing same-head runtime evidence can be reused when only the Spec wording changes.
`);

  const dirtyResult = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'HEAD', '--json']);
  assert.equal(dirtyResult.exitCode, 0);
  const dirtyContext = dirtyResult.result.preparation.pr_context;
  assert.equal(dirtyContext.change_classification.change_type, 'low_risk_evidence_change');
  const dirtyE2eGate = dirtyContext.gate_dag.nodes.find((node) => node.id === 'gate:e2e');
  assert.equal(dirtyE2eGate.status, 'passed');
  assert.equal(dirtyE2eGate.evidence.binding.status, 'reused_low_risk');
  const dirtyArtifactGate = dirtyContext.gate_dag.nodes.find((node) => node.id === 'gate:artifact_consistency');
  assert.equal(dirtyArtifactGate.status, 'passed');
  assert.equal(dirtyArtifactGate.artifacts[0].status, 'reused_low_risk');

  await git(repo, ['add', 'docs/specs/story-risk-adaptive.md']);
  await git(repo, ['commit', '-m', 'docs: clarify risk evidence reuse']);

  const headChangedResult = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'HEAD~1', '--json']);
  assert.equal(headChangedResult.exitCode, 0);
  const headChangedContext = headChangedResult.result.preparation.pr_context;
  assert.equal(headChangedContext.change_classification.change_type, 'low_risk_evidence_change');
  const headChangedE2eGate = headChangedContext.gate_dag.nodes.find((node) => node.id === 'gate:e2e');
  assert.equal(headChangedE2eGate.status, 'passed');
  assert.equal(headChangedE2eGate.evidence.binding.status, 'reused_low_risk');
  assert.equal(headChangedE2eGate.evidence.binding.scoped_reuse_decision.action, 'reuse');
  assert.ok(headChangedE2eGate.evidence.binding.scoped_reuse_decision.changed_files.includes('docs/specs/story-risk-adaptive.md'));
  const headChangedArtifactGate = headChangedContext.gate_dag.nodes.find((node) => node.id === 'gate:artifact_consistency');
  assert.equal(headChangedArtifactGate.status, 'passed');
  assert.equal(headChangedArtifactGate.artifacts[0].status, 'reused_low_risk');
  assert.equal(headChangedArtifactGate.artifacts[0].scoped_reuse_decision.action, 'reuse');
});

test('pr prepare invalidates stale E2E evidence when test files changed', async () => {
  const repo = await makeGitRepo();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await mkdir(path.join(repo, 'test', 'e2e'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-risk-adaptive.md'), `---
story_id: story-risk-adaptive
title: Risk Adaptive Gate
spec_docs:
  - ../../../specs/story-risk-adaptive.md
architecture_docs:
  reason: existing gate policy only
---

# Risk Adaptive Gate

## 受け入れ基準

- [ ] Test changes invalidate stale E2E evidence.
`);
  await writeFile(path.join(repo, 'docs', 'specs', 'story-risk-adaptive.md'), `---
story_id: story-risk-adaptive
title: Risk Adaptive Gate Spec
---

# Spec

## Invariants

- INV-001: E2E evidence is bound to the test set.
`);
  await git(repo, ['add', 'docs']);
  await git(repo, ['commit', '-m', 'docs: add risk adaptive sources']);

  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-risk-adaptive',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'npm run test:e2e',
    '--summary', 'E2E passed before test marker edit'
  ])).exitCode, 0);

  await writeFile(
    path.join(repo, 'test', 'e2e', 'story-risk-adaptive-main.spec.ts'),
    'import { test } from "@playwright/test";\ntest("risk adaptive marker", async () => {});\n'
  );

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'HEAD', '--json']);
  assert.equal(result.exitCode, 0);
  const context = result.result.preparation.pr_context;
  assert.equal(context.change_classification.change_type, 'low_risk_evidence_change');
  const e2eGate = context.gate_dag.nodes.find((node) => node.id === 'gate:e2e');
  assert.equal(e2eGate.status, 'needs_evidence');
  assert.equal(e2eGate.evidence.binding.scoped_reuse_decision.action, 'full_rerun');
  assert.deepEqual(e2eGate.evidence.binding.scoped_reuse_decision.changed_files, ['test/e2e/story-risk-adaptive-main.spec.ts']);
});

test('worktree feature stories do not trigger deployment bug physics without deployment evidence', async () => {
  const repo = await makeGitRepo();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-risk-adaptive.md'), `---
story_id: story-risk-adaptive
title: Managed worktree execution DAG
architecture_docs:
  reason: triage fixture
---

# Managed worktree execution DAG

## 背景

VibePro should create and reuse a managed worktree for story execution.

## 受け入れ基準

- [ ] Worktree execution state is visible in PR Gate artifacts
`);
  await writeFile(path.join(repo, 'src', 'managed-worktree.js'), 'export function status(){ return "worktree"; }\n');

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  const dag = result.result.preparation.pr_context.gate_dag;
  const triage = dag.nodes.find((node) => node.id === 'gate:bug_physics_triage');

  assert.deepEqual(triage.classes, []);
  assert.equal(triage.status, 'passed');
  assert.equal(dag.nodes.some((node) => node.id === 'gate:bug_physics_deployment_version_stamp'), false);
});

test('bug physics triage emits multi-label profiles typed N/A gates and feedback edge', async () => {
  const repo = await makeGitRepo();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-risk-adaptive.md'), `---
story_id: story-risk-adaptive
title: Terminal rendering deterministic byte and state invariant bug
architecture_docs:
  reason: triage fixture
---

# Terminal rendering deterministic byte and state invariant bug

## 背景

Terminal rendering has an illegal-state-representable surface plus deterministic-byte behavior. The probe evidence includes real-byte fixture capture from pty/xterm, headless replay, and an invariant unit check that makes the illegal state unrepresentable.

## 受け入れ基準

- [ ] Multi-label bug physics can select deterministic-byte and state-invariant
- [ ] Harness contradiction loops back to triage
`);
  await writeFile(path.join(repo, 'src', 'terminal-renderer.js'), 'export function renderTerminal(){ return "xterm"; }\n');
  await mkdir(path.join(repo, 'test', 'unit'), { recursive: true });
  await writeFile(path.join(repo, 'test', 'unit', 'risk-adaptive-gate.test.js'), 'import test from "node:test";\ntest("invariant unit", () => {});\n');
  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-risk-adaptive',
    '--kind', 'unit',
    '--status', 'pass',
    '--command', 'node --test test/unit/risk-adaptive-gate.test.js',
    '--summary', 'real-byte fixture and headless replay assertion passed; invariant unit makes illegal-state unrepresentable; selected harness could not reproduce one symptom, so contradiction feedback must re-triage'
  ])).exitCode, 0);

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  const dag = result.result.preparation.pr_context.gate_dag;
  const triage = dag.nodes.find((node) => node.id === 'gate:bug_physics_triage');
  const feedback = dag.nodes.find((node) => node.id === 'gate:bug_physics_contradiction_feedback');

  assert.deepEqual(triage.classes.sort(), ['deterministic-byte', 'state-invariant']);
  assert.equal(dag.nodes.find((node) => node.id === 'gate:bug_physics_deterministic_byte_replay').status, 'passed');
  assert.equal(dag.nodes.find((node) => node.id === 'gate:bug_physics_state_invariant_design').status, 'passed');
  assert.equal(dag.nodes.find((node) => node.id === 'gate:bug_physics_deterministic_byte_slo_na').status, 'not_applicable');
  assert.equal(dag.nodes.find((node) => node.id === 'gate:bug_physics_state_slo_proof_only_na').distinct_from, 'waiver');
  assert.equal(feedback.status, 'failed');
  assert.equal(dag.edges.some((edge) => edge.from === 'gate:bug_physics_contradiction_feedback' && edge.to === 'gate:bug_physics_triage' && edge.feedback === true), true);
});

test('deployment bug physics bypasses code gates through typed N/A instead of waiver', async () => {
  const repo = await makeGitRepo();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-risk-adaptive.md'), `---
story_id: story-risk-adaptive
title: Running session deployment artifact version bug
architecture_docs:
  reason: triage fixture
---

# Running session deployment artifact version bug

## 背景

The running session reads an unexpected artifact version. The deployment probe evidence is a version-stamp propagation check for the expected artifact version.

## 受け入れ基準

- [ ] Deployment bugs bypass code gates with typed N/A and require version-stamp propagation evidence
`);
  await writeFile(path.join(repo, 'src', 'artifact-version.js'), 'export const artifactVersion = "test";\n');
  await mkdir(path.join(repo, 'test', 'integration'), { recursive: true });
  await writeFile(path.join(repo, 'test', 'integration', 'risk-adaptive-gate.test.js'), 'import test from "node:test";\ntest("version stamp", () => {});\n');
  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-risk-adaptive',
    '--kind', 'integration',
    '--status', 'pass',
    '--command', 'node --test test/integration/risk-adaptive-gate.test.js',
    '--summary', 'version-stamp propagation evidence proves the running session reads the expected artifact version'
  ])).exitCode, 0);

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  const dag = result.result.preparation.pr_context.gate_dag;

  assert.deepEqual(dag.summary.bug_physics_classes, ['deployment']);
  assert.equal(dag.nodes.find((node) => node.id === 'gate:bug_physics_deployment_version_stamp').status, 'passed');
  assert.equal(dag.nodes.find((node) => node.id === 'gate:bug_physics_deployment_code_gates_na').status, 'not_applicable');
  for (const gateId of ['gate:unit', 'gate:integration', 'gate:e2e']) {
    const gate = dag.nodes.find((node) => node.id === gateId);
    assert.equal(gate.status, 'not_applicable');
    assert.equal(gate.required, false);
    assert.equal(gate.distinct_from, 'waiver');
    assert.equal(gate.selected_by, 'gate:bug_physics_triage');
  }
});

test('workflow-heavy release confidence requires state scenario and no blocker questions', async () => {
  const repo = await makeGitRepo();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'projects', '[projectId]', 'components'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'batch-jobs', '[id]', 'generate-samples'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'services'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'workers'), { recursive: true });
  await mkdir(path.join(repo, 'tests', 'e2e'), { recursive: true });
  await mkdir(path.join(repo, '.vibepro', 'spec', 'story-risk-adaptive'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-risk-adaptive.md'), `---
story_id: story-risk-adaptive
title: FORM preflight workflow gate
---

# FORM preflight workflow gate

## 背景

Sample generation must run a preflight workflow, poll status, retry failed detection, and resume after transient failures.

## 受け入れ基準

- [ ] Workflow states prevent generation until detection is ready
- [ ] Retry and resume transitions are replayed before release
`);
  await writeFile(path.join(repo, 'src', 'app', 'projects', '[projectId]', 'components', 'PlanTab.tsx'), 'export function PlanTab(){ return <button>Start sample</button>; }\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'batch-jobs', '[id]', 'generate-samples', 'route.ts'), 'export async function POST(){ return Response.json({ status: "preflight" }); }\n');
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'formProjectStartService.ts'), 'export function startFormWorkflow(){ return "retry-status"; }\n');
  await writeFile(path.join(repo, 'src', 'workers', 'formDetectionWorker.ts'), 'export function enqueueFormDetectionJob(){ return "queued"; }\n');
  await writeFile(path.join(repo, 'tests', 'e2e', 'story-risk-adaptive-main.spec.ts'), `
import { expect, test } from '@playwright/test';
test('story-risk-adaptive workflow state transitions', async () => {
  // story-risk-adaptive S-001
  // Given the workflow state is retrying or polling status, release readiness requires replaying the transition matrix before generation resumes.
  // story-risk-adaptive ac:1
  // Workflow states prevent generation until detection is ready
  // story-risk-adaptive ac:2
  // Retry and resume transitions are replayed before release
  expect('retry-status').toContain('status');
  expect('transition matrix before generation resumes').toContain('transition');
  expect('Workflow states prevent generation until detection is ready').toContain('Workflow');
  expect('Retry and resume transitions are replayed before release').toContain('Retry');
});
`);
  await writeFile(path.join(repo, '.vibepro', 'spec', 'story-risk-adaptive', 'spec.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    story_id: 'story-risk-adaptive',
    generated_at: '2026-05-25T00:00:00.000Z',
    generated_by: { caller: 'test', stage: 'ai_synthesis' },
    clauses: [
      {
        id: 'S-001',
        type: 'scenario',
        statement: 'Given the workflow state is retrying or polling status, release readiness requires replaying the transition matrix before generation resumes.',
        origin: {
          story_refs: [{ kind: 'acceptance_criteria', index: 0, text_snippet: 'Workflow states prevent generation until detection is ready' }]
        }
      }
    ],
    open_questions: [{ id: 'Q-001', question: 'Which retry state is terminal?', blocker: true }]
  }, null, 2)}\n`);

  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-risk-adaptive',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'npx playwright test tests/e2e/story-risk-adaptive-main.spec.ts',
    '--summary', 'E2E passed with story acceptance coverage'
  ])).exitCode, 0);

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  const gateDag = result.result.preparation.pr_context.gate_dag;
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:production_path_matrix').status, 'passed');
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:workflow_state_machine').status, 'needs_evidence');
  assert.match(gateDag.nodes.find((node) => node.id === 'gate:workflow_state_machine').reason, /blocker open question/);
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:release_confidence').status, 'needs_evidence');

  const specPath = path.join(repo, '.vibepro', 'spec', 'story-risk-adaptive', 'spec.json');
  await writeFile(specPath, `${JSON.stringify({
    schema_version: '0.1.0',
    story_id: 'story-risk-adaptive',
    generated_at: '2026-05-25T00:00:00.000Z',
    generated_by: { caller: 'test', stage: 'ai_synthesis' },
    clauses: [],
    open_questions: []
  }, null, 2)}\n`);
  const noScenarioResult = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(noScenarioResult.exitCode, 0);
  const noScenarioDag = noScenarioResult.result.preparation.pr_context.gate_dag;
  assert.equal(noScenarioDag.nodes.find((node) => node.id === 'gate:workflow_state_machine').status, 'needs_evidence');
  assert.match(noScenarioDag.nodes.find((node) => node.id === 'gate:workflow_state_machine').reason, /explicit scenario clauses/);
  assert.equal(noScenarioDag.nodes.find((node) => node.id === 'gate:release_confidence').status, 'needs_evidence');
});

test('workflow-heavy E2E replay rejects marker-only story files and manifest-only flow passes', async () => {
  const repo = await makeGitRepo();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'projects', '[projectId]', 'components'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'batch-jobs', '[id]', 'generate-samples'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'services'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'workers'), { recursive: true });
  await mkdir(path.join(repo, 'tests', 'e2e'), { recursive: true });
  await mkdir(path.join(repo, '.vibepro', 'spec', 'story-risk-adaptive'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-risk-adaptive.md'), `---
story_id: story-risk-adaptive
title: FORM preflight workflow gate
---

# FORM preflight workflow gate

## 受け入れ基準

- [ ] Workflow states prevent generation until detection is ready
`);
  await writeFile(path.join(repo, 'src', 'app', 'projects', '[projectId]', 'components', 'PlanTab.tsx'), 'export function PlanTab(){ return <button>Start sample</button>; }\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'batch-jobs', '[id]', 'generate-samples', 'route.ts'), 'export async function POST(){ return Response.json({ status: "preflight" }); }\n');
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'formProjectStartService.ts'), 'export function startFormWorkflow(){ return "retry-status"; }\n');
  await writeFile(path.join(repo, 'src', 'workers', 'formDetectionWorker.ts'), 'export function enqueueFormDetectionJob(){ return "queued"; }\n');
  await writeFile(path.join(repo, '.vibepro', 'spec', 'story-risk-adaptive', 'spec.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    story_id: 'story-risk-adaptive',
    clauses: [{
      id: 'S-001',
      type: 'scenario',
      statement: 'Given the workflow state is polling status, release readiness requires replaying the transition matrix.',
      origin: { story_refs: [{ kind: 'acceptance_criteria', index: 0 }] }
    }],
    open_questions: []
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'tests', 'e2e', 'story-risk-adaptive-main.spec.ts'), `
import { expect, test } from '@playwright/test';
test('story-risk-adaptive unrelated assertion', async () => {
  expect(true).toBe(true);
});
test('story-risk-adaptive marker only', async () => {
  // story-risk-adaptive ac:1
  await test.step('mentions the workflow without asserting it', async () => {});
});
`);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add workflow-heavy story fixture']);

  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const manifest = await readJson(manifestPath);
  const otherFlowDir = path.join(repo, '.vibepro', 'verification', 'other-story-flow-pass');
  await mkdir(otherFlowDir, { recursive: true });
  await writeFile(path.join(otherFlowDir, 'flow-verification.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    run_id: 'other-story-flow-pass',
    story_id: 'story-other-workflow',
    status: 'pass',
    git_context: {
      head_sha: (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim(),
      dirty: false,
      status_fingerprint_hash: await gitFingerprintHash(repo),
      recorded_at: '2026-05-25T00:00:00.000Z'
    }
  }, null, 2)}\n`);
  manifest.latest_flow_verification_run = 'other-story-flow-pass';
  manifest.flow_verification_runs = [{
    run_id: 'other-story-flow-pass',
    story_id: 'story-other-workflow',
    created_at: '2026-05-25T00:00:00.000Z',
    status: 'pass',
    git_context: {
      head_sha: (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim(),
      dirty: false,
      status_fingerprint_hash: await gitFingerprintHash(repo),
      recorded_at: '2026-05-25T00:00:00.000Z'
    },
    artifacts: {
      flow_verification_json: '.vibepro/verification/other-story-flow-pass/flow-verification.json'
    }
  }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const otherStoryFlow = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(otherStoryFlow.exitCode, 0);
  const otherStoryFlowGate = otherStoryFlow.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:workflow_flow_replay');
  assert.equal(otherStoryFlowGate.status, 'needs_evidence');
  assert.match(otherStoryFlowGate.reason, /current passing Flow Verification or E2E replay evidence/);
  manifest.latest_flow_verification_run = null;
  manifest.flow_verification_runs = [];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-risk-adaptive',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'npx playwright test tests/e2e/story-risk-adaptive-main.spec.ts',
    '--summary', 'Marker-only E2E should not satisfy workflow replay'
  ])).exitCode, 0);

  const markerOnly = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(markerOnly.exitCode, 0);
  const markerOnlyGate = markerOnly.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:workflow_flow_replay');
  assert.equal(markerOnlyGate.status, 'needs_evidence');
  assert.match(markerOnlyGate.reason, /executable assertions/);
  assert.equal(markerOnly.result.preparation.pr_context.acceptance_e2e_coverage.status, 'needs_evidence');
  assert.equal(markerOnly.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:e2e').status, 'needs_evidence');

  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-risk-adaptive',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'npx playwright test tests/e2e/story-risk-adaptive-main.spec.ts',
    '--target', 'tests/e2e/story-risk-adaptive-main.spec.ts',
    '--scenario', 'flow_replay: pre-PR Playwright exercised the workflow transition path',
    '--observed', 'flow_replay=true'
  ])).exitCode, 0);

  const flowReplayOnly = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(flowReplayOnly.exitCode, 0);
  const flowReplayOnlyGate = flowReplayOnly.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:workflow_flow_replay');
  assert.equal(flowReplayOnlyGate.status, 'needs_evidence');
  assert.match(flowReplayOnlyGate.reason, /explicit flow replay observations|executable assertions|Story E2E coverage needs evidence/);

  await writeFile(path.join(repo, 'tests', 'e2e', 'missing-workflow-replay.spec.ts'), `
import { test } from '@playwright/test';
test('story-risk-adaptive marker only replay', async () => {
  // story-risk-adaptive ac:1
});
`);
  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-risk-adaptive',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'npx playwright test tests/e2e/missing-workflow-replay.spec.ts',
    '--target', 'tests/e2e/missing-workflow-replay.spec.ts',
    '--scenario', 'flow_replay: pre-PR Playwright exercised the workflow transition path',
    '--scenario', 'scenario_clause_e2e: workflow state scenario clause was asserted',
    '--observed', 'flow_replay=true',
    '--observed', 'scenario_clause_e2e=true'
  ])).exitCode, 0);
  await rm(path.join(repo, 'tests', 'e2e', 'missing-workflow-replay.spec.ts'));

  const missingTargetReplay = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(missingTargetReplay.exitCode, 0);
  const missingTargetReplayGate = missingTargetReplay.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:workflow_flow_replay');
  assert.equal(missingTargetReplayGate.status, 'needs_evidence');
  assert.match(missingTargetReplayGate.reason, /executable assertions|Story E2E coverage needs evidence|current passing Flow Verification or E2E replay evidence/);

  await writeFile(path.join(repo, 'tests', 'e2e', 'workflow-replay.spec.ts'), `
import { test } from '@playwright/test';
test('story-risk-adaptive replay placeholder', async () => {
  // story-risk-adaptive ac:1
});
`);
  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-risk-adaptive',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'npx playwright test tests/e2e/workflow-replay.spec.ts',
    '--target', 'src/lib/services/formProjectStartService.ts',
    '--scenario', 'flow_replay: pre-PR Playwright exercised the workflow transition path',
    '--scenario', 'scenario_clause_e2e: workflow state scenario clause was asserted',
    '--observed', 'flow_replay=true',
    '--observed', 'scenario_clause_e2e=true'
  ])).exitCode, 0);

  const nonE2eTargetReplay = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(nonE2eTargetReplay.exitCode, 0);
  const nonE2eTargetReplayGate = nonE2eTargetReplay.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:workflow_flow_replay');
  assert.equal(nonE2eTargetReplayGate.status, 'needs_evidence');

  await writeFile(path.join(repo, 'tests', 'e2e', 'nonexistent.spec.ts'), `
import { test } from '@playwright/test';
test('story-risk-adaptive route grep placeholder', async () => {
  // story-risk-adaptive ac:1
});
`);
  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-risk-adaptive',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'npx playwright test tests/e2e/nonexistent.spec.ts --grep route.ts',
    '--target', 'src/app/api/batch-jobs/[id]/generate-samples/route.ts',
    '--scenario', 'flow_replay: pre-PR Playwright exercised the workflow transition path',
    '--scenario', 'scenario_clause_e2e: workflow state scenario clause was asserted',
    '--observed', 'flow_replay=true',
    '--observed', 'scenario_clause_e2e=true'
  ])).exitCode, 0);

  const routeTargetReplay = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(routeTargetReplay.exitCode, 0);
  const routeTargetReplayGate = routeTargetReplay.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:workflow_flow_replay');
  assert.equal(routeTargetReplayGate.status, 'needs_evidence');

  await writeFile(path.join(repo, 'tests', 'e2e', 'workflow-replay.spec.ts'), `
import { expect, test } from '@playwright/test';
test('story-risk-adaptive workflow replay', async () => {
  // story-risk-adaptive S-001
  // Given the workflow state is polling status, release readiness requires replaying the transition matrix.
  // story-risk-adaptive ac:1
  // Workflow states prevent generation until detection is ready
  expect('retry-status').toContain('status');
  expect('replaying the transition matrix').toContain('transition');
});
`);

  await writeFile(path.join(repo, 'workflow-replay.spec.ts'), `
import { test } from '@playwright/test';
test('story-risk-adaptive basename placeholder', async () => {
  // story-risk-adaptive ac:1
});
`);
  await git(repo, ['add', 'workflow-replay.spec.ts']);
  await git(repo, ['commit', '-m', 'test: add basename replay stub']);
  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-risk-adaptive',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'npx playwright test workflow-replay.spec.ts',
    '--target', 'tests/e2e/workflow-replay.spec.ts',
    '--scenario', 'flow_replay: pre-PR Playwright exercised the workflow transition path',
    '--scenario', 'scenario_clause_e2e: workflow state scenario clause was asserted',
    '--observed', 'flow_replay=true',
    '--observed', 'scenario_clause_e2e=true'
  ])).exitCode, 0);

  const basenameOnlyReplay = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(basenameOnlyReplay.exitCode, 0);
  const basenameOnlyReplayGate = basenameOnlyReplay.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:workflow_flow_replay');
  assert.equal(basenameOnlyReplayGate.status, 'needs_evidence');

  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-risk-adaptive',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'npx playwright test tests/e2e/workflow-replay.spec.ts',
    '--target', 'tests/e2e/workflow-replay.spec.ts',
    '--scenario', 'flow_replay: pre-PR Playwright exercised the workflow transition path',
    '--scenario', 'scenario_clause_e2e: workflow state scenario clause was asserted',
    '--observed', 'flow_replay=true',
    '--observed', 'scenario_clause_e2e=true'
  ])).exitCode, 0);

  const explicitReplay = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(explicitReplay.exitCode, 0);
  const explicitReplayGate = explicitReplay.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:workflow_flow_replay');
  assert.equal(explicitReplayGate.status, 'passed');
  assert.match(explicitReplayGate.reason, /explicitly records flow_replay/);

  await writeFile(path.join(repo, 'tests', 'e2e', 'story-risk-adaptive-main.spec.ts'), `
import { expect, test } from '@playwright/test';
test('story-risk-adaptive unrelated assertion', async () => {
  expect(true).toBe(true);
});
// story-risk-adaptive ac:1
`);

	  const trailingMarker = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
	  assert.equal(trailingMarker.exitCode, 0);
	  assert.equal(trailingMarker.result.preparation.pr_context.acceptance_e2e_coverage.status, 'needs_evidence');
	  const trailingMarkerFlowGate = trailingMarker.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:workflow_flow_replay');
	  assert.equal(trailingMarkerFlowGate.status, 'passed');
	  assert.match(trailingMarkerFlowGate.reason, /explicitly records flow_replay/);

  await writeFile(path.join(repo, 'tests', 'e2e', 'story-risk-adaptive-main.spec.ts'), `
import { expect, test } from '@playwright/test';
test.describe('story-risk-adaptive wrapper', () => {
  // story-risk-adaptive ac:1
  test('nested unrelated assertion', async () => {
    expect(true).toBe(true);
  });
});
`);

  const describeMarker = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(describeMarker.exitCode, 0);
  assert.equal(describeMarker.result.preparation.pr_context.acceptance_e2e_coverage.status, 'needs_evidence');

  await writeFile(path.join(repo, 'tests', 'e2e', 'story-risk-adaptive-main.spec.ts'), `
import { test } from '@playwright/test';
test('story-risk-adaptive command only', async () => {
  // story-risk-adaptive ac:1
  await runCli(['pr', 'prepare', '.', '--json']);
});
`);

  const commandOnly = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(commandOnly.exitCode, 0);
  assert.equal(commandOnly.result.preparation.pr_context.acceptance_e2e_coverage.status, 'needs_evidence');

  await writeFile(path.join(repo, 'tests', 'e2e', 'story-risk-adaptive-main.spec.ts'), `
import { expect, test } from '@playwright/test';
test('story-risk-adaptive generic marker', async () => {
  // ac:1
  expect('retry-status').toContain('status');
});
`);

  const genericMarker = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(genericMarker.exitCode, 0);
  assert.equal(genericMarker.result.preparation.pr_context.acceptance_e2e_coverage.status, 'needs_evidence');

  await writeFile(path.join(repo, 'tests', 'e2e', 'story-risk-adaptive-main.spec.ts'), `
import { expect, test } from '@playwright/test';
test('story-risk-adaptive assertion message marker', async () => {
  expect('retry-status', 'ac:1 Workflow states prevent generation until detection is ready').toContain('status');
  expect('transition matrix', 'story-risk-adaptive S-001 Given the workflow state is polling status, release readiness requires replaying the transition matrix.').toContain('transition');
});
`);

  const assertionMessageMarker = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(assertionMessageMarker.exitCode, 0);
  assert.equal(assertionMessageMarker.result.preparation.pr_context.acceptance_e2e_coverage.status, 'passed');

  await writeFile(path.join(repo, 'tests', 'e2e', 'story-risk-adaptive-main.spec.ts'), `
import { expect, test } from '@playwright/test';
test('story-risk-adaptive bound marker with assertion', async () => {
  // story-risk-adaptive S-001
  // Given the workflow state is polling status, release readiness requires replaying the transition matrix.
  // story-risk-adaptive ac:1
  // Workflow states prevent generation until detection is ready
  expect('retry-status').toContain('status');
  expect('replaying the transition matrix').toContain('transition');
  expect('Workflow states prevent generation until detection is ready').toContain('Workflow');
});
`);

  const boundMarker = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(boundMarker.exitCode, 0);
  assert.equal(boundMarker.result.preparation.pr_context.acceptance_e2e_coverage.status, 'passed');

  await writeFile(path.join(repo, 'tests', 'e2e', 'story-risk-adaptive-main.spec.ts'), `
import { expect, test } from '@playwright/test';
test('story-risk-adaptive unrelated assertion with bound marker', async () => {
  // story-risk-adaptive ac:1
  // Workflow states prevent generation until detection is ready
  expect(true).toBe(true);
});
`);

  const unrelatedAssertion = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(unrelatedAssertion.exitCode, 0);
  assert.equal(unrelatedAssertion.result.preparation.pr_context.acceptance_e2e_coverage.status, 'needs_evidence');

	  manifest.latest_flow_verification_run = 'manifest-only-flow-pass';
  manifest.flow_verification_runs = [{
    run_id: 'manifest-only-flow-pass',
    story_id: 'story-risk-adaptive',
    created_at: '2026-05-25T00:00:00.000Z',
    status: 'pass',
    git_context: {
      head_sha: (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim(),
      dirty: true,
      status_fingerprint: (await git(repo, ['status', '--porcelain', '-uall'])).stdout.trimEnd(),
      recorded_at: '2026-05-25T00:00:00.000Z'
    },
    artifacts: {}
  }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const manifestOnly = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(manifestOnly.exitCode, 0);
	  const flowGate = manifestOnly.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:workflow_flow_replay');
	  assert.equal(flowGate.status, 'needs_evidence');
	  assert.match(flowGate.reason, /readable flow-verification\.json artifact/);

	  const flowDir = path.join(repo, '.vibepro', 'verification', 'stale-flow-pass');
	  await mkdir(flowDir, { recursive: true });
	  await writeFile(path.join(flowDir, 'flow-verification.json'), `${JSON.stringify({
	    schema_version: '0.1.0',
	    run_id: 'stale-flow-pass',
	    story_id: 'story-risk-adaptive',
	    status: 'pass',
	    git_context: {
	      head_sha: '0000000000000000000000000000000000000000',
	      dirty: false,
	      status_fingerprint_hash: 'stale',
	      recorded_at: '2026-05-25T00:00:00.000Z'
	    }
	  }, null, 2)}\n`);
	  manifest.latest_flow_verification_run = 'stale-flow-pass';
	  manifest.flow_verification_runs = [{
	    run_id: 'stale-flow-pass',
	    story_id: 'story-risk-adaptive',
	    created_at: '2026-05-25T00:00:00.000Z',
	    status: 'pass',
	    git_context: {
	      head_sha: '0000000000000000000000000000000000000000',
	      dirty: false,
	      status_fingerprint_hash: 'stale',
	      recorded_at: '2026-05-25T00:00:00.000Z'
	    },
	    artifacts: {
	      flow_verification_json: '.vibepro/verification/stale-flow-pass/flow-verification.json'
	    }
	  }];
	  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

	  const staleFlow = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
	  assert.equal(staleFlow.exitCode, 0);
	  const staleFlowGate = staleFlow.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:workflow_flow_replay');
	  assert.equal(staleFlowGate.status, 'needs_evidence');
	  assert.match(staleFlowGate.reason, /recorded for 000000000000/);

  await git(repo, ['add', 'docs', 'src', 'tests']);
  await git(repo, ['commit', '-m', 'test: stabilize zero probe fixture']);

  const zeroProbeDir = path.join(repo, '.vibepro', 'verification', 'zero-probe-flow-pass');
  await mkdir(zeroProbeDir, { recursive: true });
  await writeFile(path.join(zeroProbeDir, 'flow-verification.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    run_id: 'zero-probe-flow-pass',
    story_id: 'story-risk-adaptive',
    status: 'pass',
    git_context: {
      head_sha: (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim(),
      dirty: false,
      status_fingerprint_hash: cleanGitFingerprintHash(),
      recorded_at: '2026-05-25T00:00:00.000Z'
    },
    summary: {
      total: 0,
      pass: 0,
      fail: 0,
      skipped: 0,
      needs_setup: 0
    },
    probes: []
  }, null, 2)}\n`);
  manifest.latest_flow_verification_run = 'zero-probe-flow-pass';
  manifest.flow_verification_runs = [{
    run_id: 'zero-probe-flow-pass',
    story_id: 'story-risk-adaptive',
    created_at: '2026-05-25T00:00:00.000Z',
    status: 'pass',
    git_context: {
      head_sha: (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim(),
      dirty: false,
      status_fingerprint_hash: cleanGitFingerprintHash(),
      recorded_at: '2026-05-25T00:00:00.000Z'
    },
    artifacts: {
      flow_verification_json: '.vibepro/verification/zero-probe-flow-pass/flow-verification.json'
    },
    summary: {
      total: 0,
      pass: 0,
      fail: 0,
      skipped: 0,
      needs_setup: 0
    }
  }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const zeroProbeFlow = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(zeroProbeFlow.exitCode, 0);
  const zeroProbeFlowGate = zeroProbeFlow.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:workflow_flow_replay');
  assert.equal(zeroProbeFlowGate.status, 'needs_evidence');
  assert.match(zeroProbeFlowGate.reason, /passing runtime probe/);
  assert.equal(zeroProbeFlowGate.required_actions.some((action) => action.includes('flow_design.runtime_probes')), true);
		});
