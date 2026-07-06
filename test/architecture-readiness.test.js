import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { writeArchitectureReadiness } from '../src/architecture-store.js';

const STORY_ID = 'story-architecture-readiness-test';
const execFileAsync = promisify(execFile);

async function makeArchitectureRepo(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-architecture-'));
  await mkdir(path.join(root, 'src', 'workflow'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, 'src', 'workflow', 'gate.js'), `
export function promoteArchitecture(state) {
  return state.readiness === 'ready' ? 'final' : 'draft';
}
`);
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`), `---
story_id: ${STORY_ID}
---
# Architecture readiness test

## Acceptance Criteria
- final Architecture requires readiness evidence
- draft Architecture can be written before readiness
`);
  await runCli(['init', root, '--story-id', STORY_ID, '--title', 'architecture readiness test']);
  if (options.readyArchitectureEvidence !== false) {
    await writeReadyArchitectureEvidence(root, STORY_ID);
  }
  return root;
}

async function writeReadyArchitectureEvidence(repo, storyId) {
  await writeArchitectureReadiness(repo, storyId, {
    schema_version: '0.1.0',
    story_id: storyId,
    created_at: new Date().toISOString(),
    status: 'ready',
    git: { head_sha: null },
    checks: [
      { id: 'story_selected', status: 'pass', reason: 'test story exists' },
      { id: 'graphify_context', status: 'pass', reason: 'test graph context exists' },
      { id: 'story_diagnosis', status: 'pass', reason: 'test diagnosis exists' },
      { id: 'architecture_check', status: 'pass', reason: 'test architecture check exists' },
      { id: 'engineering_judgment', status: 'pass', reason: 'test engineering judgment exists' }
    ]
  });
}

async function initGitRepo(repo) {
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
  await execFileAsync('git', ['add', '.'], { cwd: repo });
  await execFileAsync('git', [
    '-c',
    'user.name=VibePro Test',
    '-c',
    'user.email=vibepro-test@example.com',
    'commit',
    '-m',
    'initial'
  ], { cwd: repo });
}

async function commitAll(repo, message) {
  await execFileAsync('git', ['add', '.'], { cwd: repo });
  await execFileAsync('git', [
    '-c',
    'user.name=VibePro Test',
    '-c',
    'user.email=vibepro-test@example.com',
    'commit',
    '-m',
    message
  ], { cwd: repo });
}

async function writeMinimalReadinessPrerequisites(repo, storyId) {
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await mkdir(path.join(repo, '.vibepro', 'diagnostics', 'diag-1'), { recursive: true });
  await mkdir(path.join(repo, '.vibepro', 'checks', 'architecture', 'arch-1'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [{ id: 'src/workflow/gate.js' }, { id: `docs/management/stories/active/${storyId}.md` }],
    links: [{ source: 'src/workflow/gate.js', target: `docs/management/stories/active/${storyId}.md` }]
  }));
  await writeFile(path.join(repo, '.vibepro', 'diagnostics', 'diag-1', 'evidence.json'), '{}\n');
  await writeFile(path.join(repo, '.vibepro', 'checks', 'architecture', 'arch-1', 'check.json'), '{}\n');
  await writeFile(path.join(repo, '.vibepro', 'checks', 'architecture', 'arch-1', 'check.md'), '# Architecture check\n');
  await writeFile(path.join(repo, '.vibepro', 'vibepro-manifest.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    tool: 'vibepro',
    repo: { root: '.', git_remote: null, commit: null },
    latest_run: 'diag-1',
    latest_run_by_story: { [storyId]: 'diag-1' },
    latest_check_run_by_pack: { architecture: 'arch-1' },
    stories: {
      [storyId]: {
        latest_report: `.vibepro/stories/${storyId}/story-report.md`,
        latest_report_run_id: 'diag-1'
      }
    },
    artifacts: {},
    runs: [{
      run_id: 'diag-1',
      story_id: storyId,
      created_at: new Date().toISOString(),
      gate_status: 'needs_review',
      artifacts: { evidence: '.vibepro/diagnostics/diag-1/evidence.json' }
    }],
    check_runs: [{
      run_id: 'arch-1',
      pack_id: 'architecture',
      created_at: new Date().toISOString(),
      status: 'needs_review',
      artifacts: {
        check_json: '.vibepro/checks/architecture/arch-1/check.json',
        check_report: '.vibepro/checks/architecture/arch-1/check.md'
      }
    }]
  }, null, 2)}\n`);
}

function readableFrom(text) {
  const stream = Readable.from([text]);
  stream.isTTY = false;
  return stream;
}

async function captureRunCli(args, options = {}) {
  let stdout = '';
  let stderr = '';
  const result = await runCli(args, {
    stdin: options.stdin,
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: (chunk) => { stderr += chunk; } },
    env: options.env ?? process.env
  });
  return { ...result, stdout, stderr };
}

test('architecture write final blocks when Architecture Readiness is missing', async () => {
  const repo = await makeArchitectureRepo({ readyArchitectureEvidence: false });
  const blocked = await captureRunCli(
    ['architecture', 'write', repo, '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--final'],
    { stdin: readableFrom('# Architecture\n\nFinal contract.\n') }
  );
  assert.equal(blocked.exitCode, 1);
  assert.match(blocked.stderr, /requires Architecture Readiness evidence/);
});

test('architecture write final blocks when readiness is blocked, while draft remains writable', async () => {
  const repo = await makeArchitectureRepo();
  await mkdir(path.join(repo, '.vibepro', 'architecture', STORY_ID), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'architecture', STORY_ID, 'architecture-readiness.json'), JSON.stringify({
    schema_version: '0.1.0',
    story_id: STORY_ID,
    status: 'blocked',
    checks: [{ id: 'engineering_judgment', status: 'blocked', reason: 'missing' }]
  }));

  const blocked = await captureRunCli(
    ['architecture', 'write', repo, '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--final'],
    { stdin: readableFrom('# Architecture\n\nFinal contract.\n') }
  );
  assert.equal(blocked.exitCode, 1);
  assert.match(blocked.stderr, /Architecture Readiness/);

  const draft = await captureRunCli(
    ['architecture', 'write', repo, '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--draft'],
    { stdin: readableFrom('# Architecture\n\nDraft hypothesis.\n') }
  );
  assert.equal(draft.exitCode, 0);
  const report = JSON.parse(draft.stdout);
  assert.equal(report.mode, 'draft');
  const draftBody = await readFile(path.join(repo, '.vibepro', 'architecture', STORY_ID, 'draft.md'), 'utf8');
  assert.match(draftBody, /Draft hypothesis/);
});

test('architecture write final blocks stale Architecture Readiness recorded for another HEAD', async () => {
  const repo = await makeArchitectureRepo();
  await initGitRepo(repo);
  await writeArchitectureReadiness(repo, STORY_ID, {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    created_at: new Date().toISOString(),
    status: 'ready',
    git: { head_sha: '0000000000000000000000000000000000000000' },
    checks: [
      { id: 'story_selected', status: 'pass', reason: 'test story exists' },
      { id: 'graphify_context', status: 'pass', reason: 'test graph context exists' },
      { id: 'story_diagnosis', status: 'pass', reason: 'test diagnosis exists' },
      { id: 'architecture_check', status: 'pass', reason: 'test architecture check exists' },
      { id: 'engineering_judgment', status: 'pass', reason: 'test engineering judgment exists' }
    ]
  });

  const blocked = await captureRunCli(
    ['architecture', 'write', repo, '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--final'],
    { stdin: readableFrom('# Architecture\n\nFinal contract.\n') }
  );
  assert.equal(blocked.exitCode, 1);
  assert.match(blocked.stderr, /current_head=stale/);
});

test('architecture readiness records required pre-architecture evidence surfaces', async () => {
  const repo = await makeArchitectureRepo();
  await initGitRepo(repo);
  await execFileAsync('git', ['checkout', '-b', 'feature/architecture-readiness'], { cwd: repo });
  await writeFile(path.join(repo, 'src', 'workflow', 'gate.js'), `
export function promoteArchitecture(state) {
  return state.readiness === 'ready' ? 'final' : 'draft';
}

export function architectureReadinessMarker() {
  return 'architecture-readiness';
}
`);
  await commitAll(repo, 'change architecture readiness marker');
  await writeMinimalReadinessPrerequisites(repo, STORY_ID);
  const { stdout: headStdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repo });
  const { exitCode, stdout } = await captureRunCli([
    'architecture',
    'readiness',
    repo,
    '--id',
    STORY_ID,
    '--base',
    'main',
    '--json'
  ]);
  assert.equal(exitCode, 0);
  const readiness = JSON.parse(stdout);
  const checksById = new Map(readiness.checks.map((check) => [check.id, check]));

  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.git.head_sha, headStdout.trim());
  for (const checkId of [
    'story_selected',
    'graphify_context',
    'story_diagnosis',
    'architecture_check',
    'engineering_judgment'
  ]) {
    assert.equal(checksById.get(checkId)?.status, 'pass', `${checkId} should pass`);
  }
  assert.equal(readiness.graphify.available, true);
  assert.ok(readiness.graphify.node_count > 0);
  assert.equal(typeof readiness.diagnosis.run_id, 'string');
  assert.equal(typeof readiness.architecture_check.run_id, 'string');
  assert.equal(typeof readiness.engineering_judgment.route_type, 'string');
});

test('architecture readiness missing diagnosis action uses design-input phase', async () => {
  const repo = await makeArchitectureRepo();
  await initGitRepo(repo);
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [{ id: 'src/workflow/gate.js' }],
    links: []
  }));

  const { exitCode, stdout } = await captureRunCli([
    'architecture',
    'readiness',
    repo,
    '--id',
    STORY_ID,
    '--base',
    'main',
    '--json'
  ]);
  assert.equal(exitCode, 2);
  const readiness = JSON.parse(stdout);
  assert.equal(readiness.status, 'blocked');
  assert.equal(
    readiness.next_actions.some((action) => action.includes(`vibepro story diagnose . --id ${STORY_ID} --pre-architecture --run-graphify`)),
    true
  );
});

test('architecture write final stores the final Architecture after ready evidence', async () => {
  const repo = await makeArchitectureRepo();
  const write = await captureRunCli(
    ['architecture', 'write', repo, '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--final'],
    { stdin: readableFrom('# Architecture\n\nFinal contract.\n') }
  );
  assert.equal(write.exitCode, 0);
  const report = JSON.parse(write.stdout);
  assert.equal(report.mode, 'final');
  assert.match(report.architecture_readiness.artifact, /architecture-readiness\.json/);
  const finalBody = await readFile(path.join(repo, 'docs', 'architecture', `${STORY_ID}.md`), 'utf8');
  assert.match(finalBody, /Final contract/);
});

test('architecture write final rejects absolute output paths', async () => {
  const repo = await makeArchitectureRepo();
  const blocked = await captureRunCli(
    ['architecture', 'write', repo, '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--final', '--output', path.join(repo, 'outside.md')],
    { stdin: readableFrom('# Architecture\n\nFinal contract.\n') }
  );
  assert.equal(blocked.exitCode, 1);
  assert.match(blocked.stderr, /repository-relative/);
});

test('architecture write final rejects output paths that escape the repository', async () => {
  const repo = await makeArchitectureRepo();
  const outsideName = `${path.basename(repo)}-outside-architecture.md`;
  const outsidePath = path.resolve(repo, '..', outsideName);
  const blocked = await captureRunCli(
    ['architecture', 'write', repo, '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--final', '--output', `../${outsideName}`],
    { stdin: readableFrom('# Architecture\n\nFinal contract.\n') }
  );
  assert.equal(blocked.exitCode, 1);
  assert.match(blocked.stderr, /inside the repository/);
  await assert.rejects(access(outsidePath), { code: 'ENOENT' });
});

test('architecture write final rejects output paths through symlinked parents outside the repository', async () => {
  const repo = await makeArchitectureRepo();
  const outsideDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-architecture-outside-'));
  await symlink(outsideDir, path.join(repo, 'docs', 'outside-link'), 'dir');
  const blocked = await captureRunCli(
    ['architecture', 'write', repo, '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--final', '--output', 'docs/outside-link/escaped.md'],
    { stdin: readableFrom('# Architecture\n\nFinal contract.\n') }
  );
  assert.equal(blocked.exitCode, 1);
  assert.match(blocked.stderr, /inside the repository/);
  await assert.rejects(access(path.join(outsideDir, 'escaped.md')), { code: 'ENOENT' });
});
