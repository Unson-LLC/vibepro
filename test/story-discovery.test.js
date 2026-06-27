import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import {
  findStorySource,
  inferSourceKind,
  isStoryDocPath,
  resolveStoryDirs
} from '../src/requirement-consistency.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function captureRunCli(args, options = {}) {
  let stdout = '';
  let stderr = '';
  const result = await runCli(args, {
    stdin: options.stdin ?? null,
    stdout: { write: (text) => { stdout += text; } },
    stderr: { write: (text) => { stderr += text; } }
  });
  return { ...result, stdout, stderr };
}

test('inferSourceKind classifies docs/user_stories/* as story', () => {
  assert.equal(inferSourceKind('docs/user_stories/active/US-002.md'), 'story');
  assert.equal(inferSourceKind('docs/user_stories/US-002.md'), 'story');
  assert.equal(inferSourceKind('docs/management/stories/active/foo.md'), 'story');
  assert.equal(inferSourceKind('docs/stories/foo.md'), 'story');
  assert.equal(inferSourceKind('docs/specs/foo.md'), 'spec');
  assert.equal(inferSourceKind('docs/architecture/ADR-x.md'), 'architecture');
  assert.equal(inferSourceKind('src/foo.ts'), 'requirement');
});

test('isStoryDocPath matches the supported story directories', () => {
  assert.equal(isStoryDocPath('docs/user_stories/active/US-002.md'), true);
  assert.equal(isStoryDocPath('docs/user_stories/US-002.md'), true);
  assert.equal(isStoryDocPath('docs/management/stories/active/foo.md'), true);
  assert.equal(isStoryDocPath('docs/stories/foo.md'), true);
  assert.equal(isStoryDocPath('docs/specs/foo.md'), false);
  assert.equal(isStoryDocPath('src/index.ts'), false);
});

test('resolveStoryDirs returns defaults when no override in config', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-storydirs-'));
  await runCli(['init', repo]);
  const dirs = await resolveStoryDirs(repo);
  assert.ok(dirs.includes(path.join('docs', 'user_stories', 'active')));
  assert.ok(dirs.includes(path.join('docs', 'management', 'stories', 'active')));
});

test('resolveStoryDirs honors .vibepro/config.json doc_paths.stories override', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-override-'));
  await runCli(['init', repo]);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.doc_paths = { stories: ['custom/stories'] };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const dirs = await resolveStoryDirs(repo);
  assert.deepEqual(dirs, ['custom/stories']);
});

test('findStorySource picks the story by frontmatter story_id when path substring would collide', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-fm-'));
  await runCli(['init', repo]);
  const dir = path.join(repo, 'docs', 'user_stories', 'active');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'US-022_other.md'), `---
story_id: US-022
---
# 別Story

## 背景
無関係なStory本文
`);
  await writeFile(path.join(dir, 'US-002_target.md'), `---
story_id: US-002
---
# 目的Story

## 背景
正しい背景テキスト

## 受け入れ基準
- 期待される受け入れ基準
`);
  const source = await findStorySource(repo, { story_id: 'US-002' });
  assert.match(source.path, /US-002_target\.md$/, 'frontmatter match must beat substring collision');
  assert.match(source.background ?? '', /正しい背景テキスト/);
  assert.ok(source.acceptance_criteria.some((line) => line.includes('期待される受け入れ基準')));
});

test('findStorySource does not fall back to another story for an explicit story_id', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-no-wrong-story-'));
  await runCli(['init', repo]);
  const dir = path.join(repo, 'docs', 'management', 'stories', 'active');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'STR-005-admin-inquiry-api-permission-error.md'), `---
story_id: STR-005
title: 管理画面：お問い合わせ詳細APIで権限エラー
---
# 管理画面：お問い合わせ詳細APIで権限エラー

## 受け入れ基準
- 管理画面からお問い合わせ詳細APIにアクセスできる
`);

  const source = await findStorySource(repo, { story_id: 'STR-047', title: 'サンプル承認後の本生成絵文字混入を防ぐ' });

  assert.equal(source.path, null);
  assert.equal(source.title, 'サンプル承認後の本生成絵文字混入を防ぐ');
  assert.deepEqual(source.acceptance_criteria, []);
});

test('findStorySource prefers exact story_id over child vibepro_story_id bindings', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-parent-fs-story-'));
  await runCli(['init', repo]);
  const dir = path.join(repo, 'docs', 'management', 'stories', 'active');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'story-child-a.md'), `---
story_id: story-child-a
vibepro_story_id: story-parent
title: Child A
---
# Child A

## Acceptance Criteria
- Child A criterion
`);
  await writeFile(path.join(dir, 'story-parent.md'), `---
story_id: story-parent
vibepro_story_id: story-parent
title: Parent Story
---
# Parent Story

## Acceptance Criteria
- Parent criterion
`);

  const source = await findStorySource(repo, { story_id: 'story-parent', title: 'Parent Story' });

  assert.match(source.path, /story-parent\.md$/);
  assert.equal(source.title, 'Parent Story');
  assert.ok(source.acceptance_criteria.some((item) => item.includes('Parent criterion')));
  assert.equal(source.acceptance_criteria.some((item) => item.includes('Child A criterion')), false);
});

test('pr prepare does not attach a mismatched story source for an explicit story_id', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-pr-no-wrong-story-'));
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'STR-005-admin-inquiry-api-permission-error.md'), `---
story_id: STR-005
title: 管理画面：お問い合わせ詳細APIで権限エラー
---
# 管理画面：お問い合わせ詳細APIで権限エラー

## 受け入れ基準
- 管理画面からお問い合わせ詳細APIにアクセスできる
`);
  await writeFile(path.join(repo, 'src', 'index.ts'), 'export const noop = true;\n');
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', 'STR-047', '--title', 'サンプル承認後の本生成絵文字混入を防ぐ']);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: bootstrap']);
  await git(repo, ['switch', '-c', 'feature/str-047']);
  await writeFile(path.join(repo, 'src', 'index.ts'), 'export const noop = false;\n');
  await git(repo, ['add', 'src/index.ts']);
  await git(repo, ['commit', '-m', 'fix: prevent emoji drift']);

  const prepare = await captureRunCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'STR-047', '--allow-extra-files', '--json']);

  assert.equal(prepare.exitCode, 0, `pr prepare failed: ${prepare.stderr}`);
  const artifact = JSON.parse(await readFile(path.join(repo, '.vibepro', 'pr', 'STR-047', 'pr-prepare.json'), 'utf8'));
  const source = artifact.pr_context.story_source;
  assert.equal(source.path, null);
  assert.equal(source.story_id, 'STR-047');
  assert.deepEqual(source.acceptance_criteria, []);
});

test('pr prepare reads Story from docs/user_stories/active when PR diff does not include the story file', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-aitle-'));
  await mkdir(path.join(repo, 'docs', 'user_stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  const storyId = 'US-002';
  await writeFile(path.join(repo, 'docs', 'user_stories', 'active', 'US-002_shadow_gpt_realtime.md'), `---
story_id: ${storyId}
title: Shadow GPT realtime 2 architecture
---
# Shadow GPT realtime 2 architecture

## 背景
shadow-call-gpt-realtime-2 では既存パイプラインが疎結合になっていない。本Storyは
serializerと再構成器の境界を明示し、ADRと整合させる。

## 受け入れ基準
- Story本文に明記されたAcceptance Criteriaが pr-body に反映される
- ADR-shadow-call-gpt-realtime-2 が architecture_docs に分類される
`);
  await writeFile(path.join(repo, 'src', 'index.ts'), 'export const noop = () => {};\n');
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', storyId, '--title', 'Shadow GPT realtime 2 architecture']);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: bootstrap']);
  await git(repo, ['switch', '-c', 'feature/impl']);
  // Implementation PR that does NOT touch the story document.
  await writeFile(path.join(repo, 'src', 'index.ts'), 'export const handler = () => "ok";\n');
  await git(repo, ['add', 'src/index.ts']);
  await git(repo, ['commit', '-m', 'feat: implement handler']);

  const prepare = await captureRunCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', storyId, '--allow-extra-files']);
  assert.equal(prepare.exitCode, 0, `pr prepare failed: ${prepare.stderr}`);
  const body = await readFile(path.join(repo, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(body, /docs\/user_stories\/active\/US-002_shadow_gpt_realtime\.md/, 'pr-body must cite the Story path');
  assert.match(body, /serializerと再構成器の境界/, 'pr-body must include Story background');
  assert.ok(
    prepare.result.preparation.pr_context.story_source.acceptance_criteria.some((item) => item.includes('Story本文に明記されたAcceptance Criteria')),
    'pr-context must include acceptance criteria from Story'
  );
  assert.doesNotMatch(body, /Story本文に明記されたAcceptance Criteria/, 'pr-body must keep acceptance criteria in artifacts instead of expanding details');
  assert.doesNotMatch(body, /Story文書から抽出できませんでした/, 'fallback discovery should prevent the missing-story banner');
});

test('pr prepare prefers exact parent story_id over child vibepro_story_id bindings', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-parent-story-source-'));
  const storyDir = path.join(repo, 'docs', 'management', 'stories', 'active');
  await mkdir(storyDir, { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(storyDir, 'story-child-a.md'), `---
story_id: story-child-a
vibepro_story_id: story-parent
title: Child A
---
# Child A

## Acceptance Criteria
- Child A criterion
`);
  await writeFile(path.join(storyDir, 'story-parent.md'), `---
story_id: story-parent
vibepro_story_id: story-parent
title: Parent Story
---
# Parent Story

## Background
Parent story binds child stories into one PR execution.

## Acceptance Criteria
- Parent criterion must be used in PR artifacts
`);
  await writeFile(path.join(repo, 'src', 'index.ts'), 'export const value = 1;\n');
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', 'story-parent', '--title', 'Parent Story']);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: bootstrap parent story']);
  await git(repo, ['switch', '-c', 'feature/parent-story']);
  await writeFile(path.join(repo, 'src', 'index.ts'), 'export const value = 2;\n');
  await git(repo, ['add', 'src/index.ts']);
  await git(repo, ['commit', '-m', 'feat: update source']);

  const prepare = await captureRunCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-parent', '--allow-extra-files', '--json']);

  assert.equal(prepare.exitCode, 0, `pr prepare failed: ${prepare.stderr}`);
  const artifact = JSON.parse(await readFile(path.join(repo, '.vibepro', 'pr', 'story-parent', 'pr-prepare.json'), 'utf8'));
  assert.match(artifact.pr_context.story_source.path, /story-parent\.md$/);
  assert.equal(artifact.pr_context.story_source.title, 'Parent Story');
  assert.ok(artifact.pr_context.story_source.acceptance_criteria.some((item) => item.includes('Parent criterion')));
  assert.equal(artifact.pr_context.story_source.acceptance_criteria.some((item) => item.includes('Child A criterion')), false);
});
