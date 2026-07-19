import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acquireLease } from '../scripts/npm-release-lock.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

import {
  extractReleaseSections,
  npmDistTags,
  normalizeReleaseDocumentationLinks,
  projectPublishedVersion,
  projectReleaseNote,
  reconcileNpmRelease,
  desiredDistTags,
  sanitizeReleaseContent,
  shouldReleaseVersion
} from '../scripts/post-merge-release.mjs';

test('LRCL-001/002 locks the Linux Rollup binary as a root optional dependency', async () => {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(await readFile(path.join(repositoryRoot, 'package-lock.json'), 'utf8'));
  const version = packageJson.optionalDependencies?.['@rollup/rollup-linux-x64-gnu'];
  const locked = packageLock.packages?.['node_modules/@rollup/rollup-linux-x64-gnu'];

  assert.equal(version, '4.62.2');
  assert.equal(packageLock.packages?.['']?.optionalDependencies?.['@rollup/rollup-linux-x64-gnu'], version);
  assert.equal(locked?.version, version);
  assert.deepEqual(locked?.cpu, ['x64']);
  assert.deepEqual(locked?.os, ['linux']);
  assert.match(locked?.resolved ?? '', /@rollup\/rollup-linux-x64-gnu/);
});

test('RNLN-001/002/003 normalizes only repo-root docs markdown destinations', () => {
  const source = [
    '[story](docs/management/stories/active/story-example.md)',
    '[nested [label]](docs/nested.md)',
    '[titled](docs/guide.md "Guide title")',
    '[escaped-title](docs/escaped-title.md "A \\"quoted\\" title")',
    '[paren-title](docs/paren-title.md (Parenthesized title))',
    '[code `label ]`](docs/code-label.md)',
    '[![nested image](docs/nested-image.png)](docs/nested-image-page.md)',
    '![diagram](docs/architecture/diagram.png)',
    '[external](https://example.com/docs/file.md) [root](/guide/) [anchor](#done) [relative](guide/file.md)',
    '`[inline](docs/inline.md)`',
    '``[multi ` inline](docs/multi-inline.md)``',
    '\\`[escaped](docs/escaped.md)\\`',
    '``multiline',
    '[multiline-code](docs/multiline-code.md)',
    'span``',
    '> ```md',
    '> [blockquote-fenced](docs/blockquote-fenced.md)',
    '> ```',
    '```invalid`info',
    '[after-invalid-fence](docs/after-invalid.md)',
    '```md',
    '[fenced](docs/fenced.md)',
    '```',
    '````md',
    '```',
    '[long-fenced](docs/long-fenced.md)',
    '````'
  ].join('\n');

  assert.equal(normalizeReleaseDocumentationLinks(source), [
    '[story](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-example.md)',
    '[nested [label]](https://github.com/Unson-LLC/vibepro/blob/main/docs/nested.md)',
    '[titled](https://github.com/Unson-LLC/vibepro/blob/main/docs/guide.md "Guide title")',
    '[escaped-title](https://github.com/Unson-LLC/vibepro/blob/main/docs/escaped-title.md "A \\"quoted\\" title")',
    '[paren-title](https://github.com/Unson-LLC/vibepro/blob/main/docs/paren-title.md (Parenthesized title))',
    '[code `label ]`](https://github.com/Unson-LLC/vibepro/blob/main/docs/code-label.md)',
    '[![nested image](https://raw.githubusercontent.com/Unson-LLC/vibepro/main/docs/nested-image.png)](https://github.com/Unson-LLC/vibepro/blob/main/docs/nested-image-page.md)',
    '![diagram](https://raw.githubusercontent.com/Unson-LLC/vibepro/main/docs/architecture/diagram.png)',
    '[external](https://example.com/docs/file.md) [root](/guide/) [anchor](#done) [relative](guide/file.md)',
    '`[inline](docs/inline.md)`',
    '``[multi ` inline](docs/multi-inline.md)``',
    '\\`[escaped](https://github.com/Unson-LLC/vibepro/blob/main/docs/escaped.md)\\`',
    '``multiline',
    '[multiline-code](docs/multiline-code.md)',
    'span``',
    '> ```md',
    '> [blockquote-fenced](docs/blockquote-fenced.md)',
    '> ```',
    '```invalid`info',
    '[after-invalid-fence](https://github.com/Unson-LLC/vibepro/blob/main/docs/after-invalid.md)',
    '```md',
    '[fenced](docs/fenced.md)',
    '```',
    '````md',
    '```',
    '[long-fenced](docs/long-fenced.md)',
    '````'
  ].join('\n'));

  assert.equal(
    normalizeReleaseDocumentationLinks('` unmatched ``[double-span](docs/double-span.md)`` [after-unmatched](docs/after-unmatched.md)'),
    '` unmatched ``[double-span](docs/double-span.md)`` [after-unmatched](https://github.com/Unson-LLC/vibepro/blob/main/docs/after-unmatched.md)'
  );
});

test('PCR-CON-001 extracts stable release sections and normalizes blanks', () => {
  const sections = extractReleaseSections(`## Release Notes\n\n### Change Summary\nAdded deterministic publishing.\n\n### Compatibility\n\n### User Action\nRun npm update.`);
  assert.deepEqual(sections, {
    changeSummary: 'Added deterministic publishing.',
    compatibility: 'なし',
    userAction: 'Run npm update.'
  });
});

test('PCR-CON-001 neutralizes raw HTML and Vue interpolation from PR prose', () => {
  assert.equal(sanitizeReleaseContent('<script>{{ dangerous }}</script>'), '&lt;script&gt;&#123;&#123; dangerous &#125;&#125;&lt;/script&gt;');
});

test('PCR-CON-002/003 projects a PR #350-shaped entry idempotently into docs and changelog', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-release-'));
  await mkdir(path.join(root, 'docs/releases'), { recursive: true });
  await mkdir(path.join(root, 'docs/ja/releases'), { recursive: true });
  await writeFile(path.join(root, 'docs/releases/2026-07.md'), '# July 2026\n');
  await writeFile(path.join(root, 'docs/ja/releases/2026-07.md'), '# 2026年7月\n');
  await writeFile(path.join(root, 'docs/releases/index.md'), '# Release Notes\n');
  await writeFile(path.join(root, 'docs/ja/releases/index.md'), '# リリースノート\n');
  await writeFile(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n');
  const event = {
    pull_request: {
      number: 350, title: 'Ship <SCRIPT>{{ title }}</SCRIPT>', user: { login: 'octocat' }, merged_at: '2026-07-18T09:00:00Z',
      merge_commit_sha: 'abc123', html_url: 'https://github.com/Unson-LLC/vibepro/pull/350',
      body: '## Release Notes\n### Change Summary\nAutomatic notes. [Story](docs/management/stories/active/story-example.md)\n### Compatibility\nなし\n### User Action\nなし'
    }
  };
  await projectReleaseNote(root, event);
  await projectReleaseNote(root, event);
  for (const file of ['docs/releases/2026-07.md', 'docs/ja/releases/2026-07.md', 'CHANGELOG.md']) {
    const content = await readFile(path.join(root, file), 'utf8');
    assert.equal(content.match(/vibepro-release-pr:350:start/g)?.length, 1, file);
    assert.match(content, /Automatic notes/);
    assert.match(content, /\[Story\]\(https:\/\/github\.com\/Unson-LLC\/vibepro\/blob\/main\/docs\/management\/stories\/active\/story-example\.md\)/);
    assert.doesNotMatch(content, /\]\(docs\/management/);
    assert.match(content, /abc123/);
    assert.doesNotMatch(content, /<script>|\{\{ title \}\}/i);
    assert.match(content, /&lt;script&gt;&#123;&#123; title &#125;&#125;&lt;\/script&gt;/i);
  }
  for (const file of ['docs/releases/index.md', 'docs/ja/releases/index.md']) {
    const content = await readFile(path.join(root, file), 'utf8');
    assert.equal(content.match(/vibepro-release-index-pr:350:start/g)?.length, 1, file);
    assert.match(content, /\/releases\/2026-07/);
    assert.doesNotMatch(content, /<script>|\{\{ title \}\}/i);
  }
});

test('PCR-CON-004 only releases an increasing semantic version', () => {
  assert.equal(shouldReleaseVersion('0.2.0-beta.0', '0.2.0-beta.1'), true);
  assert.equal(shouldReleaseVersion('0.2.0-beta.1', '0.2.0-beta.1'), false);
  assert.equal(shouldReleaseVersion('0.2.0', '0.2.0-beta.2'), false);
});

test('PCR-CON-005 maps prerelease channels to explicit dist tags', () => {
  assert.deepEqual(npmDistTags('0.2.0-alpha.2'), ['alpha']);
  assert.deepEqual(npmDistTags('0.2.0-beta.1'), ['beta', 'latest']);
  assert.deepEqual(npmDistTags('0.2.0'), ['latest']);
});

test('PCR-CON-005 converges channels to the highest visible eligible SemVer', () => {
  assert.deepEqual(desiredDistTags([
    '0.2.0-beta.1', '0.2.0-beta.3', '0.2.0-alpha.9', '0.1.0'
  ], ['beta', 'latest']), {
    beta: '0.2.0-beta.3',
    latest: '0.2.0-beta.3'
  });
});

test('PCR-CON-005 treats current dist-tags as a monotonic floor when versions is stale', async () => {
  const mutations = [];
  let tagReads = 0;
  await reconcileNpmRelease({
    version: '0.2.0-beta.1', expectedSha: 'abc123',
    metadata: () => ({ version: '0.2.0-beta.1', gitHead: 'abc123' }),
    versions: () => ['0.2.0-beta.1'],
    execute: (command, args) => {
      if (args[0] === 'view') {
        tagReads += 1;
        return JSON.stringify({ beta: '0.2.0-beta.2', latest: '0.2.0-beta.2' });
      }
      if (args[0] === 'dist-tag') mutations.push(args.slice(2));
      return '';
    },
    delay: async () => {}
  });
  assert.equal(tagReads, 2);
  assert.deepEqual(mutations, [
    ['vibepro@0.2.0-beta.2', 'beta'],
    ['vibepro@0.2.0-beta.2', 'latest']
  ]);
});

test('PCR-CON-005 serializes an interleaved older release with an atomic lease', async () => {
  let remote = null;
  let interleaved = false;
  const sleeps = [];
  const result = await acquireLease({
    now: () => 100,
    readRemote: async () => remote,
    tryWrite: async (expected) => {
      if (!interleaved) {
        interleaved = true;
        remote = { sha: 'newer-run', message: 'vibepro-npm-release-lock:{"state":"locked","owner":"newer","expires_at":200}' };
        return null;
      }
      assert.equal(expected, 'free');
      return 'older-run-lock';
    },
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      if (milliseconds === 10_000) remote = { sha: 'free', message: 'vibepro-npm-release-lock:{"state":"free","expires_at":0}' };
    },
    maxAttempts: 4
  });
  assert.equal(result.token, 'older-run-lock');
  assert.deepEqual(sleeps, [1_000, 10_000]);
});

test('PCR-CON-008 workflow binds merged main PRs to docs deploy and conditional release', async () => {
  const workflow = await readFile(new URL('../.github/workflows/post-merge-release.yml', import.meta.url), 'utf8');
  const manualWorkflow = await readFile(new URL('../.github/workflows/npm-publish.yml', import.meta.url), 'utf8');
  const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(workflow, /pull_request_target:/);
  assert.doesNotMatch(workflow, /^\s+pull_request:\s*$/m);
  assert.match(workflow, /pull_request\.merged == true/);
  assert.match(workflow, /group: post-merge-release-pr-\$\{\{ github\.event\.pull_request\.number \}\}/);
  assert.match(workflow, /npm run docs:deploy/);
  assert.match(workflow, /release_required == 'true'/);
  assert.match(workflow, /post-merge-release\.mjs publish-npm/);
  assert.match(workflow, /github\.event\.pull_request\.merge_commit_sha/);
  assert.match(workflow, /git checkout --detach/);
  assert.match(workflow, /git checkout --detach[\s\S]*npm ci[\s\S]*npm run typecheck/);
  assert.match(workflow, /gh release edit/);
  assert.match(workflow, /npm-release-lock\.mjs acquire/);
  assert.match(workflow, /trap release_lock EXIT/);
  assert.match(workflow, /timeout-minutes: 90/);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/);
  assert.ok(workflow.indexOf('publish-npm') < workflow.indexOf('Project PR body into release history'));
  assert.ok(workflow.indexOf('publish-npm') < workflow.indexOf('gh release'));
  assert.ok(workflow.indexOf('gh release') < workflow.indexOf('Project PR body into release history'));
  const deployStep = workflow.match(/- name: Deploy VitePress manual[\s\S]*?(?=\n      - name:|$)/)?.[0] ?? '';
  assert.match(deployStep, /git pull --ff-only origin main[\s\S]*npm ci[\s\S]*npm run docs:deploy/);
  assert.match(gitignore, /^node_modules\/$/m);
  assert.match(workflow, /for attempt in 1 2 3; do[\s\S]*git fetch origin main[\s\S]*git reset --hard origin\/main[\s\S]*post-merge-release\.mjs project[\s\S]*git push origin HEAD:main/);
  assert.doesNotMatch(workflow, /git pull --rebase origin main/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
  assert.doesNotMatch(manualWorkflow, /^\s*release:/mu);
  assert.match(manualWorkflow, /npm-release-lock\.mjs acquire/);
  assert.match(manualWorkflow, /timeout-minutes: 90/);
  assert.equal((workflow + manualWorkflow).match(/post-merge-release\.mjs publish-npm/g)?.length, 2);
});

test('PCR-CON-006 reconciles an existing immutable version and converges all tags', async () => {
  const calls = [];
  const result = await reconcileNpmRelease({
    version: '0.2.0-beta.1', expectedSha: 'abc123', attempts: 2,
    metadata: () => ({ version: '0.2.0-beta.1', gitHead: 'abc123' }),
    versions: () => ['0.2.0-beta.1'],
    execute: (command, args) => {
      calls.push([command, ...args]);
      return args[0] === 'view' ? JSON.stringify({ beta: '0.2.0-beta.1', latest: '0.2.0-beta.1' }) : '';
    },
    delay: async () => {}
  });
  assert.equal(result.gitHead, 'abc123');
  assert.equal(calls.some((call) => call.includes('publish')), false);
  assert.deepEqual(calls.filter((call) => call[1] === 'dist-tag').map((call) => call.at(-1)), ['beta', 'latest']);
});

test('PCR-CON-006 rejects an existing version with another gitHead', async () => {
  await assert.rejects(
    reconcileNpmRelease({
      version: '0.2.0-beta.1', expectedSha: 'expected',
      metadata: () => ({ version: '0.2.0-beta.1', gitHead: 'other' }),
      versions: () => ['0.2.0-beta.1'],
      execute: () => { throw new Error('must not execute npm mutation'); }
    }),
    /published versions are immutable/
  );
});

test('PCR-CON-006 an older completing run cannot regress tags after a newer version is visible', async () => {
  const mutations = [];
  await reconcileNpmRelease({
    version: '0.2.0-beta.1', expectedSha: 'old-sha', attempts: 2,
    metadata: () => ({ version: '0.2.0-beta.1', gitHead: 'old-sha' }),
    versions: () => ['0.2.0-beta.1', '0.2.0-beta.2'],
    execute: (command, args) => {
      if (args[0] === 'dist-tag') mutations.push(args.slice(2));
      return args[0] === 'view' ? JSON.stringify({ beta: '0.2.0-beta.2', latest: '0.2.0-beta.2' }) : '';
    },
    delay: async () => {}
  });
  assert.deepEqual(mutations, [
    ['vibepro@0.2.0-beta.2', 'beta'],
    ['vibepro@0.2.0-beta.2', 'latest']
  ]);
});

test('PCR-CON-007 publishes once and bounds registry convergence retries', async () => {
  let reads = 0;
  const delays = [];
  const calls = [];
  await assert.rejects(
    reconcileNpmRelease({
      version: '0.2.0-beta.1', expectedSha: 'abc123', attempts: 3,
      metadata: () => { reads += 1; return null; },
      versions: () => ['0.2.0-beta.1'],
      execute: (command, args) => { calls.push([command, ...args]); return ''; },
      delay: async (milliseconds) => { delays.push(milliseconds); }
    }),
    /did not converge after 3 attempts/
  );
  assert.equal(calls.filter((call) => call.includes('publish')).length, 1);
  assert.equal(reads, 4);
  assert.deepEqual(delays, [1000, 2000]);
});

test('PCR-CON-007 retries metadata read failures without publishing', async () => {
  let reads = 0;
  const calls = [];
  await assert.rejects(reconcileNpmRelease({
    version: '0.2.0-beta.1', expectedSha: 'abc123', attempts: 3,
    metadata: () => { reads += 1; throw new Error('registry unavailable'); },
    versions: () => ['0.2.0-beta.1'],
    execute: (command, args) => { calls.push([command, ...args]); return ''; },
    delay: async () => {}
  }), /registry unavailable/);
  assert.equal(reads, 3);
  assert.equal(calls.length, 0);
});

test('PCR-CON-007 retries post-publish metadata exceptions with bounded backoff', async () => {
  let reads = 0;
  const delays = [];
  const calls = [];
  const result = await reconcileNpmRelease({
    version: '0.2.0-beta.1', expectedSha: 'abc123', attempts: 3,
    metadata: () => {
      reads += 1;
      if (reads === 1) return null;
      if (reads < 4) throw new Error('registry rate limited');
      return { version: '0.2.0-beta.1', gitHead: 'abc123' };
    },
    versions: () => ['0.2.0-beta.1'],
    execute: (command, args) => {
      calls.push([command, ...args]);
      return args[0] === 'view' ? JSON.stringify({ beta: '0.2.0-beta.1', latest: '0.2.0-beta.1' }) : '';
    },
    delay: async (milliseconds) => { delays.push(milliseconds); }
  });
  assert.equal(result.gitHead, 'abc123');
  assert.equal(calls.filter((call) => call.includes('publish')).length, 1);
  assert.deepEqual(delays, [1000, 2000]);
});

test('PCR-CON-007 retries dist-tag verification exceptions', async () => {
  let tagReads = 0;
  const delays = [];
  await reconcileNpmRelease({
    version: '0.2.0-beta.1', expectedSha: 'abc123', attempts: 3,
    metadata: () => ({ version: '0.2.0-beta.1', gitHead: 'abc123' }),
    versions: () => ['0.2.0-beta.1'],
    execute: (command, args) => {
      if (args[0] !== 'view') return '';
      tagReads += 1;
      if (tagReads < 3) throw new Error('invalid registry response');
      return JSON.stringify({ beta: '0.2.0-beta.1', latest: '0.2.0-beta.1' });
    },
    delay: async (milliseconds) => { delays.push(milliseconds); }
  });
  assert.equal(tagReads, 4);
  assert.deepEqual(delays, [1000, 2000]);
});

test('PCR-CON-004 projects a new published version without duplicating its index row', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-version-'));
  for (const relative of [
    'docs/ja/reference/version-history.md', 'docs/reference/version-history.md',
    'docs/ja/guide/release-and-audit.md', 'docs/guide/release-and-audit.md'
  ]) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), 'current 0.2.0-beta.0\n');
  }
  for (const relative of ['docs/ja/releases/index.md', 'docs/releases/index.md']) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), '| Version |\n| --- |\n');
  }
  await projectPublishedVersion(root, '0.2.0-beta.0', '0.2.0-beta.1', '2026-07-18T09:00:00Z');
  await projectPublishedVersion(root, '0.2.0-beta.0', '0.2.0-beta.1', '2026-07-18T09:00:00Z');
  const index = await readFile(path.join(root, 'docs/releases/index.md'), 'utf8');
  assert.equal(index.match(/0\.2\.0-beta\.1/g)?.length, 2);
  assert.doesNotMatch(index, /0\.2\.0-beta\.0/);
});

test('post-merge docs release is not gated by an approval environment', async () => {
  const workflow = await readFile(new URL('../.github/workflows/post-merge-release.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /^\s+environment:\s+npm\s*$/m);
});

test('post-merge release uses the trusted default-branch workflow for fork merges', async () => {
  const workflow = await readFile(new URL('../.github/workflows/post-merge-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /pull_request_target:[\s\S]*types:[\s\S]*- closed/);
  assert.match(workflow, /ref: main[\s\S]*git checkout --detach "\$RELEASE_SHA"/);
  assert.match(workflow, /pull_request\.merged == true/);
  assert.match(workflow, /pull_request\.base\.ref == 'main'/);
});
