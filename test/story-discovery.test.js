import './support/scratch-tmpdir.js';
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

test('autonomous implementation closure exposes completed status in the canonical catalog and roadmap', async () => {
  const repo = process.cwd();
  const storyId = 'story-vibepro-autonomous-implementation-closure-roadmap';
  const config = JSON.parse(await readFile(path.join(repo, '.vibepro', 'config.json'), 'utf8'));
  const catalogStory = config.brainbase.stories.find((story) => story.story_id === storyId);
  const roadmap = await readFile(
    path.join(repo, 'docs', 'management', 'stories', 'active', `${storyId}.md`),
    'utf8'
  );

  assert.equal(catalogStory?.status, 'completed');
  assert.match(roadmap, /^status:\s*completed$/m);
  assert.match(roadmap, /PR #385/);
  assert.match(roadmap, /PR #386/);
});

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
