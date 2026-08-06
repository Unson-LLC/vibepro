import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { curateJourneyMap, deriveJourneyMap, getJourneyStatus } from '../src/journey-map.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function captureRunCli(args) {
  let stdout = '';
  let stderr = '';
  const result = await runCli(args, {
    stdout: { write: (text) => { stdout += text; } },
    stderr: { write: (text) => { stderr += text; } }
  });
  return { ...result, stdout, stderr };
}

async function writeStory(repo, fileName, content) {
  const dir = path.join(repo, 'docs', 'management', 'stories', 'active');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, fileName), content);
}

async function writeCuratedJourney(repo, journeyId = 'default-product-journey') {
  const journeyPath = path.join(repo, '.vibepro', 'journey', 'latest-journey.json');
  const contextPack = JSON.parse(await readFile(journeyPath, 'utf8'));
  const curated = {
    ...contextPack,
    artifact_kind: 'curated_journey',
    machine_derived: false,
    authoritative: true,
    curation_status: 'curated'
  };
  const curatedDir = path.join(repo, '.vibepro', 'journeys');
  await mkdir(curatedDir, { recursive: true });
  await writeFile(path.join(curatedDir, `${journeyId}.json`), `${JSON.stringify(curated, null, 2)}\n`);
  return curated;
}

test('UI journey dogfood synthetic route resolves curated Journey and Visual QA gates', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-journey-dogfood-'));
  await mkdir(path.join(repo, 'src', 'components'), { recursive: true });
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', 'story-product-signup-ui', '--title', 'Signup UI']);
  await writeStory(repo, 'story-product-discovery.md', `---
story_id: story-product-discovery
title: Discovery
journey_activity: acquisition
journey_step: discover
release_slice: walking_skeleton
status: active
---
# Discovery

## Acceptance Criteria
- Users can understand the product value before signup
`);
  await writeStory(repo, 'story-product-signup-ui.md', `---
story_id: story-product-signup-ui
title: Signup UI
journey_activity: activation
journey_step: signup
release_slice: walking_skeleton
status: active
---
# Signup UI

## Acceptance Criteria
- Users can move through signup
`);
  await writeStory(repo, 'story-product-first-value.md', `---
story_id: story-product-first-value
title: First value
journey_activity: core_usage
journey_step: first-value
release_slice: walking_skeleton
status: active
---
# First value

## Acceptance Criteria
- Users can complete the first useful workflow
`);
  await writeFile(path.join(repo, 'src', 'components', 'Signup.tsx'), 'export function Signup() { return <button>Start</button>; }\n');
  await mkdir(path.join(repo, 'test', 'e2e'), { recursive: true });
  await writeFile(path.join(repo, 'test', 'e2e', 'signup-journey.spec.ts'), "import { test } from '@playwright/test';\ntest('signup journey', async () => {});\n");
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: bootstrap signup journey']);

  await deriveJourneyMap(repo, {});
  const judgmentsPath = path.join(repo, 'journey-judgments.json');
  await writeFile(judgmentsPath, `${JSON.stringify({}, null, 2)}\n`);
  await curateJourneyMap(repo, { inputPath: judgmentsPath });
  const journeyStatus = await getJourneyStatus(repo);
  assert.equal(journeyStatus.status, 'available');

  await git(repo, ['switch', '-c', 'feature/signup-journey-dogfood']);
  await writeFile(path.join(repo, 'src', 'components', 'Signup.tsx'), 'export function Signup() { return <button>Create account</button>; }\n');
  await git(repo, ['add', 'src/components/Signup.tsx']);
  await git(repo, ['commit', '-m', 'feat: update signup journey ui']);
  await mkdir(path.join(repo, 'artifacts', 'visual'), { recursive: true });
  await writeFile(path.join(repo, 'artifacts', 'visual', 'signup.png'), 'fake screenshot\n');

  const visualEvidence = await captureRunCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-product-signup-ui',
    '--kind',
    'e2e',
    '--status',
    'pass',
    '--command',
    'npx playwright test test/e2e/signup-journey.spec.ts',
    '--summary',
    'Signup Journey screenshot reviewed',
    '--target',
    'src/components/Signup.tsx',
    '--target',
    'artifacts/visual/signup.png',
    '--scenario',
    'visual_qa: signup journey screenshot reviewed',
    '--scenario',
    'screenshot: artifacts/visual/signup.png',
    '--artifact',
    'artifacts/visual/signup.png'
  ]);
  assert.equal(visualEvidence.exitCode, 0, visualEvidence.stderr);

  const prepare = await captureRunCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-product-signup-ui', '--allow-extra-files', '--json']);
  assert.equal(prepare.exitCode, 0, prepare.stderr);
  const artifact = JSON.parse(await readFile(path.join(repo, '.vibepro', 'pr', 'story-product-signup-ui', 'pr-prepare.json'), 'utf8'));
  const journeyGate = artifact.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:journey_context');
  const visualGate = artifact.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:visual_qa');
  assert.equal(journeyGate.status, 'passed');
  assert.equal(journeyGate.curated, true);
  assert.equal(journeyGate.artifact_kind, 'curated_journey');
  assert.equal(visualGate.status, 'ready_for_review');
  assert.equal(artifact.gate_status.critical_unresolved_gates.some((item) => item.id === 'gate:journey_context'), false);
  assert.equal(artifact.gate_status.critical_unresolved_gates.some((item) => item.id === 'gate:visual_qa'), false);
});

test('pr prepare embeds latest Journey Map summary when available', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-journey-pr-'));
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', 'story-product-auth-account-access', '--title', 'Account access']);
  await writeStory(repo, 'story-product-auth-account-access.md', `---
story_id: story-product-auth-account-access
title: Account access
journey_activity: activation
journey_step: signup
release_slice: walking_skeleton
status: active
---
# Account access

## Acceptance Criteria
- Users can sign up
`);
  await writeFile(path.join(repo, 'src', 'index.js'), 'export const value = 1;\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: bootstrap']);
  await deriveJourneyMap(repo, {});
  await git(repo, ['switch', '-c', 'feature/journey-pr']);
  await writeFile(path.join(repo, 'src', 'index.js'), 'export const value = 2;\n');
  await git(repo, ['add', 'src/index.js']);
  await git(repo, ['commit', '-m', 'feat: update account access']);

  const prepare = await captureRunCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-product-auth-account-access', '--allow-extra-files', '--json']);

  assert.equal(prepare.exitCode, 0, prepare.stderr);
  const artifact = JSON.parse(await readFile(path.join(repo, '.vibepro', 'pr', 'story-product-auth-account-access', 'pr-prepare.json'), 'utf8'));
  assert.equal(artifact.pr_context.journey_map.status, 'needs_curated_journey');
  assert.equal(artifact.pr_context.journey_map.curated, false);
  assert.equal(artifact.pr_context.journey_map.handoff_available, true);
  assert.equal(artifact.pr_context.journey_map.current_story.step_id, 'signup');
  const body = await readFile(path.join(repo, '.vibepro', 'pr', 'story-product-auth-account-access', 'pr-body.md'), 'utf8');
  assert.match(body, /\.vibepro\/pr\/story-product-auth-account-access\/pr-prepare\.json/);
  assert.doesNotMatch(body, /^## Journey Map$/m);
});

test('pr prepare requires Journey context for UI source changes', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-journey-ui-required-'));
  await mkdir(path.join(repo, 'components'), { recursive: true });
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', 'story-product-signup-ui', '--title', 'Signup UI']);
  await writeStory(repo, 'story-product-signup-ui.md', `---
story_id: story-product-signup-ui
title: Signup UI
journey_activity: activation
journey_step: signup
status: active
---
# Signup UI

## Acceptance Criteria
- Users can move through signup
`);
  await writeFile(path.join(repo, 'components', 'Signup.tsx'), 'export function Signup() { return <button>Start</button>; }\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: bootstrap signup ui']);
  await git(repo, ['switch', '-c', 'feature/signup-ui']);
  await writeFile(path.join(repo, 'components', 'Signup.tsx'), 'export function Signup() { return <button>Create account</button>; }\n');
  await git(repo, ['add', 'components/Signup.tsx']);
  await git(repo, ['commit', '-m', 'feat: update signup ui']);

  const prepare = await captureRunCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-product-signup-ui', '--allow-extra-files', '--json']);

  assert.equal(prepare.exitCode, 0, prepare.stderr);
  const artifact = JSON.parse(await readFile(path.join(repo, '.vibepro', 'pr', 'story-product-signup-ui', 'pr-prepare.json'), 'utf8'));
  const gate = artifact.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:journey_context');
  assert.equal(gate.status, 'needs_evidence');
  assert.equal(gate.journey_status, 'missing');
  assert.ok(artifact.pr_context.gate_dag.edges.some((edge) => edge.from === 'gate:path_surface_matrix' && edge.to === 'gate:journey_context'));
  assert.ok(artifact.pr_context.gate_dag.edges.some((edge) => edge.from === 'gate:journey_context' && edge.to === 'gate:design_ssot_reconciliation'));
  assert.ok(artifact.pr_context.gate_dag.edges.some((edge) => edge.from === 'gate:design_ssot_reconciliation' && edge.to === 'gate:responsibility_authority'));
  assert.ok(artifact.pr_context.gate_dag.edges.some((edge) => edge.from === 'gate:responsibility_authority' && edge.to === 'gate:requirement'));
  assert.equal(artifact.gate_status.critical_unresolved_gates.some((item) => item.id === 'gate:journey_context'), true);
});

test('pr prepare requires Journey context for JSX UI source changes outside component directories', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-journey-jsx-required-'));
  await mkdir(path.join(repo, 'src', 'ui'), { recursive: true });
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', 'story-product-signup-ui', '--title', 'Signup UI']);
  await writeStory(repo, 'story-product-signup-ui.md', `---
story_id: story-product-signup-ui
title: Signup UI
journey_activity: activation
journey_step: signup
status: active
---
# Signup UI

## Acceptance Criteria
- Users can move through signup
`);
  await writeFile(path.join(repo, 'src', 'ui', 'Button.jsx'), 'export function Button() { return <button>Start</button>; }\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: bootstrap jsx signup ui']);
  await git(repo, ['switch', '-c', 'feature/signup-jsx-ui']);
  await writeFile(path.join(repo, 'src', 'ui', 'Button.jsx'), 'export function Button() { return <button>Create account</button>; }\n');
  await git(repo, ['add', 'src/ui/Button.jsx']);
  await git(repo, ['commit', '-m', 'feat: update signup jsx ui']);

  const prepare = await captureRunCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-product-signup-ui', '--allow-extra-files', '--json']);

  assert.equal(prepare.exitCode, 0, prepare.stderr);
  const artifact = JSON.parse(await readFile(path.join(repo, '.vibepro', 'pr', 'story-product-signup-ui', 'pr-prepare.json'), 'utf8'));
  const gate = artifact.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:journey_context');
  assert.equal(gate.status, 'needs_evidence');
  assert.equal(gate.journey_status, 'missing');
  assert.equal(artifact.gate_status.critical_unresolved_gates.some((item) => item.id === 'gate:journey_context'), true);
});

test('pr prepare passes Journey context for UI source changes with a placed Journey story', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-journey-ui-placed-'));
  await mkdir(path.join(repo, 'components'), { recursive: true });
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', 'story-product-signup-ui', '--title', 'Signup UI']);
  await writeStory(repo, 'story-product-discovery.md', `---
story_id: story-product-discovery
title: Discovery
journey_activity: acquisition
journey_step: discover
release_slice: walking_skeleton
status: active
---
# Discovery

## Acceptance Criteria
- Users can discover the product
`);
  await writeStory(repo, 'story-product-signup-ui.md', `---
story_id: story-product-signup-ui
title: Signup UI
journey_activity: activation
journey_step: signup
release_slice: walking_skeleton
status: active
---
# Signup UI

## Acceptance Criteria
- Users can move through signup
`);
  await writeStory(repo, 'story-product-first-value.md', `---
story_id: story-product-first-value
title: First value
journey_activity: core_usage
journey_step: first-value
release_slice: walking_skeleton
status: active
---
# First value

## Acceptance Criteria
- Users can complete the first useful workflow
`);
  await writeFile(path.join(repo, 'components', 'Signup.tsx'), 'export function Signup() { return <button>Start</button>; }\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: bootstrap signup journey']);
  await deriveJourneyMap(repo, {});
  await writeCuratedJourney(repo);
  await git(repo, ['switch', '-c', 'feature/signup-ui']);
  await writeFile(path.join(repo, 'components', 'Signup.tsx'), 'export function Signup() { return <button>Create account</button>; }\n');
  await git(repo, ['add', 'components/Signup.tsx']);
  await git(repo, ['commit', '-m', 'feat: update signup ui']);

  const prepare = await captureRunCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-product-signup-ui', '--allow-extra-files', '--json']);

  assert.equal(prepare.exitCode, 0, prepare.stderr);
  const artifact = JSON.parse(await readFile(path.join(repo, '.vibepro', 'pr', 'story-product-signup-ui', 'pr-prepare.json'), 'utf8'));
  const gate = artifact.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:journey_context');
  assert.equal(gate.status, 'passed');
  assert.equal(gate.curated, true);
  assert.equal(gate.artifact_kind, 'curated_journey');
  assert.equal(gate.current_story.step_id, 'signup');
  assert.equal(artifact.gate_status.critical_unresolved_gates.some((item) => item.id === 'gate:journey_context'), false);
});

test('pr prepare flags affected Journey conflicts and blocking open questions for UI source changes', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-journey-ui-conflict-'));
  await mkdir(path.join(repo, 'components'), { recursive: true });
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', 'story-product-signup-ui', '--title', 'Signup UI']);
  await writeStory(repo, 'story-product-signup-ui.md', `---
story_id: story-product-signup-ui
title: Signup UI
journey_activity: activation
journey_step: signup
journey_to: home
release_slice: walking_skeleton
status: active
---
# Signup UI

## Acceptance Criteria
- Users can move through signup
`);
  await writeStory(repo, 'story-product-signup-onboarding.md', `---
story_id: story-product-signup-onboarding
title: Signup onboarding redirect
journey_activity: activation
journey_step: signup
journey_to: onboarding
release_slice: next_slice
status: active
---
# Signup onboarding redirect
`);
  await writeFile(path.join(repo, 'components', 'Signup.tsx'), 'export function Signup() { return <button>Start</button>; }\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: bootstrap conflicting signup journey']);
  await deriveJourneyMap(repo, {});
  const journeyPath = path.join(repo, '.vibepro', 'journey', 'latest-journey.json');
  const journey = JSON.parse(await readFile(journeyPath, 'utf8'));
  journey.open_questions.push({
    id: 'manual:blocking-signup-copy',
    kind: 'manual_review',
    question: 'Confirm the signup CTA destination before changing signup UI copy.',
    blocker: true,
    step_id: 'signup'
  });
  await writeFile(journeyPath, `${JSON.stringify(journey, null, 2)}\n`);
  await git(repo, ['switch', '-c', 'feature/signup-ui']);
  await writeFile(path.join(repo, 'components', 'Signup.tsx'), 'export function Signup() { return <button>Create account</button>; }\n');
  await git(repo, ['add', 'components/Signup.tsx']);
  await git(repo, ['commit', '-m', 'feat: update signup ui']);

  const prepare = await captureRunCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-product-signup-ui', '--allow-extra-files', '--json']);

  assert.equal(prepare.exitCode, 0, prepare.stderr);
  const artifact = JSON.parse(await readFile(path.join(repo, '.vibepro', 'pr', 'story-product-signup-ui', 'pr-prepare.json'), 'utf8'));
  const gate = artifact.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:journey_context');
  assert.equal(gate.status, 'needs_review');
  assert.equal(gate.affected_conflicts.length, 1);
  assert.deepEqual(gate.affected_conflicts[0].story_ids.sort(), ['story-product-signup-onboarding', 'story-product-signup-ui']);
  assert.equal(gate.affected_open_questions.some((question) => question.id === 'manual:blocking-signup-copy' && question.blocker === true), true);
  assert.match(gate.reason, /Journey conflict/);
  assert.equal(artifact.gate_status.critical_unresolved_gates.some((item) => item.id === 'gate:journey_context'), true);
});

test('pr prepare flags affected walking skeleton gaps for UI source changes', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-journey-ui-gap-'));
  await mkdir(path.join(repo, 'components'), { recursive: true });
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', 'story-product-signup-ui', '--title', 'Signup UI']);
  await writeStory(repo, 'story-product-signup-ui.md', `---
story_id: story-product-signup-ui
title: Signup UI
journey_activity: activation
journey_step: signup
release_slice: walking_skeleton
status: active
---
# Signup UI

## Acceptance Criteria
- Users can move through signup
`);
  await writeFile(path.join(repo, 'components', 'Signup.tsx'), 'export function Signup() { return <button>Start</button>; }\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: bootstrap signup journey gap']);
  await deriveJourneyMap(repo, {});
  await git(repo, ['switch', '-c', 'feature/signup-ui']);
  await writeFile(path.join(repo, 'components', 'Signup.tsx'), 'export function Signup() { return <button>Create account</button>; }\n');
  await git(repo, ['add', 'components/Signup.tsx']);
  await git(repo, ['commit', '-m', 'feat: update signup ui']);

  const prepare = await captureRunCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-product-signup-ui', '--allow-extra-files', '--json']);

  assert.equal(prepare.exitCode, 0, prepare.stderr);
  const artifact = JSON.parse(await readFile(path.join(repo, '.vibepro', 'pr', 'story-product-signup-ui', 'pr-prepare.json'), 'utf8'));
  const gate = artifact.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:journey_context');
  assert.equal(gate.status, 'needs_evidence');
  assert.equal(gate.walking_skeleton_status, 'needs_evidence');
  assert.match(gate.reason, /walking skeleton/);
  assert.equal(artifact.gate_status.critical_unresolved_gates.some((item) => item.id === 'gate:journey_context'), true);
});

test('pr prepare omits Journey context gate for non-UI source changes', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-journey-non-ui-'));
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', 'story-product-worker', '--title', 'Worker']);
  await writeStory(repo, 'story-product-worker.md', `---
story_id: story-product-worker
title: Worker
journey_activity: operations
journey_step: background-sync
status: active
---
# Worker

## Acceptance Criteria
- Background sync can run
`);
  await writeFile(path.join(repo, 'src', 'worker.js'), 'export function worker() { return 1; }\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: bootstrap worker']);
  await deriveJourneyMap(repo, {});
  await git(repo, ['switch', '-c', 'feature/worker']);
  await writeFile(path.join(repo, 'src', 'worker.js'), 'export function worker() { return 2; }\n');
  await git(repo, ['add', 'src/worker.js']);
  await git(repo, ['commit', '-m', 'feat: update worker']);

  const prepare = await captureRunCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-product-worker', '--allow-extra-files', '--json']);

  assert.equal(prepare.exitCode, 0, prepare.stderr);
  const artifact = JSON.parse(await readFile(path.join(repo, '.vibepro', 'pr', 'story-product-worker', 'pr-prepare.json'), 'utf8'));
  assert.equal(artifact.pr_context.gate_dag.nodes.some((node) => node.id === 'gate:journey_context'), false);
  assert.ok(artifact.pr_context.gate_dag.edges.some((edge) => edge.from === 'gate:path_surface_matrix' && edge.to === 'gate:design_ssot_reconciliation'));
  assert.ok(artifact.pr_context.gate_dag.edges.some((edge) => edge.from === 'gate:design_ssot_reconciliation' && edge.to === 'gate:responsibility_authority'));
  assert.ok(artifact.pr_context.gate_dag.edges.some((edge) => edge.from === 'gate:responsibility_authority' && edge.to === 'gate:requirement'));
});
