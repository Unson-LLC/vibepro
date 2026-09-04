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
  createPullRequest,
  preparePullRequest,
  renderPrCreateSummary,
  renderPrPrepareSummary
} from '../src/pr-manager.js';
import { writeInferredSpec } from '../src/spec-store.js';
import { bindTaskAuthority } from '../src/task-authority.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

const STORY_DOC = [
  '---',
  'story_id: story-pr-manager-ac',
  'title: AC coverage story',
  '---',
  '',
  '# Story',
  '',
  '## Acceptance Criteria',
  '- AC-1: The widget renders without error',
  '- AC-2: Something completely unrelated to any changed file',
  ''
].join('\n');

async function setupRepo({ storyId = 'story-pr-manager-ac', storyDoc = STORY_DOC } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-pr-manager-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', storyId, '--title', 'AC coverage story']);
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', `${storyId}.md`), storyDoc);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/ac-coverage']);
  await writeFile(path.join(root, 'widget.js'), 'export function renderWidget() { return true; }\n');
  await git(root, ['add', 'widget.js']);
  await git(root, ['commit', '-m', 'implement widget rendering']);
  return root;
}

async function bindTaskForPrepare(root, storyId, allowedPaths) {
  const inputPath = 'task-authority.json';
  await writeFile(path.join(root, inputPath), `${JSON.stringify({
    schema_version: '0.1.0', story_id: storyId,
    tasks: [{ task_id: 'TASK-001', story_id: storyId, allowed_paths: allowedPaths }]
  }, null, 2)}\n`);
  await git(root, ['add', inputPath]);
  await bindTaskAuthority(root, { storyId, inputPath });
}

async function disableAgentReviews(root) {
  const configPath = path.join(root, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.agent_reviews = {
    stages: {
      planning_spec: [], requirement: [], architecture_spec: [], test_plan: [],
      implementation: [], gate: [], preview: []
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await git(root, ['add', configPath]);
  await git(root, ['commit', '-m', 'test: disable agent reviews']);
}

async function addGitHubRemote(root, name, repository) {
  await git(root, ['remote', 'add', name, `https://github.com/${repository}.git`]);
}

test('pr create fails closed before push when distinct remotes leave the destination ambiguous', async () => {
  const storyId = 'story-pr-manager-ambiguous-remote';
  const root = await setupRepo({ storyId, storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId) });
  await disableAgentReviews(root);
  await addGitHubRemote(root, 'origin', 'example/organization-repo');
  await addGitHubRemote(root, 'upstream', 'example/public-repo');
  await git(root, ['update-ref', 'refs/remotes/upstream/develop', 'HEAD']);

  await assert.rejects(
    createPullRequest(root, { storyId, prBase: 'upstream/develop', baseRef: 'upstream/develop', dryRun: true }),
    /PR destination is ambiguous/
  );
});

test('pr create dry-run exposes an explicit destination and persists its validation evidence', async () => {
  const storyId = 'story-pr-manager-explicit-remote';
  const root = await setupRepo({ storyId, storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId) });
  await disableAgentReviews(root);
  await addGitHubRemote(root, 'origin', 'example/organization-repo');
  await addGitHubRemote(root, 'upstream', 'example/public-repo');
  await git(root, ['update-ref', 'refs/remotes/upstream/develop', 'HEAD']);

  const cliResult = await runCli([
    'pr', 'create', root, '--story-id', storyId,
    '--base', 'upstream/develop', '--push-remote', 'upstream',
    '--repo', 'example/public-repo', '--dry-run', '--json'
  ]);
  assert.equal(cliResult.exitCode, 0);
  const result = cliResult.result;

  assert.equal(result.execution.push_remote, 'upstream');
  assert.equal(result.execution.push_url, 'https://github.com/example/public-repo.git');
  assert.equal(result.execution.pr_repository, 'example/public-repo');
  assert.equal(result.execution.base_repository, 'example/public-repo');
  assert.equal(result.execution.base_ref, 'develop');
  assert.equal(result.execution.head_ref, 'feature/ac-coverage');
  assert.match(result.execution.head_sha, /^[0-9a-f]{40}$/);
  assert.deepEqual(result.execution.destination_validation.map((entry) => entry.stage), ['plan']);
  assert.match(result.execution.commands[0], /git push -u upstream feature\/ac-coverage/);
  assert.match(result.execution.commands[1], /gh pr create --repo example\/public-repo/);

  const artifact = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-create.json'));
  assert.equal(artifact.push_remote, 'upstream');
  assert.equal(artifact.pr_repository, 'example/public-repo');
  assert.equal(artifact.destination_validation[0].status, 'passed');
});

test('pr create revalidates a changed remote before the first external mutation', async () => {
  const storyId = 'story-pr-manager-remote-change';
  const root = await setupRepo({ storyId, storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId) });
  await disableAgentReviews(root);
  await addGitHubRemote(root, 'origin', 'example/original-repo');

  const invoked = [];

  await assert.rejects(
    createPullRequest(root, {
      storyId, baseRef: 'main', prBase: 'main', pushRemote: 'origin',
      repository: 'example/original-repo',
      beforeDestinationRevalidation: async (stage) => {
        if (stage === 'before_push') {
          await git(root, ['remote', 'set-url', 'origin', 'https://github.com/example/changed-repo.git']);
        }
      },
      commandRunner: async (bin, args) => {
        invoked.push([bin, ...args].join(' '));
        return { stdout: '', stderr: '' };
      }
    }),
    /changed before before_push/
  );
  assert.deepEqual(invoked, []);
  const artifact = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-create.json'));
  assert.equal(artifact.destination_validation.at(-1).stage, 'before_push');
  assert.equal(artifact.destination_validation.at(-1).status, 'failed');
});

test('pr create records failed validation when a remote changes to an unsupported URL', async () => {
  const storyId = 'story-pr-manager-invalid-remote-change';
  const root = await setupRepo({ storyId, storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId) });
  await disableAgentReviews(root);
  await addGitHubRemote(root, 'origin', 'example/original-repo');

  await assert.rejects(
    createPullRequest(root, {
      storyId, baseRef: 'main', prBase: 'main', pushRemote: 'origin',
      repository: 'example/original-repo',
      beforeDestinationRevalidation: async (stage) => {
        if (stage === 'before_push') {
          await git(root, ['remote', 'set-url', 'origin', 'https://evil.example/example/changed-repo.git']);
        }
      }
    }),
    /could not be validated before before_push/
  );
  const artifact = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-create.json'));
  assert.equal(artifact.destination_validation.at(-1).stage, 'before_push');
  assert.equal(artifact.destination_validation.at(-1).status, 'failed');
  assert.match(artifact.destination_validation.at(-1).reason, /Unsupported GitHub remote URL/);
});

test('pr create preserves implicit destination selection for a single remote', async () => {
  const storyId = 'story-pr-manager-single-remote';
  const root = await setupRepo({ storyId, storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId) });
  await disableAgentReviews(root);
  await addGitHubRemote(root, 'origin', 'example/single-repo');

  const result = await createPullRequest(root, { storyId, baseRef: 'main', prBase: 'main', dryRun: true });
  assert.equal(result.execution.push_remote, 'origin');
  assert.equal(result.execution.pr_repository, 'example/single-repo');
  assert.equal(result.execution.base_repository, 'example/single-repo');
});

test('pr create selects the matching remote from --repo alone', async () => {
  const storyId = 'story-pr-manager-repository-selection';
  const root = await setupRepo({ storyId, storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId) });
  await disableAgentReviews(root);
  await addGitHubRemote(root, 'origin', 'example/organization-repo');
  await addGitHubRemote(root, 'upstream', 'example/public-repo');
  await git(root, ['update-ref', 'refs/remotes/upstream/develop', 'HEAD']);

  const result = await createPullRequest(root, {
    storyId,
    baseRef: 'upstream/develop',
    prBase: 'upstream/develop',
    repository: 'example/public-repo',
    dryRun: true
  });

  assert.equal(result.execution.push_remote, 'upstream');
  assert.equal(result.execution.pr_repository, 'example/public-repo');
  assert.equal(result.execution.base_repository, 'example/public-repo');
});

test('pr create accepts only exact GitHub remote URL forms', async () => {
  const accepted = [
    'https://github.com/example/url-repo.git',
    'ssh://git@github.com/example/url-repo.git',
    'git@github.com:example/url-repo.git'
  ];
  for (const [index, remoteUrl] of accepted.entries()) {
    const storyId = `story-pr-manager-url-${index}`;
    const root = await setupRepo({ storyId, storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId) });
    await disableAgentReviews(root);
    await git(root, ['remote', 'add', 'origin', remoteUrl]);
    const result = await createPullRequest(root, { storyId, baseRef: 'main', prBase: 'main', dryRun: true });
    assert.equal(result.execution.pr_repository, 'example/url-repo');
  }

  const rejected = [
    'https://evilgithub.com/example/url-repo.git',
    'https://evil.com/github.com/example/url-repo.git',
    'ssh://attacker@github.com/example/url-repo.git',
    'https://attacker@github.com/example/url-repo.git'
  ];
  for (const [index, remoteUrl] of rejected.entries()) {
    const storyId = `story-pr-manager-invalid-${index}`;
    const root = await setupRepo({ storyId, storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId) });
    await disableAgentReviews(root);
    await git(root, ['remote', 'add', 'origin', remoteUrl]);
    await assert.rejects(
      createPullRequest(root, { storyId, baseRef: 'main', prBase: 'main', dryRun: true }),
      /Unsupported GitHub remote URL/
    );
  }
});

test('pr create rejects an explicit push remote and PR repository mismatch', async () => {
  const storyId = 'story-pr-manager-destination-mismatch';
  const root = await setupRepo({ storyId, storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId) });
  await disableAgentReviews(root);
  await addGitHubRemote(root, 'origin', 'example/push-repo');
  await addGitHubRemote(root, 'upstream', 'example/pr-repo');

  await assert.rejects(
    createPullRequest(root, {
      storyId, baseRef: 'main', prBase: 'main', pushRemote: 'origin',
      repository: 'example/pr-repo', dryRun: true
    }),
    /does not match PR repository example\/pr-repo/
  );
});

test('pr create revalidates after push and never invokes gh when the remote changes', async () => {
  const storyId = 'story-pr-manager-change-after-push';
  const root = await setupRepo({ storyId, storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId) });
  await disableAgentReviews(root);
  await addGitHubRemote(root, 'origin', 'example/original-repo');
  const invoked = [];

  await assert.rejects(
    createPullRequest(root, {
      storyId, baseRef: 'main', prBase: 'main', pushRemote: 'origin',
      repository: 'example/original-repo',
      commandRunner: async (bin, args) => {
        invoked.push([bin, ...args].join(' '));
        if (bin === 'git' && args[0] === 'push') {
          await git(root, ['remote', 'set-url', 'origin', 'https://github.com/example/changed-repo.git']);
        }
        return { stdout: '', stderr: '' };
      }
    }),
    /changed before before_pr_create/
  );
  assert.equal(invoked.length, 1);
  assert.match(invoked[0], /^git push /);
});

test('pr create keeps the explicit repository on the existing PR list and edit fallback', async () => {
  const storyId = 'story-pr-manager-existing-pr-destination';
  const root = await setupRepo({ storyId, storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId) });
  await disableAgentReviews(root);
  await addGitHubRemote(root, 'origin', 'example/existing-pr-repo');
  const invoked = [];

  const result = await createPullRequest(root, {
    storyId, baseRef: 'main', prBase: 'main', pushRemote: 'origin',
    repository: 'example/existing-pr-repo',
    commandRunner: async (bin, args) => {
      invoked.push([bin, ...args]);
      if (bin === 'gh' && args[0] === 'pr' && args[1] === 'create') {
        throw Object.assign(new Error('a pull request for branch already exists'), {
          code: 1,
          stdout: '',
          stderr: 'a pull request for branch already exists'
        });
      }
      if (bin === 'gh' && args[0] === 'pr' && args[1] === 'list') {
        return {
          stdout: JSON.stringify([{
            number: 518,
            url: 'https://github.com/example/existing-pr-repo/pull/518',
            state: 'OPEN',
            isDraft: false,
            headRefName: 'feature/ac-coverage',
            headRefOid: 'abc123',
            baseRefName: 'main'
          }]),
          stderr: ''
        };
      }
      return { stdout: '', stderr: '' };
    }
  });

  assert.equal(result.execution.status, 'updated_existing_pr');
  assert.equal(result.execution.pr_url, 'https://github.com/example/existing-pr-repo/pull/518');
  const ghCommands = invoked.filter(([bin]) => bin === 'gh').map(([, ...args]) => args);
  assert.deepEqual(ghCommands.map((args) => args.slice(0, 2)), [
    ['pr', 'create'],
    ['pr', 'list'],
    ['pr', 'edit']
  ]);
  for (const args of ghCommands) {
    const repoIndex = args.indexOf('--repo');
    assert.notEqual(repoIndex, -1);
    assert.equal(args[repoIndex + 1], 'example/existing-pr-repo');
  }
  const artifact = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-create.json'));
  assert.equal(artifact.status, 'updated_existing_pr');
  assert.equal(artifact.pr_repository, 'example/existing-pr-repo');
});

test('pr create human summary exposes destination and validation evidence', async () => {
  const storyId = 'story-pr-manager-summary-destination';
  const root = await setupRepo({ storyId, storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId) });
  await disableAgentReviews(root);
  await addGitHubRemote(root, 'origin', 'example/summary-repo');
  const result = await createPullRequest(root, { storyId, baseRef: 'main', prBase: 'main', dryRun: true });

  const summary = renderPrCreateSummary(result);
  assert.match(summary, new RegExp(`HEAD SHA: ${result.execution.head_sha}`));
  assert.match(summary, /push remote: origin/);
  assert.match(summary, /push URL: https:\/\/github\.com\/example\/summary-repo\.git/);
  assert.match(summary, /PR repository: example\/summary-repo/);
  assert.match(summary, /base repository: example\/summary-repo/);
  assert.match(summary, /destination validation: plan=passed/);
});

test('task-scoped pr prepare accepts every changed path covered by accepted authority', async () => {
  const storyId = 'story-pr-manager-task-scope-valid';
  const root = await setupRepo({ storyId, storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId) });
  await writeFile(path.join(root, 'widget.test.js'), 'export const covered = true;\n');
  await git(root, ['add', 'widget.test.js']);
  await git(root, ['commit', '-m', 'add covered test']);
  await bindTaskForPrepare(root, storyId, ['widget.js', 'widget.test.js']);

  const result = await preparePullRequest(root, { storyId, taskId: 'TASK-001', baseRef: 'main' });
  assert.deepEqual(result.preparation.task_context.accepted_task.allowed_paths, ['widget.js', 'widget.test.js']);
});

test('task-scoped pr prepare rejects out-of-scope changes and stale refs', async () => {
  const storyId = 'story-pr-manager-task-scope-invalid';
  const root = await setupRepo({ storyId, storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId) });
  await bindTaskForPrepare(root, storyId, ['widget.test.js']);

  await assert.rejects(
    preparePullRequest(root, { storyId, taskId: 'TASK-001', baseRef: 'main' }),
    /outside accepted task TASK-001 allowed_paths: widget\.js/
  );
  await assert.rejects(
    preparePullRequest(root, { storyId, taskId: 'TASK-001', baseRef: 'main', headRef: 'main' }),
    /head.*current HEAD/
  );
  await assert.rejects(
    preparePullRequest(root, { storyId, taskId: 'TASK-001', baseRef: 'missing-base' }),
    /base ref.*resolve/
  );
});

test('pr prepare embeds story_source and traceability, with unmapped clauses shown as unaddressed (non-blocking)', async () => {
  const storyId = 'story-pr-manager-ac';
  const root = await setupRepo({ storyId });

  const result = await runCli(['pr', 'prepare', root, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0, 'pr prepare must not block even though AC-2 has no matching evidence');

  const preparation = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));

  assert.equal(preparation.story_source.found, true);
  assert.equal(preparation.story_source.path, `docs/management/stories/active/${storyId}.md`);
  assert.equal(preparation.story_source.acceptance_criteria_count, 2);

  const clauses = preparation.traceability.acceptance_criteria;
  assert.equal(clauses.length, 2);
  const ac1 = clauses.find((clause) => /AC-1/.test(clause.text));
  const ac2 = clauses.find((clause) => /AC-2/.test(clause.text));
  assert.ok(ac1, 'AC-1 must be present in the clause map');
  assert.ok(ac2, 'AC-2 must be present in the clause map');
  assert.notEqual(ac1.status, 'unmapped', 'AC-1 mentions the changed widget.js file and should not be unmapped');
  assert.equal(ac2.status, 'unmapped', 'AC-2 has no matching file, test, or evidence and must be unmapped');

  assert.equal(preparation.traceability.summary.acceptance_criteria_count, 2);
  assert.ok(preparation.traceability.summary.unmapped_count >= 1);
  assert.equal(preparation.runtime_identity.integrity.status, 'trusted');
  assert.match(preparation.runtime_identity.identity_digest, /^[0-9a-f]{64}$/);

  const body = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(body, /### Story document/);
  assert.match(body, new RegExp(`docs/management/stories/active/${storyId}\\.md`));
  assert.match(body, /### Acceptance criteria/);
  assert.match(body, /\[未対応\].*AC-2/, 'unmapped AC must be rendered as unaddressed, not as a blocker');
  assert.match(body, /### VibePro runtime identity/);
  assert.match(body, new RegExp(preparation.runtime_identity.identity_digest));
});

test('pr prepare summarizes multi-tenant contract, six views, findings, and review lenses', async () => {
  const storyId = 'story-pr-manager-tenant';
  const storyDoc = STORY_DOC
    .replaceAll('story-pr-manager-ac', storyId)
    .replace('# Story', '# Multi-tenant Story\n\n複数テナントのqueue、credential、storage境界をtenant_idで分離する。');
  const root = await setupRepo({ storyId, storyDoc });
  const contract = JSON.parse(await readFile(
    path.join(import.meta.dirname, 'fixtures', 'multi-tenant-architecture', 'pooled.json'),
    'utf8'
  ));
  await writeInferredSpec(root, storyId, {
    schema_version: '0.1.0',
    story_id: storyId,
    clauses: [],
    multi_tenancy: contract
  });

  await preparePullRequest(root, { storyId, baseRef: 'main' });
  const preparation = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));
  assert.equal(preparation.multi_tenant_architecture.status, 'ready');
  assert.equal(Object.keys(preparation.multi_tenant_architecture.views).length, 6);
  assert.deepEqual(
    preparation.multi_tenant_architecture.review_lenses.map((lens) => lens.id),
    ['tenant_architecture', 'security_boundary', 'operations_and_migration']
  );

  const body = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(body, /### Multi-tenant architecture/);
  assert.match(body, /status: ready/);
  assert.match(body, /system_context/);
  assert.match(body, /evidence coverage: verified/);
  assert.match(body, /review\/security_boundary \[ready\]/);
  assert.match(body, /unconfirmed: none/);
});

test('pr prepare projects non-applicability readiness from caller evidence bound to current HEAD', async () => {
  const storyId = 'story-pr-manager-tenant-na';
  const storyDoc = STORY_DOC
    .replaceAll('story-pr-manager-ac', storyId)
    .replace('# Story', '# Story\n\naccount設定の表示順を変更する。');
  const root = await setupRepo({ storyId, storyDoc });
  await writeInferredSpec(root, storyId, {
    schema_version: '0.1.0', story_id: storyId, clauses: [],
    multi_tenancy: { applicability: 'not_applicable' }
  });
  const { stdout } = await git(root, ['rev-parse', 'HEAD']);
  const head = stdout.trim();
  const evidence = {
    source: 'caller', status: 'verified', head_commit: head,
    required_surfaces: ['story', 'spec', 'implementation'],
    verified_surfaces: ['story', 'spec', 'implementation']
  };

  await preparePullRequest(root, {
    storyId, baseRef: 'main', multiTenantApplicabilityEvidence: evidence
  });
  const fresh = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));
  assert.equal(fresh.multi_tenant_architecture.status, 'not_applicable');
  assert.equal(fresh.multi_tenant_architecture.implementation_readiness.status, 'ready');

  await preparePullRequest(root, {
    storyId, baseRef: 'main', multiTenantApplicabilityEvidence: { ...evidence, head_commit: 'b'.repeat(40) }
  });
  const wrongHead = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));
  assert.equal(wrongHead.multi_tenant_architecture.implementation_readiness.status, 'needs_review');
  assert.ok(wrongHead.multi_tenant_architecture.implementation_readiness.reasons.includes('head_mismatch'));
});

test('pr prepare rejects legacy verification evidence without runtime identity before writing judgment', async () => {
  const storyId = 'story-pr-manager-legacy-runtime';
  const root = await setupRepo({ storyId, storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId) });
  const prDir = path.join(root, '.vibepro', 'pr', storyId);
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'verification-evidence.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    story_id: storyId,
    commands: [{ kind: 'unit', status: 'pass', command: 'node --test test/example.test.js' }]
  }, null, 2)}\n`);

  await assert.rejects(
    () => preparePullRequest(root, { storyId, baseRef: 'main' }),
    /runtime_mismatch/
  );
  await assert.rejects(readFile(path.join(prDir, 'pr-prepare.json')), /ENOENT/);
});

test('pr prepare does not block when no story document exists', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-pr-manager-nodoc-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', 'story-no-doc', '--title', 'No doc story']);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/no-doc']);
  await writeFile(path.join(root, 'README.md'), '# Hello\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-m', 'feat: add README']);

  const result = await runCli(['pr', 'prepare', root, '--story-id', 'story-no-doc', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);

  const preparation = await readJson(path.join(root, '.vibepro', 'pr', 'story-no-doc', 'pr-prepare.json'));
  assert.equal(preparation.story_source.found, false);
  assert.equal(preparation.story_source.acceptance_criteria_count, 0);
  assert.deepEqual(preparation.traceability.acceptance_criteria, []);

  const body = await readFile(path.join(root, '.vibepro', 'pr', 'story-no-doc', 'pr-body.md'), 'utf8');
  assert.match(body, /no story document found/);
  assert.match(body, /no acceptance criteria found/);
});


test('configured legacy stages do not block PR creation or schedule reviews', async () => {
  const root = await setupRepo();
  await addGitHubRemote(root, 'origin', 'example/project');
  const configPath = path.join(root, '.vibepro/config.json');
  const config = await readJson(configPath);
  config.agent_reviews = {
    defaults: { freshness_mode: 'strict_head', validation_sequence_owns_checkpoints: true },
    stages: { planning_spec: ['architect'], implementation: ['reviewer'], preview: ['e2e_ux'] }
  };
  config.budgets = { delivery_efficiency: { max_subagent_count: 0 } };
  await writeFile(configPath, JSON.stringify(config));
  const { preparation, execution } = await createPullRequest(root, {
    storyId: 'story-pr-manager-ac', baseRef: 'main', dryRun: true
  });
  assert.equal(preparation.gate_status, 'ready');
  assert.equal(preparation.review.recorded, false);
  assert.equal(preparation.review.complete, false);
  assert.deepEqual(preparation.blocking_reasons, []);
  assert.equal('agent_review_instruction' in preparation, false);
  assert.ok(execution.commands.some((command) => command.startsWith('gh pr create')));
  assert.doesNotMatch(JSON.stringify(preparation), /agent_review:needs_review|dispatch_required|replacement_review|validation_sequence|delivery_efficiency/);
});

test('documentation-only commit retains inspected code review and never requests E2E or all stages', async () => {
  const { recordReview } = await import('../src/lightweight-review.js');
  const root = await setupRepo();
  const storyId = 'story-pr-manager-ac';
  await recordReview(root, { storyId, role: 'reviewer', status: 'pass', summary: '変更箇所を確認しました', inspectionInputs: ['widget.js'] });
  await writeFile(path.join(root, 'README.md'), '# 説明のみの変更\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-m', 'docs: update readme']);
  const { preparation, artifacts } = await preparePullRequest(root, { storyId, baseRef: 'main' });
  assert.equal(preparation.gate_status, 'ready');
  assert.equal(preparation.review.complete, true);
  assert.equal(preparation.review.status, 'pass');
  assert.deepEqual(preparation.verification.commands, []);
  assert.doesNotMatch(await readFile(artifacts.pr_body, 'utf8'), /dispatch_required|replacement.review|validation.sequence|convergence|--stage/);
  // Changed inspected content is informational, never a new stage dispatch.
  await writeFile(path.join(root, 'widget.js'), 'export function renderWidget() { return false; }\n');
  const changed = await preparePullRequest(root, { storyId, baseRef: 'main' });
  assert.equal(changed.preparation.review.complete, false);
  assert.equal(changed.preparation.gate_status, 'ready');
});

test('concrete unresolved review findings block PR creation until the same review is corrected', async () => {
  const { recordReview } = await import('../src/lightweight-review.js');
  const root = await setupRepo();
  const storyId = 'story-pr-manager-ac';
  await addGitHubRemote(root, 'origin', 'example/project');
  await recordReview(root, { storyId, role: 'reviewer', status: 'needs_changes', summary: '空入力で例外になる', inspectionInputs: ['widget.js'] });
  await assert.rejects(createPullRequest(root, { storyId, baseRef: 'main', dryRun: true }), /空入力で例外になる/);
  // A content change must not erase an unresolved finding.
  await writeFile(path.join(root, 'widget.js'), 'export function renderWidget() { return false; }\n');
  await assert.rejects(createPullRequest(root, { storyId, baseRef: 'main', dryRun: true }), /空入力で例外になる/);
  await recordReview(root, { storyId, role: 'reviewer', status: 'pass', summary: '空入力の修正を確認しました', inspectionInputs: ['widget.js'] });
  const result = await createPullRequest(root, { storyId, baseRef: 'main', dryRun: true });
  assert.equal(result.preparation.gate_status, 'ready');
});
