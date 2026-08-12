import '../support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { selectReleaseValidationPath } from '../../scripts/post-merge-release.mjs';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

test('story-vibepro-release-exact-sha-fast-path replays real merge-tree binding and workflow fast/fallback branches', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-release-fast-path-e2e-'));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'VibePro Test']);
  await mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
  await writeFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: CI\n');
  await writeFile(path.join(root, '.github', 'workflows', 'codeql.yml'), 'name: CodeQL\n');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'vibepro', version: '1.0.0' }));
  git(root, ['add', 'package.json', '.github/workflows/ci.yml', '.github/workflows/codeql.yml']);
  git(root, ['commit', '-m', 'base']);
  const baseSha = git(root, ['rev-parse', 'HEAD']);

  git(root, ['switch', '-c', 'feature']);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'vibepro', version: '1.0.1' }));
  git(root, ['add', 'package.json']);
  git(root, ['commit', '-m', 'release']);
  const headSha = git(root, ['rev-parse', 'HEAD']);
  git(root, ['switch', 'main']);
  git(root, ['merge', '--no-ff', 'feature', '-m', 'merge release']);
  const mergeSha = git(root, ['rev-parse', 'HEAD']);

  const event = {
    pull_request: {
      merged: true,
      number: 458,
      title: 'Exact SHA release E2E',
      body: '',
      merged_at: '2026-08-12T01:36:11Z',
      merge_commit_sha: mergeSha,
      html_url: 'https://github.com/Unson-LLC/vibepro/pull/458',
      user: { login: 'release-agent' },
      base: { ref: 'main', sha: baseSha, repo: { full_name: 'Unson-LLC/vibepro' } },
      head: { sha: headSha }
    }
  };
  const checks = ['test (20)', 'test (22)', 'analyze'].map((name) => ({
    name,
    status: 'completed',
    conclusion: 'success',
    head_sha: headSha,
    completed_at: '2026-08-12T01:35:00Z',
    app: { slug: 'github-actions' },
    workflow_run: {
      id: name === 'analyze' ? 102 : 101,
      repository: { full_name: 'Unson-LLC/vibepro' },
      event: 'pull_request',
      path: name === 'analyze' ? '.github/workflows/codeql.yml' : '.github/workflows/ci.yml',
      head_sha: headSha,
      display_title: `${name === 'analyze' ? 'CodeQL' : 'CI'} | pr=458 | base=${baseSha} | head=${headSha}`
    }
  }));

  const fast = await selectReleaseValidationPath({
    event,
    root,
    listChecks: async () => checks
  });
  assert.equal(fast.mode, 'fast');

  const fallback = await selectReleaseValidationPath({
    event,
    root,
    listChecks: async () => checks.filter((check) => check.name !== 'analyze')
  });
  assert.equal(fallback.mode, 'full');
  assert.ok(fallback.reasons.includes('missing_check:analyze'));

  await writeFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: CI\njobs: {}\n');
  git(root, ['add', '.github/workflows/ci.yml']);
  git(root, ['commit', '-m', 'alter required CI workflow']);
  const alteredHeadSha = git(root, ['rev-parse', 'HEAD']);
  git(root, ['switch', 'main']);
  git(root, ['reset', '--hard', baseSha]);
  git(root, ['merge', '--no-ff', alteredHeadSha, '-m', 'merge altered workflow']);
  const alteredMergeSha = git(root, ['rev-parse', 'HEAD']);
  const workflowChanged = await selectReleaseValidationPath({
    event: {
      pull_request: {
        ...event.pull_request,
        head: { sha: alteredHeadSha },
        merge_commit_sha: alteredMergeSha
      }
    },
    root,
    listChecks: async () => checks.map((check) => ({
      ...check,
      head_sha: alteredHeadSha,
      workflow_run: {
        ...check.workflow_run,
        head_sha: alteredHeadSha,
        display_title: `${check.name === 'analyze' ? 'CodeQL' : 'CI'} | pr=458 | base=${baseSha} | head=${alteredHeadSha}`
      }
    }))
  });
  assert.equal(workflowChanged.mode, 'full');
  assert.ok(workflowChanged.reasons.includes('required_workflow_changed:.github/workflows/ci.yml'));

  const workflow = await readFile(new URL('../../.github/workflows/post-merge-release.yml', import.meta.url), 'utf8');
  const fastStep = workflow.match(/- name: Validate release candidate[\s\S]*?(?=\n      - name:|$)/u)?.[0] ?? '';
  const fallbackStep = workflow.match(/- name: Run full validation fallback[\s\S]*?(?=\n      - name:|$)/u)?.[0] ?? '';
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(workflow, /validation:[\s\S]*?permissions:[\s\S]*?checks: read[\s\S]*?contents: read/u);
  assert.match(workflow, /release:[\s\S]*?permissions:[\s\S]*?contents: write/u);
  assert.match(workflow, /post-merge-release\.mjs validation-plan/);
  assert.match(workflow, /trusted_base_selector_unavailable/);
  assert.match(workflow, /validation_reason=.*GITHUB_STEP_SUMMARY/);
  assert.doesNotMatch(fastStep, /npm test(?:\s|$)/m);
  assert.match(fastStep, /npm run typecheck/);
  assert.match(fastStep, /npm run pack:dry-run/);
  assert.match(fallbackStep, /needs\.validation\.outputs\.validation_mode != 'fast'/);
  assert.match(fallbackStep, /npm test/);
  const releaseScript = await readFile(new URL('../../scripts/post-merge-release.mjs', import.meta.url), 'utf8');
  assert.match(releaseScript, /merge_to_npm_target_met/);
  const ci = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const codeql = await readFile(new URL('../../.github/workflows/codeql.yml', import.meta.url), 'utf8');
  assert.match(ci, /run-name: CI \| pr=.*\| base=.*\| head=/);
  assert.match(codeql, /run-name: CodeQL \| pr=.*\| base=.*\| head=/);
});
