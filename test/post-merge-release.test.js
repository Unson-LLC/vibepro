import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMarkdownRenderer } from 'vitepress';
import { acquireLease } from '../scripts/npm-release-lock.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const releaseTestParser = await createMarkdownRenderer(repositoryRoot);

import {
  buildReleaseTiming,
  listGithubChecks,
  selectReleaseValidationPath,
  extractReleaseSections,
  commandRequiresMarkdownRenderer,
  npmDistTags,
  normalizeReleaseDocumentationLinks,
  projectPublishedVersion,
  projectReleaseNote,
  reconcileNpmRelease,
  serializeBareMarkdownDestination,
  desiredDistTags,
  sanitizeReleaseContent,
  shouldReleaseVersion
} from '../scripts/post-merge-release.mjs';

const releaseEvidenceFixture = ({
  baseSha = '1'.repeat(40),
  headSha = '2'.repeat(40),
  mergeSha = '3'.repeat(40),
  mergedAt = '2026-08-12T01:36:11Z'
} = {}) => ({
  pull_request: {
    merged: true,
    number: 458,
    title: 'Exact SHA release fixture',
    body: '',
    merged_at: mergedAt,
    merge_commit_sha: mergeSha,
    html_url: 'https://github.com/Unson-LLC/vibepro/pull/458',
    user: { login: 'release-agent' },
    base: {
      ref: 'main',
      sha: baseSha,
      repo: { full_name: 'Unson-LLC/vibepro' }
    },
    head: { sha: headSha }
  }
});

function successfulReleaseChecks(headSha = '2'.repeat(40), completedAt = '2026-08-12T01:35:00Z') {
  return ['test (20)', 'test (22)', 'analyze'].map((name) => ({
    name,
    status: 'completed',
    conclusion: 'success',
    head_sha: headSha,
    completed_at: completedAt,
    app: { slug: 'github-actions' },
    workflow_run: {
      id: name === 'analyze' ? 102 : 101,
      repository: { full_name: 'Unson-LLC/vibepro' },
      event: 'pull_request',
      path: name === 'analyze' ? '.github/workflows/codeql.yml' : '.github/workflows/ci.yml',
      head_sha: headSha,
      display_title: `${name === 'analyze' ? 'CodeQL' : 'CI'} | pr=458 | base=${'1'.repeat(40)} | head=${headSha}`
    }
  }));
}

function matchingMergeGit({
  baseSha = '1'.repeat(40),
  headSha = '2'.repeat(40),
  mergeSha = '3'.repeat(40),
  treeSha = '4'.repeat(40)
} = {}) {
  return (_command, args) => {
    if (args[0] === 'rev-list') return `${mergeSha} ${baseSha} ${headSha}`;
    if (args[0] === 'rev-parse') {
      if (`${args[1]}`.includes(':')) return '6'.repeat(40);
      return treeSha;
    }
    if (args[0] === 'merge-tree') return treeSha;
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  };
}

test('RELFAST-AC-001/002/003 selects fast only for bound tree and exact-SHA trusted checks', async () => {
  const result = await selectReleaseValidationPath({
    event: releaseEvidenceFixture(),
    execute: matchingMergeGit(),
    listChecks: async () => successfulReleaseChecks()
  });

  assert.equal(result.mode, 'fast');
  assert.equal(result.reviewedHeadSha, '2'.repeat(40));
  assert.equal(result.mergeSha, '3'.repeat(40));
  assert.deepEqual(result.reusedChecks.map((check) => check.name), ['test (20)', 'test (22)', 'analyze']);
  assert.deepEqual(result.reasons, []);
});

test('RELFAST-AC-004 falls back for missing, failed, or pending exact-SHA checks', async (t) => {
  for (const [label, checks, reason] of [
    ['missing', successfulReleaseChecks().filter((check) => check.name !== 'analyze'), 'missing_check:analyze'],
    ['failed', successfulReleaseChecks().map((check) => check.name === 'test (22)' ? { ...check, conclusion: 'failure' } : check), 'unsuccessful_check:test (22):failure'],
    ['pending', successfulReleaseChecks().map((check) => check.name === 'test (20)' ? { ...check, status: 'in_progress', conclusion: null } : check), 'incomplete_check:test (20):in_progress']
  ]) {
    await t.test(label, async () => {
      const result = await selectReleaseValidationPath({
        event: releaseEvidenceFixture(),
        execute: matchingMergeGit(),
        listChecks: async () => checks
      });
      assert.equal(result.mode, 'full');
      assert.ok(result.reasons.includes(reason), result.reasons.join(','));
    });
  }
});

test('RELFAST-AC-004 rejects stale evidence and exact-SHA mismatch', async (t) => {
  await t.test('stale', async () => {
    const result = await selectReleaseValidationPath({
      event: releaseEvidenceFixture(),
      execute: matchingMergeGit(),
      listChecks: async () => successfulReleaseChecks('2'.repeat(40), '2026-08-10T01:35:00Z'),
      maxEvidenceAgeMs: 24 * 60 * 60 * 1000
    });
    assert.equal(result.mode, 'full');
    assert.ok(result.reasons.some((reason) => reason.startsWith('stale_check:')));
  });

  await t.test('SHA mismatch', async () => {
    const result = await selectReleaseValidationPath({
      event: releaseEvidenceFixture(),
      execute: matchingMergeGit(),
      listChecks: async () => successfulReleaseChecks('9'.repeat(40))
    });
    assert.equal(result.mode, 'full');
    assert.ok(result.reasons.some((reason) => reason.startsWith('check_sha_mismatch:')));
  });
});

test('RELFAST-AC-004 falls back when check provenance or the Checks API is untrusted', async (t) => {
  await t.test('foreign check app', async () => {
    const result = await selectReleaseValidationPath({
      event: releaseEvidenceFixture(),
      execute: matchingMergeGit(),
      listChecks: async () => successfulReleaseChecks().map((check) => check.name === 'analyze'
        ? { ...check, app: { slug: 'third-party-ci' } }
        : check)
    });
    assert.equal(result.mode, 'full');
    assert.ok(result.reasons.includes('untrusted_check_app:analyze'));
  });

  await t.test('Checks API error', async () => {
    const result = await selectReleaseValidationPath({
      event: releaseEvidenceFixture(),
      execute: matchingMergeGit(),
      listChecks: async () => {
        throw new Error('API unavailable');
      }
    });
    assert.equal(result.mode, 'full');
    assert.ok(result.reasons.includes('check_evidence_unavailable'));
  });

  for (const [label, mutate, reason] of [
    ['current base SHA', (run) => ({ ...run, display_title: run.display_title.replace('1'.repeat(40), '8'.repeat(40)) }), 'workflow_binding_mismatch:test (20)'],
    ['workflow path', (run) => ({ ...run, path: '.github/workflows/other.yml' }), 'workflow_path_mismatch:test (20)'],
    ['workflow event', (run) => ({ ...run, event: 'push' }), 'workflow_event_mismatch:test (20)']
  ]) {
    await t.test(`mismatched ${label}`, async () => {
      const checks = successfulReleaseChecks().map((check) => check.name === 'test (20)'
        ? { ...check, workflow_run: mutate(check.workflow_run) }
        : check);
      const result = await selectReleaseValidationPath({
        event: releaseEvidenceFixture(),
        execute: matchingMergeGit(),
        listChecks: async () => checks
      });
      assert.equal(result.mode, 'full');
      assert.ok(result.reasons.includes(reason), result.reasons.join(','));
    });
  }

  await t.test('newer rerun is pending', async () => {
    const [first, ...rest] = successfulReleaseChecks();
    const pending = {
      ...first,
      status: 'queued',
      conclusion: null,
      completed_at: null,
      started_at: '2026-08-12T01:35:30Z'
    };
    const result = await selectReleaseValidationPath({
      event: releaseEvidenceFixture(),
      execute: matchingMergeGit(),
      listChecks: async () => [first, pending, ...rest]
    });
    assert.equal(result.mode, 'full');
    assert.ok(result.reasons.includes('incomplete_check:test (20):queued'));
  });
});

test('RELFAST-AC-002/004 loads every Checks page and binds each check to its workflow run', async () => {
  const headSha = '2'.repeat(40);
  const checks = successfulReleaseChecks(headSha).map((check, index) => ({
    ...check,
    details_url: `https://github.com/Unson-LLC/vibepro/actions/runs/${index < 2 ? 101 : 102}/job/${index + 1}`
  }));
  const calls = [];
  const loaded = await listGithubChecks({
    repository: 'Unson-LLC/vibepro',
    sha: headSha,
    root: repositoryRoot,
    execute: (_command, args) => {
      calls.push(args);
      if (args.includes('--paginate')) {
        return JSON.stringify([{ check_runs: checks.slice(0, 2) }, { check_runs: checks.slice(2) }]);
      }
      const runId = args.at(-1).split('/').at(-1);
      const fixture = checks.find((check) => `${check.workflow_run.id}` === runId).workflow_run;
      return JSON.stringify(fixture);
    }
  });
  assert.deepEqual(loaded.map((check) => check.name), ['test (20)', 'test (22)', 'analyze']);
  assert.equal(calls.filter((args) => args.at(-1).endsWith('/101')).length, 1);
  assert.equal(calls.filter((args) => args.at(-1).endsWith('/102')).length, 1);
});

test('RELFAST-AC-001/004 falls back when merge parents or reconstructed tree do not bind', async (t) => {
  await t.test('parent mismatch', async () => {
    const result = await selectReleaseValidationPath({
      event: releaseEvidenceFixture(),
      execute: (_command, args) => args[0] === 'rev-list'
        ? `${'3'.repeat(40)} ${'8'.repeat(40)} ${'2'.repeat(40)}`
        : '4'.repeat(40),
      listChecks: async () => successfulReleaseChecks()
    });
    assert.equal(result.mode, 'full');
    assert.ok(result.reasons.includes('merge_parent_mismatch'));
  });

  await t.test('tree mismatch', async () => {
    const result = await selectReleaseValidationPath({
      event: releaseEvidenceFixture(),
      execute: (_command, args) => {
        if (args[0] === 'rev-list') return `${'3'.repeat(40)} ${'1'.repeat(40)} ${'2'.repeat(40)}`;
        if (args[0] === 'rev-parse') return '4'.repeat(40);
        if (args[0] === 'merge-tree') return '5'.repeat(40);
        throw new Error('unexpected git command');
      },
      listChecks: async () => successfulReleaseChecks()
    });
    assert.equal(result.mode, 'full');
    assert.ok(result.reasons.includes('merge_tree_mismatch'));
  });

  await t.test('required CI workflow changed by the pull request', async () => {
    const result = await selectReleaseValidationPath({
      event: releaseEvidenceFixture(),
      execute: (_command, args) => {
        if (args[0] === 'rev-list') return `${'3'.repeat(40)} ${'1'.repeat(40)} ${'2'.repeat(40)}`;
        if (args[0] === 'merge-tree') return '4'.repeat(40);
        if (args[0] === 'rev-parse' && args[1] === `${'2'.repeat(40)}:.github/workflows/ci.yml`) {
          return '7'.repeat(40);
        }
        if (args[0] === 'rev-parse' && `${args[1]}`.includes(':')) return '6'.repeat(40);
        if (args[0] === 'rev-parse') return '4'.repeat(40);
        throw new Error('unexpected git command');
      },
      listChecks: async () => successfulReleaseChecks()
    });
    assert.equal(result.mode, 'full');
    assert.ok(result.reasons.includes('required_workflow_changed:.github/workflows/ci.yml'));
  });
});

test('RELFAST-AC-007/008 separates release stages and evaluates the 120 second target', () => {
  const timing = buildReleaseTiming({
    mergedAt: '2026-08-12T01:36:11Z',
    publishStartedAt: '2026-08-12T01:37:10Z',
    npmPublishedAt: '2026-08-12T01:37:55Z',
    workflowCompletedAt: '2026-08-12T01:38:25Z'
  });
  assert.deepEqual(timing, {
    merge_at: '2026-08-12T01:36:11.000Z',
    publish_started_at: '2026-08-12T01:37:10.000Z',
    npm_published_at: '2026-08-12T01:37:55.000Z',
    workflow_completed_at: '2026-08-12T01:38:25.000Z',
    pre_publish_ms: 59000,
    npm_publish_ms: 45000,
    post_publish_ms: 30000,
    merge_to_npm_ms: 104000,
    workflow_total_ms: 134000,
    merge_to_npm_target_ms: 120000,
    merge_to_npm_target_met: true,
    stage_measurement: 'complete'
  });
});

test('RELFAST-AC-007/008 timing CLI writes the decision surface to the workflow summary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-release-summary-'));
  const summary = path.join(root, 'summary.md');
  const result = spawnSync(process.execPath, [
    path.join(repositoryRoot, 'scripts/post-merge-release.mjs'),
    'timing',
    '--merged-at', '2026-08-12T01:36:11Z',
    '--publish-started-at', '2026-08-12T01:37:10Z',
    '--npm-published-at', '2026-08-12T01:37:55Z',
    '--workflow-completed-at', '2026-08-12T01:38:25Z'
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_STEP_SUMMARY: summary }
  });
  assert.equal(result.status, 0, result.stderr);
  const output = await readFile(summary, 'utf8');
  for (const expected of [
    'merge_at=2026-08-12T01:36:11.000Z',
    'publish_started_at=2026-08-12T01:37:10.000Z',
    'npm_published_at=2026-08-12T01:37:55.000Z',
    'workflow_completed_at=2026-08-12T01:38:25.000Z',
    'pre_publish_ms=59000',
    'npm_publish_ms=45000',
    'post_publish_ms=30000',
    'merge_to_npm_ms=104000',
    'workflow_total_ms=134000',
    'merge_to_npm_target_met=true'
  ]) assert.match(output, new RegExp(expected));
});

test('RNLN-SEC-001 escapes backslashes before serializing a bare Markdown destination', () => {
  assert.equal(
    serializeBareMarkdownDestination('https://example.com/docs/a\\b(c).md'),
    'https://example.com/docs/a\\\\b\\(c\\).md'
  );
});

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
    '[outer](https://example.com "[title](docs/not-a-link.md)")',
    '[escaped-terminal-title](https://example.com "[title](docs/not-a-link.md)\\"")',
    '[paren-escaped-terminal](docs/paren-escaped-terminal.md (Title\\)))',
    '[angle](<docs/guide/a b.md>)',
    '[encoded-angle](<docs/guide/a%20b.md>)',
    '[escaped-angle](<docs/guide/a\\>b.md>)',
    '[entity](docs/guide/a&amp;b.md)',
    '[escaped-parens](docs/guide/a\\(b\\).md)',
    '[outer [inner](docs/inner.md)](docs/outer.md)',
    '[code `label ]`](docs/code-label.md)',
    '[![nested image](docs/nested-image.png)](docs/nested-image-page.md)',
    '[![nested titled image](docs/nested-titled-image.png "title ] tail")](docs/nested-titled-image-page.md)',
    '![diagram](docs/architecture/diagram.png)',
    '[external](https://example.com/docs/file.md) [root](/guide/) [anchor](#done) [relative](guide/file.md)',
    '[reference]: docs/reference.md',
    '`[inline](docs/inline.md)`',
    '``[multi ` inline](docs/multi-inline.md)``',
    '`code \\` [prose-after-code](docs/prose-after-code.md)',
    '\\`[escaped](docs/escaped.md)\\`',
    '``multiline',
    '[multiline-code](docs/multiline-code.md)',
    'span``',
    '> ```md',
    '> [blockquote-fenced](docs/blockquote-fenced.md)',
    '> ```',
    '> ```md',
    '> > ```',
    '> [nested-blockquote-fenced](docs/nested-blockquote-fenced.md)',
    '> ````',
    '> ```md',
    '> [unclosed-blockquote](docs/unclosed-blockquote.md)',
    '[after-unclosed-blockquote](docs/after-unclosed-blockquote.md)',
    '- ~~~md',
    '  [list-fenced](docs/list-fenced.md)',
    '  ~~~~',
    '[after-list-fence](docs/after-list-fence.md)',
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
    '[outer](https://example.com "[title](docs/not-a-link.md)")',
    '[escaped-terminal-title](https://example.com "[title](docs/not-a-link.md)\\"")',
    '[paren-escaped-terminal](https://github.com/Unson-LLC/vibepro/blob/main/docs/paren-escaped-terminal.md (Title\\)))',
    '[angle](https://github.com/Unson-LLC/vibepro/blob/main/docs/guide/a%20b.md)',
    '[encoded-angle](https://github.com/Unson-LLC/vibepro/blob/main/docs/guide/a%20b.md)',
    '[escaped-angle](https://github.com/Unson-LLC/vibepro/blob/main/docs/guide/a%3Eb.md)',
    '[entity](https://github.com/Unson-LLC/vibepro/blob/main/docs/guide/a&b.md)',
    '[escaped-parens](https://github.com/Unson-LLC/vibepro/blob/main/docs/guide/a\\(b\\).md)',
    '[outer [inner](https://github.com/Unson-LLC/vibepro/blob/main/docs/inner.md)](docs/outer.md)',
    '[code `label ]`](https://github.com/Unson-LLC/vibepro/blob/main/docs/code-label.md)',
    '[![nested image](https://raw.githubusercontent.com/Unson-LLC/vibepro/main/docs/nested-image.png)](https://github.com/Unson-LLC/vibepro/blob/main/docs/nested-image-page.md)',
    '[![nested titled image](https://raw.githubusercontent.com/Unson-LLC/vibepro/main/docs/nested-titled-image.png "title ] tail")](https://github.com/Unson-LLC/vibepro/blob/main/docs/nested-titled-image-page.md)',
    '![diagram](https://raw.githubusercontent.com/Unson-LLC/vibepro/main/docs/architecture/diagram.png)',
    '[external](https://example.com/docs/file.md) [root](/guide/) [anchor](#done) [relative](guide/file.md)',
    '[reference]: docs/reference.md',
    '`[inline](docs/inline.md)`',
    '``[multi ` inline](docs/multi-inline.md)``',
    '`code \\` [prose-after-code](https://github.com/Unson-LLC/vibepro/blob/main/docs/prose-after-code.md)',
    '\\`[escaped](https://github.com/Unson-LLC/vibepro/blob/main/docs/escaped.md)\\`',
    '``multiline',
    '[multiline-code](docs/multiline-code.md)',
    'span``',
    '> ```md',
    '> [blockquote-fenced](docs/blockquote-fenced.md)',
    '> ```',
    '> ```md',
    '> > ```',
    '> [nested-blockquote-fenced](docs/nested-blockquote-fenced.md)',
    '> ````',
    '> ```md',
    '> [unclosed-blockquote](docs/unclosed-blockquote.md)',
    '[after-unclosed-blockquote](https://github.com/Unson-LLC/vibepro/blob/main/docs/after-unclosed-blockquote.md)',
    '- ~~~md',
    '  [list-fenced](docs/list-fenced.md)',
    '  ~~~~',
    '[after-list-fence](https://github.com/Unson-LLC/vibepro/blob/main/docs/after-list-fence.md)',
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

  const malformedAngle = `[malformed](<docs/${String.fromCharCode(0xd800)}.md>)`;
  assert.equal(
    normalizeReleaseDocumentationLinks(`${malformedAngle} [after](docs/after-malformed.md)`),
    `${malformedAngle} [after](https://github.com/Unson-LLC/vibepro/blob/main/docs/after-malformed.md)`
  );

  assert.equal(
    normalizeReleaseDocumentationLinks('`unclosed\n\n[prose](docs/prose.md) `'),
    '`unclosed\n\n[prose](https://github.com/Unson-LLC/vibepro/blob/main/docs/prose.md) `'
  );
  assert.equal(
    normalizeReleaseDocumentationLinks('`unclosed\n# heading\n[prose](docs/prose.md) `'),
    '`unclosed\n# heading\n[prose](https://github.com/Unson-LLC/vibepro/blob/main/docs/prose.md) `'
  );
  assert.equal(
    normalizeReleaseDocumentationLinks('`unclosed\n```md\n[fenced](docs/fenced.md)\n```\n[prose](docs/prose.md) `'),
    '`unclosed\n```md\n[fenced](docs/fenced.md)\n```\n[prose](https://github.com/Unson-LLC/vibepro/blob/main/docs/prose.md) `'
  );
  assert.equal(
    normalizeReleaseDocumentationLinks('-\t```md\n\t[inside](docs/inside.md)\n\t```\n[after](docs/after.md)'),
    '-\t```md\n\t[inside](docs/inside.md)\n\t```\n[after](https://github.com/Unson-LLC/vibepro/blob/main/docs/after.md)'
  );
  assert.equal(
    normalizeReleaseDocumentationLinks('-\t```md\n  [candidate](docs/candidate.md)\n[out](docs/out.md)'),
    '-\t```md\n  [candidate](https://github.com/Unson-LLC/vibepro/blob/main/docs/candidate.md)\n[out](https://github.com/Unson-LLC/vibepro/blob/main/docs/out.md)'
  );
  assert.equal(
    normalizeReleaseDocumentationLinks('    [indented-code](docs/inside.md)\n[after](docs/after.md)'),
    '    [indented-code](docs/inside.md)\n[after](https://github.com/Unson-LLC/vibepro/blob/main/docs/after.md)'
  );
  assert.equal(
    normalizeReleaseDocumentationLinks('- item\n    [continuation](docs/continuation.md)'),
    '- item\n    [continuation](https://github.com/Unson-LLC/vibepro/blob/main/docs/continuation.md)'
  );
  assert.equal(
    normalizeReleaseDocumentationLinks('- item\n\n      [list-code](docs/inside.md)\n\n    [list-prose](docs/prose.md)'),
    '- item\n\n      [list-code](docs/inside.md)\n\n    [list-prose](https://github.com/Unson-LLC/vibepro/blob/main/docs/prose.md)'
  );
  assert.equal(
    normalizeReleaseDocumentationLinks('[malformed](docs/a\\ b.md) [after](docs/after.md)'),
    '[malformed](docs/a\\ b.md) [after](https://github.com/Unson-LLC/vibepro/blob/main/docs/after.md)'
  );
  assert.equal(
    normalizeReleaseDocumentationLinks('- item\n  ```md\n  [inside](docs/inside.md)\n[after](docs/after.md)'),
    '- item\n  ```md\n  [inside](docs/inside.md)\n[after](https://github.com/Unson-LLC/vibepro/blob/main/docs/after.md)'
  );
  assert.equal(
    normalizeReleaseDocumentationLinks('- > ```md\n  > [inside](docs/inside.md)\n  > ```\n[after](docs/after.md)'),
    '- > ```md\n  > [inside](docs/inside.md)\n  > ```\n[after](https://github.com/Unson-LLC/vibepro/blob/main/docs/after.md)'
  );
  assert.equal(
    normalizeReleaseDocumentationLinks('[malformed](<docs/a<b.md>) [after](docs/after.md)'),
    '[malformed](<docs/a<b.md>) [after](https://github.com/Unson-LLC/vibepro/blob/main/docs/after.md)'
  );
  assert.equal(
    normalizeReleaseDocumentationLinks('`unclosed\n- [list](docs/list.md)\n[after](docs/after.md) `'),
    '`unclosed\n- [list](https://github.com/Unson-LLC/vibepro/blob/main/docs/list.md)\n[after](https://github.com/Unson-LLC/vibepro/blob/main/docs/after.md) `'
  );
});

test('RNLN-007 initializes the Markdown renderer only for projection commands', async () => {
  assert.equal(commandRequiresMarkdownRenderer('project'), true);
  assert.equal(commandRequiresMarkdownRenderer('reproject'), true);
  assert.equal(commandRequiresMarkdownRenderer('release-body'), true);
  assert.equal(commandRequiresMarkdownRenderer('plan'), false);
  assert.equal(commandRequiresMarkdownRenderer('publish-npm'), false);
  assert.equal(commandRequiresMarkdownRenderer('reconcile-github-release'), false);
  assert.equal(commandRequiresMarkdownRenderer('unknown'), false);

  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-renderer-boundary-'));
  await mkdir(path.join(root, 'scripts'));
  const isolatedScript = path.join(root, 'scripts', 'post-merge-release.mjs');
  await writeFile(isolatedScript, await readFile(path.join(repositoryRoot, 'scripts/post-merge-release.mjs'), 'utf8'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'vibepro', version: '1.0.0' }));
  runGit(root, ['init']);
  runGit(root, ['config', 'user.email', 'test@example.com']);
  runGit(root, ['config', 'user.name', 'VibePro Test']);
  runGit(root, ['add', 'package.json']);
  runGit(root, ['commit', '-m', 'base']);
  const baseSha = runGit(root, ['rev-parse', 'HEAD']);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'vibepro', version: '1.0.1' }));
  runGit(root, ['add', 'package.json']);
  runGit(root, ['commit', '-m', 'release']);
  const mergeSha = runGit(root, ['rev-parse', 'HEAD']);
  const eventPath = path.join(root, 'event.json');
  await writeFile(eventPath, JSON.stringify({
    pull_request: {
      merged: true,
      number: 1,
      title: 'Release renderer boundary fixture',
      body: '',
      merged_at: '2026-07-19T00:00:00Z',
      html_url: 'https://github.com/Unson-LLC/vibepro/pull/1',
      user: { login: 'vibepro-test' },
      base: { ref: 'main', sha: baseSha, repo: { full_name: 'Unson-LLC/vibepro' } },
      merge_commit_sha: mergeSha
    }
  }));

  const plan = spawnSync(process.execPath, [isolatedScript, 'plan', '--event', eventPath], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: '' }
  });
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /release_required=true/);

  const fakeBin = path.join(root, 'bin');
  await mkdir(fakeBin);
  const fakeNpm = path.join(fakeBin, 'npm');
  await writeFile(fakeNpm, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'view' && args[1] === 'vibepro@1.0.1') console.log(JSON.stringify({ version: '1.0.1', gitHead: '${mergeSha}' }));
else if (args[0] === 'view' && args[1] === 'vibepro' && args[2] === 'time') console.log(JSON.stringify({ '1.0.1': '2026-07-19T00:01:00Z' }));
else if (args[0] === 'view' && args[1] === 'vibepro' && args[2] === 'versions') console.log(JSON.stringify(['1.0.1']));
else if (args[0] === 'view' && args[1] === 'vibepro' && args[2] === 'dist-tags') console.log(JSON.stringify({ latest: '1.0.1' }));
else if (args[0] === 'dist-tag') process.exit(0);
else process.exit(2);
`);
  await chmod(fakeNpm, 0o755);
  const publish = spawnSync(process.execPath, [isolatedScript, 'publish-npm', '--version', '1.0.1', '--sha', mergeSha], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` }
  });
  assert.equal(publish.status, 0, publish.stderr);
});

test('RNLN-008 reprojects a trusted live PR payload through the real docs-only subprocess', async () => {
  const root = await createReprojectFixture();
  const eventPath = path.join(root, 'event.json');
  const event = livePullRequestEvent();
  await writeFile(eventPath, JSON.stringify(event));
  const protectedFiles = ['package.json', 'docs/version-history.md'];
  const projectedFiles = [
    'CHANGELOG.md',
    'docs/releases/2026-07.md',
    'docs/ja/releases/2026-07.md',
    'docs/releases/index.md',
    'docs/ja/releases/index.md'
  ];
  const protectedBefore = await readFiles(root, protectedFiles);

  const first = runReleaseSubprocess(root, ['reproject', '--event', eventPath]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /month=2026-07/);
  assert.match(first.stdout, /pr_number=350/);
  assert.deepEqual(await readFiles(root, protectedFiles), protectedBefore);
  const projectedOnce = await readFiles(root, projectedFiles);
  for (const content of Object.values(projectedOnce)) {
    assert.match(content, /vibepro-release-(?:index-)?pr:350:start/);
  }

  const second = runReleaseSubprocess(root, ['reproject', '--event', eventPath]);
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(await readFiles(root, projectedFiles), projectedOnce);
  assert.deepEqual(await readFiles(root, protectedFiles), protectedBefore);
});

test('RNLN-007 projects and renders a release body through their real CLI subprocesses', async () => {
  const root = await createReprojectFixture();
  runGit(root, ['init']);
  runGit(root, ['config', 'user.email', 'test@example.com']);
  runGit(root, ['config', 'user.name', 'VibePro Test']);
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-m', 'fixture']);
  const fixtureSha = runGit(root, ['rev-parse', 'HEAD']);
  const eventPath = path.join(root, 'event.json');
  const event = livePullRequestEvent({
    merge_commit_sha: fixtureSha,
    base: {
      ref: 'main',
      sha: fixtureSha,
      repo: { full_name: 'Unson-LLC/vibepro' }
    }
  });
  await writeFile(eventPath, JSON.stringify(event));

  const project = runReleaseSubprocess(root, ['project', '--event', eventPath]);
  assert.equal(project.status, 0, project.stderr);
  assert.match(project.stdout, /release_required=false/);
  assert.match(project.stdout, /pr_number=350/);
  assert.match(await readFile(path.join(root, 'CHANGELOG.md'), 'utf8'), /vibepro-release-pr:350:start/);

  const outputPath = path.join(root, 'release-body.md');
  const releaseBody = runReleaseSubprocess(root, ['release-body', '--event', eventPath, '--output', outputPath]);
  assert.equal(releaseBody.status, 0, releaseBody.stderr);
  const rendered = await readFile(outputPath, 'utf8');
  assert.match(rendered, /^## \[#350\]\(https:\/\/github\.com\/Unson-LLC\/vibepro\/pull\/350\)/);
  assert.match(rendered, /Automatic notes\. \[Story\]\(https:\/\/github\.com\/Unson-LLC\/vibepro\/blob\/main\/docs\/management\/stories\/active\/story-example\.md\)/);
});

test('RNLN-008 rejects untrusted reproject payloads before release docs mutation', async () => {
  const variants = [
    ['unmerged PR', { merged: false }, /pull_request\.merged must be true/],
    ['zero PR number', { number: 0 }, /pull_request\.number must be a positive integer/],
    ['non-integer PR number', { number: 350.5 }, /pull_request\.number must be a positive integer/],
    ['foreign repository', { base: { ref: 'main', repo: { full_name: 'attacker/foreign' } } }, /base\.repo\.full_name must be Unson-LLC\/vibepro/],
    ['non-default base', { base: { ref: 'release', repo: { full_name: 'Unson-LLC/vibepro' } } }, /base\.ref must be main/],
    ['external PR URL', { html_url: 'https://example.com/pull/350' }, /html_url must be https:\/\/github\.com\/Unson-LLC\/vibepro\/pull\/350/]
  ];

  for (const [label, override, errorPattern] of variants) {
    const root = await createReprojectFixture();
    const eventPath = path.join(root, 'event.json');
    const event = livePullRequestEvent(override);
    await writeFile(eventPath, JSON.stringify(event));
    const observedFiles = [
      'CHANGELOG.md',
      'docs/releases/2026-07.md',
      'docs/ja/releases/2026-07.md',
      'docs/releases/index.md',
      'docs/ja/releases/index.md'
    ];
    const before = await readFiles(root, observedFiles);
    const result = runReleaseSubprocess(root, ['reproject', '--event', eventPath]);
    assert.notEqual(result.status, 0, label);
    assert.match(result.stderr, errorPattern, label);
    assert.deepEqual(await readFiles(root, observedFiles), before, label);
  }
});

function livePullRequestEvent(override = {}) {
  const pullRequest = {
    merged: true,
    number: 350,
    title: 'Trusted live projection fixture',
    body: '## Release Notes\n### Change Summary\nAutomatic notes. [Story](docs/management/stories/active/story-example.md)\n### Compatibility\nなし\n### User Action\nなし',
    merged_at: '2026-07-18T09:00:00Z',
    merge_commit_sha: 'abc123',
    html_url: 'https://github.com/Unson-LLC/vibepro/pull/350',
    user: { login: 'octocat' },
    base: { ref: 'main', repo: { full_name: 'Unson-LLC/vibepro' } },
    ...override
  };
  return { pull_request: pullRequest };
}

async function createReprojectFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-reproject-'));
  await mkdir(path.join(root, 'scripts'));
  await mkdir(path.join(root, 'docs/releases'), { recursive: true });
  await mkdir(path.join(root, 'docs/ja/releases'), { recursive: true });
  await symlink(path.join(repositoryRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  await writeFile(path.join(root, 'scripts/post-merge-release.mjs'), await readFile(path.join(repositoryRoot, 'scripts/post-merge-release.mjs'), 'utf8'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'vibepro', version: '9.9.9' }));
  await writeFile(path.join(root, 'docs/version-history.md'), '# Version history\n\nMust remain unchanged.\n');
  await writeFile(path.join(root, 'docs/releases/2026-07.md'), '# July 2026\n');
  await writeFile(path.join(root, 'docs/ja/releases/2026-07.md'), '# 2026年7月\n');
  await writeFile(path.join(root, 'docs/releases/index.md'), '# Release Notes\n');
  await writeFile(path.join(root, 'docs/ja/releases/index.md'), '# リリースノート\n');
  await writeFile(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n');
  return root;
}

function runReleaseSubprocess(root, args) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/post-merge-release.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: '' }
  });
}

async function readFiles(root, relativePaths) {
  return Object.fromEntries(await Promise.all(relativePaths.map(async (relative) => [
    relative,
    await readFile(path.join(root, relative), 'utf8')
  ])));
}

function runGit(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('RNLN-001 preserves VitePress destination semantics across escape and entity normalization', () => {
  const fixtures = [
    '[x](<docs/a\\>b.md>)',
    '[x](docs/a&amp;b.md)',
    '[x](docs/a\\(b\\).md)'
  ];
  for (const fixture of fixtures) {
    const before = firstRenderedHref(fixture);
    const after = firstRenderedHref(normalizeReleaseDocumentationLinks(fixture));
    assert.equal(after, `https://github.com/Unson-LLC/vibepro/blob/main/${before}`);
  }
});

function firstRenderedHref(markdown) {
  const inline = releaseTestParser.parse(markdown, {}).find((token) => token.type === 'inline');
  const link = inline?.children?.find((token) => token.type === 'link_open');
  return link?.attrGet('href');
}

test('PCR-CON-001 extracts stable release sections and normalizes blanks', () => {
  const sections = extractReleaseSections(`## Release Notes\n\n### Change Summary\nAdded deterministic publishing. [angle](<docs/guide/a b.md>) <script>{{ unsafe }}</script>\n\n### Compatibility\n\n### User Action\nRun npm update.`);
  assert.deepEqual(sections, {
    changeSummary: 'Added deterministic publishing. [angle](https://github.com/Unson-LLC/vibepro/blob/main/docs/guide/a%20b.md) &lt;script&gt;&#123;&#123; unsafe &#125;&#125;&lt;/script&gt;',
    compatibility: 'なし',
    userAction: 'Run npm update.'
  });
});

test('RNLN-004/005 preserves protected code contexts through production extraction', () => {
  const sections = extractReleaseSections([
    '## Release Notes',
    '### Change Summary',
    '`[inline](docs/inline.md)`',
    '```md',
    '[fenced](docs/fenced.md)',
    '```',
    '[prose](docs/prose.md)',
    '### Compatibility',
    'なし',
    '### User Action',
    'なし'
  ].join('\n'));

  assert.equal(sections.changeSummary, [
    '`[inline](docs/inline.md)`',
    '```md',
    '[fenced](docs/fenced.md)',
    '```',
    '[prose](https://github.com/Unson-LLC/vibepro/blob/main/docs/prose.md)'
  ].join('\n'));
});

test('RNLN-004 derives release section boundaries from rendered Markdown blocks', () => {
  const sections = extractReleaseSections([
    '## Release Notes',
    '### Change Summary',
    'before',
    '```md',
    '### Compatibility',
    '[inside](docs/inside.md)',
    '```',
    'after',
    '### Compatibility',
    'none',
    '### User Action',
    'none'
  ].join('\n'));

  assert.deepEqual(sections, {
    changeSummary: [
      'before',
      '```md',
      '### Compatibility',
      '[inside](docs/inside.md)',
      '```',
      'after'
    ].join('\n'),
    compatibility: 'none',
    userAction: 'none'
  });
});

test('RNLN-006 ignores container headings when extracting top-level release sections', () => {
  const sections = extractReleaseSections([
    '> ## Release Notes',
    '> quoted release heading',
    '## Release Notes',
    '### Change Summary',
    'before',
    '> ### Compatibility',
    '> quoted compatibility heading',
    '- ### User Action',
    '  listed user-action heading',
    'after',
    '### Compatibility',
    'none',
    '### User Action',
    'none'
  ].join('\n'));

  assert.deepEqual(sections, {
    changeSummary: [
      'before',
      '&gt; ### Compatibility',
      '&gt; quoted compatibility heading',
      '- ### User Action',
      '  listed user-action heading',
      'after'
    ].join('\n'),
    compatibility: 'none',
    userAction: 'none'
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
      merged: true, number: 350, title: 'Ship <SCRIPT>{{ title }}</SCRIPT>', user: { login: 'octocat' }, merged_at: '2026-07-18T09:00:00Z',
      merge_commit_sha: 'abc123', html_url: 'https://github.com/Unson-LLC/vibepro/pull/350',
      base: { ref: 'main', repo: { full_name: 'Unson-LLC/vibepro' } },
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
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.merge_commit_sha \}\}/);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$RELEASE_SHA"/);
  assert.match(workflow, /post-merge-release\.mjs reconcile-github-release/);
  assert.match(workflow, /npm-release-lock\.mjs acquire/);
  assert.match(workflow, /trap release_lock EXIT/);
  assert.match(workflow, /timeout-minutes: 90/);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/);
  assert.ok(workflow.indexOf('publish-npm') < workflow.indexOf('Project PR body into release history'));
  assert.ok(workflow.indexOf('publish-npm') < workflow.indexOf('reconcile-github-release'));
  assert.ok(workflow.indexOf('reconcile-github-release') < workflow.indexOf('Project PR body into release history'));
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

test('PCR-CON-004 appends published-version history across sequential idempotent projections', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-version-'));
  const files = {
    'docs/reference/version-history.md': [
      '# Version and Release Channels',
      '| Channel | Version | Authority |',
      '| --- | --- | --- |',
      '| npm `latest` | `0.2.0-beta.0` | registry |',
      '| npm `beta` | `0.2.0-beta.0` | registry |',
      '| Repository `main` | `0.2.0-beta.0` release source | package |',
      '## 0.2.0-beta.0',
      'Original English beta zero body.',
      '## 0.1.9',
      'Historical text mentions 0.2.0-beta.0 and must remain unchanged.'
    ].join('\n') + '\n',
    'docs/ja/reference/version-history.md': [
      '# \u30d0\u30fc\u30b8\u30e7\u30f3\u3068\u30ea\u30ea\u30fc\u30b9\u30c1\u30e3\u30cd\u30eb',
      '| Channel | Version | Authority |',
      '| --- | --- | --- |',
      '| npm `latest` | `0.2.0-beta.0` | registry |',
      '| npm `beta` | `0.2.0-beta.0` | registry |',
      '| Repository `main` | `0.2.0-beta.0` release source | package |',
      '## 0.2.0-beta.0',
      '\u5143\u306ebeta zero\u672c\u6587\u3002',
      '## 0.1.9',
      '\u5c65\u6b74\u306e0.2.0-beta.0\u306f\u66f8\u304d\u63db\u3048\u306a\u3044\u3002'
    ].join('\n') + '\n',
    'docs/guide/release-and-audit.md': '## Upgrade to 0.2.0-beta.0\nRollback with `vibepro@0.1.9`; historical 0.2.0-beta.0 text stays.\n',
    'docs/ja/guide/release-and-audit.md': '## 0.2.0-beta.0\u3078\u306eupgrade\n`vibepro@0.1.9`\u3078rollback\u3002\u5c65\u6b74\u306e0.2.0-beta.0\u306f\u6b8b\u3059\u3002\n',
    'docs/.vitepress/config.mjs': "export default {\n  softwareVersion: '0.2.0-beta.0',\n};\n"
  };
  for (const [relative, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), content);
  }
  for (const relative of ['docs/ja/releases/index.md', 'docs/releases/index.md']) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), '| Version |\n| --- |\n');
  }
  const projectedFiles = [...Object.keys(files), 'docs/releases/index.md', 'docs/ja/releases/index.md'];
  const snapshot = async () => Object.fromEntries(await Promise.all(
    projectedFiles.map(async (relative) => [
      relative,
      await readFile(path.join(root, relative), 'utf8')
    ])
  ));

  await projectPublishedVersion(root, '0.2.0-beta.0', '0.2.0-beta.1', '2026-07-18T09:00:00Z');
  const firstProjection = await snapshot();
  await projectPublishedVersion(root, '0.2.0-beta.0', '0.2.0-beta.1', '2026-07-18T09:00:00Z');
  assert.deepEqual(await snapshot(), firstProjection, 'the first release replay must be byte-idempotent');

  await projectPublishedVersion(root, '0.2.0-beta.1', '0.2.0-beta.2', '2026-07-19T09:00:00Z');
  const secondProjection = await snapshot();
  await projectPublishedVersion(root, '0.2.0-beta.1', '0.2.0-beta.2', '2026-07-19T09:00:00Z');
  assert.deepEqual(await snapshot(), secondProjection, 'the second release replay must be byte-idempotent');

  const index = await readFile(path.join(root, 'docs/releases/index.md'), 'utf8');
  assert.equal(index.match(/\/v\/0\.2\.0-beta\.1\)/g)?.length, 1);
  assert.equal(index.match(/\/v\/0\.2\.0-beta\.2\)/g)?.length, 1);
  assert.doesNotMatch(index, /0\.2\.0-beta\.0/);
  const headingSequences = [];
  for (const locale of ['', 'ja/']) {
    const history = await readFile(path.join(root, `docs/${locale}reference/version-history.md`), 'utf8');
    const headings = [...history.matchAll(/^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)$/gmu)]
      .map((match) => match[1]);
    headingSequences.push(headings);
    assert.deepEqual(headings, ['0.2.0-beta.2', '0.2.0-beta.1', '0.2.0-beta.0', '0.1.9']);
    assert.equal(new Set(headings).size, headings.length, 'published headings must be unique');
    assert.match(history, /npm `latest` \| `0\.2\.0-beta\.2`/);
    assert.match(history, /npm `beta` \| `0\.2\.0-beta\.2`/);
    assert.match(history, /Repository `main` \| `0\.2\.0-beta\.2` release source/);
    assert.equal((history.match(locale ? /\u5143\u306ebeta zero\u672c\u6587\u3002/g : /Original English beta zero body\./g) ?? []).length, 1);
    assert.equal((history.match(locale ? /\u5c65\u6b74\u306e0\.2\.0-beta\.0\u306f\u66f8\u304d\u63db\u3048\u306a\u3044\u3002/g : /Historical text mentions 0\.2\.0-beta\.0 and must remain unchanged\./g) ?? []).length, 1);
    assert.equal((history.match(locale ? /\u3053\u306e\u516c\u958b\u7248\u306e\u5909\u66f4\u8a73\u7d30/g : /Detailed changes for this published version/g) ?? []).length, 2);
  }
  assert.deepEqual(headingSequences[0], headingSequences[1], 'English and Japanese ledgers must match');
  assert.match(secondProjection['docs/guide/release-and-audit.md'], /## Upgrade to 0\.2\.0-beta\.2/);
  assert.match(secondProjection['docs/guide/release-and-audit.md'], /vibepro@0\.1\.9/);
  assert.match(secondProjection['docs/guide/release-and-audit.md'], /historical 0\.2\.0-beta\.0 text stays/);
  assert.match(secondProjection['docs/ja/guide/release-and-audit.md'], /## 0\.2\.0-beta\.2\u3078\u306eupgrade/);
  assert.match(secondProjection['docs/ja/guide/release-and-audit.md'], /vibepro@0\.1\.9/);
  assert.match(secondProjection['docs/.vitepress/config.mjs'], /softwareVersion: '0\.2\.0-beta\.2'/);

  const jaHistoryPath = path.join(root, 'docs/ja/reference/version-history.md');
  await writeFile(jaHistoryPath, secondProjection['docs/ja/reference/version-history.md'].replace('## 0.1.9', '## 0.1.8'));
  const inconsistentSnapshot = await snapshot();
  await assert.rejects(
    projectPublishedVersion(root, '0.2.0-beta.2', '0.2.0-beta.3', '2026-07-20T09:00:00Z'),
    /English and Japanese published-version histories must match/
  );
  assert.deepEqual(await snapshot(), inconsistentSnapshot, 'semantic validation failure must not write any projection');
});

test('post-merge docs release is not gated by an approval environment', async () => {
  const workflow = await readFile(new URL('../.github/workflows/post-merge-release.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /^\s+environment:\s+npm\s*$/m);
});

test('post-merge release installs dependencies before unconditional docs projection', async () => {
  const workflow = await readFile(new URL('../.github/workflows/post-merge-release.yml', import.meta.url), 'utf8');
  const projectionLoop = workflow.match(/for attempt in 1 2 3; do[\s\S]*?node scripts\/post-merge-release\.mjs project --event "\$GITHUB_EVENT_PATH"/)?.[0] ?? '';
  assert.match(projectionLoop, /git reset --hard origin\/main[\s\S]*npm ci --ignore-scripts[\s\S]*post-merge-release\.mjs project/);
});

test('post-merge release uses immutable pre-merge base code for fork validation', async () => {
  const workflow = await readFile(new URL('../.github/workflows/post-merge-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /pull_request_target:[\s\S]*types:[\s\S]*- closed/);
  assert.match(workflow, /validation:[\s\S]*ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(workflow, /release:[\s\S]*ref: \$\{\{ github\.event\.pull_request\.merge_commit_sha \}\}/);
  assert.match(workflow, /pull_request\.merged == true/);
  assert.match(workflow, /pull_request\.base\.ref == 'main'/);
  assert.ok(workflow.indexOf('publish-npm') < workflow.indexOf('post-merge-release.mjs project'));
  assert.match(workflow, /git add[^\n]*docs\/\.vitepress\/config\.mjs/);
});

test('post-merge first deployment executes the missing-selector fallback as full validation', async () => {
  const workflow = await readFile(new URL('../.github/workflows/post-merge-release.yml', import.meta.url), 'utf8');
  const fallbackScript = workflow.match(/          if ! node scripts\/post-merge-release\.mjs validation-plan[\s\S]*?          cat "\$GITHUB_OUTPUT" >> "\$GITHUB_STEP_SUMMARY"/u)?.[0] ?? '';
  assert.notEqual(fallbackScript, '');
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-release-selector-fallback-'));
  const output = path.join(root, 'output');
  const summary = path.join(root, 'summary');
  const executable = fallbackScript
    .replace(/^ {10}/gmu, '')
    .replace(/node scripts\/post-merge-release\.mjs validation-plan[^;]+/u, 'false')
    .replace(/\$\{\{ github\.event\.pull_request\.head\.sha \}\}/gu, '2'.repeat(40))
    .replace(/\$\{\{ github\.event\.pull_request\.merge_commit_sha \}\}/gu, '3'.repeat(40));
  const run = spawnSync('bash', ['-euo', 'pipefail', '-c', executable], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary
    }
  });
  assert.equal(run.status, 0, run.stderr);
  const recorded = await readFile(output, 'utf8');
  assert.match(recorded, /^validation_mode=full$/mu);
  assert.match(recorded, /^validation_reason=trusted_base_selector_unavailable$/mu);
  assert.equal(await readFile(summary, 'utf8'), recorded);
});
