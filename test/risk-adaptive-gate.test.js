import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { classifyChangeRisk } from '../src/change-risk-classifier.js';
import { runCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);

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
  const staleArtifactGate = headChangedContext.gate_dag.nodes.find((node) => node.id === 'gate:artifact_consistency');
  assert.equal(staleArtifactGate.status, 'stale_evidence');
  assert.equal(staleArtifactGate.inconsistent_artifacts[0].status, 'stale');
  assert.match(staleArtifactGate.inconsistent_artifacts[0].reason, /recorded for/);
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
  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-risk-adaptive',
    '--kind', 'unit',
    '--status', 'pass',
    '--command', 'node --test test/risk-adaptive-gate.test.js',
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
  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-risk-adaptive',
    '--kind', 'integration',
    '--status', 'pass',
    '--command', 'node --test test/risk-adaptive-gate.test.js',
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

test('pr prepare expands workflow-heavy gate DAG and blocks release without flow evidence', async () => {
  const repo = await makeGitRepo();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'projects', '[projectId]', 'components'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'batch-jobs', '[id]', 'generate-samples'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'v1', 'projects', '[projectId]', 'start'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'services'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'workers'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-risk-adaptive.md'), `---
story_id: story-risk-adaptive
title: FORM preflight workflow gate
architecture_docs:
  reason: existing route/service/queue boundaries only
---

# FORM preflight workflow gate

## 背景

Sample generation must run a preflight workflow, start detection, poll status, retry failed detection, preserve auth, and keep legacy v1 compatibility.

## 受け入れ基準

- [ ] UI/API/service/queue workflow changes require flow replay evidence
- [ ] Generation must not start until the workflow state allows it
`);
  await writeFile(path.join(repo, 'src', 'app', 'projects', '[projectId]', 'components', 'PlanTab.tsx'), 'export function PlanTab(){ return <button>Start sample</button>; }\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'batch-jobs', '[id]', 'generate-samples', 'route.ts'), 'export async function POST(){ return Response.json({ status: "preflight" }); }\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'v1', 'projects', '[projectId]', 'start', 'route.ts'), 'export async function POST(){ return Response.json({ legacy: "v1" }); }\n');
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'formProjectStartService.ts'), 'export function startFormWorkflow(){ return "retry-status"; }\n');
  await writeFile(path.join(repo, 'src', 'workers', 'formDetectionWorker.ts'), 'export function enqueueFormDetectionJob(){ return "queued"; }\n');

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  const prepare = result.result;
  const gateDag = prepare.preparation.pr_context.gate_dag;
  const classification = prepare.preparation.pr_context.change_classification;

  assert.equal(classification.profile, 'workflow_heavy');
  assert.equal(gateDag.overall_status, 'needs_verification');
  assert.equal(gateDag.nodes.some((node) => node.id === 'gate:change_classification'), true);
  assert.equal(gateDag.nodes.some((node) => node.id === 'gate:workflow_state_machine'), true);
  assert.equal(gateDag.nodes.some((node) => node.id === 'gate:production_path_matrix'), true);
  assert.equal(gateDag.nodes.some((node) => node.id === 'gate:workflow_flow_replay'), true);
  assert.equal(gateDag.nodes.some((node) => node.id === 'gate:evidence_coverage'), true);
  assert.equal(gateDag.nodes.some((node) => node.id === 'gate:release_confidence'), true);
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:workflow_flow_replay').status, 'needs_evidence');
  const spineGate = gateDag.nodes.find((node) => node.id === 'gate:common_judgment_spine');
  assert.equal(spineGate.status, 'needs_evidence');
  assert.equal(spineGate.subchecks.some((check) => check.id === 'invariants' && check.status === 'needs_evidence'), true);
  assert.equal(spineGate.subchecks.some((check) => check.id === 'done_evidence' && check.status === 'needs_evidence'), true);
  const failureModeGate = gateDag.nodes.find((node) => node.id === 'gate:failure_mode_coverage');
  assert.equal(failureModeGate.status, 'missing_coverage');
  assert.equal(failureModeGate.missing_modes.includes('retry_or_async_failure'), true);
  assert.equal(failureModeGate.missing_modes.includes('provider_failure'), true);
  const pathSurfaceGate = gateDag.nodes.find((node) => node.id === 'gate:path_surface_matrix');
  assert.equal(pathSurfaceGate.status, 'partial_surface');
  assert.equal(pathSurfaceGate.missing_surfaces.includes('ui'), true);
  assert.equal(pathSurfaceGate.missing_surfaces.includes('api'), true);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-risk-adaptive', 'pr-body.md'), 'utf8');
  assert.match(prBody, /\.vibepro\/pr\/story-risk-adaptive\/gate-dag\.json/);
  assert.doesNotMatch(prBody, /#### 共通spineの確認/);
  assert.equal(spineGate.subchecks.find((check) => check.id === 'invariants').status, 'needs_evidence');
  assert.equal(spineGate.subchecks.find((check) => check.id === 'done_evidence').status, 'needs_evidence');

  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.latest_flow_verification_run = 'legacy-flow-pass';
  manifest.flow_verification_runs = [{
    run_id: 'legacy-flow-pass',
    story_id: 'story-risk-adaptive',
    created_at: '2026-05-25T00:00:00.000Z',
    status: 'pass',
    base_url: 'http://127.0.0.1:3000',
    artifacts: {},
    summary: { total: 1, pass: 1, fail: 0, skipped: 0, needs_setup: 0 }
  }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const legacyFlowResult = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(legacyFlowResult.exitCode, 0);
  const legacyFlowReplay = legacyFlowResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:workflow_flow_replay');
  assert.equal(legacyFlowReplay.status, 'needs_evidence');
  assert.match(legacyFlowReplay.reason, /readable flow-verification\.json artifact/);
  manifest.latest_flow_verification_run = null;
  manifest.flow_verification_runs = [];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-risk-adaptive',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'node --test test/risk-adaptive-gate.test.js',
    '--summary', 'Generic CLI test was mislabeled as E2E'
  ])).exitCode, 0);

  const mislabeledResult = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(mislabeledResult.exitCode, 0);
  const mislabeledGateDag = mislabeledResult.result.preparation.pr_context.gate_dag;
  assert.equal(mislabeledGateDag.nodes.find((node) => node.id === 'gate:workflow_flow_replay').status, 'needs_evidence');
  assert.match(mislabeledGateDag.nodes.find((node) => node.id === 'gate:workflow_flow_replay').reason, /Story E2E coverage needs evidence/);
  assert.equal(mislabeledGateDag.nodes.find((node) => node.id === 'gate:release_confidence').status, 'needs_evidence');

  const agentReviews = prepare.preparation.pr_context.agent_reviews;
	  const required = new Set(agentReviews.required_reviews.map((item) => `${item.stage}:${item.role}`));
	  assert.deepEqual([...required].sort(), [
		    'gate:gate_evidence',
	    'gate:release_risk',
	    'preview:human_usability',
	    'preview:network_runtime'
		  ]);
	  assert.deepEqual(agentReviews.required_reviews
	    .filter((item) => item.policy === 'workflow_heavy')
	    .map((item) => `${item.stage}:${item.role}`)
	    .sort(), [
	    'gate:release_risk',
	    'preview:network_runtime'
	  ]);
  assert.equal(agentReviews.required_reviews.some((item) => ['architecture_spec', 'test_plan', 'implementation'].includes(item.stage)), false);
  assert.deepEqual(agentReviews.checkpoint_required_reviews
    .map((item) => `${item.stage}:${item.role}`)
    .sort(), [
    'architecture_spec:regression_risk',
    'implementation:runtime_contract',
    'implementation:ux_completion',
    'test_plan:e2e_ux',
    'test_plan:gate_coverage'
  ]);
  assert.equal(agentReviews.summary.unmet_checkpoint_review_count, 5);
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:agent_review').unmet_checkpoint_reviews.length, 5);
  assert.deepEqual(agentReviews.parallel_dispatch.required_stages
    .map((stage) => stage.stage)
    .sort(), [
    'architecture_spec',
    'gate',
    'implementation',
    'preview',
    'test_plan'
  ]);
  assert.equal(agentReviews.parallel_dispatch.stage_execution.serial_between_stages, true);
  assert.equal(agentReviews.parallel_dispatch.stage_execution.parallel_within_stage, true);
  assert.equal(agentReviews.parallel_dispatch.stage_execution.current_stage, 'architecture_spec');
  const previewStageSummary = agentReviews.stages.find((stage) => stage.stage === 'preview');
  assert.deepEqual(previewStageSummary.roles.map((role) => role.role).sort(), [
    'human_usability',
    'network_runtime'
  ]);
  assert.equal(previewStageSummary.next_actions.join('\n').includes('preview_smoke'), false);
  const previewDispatchStage = agentReviews.parallel_dispatch.required_stages.find((stage) => stage.stage === 'preview');
  assert.deepEqual(previewDispatchStage.roles.sort(), [
    'human_usability',
    'network_runtime'
  ]);
  assert.equal(previewDispatchStage.prepare_command.includes('preview_smoke'), false);
  assert.deepEqual(agentReviews.parallel_dispatch.required_stages
    .map((stage) => `${stage.serial_index}:${stage.stage}:${stage.dispatch_state}`), [
    '1:architecture_spec:current',
    '2:test_plan:blocked_by_previous_stage',
    '3:implementation:blocked_by_previous_stage',
    '4:preview:blocked_by_previous_stage',
    '5:gate:blocked_by_previous_stage'
  ]);
  assert.equal(agentReviews.parallel_dispatch.required_stages.find((stage) => stage.stage === 'test_plan').roles.includes('gate_coverage'), true);
  assert.equal(agentReviews.parallel_dispatch.required_stages.find((stage) => stage.stage === 'implementation').roles.includes('runtime_contract'), true);
  assert.equal(gateDag.nodes.some((node) => node.id === 'review:join:architecture_spec' && node.type === 'agent_review_stage_join_gate'), true);
  assert.equal(gateDag.nodes.some((node) => node.id === 'review:join:test_plan' && node.type === 'agent_review_stage_join_gate'), true);
  assert.equal(gateDag.edges.some((edge) => edge.from === 'review:join:architecture_spec' && edge.to === 'review:dispatch_batch:test_plan'), true);
  assert.equal(gateDag.edges.some((edge) => edge.from === 'review:dispatch_batch:test_plan' && edge.to === 'review:preflight:test_plan:gate_coverage'), true);
  assert.equal(gateDag.edges.some((edge) => edge.from === 'review:preflight:test_plan:gate_coverage' && edge.to === 'review:prepare:test_plan'), true);
  assert.equal(gateDag.edges.some((edge) => edge.from === 'review:join:test_plan' && edge.to === 'review:dispatch_batch:implementation'), true);
  assert.equal(gateDag.edges.some((edge) => edge.from === 'review:dispatch_batch:implementation' && edge.to === 'review:preflight:implementation:runtime_contract'), true);
  assert.equal(gateDag.edges.some((edge) => edge.from === 'review:preflight:implementation:runtime_contract' && edge.to === 'review:prepare:implementation'), true);
  assert.equal(gateDag.edges.some((edge) => edge.from === 'review:join:gate' && edge.to === 'gate:agent_review'), true);
  assert.equal(gateDag.edges.some((edge) => edge.from === 'review:prepare:preview' && edge.to === 'review:prepare:gate'), false);
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:agent_review').required_actions[0].includes('Current Agent Review stage 1'), true);
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:agent_review').required_actions[0].includes('architecture_spec'), true);
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:agent_review').required_actions.some((action) => action.includes('Later Agent Review stages are serial-barriered')), true);

  const gateDagJsonPath = path.join(repo, '.vibepro', 'pr', 'story-risk-adaptive', 'gate-dag.json');
  await stat(gateDagJsonPath);
  const writtenGateDag = await readJson(gateDagJsonPath);
  assert.equal(writtenGateDag.nodes.some((node) => node.id === 'gate:release_confidence'), true);
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

  const missingTargetReplay = await runCli(['pr', 'prepare', repo, '--story-id', 'story-risk-adaptive', '--base', 'main', '--json']);
  assert.equal(missingTargetReplay.exitCode, 0);
  const missingTargetReplayGate = missingTargetReplay.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:workflow_flow_replay');
  assert.equal(missingTargetReplayGate.status, 'needs_evidence');
  assert.match(missingTargetReplayGate.reason, /executable assertions|Story E2E coverage needs evidence|current passing Flow Verification or E2E replay evidence/);

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
	  assert.equal(trailingMarker.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:workflow_flow_replay').status, 'needs_evidence');

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
