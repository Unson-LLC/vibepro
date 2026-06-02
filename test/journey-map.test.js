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
  assert.equal(journey.walking_skeleton.status, 'covered');
  assert.deepEqual(journey.walking_skeleton.required_step_ids, ['discover', 'signup', 'first-value']);
  assert.equal(journey.conflicts.length, 0);
  assert.ok(journey.release_slices.find((slice) => slice.slice_id === 'walking_skeleton').story_ids.includes('story-product-auth-account-access'));

  const markdown = await readFile(path.join(repo, '.vibepro', 'journey', 'latest-journey.md'), 'utf8');
  // story-vibepro-readable-journey-markdown ac:1
  // Journey Markdownは、Story ID羅列より前に日本語の判断サマリーを表示する。
  assert.match(markdown, /# VibePro Journey/);
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

test('journey derive binds spec clauses, graphify surfaces, and gate evidence to steps', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-journey-bindings-'));
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
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'specs', 'story-product-auth-account-access.md'), `---
story_id: story-product-auth-account-access
title: Account access Spec
---
# Account access Spec

- \`INV-AUTH-1\`: Signup step keeps traceability to the auth route.
`);
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
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
  assert.equal(artifact.pr_context.journey_map.status, 'needs_evidence');
  assert.equal(artifact.pr_context.journey_map.current_story.step_id, 'signup');
  const body = await readFile(path.join(repo, '.vibepro', 'pr', 'story-product-auth-account-access', 'pr-body.md'), 'utf8');
  assert.match(body, /## Journey Map/);
  assert.match(body, /Current Story step: activation\/signup/);
});
