import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  projectPublishedVersion,
  projectReleaseNote,
  reconcileNpmRelease
} from '../../scripts/post-merge-release.mjs';

const STORY_ID = 'story-vibepro-pr-driven-continuous-release';

async function releaseFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-continuous-release-e2e-'));
  const files = {
    'docs/releases/2026-07.md': '# July 2026\n',
    'docs/ja/releases/2026-07.md': '# 2026年7月\n',
    'docs/releases/index.md': '# Release Notes\n\n| Date | Version | Channel | Summary |\n| --- | --- | --- | --- |\n',
    'docs/ja/releases/index.md': '# リリースノート\n\n| 日付 | バージョン | チャンネル | 概要 |\n| --- | --- | --- | --- |\n',
    'docs/reference/version-history.md': 'Current: 0.2.0-beta.0\n',
    'docs/ja/reference/version-history.md': 'Current: 0.2.0-beta.0\n',
    'docs/guide/release-and-audit.md': 'Current: 0.2.0-beta.0\n',
    'docs/ja/guide/release-and-audit.md': 'Current: 0.2.0-beta.0\n',
    'CHANGELOG.md': '# Changelog\n\n## Unreleased\n'
  };
  for (const [relative, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), content);
  }
  return root;
}

test(`${STORY_ID} replays merged-PR projection and immutable npm convergence`, async () => {
  // flow_replay: merged PR notes flow through deterministic documentation projection.
  // artifact_replay: rerunning the same merge converges without duplicate release blocks.
  // scenario_clause_e2e: PCR-CON-001 through PCR-CON-008 exercise the release boundary.
  const root = await releaseFixture();
  const event = {
    pull_request: {
      number: 73,
      title: 'Automate continuous release',
      body: '## Release Notes\n### Change Summary\nPR-authored release note.\n### Compatibility\nなし\n### User Action\nなし',
      user: { login: 'release-agent' },
      merged_at: '2026-07-18T09:00:00Z',
      merge_commit_sha: 'merge-sha-73',
      html_url: 'https://github.com/Unson-LLC/vibepro/pull/73'
    }
  };

  await projectReleaseNote(root, event);
  await projectPublishedVersion(root, '0.2.0-beta.0', '0.2.0-beta.1', event.pull_request.merged_at);
  await projectReleaseNote(root, event);
  await projectPublishedVersion(root, '0.2.0-beta.0', '0.2.0-beta.1', event.pull_request.merged_at);

  const release = await readFile(path.join(root, 'docs/releases/2026-07.md'), 'utf8');
  const index = await readFile(path.join(root, 'docs/releases/index.md'), 'utf8');
  const changelog = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.equal(release.match(/vibepro-release-pr:73:start/g)?.length, 1);
  assert.equal(changelog.match(/vibepro-release-pr:73:start/g)?.length, 1);
  assert.equal(index.match(/vibepro-release-index-pr:73:start/g)?.length, 1);
  assert.equal(index.match(/npmjs\.com\/package\/vibepro\/v\/0\.2\.0-beta\.1/g)?.length, 1);
  assert.match(release, /PR-authored release note/);

  const calls = [];
  let metadataReads = 0;
  const published = await reconcileNpmRelease({
    root,
    version: '0.2.0-beta.1',
    expectedSha: 'merge-sha-73',
    attempts: 3,
    metadata: () => {
      metadataReads += 1;
      return metadataReads < 3 ? null : { version: '0.2.0-beta.1', gitHead: 'merge-sha-73' };
    },
    execute: (command, args) => {
      calls.push([command, ...args]);
      return args[0] === 'view'
        ? JSON.stringify({ beta: '0.2.0-beta.1', latest: '0.2.0-beta.1' })
        : '';
    },
    delay: async () => {}
  });
  assert.equal(published.gitHead, 'merge-sha-73');
  assert.equal(calls.filter((call) => call.includes('publish')).length, 1);
  assert.deepEqual(calls.filter((call) => call[1] === 'dist-tag').map((call) => call.at(-1)), ['beta', 'latest']);

  const workflow = await readFile(new URL('../../.github/workflows/post-merge-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /pull_request\.merged == true/);
  assert.match(workflow, /npm run docs:deploy/);
  assert.match(workflow, /release_required == 'true'/);
  assert.match(workflow, /github\.event\.pull_request\.merge_commit_sha/);
});
