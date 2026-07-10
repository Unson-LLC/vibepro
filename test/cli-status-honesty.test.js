import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function runCliWithStdout(args, io = {}) {
  let stdout = '';
  let stderr = '';
  const result = await runCli(args, {
    ...io,
    stdout: { write(chunk) { stdout += chunk; } },
    stderr: { write(chunk) { stderr += chunk; } }
  });
  return { ...result, stdout, stderr };
}

const STORY_DOC = `---
story_id: story-status-honesty
title: Status honesty story
---

# Story

## Background
Status output must match evidence.

## Acceptance Criteria
- execute merge reconciles merged PRs.
`;

// Fake gh that reports an ALREADY MERGED PR (the tool never merged it).
async function makeFakeGhAlreadyMerged(state) {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-honesty-gh-bin-'));
  const ghPath = path.join(binDir, 'gh');
  const statePath = path.join(binDir, 'state.json');
  await writeJson(statePath, state);
  await writeFile(ghPath, `#!/usr/bin/env node
const fs = require('node:fs');
const statePath = ${JSON.stringify(statePath)};
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
if (args[0] !== 'pr') {
  process.stderr.write('unexpected gh command: ' + args.join(' '));
  process.exit(1);
}
if (args[1] === 'view') {
  const fieldsArg = args[args.indexOf('--json') + 1] || '';
  if (fieldsArg.includes('mergedAt')) {
    console.log(JSON.stringify({
      url: state.url,
      state: 'MERGED',
      mergedAt: state.mergedAt,
      mergeCommit: state.mergeCommit ? { oid: state.mergeCommit } : null
    }));
    process.exit(0);
  }
  console.log(JSON.stringify({
    url: state.url,
    state: 'MERGED',
    isDraft: false,
    mergeStateStatus: 'UNKNOWN',
    reviewDecision: '',
    headRefName: state.headRefName,
    headRefOid: state.headRefOid,
    baseRefName: state.baseRefName,
    statusCheckRollup: state.statusCheckRollup
  }));
  process.exit(0);
}
if (args[1] === 'merge') {
  process.stderr.write('gh pr merge must NOT run for an already-merged PR');
  process.exit(1);
}
process.stderr.write('unexpected gh command: ' + args.join(' '));
process.exit(1);
`);
  await chmod(ghPath, 0o755);
  return { binDir, statePath };
}

async function setupMergedPrRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-honesty-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', 'story-status-honesty', '--title', 'Status honesty story']);
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', 'story-status-honesty.md'), STORY_DOC);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/honesty']);
  await writeFile(path.join(root, 'README.md'), '# Hello\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-m', 'feat: add README']);
  const headSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();

  const remote = await mkdtemp(path.join(os.tmpdir(), 'vibepro-honesty-remote-'));
  await git(remote, ['init', '--bare']);
  await git(root, ['remote', 'add', 'origin', remote]);
  await git(root, ['push', '-u', 'origin', 'main']);
  await git(root, ['push', '-u', 'origin', 'feature/honesty']);

  // Simulate the external squash merge: create a separate commit on origin/main
  // whose tree includes the feature change but whose sha differs from the branch head.
  await git(root, ['switch', 'main']);
  await git(root, ['merge', '--squash', 'feature/honesty']);
  await git(root, ['commit', '-m', 'story-status-honesty - squashed externally (#999)']);
  const mergeCommitSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(root, ['push', 'origin', 'main']);
  await git(root, ['switch', 'feature/honesty']);

  const prDir = path.join(root, '.vibepro', 'pr', 'story-status-honesty');
  await mkdir(prDir, { recursive: true });
  await writeJson(path.join(prDir, 'pr-prepare.json'), {
    story: { story_id: 'story-status-honesty', title: 'Status honesty story' },
    gate_status: { overall_status: 'ready_for_review', ready_for_pr_create: true },
    pr_context: { gate_dag: { overall_status: 'ready_for_review', nodes: [], summary: { needs_evidence_count: 0 } } },
    git: { base_ref: 'main' }
  });
  await writeJson(path.join(prDir, 'pr-create.json'), {
    schema_version: '0.1.0',
    created_at: '2026-07-10T00:00:00.000Z',
    mode: 'pr_create',
    dry_run: false,
    workspace_initialized: true,
    story: { story_id: 'story-status-honesty', title: 'Status honesty story' },
    output: { language: 'ja' },
    gate_dag: { overall_status: 'ready_for_review', nodes: [], summary: { needs_evidence_count: 0 } },
    execution_gate: { status: 'ready', pr_create_allowed: true, blocking_gates: [] },
    base: 'main',
    head: 'feature/honesty',
    pr_url: 'https://github.example.test/unson/vibepro/pull/999',
    current_head_sha: headSha,
    artifact_freshness: {
      kind: 'pr_create',
      status: 'current',
      artifact_head_sha: headSha,
      current_head_sha: headSha
    },
    toolchain: { source_git: { commit: headSha } },
    results: []
  });
  return { root, headSha, mergeCommitSha, remote };
}

test('execute merge reconciles an already-merged PR as merged_externally with a full merge record', async () => {
  const { root, headSha, mergeCommitSha } = await setupMergedPrRepo();
  const gh = await makeFakeGhAlreadyMerged({
    url: 'https://github.example.test/unson/vibepro/pull/999',
    headRefName: 'feature/honesty',
    headRefOid: headSha,
    baseRefName: 'main',
    mergedAt: '2026-07-10T01:23:45Z',
    mergeCommit: mergeCommitSha,
    statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI' }]
  });

  const result = await runCli(
    ['execute', 'merge', root, '--story-id', 'story-status-honesty', '--base', 'main', '--json'],
    { env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` } }
  );

  assert.equal(result.exitCode, 0);
  const merge = result.result.merge;
  assert.equal(merge.status, 'merged_externally');
  assert.equal(merge.stop_reason, null);
  assert.equal(merge.merge_commit_sha, mergeCommitSha);
  assert.equal(merge.merged_at, '2026-07-10T01:23:45Z');
  assert.equal(merge.warnings.some((w) => /merged externally|already merged/i.test(w)), true);

  const artifact = await readJson(path.join(root, '.vibepro', 'pr', 'story-status-honesty', 'pr-merge.json'));
  assert.equal(artifact.status, 'merged_externally');
  assert.equal(artifact.merge_commit_sha, mergeCommitSha);

  const traceability = await readJson(path.join(root, '.vibepro', 'pr', 'story-status-honesty', 'traceability.json'));
  assert.equal(traceability.lifecycle, 'merged');
  assert.equal(traceability.source, 'execute_merge');
});

test('execute merge stays blocked with an explicit reason when the merged PR commit is not on origin/base', async () => {
  const { root, headSha } = await setupMergedPrRepo();
  const gh = await makeFakeGhAlreadyMerged({
    url: 'https://github.example.test/unson/vibepro/pull/999',
    headRefName: 'feature/honesty',
    headRefOid: headSha,
    baseRefName: 'main',
    mergedAt: '2026-07-10T01:23:45Z',
    mergeCommit: '0123456789abcdef0123456789abcdef01234567',
    statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI' }]
  });

  const result = await runCli(
    ['execute', 'merge', root, '--story-id', 'story-status-honesty', '--base', 'main', '--json'],
    { env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` } }
  );

  assert.equal(result.exitCode, 2);
  const merge = result.result.merge;
  assert.equal(merge.status, 'blocked');
  assert.equal(merge.stop_reason, 'pr_merged_externally_unverified');
});

test('design-ssot init reports the real registry totals for a multi-root registry', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-honesty-dssot-'));
  await mkdir(path.join(root, 'docs', 'architecture'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'architecture', 'root-a.md'), '# Root A\n');
  await writeFile(path.join(root, 'docs', 'architecture', 'root-b.md'), '# Root B\n');
  await writeFile(path.join(root, 'docs', 'architecture', 'root-c.md'), '# Root C\n');
  await writeJson(path.join(root, 'design-ssot.json'), {
    schema_version: '0.1.0',
    model: 'vibepro-design-ssot-registry-v1',
    design_roots: [
      {
        id: 'root-a',
        title: 'Root A',
        root_doc: 'docs/architecture/root-a.md',
        children: { spec: [{ kind: 'spec', path: 'docs/specs/root-a.md', required: true, relationship: 'implements' }] }
      },
      {
        id: 'root-b',
        title: 'Root B',
        root_doc: 'docs/architecture/root-b.md'
      }
    ]
  });

  const result = await runCliWithStdout([
    'design-ssot', 'init', root,
    '--id', 'root-c',
    '--root-doc', 'docs/architecture/root-c.md',
    '--title', 'Root C'
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /design_roots: 3/);
  assert.equal(result.result.registry_summary.design_root_count, 3);
  assert.equal(result.result.registry_summary.child_link_count, 1);

  const registry = await readJson(path.join(root, 'design-ssot.json'));
  assert.equal(registry.design_roots.length, 3);

  // Re-initializing an existing id must not inflate the count.
  const rerun = await runCliWithStdout([
    'design-ssot', 'init', root,
    '--id', 'root-c',
    '--root-doc', 'docs/architecture/root-c.md',
    '--title', 'Root C'
  ]);
  assert.equal(rerun.exitCode, 0, rerun.stderr);
  assert.match(rerun.stdout, /design_roots: 3/);
  assert.equal(rerun.result.registry_summary.design_root_count, 3);
});

test('design-ssot init on a fresh registry reports one root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-honesty-dssot-fresh-'));
  await mkdir(path.join(root, 'docs', 'architecture'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'architecture', 'only.md'), '# Only\n');

  const result = await runCliWithStdout([
    'design-ssot', 'init', root,
    '--id', 'only-root',
    '--root-doc', 'docs/architecture/only.md'
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /design_roots: 1/);
  assert.equal(result.result.registry_summary.design_root_count, 1);
});
