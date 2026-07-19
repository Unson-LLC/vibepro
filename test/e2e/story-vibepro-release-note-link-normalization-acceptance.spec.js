import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  normalizeReleaseDocumentationLinks,
  projectReleaseNote
} from '../../scripts/post-merge-release.mjs';

const STORY_ID = 'story-vibepro-release-note-link-normalization';

async function releaseFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-release-link-e2e-'));
  const files = {
    'docs/releases/2026-07.md': '# July 2026\n',
    'docs/ja/releases/2026-07.md': '# 2026年7月\n',
    'docs/releases/index.md': '# Release Notes\n\n| Date | Version | Channel | Summary |\n| --- | --- | --- | --- |\n',
    'docs/ja/releases/index.md': '# リリースノート\n\n| 日付 | バージョン | チャンネル | 概要 |\n| --- | --- | --- | --- |\n',
    'CHANGELOG.md': '# Changelog\n\n## Unreleased\n'
  };
  for (const [relative, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), content);
  }
  return root;
}

function mergedPrEvent() {
  return {
    pull_request: {
      merged: true,
      number: 350,
      title: 'Normalize release note documentation links',
      body: [
        '## Release Notes',
        '### Change Summary',
        '[Story](docs/management/stories/active/story-example.md)',
        '![Diagram](docs/architecture/example.png)',
        '[External](https://example.com/docs/file.md)',
        '`[Code](docs/code.md)`',
        '### Compatibility',
        'なし',
        '### User Action',
        'なし'
      ].join('\n'),
      user: { login: 'release-agent' },
      merged_at: '2026-07-19T09:00:00Z',
      merge_commit_sha: 'merge-sha-350',
      html_url: 'https://github.com/Unson-LLC/vibepro/pull/350',
      base: { ref: 'main', repo: { full_name: 'Unson-LLC/vibepro' } }
    }
  };
}

test(`${STORY_ID} projects a PR #350-shaped note with normalized links and idempotent history`, async () => {
  const ac1 = '通常のdocs pathリンクはGitHub blob URLへ、画像はraw URLへ正規化される';
  const ac2 = 'code spanと外部リンクは保持される';
  const ac3 = '生成済みPR #350のrelease noteが正規化済みになる';
  const ac4 = '同一eventの再投影はPR番号markerで冪等である';
  const scenario1 = 'RNLN-001 inline docs destinations preserve VitePress destination semantics';
  const scenario3 = 'RNLN-003 external and code destinations remain unchanged without aborting projection';
  const scenario5 = 'RNLN-005 English Japanese release history and CHANGELOG receive the same normalized idempotent note';

  const direct = normalizeReleaseDocumentationLinks('[Story](docs/story.md) ![Diagram](docs/diagram.png)');
  assert.match(direct, /github\.com\/Unson-LLC\/vibepro\/blob\/main\/docs\/story\.md/, `AC:1 ${ac1}; ${scenario1}`);
  assert.match(direct, /raw\.githubusercontent\.com\/Unson-LLC\/vibepro\/main\/docs\/diagram\.png/, `AC:1 ${ac1}; ${scenario1}`);

  const preserved = normalizeReleaseDocumentationLinks('[External](https://example.com/docs/file.md) `[Code](docs/code.md)`');
  assert.equal(preserved, '[External](https://example.com/docs/file.md) `[Code](docs/code.md)`', `AC:2 ${ac2}; ${scenario3}`);

  const root = await releaseFixture();
  const event = mergedPrEvent();
  await projectReleaseNote(root, event);
  const first = await Promise.all([
    readFile(path.join(root, 'docs/releases/2026-07.md'), 'utf8'),
    readFile(path.join(root, 'docs/ja/releases/2026-07.md'), 'utf8'),
    readFile(path.join(root, 'CHANGELOG.md'), 'utf8')
  ]);
  assert.ok(first.every((content) => content.includes('github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-example.md')), `AC:3 ${ac3}; ${scenario5}`);
  assert.ok(first.every((content) => content.includes('raw.githubusercontent.com/Unson-LLC/vibepro/main/docs/architecture/example.png')), `AC:3 ${ac3}; ${scenario5}`);

  await projectReleaseNote(root, event);
  const second = await Promise.all([
    readFile(path.join(root, 'docs/releases/2026-07.md'), 'utf8'),
    readFile(path.join(root, 'docs/ja/releases/2026-07.md'), 'utf8'),
    readFile(path.join(root, 'CHANGELOG.md'), 'utf8')
  ]);
  assert.deepEqual(second, first, `AC:4 ${ac4}; ${scenario5}`);
  assert.ok(second.every((content) => content.match(/vibepro-release-pr:350:start/g)?.length === 1), `AC:4 ${ac4}; ${scenario5}`);
});
