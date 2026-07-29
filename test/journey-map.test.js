import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';

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

test('journey derive creates Patton-style latest journey artifacts', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-journey-'));
  await runCli(['init', repo, '--story-id', 'story-product-public-discovery-seo', '--title', 'Public discovery']);
  await writeStory(repo, 'story-product-public-discovery-seo.md', `---
story_id: story-product-public-discovery-seo
title: Public discovery
journey_activity: acquisition
journey_step: discover
release_slice: walking_skeleton
status: active
---
# Public discovery

## Acceptance Criteria
- Users can understand the product value before signup
`);
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
  await writeStory(repo, 'story-security-auth-boundary.md', `---
story_id: story-security-auth-boundary
title: Auth boundary
category: security
journey_activity: risk_control
enabler_kind: security
release_slice: hardening
status: active
---
# Auth boundary
`);

  const derived = await captureRunCli(['journey', 'derive', repo, '--json']);

  assert.equal(derived.exitCode, 0, derived.stderr);
  const journey = JSON.parse(derived.stdout);
  assert.equal(journey.artifact_kind, 'journey_context_pack');
  assert.equal(journey.machine_derived, true);
  assert.equal(journey.authoritative, false);
  assert.equal(journey.curation_status, 'needs_curated_journey');
  assert.equal(journey.handoff.status, 'ready_for_ai');
  assert.equal(journey.walking_skeleton.status, 'covered');
  assert.deepEqual(journey.walking_skeleton.required_step_ids, ['discover', 'signup', 'first-value']);
  assert.equal(journey.conflicts.length, 0);
  assert.ok(journey.release_slices.find((slice) => slice.slice_id === 'walking_skeleton').story_ids.includes('story-product-auth-account-access'));

  const markdown = await readFile(path.join(repo, '.vibepro', 'journey', 'latest-journey.md'), 'utf8');
  // story-vibepro-readable-journey-markdown ac:1
  // Journey Markdownは、Story ID羅列より前に日本語の判断サマリーを表示する。
  assert.match(markdown, /# VibePro Journey/);
  assert.match(markdown, /machine-derived Journey context pack/);
  assert.match(markdown, /needs_curated_journey/);
  assert.match(markdown, /## いまの結論/);
  assert.match(markdown, /最小体験が成立/);
  assert.match(markdown, /## 現在の体験フロー/);
  assert.match(markdown, /## リリーススライス/);
  assert.match(markdown, /次の成長領域/);
  assert.match(markdown, /## 監査ログ: Patton式マップ/);
  assert.match(markdown, /First value/);
  assert.doesNotMatch(markdown, /Walking Skeleton/);
  assert.doesNotMatch(markdown, /Next Slice/);
  assert.doesNotMatch(markdown, /Hardening/);
  assert.doesNotMatch(markdown.slice(0, markdown.indexOf('## 監査ログ: Patton式マップ')), /story-product-first-value/);
});

test('journey handoff writes AI-readable handoff and status requires curated Journey', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-journey-handoff-'));
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

  const handoff = await captureRunCli(['journey', 'handoff', repo]);

  assert.equal(handoff.exitCode, 0, handoff.stderr);
  assert.match(handoff.stdout, /# Journey AI Handoff/);
  assert.match(handoff.stdout, /not the authoritative product Journey/);
  assert.match(handoff.stdout, /Curated artifact: `\.vibepro\/journeys\/default-product-journey\.json`/);
  const handoffMarkdown = await readFile(path.join(repo, '.vibepro', 'journey', 'latest-handoff.md'), 'utf8');
  assert.match(handoffMarkdown, /## Candidate Steps/);
  assert.match(handoffMarkdown, /signup/);

  const status = await captureRunCli(['journey', 'status', repo, '--json']);
  assert.equal(status.exitCode, 0, status.stderr);
  const parsed = JSON.parse(status.stdout);
  assert.equal(parsed.status, 'needs_curated_journey');
  assert.equal(parsed.curated, false);
  assert.equal(parsed.handoff_available, true);
  assert.equal(parsed.artifact_kind, 'journey_context_pack');
});

test('journey status reads curated Journey separately from handoff context', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-journey-curated-'));
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
`);
  await runCli(['journey', 'derive', repo]);
  await writeCuratedJourney(repo);

  const status = await captureRunCli(['journey', 'status', repo, '--json']);

  assert.equal(status.exitCode, 0, status.stderr);
  const parsed = JSON.parse(status.stdout);
  assert.equal(parsed.status, 'needs_evidence');
  assert.equal(parsed.curated, true);
  assert.equal(parsed.curated_journey_path, '.vibepro/journeys/default-product-journey.json');
  assert.equal(parsed.artifact_kind, 'curated_journey');
  assert.equal(parsed.context_pack.artifact_kind, 'journey_context_pack');
});

test('journey curate rejects partial judgments and writes curated Journey with deferrals', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-journey-curate-'));
  await runCli(['init', repo, '--story-id', 'story-product-auth-account-access', '--title', 'Account access']);
  await writeStory(repo, 'story-product-public-discovery-seo.md', `---
story_id: story-product-public-discovery-seo
title: Public discovery
journey_activity: acquisition
journey_step: discover
release_slice: walking_skeleton
status: active
---
# Public discovery
`);
  await writeStory(repo, 'story-product-auth-account-access.md', `---
story_id: story-product-auth-account-access
title: Account access
journey_activity: activation
journey_step: signup
journey_to: dashboard
release_slice: walking_skeleton
status: active
---
# Account access
`);
  await writeStory(repo, 'story-product-auth-alt-access.md', `---
story_id: story-product-auth-alt-access
title: Alternate account access
journey_activity: activation
journey_step: signup
journey_to: onboarding
release_slice: walking_skeleton
status: active
---
# Alternate account access
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
`);
  await writeStory(repo, 'story-product-parking-lot.md', `---
story_id: story-product-parking-lot
title: Parking lot
status: active
---
# Parking lot
`);
  await captureRunCli(['journey', 'derive', repo]);
  const latestJourneyPath = path.join(repo, '.vibepro', 'journey', 'latest-journey.json');
  const latestJourney = JSON.parse(await readFile(latestJourneyPath, 'utf8'));
  latestJourney.open_questions = [
    ...(latestJourney.open_questions ?? []),
    {
      id: 'decision:pricing-step',
      kind: 'release_slice_decision',
      question: 'Decide whether pricing belongs in this Journey slice.',
      blocker: true,
      step_id: 'signup'
    }
  ];
  await writeFile(latestJourneyPath, `${JSON.stringify(latestJourney, null, 2)}\n`);
  const partialInput = path.join(repo, 'judgments-partial.json');
  await writeFile(partialInput, JSON.stringify({
    conflicts: [
      { id: 'journey-conflict:activation:signup', status: 'resolved', reason: 'dashboard is canonical' }
    ]
  }, null, 2));

  const partial = await captureRunCli(['journey', 'curate', repo, '--input', partialInput]);
  assert.equal(partial.exitCode, 1);
  assert.match(partial.stderr, /Unhandled Journey curation items/);
  assert.match(partial.stderr, /open_question decision:pricing-step/);

  const completeInput = path.join(repo, 'judgments-complete.json');
  await writeFile(completeInput, JSON.stringify({
    conflicts: [
      { id: 'journey-conflict:activation:signup', status: 'resolved', reason: 'dashboard is canonical' }
    ],
    open_questions: [
      { id: 'decision:pricing-step', status: 'deferred', reason: 'pricing belongs to a later slice' }
    ],
    next_slice: 'activation-hardening'
  }, null, 2));
  const curated = await captureRunCli(['journey', 'curate', repo, '--input', completeInput, '--json']);

  assert.equal(curated.exitCode, 0, curated.stderr);
  const parsed = JSON.parse(curated.stdout);
  assert.equal(parsed.artifact_kind, 'curated_journey');
  assert.equal(parsed.machine_derived, false);
  assert.equal(parsed.curation.conflicts['journey-conflict:activation:signup'].status, 'resolved');
  assert.equal(parsed.curation.open_questions['decision:pricing-step'].status, 'deferred');
  const status = await captureRunCli(['journey', 'status', repo, '--json']);
  assert.equal(status.exitCode, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).status, 'available');
});

test('journey curate custom output remains authoritative for downstream status', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-journey-curate-output-'));
  await runCli(['init', repo, '--story-id', 'story-product-auth-account-access', '--title', 'Account access']);
  await writeStory(repo, 'story-product-public-discovery-seo.md', `---
story_id: story-product-public-discovery-seo
title: Public discovery
journey_activity: acquisition
journey_step: discover
release_slice: walking_skeleton
status: active
---
# Public discovery
`);
  await writeStory(repo, 'story-product-auth-account-access.md', `---
story_id: story-product-auth-account-access
title: Account access
journey_activity: activation
journey_step: signup
release_slice: walking_skeleton
status: active
---
# Account access
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
`);
  await captureRunCli(['journey', 'derive', repo]);
  const inputPath = path.join(repo, 'judgments.json');
  await writeFile(inputPath, `${JSON.stringify({}, null, 2)}\n`);
  const outputPath = path.join('artifacts', 'journey', 'curated-custom.json');

  const curated = await captureRunCli([
    'journey',
    'curate',
    repo,
    '--input',
    inputPath,
    '--output',
    outputPath,
    '--json'
  ]);

  assert.equal(curated.exitCode, 0, curated.stderr);
  assert.equal(JSON.parse(curated.stdout).artifact_kind, 'curated_journey');
  const status = await captureRunCli(['journey', 'status', repo, '--json']);
  assert.equal(status.exitCode, 0, status.stderr);
  const parsed = JSON.parse(status.stdout);
  assert.equal(parsed.status, 'available');
  assert.equal(parsed.curated, true);
  assert.equal(parsed.curated_journey_path, outputPath);
  assert.equal(parsed.artifact_kind, 'curated_journey');
});

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
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: bootstrap signup journey']);

  await captureRunCli(['journey', 'derive', repo]);
  const judgmentsPath = path.join(repo, 'journey-judgments.json');
  await writeFile(judgmentsPath, `${JSON.stringify({}, null, 2)}\n`);
  const curated = await captureRunCli(['journey', 'curate', repo, '--input', judgmentsPath, '--json']);
  assert.equal(curated.exitCode, 0, curated.stderr);
  const journeyStatus = await captureRunCli(['journey', 'status', repo, '--json']);
  assert.equal(JSON.parse(journeyStatus.stdout).status, 'available');

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

test('journey derive binds spec clauses, graphify surfaces, and gate evidence to steps', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-journey-bindings-'));
  await runCli(['init', repo, '--story-id', 'story-product-auth-account-access', '--title', 'Account access']);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.artifact_routing = {
    artifacts: { graphify: { canonical: 'docs/features/{feature_slug}/graphify' } }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await writeStory(repo, 'story-product-auth-account-access.md', `---
story_id: story-product-auth-account-access
title: Account access
journey_activity: activation
journey_step: signup
release_slice: walking_skeleton
status: active
---
# Account access
`);
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'specs', 'story-product-auth-account-access.md'), `---
story_id: story-product-auth-account-access
title: Account access Spec
---
# Account access Spec

- \`INV-AUTH-1\`: Signup step keeps traceability to the auth route.
`);
  const graphifyDir = path.join(repo, 'docs', 'features', 'product-auth-account-access', 'graphify');
  await mkdir(graphifyDir, { recursive: true });
  await writeFile(path.join(graphifyDir, 'graph.json'), JSON.stringify({
    stories: [
      {
        story_id: 'story-product-auth-account-access',
        surfaces: [
          { kind: 'route', ref: 'src/app/signup/page.tsx' },
          { kind: 'api', ref: 'src/app/api/auth/route.ts' },
          { kind: 'component', ref: 'src/components/auth/LoginForm.tsx' }
        ]
      }
    ]
  }, null, 2));
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-product-auth-account-access');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'verification-evidence.json'), JSON.stringify({
    story_id: 'story-product-auth-account-access',
    commands: [
      { kind: 'unit', status: 'pass', command: 'node --test test/auth.test.js' }
    ]
  }, null, 2));
  await writeFile(path.join(prDir, 'gate-dag.json'), JSON.stringify({
    story_id: 'story-product-auth-account-access',
    overall_status: 'ready',
    nodes: [
      { id: 'gate:unit', status: 'passed' }
    ]
  }, null, 2));

  const derived = await captureRunCli(['journey', 'derive', repo, '--json']);

  assert.equal(derived.exitCode, 0, derived.stderr);
  const journey = JSON.parse(derived.stdout);
  const signupStep = journey.backbone
    .find((activity) => activity.activity_id === 'activation')
    .steps.find((step) => step.step_id === 'signup');
  assert.ok(signupStep.evidence.some((item) => item.type === 'spec_clause' && item.ref === 'INV-AUTH-1'));
  assert.ok(signupStep.evidence.some((item) => item.type === 'surface' && item.ref === 'route:src/app/signup/page.tsx'));
  assert.ok(signupStep.evidence.some((item) => item.type === 'surface' && item.ref === 'api:src/app/api/auth/route.ts'));
  assert.ok(signupStep.evidence.some((item) => item.type === 'gate_evidence' && item.ref === 'unit:pass'));
  assert.ok(signupStep.evidence.some((item) => item.type === 'gate_evidence' && item.ref === 'gate_dag:ready'));

  const markdown = await readFile(path.join(repo, '.vibepro', 'journey', 'latest-journey.md'), 'utf8');
  // story-vibepro-readable-journey-markdown ac:2
  // 詳細証跡は監査ログとして残し、type名は読み手向けの日本語ラベルへ寄せる。
  assert.match(markdown, /監査ログ: 証跡バインディング/);
  assert.match(markdown, /Account access/);
  assert.match(markdown, /仕様: INV-AUTH-1/);
  assert.match(markdown, /対象面: .*route:src\/app\/signup\/page\.tsx/);
  assert.match(markdown, /検証: unit:pass/);
});

test('journey derive surfaces conflicting destinations on the same step', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-journey-conflict-'));
  await runCli(['init', repo, '--story-id', 'story-auth-home', '--title', 'Auth home']);
  await writeStory(repo, 'story-auth-home.md', `---
story_id: story-auth-home
title: Auth redirects home
journey_activity: activation
journey_step: signup
journey_to: home
status: active
---
# Auth redirects home
`);
  await writeStory(repo, 'story-auth-onboarding.md', `---
story_id: story-auth-onboarding
title: Auth redirects onboarding
journey_activity: activation
journey_step: signup
journey_to: onboarding
status: active
---
# Auth redirects onboarding
`);

  const derived = await captureRunCli(['journey', 'derive', repo, '--json']);

  assert.equal(derived.exitCode, 0, derived.stderr);
  const journey = JSON.parse(derived.stdout);
  assert.equal(journey.conflicts.length, 1);
  assert.deepEqual(journey.conflicts[0].destinations.sort(), ['home', 'onboarding']);
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
  await runCli(['journey', 'derive', repo]);
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
  await runCli(['journey', 'derive', repo]);
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
  await runCli(['journey', 'derive', repo]);
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
  await runCli(['journey', 'derive', repo]);
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
  await runCli(['journey', 'derive', repo]);
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
