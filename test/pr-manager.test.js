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
  projectAgentReviewInstruction,
  renderAgentReviewInstructionLines,
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

test('pr prepareは未検証のStory成果ケースを権威あるメタデータとして投影しない', async () => {
  const storyId = 'story-pr-manager-outcome-case';
  const root = await setupRepo({ storyId, storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId) });
  const configPath = path.join(root, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  let story = config.brainbase.stories.find((item) => item.story_id === storyId);
  if (!story) {
    story = { story_id: storyId, title: 'Outcome case PR metadata' };
    config.brainbase.stories.push(story);
  }
  story.outcome_case = {
    case_id: 'outcome-case-pr-1',
    outcome_case_ref: 'brainbase://outcome-cases/outcome-case-pr-1',
    judgment_receipt_ref: 'brainbase://judgment-receipts/jr-pr-1',
    decision_digest: 'f'.repeat(64),
    user_observable_outcome: '利用者が技術証跡を確認できる。',
    technical_acceptance: [{ id: 'TA-1', criterion: 'PR準備に成果ケースを表示する。' }],
    production_probe: {
      id: 'probe-pr-readback',
      procedure: '本番読戻しを確認する。',
      terminal_receipt_target: 'brainbase://production-probes/probe-pr-readback/receipt'
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const persisted = await readJson(configPath);
  assert.equal(persisted.brainbase.stories.find((item) => item.story_id === storyId).outcome_case.case_id, 'outcome-case-pr-1');

  const result = await preparePullRequest(root, { storyId, baseRef: 'main' });
  const outcomeCase = result.preparation.outcome_case;
  assert.equal(outcomeCase, undefined);
  assert.equal(result.preparation.outcome_case_status, 'partial');
  assert.equal(result.preparation.outcome_case_reason_code, 'commit_marker_missing');

  const body = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(body, /### 成果ケース連携/);
  assert.match(body, /状態: `partial`/);
  assert.match(body, /再bind\/復旧判断/);
});

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

test('pr readiness reports configured but incomplete reviews and blocks PR creation until complete', async () => {
  const storyId = 'story-pr-manager-review-readiness';
  const root = await setupRepo({
    storyId,
    storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId)
  });

  const prepared = await runCli(['pr', 'prepare', root, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(prepared.exitCode, 0);

  const preparation = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));
  assert.equal(preparation.review.configured, true);
  assert.equal(preparation.review.recorded, false);
  assert.equal(preparation.review.complete, false);
  assert.equal(preparation.review.status, 'needs_review');
  assert.equal(preparation.gate_status, 'needs_review');
  assert.deepEqual(preparation.blocking_reasons, ['agent_review:needs_review']);
  assert.equal(preparation.agent_review_instruction.status, 'dispatch_required');
  assert.equal(preparation.agent_review_instruction.current_stage, 'planning_spec');
  assert.ok(preparation.agent_review_instruction.roles.length > 0);
  assert.ok(preparation.agent_review_instruction.next_commands.length > 0);
  assert.ok(preparation.agent_review_instruction.next_commands.every((command) => (
    command.includes('--stage planning_spec') || command.includes('vibepro pr prepare')
  )), 'only the current review stage and the follow-up pr prepare command may be projected');
  assert.equal(
    preparation.execution_dag.nodes.find((node) => node.id === 'agent_review_recorded').status,
    'pending'
  );
  assert.equal(
    preparation.execution_dag.nodes.find((node) => node.id === 'pr_prepare_ready').status,
    'pending'
  );

  const body = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(body, /### Review\n- configured: true\n- recorded: false\n- complete: false\n- status: needs_review/);
  assert.match(body, /- blocking reasons: agent_review:needs_review/);
  assert.match(body, /- error: none/);
  assert.match(body, /- agent review instruction: dispatch_required/);
  assert.match(body, /- current review stage: planning_spec/);
  for (const command of preparation.agent_review_instruction.next_commands) {
    assert.match(body, new RegExp(`    ${command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
  const humanSummary = renderPrPrepareSummary({
    preparation,
    artifacts: {
      json: path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'),
      pr_body: path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md')
    }
  });
  assert.match(humanSummary, /- agent review instruction: dispatch_required/);
  assert.match(humanSummary, /- current review stage: planning_spec/);

  let createError = '';
  const created = await runCli(
    ['pr', 'create', root, '--story-id', storyId, '--base', 'main', '--dry-run', '--json'],
    { stderr: { write: (chunk) => { createError += chunk; } } }
  );
  assert.equal(created.exitCode, 1);
  assert.match(createError, /PR creation blocked: agent_review:needs_review/);
});

test('pr readiness marks the execution DAG ready after every configured review passes', async () => {
  const storyId = 'story-pr-manager-review-complete';
  const root = await setupRepo({
    storyId,
    storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId)
  });
  const configPath = path.join(root, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.agent_reviews = {
    stages: {
      planning_spec: ['product_requirement'],
      requirement: [],
      architecture_spec: [],
      test_plan: [],
      implementation: [],
      gate: [],
      preview: []
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await git(root, ['add', configPath]);
  await git(root, ['commit', '-m', 'test: configure one lightweight review']);

  const preparedReview = await runCli([
    'review', 'prepare', root,
    '--id', storyId,
    '--stage', 'planning_spec',
    '--roles', 'product_requirement',
    '--json'
  ]);
  assert.equal(preparedReview.exitCode, 0);

  const recordedReview = await runCli([
    'review', 'record', root,
    '--id', storyId,
    '--stage', 'planning_spec',
    '--role', 'product_requirement',
    '--status', 'pass',
    '--summary', 'the configured lightweight review passed',
    '--inspection-summary', 'inspected the story and implementation diff',
    '--inspection-input', `docs/management/stories/active/${storyId}.md`,
    '--inspection-input', 'widget.js',
    '--judgment-delta', 'review missing -> passed after inspecting the current content surface',
    '--agent-system', 'codex',
    '--execution-mode', 'parallel_subagent',
    '--agent-id', 'reviewer-ready-1',
    '--reviewer-identity', 'separate_session',
    '--implementation-session-id', 'implementation-session-1',
    '--agent-session-id', 'review-session-1',
    '--agent-closed',
    '--json'
  ]);
  assert.equal(recordedReview.exitCode, 0);

  const prepared = await runCli(['pr', 'prepare', root, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(prepared.exitCode, 0);
  const preparation = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));
  assert.equal(preparation.review.configured, true);
  assert.equal(preparation.review.recorded, true);
  assert.equal(preparation.review.complete, true);
  assert.equal(preparation.review.status, 'pass');
  assert.equal(preparation.gate_status, 'ready');
  assert.equal(preparation.agent_review_instruction, null);
  assert.deepEqual(preparation.blocking_reasons, []);
  assert.equal(
    preparation.execution_dag.nodes.find((node) => node.id === 'agent_review_recorded').status,
    'passed'
  );
  assert.equal(
    preparation.execution_dag.nodes.find((node) => node.id === 'pr_prepare_ready').status,
    'passed'
  );

  const changedReview = await runCli([
    'review', 'record', root,
    '--id', storyId,
    '--stage', 'planning_spec',
    '--role', 'product_requirement',
    '--status', 'needs_changes',
    '--summary', 'the configured review found a required change',
    '--inspection-summary', 'reinspected the story and implementation diff',
    '--inspection-input', `docs/management/stories/active/${storyId}.md`,
    '--inspection-input', 'widget.js',
    '--judgment-delta', 'pass -> needs changes after finding a contract mismatch',
    '--agent-system', 'codex',
    '--execution-mode', 'parallel_subagent',
    '--agent-id', 'reviewer-ready-2',
    '--reviewer-identity', 'separate_session',
    '--implementation-session-id', 'implementation-session-1',
    '--agent-session-id', 'review-session-2',
    '--agent-closed',
    '--json'
  ]);
  assert.equal(changedReview.exitCode, 0);

  const preparedAfterChange = await runCli(['pr', 'prepare', root, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(preparedAfterChange.exitCode, 0);
  const changedPreparation = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));
  assert.equal(changedPreparation.review.recorded, true);
  assert.equal(changedPreparation.review.complete, false);
  assert.equal(changedPreparation.review.status, 'needs_review');
  assert.equal(changedPreparation.gate_status, 'needs_review');
  assert.deepEqual(changedPreparation.blocking_reasons, ['agent_review:needs_review']);
  assert.equal(
    changedPreparation.execution_dag.nodes.find((node) => node.id === 'agent_review_recorded').status,
    'pending'
  );
  assert.equal(
    changedPreparation.execution_dag.nodes.find((node) => node.id === 'pr_prepare_ready').status,
    'pending'
  );

  const blockedReview = await runCli([
    'review', 'record', root,
    '--id', storyId,
    '--stage', 'planning_spec',
    '--role', 'product_requirement',
    '--status', 'block',
    '--summary', 'the configured review found a release blocker',
    '--inspection-summary', 'reinspected the story and implementation diff',
    '--inspection-input', `docs/management/stories/active/${storyId}.md`,
    '--inspection-input', 'widget.js',
    '--judgment-delta', 'needs changes -> blocked after confirming a release blocker',
    '--agent-system', 'codex',
    '--execution-mode', 'parallel_subagent',
    '--agent-id', 'reviewer-ready-3',
    '--reviewer-identity', 'separate_session',
    '--implementation-session-id', 'implementation-session-1',
    '--agent-session-id', 'review-session-3',
    '--agent-closed',
    '--json'
  ]);
  assert.equal(blockedReview.exitCode, 0);

  const preparedAfterBlock = await runCli(['pr', 'prepare', root, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(preparedAfterBlock.exitCode, 0);
  const blockedPreparation = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));
  assert.equal(blockedPreparation.review.recorded, true);
  assert.equal(blockedPreparation.review.complete, false);
  assert.equal(blockedPreparation.review.status, 'block');
  assert.equal(blockedPreparation.gate_status, 'blocked');
  assert.equal(blockedPreparation.agent_review_instruction, null);
  assert.deepEqual(blockedPreparation.blocking_reasons, ['agent_review:block']);
  assert.equal(
    blockedPreparation.execution_dag.nodes.find((node) => node.id === 'agent_review_recorded').status,
    'pending'
  );
  assert.equal(
    blockedPreparation.execution_dag.nodes.find((node) => node.id === 'pr_prepare_ready').status,
    'pending'
  );

  const blockedBody = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(blockedBody, /### Review\n- configured: true\n- recorded: true\n- complete: false\n- status: block/);
  assert.match(blockedBody, /- blocking reasons: agent_review:block/);

  let blockCreateError = '';
  const blockedCreate = await runCli(
    ['pr', 'create', root, '--story-id', storyId, '--base', 'main', '--dry-run', '--json'],
    { stderr: { write: (chunk) => { blockCreateError += chunk; } } }
  );
  assert.equal(blockedCreate.exitCode, 1);
  assert.match(blockCreateError, /PR creation blocked: agent_review:block/);
});

test('pr readiness fails closed when the configured review status cannot be read', async () => {
  const storyId = 'story-pr-manager-review-status-error';
  const root = await setupRepo({
    storyId,
    storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId)
  });
  const configPath = path.join(root, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.agent_reviews = {
    defaults: {
      freshness_mode: 'strict_head'
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await git(root, ['add', configPath]);
  await git(root, ['commit', '-m', 'test: configure an invalid review policy']);

  const prepared = await runCli(['pr', 'prepare', root, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(prepared.exitCode, 0, 'pr prepare must persist the blocked review status for inspection');
  const preparation = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));
  assert.equal(preparation.review.configured, true);
  assert.equal(preparation.review.recorded, false);
  assert.equal(preparation.review.complete, false);
  assert.equal(preparation.review.status, 'error');
  assert.match(preparation.review.error.message, /freshness_mode cannot be strict_head/);
  assert.equal(preparation.gate_status, 'blocked');
  assert.equal(preparation.agent_review_instruction, null);
  assert.deepEqual(preparation.blocking_reasons, ['agent_review:status_unavailable']);
  assert.equal(
    preparation.execution_dag.nodes.find((node) => node.id === 'agent_review_recorded').status,
    'pending'
  );
  assert.equal(
    preparation.execution_dag.nodes.find((node) => node.id === 'pr_prepare_ready').status,
    'pending'
  );

  const body = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(body, /### Review\n- configured: true\n- recorded: false\n- complete: false\n- status: error/);
  assert.match(body, /- blocking reasons: agent_review:status_unavailable/);
  assert.match(body, /- error: .*freshness_mode cannot be strict_head/);

  let createError = '';
  const created = await runCli(
    ['pr', 'create', root, '--story-id', storyId, '--base', 'main', '--dry-run', '--json'],
    { stderr: { write: (chunk) => { createError += chunk; } } }
  );
  assert.equal(created.exitCode, 1);
  assert.match(createError, /PR creation blocked: agent_review:status_unavailable/);
});

test('pr readiness stays ready when every review stage is explicitly disabled', async () => {
  const storyId = 'story-pr-manager-review-disabled';
  const root = await setupRepo({
    storyId,
    storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId)
  });
  const configPath = path.join(root, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.agent_reviews = {
    stages: {
      planning_spec: [],
      requirement: [],
      architecture_spec: [],
      test_plan: [],
      implementation: [],
      gate: [],
      preview: []
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await git(root, ['add', configPath]);
  await git(root, ['commit', '-m', 'test: explicitly disable review stages']);

  const prepared = await runCli(['pr', 'prepare', root, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(prepared.exitCode, 0);
  const preparation = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));
  assert.equal(preparation.review.configured, false);
  assert.equal(preparation.review.recorded, false);
  assert.equal(preparation.review.complete, false);
  assert.equal(preparation.review.status, 'needs_review');
  assert.equal(preparation.review.error, null);
  assert.equal(preparation.gate_status, 'ready');
  assert.equal(preparation.agent_review_instruction, null);
  assert.deepEqual(preparation.blocking_reasons, []);
  assert.equal(
    preparation.execution_dag.nodes.find((node) => node.id === 'agent_review_recorded').status,
    'not_applicable'
  );
  assert.equal(
    preparation.execution_dag.nodes.find((node) => node.id === 'pr_prepare_ready').status,
    'passed'
  );

  const body = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(body, /### Review\n- configured: false\n- recorded: false\n- complete: false\n- status: needs_review/);
  assert.match(body, /- blocking reasons: none/);
  assert.match(body, /- error: none/);
});

test('agent review instruction projects only the first incomplete stage from review status', () => {
  const planningPrepare = 'vibepro review prepare . --id story-safe --stage planning_spec --role product_requirement';
  const planningRecord = 'vibepro review record . --id story-safe --stage planning_spec --role product_requirement';
  const futurePrepare = 'vibepro review prepare . --id story-safe --stage implementation --role code_quality';
  const instruction = projectAgentReviewInstruction({
    configured: true,
    complete: false,
    status: 'needs_review',
    error: null,
    blocking_summary: {
      items: [
        { stage: 'planning_spec', role: 'product_requirement', prepare_command: planningPrepare, record_command: planningRecord },
        { stage: 'implementation', role: 'code_quality', prepare_command: futurePrepare, record_command: 'future record' }
      ],
      next_commands: [planningPrepare, planningRecord, futurePrepare, 'vibepro pr prepare . --story-id story-safe --base main']
    }
  });

  assert.deepEqual(instruction.roles, ['product_requirement']);
  assert.deepEqual(instruction.next_commands, [
    planningPrepare,
    planningRecord,
    'vibepro pr prepare . --story-id story-safe --base main'
  ]);
  assert.ok(instruction.next_commands.every((command) => !command.includes('--stage implementation')));
});

test('agent review instruction fails closed for unsafe or incomplete status commands', () => {
  const baseReview = {
    configured: true,
    complete: false,
    status: 'needs_review',
    error: null
  };
  const unsafe = projectAgentReviewInstruction({
    ...baseReview,
    blocking_summary: {
      items: [{
        stage: 'planning_spec',
        role: 'product_requirement',
        prepare_command: 'vibepro review prepare . --id story-safe --stage planning_spec; touch injected',
        record_command: 'vibepro review record . --id story-safe --stage planning_spec --role product_requirement'
      }],
      next_commands: ['vibepro review prepare . --id story-safe --stage planning_spec; touch injected']
    }
  });
  const incomplete = projectAgentReviewInstruction({ ...baseReview, blocking_summary: { items: [], next_commands: [] } });

  for (const instruction of [unsafe, incomplete]) {
    assert.deepEqual(instruction, {
      status: 'unavailable',
      reason: 'unsafe_or_incomplete_review_status',
      current_stage: null,
      roles: [],
      next_commands: []
    });
  }
});

test('agent review instruction does not reuse stale status and reprojects needs_changes current work', () => {
  assert.equal(projectAgentReviewInstruction({
    configured: true,
    complete: false,
    status: 'stale',
    error: null,
    blocking_summary: { items: [], next_commands: [] }
  }), null);

  const recordCommand = 'vibepro review record . --id story-safe --stage planning_spec --role product_requirement';
  const instruction = projectAgentReviewInstruction({
    configured: true,
    complete: false,
    status: 'needs_review',
    error: null,
    blocking_summary: {
      items: [{
        stage: 'planning_spec',
        role: 'product_requirement',
        effective_status: 'needs_changes',
        prepare_command: 'vibepro review prepare . --id story-safe --stage planning_spec --role product_requirement',
        record_command: recordCommand
      }],
      next_commands: [recordCommand, 'vibepro pr prepare . --story-id story-safe --base main']
    }
  });
  assert.equal(instruction.status, 'dispatch_required');
  assert.equal(instruction.current_stage, 'planning_spec');
  assert.deepEqual(instruction.roles, ['product_requirement']);
});

test('unavailable instruction has the same reason in JSON and both human summary projections', () => {
  const instruction = projectAgentReviewInstruction({
    configured: true,
    complete: false,
    status: 'needs_review',
    error: null,
    blocking_summary: { items: [], next_commands: [] }
  });
  const preparation = {
    agent_review_instruction: instruction,
    output: { language: 'en' },
    story: { story_id: 'story-safe' },
    git: { base_ref: 'main', head_ref: 'HEAD', head_sha: 'a'.repeat(40), changed_files: [] },
    spec: { present: false },
    verification: { recorded: false },
    review: { recorded: false },
    gate_status: 'needs_review',
    bug_diagnosis: null
  };
  const json = JSON.stringify({ agent_review_instruction: instruction });
  const prBodyLines = renderAgentReviewInstructionLines(instruction).join('\n');
  const cliSummary = renderPrPrepareSummary({ preparation, artifacts: { json: 'pr-prepare.json', pr_body: 'pr-body.md' } });

  assert.match(json, /unsafe_or_incomplete_review_status/);
  assert.match(prBodyLines, /agent review instruction reason: unsafe_or_incomplete_review_status/);
  assert.match(cliSummary, /agent review instruction reason: unsafe_or_incomplete_review_status/);
});

test('pr prepare command alone cannot satisfy a current-stage review dispatch instruction', () => {
  const instruction = projectAgentReviewInstruction({
    configured: true,
    complete: false,
    status: 'needs_review',
    error: null,
    blocking_summary: {
      items: [{
        stage: 'planning_spec',
        role: 'product_requirement',
        prepare_command: 'vibepro review prepare . --id story-safe --stage planning_spec --role product_requirement',
        record_command: 'vibepro review record . --id story-safe --stage planning_spec --role product_requirement'
      }],
      next_commands: ['vibepro pr prepare . --story-id story-safe --base main']
    }
  });
  const preparation = {
    agent_review_instruction: instruction,
    output: { language: 'en' },
    story: { story_id: 'story-safe' },
    git: { base_ref: 'main', head_ref: 'HEAD', head_sha: 'a'.repeat(40), changed_files: [] },
    spec: { present: false },
    verification: { recorded: false },
    review: { recorded: false },
    gate_status: 'needs_review',
    bug_diagnosis: null
  };
  const json = JSON.stringify({ agent_review_instruction: instruction });
  const prBodyLines = renderAgentReviewInstructionLines(instruction).join('\n');
  const cliSummary = renderPrPrepareSummary({ preparation, artifacts: { json: 'pr-prepare.json', pr_body: 'pr-body.md' } });

  assert.equal(instruction.status, 'unavailable');
  assert.match(json, /unsafe_or_incomplete_review_status/);
  assert.match(prBodyLines, /agent review instruction reason: unsafe_or_incomplete_review_status/);
  assert.match(cliSummary, /agent review instruction reason: unsafe_or_incomplete_review_status/);
});

test('agent review instruction accepts only canonical current-stage review commands', () => {
  const baseItem = {
    stage: 'planning_spec',
    role: 'product_requirement',
    prepare_command: 'vibepro review prepare . --id story-safe --stage planning_spec --role product_requirement',
    record_command: 'vibepro review record . --id story-safe --stage planning_spec --role product_requirement --status "<pass|needs_changes|block>" --summary "<summary>"'
  };
  const project = (command, item = baseItem) => projectAgentReviewInstruction({
    configured: true,
    complete: false,
    status: 'needs_review',
    error: null,
    blocking_summary: { items: [item], next_commands: [command] }
  });

  for (const command of [baseItem.prepare_command, baseItem.record_command]) {
    assert.equal(project(command).status, 'dispatch_required');
  }

  const rejectedCommands = [
    'vibepro review prepare . --id story-safe --stage planning_spec | touch injected',
    'touch injected',
    'vibepro review prepare . --id story-safe --stage planning_spec > injected',
    'vibepro review prepare . --id story-safe --stage planning_spec & touch injected'
  ];
  for (const command of rejectedCommands) {
    const instruction = project(command, { ...baseItem, prepare_command: command });
    const preparation = {
      agent_review_instruction: instruction,
      output: { language: 'en' },
      story: { story_id: 'story-safe' },
      git: { base_ref: 'main', head_ref: 'HEAD', head_sha: 'a'.repeat(40), changed_files: [] },
      spec: { present: false },
      verification: { recorded: false },
      review: { recorded: false },
      gate_status: 'needs_review',
      bug_diagnosis: null
    };

    assert.equal(instruction.status, 'unavailable');
    assert.match(JSON.stringify(instruction), /unsafe_or_incomplete_review_status/);
    assert.match(renderAgentReviewInstructionLines(instruction).join('\n'), /agent review instruction reason: unsafe_or_incomplete_review_status/);
    assert.match(renderPrPrepareSummary({ preparation, artifacts: { json: 'pr-prepare.json', pr_body: 'pr-body.md' } }), /agent review instruction reason: unsafe_or_incomplete_review_status/);
  }
});

test('agent review instruction fails closed when canonical and invalid review commands are mixed', () => {
  const canonical = 'vibepro review prepare . --id story-safe --stage planning_spec --role product_requirement';
  const project = (extraItem, extraCommand) => projectAgentReviewInstruction({
    configured: true,
    complete: false,
    status: 'needs_review',
    error: null,
    blocking_summary: {
      items: [{
        stage: 'planning_spec',
        role: 'product_requirement',
        prepare_command: canonical,
        record_command: 'vibepro review record . --id story-safe --stage planning_spec --role product_requirement'
      }, extraItem],
      next_commands: [canonical, extraCommand]
    }
  });

  const arbitrary = 'touch injected';
  const wrongRole = 'vibepro review prepare . --id story-safe --stage planning_spec --role code_quality';
  const futureStage = 'vibepro review prepare . --id story-safe --stage implementation --role product_requirement';
  for (const instruction of [
    project({ stage: 'planning_spec', role: 'product_requirement', prepare_command: arbitrary }, arbitrary),
    project({ stage: 'planning_spec', role: 'product_requirement', prepare_command: wrongRole }, wrongRole),
    project({ stage: 'planning_spec', role: 'product_requirement', prepare_command: futureStage }, futureStage)
  ]) {
    assert.equal(instruction.status, 'unavailable');
    assert.equal(instruction.reason, 'unsafe_or_incomplete_review_status');
    assert.deepEqual(instruction.next_commands, []);
  }

  const validRecord = 'vibepro review record . --id story-safe --stage planning_spec --role product_requirement';
  assert.equal(project({ stage: 'planning_spec', role: 'product_requirement', record_command: validRecord }, validRecord).status, 'dispatch_required');
});
