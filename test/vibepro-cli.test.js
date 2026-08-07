import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';

import { scanApiBoundary } from '../src/api-boundary-scanner.js';
import { scanComponentStyle } from '../src/component-style-scanner.js';
import { scanFlowDesign } from '../src/flow-design-scanner.js';
import { scanGestureInteraction } from '../src/gesture-interaction-scanner.js';
import { runCli as coreRunCli } from '../src/cli.js';
import { collectGitStatusFingerprints } from '../src/git-fingerprint.js';
import { projectArtifact } from '../src/artifact-routing.js';
import { scanLocalDev } from '../src/local-dev-scanner.js';
import { scanNetworkContracts } from '../src/network-contract-scanner.js';
import { preparePullRequest } from '../src/pr-manager.js';
import { renderAgentReviewPrSection } from '../src/agent-review.js';
import { writeInferredSpec } from '../src/spec-store.js';
import { scanTerminalLinkContracts } from '../src/terminal-link-scanner.js';
import { buildStoryTaskState } from '../src/story-task-generator.js';

const execFileAsync = promisify(execFile);

async function runCli(args, io = {}) {
  const effectiveArgs = [...args];
  if (isPassingReviewRecord(effectiveArgs)) {
    const repo = effectiveArgs[2] && !effectiveArgs[2].startsWith('--') ? effectiveArgs[2] : process.cwd();
    if (!effectiveArgs.includes('--inspection-summary')) {
      effectiveArgs.push('--inspection-summary', 'inspected the concrete fixture contract for this passing review');
    }
    const inputs = effectiveArgs
      .map((value, index) => value === '--inspection-input' ? effectiveArgs[index + 1] : null)
      .filter(Boolean);
    if (!inputs.some((input) => !String(input).startsWith('.vibepro/'))) {
      const fixtureInput = await firstExistingReviewFixture(repo);
      if (fixtureInput) effectiveArgs.push('--inspection-input', fixtureInput);
    }
    if (!effectiveArgs.includes('--judgment-delta')) {
      effectiveArgs.push('--judgment-delta', 'generic fixture pass -> accepted after concrete fixture inspection');
    }
  }
  return coreRunCli(effectiveArgs, io);
}

function isPassingReviewRecord(args) {
  const statusIndex = args.indexOf('--status');
  return args[0] === 'review'
    && args[1] === 'record'
    && statusIndex >= 0
    && args[statusIndex + 1] === 'pass';
}

async function firstExistingReviewFixture(repo) {
  for (const candidate of ['index.html', 'README.md', 'package.json']) {
    if (await pathExists(path.join(repo, candidate))) return candidate;
  }
  return null;
}

async function makeRepo(prefix = 'vibepro-test-') {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  return root;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writePng(filePath, width, height, rgbaPixels, options = {}) {
  await writeFile(filePath, encodePng(width, height, rgbaPixels, options));
}

function encodePng(width, height, rgbaPixels, options = {}) {
  const pixels = Buffer.from(rgbaPixels);
  assert.equal(pixels.length, width * height * 4);
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.concat([
      Buffer.from([0]),
      pixels.subarray(y * width * 4, (y + 1) * width * 4)
    ]));
  }
  const chunks = [
    pngChunk('IHDR', Buffer.concat([
      uint32(width),
      uint32(height),
      Buffer.from([8, 6, 0, 0, 0])
    ]))
  ];
  if (options.text) {
    chunks.push(pngChunk('tEXt', Buffer.from(`comment\0${options.text}`, 'latin1')));
  }
  chunks.push(pngChunk('IDAT', deflateSync(Buffer.concat(rows))));
  chunks.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ...chunks
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuffer, data]);
  return Buffer.concat([uint32(data.length), typeBuffer, data, uint32(crc32(crcInput))]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function fillUiuxIntake(intake) {
  return {
    ...intake,
    fields: Object.fromEntries(Object.entries(intake.fields).map(([id, field]) => [
      id,
      {
        ...field,
        status: 'explicit',
        value: `${field.label ?? id} for ${intake.story_id}`,
        rationale: `Required for ${intake.story_id}.`,
        evidence: ['test-fixture']
      }
    ]))
  };
}

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function gitIsAncestorForTest(repo, ancestor, descendant) {
  try {
    await git(repo, ['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch (error) {
    if (error?.code === 1) return false;
    throw error;
  }
}

async function runCliWithStdout(args, io = {}) {
  let stdout = '';
  let stderr = '';
  const result = await runCli(args, {
    ...io,
    stdout: {
      write(chunk) {
        stdout += chunk;
      }
    },
    stderr: {
      write(chunk) {
        stderr += chunk;
      }
    }
  });
  return { ...result, stdout, stderr };
}

async function makeFakeGh(pr) {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-gh-bin-'));
  const ghPath = path.join(binDir, 'gh');
  await writeFile(ghPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] !== 'pr' || args[1] !== 'view') {
  process.stderr.write('unexpected gh command: ' + args.join(' '));
  process.exit(1);
}
console.log(${JSON.stringify(JSON.stringify(pr))});
`);
  await chmod(ghPath, 0o755);
  return binDir;
}

async function makeFakeCodebaseMemoryMcp(payload) {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-cbm-bin-'));
  const binPath = path.join(binDir, 'codebase-memory-mcp');
  await writeFile(binPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] !== 'cli' || args[1] !== 'detect_changes') {
  process.stderr.write('unexpected codebase-memory-mcp command: ' + args.join(' '));
  process.exit(1);
}
const input = JSON.parse(args[2]);
if (!input.project) {
  process.stderr.write('missing project in codebase-memory-mcp input');
  process.exit(1);
}
console.log(${JSON.stringify(JSON.stringify(payload))});
`);
  await chmod(binPath, 0o755);
  return binDir;
}

async function makeFakeGhMerge(state) {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-gh-merge-bin-'));
  const ghPath = path.join(binDir, 'gh');
  const statePath = path.join(binDir, 'state.json');
  await writeJson(statePath, state);
  await writeFile(ghPath, `#!/usr/bin/env node
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const statePath = ${JSON.stringify(statePath)};
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
if (args[0] !== 'pr') {
  process.stderr.write('unexpected gh command: ' + args.join(' '));
  process.exit(1);
}

if (args[1] === 'view') {
  const merged = state.merged === true;
  const fieldsArg = args[args.indexOf('--json') + 1] || '';
  if (state.viewExitCode && !fieldsArg.includes('mergedAt')) {
    process.stderr.write(state.viewStderr || 'provider view failed');
    process.exit(state.viewExitCode);
  }
  if (fieldsArg.includes('mergedAt')) {
    if (state.postMergeViewExitCode) {
      process.stderr.write(state.postMergeViewStderr || 'post-merge provider view failed');
      process.exit(state.postMergeViewExitCode);
    }
    if (state.malformedPostMergeJson) {
      console.log('{malformed post-merge provider response');
      process.exit(0);
    }
    console.log(JSON.stringify({
      url: state.url,
      state: merged ? 'MERGED' : 'OPEN',
      mergedAt: merged ? state.mergedAt : null,
      mergeCommit: merged && !state.omitMergeCommit ? { oid: state.mergeCommit } : null
    }));
    process.exit(0);
  }
  if (state.malformedPrViewJson) {
    console.log('{malformed provider response');
    process.exit(0);
  }
  console.log(JSON.stringify({
    url: state.url,
    state: merged ? 'MERGED' : 'OPEN',
    isDraft: false,
    mergeStateStatus: merged ? 'UNKNOWN' : state.mergeStateStatus,
    reviewDecision: state.reviewDecision,
    headRefName: state.headRefName,
    headRefOid: state.headRefOid,
    baseRefName: state.baseRefName,
    statusCheckRollup: state.statusCheckRollup
  }));
  process.exit(0);
}
if (args[1] === 'merge') {
  if (state.mergeExitCode && state.mergeExitCode !== 0) {
    process.stderr.write(state.mergeStderr || 'merge failed');
    process.exit(state.mergeExitCode);
  }
  state.merged = true;
  if (state.remotePath) {
    execFileSync('git', [
      '--git-dir',
      state.remotePath,
      'update-ref',
      'refs/heads/' + state.baseRefName,
      state.headRefOid
    ]);
    if (!state.omitMergeCommit) state.mergeCommit = state.headRefOid;
  }
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\\n');
  console.log(state.mergeStdout || 'merged');
  process.exit(0);
}
process.stderr.write('unexpected gh command: ' + args.join(' '));
process.exit(1);
`);
  await chmod(ghPath, 0o755);
  return { binDir, statePath };
}

async function writeCurrentGateDag(repo, storyId, currentHeadSha, gateDag) {
  const boundGateDag = { ...gateDag, current_head_sha: currentHeadSha };
  const prDir = path.join(repo, '.vibepro', 'pr', storyId);
  await writeJson(path.join(prDir, 'gate-dag.json'), boundGateDag);
  const preparePath = path.join(prDir, 'pr-prepare.json');
  const prepare = await readJson(preparePath);
  prepare.current_head_sha = currentHeadSha;
  prepare.git = { ...(prepare.git ?? {}), head_sha: currentHeadSha };
  prepare.pr_context = { ...(prepare.pr_context ?? {}), gate_dag: boundGateDag };
  await writeJson(preparePath, prepare);
}

async function gitFingerprintHash(repo) {
  const [status, diff, untracked] = await Promise.all([
    git(repo, ['status', '--porcelain', '-uall']),
    git(repo, ['diff', '--binary']),
    collectUntrackedFingerprint(repo)
  ]);
  const dirtyDiff = [diff.stdout.trimEnd(), untracked].filter(Boolean).join('\n');
  return createHash('sha256').update([
    'git-status --porcelain -uall',
    status.stdout.trimEnd(),
    'git-diff --binary',
    dirtyDiff
  ].join('\n')).digest('hex');
}

async function collectUntrackedFingerprint(repo) {
  const output = await git(repo, ['ls-files', '--others', '--exclude-standard']);
  const files = output.stdout.split('\n').filter(Boolean).sort().slice(0, 200);
  const chunks = [];
  for (const file of files) {
    chunks.push(`untracked:${file}\n${await readFile(path.join(repo, file), 'utf8')}`);
  }
  return chunks.join('\n');
}

async function makeGitRepoWithStory(options = {}) {
  const repo = await makeRepo(options.repoPrefix);
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli([
    'init',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--title',
    'PR準備',
    '--view',
    'dev',
    '--period',
    '2026-W18',
    ...(options.language ? ['--language', options.language] : [])
  ]);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init test repo']);
  await git(repo, ['switch', '-c', 'feature/test-story']);
  return repo;
}

// Every DEFAULT_REVIEW_STAGE_ROLES role name (src/agent-review.js), used by
// fixtures that need strict_head across the board without dirtying the diff
// scope: see makeGitRepoWithStoryAndStrictHeadRoles below.
const ALL_DEFAULT_REVIEW_ROLES = [
  'product_requirement', 'architecture_boundary', 'spec_consistency',
  'scope_risk', 'acceptance_e2e', 'regression_risk',
  'unit_integration', 'e2e_ux', 'gate_coverage',
  'code_spec_alignment', 'runtime_contract', 'ux_completion',
  'gate_evidence', 'pr_split_scope', 'release_risk',
  'preview_smoke', 'network_runtime', 'human_usability'
];

// story-vibepro-strict-head-binding-origin-guard: strict_head must come from
// role policy or the frozen final_review target, not an arbitrary CLI
// override. Fixtures that need every role strict_head from the start (atomic
// scope owner-map fixtures) must bake that into the pre-branch commit so the
// grant itself never appears as a changed file in the feature-branch diff
// (a later commit touching .vibepro/config.json would add a spurious
// `repo-control` lane and would re-date recorded verification evidence away
// from HEAD, breaking "current-head passing verification evidence" checks).
async function makeGitRepoWithStoryAndStrictHeadRoles(roles = ALL_DEFAULT_REVIEW_ROLES, options = {}) {
  const repo = await makeRepo(options.repoPrefix);
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli([
    'init',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--title',
    'PR準備',
    '--view',
    'dev',
    '--period',
    '2026-W18',
    ...(options.language ? ['--language', options.language] : [])
  ]);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.agent_reviews = config.agent_reviews ?? {};
  config.agent_reviews.roles = config.agent_reviews.roles ?? {};
  for (const role of roles) {
    config.agent_reviews.roles[role] = {
      ...config.agent_reviews.roles[role],
      freshness_mode: 'strict_head',
      freshness_reason: `test fixture requires ${role} to cover the complete HEAD`
    };
  }
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init test repo']);
  await git(repo, ['switch', '-c', 'feature/test-story']);
  return repo;
}

async function makeAutopilotRepo() {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.execution = { managed_worktree: 'disabled' };
  await writeJson(configPath, config);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'scripts'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'autopilot.js'), 'export const autopilot = true;\n');
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    name: 'autopilot-fixture',
    type: 'module',
    scripts: {
      test: 'node ./scripts/pass.js',
      'test:fail': 'node ./scripts/fail.js',
      typecheck: 'node ./scripts/pass.js'
    }
  }, null, 2));
  await writeFile(path.join(repo, 'scripts', 'pass.js'), 'process.stdout.write("pass\\n");\n');
  await writeFile(path.join(repo, 'scripts', 'fail.js'), 'process.stderr.write("fail\\n");\nprocess.exit(7);\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: autopilot target']);
  return repo;
}

async function prepareExecuteMergeDryRunFixture(repo, storyId = 'story-pr-prepare') {
  const authorityUrl = 'https://github.example.test/unson/vibepro.git';
  const remotes = (await git(repo, ['remote'])).stdout.trim().split('\n').filter(Boolean);
  if (!remotes.includes('origin')) {
    await git(repo, ['remote', 'add', 'origin', authorityUrl]);
  } else {
    const originUrl = (await git(repo, ['config', '--get', 'remote.origin.url'])).stdout.trim();
    if (!/^https?:\/\/[^/]+\/[^/]+\/[^/]+(?:\.git)?$/i.test(originUrl)
      && !/^(?:ssh:\/\/)?git@[^/:]+(?::\d+)?[:/][^/]+\/[^/]+(?:\.git)?$/i.test(originUrl)) {
      await git(repo, ['config', `url.${originUrl}.insteadOf`, authorityUrl]);
      await git(repo, ['remote', 'set-url', 'origin', authorityUrl]);
    }
  }
  const effectiveAuthorityUrl = (await git(repo, ['config', '--get', 'remote.origin.url'])).stdout.trim();
  const prUrl = `${effectiveAuthorityUrl.replace(/\.git$/i, '')}/pull/123`;
  const headSha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const prDir = path.join(repo, '.vibepro', 'pr', storyId);
  await mkdir(prDir, { recursive: true });
  await writeJson(path.join(prDir, 'pr-prepare.json'), {
    story: { story_id: storyId, title: 'PR準備' },
    gate_status: {
      overall_status: 'ready_for_review',
      ready_for_pr_create: true,
      unresolved_gates: [],
      critical_unresolved_gates: []
    },
    pr_context: { gate_dag: { overall_status: 'ready_for_review', nodes: [], summary: { needs_evidence_count: 0 } } },
    git: { base_ref: 'main', head_sha: headSha }
  });
  await writeJson(path.join(prDir, 'gate-dag.json'), {
    story_id: storyId,
    overall_status: 'ready_for_review',
    nodes: [],
    summary: { needs_evidence_count: 0 }
  });
  await writeJson(path.join(prDir, 'pr-create.json'), {
    schema_version: '0.1.0',
    created_at: '2026-06-07T00:00:00.000Z',
    mode: 'pr_create',
    dry_run: false,
    workspace_initialized: true,
    story: { story_id: storyId, title: 'PR準備' },
    output: { language: 'ja' },
    gate_dag: { overall_status: 'ready_for_review', nodes: [], summary: { needs_evidence_count: 0 } },
    execution_gate: { status: 'ready', pr_create_allowed: true, blocking_gates: [] },
    base: 'main',
    head: 'feature/test-story',
    pr_url: prUrl,
    current_head_sha: headSha,
    artifact_freshness: {
      kind: 'pr_create',
      status: 'current',
      artifact_head_sha: headSha,
      current_head_sha: headSha
    },
    toolchain: { source_git: { origin_url: 'https://github.com/unson/vibepro.git', commit: headSha } },
    results: []
  });
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-gh-dry-run-bin-'));
  const ghCallLog = path.join(binDir, 'gh-called.log');
  await writeFile(path.join(binDir, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(ghCallLog)}, process.argv.slice(2).join(' ') + '\\n');
process.stderr.write('gh must not be executed during execute merge --dry-run');
process.exit(99);
`);
  await chmod(path.join(binDir, 'gh'), 0o755);
  return {
    headSha,
    prDir,
    ghCallLog,
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  };
}

async function routeGitHubAuthorityToLocalOrigin(
  repo,
  localOrigin,
  authorityUrl = 'https://github.example.test/unson/vibepro.git'
) {
  await git(repo, ['config', `url.${localOrigin}.insteadOf`, authorityUrl]);
  await git(repo, ['remote', 'set-url', 'origin', authorityUrl]);
  return authorityUrl;
}

async function recordRequiredAgentReviews(repo, storyId = 'story-pr-prepare') {
  const stageRoles = {
    planning_spec: ['product_requirement', 'architecture_boundary', 'spec_consistency'],
    architecture_spec: ['architecture_boundary', 'spec_consistency', 'regression_risk'],
    test_plan: ['unit_integration', 'e2e_ux', 'gate_coverage'],
    implementation: ['code_spec_alignment', 'runtime_contract', 'ux_completion']
  };
  for (const [stage, roles] of Object.entries(stageRoles)) {
    await runCli(['review', 'prepare', repo, '--id', storyId, '--stage', stage]);
    for (const role of roles) {
      const result = await runCli([
        'review',
        'record',
        repo,
        '--id',
        storyId,
        '--stage',
        stage,
        '--role',
        role,
        '--status',
        'pass',
        '--summary',
        `${stage}:${role} passed`,
        '--agent-system',
        'codex',
        '--execution-mode',
        'parallel_subagent',
        '--agent-id',
        `codex-${stage}-${role}`,
        '--agent-thread-id',
        `thread-${stage}-${role}`,
        '--agent-model',
        'gpt-5.5',
        '--inspection-summary',
        `read ${stage}:${role} inputs and verified the fixture contract`,
        '--inspection-input',
        'index.html',
        '--judgment-delta',
        `generic ${stage}:${role} pass -> accepted after inspecting the fixture contract`,
        '--agent-closed'
      ]);
      assert.equal(result.exitCode, 0);
    }
  }
}

// story-vibepro-strict-head-binding-origin-guard: --strict-head-binding is no
// longer an unconditional CLI override. Fixtures that need a role to behave
// as strict_head (so it stales on ANY HEAD change, not just its inspected
// surface) must declare that through role policy instead of the flag.
async function grantStrictHeadRolePolicy(repo, role, reason) {
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.agent_reviews = config.agent_reviews ?? {};
  config.agent_reviews.roles = config.agent_reviews.roles ?? {};
  const existing = config.agent_reviews.roles[role];
  // Any pre-existing strict_head grant (e.g. baked into the pre-branch
  // commit by makeGitRepoWithStoryAndStrictHeadRoles) already authorizes
  // this role; the exact reason text is not load-bearing, and rewriting it
  // would dirty/commit .vibepro/config.json on the feature branch, which
  // would itself show up as a spurious repo-control diff and re-date
  // already-recorded verification evidence away from the current HEAD.
  if (existing?.freshness_mode === 'strict_head') return;
  config.agent_reviews.roles[role] = {
    ...existing,
    freshness_mode: 'strict_head',
    freshness_reason: reason
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  // Commit this fixture-only config write immediately: some tests assert on
  // "current-head passing verification evidence" gates that fail closed on
  // any dirty tracked file, and this helper must not silently dirty a tree
  // fixtures deliberately committed clean.
  const { stdout: trackedStatus } = await git(repo, ['status', '--porcelain', '--', '.vibepro/config.json']);
  if (!trackedStatus.trim()) return;
  await git(repo, ['add', '-f', '.vibepro/config.json']);
  await git(repo, ['commit', '-m', `chore: grant strict_head role policy for ${role}`]);
}

async function recordAgentReviewStage(repo, storyId, stage, roles, options = {}) {
  await runCli([
    'review',
    'prepare',
    repo,
    '--id',
    storyId,
    '--stage',
    stage,
    ...roles.flatMap((role) => ['--role', role])
  ]);
  for (const role of roles) {
    const strictHead = (options.strictHeadRoles ?? []).includes(role);
    if (strictHead) {
      await grantStrictHeadRolePolicy(repo, role, `test fixture requires ${stage}:${role} to cover the complete HEAD`);
    }
    const inspectionInputs = [options.inspectionInputsByRole?.[role] ?? 'index.html'].flat();
    const agentId = `${stage}-${role}-agent`;
    const reviewerSessionId = options.reviewerIdentity === 'separate_session'
      ? (options.reviewerSessionId ?? `${agentId}-session`)
      : options.reviewerSessionId;
    const result = await runCliWithStdout([
      'review',
      'record',
      repo,
      '--id',
      storyId,
      '--stage',
      stage,
      '--role',
      role,
      '--status',
      'pass',
      '--summary',
      `${stage}:${role} passed`,
      '--agent-system',
      'codex',
      '--execution-mode',
      'parallel_subagent',
      '--agent-id',
      agentId,
      '--agent-thread-id',
      `${stage}-${role}-thread`,
      ...(reviewerSessionId ? ['--agent-session-id', reviewerSessionId] : []),
      ...(options.implementationSessionId ? ['--implementation-session-id', options.implementationSessionId] : []),
      ...(options.reviewerIdentity ? ['--reviewer-identity', options.reviewerIdentity] : []),
      '--inspection-summary',
      `read ${stage}:${role} evidence and verified the fixture contract`,
      ...inspectionInputs.flatMap((inspectionInput) => ['--inspection-input', inspectionInput]),
      '--judgment-delta',
      `generic ${stage}:${role} pass -> accepted because the fixture contract was inspected`,
      '--agent-closed'
    ]);
    assert.equal(result.exitCode, 0, JSON.stringify(result, null, 2));
  }
}

async function writeAtomicScopeFixtureStory(repo) {
  const storyPath = path.join(repo, 'docs', 'stories', 'story-pr-prepare.md');
  await mkdir(path.dirname(storyPath), { recursive: true });
  await writeFile(storyPath, `---
story_id: story-pr-prepare
title: PR準備
pr_scope_strategy: atomic_single_pr
pr_scope_reason: "The requirements and runtime facets form one release boundary, so target-bound evidence is required before this current HEAD can be accepted as one atomic change."
pr_scope_review_facets:
  - requirements-ssot
  - runtime-behavior
pr_scope_dependency_boundaries:
  - requirements-ssot->runtime-behavior
---

# PR準備
`);
  return 'docs/stories/story-pr-prepare.md';
}

// Passing verification evidence whose command names repo-relative test paths is rejected
// unless those paths exist in the fixture repo, so fixtures create the named files.
async function writeFixtureTestFiles(repo, relPaths) {
  for (const relPath of relPaths) {
    const absolute = path.join(repo, relPath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, "import test from 'node:test';\ntest('fixture', () => {});\n");
  }
}

// Same as writeFixtureTestFiles, but lands the files in the base branch history so they
// stay out of the changed-path inventory diffed against the base.
async function commitFixtureTestFilesToBase(repo, relPaths, base = 'main') {
  const branch = (await git(repo, ['branch', '--show-current'])).stdout.trim();
  await git(repo, ['switch', base]);
  await writeFixtureTestFiles(repo, relPaths);
  await git(repo, ['add', ...relPaths]);
  await git(repo, ['commit', '-m', 'test: add fixture test files named by verification commands']);
  await git(repo, ['switch', branch]);
  await git(repo, ['merge', base]);
}

async function writeMinimalTaskState(repo, storyId = 'story-pr-prepare') {
  const tasksDir = path.join(repo, '.vibepro', 'stories', storyId, 'tasks');
  await mkdir(tasksDir, { recursive: true });
  await writeFile(path.join(tasksDir, 'tasks.json'), JSON.stringify({
    schema_version: '0.1.0',
    generated_at: '2026-04-30T00:00:00.000Z',
    story: {
      story_id: storyId,
      title: 'PR準備'
    },
    source_run: {
      run_id: 'story-plan',
      gate_status: 'pass'
    },
    tasks: [{
      id: 'TASK-001',
      source_type: 'story_plan_candidate',
      source_id: 'TASK-001',
      title: 'PR準備Task',
      priority: 'high',
      status: 'todo',
      execution_policy: 'proposal_only',
      mutates_repository: false,
      target_count: 1,
      target_files: ['src/cli-helper.js'],
      target_routes: [],
      target_groups: [],
      read_first_files: [{ file: 'src/cli-helper.js', reason: '対象実装' }],
      recommended_strategy: { id: 'task-driven-pr', reason: 'Task/HandoffとPRを接続する' },
      implementation_steps: [],
      acceptance_criteria: ['Task/HandoffがPR本文に入る'],
      graph_context: null,
      pre_fix_briefing: null
    }]
  }, null, 2));
}

test('init creates a repo-local VibePro workspace and updates gitignore only', async () => {
  const repo = await makeRepo();

  const result = await runCli(['init', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.command, 'init');
  assert.equal((await readJson(path.join(repo, '.vibepro', 'config.json'))).schema_version, '0.1.0');
  assert.equal((await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'))).latest_run, null);
  await assert.rejects(stat(path.join(repo, '.vibeproignore')), { code: 'ENOENT' });
  const gitignore = await readFile(path.join(repo, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.vibepro\/\*$/m);
  assert.match(gitignore, /^!\.vibepro\/config\.json$/m);
  assert.doesNotMatch(gitignore, /\.vibepro\/raw\//);
});

test('init help aliases print help without creating a flag-named workspace', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'vibepro-init-help-'));
  const cli = path.resolve('bin/vibepro.js');
  const { stdout: canonicalHelp } = await execFileAsync(process.execPath, [cli, '--help']);
  const initialEntries = await readdir(cwd);

  for (const flag of ['--help', '-h']) {
    const { stdout } = await execFileAsync(process.execPath, [cli, 'init', flag], { cwd });

    assert.equal(stdout, canonicalHelp);
    assert.deepEqual(await readdir(cwd), initialEntries);
    await assert.rejects(stat(path.join(cwd, flag)), { code: 'ENOENT' });
  }
});

test('artifacts resolve and migrate use tracked custom routing without editing files', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.artifact_routing = {
    schema_version: '0.1.0',
    artifacts: {
      story: { canonical: 'docs/features/{feature_slug}/01_behavior_spec.md' },
      architecture: { canonical: 'docs/features/{feature_slug}/04_technical_delta.md' }
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const source = path.join(repo, 'docs', 'management', 'stories', 'active', 'story-checkout-safe.md');
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, '---\nstory_id: story-checkout-safe\n---\n');

  const resolved = await runCli(['artifacts', 'resolve', repo, '--id', 'story-checkout-safe', '--json']);
  assert.equal(resolved.exitCode, 0);
  assert.equal(resolved.result.routes.story.canonical.relative_path, 'docs/features/checkout-safe/01_behavior_spec.md');

  const migration = await runCli(['artifacts', 'migrate', repo, '--id', 'story-checkout-safe', '--dry-run', '--json']);
  assert.equal(migration.exitCode, 0);
  assert.equal(migration.result.edits_performed, 0);
  assert.equal(migration.result.items.find((item) => item.kind === 'story').action, 'move_required');
  assert.equal(await readFile(source, 'utf8'), '---\nstory_id: story-checkout-safe\n---\n');
});




test('required managed worktree gate blocks evidence commands outside managed worktree', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.execution.managed_worktree = 'required';
  await writeJson(configPath, config);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'managed-worktree-required.js'), 'export const required = true;\n');
  await git(repo, ['add', 'src/managed-worktree-required.js']);
  await git(repo, ['commit', '-m', 'feat: add required worktree fixture']);

  const prepareResult = await runCliWithStdout(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare']);
  assert.equal(prepareResult.exitCode, 1);
  assert.match(prepareResult.stderr, /managed worktree required for pr prepare/);

  let verifyStderr = '';
  const verifyResult = await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--summary',
    'unit passed'
  ], {
    stderr: { write: (text) => { verifyStderr += text; } }
  });
  assert.equal(verifyResult.exitCode, 1);
  assert.match(verifyStderr, /managed worktree required for verify record/);

  let reviewStderr = '';
  const reviewResult = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    'pass',
    '--summary',
    'gate evidence passed',
    '--inspection-summary',
    'checked managed worktree gate',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'gate-agent',
    '--agent-closed'
  ], {
    stderr: { write: (text) => { reviewStderr += text; } }
  });
  assert.equal(reviewResult.exitCode, 1);
  assert.match(reviewStderr, /managed worktree required for review record/);
});




test('init fails explicitly instead of masking corrupt VibePro config', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, '.vibepro'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'config.json'), '{ "schema_version": "0.1.0",');
  let stderrOutput = '';

  const result = await runCli(['init', repo], {
    stderr: { write: (text) => { stderrOutput += text; } }
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderrOutput, /VibePro config is invalid JSON/);
});

test('status reports corrupt VibePro config as needs_repair', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await writeFile(path.join(repo, '.vibepro', 'config.json'), '{ "schema_version": "0.1.0",');

  const result = await runCli(['status', repo, '--json']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.status.workspace_status, 'needs_repair');
  assert.equal(result.status.gate_status, 'blocked');
  assert.equal(result.status.issues[0].file, '.vibepro/config.json');
  assert.match(result.status.issues[0].detail, /invalid/);
});

test('init tracks repository config and ignores generated VibePro workspace artifacts', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);

  const result = await runCli(['init', repo]);
  await mkdir(path.join(repo, '.vibepro', 'pr', 'story-ignore-check'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'pr', 'story-ignore-check', 'pr-prepare.html'), '<!doctype html>');

  assert.equal(result.exitCode, 0);
  const ignored = await git(repo, [
    'check-ignore',
    '.vibepro/pr/story-ignore-check/pr-prepare.html'
  ]);
  assert.match(ignored.stdout, /^\.vibepro\/pr\/story-ignore-check\/pr-prepare\.html$/m);
  const status = await git(repo, ['status', '--short']);
  assert.match(status.stdout, /^\?\? \.vibepro\/$/m);
});

test('help command prints discoverable usage', async () => {
  let output = '';

  const result = await runCli(['help'], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.command, 'help');
  assert.match(output, /vibepro help \[command\]/);
  assert.match(output, /まず人間が使う基本コマンド/);
  assert.match(output, /\.vibepro\/ の意味/);
  assert.match(output, /vibepro pr create <repo> --base <base-branch> --head <branch> --story-id <id>/);
  assert.match(output, /vibepro review record \[repo\].*--inspection-summary <text>.*--inspection-input <ref>.*--judgment-delta <text>/);
  assert.match(output, /vibepro harness status \[repo\]/);
  assert.match(output, /vibepro harness map \[repo\]/);
  assert.match(output, /vibepro harness learn \[repo\]/);
  assert.match(output, /vibepro story map \[repo\] \[--json\]/);
  assert.match(output, /vibepro verify record \[repo\].*--kind <unit\|integration\|e2e\|typecheck\|build>/);
  assert.match(output, /vibepro review prepare \[repo\].*--stage <stage>/);
  assert.match(output, /vibepro review record \[repo\].*--role <role>/);
  assert.match(output, /vibepro story derive \[repo\].*--run-graphify/);
  assert.match(output, /vibepro story derive \[repo\].*--preset <id>/);
  assert.match(output, /vibepro config language \[repo\].*--language ja\|en/);
  assert.match(output, /vibepro skills install \[repo\].*--dry-run/);
  assert.match(output, /vibepro skills lint \[repo\]/);
  assert.match(output, /vibepro codex install \[repo\].*--dry-run/);

  let englishOutput = '';
  const englishResult = await runCli(['help', '--language', 'en'], {
    stdout: { write: (text) => { englishOutput += text; } }
  });
  assert.equal(englishResult.exitCode, 0);
  assert.match(englishOutput, /vibepro pr prepare <repo> --base <base-branch>/);
  assert.match(englishOutput, /vibepro pr create <repo> --base <base-branch> --head <branch> --story-id <id>/);
  assert.match(englishOutput, /vibepro story map \[repo\] \[--json\]/);
});

























test('harness status summarizes installed missing outdated and invalid areas', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, '.claude'), { recursive: true });
  await writeFile(path.join(repo, '.claude', 'settings.json'), '{');
  await writeFile(path.join(repo, '.gitignore'), '.vibepro/\nnode_modules/\n');

  let output = '';
  const textResult = await runCli(['harness', 'status', repo], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(textResult.exitCode, 0);
  assert.equal(textResult.result.status, 'needs_review');
  assert.match(output, /VibePro Agent Harness Status/);
  assert.match(output, /Codex instructions/);
  assert.match(output, /VibePro skill contract/);
  assert.match(output, /invalid_hook_settings_json/);

  const jsonResult = await runCli(['harness', 'status', repo, '--json']);

  assert.equal(jsonResult.exitCode, 0);
  assert.equal(jsonResult.result.skills_contract.overall_status, 'pass');
  assert.equal(jsonResult.result.hooks.findings.some((finding) => finding.kind === 'invalid_hook_settings_json'), true);
  assert.equal(jsonResult.result.ignore_noise.status, 'pass');
});

test('harness map writes codebase entrypoints and test command map', async () => {
  const repo = await makeRepo();
  await writeFile(path.join(repo, 'README.md'), '# Harness fixture\n');
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    name: 'harness-map-fixture',
    scripts: {
      typecheck: 'tsc --noEmit',
      test: 'node --test',
      'test:e2e': 'playwright test',
      build: 'next build'
    }
  }, null, 2));
  await mkdir(path.join(repo, 'src', 'app'), { recursive: true });
  await mkdir(path.join(repo, 'tests', 'e2e'), { recursive: true });

  const result = await runCli(['harness', 'map', repo, '--json']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.status, 'created');
  assert.equal(result.result.artifacts.codebase_map, '.vibepro/harness/codebase-map.md');
  assert.equal(result.result.test_command_map.by_category.typecheck.includes('typecheck'), true);
  assert.equal(result.result.test_command_map.by_category.e2e.includes('test:e2e'), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'harness', 'codebase-map.md')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'harness', 'agent-entrypoints.md')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'harness', 'test-command-map.json')), true);
  const entrypoints = await readFile(path.join(repo, '.vibepro', 'harness', 'agent-entrypoints.md'), 'utf8');
  assert.match(entrypoints, /Avoid By Default/);
});

test('harness learn records session learning candidates for human skill review', async () => {
  const repo = await makeRepo();

  const record = await runCli([
    'harness',
    'learn',
    repo,
    '--summary',
    'Repeatedly used stale checkout before running VibePro',
    '--source',
    'codex-log',
    '--evidence',
    'sessions/example.jsonl',
    '--pattern',
    'runtime path was not checked',
    '--skill-candidate',
    'Always verify the active VibePro executable and checkout before diagnosing results.',
    '--target',
    'AGENTS.md',
    '--target',
    'CLAUDE.md',
    '--json'
  ]);

  assert.equal(record.exitCode, 0);
  assert.equal(record.result.learning.status, 'candidate');
  assert.equal(record.result.learning.target_surfaces.includes('AGENTS.md'), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'harness', 'session-learnings.json')), true);

  const review = await runCli(['harness', 'review-learnings', repo, '--json']);

  assert.equal(review.exitCode, 0);
  assert.equal(review.result.store.candidate, 1);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'harness', 'session-learnings-review.md')), true);
  const markdown = await readFile(path.join(repo, '.vibepro', 'harness', 'session-learnings-review.md'), 'utf8');
  assert.match(markdown, /Session Learnings Review/);
  assert.match(markdown, /does not modify those files automatically/);
  assert.match(markdown, /Always verify the active VibePro executable/);
});

test('init can bootstrap and select a local story', async () => {
  const repo = await makeRepo();

  const result = await runCli([
    'init',
    repo,
    '--story-id',
    'story-hardening',
    '--title',
    '公開前診断',
    '--view',
    'dev',
    '--period',
    '2026-W18'
  ]);

  assert.equal(result.exitCode, 0);
  const config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(config.brainbase.current_story_id, 'story-hardening');
  const story = config.brainbase.stories.find((item) => item.story_id === 'story-hardening');
  assert.equal(story.title, '公開前診断');
  assert.equal(story.ssot, 'local');
  assert.equal(story.status, 'active');
  assert.equal(story.view, 'dev');
  assert.equal(story.period, '2026-W18');
});

test('init and config language manage human output language', async () => {
  const repo = await makeRepo();

  let initOutput = '';
  const initResult = await runCli([
    'init',
    repo,
    '--story-id',
    'story-hardening',
    '--title',
    '公開前診断',
    '--language',
    'en'
  ], {
    stdout: { write: (text) => { initOutput += text; } }
  });

  assert.equal(initResult.exitCode, 0);
  assert.match(initOutput, /VibePro workspace initialized/);
  assert.match(initOutput, /Human output language: en/);
  assert.match(initOutput, /coding agent/);
  let config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(config.output.language, 'en');

  const languageResult = await runCli(['config', 'language', repo, '--language', 'ja']);
  assert.equal(languageResult.exitCode, 0);
  config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(config.output.language, 'ja');
  const jaInitRepo = await makeRepo();
  let jaInitOutput = '';
  const jaInitResult = await runCli(['init', jaInitRepo, '--language', 'ja'], {
    stdout: { write: (text) => { jaInitOutput += text; } }
  });
  assert.equal(jaInitResult.exitCode, 0);
  assert.match(jaInitOutput, /VibePro workspaceを初期化しました/);
  assert.match(jaInitOutput, /次にやること/);

  const invalidResult = await runCli(['config', 'language', repo, '--language', 'fr']);
  assert.equal(invalidResult.exitCode, 1);
});

test('skills commands list install and verify bundled VibePro skills', async () => {
  const repo = await makeRepo();

  const listResult = await runCli(['skills', 'list']);
  assert.equal(listResult.exitCode, 0);
  assert.equal(listResult.result.skills.length, 7);
  assert.equal(listResult.result.skills.some((skill) => skill.name === 'vibepro-workflow'), true);
  assert.equal(listResult.result.skills.some((skill) => skill.name === 'vibepro-gate-evidence'), true);
  assert.equal(listResult.result.skills.some((skill) => skill.name === 'vibepro-codebase-memory'), true);
  assert.equal(listResult.result.skills.some((skill) => skill.name === 'vibepro-diagnosis-packages'), true);
  assert.equal(listResult.result.skills.some((skill) => skill.name === 'vibepro-meeting-minutes-editor'), true);

  const lint = await runCli(['skills', 'lint', repo, '--json']);
  assert.equal(lint.exitCode, 0);
  assert.equal(lint.result.overall_status, 'pass');
  assert.equal(lint.result.skills.every((skill) => skill.status === 'pass'), true);
  assert.equal(lint.result.required_sections.includes('Common Rationalizations'), true);
  assert.equal(lint.result.required_sections.includes('Red Flags'), true);
  assert.equal(lint.result.required_sections.includes('Verification'), true);

  const dryRun = await runCli(['skills', 'install', repo, '--dry-run', '--json']);
  assert.equal(dryRun.exitCode, 0);
  assert.equal(dryRun.result.dry_run, true);
  assert.equal(dryRun.result.skills.every((skill) => skill.status === 'would_install'), true);
  assert.equal(await pathExists(path.join(repo, '.claude', 'skills', 'vibepro-workflow', 'SKILL.md')), false);

  const install = await runCli(['skills', 'install', repo]);
  assert.equal(install.exitCode, 0);
  assert.equal(install.result.skills.every((skill) => skill.status === 'installed'), true);
  const workflowSkillPath = path.join(repo, '.claude', 'skills', 'vibepro-workflow', 'SKILL.md');
  const codebaseMemorySkillPath = path.join(repo, '.claude', 'skills', 'vibepro-codebase-memory', 'SKILL.md');
  const reviewSkillPath = path.join(repo, '.claude', 'skills', 'vibepro-human-review', 'SKILL.md');
  const diagnosisSkillPath = path.join(repo, '.claude', 'skills', 'vibepro-diagnosis-packages', 'SKILL.md');
  const meetingMinutesSkillPath = path.join(repo, '.claude', 'skills', 'vibepro-meeting-minutes-editor', 'SKILL.md');
  assert.match(await readFile(workflowSkillPath, 'utf8'), /name: vibepro-workflow/);
  assert.match(await readFile(workflowSkillPath, 'utf8'), /vibepro execute start/);
  assert.match(await readFile(codebaseMemorySkillPath, 'utf8'), /name: vibepro-codebase-memory/);
  assert.match(await readFile(codebaseMemorySkillPath, 'utf8'), /codebase-memory-mcp cli detect_changes/);
  assert.match(await readFile(reviewSkillPath, 'utf8'), /review-cockpit\.html/);
  assert.match(await readFile(meetingMinutesSkillPath, 'utf8'), /name: vibepro-meeting-minutes-editor/);
  assert.match(await readFile(meetingMinutesSkillPath, 'utf8'), /Slack attachments/);
  assert.match(await readFile(meetingMinutesSkillPath, 'utf8'), /Core Synopsis/);

  const verify = await runCli(['skills', 'verify', repo]);
  assert.equal(verify.exitCode, 0);
  assert.equal(verify.result.overall_status, 'ok');
  assert.equal(verify.result.skills.every((skill) => skill.status === 'ok'), true);

  await writeFile(workflowSkillPath, 'local edit\n');
  const skipped = await runCli(['skills', 'install', repo]);
  assert.equal(skipped.result.skills.find((skill) => skill.name === 'vibepro-workflow').status, 'skipped');
  const outdated = await runCli(['skills', 'verify', repo]);
  assert.equal(outdated.result.overall_status, 'needs_install');
  assert.equal(outdated.result.skills.find((skill) => skill.name === 'vibepro-workflow').status, 'outdated');

  const forced = await runCli(['skills', 'install', repo, '--force']);
  assert.equal(forced.result.skills.find((skill) => skill.name === 'vibepro-workflow').status, 'overwritten');
  assert.match(await readFile(workflowSkillPath, 'utf8'), /name: vibepro-workflow/);
});

test('codex commands install and verify VibePro AGENTS instructions', async () => {
  const repo = await makeRepo();
  const agentsPath = path.join(repo, 'AGENTS.md');

  const missing = await runCli(['codex', 'verify', repo]);
  assert.equal(missing.exitCode, 0);
  assert.equal(missing.result.overall_status, 'needs_install');
  assert.equal(missing.result.status, 'missing');

  const dryRun = await runCli(['codex', 'install', repo, '--dry-run', '--json']);
  assert.equal(dryRun.exitCode, 0);
  assert.equal(dryRun.result.status, 'would_install');
  assert.equal(await pathExists(agentsPath), false);

  const install = await runCli(['codex', 'install', repo]);
  assert.equal(install.exitCode, 0);
  assert.equal(install.result.status, 'installed');
  const installedContent = await readFile(agentsPath, 'utf8');
  assert.match(installedContent, /VIBEPRO_CODEX_START/);
  assert.match(installedContent, /review-cockpit\.html/);
  assert.match(installedContent, /vibepro pr create/);
  assert.match(installedContent, /agent-harness/);
  assert.match(installedContent, /vibepro-gate-evidence/);
  assert.match(installedContent, /server logs alone/);

  const ok = await runCli(['codex', 'verify', repo]);
  assert.equal(ok.result.overall_status, 'ok');
  assert.equal(ok.result.status, 'ok');

  const repoWithExistingAgents = await makeRepo();
  const existingAgentsPath = path.join(repoWithExistingAgents, 'AGENTS.md');
  await writeFile(existingAgentsPath, '# Existing repository rules\n');
  const append = await runCli(['codex', 'install', repoWithExistingAgents]);
  assert.equal(append.result.status, 'appended');
  const appendedContent = await readFile(existingAgentsPath, 'utf8');
  assert.match(appendedContent, /# Existing repository rules/);
  assert.match(appendedContent, /VIBEPRO_CODEX_START/);

  await writeFile(agentsPath, '# Existing\n\n<!-- VIBEPRO_CODEX_START -->\nSTALE_VIBEPRO_BLOCK\n<!-- VIBEPRO_CODEX_END -->\n');
  const outdated = await runCli(['codex', 'verify', repo]);
  assert.equal(outdated.result.overall_status, 'needs_install');
  assert.equal(outdated.result.status, 'outdated');

  const skipped = await runCli(['codex', 'install', repo]);
  assert.equal(skipped.result.status, 'skipped');
  assert.match(await readFile(agentsPath, 'utf8'), /STALE_VIBEPRO_BLOCK/);

  const forced = await runCli(['codex', 'install', repo, '--force']);
  assert.equal(forced.result.status, 'overwritten');
  const forcedContent = await readFile(agentsPath, 'utf8');
  assert.match(forcedContent, /# Existing/);
  assert.doesNotMatch(forcedContent, /STALE_VIBEPRO_BLOCK/);
  assert.match(forcedContent, /Story \/ Architecture \/ Spec/);
});

test('init fails when bootstrapped story already exists', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-hardening', '--title', '公開前診断']);

  const result = await runCli(['init', repo, '--story-id', 'story-hardening', '--title', '公開前診断']);

  assert.equal(result.exitCode, 1);
});

test('doctor reports uninitialized repositories without creating a workspace', async () => {
  const repo = await makeRepo();

  const result = await runCli(['doctor', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.overall_status, 'uninitialized');
  assert.equal(result.result.checks.some((check) => check.id === 'VP-DOCTOR-CLI-RUNTIME'), true);
  assert.equal(result.result.toolchain.package.name, 'vibepro');
  await assert.rejects(stat(path.join(repo, '.vibepro')), { code: 'ENOENT' });
});

test('verify record requires an initialized workspace', async () => {
  const repo = await makeRepo();
  let stderrOutput = '';

  const result = await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-x',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--command',
    'npm test'
  ], {
    stderr: { write: (text) => { stderrOutput += text; } }
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderrOutput, /requires an initialized VibePro workspace/);
  await assert.rejects(stat(path.join(repo, '.vibepro')), { code: 'ENOENT' });
});

test('doctor detects and fixes missing diagnosis evidence references', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, '.vibepro', 'diagnostics', 'ok-run'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'diagnostics', 'ok-run', 'evidence.json'), JSON.stringify({ run_id: 'ok-run' }));
  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.latest_run = 'missing-run';
  manifest.latest_run_by_story = {
    'story-alpha': 'missing-run',
    'story-beta': 'ok-run'
  };
  manifest.runs = [
    {
      run_id: 'missing-run',
      story_id: 'story-alpha',
      artifacts: { evidence: '.vibepro/diagnostics/missing-run/evidence.json' }
    },
    {
      run_id: 'ok-run',
      story_id: 'story-beta',
      artifacts: { evidence: '.vibepro/diagnostics/ok-run/evidence.json' }
    }
  ];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const dryRun = await runCli(['doctor', repo]);

  assert.equal(dryRun.exitCode, 0);
  assert.equal(dryRun.result.overall_status, 'needs_maintenance');
  assert.equal(dryRun.result.checks[0].id, 'VP-DOCTOR-MISSING-EVIDENCE');
  assert.equal(dryRun.result.next_commands.includes(`vibepro doctor ${repo} --fix`), true);
  assert.deepEqual(dryRun.result.next_actions[0], {
    command: `vibepro doctor ${repo} --fix`,
    reason: '存在しない evidence を参照する診断runを管理目録から整理する。',
    expected_after: 'VP-DOCTOR-MISSING-EVIDENCE が消える。',
    safe_to_run: true
  });
  assert.equal((await readJson(manifestPath)).runs.length, 2);

  const fixed = await runCli(['doctor', repo, '--fix', '--json']);

  assert.equal(fixed.exitCode, 0);
  assert.equal(fixed.result.overall_status, 'fixed');
  assert.equal(fixed.result.repairs[0].removed_run_ids.includes('missing-run'), true);
  const after = await readJson(manifestPath);
  assert.equal(after.runs.length, 1);
  assert.equal(after.latest_run, 'ok-run');
  assert.equal(after.latest_run_by_story['story-alpha'], undefined);
  assert.equal(after.latest_run_by_story['story-beta'], 'ok-run');
  await stat(path.join(repo, '.vibepro', 'doctor', 'doctor-result.json'));
});

test('doctor fixes stale story, run, catalog, and graphify references', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-live', '--title', 'Live Story']);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const config = await readJson(configPath);
  config.brainbase.current_story_id = 'story-missing';
  config.brainbase.stories.push({
    story_id: 'story-stale-derived',
    title: 'Stale derived story',
    ssot: 'local',
    status: 'active',
    derived_by: 'vibepro-story-derive'
  });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const manifest = await readJson(manifestPath);
  manifest.latest_run = 'missing-run';
  manifest.latest_run_by_story = { 'story-live': 'missing-run' };
  manifest.runs = [];
  manifest.artifacts = {
    graphify_json: '.vibepro/graphify/missing-graph.json',
    graphify_report: '.vibepro/graphify/missing-report.md'
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await mkdir(path.join(repo, '.vibepro', 'stories'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'), JSON.stringify({
    story_count: 1,
    stories: [{
      story_id: 'story-derived-new',
      title: 'Derived New Story',
      ssot: 'local',
      status: 'active',
      horizon: 'quarter',
      view: 'business',
      period: null,
      category: 'product'
    }]
  }, null, 2));

  const dryRun = await runCli(['doctor', repo, '--json']);

  assert.equal(dryRun.exitCode, 0);
  assert.equal(dryRun.result.overall_status, 'needs_maintenance');
  const checkIds = dryRun.result.checks.map((check) => check.id);
  assert.equal(checkIds.includes('VP-DOCTOR-CURRENT-STORY-MISSING'), true);
  assert.equal(checkIds.includes('VP-DOCTOR-STALE-LATEST-RUN-REFS'), true);
  assert.equal(checkIds.includes('VP-DOCTOR-MISSING-GRAPHIFY-ARTIFACTS'), true);
  assert.equal(checkIds.includes('VP-DOCTOR-STORY-CATALOG-DRIFT'), true);
  assert.equal(dryRun.result.next_commands.includes(`vibepro story derive ${repo} --run-graphify`), true);
  assert.equal(dryRun.result.next_actions.some((action) => action.command === `vibepro story derive ${repo} --run-graphify` && action.expected_after.includes('story-catalog.json')), true);

  const fixed = await runCli(['doctor', repo, '--fix']);

  assert.equal(fixed.exitCode, 0);
  assert.equal(fixed.result.overall_status, 'fixed');
  const fixedConfig = await readJson(configPath);
  const fixedManifest = await readJson(manifestPath);
  assert.equal(fixedConfig.brainbase.current_story_id, null);
  assert.equal(fixedConfig.brainbase.stories.some((story) => story.story_id === 'story-derived-new'), true);
  assert.equal(fixedConfig.brainbase.stories.find((story) => story.story_id === 'story-stale-derived').status, 'archived');
  assert.equal(fixedManifest.latest_run, null);
  assert.deepEqual(fixedManifest.latest_run_by_story, {});
  assert.equal(fixedManifest.artifacts.graphify_json, undefined);
  assert.equal(fixedManifest.artifacts.graphify_report, undefined);
});

test('doctor reports missing task workflow references without modifying them', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-live', '--title', 'Live Story']);
  const tasksDir = path.join(repo, '.vibepro', 'stories', 'story-live', 'tasks');
  await mkdir(path.join(tasksDir, 'TASK-001'), { recursive: true });
  await writeFile(path.join(tasksDir, 'tasks.json'), JSON.stringify({
    schema_version: '0.1.0',
    story: { story_id: 'story-live', title: 'Live Story' },
    source_run: { run_id: 'story-plan' },
    tasks: [{ id: 'TASK-001', title: 'Task 001', target_groups: [] }]
  }, null, 2));
  await writeFile(path.join(tasksDir, 'TASK-001', 'handoff.json'), JSON.stringify({
    references: {
      briefing_json: '.vibepro/stories/story-live/tasks/TASK-001/briefing.json',
      plan_json: '.vibepro/stories/story-live/tasks/TASK-001/plan.json'
    }
  }, null, 2));

  const result = await runCli(['doctor', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.overall_status, 'needs_maintenance');
  const taskCheck = result.result.checks.find((check) => check.id === 'VP-DOCTOR-MISSING-TASK-WORKFLOW-REFS');
  assert.equal(taskCheck.status, 'manual');
  assert.equal(taskCheck.items.length, 2);
  assert.equal(taskCheck.items[0].repair_command, `vibepro task handoff ${repo} --task TASK-001 --id story-live`);
  assert.equal(result.result.next_commands.includes(`vibepro task handoff ${repo} --task TASK-001 --id story-live`), true);
  assert.equal(result.result.next_actions[0].reason.includes('task workflow成果物'), true);
  assert.equal(result.result.next_actions[0].expected_after, 'VP-DOCTOR-MISSING-TASK-WORKFLOW-REFS が消える。');
});

test('graph imports existing graphify artifacts into the workspace', async () => {
  const repo = await makeRepo();
  const graphSource = path.join(repo, 'graphify-out');
  await runCli(['init', repo]);
  await mkdir(graphSource, { recursive: true });
  await writeFile(path.join(graphSource, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app', label: 'App' }],
    edges: [{ source: 'app', target: 'api', relation: 'calls', confidence: 'INFERRED' }]
  }));
  await writeFile(path.join(graphSource, 'GRAPH_REPORT.md'), '# Graph Report\n\n## Important Nodes\n\n- App');

  const result = await runCli(['graph', repo, '--from', graphSource]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.command, 'graph');
  assert.equal((await readJson(path.join(repo, '.vibepro', 'graphify', 'graph.json'))).nodes.length, 1);
  assert.match(await readFile(path.join(repo, '.vibepro', 'graphify', 'GRAPH_REPORT.md'), 'utf8'), /Important Nodes/);
  assert.equal((await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'))).artifacts.graphify_json, '.vibepro/graphify/graph.json');
});

test('graph uses graphify-out by default', async () => {
  const repo = await makeRepo();
  const graphSource = path.join(repo, 'graphify-out');
  await mkdir(graphSource, { recursive: true });
  await writeFile(path.join(graphSource, 'graph.json'), JSON.stringify({ nodes: [], edges: [] }));
  await writeFile(path.join(graphSource, 'GRAPH_REPORT.md'), '# Graph Report');

  const result = await runCli(['graph', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal((await readJson(path.join(repo, '.vibepro', 'graphify', 'graph.json'))).nodes.length, 0);
});

test('graph can run graphify before importing artifacts', async () => {
  const repo = await makeRepo();
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-bin-'));
  const graphifyBin = path.join(binDir, 'graphify');
await writeFile(graphifyBin, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

if (process.argv[2] !== 'update' || process.argv[3] !== '.') {
  console.error('unexpected graphify args: ' + process.argv.slice(2).join(' '));
  process.exit(1);
}
const outDir = 'graphify-out';
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'graph.json'), JSON.stringify({
  nodes: [{ id: 'from-graphify' }],
  edges: []
}));
writeFileSync(path.join(outDir, 'GRAPH_REPORT.md'), '# Generated Graph Report\\n');
`);
  await chmod(graphifyBin, 0o755);

  const result = await runCli(['graph', repo, '--run-graphify'], {
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.graphifyExecuted, true);
  assert.equal((await readJson(path.join(repo, '.vibepro', 'graphify', 'graph.json'))).nodes[0].id, 'from-graphify');
  assert.equal(await pathExists(path.join(repo, 'graphify-out')), false);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.graphify.last_execution.command, 'graphify update .');
});

test('graph reports install guidance when graphify is missing (INV-GPD-3)', async () => {
  const repo = await makeRepo();
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-empty-home-'));
  let stderrOutput = '';

  const result = await runCli(['graph', repo, '--run-graphify'], {
    env: { ...process.env, HOME: homeDir, PATH: '' },
    stderr: { write: (text) => { stderrOutput += text; } }
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.command, 'graph');
  assert.match(stderrOutput, /graphify command was not found on PATH/);
  assert.match(stderrOutput, /optional but recommended/);
  assert.match(stderrOutput, /No graphify executable was found in common install locations/);
  assert.match(stderrOutput, /uv tool install graphifyy/);
});

test('graph reports PATH guidance when graphify exists outside PATH (INV-GPD-1, INV-GPD-2)', async () => {
  const repo = await makeRepo();
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-home-'));
  const localBin = path.join(homeDir, '.local', 'bin');
  await mkdir(localBin, { recursive: true });
  const graphifyBin = path.join(localBin, 'graphify');
  await writeFile(graphifyBin, '#!/bin/sh\nexit 0\n');
  await chmod(graphifyBin, 0o755);
  let stderrOutput = '';

  const result = await runCli(['graph', repo, '--run-graphify'], {
    env: { ...process.env, HOME: homeDir, PATH: '' },
    stderr: { write: (text) => { stderrOutput += text; } }
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderrOutput, /graphify command was not found on PATH/);
  assert.match(stderrOutput, /Found graphify outside PATH/);
  assert.match(stderrOutput, new RegExp(graphifyBin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(stderrOutput, /PATH="\$HOME\/\.local\/bin:\$PATH"/);
  assert.doesNotMatch(stderrOutput, /graphify is not installed/);
  assert.doesNotMatch(stderrOutput, /uv tool install graphifyy/);
});

test('component style scanner inventories UI components and flags legacy tokens', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'public'), { recursive: true });
  await writeFile(path.join(repo, 'public', 'style.css'), `
:root { --bb-surface-main: #101113; }
.primary-button {
  background: #1e293b;
  border-radius: 16px;
}
.task-action-btn {
  width: 24px;
  height: 24px;
  transition: all 0.15s ease;
}
.task-action-btn svg {
  width: 12px;
  height: 12px;
}
.task-action-btn:hover { transform: translateY(-1px); }
.task-card { box-shadow: 0 24px 80px rgba(0, 0, 0, 0.3); }
`);
  await writeFile(path.join(repo, 'public', 'index.html'), '<button class="primary-button" data-component="button">Save</button>');

  const result = await scanComponentStyle(repo);

  assert.equal(result.component_kinds.includes('button'), true);
  assert.equal(result.component_kinds.includes('card'), true);
  assert.equal(result.design_system_markers.length > 0, true);
  assert.equal(result.coverage.replacement_observable, true);
  assert.equal(result.legacy_style_hits.some((hit) => hit.token === '#1e293b'), true);
  assert.equal(result.legacy_style_hits.some((hit) => hit.kind === 'large_rounded_card'), true);
  assert.equal(result.risk_summary.legacy_style_hits.review >= 2, true);
  assert.equal(result.interaction_reliability_hits.some((hit) => hit.kind === 'interactive_target_moves_on_state'), true);
  assert.equal(result.interaction_reliability_hits.some((hit) => hit.kind === 'transition_all_on_interactive_target'), true);
  assert.equal(result.interaction_reliability_hits.some((hit) => hit.kind === 'small_interactive_target'), true);
  assert.equal(result.interaction_reliability_hits.some((hit) => hit.kind === 'icon_child_captures_click_target'), true);
  assert.equal(result.risk_summary.interaction_reliability_hits.review, 4);
});

test('flow design scanner flags unsafe UI journey contracts', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'new'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'patients', '[id]'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'cases', '[id]', 'notes'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'cases', '[id]', 'notes'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    dependencies: { next: '16.2.1', react: '19.0.0' }
  }, null, 2));
  await writeFile(path.join(repo, 'docs', 'specs', 'u-020.md'), `---
story_id: U-020
---
# SPEC-U-020

- DPC未入力登録後、患者詳細でDPC確認質問が表示される。
- DPCを回答すると退院目標日が更新される。
- 新規登録画面に退院先選択カードが表示されない。
- 退院予定日という語は未確定値に使わない。
`);
  await writeFile(path.join(repo, 'src', 'app', 'new', 'page.tsx'), `
"use client";
export default function NewPage() {
  const handleVoiceInput = () => {
    console.log('voice input placeholder');
  };
  const searchByName = async () => {
    if (!searchQuery) return;
    await fetch('/api/dpc-lookup?q=' + searchQuery);
  };
  const lookup = async (code) => {
    if (!code || !admissionDate) return;
    const data = await res.json();
    setLookupResult(data);
    await saveCase(code, data);
    router.push('/patients/' + data.id);
  };
  const selectDpc = (result) => {
    setDpcCode(result.dpc_code);
    router.push('/patients/' + result.id);
  };
  return <>
    {lookupResult && <div>退院目標日 preview</div>}
    <button onClick={searchByName}>検索</button>
    <button onClick={selectDpc}>DPC候補を選択</button>
    <button onClick={handleVoiceInput}>音声入力</button>
    <button>詳細を見る</button>
    <button disabled>AI要約 準備中</button>
  </>;
}
`);
  await writeFile(path.join(repo, 'src', 'app', 'patients', '[id]', 'page.tsx'), `
"use client";
export default function PatientPage() {
  const saveQuestionAnswer = async (question, value) => {
    if (question.key === 'dpc_target_date') {
      await fetch('/api/cases/1/notes', { method: 'POST' });
      setDpcTargetDateStatus(value);
    }
  };
  return <div>退院予定日</div>;
}
`);
  await writeFile(path.join(repo, 'src', 'app', 'api', 'cases', '[id]', 'notes', 'route.ts'), `
export async function POST() {
  return Response.json({ ok: true });
}
`);

  const result = await scanFlowDesign(repo, {
    story: { story_id: 'U-020', title: '新規登録でタスクを量産せず不足情報を質問化する', view: 'user' },
    config: {
      flow_design: {
        profile: 'configured-case-management',
        value_contract: {
          forbidden_labels: ['退院予定日'],
          required_labels: ['退院目標日']
        }
      }
    }
  });

  assert.equal(result.summary.scanned_ui_files, 2);
  assert.equal(result.silent_noop_hits.some((hit) => hit.file === 'src/app/new/page.tsx'), true);
  assert.equal(result.selection_side_effect_hits.some((hit) => hit.kind === 'selection_triggers_navigation'), true);
  assert.equal(result.question_dead_end_hits.some((hit) => hit.question_key === 'dpc_target_date'), true);
  assert.equal(result.dead_ui_state_hits.some((hit) => hit.state === 'lookupResult'), true);
  assert.equal(result.interactive_contract_hits.some((hit) => hit.kind === 'interactive_handler_without_user_visible_effect' && hit.handler === 'handleVoiceInput'), true);
  assert.equal(result.interactive_contract_hits.some((hit) => hit.kind === 'interactive_element_without_contract' && hit.label === '詳細を見る'), true);
  assert.equal(result.interactive_contract_hits.some((hit) => /AI要約/.test(hit.label ?? '')), false);
  assert.equal(result.value_alignment_hits.some((hit) => hit.kind === 'forbidden_label' && hit.label === '退院予定日'), true);
  assert.equal(result.status, 'needs_review');
});

test('flow design scanner limits silent noop to event paths and ignores test mock buttons', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'ai-search'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'detail', '_components'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'ai-search', 'client.tsx'), `
"use client";
function createId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return String(Date.now());
}
function confidenceLabel(confidence) {
  if (confidence === 'db_confirmed') return 'DB確認済み';
  if (confidence === 'needs_call') return '要架電';
  if (confidence === 'unknown') return '不明';
  return '未確認';
}
function getLatestCarousel(history) {
  if (history.length === 0) return null;
  return history[history.length - 1];
}
function selectedCallHotel(history, id) {
  const hotel = history.find((item) => item.id === id);
  if (hotel) return hotel;
  return null;
}
export default function AiSearchClient() {
  const isLoading = false;
  const composerMessage = '';
  const choose = () => {
    selectedCallHotel([], 'h1');
  };
  const submit = () => {
    if (!composerMessage || isLoading) return;
    void fetch('/api/ai-search', { method: 'POST' });
  };
  return <form onSubmit={submit}>
    <button type="submit" disabled={isLoading || !composerMessage.trim()}>
      検索する
    </button>
    {isLoading && <span>読み込み中</span>}
    <button type="button" onClick={choose}>選択</button>
  </form>;
}
`);
  await writeFile(path.join(repo, 'src', 'app', 'detail', '_components', 'SearchResultHotelCard.test.tsx'), `
import { vi } from 'vitest';
vi.mock('@/components/premium/PremiumGatedShadowCallButton', () => ({
  PremiumGatedShadowCallButton: ({ children }) => <button type="button">{children}</button>
}));
`);

  const result = await scanFlowDesign(repo, {
    story: { story_id: 'U-AI', title: 'AI検索UIの操作信頼性を診断する', view: 'user' }
  });

  assert.equal(result.silent_noop_hits.some((hit) => /createId|confidenceLabel|getLatestCarousel|selectedCallHotel/.test(hit.handler ?? '')), false);
  assert.equal(result.silent_noop_hits.length, 1);
  assert.equal(result.silent_noop_hits[0].handler, 'submit');
  assert.equal(result.silent_noop_hits[0].gate_effect, 'info');
  assert.equal(result.silent_noop_hits[0].mitigation, 'disabled UI mitigation');
  assert.equal(result.interactive_contract_hits.some((hit) => hit.file.endsWith('.test.tsx')), false);
  assert.equal(result.status, 'pass');
});

test('flow design scanner detects async function handlers after event-path gating', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'async-handler'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'async-handler', 'page.tsx'), `
"use client";
export default function AsyncHandlerPage() {
  async function handleSubmit() {
    if (!query) return;
    setSaved(true);
  }
  return <form onSubmit={handleSubmit}><button type="submit">保存</button></form>;
}
`);

  const result = await scanFlowDesign(repo, {
    story: { story_id: 'U-ASYNC', title: 'async function handlerを診断する', view: 'user' }
  });

  assert.equal(result.silent_noop_hits.length, 1);
  assert.equal(result.silent_noop_hits[0].handler, 'handleSubmit');
  assert.equal(result.silent_noop_hits[0].event_path, 'onSubmit:handleSubmit');
  assert.equal(result.status, 'needs_review');
});

test('flow design scanner does not downgrade partially mitigated early returns', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'partial'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'partial', 'page.tsx'), `
"use client";
export default function PartialPage() {
  const submit = () => {
    if (!query || isLoading) return;
    setSaved(true);
  };
  return <button onClick={submit} disabled={isLoading}>検索</button>;
}
`);

  const result = await scanFlowDesign(repo, {
    story: { story_id: 'U-PARTIAL', title: '部分的なdisabledでは空入力noopを隠さない', view: 'user' }
  });

  assert.equal(result.silent_noop_hits.length, 1);
  assert.equal(result.silent_noop_hits[0].handler, 'submit');
  assert.equal(result.silent_noop_hits[0].gate_effect, 'review');
  assert.equal(result.status, 'needs_review');
});

test('flow design scanner does not use unrelated element disabled state as mitigation', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'unrelated-disabled'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'unrelated-disabled', 'page.tsx'), `
"use client";
export default function UnrelatedDisabledPage() {
  const save = () => {
    if (!query) return;
    setSaved(true);
  };
  return <main>
    <button onClick={save}>保存</button>
    <button disabled={!query}>別の操作</button>
  </main>;
}
`);

  const result = await scanFlowDesign(repo, {
    story: { story_id: 'U-UNRELATED', title: '別UIのdisabledで無反応を隠さない', view: 'user' }
  });

  assert.equal(result.silent_noop_hits.length, 1);
  assert.equal(result.silent_noop_hits[0].handler, 'save');
  assert.equal(result.silent_noop_hits[0].gate_effect, 'review');
  assert.equal(result.status, 'needs_review');
});

test('flow design scanner preserves unmitigated duplicate event paths for the same handler', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'duplicate-handler'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'duplicate-handler', 'page.tsx'), `
"use client";
export default function DuplicateHandlerPage() {
  const save = () => {
    if (!query) return;
    setSaved(true);
  };
  return <main>
    <button onClick={save}>保存</button>
    <button onClick={save} disabled={!query}>別配置の保存</button>
  </main>;
}
`);

  const result = await scanFlowDesign(repo, {
    story: { story_id: 'U-DUPLICATE', title: '同一handlerの未mitigate経路を残す', view: 'user' }
  });

  assert.equal(result.silent_noop_hits.length, 1);
  assert.equal(result.silent_noop_hits[0].handler, 'save');
  assert.equal(result.silent_noop_hits[0].gate_effect, 'review');
  assert.match(result.silent_noop_hits[0].event_path, /onClick:save/);
  assert.equal(result.status, 'needs_review');
});

test('flow design scanner does not treat loading state variable as visible mitigation', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'loading-state'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'loading-state', 'page.tsx'), `
"use client";
export default function LoadingStatePage() {
  const run = () => {
    if (isLoading) return;
    void fetch('/api/search');
    setSaved(true);
  };
  return <button onClick={run}>保存</button>;
}
`);

  const result = await scanFlowDesign(repo, {
    story: { story_id: 'U-LOADING', title: 'loading stateだけで無反応を隠さない', view: 'user' }
  });

  assert.equal(result.silent_noop_hits.length, 1);
  assert.equal(result.silent_noop_hits[0].handler, 'run');
  assert.equal(result.silent_noop_hits[0].gate_effect, 'review');
  assert.equal(result.status, 'needs_review');
});

test('flow design scanner follows direct calls from inline event handlers', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'inline'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'inline', 'page.tsx'), `
"use client";
export default function InlinePage() {
  const submit = () => {
    if (!ready) return;
    setSaved(true);
  };
  return <button onClick={() => submit()}>保存</button>;
}
`);

  const result = await scanFlowDesign(repo, {
    story: { story_id: 'U-INLINE', title: 'inline handler経由の操作を診断する', view: 'user' }
  });

  assert.equal(result.silent_noop_hits.length, 1);
  assert.equal(result.silent_noop_hits[0].handler, 'submit');
  assert.equal(result.silent_noop_hits[0].event_path, 'onClick:submit');
  assert.equal(result.silent_noop_hits[0].gate_effect, 'review');
  assert.equal(result.status, 'needs_review');
});

test('flow design scanner reads disabled mitigation from inline arrow event elements', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'inline-disabled'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'inline-disabled', 'page.tsx'), `
"use client";
export default function InlineDisabledPage() {
  const submit = () => {
    if (!query) return;
    setSaved(true);
  };
  return <button onClick={() => submit()} disabled={!query}>保存</button>;
}
`);

  const result = await scanFlowDesign(repo, {
    story: { story_id: 'U-INLINE-DISABLED', title: 'inline handlerのdisabledを診断に使う', view: 'user' }
  });

  assert.equal(result.silent_noop_hits.length, 1);
  assert.equal(result.silent_noop_hits[0].handler, 'submit');
  assert.equal(result.silent_noop_hits[0].gate_effect, 'info');
  assert.equal(result.silent_noop_hits[0].mitigation, 'disabled UI mitigation');
  assert.equal(result.status, 'pass');
});

test('flow design scanner preserves unmitigated one-hop helper paths', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'helper-paths'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'helper-paths', 'page.tsx'), `
"use client";
export default function HelperPathsPage() {
  const saveCore = () => {
    if (!query) return;
    setSaved(true);
  };
  const saveA = () => saveCore();
  const saveB = () => saveCore();
  return <main>
    <button onClick={saveA} disabled={!query}>保存A</button>
    <button onClick={saveB}>保存B</button>
  </main>;
}
`);

  const result = await scanFlowDesign(repo, {
    story: { story_id: 'U-HELPER-PATHS', title: 'helperに複数event pathがある', view: 'user' }
  });

  assert.equal(result.silent_noop_hits.length, 1);
  assert.equal(result.silent_noop_hits[0].handler, 'saveCore');
  assert.equal(result.silent_noop_hits[0].gate_effect, 'review');
  assert.match(result.silent_noop_hits[0].event_path, /saveA->saveCore/);
  assert.match(result.silent_noop_hits[0].event_path, /saveB->saveCore/);
  assert.equal(result.status, 'needs_review');
});

test('gesture interaction scanner flags touch, overlay, drag, carousel, and map marker risks', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'page.css'), `
.map-carousel {
  touch-action: pan-x pan-y pinch-zoom;
  overflow-x: auto;
}
.map-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
}
.hotel-card {
  width: 36px;
  height: 40px;
}
`);
  await writeFile(path.join(repo, 'src', 'app', 'page.tsx'), `
"use client";
export default function Page({ router }) {
  const [isDragging, setIsDragging] = useState(false);
  return <div className="carousel" onPointerDown={() => setIsDragging(true)}>
    <button onClick={() => router.push('/detail')}>宿を見る</button>
    <AdvancedMarkerElement position={{ lat: 35, lng: 139 }} />
  </div>;
}
`);

  const result = await scanGestureInteraction(repo);

  assert.equal(result.status, 'needs_review');
  assert.equal(result.touch_action_hits.some((hit) => hit.kind === 'ambiguous_touch_action_on_gesture_surface'), true);
  assert.equal(result.overlay_pointer_hits.some((hit) => hit.kind === 'map_overlay_may_capture_touch'), true);
  assert.equal(result.drag_tap_hits.some((hit) => hit.kind === 'drag_state_not_connected_to_click_suppression'), true);
  assert.equal(result.carousel_hits.some((hit) => hit.kind === 'carousel_missing_scroll_snap_contract'), true);
  assert.equal(result.carousel_hits.some((hit) => hit.kind === 'small_gesture_hit_area'), true);
  assert.equal(result.map_marker_hits.some((hit) => hit.kind === 'map_marker_layering_contract_missing'), true);
});

test('terminal link scanner flags dot directory HTML preview gaps', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'public', 'modules'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'ttyd'), { recursive: true });
  await mkdir(path.join(repo, 'server', 'controllers', 'session'), { recursive: true });
  await writeFile(path.join(repo, 'public', 'modules', 'xterm-file-links.js'), `
const XTERM_FILE_TOKEN_REGEX = new RegExp(
  '((?:~\\\\/|\\\\.{1,2}\\\\/|\\\\/)?[a-zA-Z0-9_][a-zA-Z0-9_/.\\\\-]*\\\\.(?:html|js))',
  'g'
);
const XTERM_CONTINUATION_SUFFIX_REGEX = new RegExp('^(\\\\s+)([a-zA-Z0-9_/.\\\\-]+\\\\.(?:html))');
`);
  await writeFile(path.join(repo, 'public', 'ttyd', 'custom_ttyd_index.html'), `
<script>
const filePathRegex = new RegExp('((?:~\\\\/|\\\\.{1,2}\\\\/|\\\\/)?[a-zA-Z0-9_][a-zA-Z0-9_/.\\\\-]*\\\\.(?:html))', 'g');
term.registerLinkProvider({ provideLinks() {} });
</script>
`);
  await writeFile(path.join(repo, 'server', 'controllers', 'session', 'shared-methods.js'), `
controller._readTree = async () => entries.filter((entry) => {
  if (entry.name.startsWith('.')) return false;
  return true;
});
`);
  await writeFile(path.join(repo, 'public', 'modules', 'file-preview-config.js'), `
export const BROWSER_PREVIEWABLE_EXTENSIONS = new Set([
  '.md',
  '.html',
  '.svg',
  '.js'
]);
`);

  const result = await scanTerminalLinkContracts(repo);

  assert.equal(result.status, 'needs_review');
  assert.equal(result.dot_directory_link_hits.some((hit) => hit.kind === 'dot_directory_file_link_not_supported'), true);
  assert.equal(result.wrapped_terminal_link_hits.some((hit) => hit.kind === 'wrapped_terminal_continuation_requires_indent'), true);
  assert.equal(result.dot_directory_tree_hits.some((hit) => hit.kind === 'dot_directory_tree_hidden_without_allowlist'), true);
  assert.equal(result.image_preview_extension_hits.some((hit) => hit.kind === 'browser_preview_image_extensions_missing'), true);
  assert.deepEqual(
    result.image_preview_extension_hits[0].missing_extensions,
    ['.png', '.jpg', '.jpeg', '.gif', '.webp']
  );
});

test('terminal link scanner accepts image preview extensions via IMAGE_EXTENSIONS spread', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'public', 'modules'), { recursive: true });
  await writeFile(path.join(repo, 'public', 'modules', 'file-preview-config.js'), `
export const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp'
]);
export const BROWSER_PREVIEWABLE_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  '.md',
  '.html',
  '.svg'
]);
`);

  const result = await scanTerminalLinkContracts(repo);

  assert.equal(result.status, 'ok');
  assert.equal(result.image_preview_extension_hits.length, 0);
});

test('diagnose writes flow design evidence, report, findings, and story tasks', async () => {
  const repo = await makeRepo();
  await runCli([
    'init',
    repo,
    '--story-id',
    'U-020',
    '--title',
    '新規登録でタスクを量産せず不足情報を質問化する',
    '--view',
    'user',
    '--period',
    '2026-05'
  ]);
  await mkdir(path.join(repo, 'src', 'app', 'new'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'patients', '[id]'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'cases', '[id]', 'notes'), { recursive: true });
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    dependencies: { next: '16.2.1', react: '19.0.0' }
  }, null, 2));
  await writeFile(path.join(repo, 'src', 'app', 'new', 'page.tsx'), `
"use client";
export default function NewPage() {
  const selectDpc = (result) => {
    setDpcCode(result.dpc_code);
    router.push('/patients/' + result.id);
  };
  return <button onClick={() => selectDpc(result)}>DPC候補を選択</button>;
}
`);
  await writeFile(path.join(repo, 'src', 'app', 'patients', '[id]', 'page.tsx'), `
"use client";
export default function PatientPage() {
  const saveQuestionAnswer = async (question, value) => {
    if (question.key === 'dpc_target_date') {
      await fetch('/api/cases/1/notes', { method: 'POST' });
      setDpcTargetDateStatus(value);
    }
  };
  return <div>退院予定日</div>;
}
`);
  await writeFile(path.join(repo, 'src', 'app', 'api', 'cases', '[id]', 'notes', 'route.ts'), `
export async function POST() {
  return Response.json({ ok: true });
}
`);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.flow_design = {
    profile: 'configured-case-management',
    value_contract: {
      forbidden_labels: ['退院予定日'],
      required_labels: ['退院目標日']
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [{ id: 'new-page' }, { id: 'patient-page' }],
    edges: []
  }));

  const result = await runCli(['diagnose', repo, '--run-id', '2026-05-10T000000Z']);

  assert.equal(result.exitCode, 0);
  const runDir = path.join(repo, '.vibepro', 'diagnostics', '2026-05-10T000000Z');
  const evidence = await readJson(path.join(runDir, 'evidence.json'));
  assert.equal(evidence.flow_design.profile, 'configured-case-management');
  assert.equal(evidence.flow_design.summary.scanned_ui_files, 2);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-FLOW-003'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-FLOW-004'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-FLOW-007'), true);
  assert.equal(evidence.gates[0].status, 'needs_review');
  const report = await readFile(path.join(runDir, 'flow-design-check-result.md'), 'utf8');
  assert.match(report, /Flow Design Check/);
  assert.match(report, /Selection side effect/);
  const summary = await readFile(path.join(runDir, 'summary.md'), 'utf8');
  assert.match(summary, /Flow Design Gate/);
  const tasks = await readJson(path.join(repo, '.vibepro', 'stories', 'U-020', 'tasks', 'tasks.json'));
  assert.equal(tasks.tasks.some((task) => task.finding_id === 'VP-FLOW-003'), true);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(
    manifest.runs[0].artifacts.flow_design_check,
    '.vibepro/diagnostics/2026-05-10T000000Z/flow-design-check-result.md'
  );
});

test('diagnose does not gate mitigated info-level silent noop findings', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-mitigated-flow-'));
  await runCli([
    'init',
    repo,
    '--story-id',
    'U-MITIGATED',
    '--title',
    '検索UIの空入力をdisabledで防ぐ',
    '--view',
    'user'
  ]);
  await mkdir(path.join(repo, 'src', 'app'), { recursive: true });
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    dependencies: { next: '16.2.1', react: '19.0.0' }
  }, null, 2));
  await writeFile(path.join(repo, 'src', 'app', 'page.tsx'), `
"use client";
export default function Page() {
  const submit = () => {
    if (!query || isLoading) return;
    setSaved(true);
  };
  return <button onClick={submit} disabled={!query || isLoading}>検索</button>;
}
`);
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [{ id: 'page' }],
    edges: []
  }));

  const result = await runCli(['diagnose', repo, '--run-id', '2026-05-10T010000Z']);

  assert.equal(result.exitCode, 0);
  const evidence = await readJson(path.join(repo, '.vibepro', 'diagnostics', '2026-05-10T010000Z', 'evidence.json'));
  assert.equal(evidence.flow_design.silent_noop_hits.length, 1);
  assert.equal(evidence.flow_design.silent_noop_hits[0].gate_effect, 'info');
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-FLOW-002'), false);
  assert.equal(evidence.gates.find((gate) => gate.id === 'production-readiness')?.status, 'pass');
});

test('diagnose emits critical network contract finding for missing Next.js API route', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-network-contract', '--title', 'Network contract']);
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    dependencies: { next: '16.2.1', react: '19.0.0' }
  }, null, 2));
  await mkdir(path.join(repo, 'src', 'app', 'detail', '_components'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'detail', '_components', 'searchExecutor.ts'), `
export async function execute(actionParams) {
  const response = await fetch('/api/detail-search', { method: 'POST', body: JSON.stringify(actionParams) });
  return response.json();
}
`);
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [{ id: 'detail-search' }],
    edges: []
  }));

  const result = await runCli(['diagnose', repo, '--run-id', 'network-contract-run']);

  assert.equal(result.exitCode, 0);
  const evidence = await readJson(path.join(repo, '.vibepro', 'diagnostics', 'network-contract-run', 'evidence.json'));
  assert.equal(evidence.network_contracts.missing_routes.some((item) => item.api_path === '/api/detail-search'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-NET-001' && finding.severity === 'Critical'), true);
  assert.equal(evidence.gates[0].status, 'block');
  const summary = await readFile(path.join(repo, '.vibepro', 'diagnostics', 'network-contract-run', 'summary.md'), 'utf8');
  assert.match(summary, /Network Contract/);
  assert.match(summary, /\/api\/detail-search/);
});

test('network contract scanner resolves query strings and Next.js dynamic route segments', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'api', 'companies', 'search'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'companies', '[companyId]'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'companies'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'companies', 'search', 'route.ts'), 'export async function GET() { return Response.json({ ok: true }); }\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'companies', '[companyId]', 'route.ts'), 'export async function GET() { return Response.json({ ok: true }); }\n');
  await writeFile(path.join(repo, 'src', 'app', 'companies', 'page.tsx'), `
export async function loadCompanies(query, companyId) {
  await fetch(\`/api/companies/search?q=\${query}\`);
  await fetch(\`/api/companies/\${companyId}?include=details\`);
}
`);

  const result = await scanNetworkContracts(repo);

  assert.equal(result.status, 'pass');
  assert.equal(result.missing_routes.length, 0);
  assert.equal(result.dynamic_calls.length, 0);
  assert.equal(result.api_client_calls.every((call) => call.route_status === 'present'), true);
});



test('graph cleans generated graphify-out when graphify fails', async () => {
  const repo = await makeRepo();
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-bin-'));
  const graphifyBin = path.join(binDir, 'graphify');
  await writeFile(graphifyBin, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

mkdirSync('graphify-out', { recursive: true });
writeFileSync(path.join('graphify-out', 'partial.txt'), 'partial');
console.error('simulated graphify failure');
process.exit(2);
`);
  await chmod(graphifyBin, 0o755);

  const result = await runCli(['graph', repo, '--run-graphify'], {
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 1);
  assert.equal(await pathExists(path.join(repo, 'graphify-out')), false);
});

test('story derive can run graphify before generating the story catalog', async () => {
  const repo = await makeRepo();
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-bin-'));
  const graphifyBin = path.join(binDir, 'graphify');
  await writeFile(graphifyBin, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

if (process.argv[2] !== 'update' || process.argv[3] !== '.') {
  console.error('unexpected graphify args: ' + process.argv.slice(2).join(' '));
  process.exit(1);
}
const outDir = 'graphify-out';
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'graph.json'), JSON.stringify({
  nodes: [{ id: 'src/app/api/debug/route.ts' }],
  edges: []
}));
writeFileSync(path.join(outDir, 'GRAPH_REPORT.md'), '# Generated Graph Report\\n');
`);
  await chmod(graphifyBin, 0o755);
  await runCli(['init', repo]);

  const result = await runCli(['story', 'derive', repo, '--run-graphify'], {
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.graph.graphifyExecuted, true);
  assert.equal((await readJson(path.join(repo, '.vibepro', 'graphify', 'graph.json'))).nodes[0].id, 'src/app/api/debug/route.ts');
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.graphify.last_execution.command, 'graphify update .');
  await stat(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
});

test('story derive handles medium cyclic graphify graphs without stack overflow', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'demo', '--title', 'demo']);
  await mkdir(path.join(repo, 'src', 'pkg'), { recursive: true });
  for (let index = 0; index < 60; index += 1) {
    await writeFile(path.join(repo, 'src', 'pkg', `module-${index}.ts`), `export const value${index} = ${index};\n`);
  }
  const nodes = [];
  const links = [];
  for (let index = 0; index < 4334; index += 1) {
    nodes.push({
      id: `node-${index}`,
      label: `Node ${index}`,
      source_file: `src/pkg/module-${index % 60}.ts`,
      community: `community-${index % 17}`
    });
    links.push({ source: `node-${index}`, target: `node-${(index + 1) % 4334}`, confidence: 'EXTRACTED' });
    if (index % 4 === 0) {
      links.push({ source: `node-${index}`, target: `node-${(index + 997) % 4334}`, confidence: 'INFERRED' });
    }
  }
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({ nodes, links }));

  const result = await runCli(['story', 'derive', repo, '--preset', 'modular-web', '--json']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.catalog.source.graphify.node_count, 4334);
  assert.equal(result.result.catalog.source.graphify.edge_count, links.length);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'stories', 'story-catalog.json')), true);
});

test('story derive writes failure evidence when graph processing fails', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'demo', '--title', 'demo']);
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), '{ invalid json');

  const result = await runCli(['story', 'derive', repo], {
    stderr: { write: () => {} }
  });

  assert.equal(result.exitCode, 1);
  const diagnostics = await readdir(path.join(repo, '.vibepro', 'diagnostics'));
  const failureDir = diagnostics.find((entry) => entry.startsWith('story-derive-failure-'));
  assert.equal(Boolean(failureDir), true);
  const failure = await readJson(path.join(repo, '.vibepro', 'diagnostics', failureDir, 'failure.json'));
  assert.equal(failure.status, 'failed');
  assert.match(failure.error.message, /JSON/);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'diagnostics', failureDir, 'failure.md')), true);
});

test('story add list select and archive manage local stories without NocoDB', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  const addResult = await runCli([
    'story',
    'add',
    repo,
    '--id',
    'story-local-hardening',
    '--title',
    'ローカル診断強化',
    '--horizon',
    'sprint',
    '--view',
    'dev',
    '--period',
    '2026-W18',
    '--started-at',
    '2026-04-28',
    '--due-at',
    '2026-05-05'
  ]);

  assert.equal(addResult.exitCode, 0);
  const afterAdd = await readJson(path.join(repo, '.vibepro', 'config.json'));
  const localStory = afterAdd.brainbase.stories.find((story) => story.story_id === 'story-local-hardening');
  assert.equal(localStory.title, 'ローカル診断強化');
  assert.equal(localStory.ssot, 'local');
  assert.equal(localStory.status, 'active');
  assert.equal(localStory.period, '2026-W18');

  const selectResult = await runCli(['story', 'select', repo, '--id', 'story-local-hardening']);

  assert.equal(selectResult.exitCode, 0);
  const afterSelect = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(afterSelect.brainbase.current_story_id, 'story-local-hardening');

  let output = '';
  const listResult = await runCli(['story', 'list', repo], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(listResult.exitCode, 0);
  assert.match(output, /\* story-local-hardening/);

  const archiveResult = await runCli(['story', 'archive', repo, '--id', 'story-local-hardening']);

  assert.equal(archiveResult.exitCode, 0);
  const afterArchive = await readJson(path.join(repo, '.vibepro', 'config.json'));
  const archivedStory = afterArchive.brainbase.stories.find((story) => story.story_id === 'story-local-hardening');
  assert.equal(archivedStory.status, 'archived');
  assert.equal(afterArchive.brainbase.current_story_id, null);
});

test('story derive creates a repo-wide story catalog and local stories', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-existing', '--title', '既存Story', '--view', 'dev', '--period', '2026-W18']);
  await mkdir(path.join(repo, 'docs', 'user_stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'features'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'webhook', 'stripe'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'auth', '[...nextauth]'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'components', 'auth'), { recursive: true });
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    dependencies: {
      next: '15.0.0',
      react: '19.0.0',
      'next-auth': '5.0.0',
      '@prisma/client': '6.0.0'
    },
    devDependencies: {
      '@playwright/test': '1.0.0',
      vitest: '3.0.0'
    }
  }));
  await writeFile(path.join(repo, 'docs', 'user_stories', 'active', 'US-001_login_session.md'), '# ログイン状態を保って継続利用できる\n');
  await writeFile(path.join(repo, 'docs', 'features', 'content-cms-system.md'), '# 記事CMSを整える\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'webhook', 'stripe', 'route.ts'), 'export function POST() {}\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'auth', '[...nextauth]', 'route.ts'), 'export function GET() {}\n');
  await writeFile(path.join(repo, 'src', 'components', 'auth', 'LoginForm.tsx'), 'export function LoginForm() { return null; }\n');

  const result = await runCli(['story', 'derive', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.added_count > 0, true);
  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.stories.some((story) => story.story_id === 'story-product-us-001-login-session'), false);
  assert.equal(catalog.stories.some((story) => story.story_id === 'story-product-content-cms-system'), false);
  assert.equal(catalog.stories.some((story) => story.title.includes('仕様書')), false);
  const authStory = catalog.stories.find((story) => story.story_id === 'story-product-auth-account-access');
  assert.equal(Boolean(authStory), true);
  assert.equal(authStory.source.paths.includes('docs/user_stories/active/US-001_login_session.md'), true);
  assert.equal(authStory.source.paths.includes('src/components/auth/LoginForm.tsx'), true);
  assert.equal(authStory.view, 'business');
  assert.equal(authStory.category, 'product');
  assert.equal(authStory.horizon, 'quarter');
  assert.equal(authStory.period, null);
  assert.equal(authStory.derived.predictions.period.confidence, 'unknown');
  assert.match(authStory.derived.story_definition.who, /サービスを継続利用したいユーザー/);
  assert.match(authStory.derived.story_definition.problem, /認証/);
  assert.equal(authStory.derived.story_definition.acceptance_focus.some((item) => item.includes('セッション同期')), true);
  assert.match(authStory.derived.meaning.value_hypothesis, /継続利用/);
  assert.equal(authStory.derived.meaning.user_actor.confidence, 'high');
  assert.equal(authStory.derived.meaning.business_goal.confidence, 'low');
  assert.equal(authStory.derived.meaning.workflow_position.stage, 'activation');
  assert.equal(authStory.derived.meaning.workflow_position.after.includes('story-product-onboarding'), true);
  assert.equal(catalog.open_questions.some((item) => item.story_id === 'story-product-auth-account-access' && item.field === 'period'), true);
  assert.equal(catalog.stories.some((story) => story.story_id === 'story-product-content-cms'), true);
  assert.equal(catalog.stories.some((story) => story.story_id === 'story-architecture-api-surface'), true);
  assert.equal(catalog.stories.some((story) => story.story_id === 'story-security-auth-boundary'), true);
  assert.doesNotMatch(JSON.stringify(catalog), /ExampleTravel|ホテル|旅行|hotel|shadow-call/i);
  const map = await readFile(path.join(repo, '.vibepro', 'stories', 'story-map.md'), 'utf8');
  assert.match(map, /# Story Map/);
  assert.match(map, /## サマリー/);
  assert.match(map, /## まず確認すること/);
  assert.match(map, /## Story構造/);
  assert.match(map, /## Storyカード/);
  assert.match(map, /誰のため: サービスを継続利用したいユーザー/);
  assert.match(map, /成果: ユーザーが安心してアカウントを作成し、継続利用できる/);
  assert.match(map, /意味づけ:/);
  assert.match(map, /位置づけ: activation/);
  assert.match(map, /付録: 不明点/);
  assert.match(map, /認証とアカウント利用開始を成立させる/);
  assert.doesNotMatch(map, /ExampleTravel|ホテル|旅行|hotel|shadow-call/i);
  const config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(config.brainbase.stories.some((story) => story.story_id === 'story-product-auth-account-access'), true);
  assert.equal(config.brainbase.stories.find((story) => story.story_id === 'story-product-auth-account-access').view, 'business');
  assert.equal(config.brainbase.stories.find((story) => story.story_id === 'story-product-auth-account-access').category, 'product');
  assert.equal(config.brainbase.stories.find((story) => story.story_id === 'story-product-auth-account-access').period, null);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.artifacts.story_catalog, '.vibepro/stories/story-catalog.json');
  assert.equal(manifest.artifacts.story_map, '.vibepro/stories/story-map.md');
});

test('story derive continues when manifest evidence artifact is missing', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'components', 'auth'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'components', 'auth', 'LoginForm.tsx'), 'export function LoginForm() { return null; }\n');
  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.latest_run = 'missing-run';
  manifest.runs = [{
    run_id: 'missing-run',
    story_id: 'story-vibepro-diagnosis-commercialization-roadmap',
    artifacts: {
      evidence: '.vibepro/diagnostics/missing-run/evidence.json'
    }
  }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  let output = '';

  const result = await runCli(['story', 'derive', repo], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.match(output, /Warnings:/);
  assert.match(output, /診断evidenceが見つからない/);
  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.source.run_id, null);
  assert.equal(catalog.source.warnings[0].code, 'missing_evidence');
  assert.equal(catalog.source.warnings[0].run_id, 'missing-run');
  const map = await readFile(path.join(repo, '.vibepro', 'stories', 'story-map.md'), 'utf8');
  assert.match(map, /警告: missing_evidence/);

  await runCli(['story', 'plan', repo]);
  const plan = await readJson(path.join(repo, '.vibepro', 'stories', 'story-plan.json'));
  const cleanupTask = plan.task_candidates.find((task) => task.id === 'story-docs-story-ssot-recovery-missing-evidence-cleanup');
  assert.equal(plan.questions.some((question) => question.field === 'missing_evidence'), true);
  assert.equal(Boolean(cleanupTask), true);
  assert.equal(cleanupTask.story_id, 'story-docs-story-ssot-recovery');
  assert.match(cleanupTask.purpose, /診断evidence/);
});

test('story map renders the generated catalog as markdown and json', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'docs', 'features'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'features', 'article-cms-requirements.md'), '# 記事CMSを整える\n');
  await runCli(['story', 'derive', repo]);
  let markdown = '';
  const markdownResult = await runCli(['story', 'map', repo], {
    stdout: { write: (text) => { markdown += text; } }
  });
  let json = '';
  const jsonResult = await runCli(['story', 'map', repo, '--json'], {
    stdout: { write: (text) => { json += text; } }
  });

  assert.equal(markdownResult.exitCode, 0);
  assert.match(markdown, /Story構造/);
  assert.match(markdown, /Storyカード/);
  assert.match(markdown, /記事とCMS運用を整理する/);
  assert.match(markdown, /SEO流入/);
  assert.match(markdown, /docs\/features\/article-cms-requirements\.md/);
  assert.equal(jsonResult.exitCode, 0);
  assert.equal(JSON.parse(json).stories.some((story) => story.story_id === 'story-product-article-cms-requirements'), false);
  assert.equal(JSON.parse(json).stories.some((story) => story.story_id === 'story-product-content-cms'), true);
  assert.match(JSON.parse(json).stories.find((story) => story.story_id === 'story-product-content-cms').derived.story_definition.business_value, /SEO流入/);
});

test('story plan creates execution priorities from the generated story map', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'auth', 'session'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'components', 'auth'), { recursive: true });
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'auth', 'session', 'route.ts'), 'export function GET() { return Response.json({ ok: true }); }\n');
  await writeFile(path.join(repo, 'src', 'components', 'auth', 'LoginForm.tsx'), 'export function LoginForm() { return null; }\n');
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'session-route', source_file: 'src/app/api/auth/session/route.ts', community: 'auth-account' },
      { id: 'login-form', source_file: 'src/components/auth/LoginForm.tsx', community: 'auth-account' },
      { id: 'session-helper', source_file: 'src/lib/auth/session.ts', community: 'auth-account' }
    ],
    edges: [
      { source: 'login-form', target: 'session-route' },
      { source: 'session-route', target: 'session-helper' }
    ]
  }));
  await runCli(['story', 'derive', repo]);

  let output = '';
  const result = await runCli(['story', 'plan', repo, '--limit', '3'], {
    stdout: { write: (text) => { output += text; } }
  });
  let json = '';
  const jsonResult = await runCli(['story', 'plan', repo, '--limit', '2', '--json'], {
    stdout: { write: (text) => { json += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.match(output, /# Story Plan/);
  assert.match(output, /Story実行計画/);
  assert.match(output, /まず確認する質問/);
  assert.match(output, /Source Consistency/);
  assert.match(output, /正本欠落マップ/);
  assert.match(output, /潜在バグ候補/);
  assert.match(output, /Spec欠落/);
  assert.match(output, /Spec正本を復元する/);
  const plan = await readJson(path.join(repo, '.vibepro', 'stories', 'story-plan.json'));
  assert.equal(plan.priority_stories.length <= 2, true);
  assert.equal(plan.summary.source_consistency_status, 'needs_recovery');
  assert.equal(plan.source_consistency.needs_recovery_story_count > 0, true);
  assert.equal(plan.summary.source_missing_spec_count > 0, true);
  assert.equal(plan.summary.source_alignment_finding_count > 0, true);
  assert.equal(plan.summary.source_alignment_high_count > 0, true);
  assert.equal(plan.source_recovery_map.counts.missing_spec > 0, true);
  assert.equal(plan.source_alignment_findings.items.some((finding) => finding.type === 'missing_spec_source'), true);
  assert.equal(plan.questions.some((question) => question.field === 'source_alignment'), true);
  const missingSpecRow = plan.source_recovery_map.missing.find((row) => row.story_id === 'story-product-auth-account-access');
  assert.equal(missingSpecRow.spec.suggested_path, 'docs/specs/product-auth-account-access.md');
  assert.equal(missingSpecRow.spec.suggested_task_id, 'story-product-auth-account-access-spec-recovery');
  assert.equal(missingSpecRow.graph.related_edge_count > 0, true);
  assert.equal(plan.questions.some((question) => question.field === 'source_spec_recovery'), true);
  assert.equal(plan.task_candidates.some((task) => task.id.endsWith('spec-recovery')), true);
  assert.equal(plan.task_candidates.some((task) => task.id.endsWith('source-alignment-review')), true);
  const specRecoveryCandidate = plan.task_candidates.find((task) => task.id === 'story-product-auth-account-access-spec-recovery');
  assert.equal(specRecoveryCandidate.source_recovery.sources.spec.status, 'needs_recovery');
  assert.equal(specRecoveryCandidate.graph_context.matched_node_count > 0, true);
  assert.equal(specRecoveryCandidate.recovery_drafts.some((draft) => draft.kind === 'spec'), true);
  assert.equal(specRecoveryCandidate.recovery_drafts[0].graph_evidence.related_edge_count > 0, true);
  assert.equal(specRecoveryCandidate.recovery_drafts[0].evidence_files.includes('src/lib/auth/session.ts'), true);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.artifacts.story_plan, '.vibepro/stories/story-plan.json');
  assert.equal(manifest.artifacts.story_plan_markdown, '.vibepro/stories/story-plan.md');
  assert.equal(jsonResult.exitCode, 0);
  assert.equal(JSON.parse(json).priority_stories.length > 0, true);
  assert.equal(JSON.parse(json).priority_stories.length <= 2, true);
});

test('story plan creates task candidates from explicit story task sections', async () => {
  const repo = await makeRepo();
  await runCli([
    'init',
    repo,
    '--story-id',
    'story-agent-harness',
    '--title',
    'Agent harness readiness',
    '--view',
    'dev'
  ]);
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-agent-harness.md'), `---
story_id: story-agent-harness
title: Agent harness readiness
view: dev
---

# Agent harness readiness

## 受け入れ基準

- [ ] harness status can run

## 初期タスク

1. Harness診断パッケージ
   - \`agent-harness\` check packを追加する
   - \`check all\` ではデフォルト任意案内にする
2. Harness status
   - \`vibepro harness status\` を追加する
   - installed / missing / outdated を一覧化する
`);

  await runCli(['story', 'derive', repo]);
  const planResult = await runCli(['story', 'plan', repo, '--limit', '10']);

  assert.equal(planResult.exitCode, 0);
  const plan = await readJson(path.join(repo, '.vibepro', 'stories', 'story-plan.json'));
  const explicitTasks = plan.task_candidates.filter((task) => task.source_type === 'story_explicit_task');
  assert.equal(explicitTasks.length, 2);
  assert.equal(explicitTasks[0].id, 'story-agent-harness-01-harness');
  assert.equal(explicitTasks[0].title, 'Harness診断パッケージ');
  assert.equal(explicitTasks[0].priority, 'medium');
  assert.equal(explicitTasks[0].acceptance.some((item) => item.includes('agent-harness')), true);
  assert.equal(explicitTasks[1].id, 'story-agent-harness-02-harness-status');
  assert.equal(explicitTasks[1].implementation_steps.length, 2);
});

test('story plan requires architecture and spec tasks for design-first stories', async () => {
  const repo = await makeRepo();
  await runCli([
    'init',
    repo,
    '--story-id',
    'story-vibepro-architecture-aware-story-derive',
    '--title',
    '非WebリポジトリへWeb/SaaSストーリーを誤生成しない',
    '--view',
    'dev'
  ]);
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-vibepro-architecture-aware-story-derive.md'), `---
story_id: story-vibepro-architecture-aware-story-derive
title: 非WebリポジトリへWeb/SaaSストーリーを誤生成しない
view: dev
category: architecture
source:
  type: github_issue
  id: "#46"
---

# 非WebリポジトリへWeb/SaaSストーリーを誤生成しない

## 受け入れ基準

- [ ] story derive は repo profile を判定してから preset applicability を決める
- [ ] Python CLI repoでは auth/CMS/notification のWeb/SaaS Storyを生成しない
- [ ] 明示 preset では従来互換を保つ
`);

  await runCli(['story', 'derive', repo]);
  const planResult = await runCli(['story', 'plan', repo, '--limit', '10']);

  assert.equal(planResult.exitCode, 0);
  const plan = await readJson(path.join(repo, '.vibepro', 'stories', 'story-plan.json'));
  const tasks = plan.task_candidates.filter((task) => task.story_id === 'story-vibepro-architecture-aware-story-derive');
  assert.equal(tasks.some((task) => task.id === 'story-vibepro-architecture-aware-story-derive-spec-recovery'), true);
  assert.equal(tasks.some((task) => task.id === 'story-vibepro-architecture-aware-story-derive-architecture-recovery'), true);
  const row = plan.source_recovery_map.missing.find((item) => item.story_id === 'story-vibepro-architecture-aware-story-derive');
  assert.equal(row.spec.status, 'needs_recovery');
  assert.equal(row.architecture.status, 'needs_decision');
});

test('story plan treats linked architecture and spec as source consistency for design-first stories', async () => {
  const repo = await makeRepo();
  await runCli([
    'init',
    repo,
    '--story-id',
    'story-vibepro-architecture-aware-story-derive',
    '--title',
    '非WebリポジトリへWeb/SaaSストーリーを誤生成しない',
    '--view',
    'dev'
  ]);
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-vibepro-architecture-aware-story-derive.md'), `---
story_id: story-vibepro-architecture-aware-story-derive
title: 非WebリポジトリへWeb/SaaSストーリーを誤生成しない
view: dev
category: architecture
source:
  type: github_issue
  id: "#46"
architecture_docs:
  - ../../architecture/vibepro-architecture-aware-story-derive.md
spec_docs:
  - ../../specs/vibepro-architecture-aware-story-derive.md
---

# 非WebリポジトリへWeb/SaaSストーリーを誤生成しない

## 受け入れ基準

- [ ] story derive は repo profile を判定してから preset applicability を決める
- [ ] Python CLI repoでは auth/CMS/notification のWeb/SaaS Storyを生成しない
- [ ] 明示 preset では従来互換を保つ
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'vibepro-architecture-aware-story-derive.md'), `---
story_id: story-vibepro-architecture-aware-story-derive
---

# Architecture-Aware Story Derive

Repo profile, preset applicability, Story promotion, and source recovery evidence are separate boundaries.
`);
  await writeFile(path.join(repo, 'docs', 'specs', 'vibepro-architecture-aware-story-derive.md'), `---
story_id: story-vibepro-architecture-aware-story-derive
---

# Architecture-Aware Story Derive Spec

- INV-ASD-1: story derive must classify repo profile before promoting product surface Stories.
- INV-ASD-7: source recovery hints do not satisfy design-first source consistency without explicit links.
`);

  await runCli(['story', 'derive', repo]);
  const planResult = await runCli(['story', 'plan', repo, '--limit', '10']);

  assert.equal(planResult.exitCode, 0);
  const plan = await readJson(path.join(repo, '.vibepro', 'stories', 'story-plan.json'));
  const tasks = plan.task_candidates.filter((task) => task.story_id === 'story-vibepro-architecture-aware-story-derive');
  assert.equal(tasks.some((task) => task.id === 'story-vibepro-architecture-aware-story-derive-spec-recovery'), false);
  assert.equal(tasks.some((task) => task.id === 'story-vibepro-architecture-aware-story-derive-architecture-recovery'), false);
  const row = plan.source_recovery_map.rows.find((item) => item.story_id === 'story-vibepro-architecture-aware-story-derive');
  assert.equal(row.spec.status, 'present');
  assert.equal(row.architecture.status, 'present');
});

test('story plan creates architecture recovery tasks for boundary code without ADR', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'auth', 'session'), { recursive: true });
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'auth', 'session', 'route.ts'), 'export function GET() { return Response.json({ ok: true }); }\n');
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'session-route', source_file: 'src/app/api/auth/session/route.ts', community: 'auth-api' },
      { id: 'session-helper', source_file: 'src/lib/auth/session.ts', community: 'auth-api' }
    ],
    edges: [
      { source: 'session-route', target: 'session-helper' }
    ]
  }));
  await runCli(['story', 'derive', repo]);

  let json = '';
  const result = await runCli(['story', 'plan', repo, '--limit', '8', '--json'], {
    stdout: { write: (text) => { json += text; } }
  });

  assert.equal(result.exitCode, 0);
  const plan = JSON.parse(json);
  assert.equal(plan.task_candidates.some((task) => task.id.endsWith('architecture-recovery')), true);
  const task = plan.task_candidates.find((item) => item.id.endsWith('architecture-recovery'));
  assert.equal(task.source_recovery.sources.architecture.status, 'needs_decision');
  const mapRow = plan.source_recovery_map.missing.find((row) => row.story_id === task.story_id);
  assert.equal(mapRow.architecture.suggested_path.startsWith('docs/architecture/ADR-'), true);
  assert.equal(mapRow.architecture.suggested_task_id.endsWith('-architecture-recovery'), true);
  assert.equal(mapRow.graph.matched_file_count > 0, true);
  assert.equal(task.graph_context.matched_node_count > 0, true);
  assert.equal(task.recovery_drafts.some((draft) => draft.kind === 'architecture'), true);
  assert.equal(task.recovery_drafts[0].suggested_path.startsWith('docs/architecture/ADR-'), true);
  assert.equal(task.recovery_drafts[0].graph_evidence.matched_files.includes('src/lib/auth/session.ts'), true);
});

test('story derive creates stories for code surfaces that have no spec documents', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'app', '(app)', 'settings'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'auth', 'session'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'components', 'auth'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', '(public)', 'articles'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'article'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'health'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', '(app)', 'manager'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', '(app)', 'settings', 'page.tsx'), 'export default function Page() { return null; }\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'auth', 'session', 'route.ts'), 'export function GET() { return Response.json({ ok: true }); }\n');
  await writeFile(path.join(repo, 'src', 'components', 'auth', 'LoginForm.tsx'), 'export function LoginForm() { return null; }\n');
  await writeFile(path.join(repo, 'src', 'app', '(public)', 'articles', 'page.tsx'), 'export default function Page() { return null; }\n');
  await writeFile(path.join(repo, 'src', 'lib', 'article', 'client.ts'), 'export function listArticles() { return []; }\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'health', 'route.ts'), 'export function GET() {}\n');
  await writeFile(path.join(repo, 'src', 'app', '(app)', 'manager', 'page.tsx'), 'export default function Page() { return null; }\n');
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'login_form_file', source_file: 'src/components/auth/LoginForm.tsx', label: 'LoginForm.tsx' },
      { id: 'session_route_file', source_file: 'src/app/api/auth/session/route.ts', label: 'route.ts' },
      { id: 'article_page_file', source_file: 'src/app/(public)/articles/page.tsx', label: 'page.tsx' },
      { id: 'manager_page_file', source_file: 'src/app/(app)/manager/page.tsx', label: 'page.tsx' },
      { id: 'settings_page_file', source_file: 'src/app/(app)/settings/page.tsx', label: 'page.tsx' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);

  assert.equal(result.exitCode, 0);
  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const authStory = catalog.stories.find((story) => story.story_id === 'story-product-auth-account-access');
  const cmsStory = catalog.stories.find((story) => story.story_id === 'story-product-content-cms');
  const opsStory = catalog.stories.find((story) => story.story_id === 'story-ops-observability-health');

  assert.equal(Boolean(authStory), true);
  assert.equal(authStory.source.type, 'story_cluster');
  assert.equal(authStory.source.paths.includes('src/components/auth/LoginForm.tsx'), true);
  assert.match(authStory.derived.story_definition.problem, /認証/);
  assert.equal(authStory.derived.meaning.user_actor.confidence, 'low');
  assert.equal(authStory.derived.meaning.evidence_by_type.code_evidence.includes('src/components/auth/LoginForm.tsx'), true);
  assert.equal(Boolean(cmsStory), true);
  assert.equal(cmsStory.source.paths.includes('src/app/(public)/articles/page.tsx'), true);
  assert.match(cmsStory.derived.story_definition.business_value, /SEO流入/);
  assert.equal(Boolean(opsStory), true);
  assert.equal(opsStory.source.type, 'code_surface');
  assert.equal(opsStory.source.paths.includes('src/app/api/health/route.ts'), true);
  assert.equal(opsStory.derived.open_questions.some((item) => item.field === 'missing_spec'), true);
  assert.equal(catalog.coverage.status, 'warn');
  assert.equal(catalog.coverage.uncovered.some((item) => item.path === 'src/app/(app)/manager/page.tsx'), true);
  assert.equal(catalog.coverage.uncovered.some((item) => item.path === 'src/app/(app)/settings/page.tsx'), true);
  assert.equal(catalog.coverage.uncovered.some((item) => item.path === 'src/components/auth/LoginForm.tsx'), false);

  const map = await readFile(path.join(repo, '.vibepro', 'stories', 'story-map.md'), 'utf8');
  assert.match(map, /認証とアカウント利用開始を成立させる/);
  assert.match(map, /付録: Graph Coverage/);
  assert.match(map, /src\/app\/\(app\)\/settings\/page\.tsx/);
  assert.match(map, /コード上は機能面が確認できるが、対応するStory、要求、仕様書が見つからない/);
});

test('story derive links local management story docs to code surface stories', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'auth', 'session'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'components', 'auth'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-product-auth-account-access.md'), `---
story_id: story-product-auth-account-access
title: 認証とアカウント利用開始を成立させる
status: active
view: business
horizon: month
period: 2026Q2
---

# 認証とアカウント利用開始を成立させる

サービスを継続利用したいユーザーが、安全にログインしてアカウント状態を保てるようにする。

## 誰のため

サービスを継続利用したい登録ユーザー。

## 課題

認証状態やアカウント操作が不安定だと、ユーザーは利用を再開できず継続前に離脱する。

## 望む変化

ログイン、セッション継続、アカウント操作へ迷わず進める。

## 成果

アカウント状態が継続利用の中心になる。

## 事業価値

継続率とログイン完了率の改善につながる。

## 受け入れ基準

- ログイン後のセッションが維持される
- アカウント操作の失敗時の扱いが決まる
`);
  await writeFile(path.join(repo, 'src', 'app', 'api', 'auth', 'session', 'route.ts'), 'export function GET() { return Response.json({ ok: true }); }\n');
  await writeFile(path.join(repo, 'src', 'components', 'auth', 'LoginForm.tsx'), 'export function LoginForm() { return null; }\n');

  const result = await runCli(['story', 'derive', repo]);

  assert.equal(result.exitCode, 0);
  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const story = catalog.stories.find((item) => item.story_id === 'story-product-auth-account-access');

  assert.equal(Boolean(story), true);
  assert.equal(story.source.paths.includes('docs/management/stories/active/story-product-auth-account-access.md'), true);
  assert.equal(story.view, 'business');
  assert.equal(story.horizon, 'month');
  assert.equal(story.period, '2026Q2');
  assert.equal(story.derived.open_questions.some((item) => item.field === 'missing_spec'), false);
  assert.equal(story.derived.meaning.evidence_by_type.docs_evidence.includes('docs/management/stories/active/story-product-auth-account-access.md'), true);
  assert.equal(story.derived.meaning.user_actor.confidence, 'high');
  assert.equal(story.derived.story_definition.who, 'サービスを継続利用したい登録ユーザー。');
  assert.match(story.derived.story_definition.problem, /継続前に離脱/);
  assert.match(story.derived.story_definition.want, /迷わず進める/);
  assert.match(story.derived.story_definition.outcome, /継続利用の中心/);
  assert.match(story.derived.story_definition.business_value, /ログイン完了率/);
  assert.equal(story.derived.story_definition.acceptance_focus.includes('アカウント操作の失敗時の扱いが決まる'), true);
  assert.equal(story.derived.story_definition.source_synthesis.some((item) => item.path === 'docs/management/stories/active/story-product-auth-account-access.md'), true);
});

test('story derive links story_id frontmatter specs and architecture docs to stories', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'auth', 'session'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'components', 'auth'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'specs', 'product-auth-account-access.md'), `---
story_id: story-product-auth-account-access
title: 認証Spec
status: recovered
---

# 認証Spec

## 受け入れ基準

- ログイン後のセッションが維持される
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'ADR-product-auth-account-access.md'), `---
story_id: story-product-auth-account-access
title: 認証ADR
status: accepted
---

# ADR: 認証
`);
  await writeFile(path.join(repo, 'src', 'app', 'api', 'auth', 'session', 'route.ts'), 'export function GET() { return Response.json({ ok: true }); }\n');
  await writeFile(path.join(repo, 'src', 'components', 'auth', 'LoginForm.tsx'), 'export function LoginForm() { return null; }\n');

  await runCli(['story', 'derive', repo]);
  await runCli(['story', 'plan', repo, '--limit', '5']);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const story = catalog.stories.find((item) => item.story_id === 'story-product-auth-account-access');
  assert.equal(story.derived.meaning.evidence_by_type.docs_evidence.includes('docs/specs/product-auth-account-access.md'), true);
  assert.equal(story.derived.meaning.evidence_by_type.docs_evidence.includes('docs/architecture/ADR-product-auth-account-access.md'), true);
  assert.equal(story.derived.open_questions.some((item) => item.field === 'missing_spec'), false);
  assert.equal(story.derived.story_definition.source_synthesis.some((item) => item.path === 'docs/specs/product-auth-account-access.md'), true);
  const plan = await readJson(path.join(repo, '.vibepro', 'stories', 'story-plan.json'));
  const row = plan.source_recovery_map.rows.find((item) => item.story_id === 'story-product-auth-account-access');
  assert.equal(row.spec.status, 'present');
  assert.equal(row.architecture.status, 'present');
});

test('story derive does not emit domain-specific next-app stories from generic auth code', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'components', 'auth'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'components', 'auth', 'LoginForm.tsx'), 'export function LoginForm() { return null; }\n');

  const result = await runCli(['story', 'derive', repo]);

  assert.equal(result.exitCode, 0);
  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.stories.some((story) => story.story_id === 'story-product-auth-account-access'), true);
  assert.doesNotMatch(JSON.stringify(catalog), /ExampleTravel|ホテル|旅行|hotel|shadow-call/i);
});

test('story coverage keeps all uncovered graph files in the catalog', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'app', '(app)', 'unmapped'), { recursive: true });
  const nodes = [];
  for (let index = 0; index < 55; index += 1) {
    await mkdir(path.join(repo, 'src', 'app', '(app)', 'unmapped', String(index)), { recursive: true });
    const filePath = `src/app/(app)/unmapped/${index}/page.tsx`;
    await writeFile(path.join(repo, filePath), 'export default function Page() { return null; }\n');
    nodes.push({ id: `unmapped_${index}`, source_file: filePath, label: 'page.tsx' });
  }
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({ nodes, links: [] }));

  const result = await runCli(['story', 'derive', repo]);

  assert.equal(result.exitCode, 0);
  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.coverage.totals.uncovered_files, 55);
  assert.equal(catalog.coverage.uncovered.length, 55);
});

test('story derive does not overwrite existing story ids', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-product-auth-account-access', '--title', '既存の認証Story']);
  await mkdir(path.join(repo, 'docs', 'user_stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'user_stories', 'active', 'US-001_login_session.md'), '# 新しいタイトル\n');

  const result = await runCli(['story', 'derive', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.skipped_count >= 1, true);
  const config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(config.brainbase.stories.find((story) => story.story_id === 'story-product-auth-account-access').title, '既存の認証Story');
});

test('story derive archives obsolete document-index stories from previous derive runs', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-product-api-specification', '--title', 'API 仕様書']);
  await runCli(['story', 'add', repo, '--id', 'story-product-us-001-login-session', '--title', 'US-001: ログイン状態維持']);
  await mkdir(path.join(repo, '.vibepro', 'stories'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'), JSON.stringify({
    stories: [
      { story_id: 'story-product-api-specification', title: 'API 仕様書' },
      { story_id: 'story-product-us-001-login-session', title: 'US-001: ログイン状態維持' }
    ]
  }));
  await mkdir(path.join(repo, 'docs', 'features'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'features', 'auth-session-system.md'), '# 認証セッション仕様書\n');

  const result = await runCli(['story', 'derive', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.archived_count, 2);
  const config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(config.brainbase.stories.find((story) => story.story_id === 'story-product-api-specification').status, 'archived');
  assert.equal(config.brainbase.stories.find((story) => story.story_id === 'story-product-us-001-login-session').status, 'archived');
  assert.equal(config.brainbase.stories.some((story) => story.story_id === 'story-product-auth-account-access' && story.status === 'active'), true);
});

test('brainbase import uses selected local story and excludes archived stories', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-active-local', '--title', 'Active Local', '--view', 'dev']);
  await runCli(['story', 'add', repo, '--id', 'story-archived-local', '--title', 'Archived Local', '--view', 'dev']);
  await runCli(['story', 'select', repo, '--id', 'story-active-local']);
  await runCli(['story', 'archive', repo, '--id', 'story-archived-local']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T235900Z']);

  const result = await runCli(['brainbase', repo]);

  assert.equal(result.exitCode, 0);
  const importState = await readJson(path.join(repo, '.vibepro', 'brainbase', 'import-state.json'));
  assert.equal(importState.story.story_id, 'story-active-local');
  assert.equal(importState.story.ssot, 'local');
  assert.equal(importState.stories.some((story) => story.story_id === 'story-archived-local'), false);
});





















test('review prepare generates stage role requests', async () => {
  const repo = await makeGitRepoWithStory();

  const result = await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'test_plan', '--language', 'en', '--json']);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.result.plan.roles, ['unit_integration', 'e2e_ux', 'gate_coverage']);
  assert.equal(result.result.plan.parallel_dispatch.mode, 'policy_aware_parallel_reviews');
  assert.equal(result.result.plan.parallel_dispatch.subagent_count, 3);
  assert.equal(result.result.plan.mandatory_review_lenses.some((lens) => lens.id === 'regression_guard'), true);
  assert.equal(result.result.plan.parallel_dispatch.coordinator_behavior.expected, 'dispatch_parallel_subagents');
  assert.equal(result.result.plan.parallel_dispatch.coordinator_behavior.user_confirmation_required_by_vibepro, false);
  assert.equal(result.result.plan.parallel_dispatch.coordinator_behavior.runner_policy_may_require_user_delegation, false);
  assert.match(result.result.plan.parallel_dispatch.coordinator_behavior.fallback, /manual_review does not satisfy/);
  assert.equal(result.result.plan.agent_skill_discipline.required, true);
  assert.equal(result.result.plan.agent_skill_discipline.common_rationalizations.includes('tests_pass_so_review_done'), true);
  assert.match(result.result.plan.parallel_dispatch.record_commands.e2e_ux, /vibepro review record .*--role e2e_ux/);
  assert.match(result.result.plan.parallel_dispatch.record_commands.e2e_ux, /--agent-system "<codex\|claude_code>"/);
  assert.match(result.result.plan.parallel_dispatch.record_commands.e2e_ux, /--execution-mode parallel_subagent/);
  assert.match(result.result.plan.parallel_dispatch.record_commands.e2e_ux, /--agent-closed/);
  assert.doesNotMatch(result.result.plan.parallel_dispatch.record_commands.e2e_ux, /manual_review/);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'test_plan', 'review-plan.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'test_plan', 'parallel-dispatch.md')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'test_plan', 'permission-request.md')), false);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'test_plan', 'review-request-e2e_ux.md')), true);
  const dispatch = await readFile(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'test_plan', 'parallel-dispatch.md'), 'utf8');
  assert.match(dispatch, /User dirty:/);
  assert.match(dispatch, /Raw dirty:/);
  assert.match(dispatch, /User fingerprint excludes:/);
  assert.doesNotMatch(dispatch, /^- Dirty:/m);
  assert.match(dispatch, /If your coordinator runtime supports subagents/);
  assert.doesNotMatch(dispatch, /permission-request\.md/);
  assert.match(dispatch, /manual_review as satisfying required subagent review/);
  assert.match(dispatch, /Subagent 2: test_plan:e2e_ux/);
  assert.match(dispatch, /regression_guard/);
  assert.match(dispatch, /path_surface_coverage/);
  assert.match(dispatch, /Agent Skill Discipline/);
  assert.match(dispatch, /Common rationalizations to reject/);
  assert.match(dispatch, /Red flags to treat as findings/);
  assert.match(dispatch, /every mandatory review lens/);
  assert.match(dispatch, /vibepro review record .*--role e2e_ux/);
  assert.match(dispatch, /Required provenance/);
  assert.match(dispatch, /--agent-system codex --execution-mode parallel_subagent/);
  assert.match(dispatch, /--agent-system claude_code --execution-mode parallel_subagent/);
  assert.match(dispatch, /close\/shutdown that subagent/i);
  assert.match(dispatch, /--agent-closed/);
  const request = await readFile(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'test_plan', 'review-request-e2e_ux.md'), 'utf8');
  assert.match(request, /VibePro Agent Review Request/);
  assert.match(request, /Role: e2e_ux/);
  assert.match(request, /User dirty:/);
  assert.match(request, /Raw dirty:/);
  assert.match(request, /User fingerprint excludes:/);
  assert.doesNotMatch(request, /^- Dirty:/m);
  assert.match(request, /Mandatory Review Lenses/);
  assert.match(request, /regression_guard/);
  assert.match(request, /path_surface_coverage/);
  assert.match(request, /Agent Skill Discipline/);
  assert.match(request, /Required evidence shape/);
  assert.match(request, /pre-fix/);
  assert.match(request, /silent/);
  assert.match(request, /A `pass` must cover both the role focus and every mandatory review lens/);
  assert.match(request, /coordinator records it/);
  assert.match(request, /Codex coordinators must include/);
  assert.match(request, /Claude Code coordinators must include/);

	  const subset = await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'gate', '--role', 'gate_evidence', '--role', 'release_risk', '--language', 'en', '--json']);
	  assert.equal(subset.exitCode, 0);
	  assert.deepEqual(subset.result.plan.roles, ['gate_evidence', 'release_risk']);
	  assert.deepEqual(subset.result.plan.review_policy.roles, ['gate_evidence', 'release_risk']);
	  assert.deepEqual(subset.result.summary.roles.map((role) => role.role), ['gate_evidence', 'release_risk']);

  const network = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'preview',
    '--role',
    'network_runtime',
    '--status',
    'pass',
    '--summary',
    'network runtime passed',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'agent-network',
    '--agent-closed',
    '--json'
  ]);
  assert.equal(network.exitCode, 0);
  const usability = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'preview',
    '--role',
    'human_usability',
    '--status',
    'pass',
    '--summary',
    'human usability passed',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'agent-usability',
    '--agent-closed',
    '--json'
  ]);
  assert.equal(usability.exitCode, 0);
  const replacement = await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'preview', '--role', 'preview_smoke', '--language', 'en', '--json']);
  assert.equal(replacement.exitCode, 0);
  assert.deepEqual(replacement.result.plan.roles, ['preview_smoke']);
  assert.deepEqual(replacement.result.summary.roles.map((role) => role.role), ['preview_smoke']);
	});


test('user git fingerprint includes dirty VibePro config but ignores generated artifacts', async () => {
  const repo = await makeGitRepoWithStory();
  const clean = await collectGitStatusFingerprints(repo);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.test_policy_marker = true;
  await writeJson(configPath, config);
  const configDirty = await collectGitStatusFingerprints(repo);
  assert.equal(configDirty.user_dirty, true);
  assert.notEqual(configDirty.user_status_fingerprint_hash, clean.user_status_fingerprint_hash);

  await git(repo, ['restore', '.vibepro/config.json']);
  await writeJson(path.join(repo, '.vibepro', 'generated-only.json'), { generated: true });
  const artifactDirty = await collectGitStatusFingerprints(repo);
  assert.equal(artifactDirty.raw_dirty, undefined);
  assert.equal(artifactDirty.user_dirty, false);
  assert.equal(artifactDirty.user_status_fingerprint_hash, clean.user_status_fingerprint_hash);
});

test('review policy config customizes stage roles and role timeout', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.agent_reviews = {
    stages: {
      gate: {
        roles: ['gate_evidence', 'custom_security']
      }
    },
    roles: {
      custom_security: {
        timeout_ms: 12345
      }
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const prepared = await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'gate', '--json']);
  assert.equal(prepared.exitCode, 0);
  assert.deepEqual(prepared.result.plan.roles, ['gate_evidence', 'custom_security']);
  assert.equal(prepared.result.plan.parallel_dispatch.subagent_count, 2);
  const request = await readFile(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'gate', 'review-request-custom_security.md'), 'utf8');
  assert.match(request, /--role custom_security/);

  const record = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'custom_security',
    '--status',
    'pass',
    '--summary',
    'custom security passed',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'agent-custom-security',
    '--agent-closed',
    '--json'
  ]);
  assert.equal(record.exitCode, 0);
  assert.equal(record.result.review.role, 'custom_security');
});

test('review policy config publishes role model policy and records actual model provenance', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.agent_reviews = {
    defaults: {
      model_policy: {
        model: 'gpt-5.5',
        reasoning_effort: 'medium',
        cost_tier: 'medium'
      }
    },
    roles: {
      gate_evidence: {
        model_policy: {
          reasoning_effort: 'high',
          cost_tier: 'high'
        }
      }
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const prepared = await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'gate', '--json']);

  assert.equal(prepared.exitCode, 0);
  assert.deepEqual(prepared.result.plan.review_policy.defaults.model_policy, {
    model: 'gpt-5.5',
    reasoning_effort: 'medium',
    cost_tier: 'medium'
  });
  assert.deepEqual(prepared.result.plan.review_policy.role_policies.gate_evidence.model_policy, {
    model: 'gpt-5.5',
    reasoning_effort: 'high',
    cost_tier: 'high'
  });
  assert.deepEqual(prepared.result.plan.requests.find((request) => request.role === 'gate_evidence').model_policy, {
    model: 'gpt-5.5',
    reasoning_effort: 'high',
    cost_tier: 'high'
  });
  const dispatch = await readFile(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'gate', 'parallel-dispatch.md'), 'utf8');
  assert.match(dispatch, /Model policy:/);
  assert.match(dispatch, /model: gpt-5\.5/);
  assert.match(dispatch, /reasoning_effort: high/);
  assert.match(dispatch, /cost_tier: high/);
  assert.match(dispatch, /--agent-reasoning-effort "<reasoning-effort>"/);
  const request = await readFile(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'gate', 'review-request-gate_evidence.md'), 'utf8');
  assert.match(request, /## Model Policy/);
  assert.match(request, /reasoning_effort: high/);

  const record = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    'pass',
    '--summary',
    'gate evidence passed',
    '--inspection-summary',
    'read generated request and model policy guidance',
    '--inspection-input',
    '.vibepro/reviews/story-pr-prepare/gate/review-request-gate_evidence.md',
    '--judgment-delta',
    'model policy concern -> pass because actual provenance matches configured policy',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'agent-gate-evidence',
    '--agent-thread-id',
    'thread-agent-gate-evidence',
    '--agent-model',
    'gpt-5.5',
    '--agent-reasoning-effort',
    'high',
    '--agent-cost-tier',
    'high',
    '--agent-closed',
    '--json'
  ]);
  assert.equal(record.exitCode, 0);
  assert.equal(record.result.review.agent_provenance.model, 'gpt-5.5');
  assert.equal(record.result.review.agent_provenance.reasoning_effort, 'high');
  assert.equal(record.result.review.agent_provenance.cost_tier, 'high');
});

test('SRA-CON-1 review record captures finding disposition and agent usage for subagent ROI audit', async () => {
  const repo = await makeGitRepoWithStory();
  await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--role', 'runtime_contract']);

  const record = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--status',
    'needs_changes',
    '--summary',
    'runtime contract gap needs a follow-up commit',
    '--finding',
    'high:runtime-contract-gap:subagent found a runtime contract gap',
    '--finding-disposition',
    'runtime-contract-gap:accepted:confirmed by focused inspection',
    '--resolved-finding',
    'runtime-contract-gap:commit abc1234',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-runtime-roi',
    '--agent-thread-id',
    'thread-codex-runtime-roi',
    '--agent-input-tokens',
    '1200',
    '--agent-output-tokens',
    '345',
    '--agent-cost-usd',
    '0.123456',
    '--agent-closed',
    '--json'
  ]);

  assert.equal(record.exitCode, 0);
  assert.deepEqual(record.result.review.finding_dispositions, [{
    finding_id: 'runtime-contract-gap',
    disposition: 'accepted',
    resolved_by: ['commit abc1234'],
    reason: 'confirmed by focused inspection',
    inferred_from_resolution: false
  }]);
  assert.deepEqual(record.result.review.agent_usage, {
    input_tokens: 1200,
    output_tokens: 345,
    total_tokens: 1545,
    cost_usd: 0.123456
  });

  const summary = await readJson(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'implementation', 'review-summary.json'));
  const role = summary.roles.find((item) => item.role === 'runtime_contract');
  assert.equal(role.findings[0].id, 'runtime-contract-gap');
  assert.equal(role.finding_dispositions[0].disposition, 'accepted');
  assert.equal(role.agent_usage.total_tokens, 1545);
});






test('review status keeps pr prepare current when dispatch artifact predates pr prepare', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'review-artifact-current.js'), 'export const value = 1;\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add current review artifact target']);

  const reviewPrepare = await runCli([
    'review',
    'prepare',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence'
  ]);
  assert.equal(reviewPrepare.exitCode, 0);
  await new Promise((resolve) => setTimeout(resolve, 5));

  const prepare = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(prepare.exitCode, 0);

  const status = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'gate', '--json']);
  assert.equal(status.exitCode, 0);
  assert.equal(status.result.pr_prepare_freshness.status, 'current');
  assert.equal(status.result.pr_prepare_freshness.newest_review_artifact, null);
  assert.match(status.result.pr_prepare_freshness.reason, /matches the current git HEAD/);
});

test('review record updates status summary and marks stale after source change', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'agent-review-target.js'), 'export const value = 1;\n');

  await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'implementation']);
  const recordResult = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--status',
    'pass',
    '--summary',
    'runtime contract reviewed',
    '--inspection-input',
    'src/agent-review-target.js',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-runtime-contract-agent',
    '--agent-thread-id',
    'thread-runtime-contract',
    '--agent-model',
    'gpt-5.5',
    '--agent-closed',
    '--finding',
    'low:note:no blocking issue'
  ]);
  assert.equal(recordResult.exitCode, 0);
  const before = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  assert.equal(before.exitCode, 0);
  const roleBefore = before.result.stages[0].roles.find((role) => role.role === 'runtime_contract');
  assert.equal(roleBefore.effective_status, 'pass');

  await writeFile(path.join(repo, 'src', 'agent-review-target.js'), 'export const value = 2;\n');
  const after = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  const roleAfter = after.result.stages[0].roles.find((role) => role.role === 'runtime_contract');
  assert.equal(roleAfter.effective_status, 'stale');
  assert.match(roleAfter.stale_reason, /content-bound evidence surface/i);
});


test('review status keeps strict-head review stale after docs-only commit', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'strict-head-review-target.js'), 'export const value = 1;\n');
  await git(repo, ['add', 'src/strict-head-review-target.js']);
  await git(repo, ['commit', '-m', 'feat: add strict head review target']);

  // story-vibepro-strict-head-binding-origin-guard: declare the role policy
  // explicitly instead of relying on the removed arbitrary CLI override.
  await grantStrictHeadRolePolicy(repo, 'runtime_contract', 'this regression fixture intentionally reviews the complete git head');
  await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'implementation']);
  const recordResult = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--status',
    'pass',
    '--summary',
    'strict head runtime contract reviewed before docs-only commit',
    '--inspection-summary',
    'inspected runtime source with strict head binding',
    '--inspection-input',
    'src/strict-head-review-target.js',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-strict-head-review-agent',
    '--agent-thread-id',
    'thread-strict-head-review-agent',
    '--agent-model',
    'gpt-5.5',
    '--agent-reasoning-effort',
    'low',
    '--agent-cost-tier',
    'medium',
    '--strict-head-binding',
    '--strict-head-reason',
    'this regression fixture intentionally reviews the complete git head',
    '--agent-closed'
  ]);
  assert.equal(recordResult.exitCode, 0, JSON.stringify(recordResult));
  const recordedHead = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();

  await writeFile(path.join(repo, 'docs', 'strict-head-review-note.md'), 'docs-only change after strict head review\n');
  await git(repo, ['add', 'docs/strict-head-review-note.md']);
  await git(repo, ['commit', '-m', 'docs: advance strict head review']);
  const currentHead = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();

  const status = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  assert.equal(status.exitCode, 0);
  const role = status.result.stages[0].roles.find((item) => item.role === 'runtime_contract');
  assert.equal(role.effective_status, 'stale');
  assert.equal(role.binding_status, 'stale');
  assert.equal(role.merge_delta_reuse, null);
  assert.equal(role.content_binding.mode, 'strict_head');
  assert.equal(role.content_binding.recorded_head_sha, recordedHead);
  assert.equal(role.content_binding.current_head_sha, currentHead);
  assert.match(role.stale_reason, /strict HEAD review was recorded for/);
});

test('review status keeps stale review after merge delta touches inspected inputs', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'merge-delta-touch-target.js'), 'export const value = 1;\n');
  await git(repo, ['add', 'src/merge-delta-touch-target.js']);
  await git(repo, ['commit', '-m', 'feat: add reviewed touch target']);

  await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'implementation']);
  const recordResult = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--status',
    'pass',
    '--summary',
    'runtime contract reviewed before touched merge delta',
    '--inspection-summary',
    'inspected runtime source before merge delta',
    '--inspection-input',
    'src/merge-delta-touch-target.js',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-merge-delta-touch-agent',
    '--agent-thread-id',
    'thread-merge-delta-touch-agent',
    '--agent-model',
    'gpt-5.5',
    '--agent-reasoning-effort',
    'low',
    '--agent-cost-tier',
    'medium',
    '--judgment-delta',
    'recorded head review -> stale if merge delta touches inspected source',
    '--agent-closed'
  ]);
  assert.equal(recordResult.exitCode, 0, JSON.stringify(recordResult));

  await writeFile(path.join(repo, 'src', 'merge-delta-touch-target.js'), 'export const value = 2;\n');
  await git(repo, ['add', 'src/merge-delta-touch-target.js']);
  await git(repo, ['commit', '-m', 'chore: sync touched reviewed source']);

  const status = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  assert.equal(status.exitCode, 0);
  const role = status.result.stages[0].roles.find((item) => item.role === 'runtime_contract');
  assert.equal(role.effective_status, 'stale');
  assert.equal(role.binding_status, 'stale');
  assert.match(role.stale_reason, /content-bound evidence surface changed/);
  assert.deepEqual(role.content_binding.changed_files, ['src/merge-delta-touch-target.js']);
});

test('review record rejects pass without inspected file inputs', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'merge-delta-no-input.js'), 'export const value = 1;\n');
  await git(repo, ['add', 'src/merge-delta-no-input.js']);
  await git(repo, ['commit', '-m', 'feat: add no-input review target']);

  await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'implementation']);
  let recordStderr = '';
  const recordResult = await coreRunCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--status',
    'pass',
    '--summary',
    'runtime contract reviewed without file inputs',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-merge-delta-no-input-agent',
    '--agent-thread-id',
    'thread-merge-delta-no-input-agent',
    '--agent-model',
    'gpt-5.5',
    '--agent-reasoning-effort',
    'low',
    '--agent-cost-tier',
    'medium',
    '--agent-closed'
  ], {
    stderr: { write: (chunk) => { recordStderr += chunk; } }
  });
  assert.equal(recordResult.exitCode, 1, JSON.stringify(recordResult));
  assert.match(recordStderr, /requires --inspection-summary/);
});

test('review status keeps stale review when merge delta diff cannot be resolved', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'merge-delta-missing-head.js'), 'export const value = 1;\n');
  await git(repo, ['add', 'src/merge-delta-missing-head.js']);
  await git(repo, ['commit', '-m', 'feat: add missing head target']);

  // story-vibepro-strict-head-binding-origin-guard: declare the role policy
  // explicitly instead of relying on the removed arbitrary CLI override.
  await grantStrictHeadRolePolicy(repo, 'runtime_contract', 'this missing-head fixture requires strict historical head comparison');
  await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'implementation']);
  const recordResult = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--status',
    'pass',
    '--summary',
    'runtime contract reviewed before missing-head merge delta',
    '--inspection-summary',
    'inspected runtime source before merge delta',
    '--inspection-input',
    'src/merge-delta-missing-head.js',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-merge-delta-missing-head-agent',
    '--agent-thread-id',
    'thread-merge-delta-missing-head-agent',
    '--agent-model',
    'gpt-5.5',
    '--agent-reasoning-effort',
    'low',
    '--agent-cost-tier',
    'medium',
    '--strict-head-binding',
    '--strict-head-reason',
    'this missing-head fixture requires strict historical head comparison',
    '--agent-closed'
  ]);
  assert.equal(recordResult.exitCode, 0, JSON.stringify(recordResult));

  const reviewPath = path.join(
    repo,
    '.vibepro',
    'reviews',
    'story-pr-prepare',
    'implementation',
    'review-result-runtime_contract.json'
  );
  const reviewResult = await readJson(reviewPath);
  const missingHead = 'f'.repeat(40);
  reviewResult.git_context.head_sha = missingHead;
  delete reviewResult.content_binding;
  await writeJson(reviewPath, reviewResult);

  await writeFile(path.join(repo, 'docs', 'base-sync-missing-head.md'), 'unrelated base sync note\n');
  await git(repo, ['add', 'docs/base-sync-missing-head.md']);
  await git(repo, ['commit', '-m', 'chore: sync docs after missing head']);

  const status = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  assert.equal(status.exitCode, 0);
  const role = status.result.stages[0].roles.find((item) => item.role === 'runtime_contract');
  assert.equal(role.effective_status, 'stale');
  assert.equal(role.binding_status, 'stale');
  assert.match(role.stale_reason, /could not be resolved/);
  assert.equal(role.merge_delta_reuse.recorded_head_sha, missingHead);
  assert.equal(role.merge_delta_reuse.diff_status, 'unresolved');
  assert.equal(role.merge_delta_reuse.merge_delta_changed_files, null);
});

test('agent review PR section shows merge delta binding reasons', () => {
  const section = renderAgentReviewPrSection({
    status: 'passed',
    summary: {
      required_review_count: 1,
      unmet_required_review_count: 0,
      checkpoint_required_review_count: 0,
      unmet_checkpoint_review_count: 0
    },
    stages: [
      {
        stage: 'implementation',
        status: 'passed',
        stale_count: 0,
        block_count: 0,
        roles: [
          {
            role: 'runtime_contract',
            effective_status: 'pass',
            binding_status: 'reused_merge_delta',
            stale_reason: 'review was reused because merge delta changed files outside inspected review inputs',
            merge_delta_reuse: {
              recorded_head_sha: 'a'.repeat(40),
              current_head_sha: 'b'.repeat(40),
              merge_delta_changed_files: ['docs/base-sync.md'],
              impacted_files: []
            }
          }
        ]
      }
    ]
  });

  assert.match(section, /### Review Binding/);
  assert.match(section, /implementation:runtime_contract binding=reused_merge_delta/);
  assert.match(section, /changed=1/);
  assert.match(section, /impacted=0/);
  assert.match(section, /reason=review was reused/);
});

test('review status keeps current review when only tracked VibePro manifest changes', async () => {
  const repo = await makeGitRepoWithStory();
  await git(repo, ['add', '-f', '.vibepro/vibepro-manifest.json']);
  await git(repo, ['commit', '-m', 'test: track vibepro manifest fixture']);

  await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'implementation']);
  const recordResult = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--status',
    'pass',
    '--summary',
    'runtime contract reviewed',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-runtime-contract-agent',
    '--agent-thread-id',
    'thread-runtime-contract',
    '--agent-model',
    'gpt-5.5',
    '--agent-closed'
  ]);
  assert.equal(recordResult.exitCode, 0);

  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.latest_internal_update_for_test = new Date().toISOString();
  await writeJson(manifestPath, manifest);

  const status = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  assert.equal(status.exitCode, 0);
  const role = status.result.stages[0].roles.find((item) => item.role === 'runtime_contract');
  assert.equal(role.effective_status, 'pass');
  assert.equal(role.stale, false);
});

test('review status keeps legacy full-fingerprint review stale when tracked VibePro manifest changes', async () => {
  const repo = await makeGitRepoWithStory();
  await git(repo, ['add', '-f', '.vibepro/vibepro-manifest.json']);
  await git(repo, ['commit', '-m', 'test: track legacy vibepro manifest fixture']);

  await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'implementation']);
  const recordResult = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--status',
    'pass',
    '--summary',
    'legacy runtime contract reviewed',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-legacy-runtime-contract-agent',
    '--agent-thread-id',
    'thread-legacy-runtime-contract',
    '--agent-model',
    'gpt-5.5',
    '--agent-closed'
  ]);
  assert.equal(recordResult.exitCode, 0);

  const resultPath = path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'implementation', 'review-result-runtime_contract.json');
  const review = await readJson(resultPath);
  delete review.content_binding;
  delete review.freshness_policy;
  delete review.git_context.user_status_fingerprint_hash;
  delete review.git_context.fingerprint_scope;
  await writeJson(resultPath, review);

  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.latest_internal_update_for_test = new Date().toISOString();
  await writeJson(manifestPath, manifest);

  const status = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  assert.equal(status.exitCode, 0);
  const role = status.result.stages[0].roles.find((item) => item.role === 'runtime_contract');
  assert.equal(role.effective_status, 'stale');
  assert.match(role.stale_reason, /dirty worktree fingerprint/);
});

test('review status keeps unchanged legacy source fingerprint current with tracked VibePro manifest dirt', async () => {
  const repo = await makeGitRepoWithStory();
  await git(repo, ['add', '-f', '.vibepro/vibepro-manifest.json']);
  await git(repo, ['commit', '-m', 'test: track source fingerprint manifest fixture']);

  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.latest_internal_update_for_test = 'legacy-source-fingerprint';
  await writeJson(manifestPath, manifest);

  await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'implementation']);
  const recordResult = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--status',
    'pass',
    '--summary',
    'legacy runtime contract reviewed with internal dirt',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-legacy-source-fingerprint-agent',
    '--agent-thread-id',
    'thread-legacy-source-fingerprint',
    '--agent-model',
    'gpt-5.5',
    '--agent-closed'
  ]);
  assert.equal(recordResult.exitCode, 0);

  const resultPath = path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'implementation', 'review-result-runtime_contract.json');
  const review = await readJson(resultPath);
  delete review.git_context.user_status_fingerprint_hash;
  delete review.git_context.fingerprint_scope;
  review.source_fingerprint = createHash('sha256').update(JSON.stringify({
    story_id: review.story_id,
    stage: review.stage,
    role: review.role,
    head_sha: review.git_context.head_sha,
    status_fingerprint_hash: review.git_context.status_fingerprint_hash
  })).digest('hex');
  await writeJson(resultPath, review);

  const status = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  assert.equal(status.exitCode, 0);
  const role = status.result.stages[0].roles.find((item) => item.role === 'runtime_contract');
  assert.equal(role.effective_status, 'pass');
  assert.equal(role.stale, false);
});


test('review summary lists next actions for missing prepared roles', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'agent-review-next-actions.js'), 'export const value = 1;\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add agent review next action target']);

  const prepare = await runCli([
    'review',
    'prepare',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'preview',
    '--role',
    'human_usability'
  ]);
  assert.equal(prepare.exitCode, 0);

  const reviewSummary = await readFile(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'preview', 'review-summary.md'), 'utf8');
  assert.doesNotMatch(reviewSummary, /## Next Actions\n\n- none/);
  assert.match(reviewSummary, /Run and record preview:human_usability/);
  assert.match(reviewSummary, /vibepro review record \. --id story-pr-prepare --stage preview --role human_usability/);
});
























test('verify record keeps verification evidence valid under concurrent writes', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-concurrent-record', '--title', 'Concurrent verification']);

  const results = await Promise.all([
    runCli([
      'verify', 'record', repo,
      '--id', 'story-concurrent-record',
      '--kind', 'unit',
      '--status', 'pass',
      '--command', 'npm test',
      '--summary', 'unit passed'
    ]),
    runCli([
      'verify', 'record', repo,
      '--id', 'story-concurrent-record',
      '--kind', 'integration',
      '--status', 'pass',
      '--command', 'npm run integration',
      '--summary', 'integration passed'
    ]),
    runCli([
      'verify', 'record', repo,
      '--id', 'story-concurrent-record',
      '--kind', 'e2e',
      '--status', 'pass',
      '--command', 'npm run test:e2e',
      '--summary', 'e2e passed'
    ])
  ]);

  assert.deepEqual(results.map((result) => result.exitCode), [0, 0, 0]);
  const evidence = await readJson(path.join(repo, '.vibepro', 'pr', 'story-concurrent-record', 'verification-evidence.json'));
  assert.equal(evidence.story_id, 'story-concurrent-record');
  assert.deepEqual(new Set(evidence.commands.map((command) => command.kind)), new Set(['unit', 'integration', 'e2e']));
});

test('verify record quarantines corrupt verification evidence instead of overwriting it', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-corrupt-record', '--title', 'Corrupt verification']);
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-corrupt-record');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'verification-evidence.json'), '{ "schema_version": "0.1.0" }\n{ "fragment": true');
  let stderrOutput = '';

  const result = await runCli([
    'verify', 'record', repo,
    '--id', 'story-corrupt-record',
    '--kind', 'unit',
    '--status', 'pass',
    '--command', 'npm test'
  ], {
    stderr: { write: (text) => { stderrOutput += text; } }
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderrOutput, /verification evidence JSON is corrupt/);
  await assert.rejects(stat(path.join(prDir, 'verification-evidence.json')), { code: 'ENOENT' });
  const backupFile = (await readdir(prDir)).find((file) => /^verification-evidence\.json\.corrupt-.+\.bak$/.test(file));
  assert.ok(backupFile);
  assert.match(await readFile(path.join(prDir, backupFile), 'utf8'), /\{ "fragment": true/);
});










test('pr prepare help does not run diagnostics or initialize the repository', async () => {
  const repo = await makeRepo();

  const result = await runCli(['pr', 'prepare', repo, '--help'], {
    stdout: { write: () => {} }
  });

  assert.equal(result.exitCode, 0);
  await assert.rejects(stat(path.join(repo, '.vibepro')), { code: 'ENOENT' });
});










async function writeTaskBoundPrFixtureState(repo) {
  const taskStatePath = path.join(repo, '.vibepro', 'stories', 'story-pr-prepare', 'tasks', 'tasks.json');
  await mkdir(path.dirname(taskStatePath), { recursive: true });
  const taskState = {
    schema_version: '0.1.0',
    story: {
      story_id: 'story-pr-prepare',
      title: 'PR準備'
    },
    source_run: {
      run_id: 'tar-cli-fixture',
      gate_status: 'pass'
    },
    tasks: [{
      id: 'TASK-001',
      title: 'Task-bound repo-control fixture',
      target_files: ['src/feature/pr-prepare.js'],
      target_groups: [],
      acceptance_criteria: ['Task-bound repo-control proof remains fail-closed']
    }]
  };
  await writeJson(taskStatePath, taskState);
  return { taskStatePath, taskState };
}










































async function makeRiskBearingDeployRepo() {
  const repo = await makeGitRepoWithStory();
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ dependencies: { next: '14', '@prisma/client': '5' } }));
  await writeFile(path.join(repo, 'vercel.json'), '{}');
  await writeFile(path.join(repo, 'fly.toml'), 'app="api"\nprimary_region="nrt"\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: deploy config']);
  await runCli(['env', 'graph', repo]); // derive Environment Graph so deploy targets exist
  for (const f of ['src/api/route.js', 'src/ui/page.jsx', 'src/workflow/state.js', 'src/deploy.js']) {
    await mkdir(path.join(repo, path.dirname(f)), { recursive: true });
    await writeFile(path.join(repo, f), 'export const x = 1;\n');
  }
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'feat: broad workflow change']);
  return repo;
}



async function makeSchedulerStoryRepo() {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 't@e.com']);
  await git(repo, ['config', 'user.name', 'T']);
  // "Recurring ... workflow" trips the scheduler shape detector while NOT
  // containing any keyword that would mark scheduling_owner/job_infrastructure
  // as covered, so both dimensions are genuinely missing.
  await runCli(['init', repo, '--story-id', 'story-pr-prepare', '--title', 'Recurring batch sync workflow', '--view', 'dev', '--period', '2026-W18']);
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: init']);
  await git(repo, ['switch', '-c', 'feature/x']);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'sync.js'), 'export const sync = 1;\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'feat: sync']);
  return repo;
}








test('story task generator groups admin API routes by domain', () => {
  const taskState = buildStoryTaskState({
    story: { story_id: 'story-admin-hardening', title: '管理API保護' },
    runId: '2026-04-30Tadmin-groups',
    gateStatus: 'block',
    evidence: {
      findings: [],
      action_candidates: [{
        id: 'VP-ACTION-API-001',
        finding_id: 'VP-API-001',
        title: '管理APIの保護境界を修正する',
        severity: 'High',
        execution_policy: 'proposal_only',
        mutates_repository: false,
        implementation_plan: {
          priority: 'high',
          read_first_files: [
            { file: 'src/app/api/admin/queue/status/route.ts', reason: 'queue status' },
            { file: 'src/app/api/admin/queue/obliterate/route.ts', reason: 'queue obliterate' },
            { file: 'src/app/api/admin/users/route.ts', reason: 'users' }
          ],
          acceptance_criteria: ['対象グループごとに保護根拠を確認できる'],
          pre_fix_briefing: {
            recommended_strategy: { id: 'route-level-auth', reason: 'middleware除外の影響を抑える' },
            target_routes: [
              {
                route_path: '/api/admin/queue/status',
                file: 'src/app/api/admin/queue/status/route.ts',
                methods: ['GET'],
                classification: 'admin'
              },
              {
                route_path: '/api/admin/queue/obliterate',
                file: 'src/app/api/admin/queue/obliterate/route.ts',
                methods: ['POST'],
                classification: 'admin'
              },
              {
                route_path: '/api/admin/users',
                file: 'src/app/api/admin/users/route.ts',
                methods: ['GET'],
                classification: 'admin'
              }
            ]
          }
        }
      }]
    }
  });

  const task = taskState.tasks[0];
  assert.equal(task.target_groups.length, 2);
  assert.deepEqual(task.target_groups.map((group) => group.id), ['queue', 'users']);
  assert.equal(task.target_groups.find((group) => group.id === 'queue').route_count, 2);
  assert.equal(task.target_groups.find((group) => group.id === 'users').route_count, 1);
  assert.equal(task.target_groups.find((group) => group.id === 'queue').read_first_files.length, 2);
});

test('local dev scanner detects heavy dev scripts and task generator taskifies performance findings', async () => {
  const repo = await makeRepo();
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    scripts: {
      dev: 'concurrently "next dev" "npm:worker" "npm:worker:generation" "npm:worker:email" "npm:worker:delivery-task"',
      'dev:web': 'next dev',
      worker: 'tsx src/workers/index.ts',
      'worker:generation': 'tsx src/workers/generation.ts',
      'worker:email': 'tsx src/workers/email.ts',
      'worker:delivery-task': 'tsx src/workers/delivery-task.ts'
    },
    dependencies: {
      next: '^15.0.0',
      react: '^19.0.0'
    }
  }, null, 2));

  const localDev = await scanLocalDev(repo);

  assert.equal(localDev.heavy_dev_scripts.length, 1);
  assert.equal(localDev.heavy_dev_scripts[0].script_name, 'dev');
  assert.equal(localDev.heavy_dev_scripts[0].has_next_dev, true);
  assert.equal(localDev.heavy_dev_scripts[0].worker_script_refs, 4);
  assert.equal(localDev.runtime_probe_plan.status, 'available');
  assert.equal(localDev.runtime_probe_plan.auto_run, false);
  assert.equal(localDev.runtime_probe_plan.commands.some((command) => command.id === 'web-dev-startup'), true);

  const taskState = buildStoryTaskState({
    story: { story_id: 'story-local-perf', title: 'ローカル性能を改善する' },
    runId: '2026-05-07Tlocal-perf',
    gateStatus: 'needs_review',
    evidence: {
      local_dev: localDev,
      database_access: {
        unbounded_find_many: [{
          file: 'src/app/api/projects/route.ts',
          gate_effect: 'review'
        }]
      },
      findings: [
        {
          id: 'VP-PERF-001',
          severity: 'Medium',
          category: 'パフォーマンス',
          title: 'ローカルdev起動が複数runtimeを同時起動している',
          recommendation: 'web-only dev scriptとworker起動scriptを分離する。'
        },
        {
          id: 'VP-DB-001',
          severity: 'Medium',
          category: 'パフォーマンス',
          title: '未ページングのDB一覧取得候補がある',
          recommendation: '一覧取得に件数上限を設ける。'
        }
      ],
      action_candidates: []
    }
  });

  assert.deepEqual(taskState.tasks.map((task) => task.id), ['VP-TASK-PERF-001', 'VP-TASK-DB-001-API_PROJECTS']);
  assert.equal(taskState.tasks[0].target_files.includes('package.json'), true);
  assert.equal(taskState.tasks[1].target_files.includes('src/app/api/projects/route.ts'), true);
  assert.equal(taskState.tasks[1].target_groups[0].id, 'api-projects');
});

test('diagnose emits local dev performance findings and tasks', async () => {
  const repo = await makeRepo();
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    scripts: {
      dev: 'concurrently "next dev" "npm:worker" "npm:worker:generation" "npm:worker:email"',
      worker: 'tsx src/workers/index.ts',
      'worker:generation': 'tsx src/workers/generation.ts',
      'worker:email': 'tsx src/workers/email.ts'
    },
    dependencies: {
      next: '^15.0.0',
      react: '^19.0.0'
    }
  }, null, 2));
  await runCli(['init', repo, '--story-id', 'story-local-dev-performance', '--title', 'ローカルdev性能', '--view', 'dev', '--period', '2026-05']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [], links: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);

  const result = await runCli(['diagnose', repo, '--run-id', '2026-05-07Tlocal-dev']);

  assert.equal(result.exitCode, 0);
  const evidence = await readJson(path.join(repo, '.vibepro', 'diagnostics', '2026-05-07Tlocal-dev', 'evidence.json'));
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-PERF-001'), true);
  assert.equal(evidence.local_dev.heavy_dev_scripts[0].script_name, 'dev');
  assert.equal(evidence.local_dev.runtime_probe_plan.commands.length > 0, true);
  const tasks = await readJson(path.join(repo, '.vibepro', 'stories', 'story-local-dev-performance', 'tasks', 'tasks.json'));
  assert.equal(tasks.tasks.some((task) => task.id === 'VP-TASK-PERF-001'), true);
  assert.equal(tasks.tasks.find((task) => task.id === 'VP-TASK-PERF-001').target_files.includes('package.json'), true);
  const summary = await readFile(path.join(repo, '.vibepro', 'diagnostics', '2026-05-07Tlocal-dev', 'summary.md'), 'utf8');
  assert.match(summary, /重いdev script候補/);
  assert.match(summary, /runtime probe plan/);
});

test('story task generator keeps resolved finding tasks as done after re-diagnosis', () => {
  const taskState = buildStoryTaskState({
    story: { story_id: 'story-local-perf', title: 'ローカル性能を改善する' },
    runId: '2026-05-07Tresolved',
    gateStatus: 'pass',
    existingTaskState: {
      tasks: [{
        id: 'VP-TASK-PERF-001',
        source_type: 'finding',
        source_id: 'VP-PERF-001',
        finding_id: 'VP-PERF-001',
        title: 'ローカルdev起動が複数runtimeを同時起動している',
        priority: 'medium',
        status: 'todo',
        target_files: ['package.json'],
        target_routes: [],
        target_groups: [],
        read_first_files: [],
        recommended_strategy: { id: 'manual-review', reason: '分離する' },
        implementation_steps: [],
        acceptance_criteria: ['分離する']
      }]
    },
    evidence: {
      findings: [],
      action_candidates: []
    }
  });

  assert.equal(taskState.tasks.length, 1);
  assert.equal(taskState.tasks[0].id, 'VP-TASK-PERF-001');
  assert.equal(taskState.tasks[0].status, 'done');
  assert.equal(taskState.tasks[0].completion_evidence.run_id, '2026-05-07Tresolved');
});

test('story task generator splits DB findings by route and service domain', () => {
  const taskState = buildStoryTaskState({
    story: { story_id: 'story-db-perf', title: 'DB性能を改善する' },
    runId: '2026-05-07Tdb-split',
    gateStatus: 'needs_review',
    evidence: {
      database_access: {
        unbounded_find_many: [
          { file: 'src/app/api/projects/route.ts', gate_effect: 'review' },
          { file: 'src/app/api/projects/[projectId]/tasks/route.ts', gate_effect: 'review' },
          { file: 'src/app/api/analytics/project-summary/route.ts', gate_effect: 'review' },
          { file: 'src/lib/services/admin/llmUsageAnalyticsService.ts', gate_effect: 'review' }
        ]
      },
      findings: [{
        id: 'VP-DB-001',
        severity: 'Medium',
        category: 'パフォーマンス',
        title: '未ページングのDB一覧取得候補がある',
        recommendation: '一覧取得に件数上限を設ける。'
      }],
      action_candidates: []
    }
  });

  assert.deepEqual(taskState.tasks.map((task) => task.id), [
    'VP-TASK-DB-001-API_PROJECTS',
    'VP-TASK-DB-001-API_ANALYTICS',
    'VP-TASK-DB-001-SERVICES_ADMIN'
  ]);
  assert.equal(taskState.tasks[0].target_files.length, 2);
  assert.equal(taskState.tasks[0].target_groups[0].id, 'api-projects');
});

test('api boundary treats authorization header with environment secret as route protection', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'api', 'admin', 'queue', 'status'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'admin', 'queue', 'status', 'route.ts'), `
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  const apiKey = process.env.SALESTAILOR_API_KEY;
  if (!authHeader || authHeader !== \`Bearer \${apiKey}\`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return Response.json({ ok: true });
}
`);

  const result = await scanApiBoundary(repo, {
    views: {
      runtime: {
        entrypoints: ['src/app/api/admin/queue/status/route.ts']
      },
      security: {
        auth_boundaries: []
      }
    }
  });

  assert.equal(result.routes[0].protection.status, 'protected_by_route');
  assert.equal(result.routes[0].protection.evidence.includes('route_auth_reference'), true);
  assert.equal(result.routes[0].risk_hints.includes('privileged_route_unprotected'), false);
});

test('api boundary follows imported auth helper references for route protection', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'api', 'admin', 'deals'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'admin', 'deals', 'route.ts'), `
import { getUser } from '@/lib/get-user';

export async function GET() {
  const user = await getUser();
  if (!user || user.role !== 'ADMIN') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return Response.json({ ok: true });
}
`);
  await mkdir(path.join(repo, 'src', 'lib'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'get-user'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'get-user.ts'), `
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

export async function getUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user;
}
`);

  const result = await scanApiBoundary(repo, {
    views: {
      runtime: {
        entrypoints: ['src/app/api/admin/deals/route.ts']
      },
      security: {
        auth_boundaries: []
      }
    }
  });

  assert.equal(result.routes[0].protection.status, 'protected_by_route');
  assert.equal(result.routes[0].protection.evidence.includes('route_auth_reference'), true);
  assert.equal(result.routes[0].protection.evidence.includes('imported_auth_helper'), true);
  assert.equal(result.routes[0].risk_hints.includes('privileged_route_unprotected'), false);
});

test('api boundary follows nested imported auth helper references for route protection', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'api', 'admin', 'inquiries'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'admin', 'inquiries', 'route.ts'), `
import { verifyAdminAuth } from '@/lib/utils/admin-auth';

export async function GET() {
  const authResult = await verifyAdminAuth();
  if (!authResult.success) {
    return authResult.response;
  }
  return Response.json({ ok: true });
}
`);
  await mkdir(path.join(repo, 'src', 'lib', 'utils'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'utils', 'admin-auth.ts'), `
import { getUser } from '@/lib/get-user';

export async function verifyAdminAuth() {
  const sessionUser = await getUser();
  if (!sessionUser || sessionUser.role !== 'ADMIN') {
    return { success: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { success: true, user: sessionUser };
}
`);
  await mkdir(path.join(repo, 'src', 'lib'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'get-user.ts'), `
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

export async function getUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user;
}
`);

  const result = await scanApiBoundary(repo, {
    views: {
      runtime: {
        entrypoints: ['src/app/api/admin/inquiries/route.ts']
      },
      security: {
        auth_boundaries: []
      }
    }
  });

  assert.equal(result.routes[0].protection.status, 'protected_by_route');
  assert.equal(result.routes[0].protection.evidence.includes('route_auth_reference'), true);
  assert.equal(result.routes[0].protection.evidence.includes('imported_auth_helper'), true);
  assert.equal(result.routes[0].risk_hints.includes('privileged_route_unprotected'), false);
});

test('api boundary follows imported debug access gate helpers for route protection', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'api', 'debug', 'session'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'debug', 'session', 'route.ts'), `
import { validateDebugAccess } from '@/lib/api/debug-access';

export async function GET() {
  const access = validateDebugAccess(await auth());
  if (access !== 'allowed') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return Response.json({ ok: true });
}
`);
  await mkdir(path.join(repo, 'src', 'lib', 'api'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'api', 'debug-access.ts'), `
export function validateDebugAccess(session, env = process.env) {
  if (env.NODE_ENV === 'production' || env.DEBUG_API_ENABLED !== 'true') {
    return 'disabled';
  }
  if (!session?.user?.id) {
    return 'unauthorized';
  }
  if (Number(session.user.userType) !== 9) {
    return 'forbidden';
  }
  return 'allowed';
}
`);

  const result = await scanApiBoundary(repo, {
    views: {
      runtime: {
        entrypoints: ['src/app/api/debug/session/route.ts']
      },
      security: {
        auth_boundaries: []
      }
    }
  });

  assert.equal(result.routes[0].protection.status, 'protected_by_route');
  assert.equal(result.routes[0].protection.evidence.includes('debug_access_gate'), true);
  assert.equal(result.routes[0].protection.evidence.includes('imported_debug_gate_helper'), true);
  assert.equal(result.routes[0].risk_hints.includes('debug_route_exposed'), false);
});

test('api boundary detects webhook signature checks for Svix and token based routes', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'api', 'webhooks', 'resend'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'webhooks', 'resend', 'route.ts'), `
import { Webhook } from 'svix';

export async function POST(request) {
  const webhook = new Webhook(process.env.RESEND_WEBHOOK_SECRET);
  const payload = await request.text();
  const svixId = request.headers.get('svix-id');
  const svixTimestamp = request.headers.get('svix-timestamp');
  const svixSignature = request.headers.get('svix-signature');
  webhook.verify(payload, {
    'svix-id': svixId ?? '',
    'svix-timestamp': svixTimestamp ?? '',
    'svix-signature': svixSignature ?? ''
  });
  return Response.json({ ok: true });
}
`);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'webhooks', 'timerex'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'webhooks', 'timerex', 'route.ts'), `
import { verifyTimerexWebhookSignature } from '@/lib/services/timerex';

export async function POST(request) {
  const webhookHeaderName = 'x-timerex-authorization';
  const expectedWebhookToken = process.env.TIMEREX_WEBHOOK_DEFAULT_TOKEN;
  const actualWebhookToken = request.headers.get(webhookHeaderName);
  if (!verifyTimerexWebhookSignature({ actualToken: actualWebhookToken, expectedToken: expectedWebhookToken })) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return Response.json({ ok: true });
}
`);

  const result = await scanApiBoundary(repo, {
    views: {
      runtime: {
        entrypoints: [
          'src/app/api/webhooks/resend/route.ts',
          'src/app/api/webhooks/timerex/route.ts'
        ]
      },
      security: {
        auth_boundaries: []
      }
    }
  });

  for (const route of result.routes) {
    assert.equal(route.protection.status, 'protected_by_route');
    assert.equal(route.protection.evidence.includes('webhook_signature_check'), true);
    assert.equal(route.risk_hints.includes('webhook_signature_not_detected'), false);
  }
});

test('api boundary follows imported provider webhook signature helpers', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'api', 'openai', 'webhook', 'response'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'openai', 'webhook', 'response', 'route.ts'), `
import { verifyOpenAIWebhook } from '@/lib/api/webhookSecurity';

export async function POST(request) {
  const rawBody = await request.text();
  const verification = await verifyOpenAIWebhook(request, rawBody);
  if (!verification.ok) {
    return Response.json({ error: 'invalid signature' }, { status: 401 });
  }
  return Response.json({ ok: true });
}
`);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'twilio', 'webhook', 'voice'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'twilio', 'webhook', 'voice', 'route.ts'), `
import { verifyTwilioFormWebhook } from '@/lib/api/webhookSecurity';

export async function POST(request) {
  const formData = await request.formData();
  const verification = await verifyTwilioFormWebhook(request, formData);
  if (!verification.ok) {
    return Response.json({ error: 'invalid signature' }, { status: 401 });
  }
  return Response.json({ ok: true });
}
`);
  await mkdir(path.join(repo, 'src', 'lib', 'api'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'api', 'webhookSecurity.ts'), `
export async function verifyOpenAIWebhook(request, rawBody, env = process.env) {
  if (!env.OPENAI_WEBHOOK_SECRET) return { ok: false };
  const headers = Object.fromEntries(request.headers.entries());
  const client = {
    webhooks: {
      verifySignature: async () => true
    }
  };
  await client.webhooks.verifySignature(rawBody, headers, { secret: env.OPENAI_WEBHOOK_SECRET });
  return { ok: true };
}

export async function verifyTwilioFormWebhook(request, formData, env = process.env) {
  const signature = request.headers.get('x-twilio-signature');
  const twilio = {
    validateRequest: () => true
  };
  return twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, request.url, Object.fromEntries(formData.entries()))
    ? { ok: true }
    : { ok: false };
}
`);

  const result = await scanApiBoundary(repo, {
    views: {
      runtime: {
        entrypoints: [
          'src/app/api/openai/webhook/response/route.ts',
          'src/app/api/twilio/webhook/voice/route.ts'
        ]
      },
      security: {
        auth_boundaries: []
      }
    }
  });

  for (const route of result.routes) {
    assert.equal(route.classification, 'webhook');
    assert.equal(route.protection.status, 'protected_by_route');
    assert.equal(route.protection.evidence.includes('webhook_signature_check'), true);
    assert.equal(route.protection.evidence.includes('imported_signature_helper'), true);
    assert.equal(route.protection.evidence.includes('imported_webhook_signature_helper'), true);
    assert.equal(route.risk_hints.includes('webhook_signature_not_detected'), false);
  }
});

test('network contract scanner detects ExampleTravel-style API route regression and clears after route exists', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src', 'app', '(app)', 'detail', '_components', 'hooks', 'utils'), { recursive: true });
  const executorPath = path.join(repo, 'src', 'app', '(app)', 'detail', '_components', 'hooks', 'utils', 'searchExecutor.ts');
  await writeFile(executorPath, `
import { searchHotelsDetail } from '../actions';
export async function execute(actionParams) {
  return searchHotelsDetail(actionParams);
}
`);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add detail search server action caller']);

  await writeFile(executorPath, `
export async function execute(actionParams) {
  const response = await fetch('/api/detail-search', {
    method: 'POST',
    body: JSON.stringify(actionParams)
  });
  return response.json();
}
`);

  const missing = await scanNetworkContracts(repo, {
    changedFiles: [{ path: 'src/app/(app)/detail/_components/hooks/utils/searchExecutor.ts', status: 'M' }],
    baseRef: 'HEAD',
    headRef: null
  });

  assert.equal(missing.status, 'block');
  assert.equal(missing.missing_routes.some((item) => item.api_path === '/api/detail-search' && item.gate_effect === 'block'), true);
  assert.equal(missing.high_risk_replacements.some((item) => item.removed_calls.includes('searchHotelsDetail')), true);

  await mkdir(path.join(repo, 'src', 'app', 'api', 'detail-search'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'detail-search', 'route.ts'), `
export async function POST(request) {
  const body = await request.json();
  return Response.json({ ok: true, body });
}
`);

  const fixed = await scanNetworkContracts(repo, {
    changedFiles: [
      { path: 'src/app/(app)/detail/_components/hooks/utils/searchExecutor.ts', status: 'M' },
      { path: 'src/app/api/detail-search/route.ts', status: 'A' }
    ],
    baseRef: 'HEAD',
    headRef: null
  });

  assert.equal(fixed.missing_routes.some((item) => item.api_path === '/api/detail-search'), false);
});

test('network contract scanner ignores external absolute URLs that contain /api/', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src', 'components', 'mypage'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'components', 'mypage', 'AddressInfoCard.tsx'), `
export async function searchPostalCode(normalizedPostalCode) {
  const response = await fetch(
    \`https://zipcloud.ibsnet.co.jp/api/search?zipcode=\${normalizedPostalCode}\`,
  );
  return response.json();
}
`);

  const result = await scanNetworkContracts(repo, {
    changedFiles: [{ path: 'src/components/mypage/AddressInfoCard.tsx', status: 'M' }]
  });

  assert.equal(result.status, 'pass');
  assert.equal(result.api_client_calls.some((item) => item.raw_argument.includes('zipcloud.ibsnet.co.jp')), false);
  assert.equal(result.missing_routes.some((item) => item.api_path === '/api/search'), false);
  assert.equal(result.dynamic_calls.some((item) => item.api_path === '/api/search'), false);
});


test('diagnose binds runs to selected story and brainbase prefers the selected story run', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-alpha', '--title', 'Alpha', '--view', 'dev']);
  await runCli(['story', 'add', repo, '--id', 'story-beta', '--title', 'Beta', '--view', 'dev']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['story', 'select', repo, '--id', 'story-alpha']);
  await runCli(['diagnose', repo, '--run-id', 'run-alpha']);
  await runCli(['story', 'select', repo, '--id', 'story-beta']);
  await runCli(['diagnose', repo, '--run-id', 'run-beta']);
  await runCli(['story', 'select', repo, '--id', 'story-alpha']);

  const result = await runCli(['brainbase', repo]);

  assert.equal(result.exitCode, 0);
  const alphaEvidence = await readJson(path.join(repo, '.vibepro', 'diagnostics', 'run-alpha', 'evidence.json'));
  assert.equal(alphaEvidence.story_id, 'story-alpha');
  assert.equal(alphaEvidence.story.story_id, 'story-alpha');
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.latest_run, 'run-beta');
  assert.equal(manifest.runs[0].story_id, 'story-beta');
  assert.equal(manifest.runs[1].story_id, 'story-alpha');
  const importState = await readJson(path.join(repo, '.vibepro', 'brainbase', 'import-state.json'));
  assert.equal(importState.story.story_id, 'story-alpha');
  assert.equal(importState.latest_run.run_id, 'run-alpha');
  assert.equal(importState.latest_run.story_id, 'story-alpha');
  assert.equal(manifest.brainbase.last_export.story_id, 'story-alpha');
  assert.equal(manifest.brainbase.last_export.latest_run_story_id, 'story-alpha');
});

test('story runs and status show selected story diagnosis history', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-alpha', '--title', 'Alpha', '--view', 'dev']);
  await runCli(['story', 'add', repo, '--id', 'story-beta', '--title', 'Beta', '--view', 'dev']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['story', 'select', repo, '--id', 'story-alpha']);
  await runCli(['diagnose', repo, '--run-id', 'run-alpha']);
  await runCli(['story', 'select', repo, '--id', 'story-beta']);
  await runCli(['diagnose', repo, '--run-id', 'run-beta']);
  await runCli(['story', 'select', repo, '--id', 'story-alpha']);

  let runsOutput = '';
  const runsResult = await runCli(['story', 'runs', repo], {
    stdout: { write: (text) => { runsOutput += text; } }
  });

  assert.equal(runsResult.exitCode, 0);
  assert.equal(runsResult.result.story.story_id, 'story-alpha');
  assert.equal(runsResult.result.runs.length, 1);
  assert.match(runsOutput, /run-alpha/);
  assert.doesNotMatch(runsOutput, /run-beta/);

  let statusOutput = '';
  const statusResult = await runCli(['story', 'status', repo], {
    stdout: { write: (text) => { statusOutput += text; } }
  });

  assert.equal(statusResult.exitCode, 0);
  assert.equal(statusResult.result.story.story_id, 'story-alpha');
  assert.equal(statusResult.result.latestRun.run_id, 'run-alpha');
  assert.equal(statusResult.result.findingCount, 0);
  assert.match(statusOutput, /Story ID \| story-alpha/);
  assert.match(statusOutput, /Latest run \| run-alpha/);
  assert.match(statusOutput, /Gate \| pass/);
  assert.match(statusOutput, /Findings \| 0/);
  assert.match(statusOutput, /\.vibepro\/diagnostics\/run-alpha\/evidence.json/);
});

test('story report creates a Story diagnosis report artifact', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-alpha', '--title', 'Alpha', '--view', 'dev', '--period', '2026-W18']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }, { id: 'api' }],
    edges: [{ source: 'app', target: 'api', relation: 'calls', confidence: 'AMBIGUOUS' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['story', 'select', repo, '--id', 'story-alpha']);
  await runCli(['diagnose', repo, '--run-id', 'run-alpha']);

  const result = await runCli(['story', 'report', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.story.story_id, 'story-alpha');
  assert.equal(result.result.reportPath.endsWith(path.join('.vibepro', 'stories', 'story-alpha', 'story-report.md')), true);
  const report = await readFile(path.join(repo, '.vibepro', 'stories', 'story-alpha', 'story-report.md'), 'utf8');
  assert.match(report, /# Story診断レポート/);
  assert.match(report, /Story ID \| story-alpha/);
  assert.match(report, /Run ID \| run-alpha/);
  assert.match(report, /Gate \| needs_review/);
  assert.match(report, /graphify nodes \| 2/);
  assert.match(report, /VP-GRAPH-001/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.stories['story-alpha'].latest_report, '.vibepro/stories/story-alpha/story-report.md');
});

test('story diagnose runs the local story workflow in one command', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-alpha', '--title', 'Alpha', '--view', 'dev']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }, { id: 'api' }],
    edges: [{ source: 'app', target: 'api', relation: 'calls', confidence: 'AMBIGUOUS' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  let output = '';

  const result = await runCli(['story', 'diagnose', repo, '--id', 'story-alpha', '--run-id', 'run-alpha'], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.story.story_id, 'story-alpha');
  assert.equal(result.result.diagnosis.run.run_id, 'run-alpha');
  assert.match(output, /Story selected: story-alpha/);
  assert.match(output, /graphify artifacts imported/);
  assert.match(output, /diagnosis created/);
  assert.match(output, /Story report created/);
  assert.match(output, /# Story Status/);
  const config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(config.brainbase.current_story_id, 'story-alpha');
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.latest_run_by_story['story-alpha'], 'run-alpha');
  assert.equal(manifest.stories['story-alpha'].latest_report, '.vibepro/stories/story-alpha/story-report.md');
});

test('story diagnose surfaces missing Journey context for UI stories (INV-SJD-1, INV-SJD-2)', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-ui-navigation', '--title', 'Improve onboarding screen navigation', '--view', 'dev']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeJson(path.join(graphDir, 'graph.json'), {
    nodes: [{ id: 'onboarding-screen' }],
    edges: []
  });
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  let output = '';

  const result = await runCli(['story', 'diagnose', repo, '--id', 'story-ui-navigation', '--run-id', 'run-ui-missing-journey'], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.status.journey_context.required, true);
  assert.equal(result.result.status.journey_context.status, 'missing');
  assert.equal(result.result.status.journey_context.curated, false);
  assert.match(output, /## Journey Context/);
  assert.match(output, /Status \| missing/);
  const report = await readFile(path.join(repo, '.vibepro', 'stories', 'story-ui-navigation', 'story-report.md'), 'utf8');
  assert.match(report, /## Journey Context/);
  assert.match(report, /Artifact kind \| -/);
  const html = await readFile(path.join(repo, '.vibepro', 'stories', 'story-ui-navigation', 'index.html'), 'utf8');
  assert.match(html, /<h2>Journey Context<\/h2>/);
  assert.match(html, /<td>Status<\/td>\s*<td>missing<\/td>/);
  assert.match(html, /<td>Artifact kind<\/td>\s*<td>-<\/td>/);
  assert.match(html, /<td>Curated<\/td>\s*<td>no<\/td>/);
});

test('story diagnose distinguishes machine-derived and curated Journey artifacts (INV-SJD-3)', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-ui-navigation', '--title', 'Improve onboarding screen navigation', '--view', 'dev']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeJson(path.join(graphDir, 'graph.json'), {
    nodes: [{ id: 'onboarding-screen' }],
    edges: []
  });
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await mkdir(path.join(repo, '.vibepro', 'journey'), { recursive: true });
  await writeJson(path.join(repo, '.vibepro', 'journey', 'latest-journey.json'), {
    schema_version: '0.1.0',
    journey_id: 'default-product-journey',
    artifact_kind: 'journey_context_pack',
    machine_derived: true,
    authoritative: false,
    curation_status: 'needs_curated_journey',
    generated_at: '2026-07-03T00:00:00.000Z',
    source_story_ids: ['story-ui-navigation'],
    handoff: { status: 'ready' },
    backbone: [],
    walking_skeleton: { status: 'incomplete' },
    conflicts: [],
    open_questions: []
  });

  const derivedResult = await runCli(['story', 'diagnose', repo, '--id', 'story-ui-navigation', '--run-id', 'run-ui-derived-journey']);

  assert.equal(derivedResult.exitCode, 0);
  assert.equal(derivedResult.result.status.journey_context.status, 'needs_curated_journey');
  assert.equal(derivedResult.result.status.journey_context.artifact_kind, 'journey_context_pack');
  assert.equal(derivedResult.result.status.journey_context.curated, false);
  assert.equal(derivedResult.result.status.journey_context.handoff_available, true);
  assert.equal(
    derivedResult.result.status.journey_context.next_actions.includes('vibepro journey curate . --id default-product-journey --input <judgments.json>'),
    true
  );
  await mkdir(path.join(repo, '.vibepro', 'journeys'), { recursive: true });
  await writeJson(path.join(repo, '.vibepro', 'journeys', 'default-product-journey.json'), {
    schema_version: '0.1.0',
    journey_id: 'default-product-journey',
    artifact_kind: 'curated_journey',
    machine_derived: false,
    authoritative: true,
    curation_status: 'curated',
    generated_at: '2026-07-03T00:00:00.000Z',
    backbone: [],
    walking_skeleton: { status: 'ready' },
    conflicts: [],
    open_questions: []
  });

  const curatedResult = await runCli(['story', 'diagnose', repo, '--id', 'story-ui-navigation', '--run-id', 'run-ui-curated-journey']);

  assert.equal(curatedResult.exitCode, 0);
  assert.equal(curatedResult.result.status.journey_context.status, 'available');
  assert.equal(curatedResult.result.status.journey_context.artifact_kind, 'curated_journey');
  assert.equal(curatedResult.result.status.journey_context.curated, true);
  assert.equal(curatedResult.result.status.journey_context.curated_journey_path, '.vibepro/journeys/default-product-journey.json');
});

test('story diagnose does not add Journey friction for backend stories (INV-SJD-4)', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-backend-cache-cleanup', '--title', 'Backend cache cleanup', '--view', 'dev']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeJson(path.join(graphDir, 'graph.json'), {
    nodes: [{ id: 'cache-worker' }],
    edges: []
  });
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  let output = '';

  const result = await runCli(['story', 'diagnose', repo, '--id', 'story-backend-cache-cleanup', '--run-id', 'run-backend-no-journey'], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.status.journey_context.required, false);
  assert.equal(result.result.status.journey_context.status, 'not_required');
  assert.doesNotMatch(output, /vibepro journey derive/);
  assert.doesNotMatch(output, /vibepro journey handoff/);
});

test('status reports an uninitialized repository without creating a workspace', async () => {
  const repo = await makeRepo();
  let output = '';

  const result = await runCli(['status', repo], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.status.initialized, false);
  assert.match(output, /# VibePro Status/);
  assert.match(output, /Initialized \| no/);
  assert.match(output, /vibepro init/);
  await assert.rejects(stat(path.join(repo, '.vibepro')), { code: 'ENOENT' });
});

test('status reports initialized repositories with no active stories', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'archive', repo, '--id', 'story-vibepro-diagnosis-commercialization-roadmap']);
  let output = '';

  const result = await runCli(['status', repo, '--json'], {
    stdout: { write: (text) => { output += text; } }
  });

  const status = JSON.parse(output);
  assert.equal(result.exitCode, 0);
  assert.equal(status.initialized, true);
  assert.equal(status.active_stories.length, 0);
  assert.match(status.next_commands[0], /story add/);
});

test('status surfaces doctor maintenance before the next workflow command', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-alpha', '--title', 'Alpha']);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.brainbase.current_story_id = 'missing-story';
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = await runCli(['status', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.status.doctor.overall_status, 'needs_maintenance');
  assert.equal(result.status.doctor.blocking_check_ids.includes('VP-DOCTOR-CURRENT-STORY-MISSING'), true);
  assert.equal(result.status.doctor.next_actions[0].command, `vibepro doctor ${repo} --fix`);
  assert.equal(result.status.next_commands[0], `vibepro doctor ${repo} --fix`);
  await assert.rejects(stat(path.join(repo, '.vibepro', 'doctor', 'doctor-result.json')), { code: 'ENOENT' });
});

test('status reports repository diagnosis state as text and json', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-alpha', '--title', 'Alpha', '--view', 'dev', '--period', '2026-W18']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }, { id: 'api' }],
    edges: [{ source: 'app', target: 'api', relation: 'calls', confidence: 'AMBIGUOUS' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['story', 'diagnose', repo, '--id', 'story-alpha', '--run-id', 'run-alpha']);
  let output = '';

  const result = await runCli(['status', repo], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.status.initialized, true);
  assert.equal(result.status.current_story_id, 'story-alpha');
  assert.equal(result.status.latest_run.run_id, 'run-alpha');
  assert.equal(result.status.selected_story_latest_run.run_id, 'run-alpha');
  assert.equal(result.status.gate_status, 'needs_review');
  assert.equal(result.status.finding_count, 1);
  assert.match(output, /Selected Story \| story-alpha/);
  assert.match(output, /Latest Run \| run-alpha/);
  assert.match(output, /Selected Story Latest Run \| run-alpha/);
  assert.match(output, /Gate \| needs_review/);
  assert.match(output, /Findings \| 1/);
  assert.match(output, /story report/);

  let jsonOutput = '';
  const jsonResult = await runCli(['status', repo, '--json'], {
    stdout: { write: (text) => { jsonOutput += text; } }
  });
  const status = JSON.parse(jsonOutput);
  assert.equal(jsonResult.exitCode, 0);
  assert.equal(status.initialized, true);
  assert.equal(status.current_story_id, 'story-alpha');
  assert.equal(status.active_stories[0].story_id, 'story-alpha');
  assert.equal(status.latest_run.run_id, 'run-alpha');
  assert.equal(status.selected_story_latest_run.run_id, 'run-alpha');
  assert.equal(status.artifacts.evidence, '.vibepro/diagnostics/run-alpha/evidence.json');
});



test('diagnose creates a run, evidence, reports, and updates the manifest', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(graphDir, { recursive: true }));
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }, { id: 'api' }],
    links: [
      { source: 'app', target: 'api', relation: 'calls', confidence: 'EXTRACTED' },
      { source: 'api', target: 'unknown', relation: 'depends_on', confidence: 'AMBIGUOUS' }
    ]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);

  const result = await runCli(['diagnose', repo, '--run-id', '2026-04-28T120000Z']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.command, 'diagnose');
  const runDir = path.join(repo, '.vibepro', 'diagnostics', '2026-04-28T120000Z');
  await stat(path.join(runDir, 'summary.md'));
  await stat(path.join(runDir, 'risk-register.md'));
  await stat(path.join(runDir, 'requirement-consistency.md'));
  const evidence = await readJson(path.join(runDir, 'evidence.json'));
  const summary = await readFile(path.join(runDir, 'summary.md'), 'utf8');
  assert.equal(evidence.graphify.node_count, 2);
  assert.equal(evidence.graphify.edge_count, 2);
  assert.equal(evidence.graphify.edge_source_key, 'links');
  assert.equal(evidence.graphify.extracted_edges.length, 1);
  assert.equal(evidence.graphify.ambiguous_edges.length, 1);
  assert.equal(evidence.requirement_consistency.status, 'not_applicable');
  assert.equal(evidence.output.language, 'ja');
  assert.equal(evidence.toolchain.package.name, 'vibepro');
  assert.match(summary, /VibePro Runtime/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.latest_run, '2026-04-28T120000Z');
  assert.equal(manifest.runs[0].toolchain.package.name, 'vibepro');
  assert.equal(manifest.runs[0].artifacts.summary, '.vibepro/diagnostics/2026-04-28T120000Z/summary.md');
  assert.equal(manifest.runs[0].artifacts.requirement_consistency, '.vibepro/diagnostics/2026-04-28T120000Z/requirement-consistency.md');
});

test('diagnose scopes requirement consistency to inferred spec code refs for selected story', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-selected-scope', '--title', 'Selected story scope']);
  await mkdir(path.join(repo, 'src', 'lib', 'candidate'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'v1', 'hotels', 'search'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'candidate', 'value-parser.ts'), `
export function parseCandidateValue(candidate) {
  if (candidate.kind === 'room') {
    return { id: candidate.id, status: 'parsed-room' };
  }
  return { id: candidate.id, status: 'parsed' };
}
`);
  await writeFile(path.join(repo, 'src', 'app', 'api', 'v1', 'hotels', 'search', 'route.ts'), `
export async function GET(auth) {
  if (!auth.authorized) {
    return Response.json({ message: 'unauthorized' }, { status: 401 });
  }
  return Response.json({ hotels: [] });
}
`);
  await writeInferredSpec(repo, 'story-selected-scope', {
    schema_version: '0.1.0',
    story_id: 'story-selected-scope',
    clauses: [
      {
        id: 'INV-001',
        type: 'invariant',
        statement: 'Selected story candidate value parsing is limited to the Candidate Layer parser file.',
        origin: {
          code_refs: [{ file: 'src/lib/candidate/value-parser.ts', anchor: 'parseCandidateValue' }]
        },
        verifiable_by: {
          code_pattern: [{ file_glob: 'src/lib/candidate/value-parser.ts', must_contain: 'parseCandidateValue' }]
        }
      }
    ],
    open_questions: []
  });
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'candidate-parser', file: 'src/lib/candidate/value-parser.ts' },
      { id: 'legacy-hotel-search', file: 'src/app/api/v1/hotels/search/route.ts' }
    ],
    links: []
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);

  const result = await runCli(['diagnose', repo, '--run-id', '2026-04-28T130000Z']);

  assert.equal(result.exitCode, 0);
  const evidence = await readJson(path.join(repo, '.vibepro', 'diagnostics', '2026-04-28T130000Z', 'evidence.json'));
  assert.equal(evidence.requirement_consistency.status, 'pass');
  assert.deepEqual(
    evidence.requirement_consistency.code_scenarios.map((scenario) => scenario.file),
    ['src/lib/candidate/value-parser.ts']
  );
  assert.equal(
    evidence.requirement_consistency.code_scenarios.some((scenario) => scenario.file.includes('hotels/search')),
    false
  );
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-REQ-002'), false);
});

test('diagnose creates static site evidence and a static site report under the run directory', async () => {
  const repo = await makeRepo();
  await writeFile(path.join(repo, 'index.html'), `<!doctype html>
<html>
  <head>
    <script src="https://cdn.example.com/app.js"></script>
    <link rel="stylesheet" href="./style.css">
  </head>
  <body>
    <button class="primary-button" data-component="button">Run</button>
    <script src="./app.js"></script>
  </body>
</html>
`);
  await writeFile(path.join(repo, 'style.css'), `
:root { --bb-surface-main: #101113; }
.primary-button {
  background: #1e293b;
  border-radius: 16px;
}
.task-action-btn {
  width: 24px;
  height: 24px;
  transition: all 0.15s ease;
}
.task-action-btn:hover { transform: translateY(-1px); }
.task-card { box-shadow: 0 24px 80px rgba(0, 0, 0, 0.3); }
`);
  await writeFile(path.join(repo, 'app.js'), `
const apiKey = "sk-123456789012345678901234";
const access_token = "runtimeReviewToken123";
const secret_key = plainsecretvalue;
const api_key = request.headers.get('x-api-key');
const accessToken = body.access_token ?? null;
const callConfig = {
  authToken: twilioAuthToken,
  apiKey: openaiConfig.apiKey!,
  access_token: accessToken
};
FireCrawlApi(api_key=firecrawl_api_key);
document.body.innerHTML = location.hash;
eval("1+1");
`);
  await mkdir(path.join(repo, '.claude', 'skills', 'security-patterns'), { recursive: true });
  await writeFile(path.join(repo, '.claude', 'skills', 'security-patterns', 'SKILL.md'), `
Example:
const apiKey = process.env.EXAMPLE_API_KEY;
element.innerHTML = userInput;
`);
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'security.md'), 'Use API_KEY="st_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" in examples only.\n');
  await writeFile(path.join(repo, 'server.py'), 'print("not a static asset")\n');
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }],
    edges: []
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);

  const result = await runCli(['diagnose', repo, '--run-id', '2026-04-28T130000Z']);

  assert.equal(result.exitCode, 0);
  const runDir = path.join(repo, '.vibepro', 'diagnostics', '2026-04-28T130000Z');
  await stat(path.join(runDir, 'static-site-check-result.md'));
  const evidence = await readJson(path.join(runDir, 'evidence.json'));
  assert.equal(evidence.static_site.has_index_html, true);
  assert.equal(evidence.static_site.secret_hits.length > 0, true);
  assert.equal(evidence.static_site.xss_risk_hits.length > 0, true);
  const runtimeSecret = evidence.static_site.secret_hits.find((hit) => hit.file === 'app.js');
  assert.equal(runtimeSecret.confidence, 'high');
  assert.equal(runtimeSecret.source_kind, 'runtime_code');
  assert.equal(runtimeSecret.gate_effect, 'block');
  const skillSecret = evidence.static_site.secret_hits.find((hit) => hit.file === '.claude/skills/security-patterns/SKILL.md');
  assert.equal(skillSecret.confidence, 'low');
  assert.equal(skillSecret.source_kind, 'agent_skill');
  assert.equal(skillSecret.gate_effect, 'info');
  const skillXss = evidence.static_site.xss_risk_hits.find((hit) => hit.file === '.claude/skills/security-patterns/SKILL.md');
  assert.equal(skillXss.confidence, 'low');
  assert.equal(skillXss.gate_effect, 'info');
  const dynamicSecrets = evidence.static_site.secret_hits.filter(
    (hit) => hit.file === 'app.js'
      && /request\.headers|body\.access_token|twilioAuthToken|openaiConfig\.apiKey|accessToken|firecrawl_api_key/.test(hit.excerpt)
  );
  assert.equal(dynamicSecrets.length, 6);
  assert.equal(dynamicSecrets.every((hit) => hit.gate_effect === 'info'), true);
  assert.equal(dynamicSecrets.every((hit) => hit.confidence === 'low'), true);
  const unquotedPlainSecret = evidence.static_site.secret_hits.find((hit) => hit.excerpt.includes('plainsecretvalue'));
  assert.equal(unquotedPlainSecret.gate_effect, 'review');
  assert.equal(unquotedPlainSecret.confidence, 'medium');
  assert.equal(evidence.static_site.risk_summary.secret_hits.block, 1);
  assert.equal(evidence.static_site.risk_summary.secret_hits.info, 8);
  assert.equal(evidence.static_site.risk_summary.xss_risk_hits.review, 2);
  assert.equal(evidence.static_site.risk_summary.xss_risk_hits.info, 1);
  assert.equal(evidence.static_site.external_resources.length > 0, true);
  assert.equal(evidence.static_site.non_static_files.some((item) => item.file === 'server.py'), true);
  assert.equal(evidence.check_catalog.applicable_checks.includes('component-style'), true);
  assert.equal(evidence.component_style.component_kinds.includes('button'), true);
  assert.equal(evidence.component_style.component_kinds.includes('card'), true);
  assert.equal(evidence.component_style.design_system_markers.length > 0, true);
  assert.equal(evidence.component_style.legacy_style_hits.some((hit) => hit.file === 'style.css' && hit.token === '#1e293b'), true);
  assert.equal(evidence.component_style.risk_summary.legacy_style_hits.review >= 2, true);
  assert.equal(evidence.component_style.interaction_reliability_hits.some((hit) => hit.kind === 'interactive_target_moves_on_state'), true);
  assert.equal(evidence.component_style.interaction_reliability_hits.some((hit) => hit.kind === 'small_interactive_target'), true);
  assert.equal(evidence.component_style.risk_summary.interaction_reliability_hits.review, 3);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-UI-001'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-UI-002'), true);
  assert.equal(evidence.gates[0].status, 'block');
  const tasks = await readJson(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'tasks.json'));
  assert.equal(tasks.source_run.run_id, '2026-04-28T130000Z');
  assert.equal(tasks.source_run.gate_status, 'block');
  const secretBlockTask = tasks.tasks.find((task) => task.id === 'VP-TASK-STATIC-002-BLOCK');
  const secretReviewTask = tasks.tasks.find((task) => task.id === 'VP-TASK-STATIC-002-REVIEW');
  assert.equal(secretBlockTask.priority, 'critical');
  assert.equal(secretBlockTask.source_type, 'finding');
  assert.equal(secretBlockTask.target_files.includes('app.js'), true);
  assert.equal(secretBlockTask.gate_effect, 'block');
  assert.equal(secretBlockTask.order, 10);
  assert.equal(secretBlockTask.mutates_repository, false);
  assert.equal(secretReviewTask.priority, 'high');
  assert.equal(secretReviewTask.gate_effect, 'review');
  assert.equal(secretReviewTask.target_files.includes('app.js'), true);
  assert.match(await readFile(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'tasks.md'), 'utf8'), /VP-TASK-STATIC-002-BLOCK/);
  assert.match(await readFile(path.join(runDir, 'risk-register.md'), 'utf8'), /秘密情報/);
  assert.match(await readFile(path.join(runDir, 'static-site-check-result.md'), 'utf8'), /gate_effect/);
  const componentStyleReport = await readFile(path.join(runDir, 'component-style-check-result.md'), 'utf8');
  assert.match(componentStyleReport, /旧トークン候補/);
  assert.match(componentStyleReport, /操作信頼性候補/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(
    manifest.runs[0].artifacts.static_site_check,
    '.vibepro/diagnostics/2026-04-28T130000Z/static-site-check-result.md'
  );
  assert.equal(
    manifest.runs[0].artifacts.component_style_check,
    '.vibepro/diagnostics/2026-04-28T130000Z/component-style-check-result.md'
  );
  assert.equal(
    manifest.runs[0].artifacts.story_tasks_json,
    '.vibepro/stories/story-vibepro-diagnosis-commercialization-roadmap/tasks/tasks.json'
  );
});

test('diagnose ignores gitignored env files and downgrades variable secret references', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await writeFile(path.join(repo, '.gitignore'), '.env\n.env.preview\n');
  await writeFile(path.join(repo, '.env'), 'OPENAI_API_KEY=sk-123456789012345678901234\n');
  await writeFile(path.join(repo, '.env.preview'), 'NEXTAUTH_SECRET=secret_1234567890abcdef\n');
  await writeFile(path.join(repo, '.env.production'), [
    'DOTENV_PUBLIC_KEY_PRODUCTION=dotenvx_public_key_1234567890123456789012345678901234567890',
    'OPENAI_API_KEY=encrypted:abc1234567890abcdef',
    'DATABASE_URL="encrypted:def1234567890abcdef"',
    ''
  ].join('\n'));
  await writeFile(path.join(repo, 'app.js'), `
const provider = new OpenAIProvider({ apiKey: openaiKey });
access_token = get_token()
const secret_key = plainsecretvalue;
`);
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }],
    edges: []
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);

  const result = await runCli(['diagnose', repo, '--run-id', '2026-05-09T010000Z']);

  assert.equal(result.exitCode, 0);
  const evidence = await readJson(path.join(repo, '.vibepro', 'diagnostics', '2026-05-09T010000Z', 'evidence.json'));
  assert.equal(evidence.static_site.secret_hits.some((hit) => hit.file === '.env'), false);
  assert.equal(evidence.static_site.secret_hits.some((hit) => hit.file === '.env.preview'), false);
  assert.equal(evidence.static_site.secret_hits.some((hit) => hit.file === '.env.production'), false);
  const variableReferenceHits = evidence.static_site.secret_hits.filter(
    (hit) => hit.file === 'app.js' && /openaiKey|get_token/.test(hit.excerpt)
  );
  assert.equal(variableReferenceHits.length, 2);
  assert.equal(variableReferenceHits.every((hit) => hit.gate_effect === 'info'), true);
  const hardcodedReference = evidence.static_site.secret_hits.find(
    (hit) => hit.file === 'app.js' && hit.excerpt.includes('plainsecretvalue')
  );
  assert.equal(hardcodedReference.gate_effect, 'review');
});

test('diagnose profiles a Next.js repository and selects applicable checks without static site entry findings', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-nextjs-test-'));
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    scripts: { dev: 'next dev', test: 'vitest' },
    dependencies: {
      next: '^15.0.0',
      react: '^19.0.0',
      '@prisma/client': '^6.0.0',
      pg: '^8.0.0'
    },
    devDependencies: {
      typescript: '^5.0.0',
      vitest: '^3.0.0'
    }
  }, null, 2));
  await mkdir(path.join(repo, 'src', 'app', 'api', 'companies'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'companies', 'route.ts'), `
import { prisma } from '@/lib/db';

export async function GET() {
  const companies = await prisma.company.findMany({
    where: { active: true },
    orderBy: { createdAt: 'desc' }
  });
  return Response.json(companies);
}
`);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'accounts', '[id]'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'accounts', '[id]', 'route.ts'), `
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export async function GET(request, { params }) {
  const session = await auth();
  if (!session) return Response.json({}, { status: 401 });
  const events = await prisma.auditLog.findMany({
    where: { accountId: params.id },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  const account = await prisma.account.findUnique({
    where: { id: params.id }
  });
  if (account.userId !== session.user.id) {
    return Response.json({ error: 'Access denied' }, { status: 403 });
  }
  return Response.json({ events });
}
`);
  await writeFile(path.join(repo, 'src', 'app', 'api', 'companies', 'route.test.ts'), 'import test from "node:test";\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'companies', 'helper.ts'), 'export const helper = true;\n');
  await mkdir(path.join(repo, 'src', 'app', 'api', 'admin', 'users'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'admin', 'users', 'route.ts'), 'export async function GET() { return Response.json([]); }\n');
  await mkdir(path.join(repo, 'src', 'app', 'api', 'admin', 'webhook-monitor'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'admin', 'webhook-monitor', 'route.ts'), 'export async function GET() { return Response.json([]); }\n');
  await mkdir(path.join(repo, 'src', 'app', 'api', 'debug-env'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'debug-env', 'route.ts'), `
// auth debug endpoint: the word auth alone must not count as protection.
export async function GET() { return Response.json(process.env); }
`);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'webhooks', 'stripe'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'webhooks', 'stripe', 'route.ts'), `
// TODO: verify signature before handling this webhook.
export async function POST() { return Response.json({ ok: true }); }
`);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'internal', 'health'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'internal', 'health', 'route.ts'), `
import { auth } from '@/lib/auth';
export async function GET(request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({}, { status: 401 });
  return Response.json({ ok: true });
}
`);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'queue', 'status'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'queue', 'status', 'route.ts'), 'export async function GET() { return Response.json({ ok: true }); }\n');
  await mkdir(path.join(repo, 'src', 'lib'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'db.ts'), 'export const prisma = {};\n');
  await writeFile(path.join(repo, 'src', 'lib', 'queue.ts'), `
export function requireQueueAuth(request) {
  return request.headers.get('authorization');
}
export function verifyQueueSignature(signature) {
  return Boolean(signature);
}
`);
  await mkdir(path.join(repo, 'src', 'lib', 'services'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'company-alpha.ts'), `
import { prisma } from '@/lib/db';

export async function listActiveCompaniesAlpha() {
  return prisma.company.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
}
`);
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'company-beta.ts'), `
import { prisma } from '@/lib/db';

export async function listActiveCompaniesBeta() {
  return prisma.company.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
}
`);
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'mixed-workflow.ts'), `
import { prisma } from '@/lib/db';
import { z } from 'zod';

export async function mixedWorkflow(request) {
  const session = await auth();
  const schema = z.object({ id: z.string() });
  const input = schema.parse(await request.json());
  const company = await prisma.company.findUnique({ where: { id: input.id } });
  await fetch(process.env.WEBHOOK_URL, { method: 'POST', body: JSON.stringify(company) });
  await notifyTeam(session.user.email);
  return company;
}

${Array.from({ length: 155 }, (_, index) => `const workflowLine${index} = ${index};`).join('\n')}
`);
  await writeFile(path.join(repo, 'src', 'app', 'page.tsx'), `
const api_secret = "runtimeReviewToken123";
export default function Page() { return <main>OutreachSuite</main>; }
`);
  await writeFile(path.join(repo, 'src', 'middleware.ts'), `
export const config = {
  matcher: ['/api/admin/:path*', '/api/companies/:path*', '/((?!api|_next/static).*)']
};
export function middleware() {}
`);
  await writeFile(path.join(repo, '.env.local'), 'NEXTAUTH_SECRET=secret_1234567890abcdef\n');
  await writeFile(path.join(repo, 'vercel.json'), JSON.stringify({ framework: 'nextjs' }));
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'queue-route', label: 'queue route', source_file: 'src/app/api/queue/status/route.ts', community: 7 },
      { id: 'queue-handler', label: 'handleQueue()', source_file: 'src/app/api/queue/status/route.ts', community: 7 },
      { id: 'queue-service', label: 'QueueService', source_file: 'src/lib/queue.ts', community: 7 },
      { id: 'debug-route', label: 'debug route', source_file: 'src/app/api/debug-env/route.ts', community: 9 },
      { id: 'webhook-route', label: 'stripe webhook', source_file: 'src/app/api/webhooks/stripe/route.ts', community: 10 },
      { id: 'company-alpha-service', label: 'listActiveCompaniesAlpha()', source_file: 'src/lib/services/company-alpha.ts', community: 11 },
      { id: 'company-beta-service', label: 'listActiveCompaniesBeta()', source_file: 'src/lib/services/company-beta.ts', community: 11 },
      { id: 'company-repository', label: 'prisma.company repository', source_file: 'src/lib/db.ts', community: 11 }
    ],
    links: [
      { source: 'queue-route', target: 'queue-handler', confidence: 'EXTRACTED', relation: 'contains' },
      { source: 'queue-handler', target: 'queue-service', confidence: 'EXTRACTED', relation: 'calls' },
      { source: 'debug-route', target: 'queue-service', confidence: 'INFERRED', relation: 'calls' },
      { source: 'webhook-route', target: 'queue-service', confidence: 'INFERRED', relation: 'calls' },
      { source: 'company-alpha-service', target: 'company-repository', confidence: 'EXTRACTED', relation: 'queries' },
      { source: 'company-beta-service', target: 'company-repository', confidence: 'EXTRACTED', relation: 'queries' }
    ]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);

  const result = await runCli(['diagnose', repo, '--run-id', '2026-04-28T140000Z']);

  assert.equal(result.exitCode, 0);
  const runDir = path.join(repo, '.vibepro', 'diagnostics', '2026-04-28T140000Z');
  await stat(path.join(runDir, 'architecture-profile.md'));
  await stat(path.join(runDir, 'finding-review.md'));
  await stat(path.join(runDir, 'refactoring-delta.md'));
  const evidence = await readJson(path.join(runDir, 'evidence.json'));
  assert.equal(evidence.architecture_profile.app_type, 'web_app');
  assert.equal(evidence.architecture_profile.system_type, 'web_application');
  assert.equal(evidence.architecture_profile.rendering, 'nextjs');
  assert.equal(evidence.architecture_profile.frameworks.includes('nextjs'), true);
  assert.equal(evidence.architecture_profile.has_api_routes, true);
  assert.equal(evidence.architecture_profile.has_database, true);
  assert.equal(evidence.architecture_profile.has_auth, true);
  assert.equal(evidence.architecture_profile.auth.includes('next-middleware'), true);
  assert.deepEqual(Object.keys(evidence.architecture_profile.views), [
    'structure',
    'runtime',
    'data',
    'security',
    'deployment',
    'quality'
  ]);
  assert.equal(evidence.architecture_profile.views.structure.components.includes('api_routes'), true);
  assert.equal(evidence.architecture_profile.views.runtime.entrypoints.includes('src/app/api/companies/route.ts'), true);
  assert.equal(evidence.architecture_profile.views.runtime.entrypoints.includes('src/app/api/companies/route.test.ts'), false);
  assert.equal(evidence.architecture_profile.views.runtime.entrypoints.includes('src/app/api/companies/helper.ts'), false);
  assert.equal(evidence.architecture_profile.views.runtime.server_boundaries.includes('api_routes'), true);
  assert.equal(evidence.architecture_profile.views.data.stores.includes('postgres'), true);
  assert.equal(evidence.architecture_profile.views.data.access_patterns.includes('prisma'), true);
  assert.equal(evidence.architecture_profile.views.security.auth_boundaries.some((item) => item.file === 'src/middleware.ts'), true);
  assert.equal(evidence.architecture_profile.views.security.secret_files.includes('.env.local'), true);
  assert.equal(evidence.architecture_profile.views.deployment.targets.includes('vercel'), true);
  assert.equal(evidence.architecture_profile.views.quality.test_tools.includes('vitest'), true);
  assert.equal(evidence.check_catalog.selected_views.includes('security'), true);
  assert.equal(evidence.check_catalog.selected_views.includes('data'), true);
  assert.equal(evidence.check_catalog.applicable_checks.includes('api-boundary'), true);
  assert.equal(evidence.check_catalog.applicable_checks.includes('database-access'), true);
  assert.equal(evidence.check_catalog.applicable_checks.includes('code-quality'), true);
  assert.equal(evidence.check_catalog.applicable_checks.includes('auth-boundary'), true);
  assert.equal(evidence.check_catalog.applicable_checks.includes('static-entry'), false);
  assert.equal(evidence.static_site.secret_hits.some((hit) => hit.file === '.env.local'), true);
  assert.equal(evidence.database_access.unbounded_find_many.length, 1);
  assert.equal(evidence.database_access.unbounded_find_many[0].file, 'src/app/api/companies/route.ts');
  assert.equal(evidence.database_access.unbounded_find_many[0].gate_effect, 'review');
  assert.equal(evidence.code_quality.authorization_order_risks.length, 1, 'DIJ-CONTRACT-012 DIJ-SCENARIO-008 preserves authorization_order_risks in diagnosis evidence');
  assert.equal(evidence.code_quality.authorization_order_risks[0].file, 'src/app/api/accounts/[id]/route.ts', 'DIJ-CONTRACT-012 DIJ-SCENARIO-008 preserves the authorization_order_risks source file');
  assert.equal(evidence.code_quality.duplicate_query_shapes.length, 1);
  assert.equal(evidence.code_quality.duplicate_query_shapes[0].files.includes('src/lib/services/company-alpha.ts'), true);
  assert.equal(evidence.code_quality.duplicate_query_shapes[0].files.includes('src/lib/services/company-beta.ts'), true);
  assert.equal(evidence.code_quality.responsibility_hotspots.length, 1);
  assert.equal(evidence.code_quality.responsibility_hotspots[0].file, 'src/lib/services/mixed-workflow.ts');
  assert.equal(evidence.refactoring_opportunities.length, 2);
  const dryOpportunity = evidence.refactoring_opportunities.find((opportunity) => opportunity.finding_id === 'VP-DRY-001');
  assert.equal(dryOpportunity.source, 'duplicate_query_shape');
  assert.equal(dryOpportunity.refactoring_intent, 'query_policy');
  assert.equal(dryOpportunity.target_files.includes('src/lib/services/company-alpha.ts'), true);
  assert.equal(dryOpportunity.target_files.includes('src/lib/services/company-beta.ts'), true);
  assert.match(dryOpportunity.story_blueprint.title, /重複query形状/);
  assert.equal(dryOpportunity.story_blueprint.acceptance_criteria.some((item) => item.includes('VibePro診断')), true);
  assert.equal(dryOpportunity.graph_context.matched_file_count, 2);
  assert.equal(dryOpportunity.graph_context.related_files.includes('src/lib/db.ts'), true);
  assert.equal(dryOpportunity.graph_context.affected_communities[0].id, 11);
  assert.equal(dryOpportunity.graph_context.affected_communities[0].file_count, 2);
  const archOpportunity = evidence.refactoring_opportunities.find((opportunity) => opportunity.finding_id === 'VP-ARCH-001');
  assert.equal(archOpportunity.refactoring_intent, 'responsibility_split');
  assert.equal(archOpportunity.target_files.includes('src/lib/services/mixed-workflow.ts'), true);
  assert.equal(dryOpportunity.rank > 0, true);
  assert.equal(dryOpportunity.score.total > 0, true);
  assert.equal(dryOpportunity.priority_reasons.includes('confidence:medium'), true);
  assert.equal(evidence.refactoring_campaigns.length, 2);
  assert.equal(evidence.refactoring_campaigns[0].rank, 1);
  assert.equal(evidence.refactoring_campaigns.some((campaign) => campaign.recommended_first_opportunity_id === dryOpportunity.id), true);
  assert.equal(evidence.refactoring_delta.status, 'no_baseline');
  const dryCampaign = evidence.refactoring_campaigns.find((campaign) => campaign.opportunity_ids.includes(dryOpportunity.id));
  assert.equal(dryCampaign.story_blueprint.source_opportunity_ids.includes(dryOpportunity.id), true);
  assert.equal(dryCampaign.expected_diagnostic_delta.duplicate_query_shapes, 1);
  assert.equal(evidence.api_boundary.routes.length, 8);
  assert.equal(evidence.api_boundary.protection_summary.protected_by_middleware, 3);
  assert.equal(evidence.api_boundary.protection_summary.protected_by_route, 1);
  assert.equal(evidence.api_boundary.protection_summary.excluded_by_middleware, 4);
  const adminRoute = evidence.api_boundary.routes.find((route) => route.route_path === '/api/admin/users');
  assert.equal(adminRoute.classification, 'admin');
  assert.equal(adminRoute.protection.status, 'protected_by_middleware');
  assert.equal(adminRoute.protection.evidence.includes('middleware_matcher'), true);
  const adminWebhookMonitorRoute = evidence.api_boundary.routes.find((route) => route.route_path === '/api/admin/webhook-monitor');
  assert.equal(adminWebhookMonitorRoute.classification, 'admin');
  const publicRoute = evidence.api_boundary.routes.find((route) => route.route_path === '/api/companies');
  assert.equal(publicRoute.classification, 'public');
  assert.equal(publicRoute.protection.status, 'protected_by_middleware');
  const debugRoute = evidence.api_boundary.routes.find((route) => route.route_path === '/api/debug-env');
  assert.equal(debugRoute.classification, 'debug');
  assert.equal(debugRoute.protection.status, 'excluded_by_middleware');
  assert.equal(debugRoute.protection.evidence.includes('route_auth_reference'), false);
  assert.equal(debugRoute.risk_hints.includes('debug_route_exposed'), true);
  const webhookRoute = evidence.api_boundary.routes.find((route) => route.route_path === '/api/webhooks/stripe');
  assert.equal(webhookRoute.classification, 'webhook');
  assert.equal(webhookRoute.protection.evidence.includes('webhook_signature_check'), false);
  assert.equal(webhookRoute.risk_hints.includes('webhook_signature_not_detected'), true);
  const internalRoute = evidence.api_boundary.routes.find((route) => route.route_path === '/api/internal/health');
  assert.equal(internalRoute.protection.status, 'protected_by_route');
  assert.equal(internalRoute.protection.evidence.includes('route_auth_reference'), true);
  const queueRoute = evidence.api_boundary.routes.find((route) => route.route_path === '/api/queue/status');
  assert.equal(queueRoute.protection.status, 'excluded_by_middleware');
  assert.equal(queueRoute.protection.evidence.includes('middleware_excludes_api'), true);
  assert.equal(queueRoute.risk_hints.includes('privileged_route_unprotected'), true);
  assert.equal(evidence.action_candidates.length, 5);
  const tasks = await readJson(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'tasks.json'));
  assert.equal(tasks.tasks[0].id, 'VP-TASK-STATIC-002-BLOCK');
  assert.equal(tasks.tasks[0].priority, 'critical');
  assert.equal(tasks.tasks[1].id, 'VP-TASK-STATIC-002-REVIEW');
  assert.equal(tasks.tasks[2].source_id, 'VP-ACTION-API-002');
  assert.equal(tasks.tasks[3].source_id, 'VP-ACTION-API-003');
  assert.equal(tasks.tasks[4].source_id, 'VP-ACTION-API-001');
  assert.equal(tasks.tasks[4].recommended_strategy.id, 'route-level-auth');
  assert.equal(tasks.tasks[4].read_first_files.some((item) => item.file === 'src/lib/queue.ts'), true);
  assert.equal(tasks.tasks[4].target_count, tasks.tasks[4].pre_fix_briefing.target_routes.length);
  assert.equal(tasks.tasks[4].target_files.length, tasks.tasks[4].pre_fix_briefing.target_routes.length);
  assert.equal(tasks.tasks[4].target_groups.length, 1);
  assert.equal(tasks.tasks[4].target_groups[0].id, 'queue-status');
  assert.equal(tasks.tasks[4].target_groups[0].route_count, 1);
  assert.equal(tasks.tasks[4].pre_fix_briefing.current_boundary.middleware.excludes_api, true);
  assert.equal(tasks.tasks[6].source_id, 'VP-DB-001');
  assert.equal(tasks.tasks[6].priority, 'medium');
  assert.equal(tasks.tasks[6].target_files.includes('src/app/api/companies/route.ts'), true);
  assert.equal(tasks.tasks[7].source_id, 'VP-ACTION-DRY-001');
  assert.equal(tasks.tasks[7].target_files.includes('src/lib/services/company-alpha.ts'), true);
  assert.equal(tasks.tasks[7].pre_fix_briefing.opportunity.refactoring_intent, 'query_policy');
  assert.equal(tasks.tasks[7].pre_fix_briefing.campaign.id, dryCampaign.id);
  assert.equal(tasks.tasks[7].graph_context.matched_file_count, 2);
  assert.equal(tasks.tasks[7].read_first_files.some((item) => item.file === 'src/lib/db.ts'), true);
  assert.equal(tasks.tasks[7].pre_fix_briefing.investigation_scope.related_files.includes('src/lib/db.ts'), true);
  assert.equal(tasks.tasks[7].recommended_strategy.id, 'extract-shared-boundary');
  assert.equal(tasks.tasks[8].source_id, 'VP-ACTION-ARCH-001');
  assert.equal(tasks.tasks[8].pre_fix_briefing.opportunity.refactoring_intent, 'responsibility_split');
  const apiAction = evidence.action_candidates.find((candidate) => candidate.id === 'VP-ACTION-API-001');
  assert.equal(apiAction.finding_id, 'VP-API-001');
  assert.equal(apiAction.execution_policy, 'proposal_only');
  assert.equal(apiAction.mutates_repository, false);
  assert.equal(apiAction.target_count, 1);
  assert.equal(apiAction.route_examples[0].route_path, '/api/queue/status');
  assert.equal(apiAction.route_examples[0].file, 'src/app/api/queue/status/route.ts');
  assert.equal(apiAction.graph_context.matched_route_count, 1);
  assert.equal(apiAction.graph_context.matched_node_count, 2);
  assert.equal(apiAction.graph_context.related_edge_count, 2);
  assert.equal(apiAction.graph_context.affected_communities[0].id, 7);
  assert.equal(apiAction.graph_context.hub_nodes.some((node) => node.id === 'queue-service'), true);
  assert.equal(apiAction.graph_context.impact_score > 0, true);
  assert.equal(apiAction.implementation_plan.priority, 'high');
  assert.equal(apiAction.implementation_plan.read_first_files[0].file, 'src/app/api/queue/status/route.ts');
  assert.equal(apiAction.implementation_plan.read_first_files.some((item) => item.file === 'src/middleware.ts'), true);
  assert.equal(apiAction.implementation_plan.read_first_files.some((item) => item.file === 'src/lib/queue.ts'), true);
  assert.match(apiAction.implementation_plan.steps[0].detail, /middleware matcher/);
  assert.match(apiAction.implementation_plan.acceptance_criteria.join('\n'), /保護根拠/);
  assert.equal(apiAction.implementation_plan.pre_fix_briefing.current_boundary.middleware.excludes_api, true);
  assert.equal(apiAction.implementation_plan.pre_fix_briefing.current_boundary.route_protection.excluded_by_middleware, 1);
  const apiAuthHelper = apiAction.implementation_plan.pre_fix_briefing.auth_helpers.find((helper) => helper.file === 'src/lib/queue.ts');
  assert.equal(apiAuthHelper?.functions.includes('requireQueueAuth'), true);
  assert.equal(apiAuthHelper?.functions.includes('verifyQueueSignature'), false);
  assert.equal(apiAction.implementation_plan.pre_fix_briefing.target_routes[0].file, 'src/app/api/queue/status/route.ts');
  assert.equal(apiAction.implementation_plan.pre_fix_briefing.target_routes[0].methods.includes('GET'), true);
  assert.equal(apiAction.implementation_plan.pre_fix_briefing.strategy_options.length, 2);
  assert.equal(apiAction.implementation_plan.pre_fix_briefing.recommended_strategy.id, 'route-level-auth');
  const debugAction = evidence.action_candidates.find((candidate) => candidate.id === 'VP-ACTION-API-002');
  assert.equal(debugAction.target_count, 1);
  assert.equal(debugAction.graph_context.matched_route_count, 1);
  assert.match(debugAction.implementation_plan.steps.map((step) => step.detail).join('\n'), /削除/);
  assert.equal(debugAction.implementation_plan.pre_fix_briefing.recommended_strategy.id, 'delete-debug-routes');
  const webhookAction = evidence.action_candidates.find((candidate) => candidate.id === 'VP-ACTION-API-003');
  assert.equal(webhookAction.target_count, 1);
  assert.equal(webhookAction.graph_context.matched_route_count, 1);
  assert.match(webhookAction.implementation_plan.acceptance_criteria.join('\n'), /署名検証/);
  assert.equal(webhookAction.implementation_plan.pre_fix_briefing.recommended_strategy.id, 'provider-signature-verification');
  assert.equal(
    webhookAction.implementation_plan.pre_fix_briefing.auth_helpers.some((helper) => helper.file === 'src/lib/queue.ts'),
    false
  );
  const dryAction = evidence.action_candidates.find((candidate) => candidate.id === 'VP-ACTION-DRY-001');
  assert.equal(dryAction.finding_id, 'VP-DRY-001');
  assert.equal(dryAction.scope, 'refactoring');
  assert.equal(dryAction.refactoring_opportunity_id, dryOpportunity.id);
  assert.equal(dryAction.refactoring_campaign_id, dryCampaign.id);
  assert.equal(dryAction.target_files.includes('src/lib/services/company-beta.ts'), true);
  assert.equal(dryAction.story_blueprint.refactoring_intent, 'query_policy');
  assert.equal(dryAction.graph_context.matched_file_count, 2);
  assert.equal(dryAction.graph_context.related_files.includes('src/lib/db.ts'), true);
  assert.equal(dryAction.graph_context.hub_nodes.some((node) => node.id === 'company-repository'), true);
  assert.equal(dryAction.implementation_plan.read_first_files.some((item) => item.file === 'src/lib/db.ts'), true);
  assert.equal(dryAction.implementation_plan.pre_fix_briefing.graph_context.impact_score > 0, true);
  assert.equal(dryAction.implementation_plan.pre_fix_briefing.investigation_scope.cross_community, false);
  assert.equal(dryAction.implementation_plan.pre_fix_briefing.opportunity.id, dryOpportunity.id);
  const archAction = evidence.action_candidates.find((candidate) => candidate.id === 'VP-ACTION-ARCH-001');
  assert.equal(archAction.finding_id, 'VP-ARCH-001');
  assert.equal(archAction.scope, 'refactoring');
  assert.equal(archAction.target_files.includes('src/lib/services/mixed-workflow.ts'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-API-002'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-API-003'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-DB-001'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-SEC-004'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-DRY-001'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-ARCH-001'), true);
  assert.equal(evidence.finding_review.status, 'needs_review');
  assert.equal(evidence.finding_review.summary.total, evidence.findings.length);
  assert.equal(evidence.finding_review.summary.unreviewed, evidence.findings.length);
  assert.equal(evidence.finding_review.items.find((item) => item.finding_id === 'VP-API-001').suggested_classification, 'implementation_gap');
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-GRAPH-002'), false);
  assert.equal(evidence.graphify.quality_notices.find((notice) => notice.id === 'VP-GRAPH-002').level, 'info');
  assert.equal(evidence.finding_review.items.find((item) => item.finding_id === 'VP-API-001').allowed_classifications.includes('false_negative'), true);
  const apiFinding = evidence.findings.find((finding) => finding.id === 'VP-API-001');
  assert.match(apiFinding.detail, /excluded_by_middleware: 1件/);
  assert.match(apiFinding.recommendation, /APIを除外しているmiddleware matcher/);
  assert.equal(apiFinding.graph_context.impact_score, apiAction.graph_context.impact_score);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-STATIC-001'), false);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-STATIC-004'), false);
  const summary = await readFile(path.join(runDir, 'summary.md'), 'utf8');
  assert.match(summary, /## アーキテクチャView/);
  assert.match(summary, /Security \|/);
  assert.doesNotMatch(summary, /静的サイト scanned files/);
  assert.match(summary, /共通スキャン対象/);
  assert.match(summary, /DB未ページング候補/);
  assert.match(summary, /認可前bulk DB候補/, 'DIJ-CONTRACT-012 DIJ-SCENARIO-008 preserves authorization_order_risks in diagnosis summary');
  assert.match(summary, /重複query形状候補/);
  assert.match(summary, /責務混在候補/);
  assert.match(summary, /リファクタリング機会/);
  assert.match(summary, /リファクタリングcampaign/);
  assert.match(summary, /保護状態別/);
  assert.match(summary, /excluded_by_middleware \| 4/);
  assert.match(summary, /## 次アクション候補/);
  assert.match(summary, /VP-ACTION-API-001/);
  assert.match(summary, /VP-ACTION-DRY-001/);
  assert.match(summary, /VP-ACTION-ARCH-001/);
  assert.match(summary, /Impact/);
  assert.match(summary, /読むファイル/);
  assert.match(summary, /実装手順/);
  assert.match(summary, /修正前ブリーフィング/);
  assert.match(summary, /## 文脈品質ノート/);
  assert.match(summary, /VP-GRAPH-002/);
  assert.match(summary, /## 診断レビュー/);
  assert.match(summary, /## リファクタリング差分/);
  assert.match(summary, /差分は未算出/);
  assert.match(summary, /suggested implementation_gap/);
  assert.match(summary, /方針A/);
  assert.match(summary, /7\(route: 1, node: 2, edge: 2\)/);
  assert.match(summary, /11\(file: 2, node: 2, edge: 2\)/);
  const riskRegister = await readFile(path.join(runDir, 'risk-register.md'), 'utf8');
  assert.match(riskRegister, /## API境界の保護状態/);
  assert.match(riskRegister, /## 診断レビュー分類/);
  assert.match(riskRegister, /VP-API-001 \| unreviewed \| implementation_gap/);
  assert.match(riskRegister, /excluded_by_middleware \| 4/);
  assert.match(riskRegister, /proposal_only/);
  assert.match(riskRegister, /Impact/);
  const findingReview = await readFile(path.join(runDir, 'finding-review.md'), 'utf8');
  assert.match(findingReview, /# VibePro 診断レビュー/);
  assert.match(findingReview, /true_positive/);
  assert.match(findingReview, /false_positive/);
  assert.match(findingReview, /false_negative/);
  assert.match(findingReview, /detector_gap/);
  assert.match(findingReview, /implementation_gap/);
  const storyReport = await runCli(['story', 'report', repo]);
  assert.equal(storyReport.exitCode, 0);
  const report = await readFile(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'story-report.md'), 'utf8');
  assert.doesNotMatch(report, /## 静的サイト診断/);
  assert.match(report, /## 共通スキャン/);
  assert.match(report, /## API境界/);
  assert.match(report, /protected_by_route \| 1/);
  assert.match(report, /## 診断レビュー/);
  assert.match(report, /implementation_gap/);
  assert.match(report, /## 次アクション候補/);
  assert.match(report, /## 生成タスク/);
  assert.match(report, /VP-TASK-API-001/);
  assert.match(report, /Impact/);
  assert.match(report, /実装手順/);
  assert.match(report, /修正前ブリーフィング/);
  await runCli(['brainbase', repo]);
  const importSummary = await readFile(path.join(repo, '.vibepro', 'brainbase', 'import-summary.md'), 'utf8');
  assert.doesNotMatch(importSummary, /静的サイト走査ファイル/);
  assert.match(importSummary, /共通スキャン対象/);
  assert.match(importSummary, /## API境界/);
  assert.match(importSummary, /認可前bulk DB候補/, 'DIJ-CONTRACT-012 DIJ-SCENARIO-008 preserves authorization_order_risks in Brainbase import summary');
  assert.match(importSummary, /重複query形状候補/);
  assert.match(importSummary, /責務混在候補/);
  assert.match(importSummary, /リファクタリング機会/);
  assert.match(importSummary, /リファクタリングcampaign/);
  assert.match(importSummary, /リファクタリング差分/);
  assert.match(importSummary, /excluded_by_middleware \| 4/);
  assert.match(importSummary, /## 診断レビュー/);
  assert.doesNotMatch(importSummary, /suggested detector_gap: [1-9]/);
  assert.match(importSummary, /## 次アクション候補/);
  assert.match(importSummary, /## 生成タスク/);
  assert.match(importSummary, /VP-TASK-API-001/);
  assert.match(importSummary, /Impact/);
  assert.match(importSummary, /読むファイル/);
  assert.match(importSummary, /修正前ブリーフィング/);
  const importState = await readJson(path.join(repo, '.vibepro', 'brainbase', 'import-state.json'));
  assert.equal(importState.signals.architecture_profile.system_type, 'web_application');
  assert.equal(importState.signals.architecture_profile.views.security.auth_boundaries.length, 1);
  assert.equal(importState.signals.check_catalog.selected_views.includes('runtime'), true);
  assert.equal(importState.signals.api_boundary.route_count, 8);
  assert.equal(importState.signals.api_boundary.summary.debug, 1);
  assert.equal(importState.signals.api_boundary.protection_summary.excluded_by_middleware, 4);
  assert.equal(importState.signals.code_quality.authorization_order_risks_count, 1, 'DIJ-CONTRACT-012 DIJ-SCENARIO-008 preserves authorization_order_risks in Brainbase import state');
  assert.equal(importState.signals.code_quality.duplicate_query_shapes_count, 1);
  assert.equal(importState.signals.code_quality.responsibility_hotspots_count, 1);
  assert.equal(importState.signals.refactoring_opportunities.length, 2);
  assert.equal(importState.signals.refactoring_opportunities[0].rank > 0, true);
  assert.equal(importState.signals.refactoring_opportunities[0].story_blueprint.source_finding_id, 'VP-DRY-001');
  assert.equal(importState.signals.refactoring_opportunities.find((opportunity) => opportunity.id === dryOpportunity.id).graph_context.matched_file_count, 2);
  assert.equal(importState.signals.refactoring_campaigns.length, 2);
  assert.equal(importState.signals.refactoring_delta.status, 'no_baseline');
  assert.equal(importState.signals.refactoring_campaigns.some((campaign) => campaign.opportunity_ids.includes(dryOpportunity.id)), true);
  assert.equal(importState.signals.refactoring_campaigns.find((campaign) => campaign.opportunity_ids.includes(dryOpportunity.id)).graph_context.related_files.includes('src/lib/db.ts'), true);
  assert.equal(importState.signals.finding_review.summary.total, importState.findings.length);
  assert.equal(importState.signals.graphify.quality_notices.find((notice) => notice.id === 'VP-GRAPH-002').level, 'info');
  assert.equal(importState.findings.find((finding) => finding.id === 'VP-API-001').review.suggested_classification, 'implementation_gap');
  assert.equal(importState.signals.tasks.length, 9);
  assert.equal(importState.signals.tasks[0].id, 'VP-TASK-STATIC-002-BLOCK');
  assert.equal(importState.signals.tasks[4].source_id, 'VP-ACTION-API-001');
  assert.equal(importState.signals.tasks[6].source_id, 'VP-DB-001');
  assert.equal(importState.signals.tasks[7].source_id, 'VP-ACTION-DRY-001');
  assert.equal(importState.signals.tasks[8].source_id, 'VP-ACTION-ARCH-001');
  assert.equal(importState.signals.action_candidates.length, 5);
  assert.equal(importState.signals.action_candidates[0].mutates_repository, false);
  assert.equal(importState.signals.action_candidates[0].graph_context.matched_route_count, 1);
  assert.equal(importState.signals.action_candidates[0].implementation_plan.read_first_files.some((item) => item.file === 'src/lib/queue.ts'), true);
  assert.equal(importState.signals.action_candidates[0].implementation_plan.pre_fix_briefing.recommended_strategy.id, 'route-level-auth');
  const importedDryAction = importState.signals.action_candidates.find((candidate) => candidate.id === 'VP-ACTION-DRY-001');
  assert.equal(importedDryAction.refactoring_opportunity_id, dryOpportunity.id);
  assert.equal(importedDryAction.refactoring_campaign_id, dryCampaign.id);
  assert.equal(importedDryAction.story_blueprint.refactoring_intent, 'query_policy');
  assert.equal(importedDryAction.target_files.includes('src/lib/services/company-alpha.ts'), true);
  assert.equal(importedDryAction.graph_context.matched_file_count, 2);
  assert.equal(importedDryAction.implementation_plan.read_first_files.some((item) => item.file === 'src/lib/db.ts'), true);
  assert.equal(importState.findings.find((finding) => finding.id === 'VP-API-001').graph_context.impact_score > 0, true);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(
    manifest.runs[0].artifacts.architecture_profile,
    '.vibepro/diagnostics/2026-04-28T140000Z/architecture-profile.md'
  );
  assert.equal(
    manifest.runs[0].artifacts.finding_review,
    '.vibepro/diagnostics/2026-04-28T140000Z/finding-review.md'
  );
  assert.equal(
    manifest.runs[0].artifacts.refactoring_delta,
    '.vibepro/diagnostics/2026-04-28T140000Z/refactoring-delta.md'
  );

  const designInputResult = await runCli([
    'story',
    'diagnose',
    repo,
    '--id',
    'story-vibepro-diagnosis-commercialization-roadmap',
    '--phase',
    'design-input',
    '--run-id',
    '2026-04-28T141500Z'
  ]);
  assert.equal(designInputResult.exitCode, 0);
  const designInputRunDir = path.join(repo, '.vibepro', 'diagnostics', '2026-04-28T141500Z');
  const designInputEvidence = await readJson(path.join(designInputRunDir, 'evidence.json'));
  assert.equal(
    designInputEvidence.code_quality.authorization_order_risks.length,
    1,
    'DIJ-CONTRACT-012 DIJ-SCENARIO-008 preserves authorization_order_risks in design-input diagnosis evidence'
  );
  const designInputSummary = await readFile(path.join(designInputRunDir, 'summary.md'), 'utf8');
  assert.match(
    designInputSummary,
    /認可前bulk DB候補/,
    'DIJ-CONTRACT-012 DIJ-SCENARIO-008 preserves authorization_order_risks in design-input summary'
  );
  await runCli(['brainbase', repo]);
  const designInputImportSummary = await readFile(path.join(repo, '.vibepro', 'brainbase', 'import-summary.md'), 'utf8');
  assert.match(
    designInputImportSummary,
    /認可前bulk DB候補/,
    'DIJ-CONTRACT-012 DIJ-SCENARIO-008 preserves authorization_order_risks in design-input Brainbase import summary'
  );
  const designInputImportState = await readJson(path.join(repo, '.vibepro', 'brainbase', 'import-state.json'));
  assert.equal(designInputImportState.latest_run.run_id, '2026-04-28T141500Z');
  assert.equal(
    designInputImportState.signals.code_quality.authorization_order_risks_count,
    1,
    'DIJ-CONTRACT-012 DIJ-SCENARIO-008 preserves authorization_order_risks in design-input Brainbase import state'
  );
});

test('diagnose records refactoring delta against the previous story run', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-refactoring-delta-test-'));
  await mkdir(path.join(repo, 'src', 'app'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'services'), { recursive: true });
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    scripts: { dev: 'next dev' },
    dependencies: {
      '@prisma/client': '^5.0.0',
      next: '^14.0.0',
      react: '^18.2.0'
    }
  }));
  await writeFile(path.join(repo, 'src', 'app', 'page.tsx'), 'export default function Page() { return <main>Example App</main>; }\n');
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'company-alpha.ts'), `
import { prisma } from '@/lib/db';

export async function listActiveCompaniesAlpha() {
  return prisma.company.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
}
`);
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'company-beta.ts'), `
import { prisma } from '@/lib/db';

export async function listActiveCompaniesBeta() {
  return prisma.company.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
}
`);
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'company-gamma.ts'), `
import { prisma } from '@/lib/db';

export async function listActiveCompaniesGamma() {
  return prisma.company.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
}
`);
  await runCli(['init', repo, '--story-id', 'story-refactoring-delta', '--title', '差分計測']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);

  const beforeResult = await runCli(['diagnose', repo, '--run-id', 'run-before']);
  assert.equal(beforeResult.exitCode, 0);

  await writeFile(path.join(repo, 'src', 'lib', 'services', 'company-beta.ts'), `
import { prisma } from '@/lib/db';

export async function listActiveCompaniesBeta() {
  return prisma.company.findMany({
    where: { archived: false },
    select: { id: true, displayName: true },
    orderBy: { updatedAt: 'desc' },
    take: 20
  });
}
`);

  const afterResult = await runCli(['diagnose', repo, '--run-id', 'run-after']);
  assert.equal(afterResult.exitCode, 0);
  const afterRunDir = path.join(repo, '.vibepro', 'diagnostics', 'run-after');
  const afterEvidence = await readJson(path.join(afterRunDir, 'evidence.json'));
  assert.equal(afterEvidence.refactoring_delta.status, 'available');
  const improved = afterEvidence.refactoring_delta.top_improvements.find((item) => item.status === 'improved');
  assert.match(improved.key, /company\.findMany/);
  assert.equal(improved.before.target_file_count, 3);
  assert.equal(improved.before.occurrence_count, 3);
  assert.equal(improved.after.target_file_count, 2);
  assert.equal(improved.after.occurrence_count, 2);
  assert.equal(afterEvidence.refactoring_delta.top_remaining[0].key, improved.key);
  assert.equal(afterEvidence.refactoring_delta.top_remaining[0].after.target_file_count, 2);
  const deltaReport = await readFile(path.join(afterRunDir, 'refactoring-delta.md'), 'utf8');
  assert.match(deltaReport, /## 残っている上位候補/);
  assert.match(deltaReport, /3ファイル \/ 3出現/);
  assert.match(deltaReport, /2ファイル \/ 2出現/);
  const summary = await readFile(path.join(afterRunDir, 'summary.md'), 'utf8');
  assert.match(summary, /## リファクタリング差分/);
  assert.match(summary, /3ファイル \/ 3出現 -> 2ファイル \/ 2出現/);
  assert.match(summary, /次の候補/);
});

test('brainbase creates an import state from the latest VibePro manifest run', async () => {
  const repo = await makeRepo();
  await writeFile(path.join(repo, 'app.js'), 'document.body.innerHTML = location.hash;\n');
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }, { id: 'page' }],
    edges: [
      { source: 'app', target: 'page', relation: 'renders', confidence: 'AMBIGUOUS' }
    ]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T150000Z']);

  const result = await runCli(['brainbase', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.command, 'brainbase');
  const importStatePath = path.join(repo, '.vibepro', 'brainbase', 'import-state.json');
  const importSummaryPath = path.join(repo, '.vibepro', 'brainbase', 'import-summary.md');
  await stat(importSummaryPath);
  const importState = await readJson(importStatePath);
  assert.equal(importState.schema_version, '0.1.0');
  assert.equal(importState.story.story_id, 'story-vibepro-diagnosis-commercialization-roadmap');
  assert.equal(importState.latest_run.run_id, '2026-04-28T150000Z');
  assert.equal(importState.latest_run.gate_status, 'needs_review');
  assert.equal(importState.signals.graphify.node_count, 2);
  assert.equal(importState.signals.graphify.ambiguous_edges_count, 1);
  assert.equal(importState.signals.architecture_profile.app_type, 'static_site');
  assert.equal(importState.signals.check_catalog.applicable_checks.includes('static-entry'), true);
  assert.equal(importState.signals.static_site.xss_risk_hits_count, 1);
  assert.equal(importState.findings.some((finding) => finding.id === 'VP-STATIC-003'), true);
  assert.match(await readFile(importSummaryPath, 'utf8'), /Portfolio Dashboard import state/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.artifacts.brainbase_import_state, '.vibepro/brainbase/import-state.json');
});

test('brainbase import state supports multiple stories with NocoDB horizon, view, period, and dates', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.brainbase = {
    stories: [
      {
        story_id: 'story-vibepro-diagnosis-commercialization-roadmap',
        title: 'M1: VibePro 診断→商用化ロードマップ',
        horizon: 'month',
        view: 'dev',
        period: '2026-04',
        started_at: '2026-04-01',
        due_at: '2026-04-30'
      },
      {
        story_id: 'story-vibepro-brainbase-rollup',
        title: 'Portfolio dashboard import',
        horizon: 'quarter',
        view: 'business',
        period: '2026Q2',
        started_at: '2026-04-01',
        due_at: '2026-06-30'
      }
    ]
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T180000Z']);

  const result = await runCli(['brainbase', repo]);

  assert.equal(result.exitCode, 0);
  const importState = await readJson(path.join(repo, '.vibepro', 'brainbase', 'import-state.json'));
  assert.equal(importState.stories.length, 2);
  assert.deepEqual(importState.stories.map((story) => story.story_id), [
    'story-vibepro-diagnosis-commercialization-roadmap',
    'story-vibepro-brainbase-rollup'
  ]);
  assert.equal(importState.stories[0].horizon, 'month');
  assert.equal(importState.stories[0].view, 'dev');
  assert.equal(importState.stories[0].period, '2026-04');
  assert.equal(importState.stories[0].started_at, '2026-04-01');
  assert.equal(importState.stories[0].due_at, '2026-04-30');
  assert.equal(importState.stories[1].horizon, 'quarter');
  assert.equal(importState.stories[1].period, '2026Q2');
  assert.equal(importState.story.story_id, 'story-vibepro-diagnosis-commercialization-roadmap');
  assert.match(await readFile(path.join(repo, '.vibepro', 'brainbase', 'import-summary.md'), 'utf8'), /2026Q2/);
});

test('brainbase sync-stories updates config stories from NocoDB Story records before import', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T210000Z']);
  const requests = [];
  const fakeFetch = async (url, options) => {
    requests.push({ url, token: options.headers['xc-token'] });
    if (url.includes('/api/v1/db/meta/tables/')) {
      return jsonResponse({
        columns: [
          { title: 'Story ID', column_name: 'story_id' },
          { title: '名前', column_name: 'name' },
          { title: 'ステータス', column_name: 'status' },
          { title: 'Horizon', column_name: 'horizon' },
          { title: 'View', column_name: 'view' },
          { title: 'Period', column_name: 'period' },
          { title: '開始日', column_name: 'started_at' },
          { title: '期限日', column_name: 'due_at' }
        ]
      });
    }
    return jsonResponse({
      list: [
        {
          'Story ID': 'story-active-dev',
          '名前': 'Dev Story',
          'ステータス': 'active',
          Horizon: 'sprint',
          View: 'dev',
          Period: '2026-W18',
          '開始日': '2026-04-27',
          '期限日': '2026-05-01'
        },
        {
          'Story ID': 'story-archived',
          '名前': 'Archived Story',
          'ステータス': 'archived',
          Horizon: 'month',
          View: 'business',
          Period: '2026-04',
          '開始日': '2026-04-01',
          '期限日': '2026-04-30'
        },
        {
          'Story ID': 'story-active-business',
          '名前': 'Business Story',
          'ステータス': 'active',
          Horizon: 'quarter',
          View: 'business',
          Period: '2026Q2',
          '開始日': '2026-04-01',
          '期限日': '2026-06-30'
        }
      ],
      pageInfo: { isLastPage: true }
    });
  };

  const result = await runCli(['brainbase', repo, '--sync-stories'], {
    env: {
      NOCODB_URL: 'https://noco.example.test',
      NOCODB_TOKEN: 'test-token',
      NOCODB_STORY_BASE_ID: 'base-1',
      NOCODB_STORY_TABLE_ID: 'table-1'
    },
    fetch: fakeFetch
  });

  assert.equal(result.exitCode, 0);
  assert.equal(requests.length, 2);
  assert.equal(requests.every((request) => request.token === 'test-token'), true);
  const config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.deepEqual(config.brainbase.stories.map((story) => story.story_id), [
    'story-active-dev',
    'story-active-business'
  ]);
  assert.equal(config.brainbase.story_source.table_id, 'table-1');
  const importState = await readJson(path.join(repo, '.vibepro', 'brainbase', 'import-state.json'));
  assert.equal(importState.stories.length, 2);
  assert.equal(importState.stories[0].horizon, 'sprint');
  assert.equal(importState.stories[1].period, '2026Q2');
});

test('brainbase publish-status replaces the VibePro diagnosis section in the NocoDB Story description', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }],
    edges: [{ source: 'app', target: 'unknown', relation: 'depends_on', confidence: 'AMBIGUOUS' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T230000Z']);
  const requests = [];
  let description = '既存説明\n\n<!-- vibepro:diagnosis-sync:start -->\n古い診断\n<!-- vibepro:diagnosis-sync:end -->\n\n手書きメモ';
  const fakeFetch = async (url, options) => {
    requests.push({ url, method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (url.includes('/api/v1/db/meta/tables/')) {
      return jsonResponse({
        columns: [
          { title: 'Story ID', column_name: 'story_id' },
          { title: '説明', column_name: 'description' }
        ]
      });
    }
    if ((options.method ?? 'GET') === 'PATCH') {
      description = JSON.parse(options.body).説明;
      return jsonResponse({ Id: 42 });
    }
    return jsonResponse({
      list: [{
        Id: 42,
        'Story ID': 'story-vibepro-diagnosis-commercialization-roadmap',
        '説明': description
      }],
      pageInfo: { isLastPage: true }
    });
  };

  const result = await runCli(['brainbase', repo, '--publish-status'], {
    env: {
      NOCODB_URL: 'https://noco.example.test',
      NOCODB_TOKEN: 'test-token',
      NOCODB_STORY_BASE_ID: 'base-1',
      NOCODB_STORY_TABLE_ID: 'table-1'
    },
    fetch: fakeFetch
  });

  assert.equal(result.exitCode, 0);
  const patch = requests.find((request) => request.method === 'PATCH');
  assert.ok(patch);
  assert.match(patch.url, /\/api\/v1\/db\/data\/noco\/base-1\/table-1\/42$/);
  assert.equal(patch.body.ステータス, undefined);
  assert.match(patch.body.説明, /既存説明/);
  assert.match(patch.body.説明, /手書きメモ/);
  assert.match(patch.body.説明, /VibePro診断同期/);
  assert.match(patch.body.説明, /Gate: needs_review/);
  assert.doesNotMatch(patch.body.説明, /古い診断/);
});

test('brainbase publish-status writes backup and result artifacts after verified NocoDB update', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }],
    edges: [{ source: 'app', target: 'unknown', relation: 'depends_on', confidence: 'AMBIGUOUS' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T230500Z']);
  let description = '既存説明\n\n手書きメモ';
  const requests = [];
  const fakeFetch = async (url, options) => {
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ url, method, body });
    if (url.includes('/api/v1/db/meta/tables/')) {
      return jsonResponse({
        columns: [
          { title: 'Story ID', column_name: 'story_id' },
          { title: '説明', column_name: 'description' }
        ]
      });
    }
    if (method === 'PATCH') {
      description = body.説明;
      return jsonResponse({ '番号': 2 });
    }
    return jsonResponse({
      list: [{
        '番号': 2,
        'Story ID': 'story-vibepro-diagnosis-commercialization-roadmap',
        '説明': description
      }],
      pageInfo: { isLastPage: true }
    });
  };

  const result = await runCli(['brainbase', repo, '--publish-status'], {
    env: {
      NOCODB_URL: 'https://noco.example.test',
      NOCODB_TOKEN: 'test-token',
      NOCODB_STORY_BASE_ID: 'base-1',
      NOCODB_STORY_TABLE_ID: 'table-1'
    },
    fetch: fakeFetch
  });

  assert.equal(result.exitCode, 0);
  const patch = requests.find((request) => request.method === 'PATCH');
  assert.ok(patch);
  assert.match(patch.url, /\/2$/);
  const backup = await readJson(path.join(repo, '.vibepro', 'brainbase', 'publish-backup.json'));
  assert.equal(backup.story_id, 'story-vibepro-diagnosis-commercialization-roadmap');
  assert.equal(backup.record_id, 2);
  assert.match(backup.existing_description, /手書きメモ/);
  const publishResult = await readJson(path.join(repo, '.vibepro', 'brainbase', 'publish-result.json'));
  assert.equal(publishResult.verified, true);
  assert.equal(publishResult.description_matches_expected, true);
  assert.equal(publishResult.updated_fields.length, 1);
  assert.equal(publishResult.updated_fields[0], '説明');
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.brainbase.last_publish_result.backup_json, '.vibepro/brainbase/publish-backup.json');
  assert.equal(manifest.brainbase.last_publish_result.result_json, '.vibepro/brainbase/publish-result.json');
});

test('brainbase publish-status dry-run writes preview artifacts without patching NocoDB', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }],
    edges: [{ source: 'app', target: 'unknown', relation: 'depends_on', confidence: 'AMBIGUOUS' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T231500Z']);
  const requests = [];
  const fakeFetch = async (url, options) => {
    requests.push({ url, method: options.method ?? 'GET' });
    if (url.includes('/api/v1/db/meta/tables/')) {
      return jsonResponse({
        columns: [
          { title: 'Story ID', column_name: 'story_id' },
          { title: '説明', column_name: 'description' }
        ]
      });
    }
    return jsonResponse({
      list: [{
        Id: 42,
        'Story ID': 'story-vibepro-diagnosis-commercialization-roadmap',
        '説明': '既存説明'
      }],
      pageInfo: { isLastPage: true }
    });
  };

  const result = await runCli(['brainbase', repo, '--publish-status', '--dry-run'], {
    env: {
      NOCODB_URL: 'https://noco.example.test',
      NOCODB_TOKEN: 'test-token',
      NOCODB_STORY_BASE_ID: 'base-1',
      NOCODB_STORY_TABLE_ID: 'table-1'
    },
    fetch: fakeFetch
  });

  assert.equal(result.exitCode, 0);
  assert.equal(requests.some((request) => request.method === 'PATCH'), false);
  const preview = await readJson(path.join(repo, '.vibepro', 'brainbase', 'publish-preview.json'));
  assert.equal(preview.dry_run, true);
  assert.equal(preview.story_id, 'story-vibepro-diagnosis-commercialization-roadmap');
  assert.equal(preview.latest_run_id, '2026-04-28T231500Z');
  assert.match(preview.next_description, /Gate: needs_review/);
  assert.match(await readFile(path.join(repo, '.vibepro', 'brainbase', 'publish-preview.md'), 'utf8'), /PATCHは実行していない/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.brainbase.last_publish_preview.preview_json, '.vibepro/brainbase/publish-preview.json');
});

test('brainbase publish-status dry-run can target an explicit story id', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.brainbase.stories = [
    { story_id: 'story-first', title: 'First', ssot: 'NocoDB' },
    { story_id: 'story-target', title: 'Target', ssot: 'NocoDB' }
  ];
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T234000Z']);
  const requestedUrls = [];
  const fakeFetch = async (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/v1/db/meta/tables/')) {
      return jsonResponse({
        columns: [
          { title: 'Story ID', column_name: 'story_id' },
          { title: '説明', column_name: 'description' }
        ]
      });
    }
    return jsonResponse({
      list: [{ Id: 99, 'Story ID': 'story-target', '説明': 'target description' }],
      pageInfo: { isLastPage: true }
    });
  };

  const result = await runCli(['brainbase', repo, '--publish-status', '--dry-run', '--story-id', 'story-target'], {
    env: {
      NOCODB_URL: 'https://noco.example.test',
      NOCODB_TOKEN: 'test-token',
      NOCODB_STORY_BASE_ID: 'base-1',
      NOCODB_STORY_TABLE_ID: 'table-1'
    },
    fetch: fakeFetch
  });

  assert.equal(result.exitCode, 0);
  assert.equal(requestedUrls.some((url) => url.includes('story-target')), true);
  assert.equal(requestedUrls.some((url) => url.includes('story-first')), false);
  const preview = await readJson(path.join(repo, '.vibepro', 'brainbase', 'publish-preview.json'));
  assert.equal(preview.story_id, 'story-target');
});

test('brainbase publish-status fails when explicit story id is not in import state', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T234500Z']);

  const result = await runCli(['brainbase', repo, '--publish-status', '--dry-run', '--story-id', 'missing-story'], {
    env: {
      NOCODB_URL: 'https://noco.example.test',
      NOCODB_TOKEN: 'test-token',
      NOCODB_STORY_BASE_ID: 'base-1',
      NOCODB_STORY_TABLE_ID: 'table-1'
    },
    fetch: async () => {
      throw new Error('fetch should not be called');
    }
  });

  assert.equal(result.exitCode, 1);
});

test('story derive supports modular-web preset for non Next.js layouts', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  await mkdir(path.join(repo, 'cli'), { recursive: true });
  await mkdir(path.join(repo, 'lib', 'services'), { recursive: true });
  await mkdir(path.join(repo, 'mcp', 'server'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'modules', 'core'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'modules', 'domain', 'task'), { recursive: true });
  await mkdir(path.join(repo, 'server', 'routes'), { recursive: true });
  await writeFile(path.join(repo, 'cli', 'index.js'), 'export function main() {}\n');
  await writeFile(path.join(repo, 'lib', 'services', 'auth-service.js'), 'export class AuthService {}\n');
  await writeFile(path.join(repo, 'mcp', 'server', 'index.js'), 'export function startServer() {}\n');
  await writeFile(path.join(repo, 'public', 'modules', 'core', 'event-bus.js'), 'export const eventBus = {};\n');
  await writeFile(path.join(repo, 'public', 'modules', 'domain', 'task', 'task-service.js'), 'export class TaskService {}\n');
  await writeFile(path.join(repo, 'server', 'routes', 'api.js'), 'export default function api() {}\n');

  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'cli_index', source_file: 'cli/index.js', label: 'cli/index.js' },
      { id: 'lib_auth', source_file: 'lib/services/auth-service.js', label: 'AuthService' },
      { id: 'mcp_server', source_file: 'mcp/server/index.js', label: 'mcp server' },
      { id: 'web_core', source_file: 'public/modules/core/event-bus.js', label: 'eventBus' },
      { id: 'web_domain_task', source_file: 'public/modules/domain/task/task-service.js', label: 'TaskService' },
      { id: 'server_route', source_file: 'server/routes/api.js', label: 'api route' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo, '--preset', 'modular-web']);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.source.preset, 'modular-web');
  assert.ok(catalog.coverage.totals.graph_story_relevant_files > 0,
    `expected coverage.relevant_files > 0, got ${catalog.coverage.totals.graph_story_relevant_files}`);
  assert.ok(catalog.coverage.by_role.length > 0,
    `expected by_role to have entries, got ${JSON.stringify(catalog.coverage.by_role)}`);

  const roles = catalog.coverage.by_role.map((entry) => entry.role);
  const expectedAny = ['cli', 'mcp_server', 'web_core', 'web_module', 'domain_service', 'server_route'];
  assert.ok(roles.some((role) => expectedAny.includes(role)),
    `expected modular-web role in ${JSON.stringify(roles)}`);

  const codeSurface = catalog.stories.filter((story) => story.source.type === 'code_surface');
  assert.ok(codeSurface.length >= 1,
    `expected at least 1 code_surface story for modular-web, got ${codeSurface.length}`);
});

test('story derive does not leak next-app product stories into modular-web preset', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.story_catalog = { preset: 'modular-web' };
  await writeFile(configPath, JSON.stringify(config, null, 2));

  await mkdir(path.join(repo, 'lib', 'services', 'auth'), { recursive: true });
  await mkdir(path.join(repo, 'lib', 'services', 'stripe'), { recursive: true });
  await writeFile(path.join(repo, 'lib', 'services', 'auth', 'session.js'), 'export {}\n');
  await writeFile(path.join(repo, 'lib', 'services', 'stripe', 'billing.js'), 'export {}\n');

  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'auth', source_file: 'lib/services/auth/session.js', label: 'auth-session' },
      { id: 'bill', source_file: 'lib/services/stripe/billing.js', label: 'billing' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const nextAppProductIds = [
    'story-product-auth-account-access',
    'story-product-premium-billing',
    'story-product-content-cms'
  ];
  const leaked = catalog.stories.filter((s) => nextAppProductIds.includes(s.story_id));
  assert.equal(leaked.length, 0,
    `next-app product stories must not leak into modular-web preset, found ${JSON.stringify(leaked.map((s) => s.story_id))}`);
});

test('story derive uses salestailor preset without next-app product story leakage', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  await mkdir(path.join(repo, 'src', 'app', 'projects', '[projectId]', 'sample-review'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'projects', '[projectId]', 'sample-review', 'regenerate'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'services', 'prompt-improvement'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'services', 'formSubmission'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'projects', '[projectId]', 'sample-review', 'page.tsx'),
    'export default function Page() { return <main>OutreachSuite</main>; }\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'projects', '[projectId]', 'sample-review', 'regenerate', 'route.ts'),
    'export async function POST() {}\n');
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'prompt-improvement', 'promptFeedbackService.ts'),
    'export class PromptFeedbackService {}\n');
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'formSubmission', 'formSubmissionOrchestrator.ts'),
    'export class FormSubmissionOrchestrator {}\n');

  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'review_page', source_file: 'src/app/projects/[projectId]/sample-review/page.tsx', label: 'SampleReview' },
      { id: 'regen_route', source_file: 'src/app/api/projects/[projectId]/sample-review/regenerate/route.ts', label: 'regenerate' },
      { id: 'feedback', source_file: 'src/lib/services/prompt-improvement/promptFeedbackService.ts', label: 'PromptFeedbackService' },
      { id: 'form', source_file: 'src/lib/services/formSubmission/formSubmissionOrchestrator.ts', label: 'FormSubmissionOrchestrator' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo, '--preset', 'salestailor']);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.source.preset, 'salestailor');
  const storyIds = catalog.stories.map((story) => story.story_id);
  assert.ok(storyIds.includes('story-salestailor-letter-generation-review'));
  assert.ok(storyIds.includes('story-salestailor-prompt-improvement-loop'));
  assert.ok(storyIds.includes('story-salestailor-contact-form-automation'));
  assert.equal(storyIds.some((id) => id === 'story-product-auth-account-access' || id === 'story-product-premium-billing'), false,
    `salestailor preset must not emit next-app story ids, got ${JSON.stringify(storyIds)}`);

  const serialized = JSON.stringify(catalog);
  assert.doesNotMatch(serialized, /ExampleTravel|ホテル|旅行|hotel|shadow-call/i);
});

test('story derive emits story_candidates clustering uncovered files', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.story_catalog = { preset: 'modular-web' };
  await writeFile(configPath, JSON.stringify(config, null, 2));

  // lib/auth/* and lib/legacy/* match modular-web relevant patterns but NOT
  // codeSurfaceSignatures, so they end up in coverage.uncovered.
  await mkdir(path.join(repo, 'lib', 'auth'), { recursive: true });
  await mkdir(path.join(repo, 'lib', 'legacy'), { recursive: true });
  for (let i = 0; i < 5; i += 1) {
    await writeFile(path.join(repo, 'lib', 'auth', `auth${i}.js`), 'export {}\n');
  }
  for (let i = 0; i < 6; i += 1) {
    await writeFile(path.join(repo, 'lib', 'legacy', `legacy${i}.js`), 'export {}\n');
  }

  const nodes = [];
  for (let i = 0; i < 5; i += 1) nodes.push({ id: `auth_${i}`, source_file: `lib/auth/auth${i}.js`, label: `auth${i}` });
  for (let i = 0; i < 6; i += 1) nodes.push({ id: `legacy_${i}`, source_file: `lib/legacy/legacy${i}.js`, label: `legacy${i}` });
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({ nodes, links: [] }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.ok(Array.isArray(catalog.story_candidates),
    `catalog.story_candidates must be an array, got ${typeof catalog.story_candidates}`);
  assert.ok(catalog.story_candidates.length >= 2,
    `expected >= 2 candidates from uncovered clusters, got ${catalog.story_candidates.length} (uncovered=${catalog.coverage.totals.uncovered_files})`);

  const authCandidate = catalog.story_candidates.find((c) => c.common_path === 'lib/auth');
  assert.ok(authCandidate, `expected candidate for lib/auth, got ${JSON.stringify(catalog.story_candidates.map((c) => c.common_path))}`);
  assert.equal(authCandidate.role, 'auth');
  assert.equal(authCandidate.file_count, 5);
  assert.equal(authCandidate.confidence, 'medium');
  assert.match(authCandidate.candidate_id, /^candidate-auth-/);
  assert.ok(authCandidate.evidence.length > 0);
  assert.ok(authCandidate.open_questions.length > 0);

  const legacyCandidate = catalog.story_candidates.find((c) => c.common_path === 'lib/legacy');
  assert.ok(legacyCandidate);
  assert.equal(legacyCandidate.role, 'lib_module');
  assert.equal(legacyCandidate.file_count, 6);

  const map = await readFile(path.join(repo, '.vibepro', 'stories', 'story-map.md'), 'utf8');
  assert.match(map, /## Story候補（uncovered cluster）/);
  assert.match(map, /candidate-auth-lib-auth/);
});

test('modular-web preset coveragePatterns absorb broader paths into active stories', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.story_catalog = { preset: 'modular-web' };
  await writeFile(configPath, JSON.stringify(config, null, 2));

  await mkdir(path.join(repo, 'cli', 'sub'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'modules', 'utils'), { recursive: true });
  await mkdir(path.join(repo, 'server', 'controllers'), { recursive: true });
  await writeFile(path.join(repo, 'cli', 'main.js'), 'export {}\n');
  await writeFile(path.join(repo, 'cli', 'sub', 'extra.js'), 'export {}\n');
  await writeFile(path.join(repo, 'public', 'modules', 'utils', 'helper.js'), 'export {}\n');
  await writeFile(path.join(repo, 'server', 'controllers', 'foo-controller.js'), 'export {}\n');

  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'cli_main', source_file: 'cli/main.js', label: 'main' },
      { id: 'cli_extra', source_file: 'cli/sub/extra.js', label: 'extra' },
      { id: 'utils_helper', source_file: 'public/modules/utils/helper.js', label: 'helper' },
      { id: 'foo_ctrl', source_file: 'server/controllers/foo-controller.js', label: 'foo' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.coverage.totals.uncovered_files, 0,
    `expected coveragePatterns to absorb all 4 files, got ${catalog.coverage.totals.uncovered_files} uncovered: ${JSON.stringify(catalog.coverage.uncovered.map((u) => u.path))}`);
  assert.equal(catalog.coverage.totals.coverage_ratio, 1,
    `expected coverage_ratio = 1, got ${catalog.coverage.totals.coverage_ratio}`);
});

test('brainbase preset emits semantically separated active stories', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.story_catalog = { preset: 'brainbase' };
  await writeFile(configPath, JSON.stringify(config, null, 2));

  await mkdir(path.join(repo, 'cli'), { recursive: true });
  await mkdir(path.join(repo, 'mcp', 'brainbase', 'src'), { recursive: true });
  await mkdir(path.join(repo, 'mcp', 'jibble', 'src'), { recursive: true });
  await mkdir(path.join(repo, 'server', 'mesh', 'crypto'), { recursive: true });
  await mkdir(path.join(repo, 'server', 'services', 'session-runtime'), { recursive: true });
  await mkdir(path.join(repo, 'server', 'services'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'modules', 'core'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'modules', 'app'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'modules', 'domain', 'nocodb-task'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'modules', 'terminal'), { recursive: true });

  await writeFile(path.join(repo, 'cli', 'main.js'), 'export {}\n');
  await writeFile(path.join(repo, 'mcp', 'brainbase', 'src', 'server.js'), 'export {}\n');
  await writeFile(path.join(repo, 'mcp', 'jibble', 'src', 'index.js'), 'export {}\n');
  await writeFile(path.join(repo, 'server', 'mesh', 'crypto', 'cipher.js'), 'export {}\n');
  await writeFile(path.join(repo, 'server', 'services', 'session-runtime', 'state.js'), 'export {}\n');
  await writeFile(path.join(repo, 'server', 'services', 'terminal-transport-service.js'), 'export {}\n');
  await writeFile(path.join(repo, 'server', 'services', 'github-service.js'), 'export {}\n');
  await writeFile(path.join(repo, 'public', 'modules', 'core', 'event-bus.js'), 'export {}\n');
  await writeFile(path.join(repo, 'public', 'modules', 'app', 'home.js'), 'export {}\n');
  await writeFile(path.join(repo, 'public', 'modules', 'domain', 'nocodb-task', 'service.js'), 'export {}\n');
  await writeFile(path.join(repo, 'public', 'modules', 'terminal', 'view.js'), 'export {}\n');

  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'cli', source_file: 'cli/main.js', label: 'cli' },
      { id: 'mcp_bb', source_file: 'mcp/brainbase/src/server.js', label: 'mcp-bb' },
      { id: 'mcp_jb', source_file: 'mcp/jibble/src/index.js', label: 'mcp-jb' },
      { id: 'mesh', source_file: 'server/mesh/crypto/cipher.js', label: 'mesh' },
      { id: 'sess', source_file: 'server/services/session-runtime/state.js', label: 'sess' },
      { id: 'term', source_file: 'server/services/terminal-transport-service.js', label: 'term' },
      { id: 'gh', source_file: 'server/services/github-service.js', label: 'gh' },
      { id: 'core', source_file: 'public/modules/core/event-bus.js', label: 'core' },
      { id: 'portal', source_file: 'public/modules/app/home.js', label: 'portal' },
      { id: 'nocodb', source_file: 'public/modules/domain/nocodb-task/service.js', label: 'nocodb' },
      { id: 'tview', source_file: 'public/modules/terminal/view.js', label: 'tview' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const ids = catalog.stories.map((s) => s.story_id);

  const expected = [
    'story-code-cli-tooling',
    'story-code-mcp-ssot',
    'story-code-mcp-external',
    'story-code-portal-views',
    'story-code-domain-data',
    'story-code-mana-detection',
    'story-code-terminal-runtime',
    'story-code-mesh-network',
    'story-code-external-integrations',
    'story-code-core-platform'
  ];
  for (const id of expected) {
    assert.ok(ids.includes(id), `expected ${id} in active stories, got ${JSON.stringify(ids)}`);
  }

  assert.equal(catalog.coverage.totals.uncovered_files, 0,
    `expected uncovered = 0 with brainbase preset, got ${catalog.coverage.totals.uncovered_files}`);
});

test('story derive surfaces domain subdirectories as separate candidates', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.story_catalog = { preset: 'modular-web' };
  await writeFile(configPath, JSON.stringify(config, null, 2));

  // Place files under public/modules/domain/{task,session} so they would all
  // be grouped under "public/modules/domain" at depth 3 — but with depth 4
  // tuning, each subdomain should surface as its own candidate.
  await mkdir(path.join(repo, 'lib', 'auth-local'), { recursive: true });
  await mkdir(path.join(repo, 'lib', 'session-local'), { recursive: true });
  for (let i = 0; i < 3; i += 1) {
    await writeFile(path.join(repo, 'lib', 'auth-local', `auth${i}.js`), 'export {}\n');
  }
  for (let i = 0; i < 4; i += 1) {
    await writeFile(path.join(repo, 'lib', 'session-local', `sess${i}.js`), 'export {}\n');
  }

  const nodes = [];
  for (let i = 0; i < 3; i += 1) nodes.push({ id: `a${i}`, source_file: `lib/auth-local/auth${i}.js`, label: `auth${i}` });
  for (let i = 0; i < 4; i += 1) nodes.push({ id: `s${i}`, source_file: `lib/session-local/sess${i}.js`, label: `sess${i}` });
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({ nodes, links: [] }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const paths = catalog.story_candidates.map((c) => c.common_path);

  assert.ok(paths.includes('lib/auth-local'),
    `expected lib/auth-local subdir candidate, got ${JSON.stringify(paths)}`);
  assert.ok(paths.includes('lib/session-local'),
    `expected lib/session-local subdir candidate, got ${JSON.stringify(paths)}`);
});

test('story derive omits singletons from story_candidates', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.story_catalog = { preset: 'modular-web' };
  await writeFile(configPath, JSON.stringify(config, null, 2));

  await mkdir(path.join(repo, 'cli'), { recursive: true });
  await writeFile(path.join(repo, 'cli', 'lonely.js'), 'export {}\n');
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [{ id: 'lonely', source_file: 'cli/lonely.js', label: 'lonely' }],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const cliCandidates = catalog.story_candidates.filter((c) => c.role === 'cli');
  assert.equal(cliCandidates.length, 0,
    `singletons must not be emitted as candidates, got ${JSON.stringify(cliCandidates)}`);
});

test('story derive suppresses next-app product stories for non-web repositories by default', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  await mkdir(path.join(repo, 'src', 'pkg', 'trading_dag'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'pkg', 'decision_dag'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'services', 'profile'), { recursive: true });
  await mkdir(path.join(repo, 'scripts'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'backtest_engine.py'), 'class BacktestEngine: pass\n');
  await writeFile(path.join(repo, 'src', 'session_learning.py'), 'def load_session(): return None\n');
  await writeFile(path.join(repo, 'src', 'lib', 'auth.py'), 'def auth_score(): return 0\n');
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'profile', 'profile_score.py'), 'def score_profile(): return 0\n');
  await writeFile(path.join(repo, 'src', 'pkg', 'trading_dag', 'signals.py'), 'def emit_entry_signal(): pass\n');
  await writeFile(path.join(repo, 'src', 'pkg', 'decision_dag', 'notification_score.py'), 'def score(): return 0\n');
  await writeFile(path.join(repo, 'scripts', 'run_ctrader_shadow_trade.py'), 'print("shadow trade")\n');

  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'engine', source_file: 'src/backtest_engine.py', label: 'BacktestEngine' },
      { id: 'session', source_file: 'src/session_learning.py', label: 'load_session' },
      { id: 'auth', source_file: 'src/lib/auth.py', label: 'auth_score' },
      { id: 'profile', source_file: 'src/lib/services/profile/profile_score.py', label: 'profile_score' },
      { id: 'signals', source_file: 'src/pkg/trading_dag/signals.py', label: 'emit_entry_signal' },
      { id: 'notification', source_file: 'src/pkg/decision_dag/notification_score.py', label: 'notification_score' },
      { id: 'script', source_file: 'scripts/run_ctrader_shadow_trade.py', label: 'run_ctrader' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const storyIds = catalog.stories.map((story) => story.story_id);
  assert.equal(catalog.source.repo_profile.id, 'data-pipeline');
  assert.equal(storyIds.includes('story-product-auth-account-access'), false);
  assert.equal(storyIds.includes('story-product-content-cms'), false);
  assert.equal(storyIds.includes('story-product-notification'), false);
  assert.equal(storyIds.includes('story-product-profile-personalization'), false);
  const warning = catalog.source.warnings.find((item) => item.code === 'needs_domain_confirmation');
  assert.ok(warning, `expected needs_domain_confirmation warning, got ${JSON.stringify(catalog.source.warnings)}`);
  assert.equal(warning.suppressed_story_ids.includes('story-product-auth-account-access'), true);
  assert.equal(warning.suppressed_story_ids.includes('story-product-notification'), true);
  assert.equal(warning.suppressed_story_ids.includes('story-product-profile-personalization'), true);
  const profileSuppression = warning.suppressed.find((item) => item.story_id === 'story-product-profile-personalization');
  assert.equal(profileSuppression.reason, 'repo_profile_not_web_product');
  assert.equal(profileSuppression.evidence_paths.includes('src/lib/services/profile/profile_score.py'), true);
  assert.deepEqual(profileSuppression.required_profile, ['next-app', 'web']);

  const map = await readFile(path.join(repo, '.vibepro', 'stories', 'story-map.md'), 'utf8');
  assert.match(map, /Repo profile: data-pipeline/);
  assert.match(map, /needs_domain_confirmation/);

  const explicitResult = await runCli(['story', 'derive', repo, '--preset', 'next-app']);
  assert.equal(explicitResult.exitCode, 0);
  const explicitCatalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const explicitIds = explicitCatalog.stories.map((story) => story.story_id);
  assert.equal(explicitCatalog.source.preset_resolution.mode, 'explicit');
  assert.equal(explicitIds.includes('story-product-auth-account-access'), true);
  assert.equal(explicitIds.includes('story-product-profile-personalization'), true);
  assert.equal(explicitCatalog.source.warnings.some((item) => item.code === 'needs_domain_confirmation'), false);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.story_catalog = { ...(config.story_catalog ?? {}), preset: 'next-app' };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const configPresetResult = await runCli(['story', 'derive', repo]);
  assert.equal(configPresetResult.exitCode, 0);
  const configPresetCatalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const configPresetIds = configPresetCatalog.stories.map((story) => story.story_id);
  assert.equal(configPresetCatalog.source.preset_resolution.mode, 'explicit');
  assert.equal(configPresetCatalog.source.preset_resolution.requested, 'next-app');
  assert.equal(configPresetIds.includes('story-product-auth-account-access'), true);
  assert.equal(configPresetIds.includes('story-product-profile-personalization'), true);
  assert.equal(configPresetCatalog.source.warnings.some((item) => item.code === 'needs_domain_confirmation'), false);
});

test('story derive keeps next-app preset behavior when preset is unset', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  await mkdir(path.join(repo, 'src', 'components', 'auth'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'components', 'auth', 'LoginForm.tsx'),
    'export function LoginForm() { return null; }\n');

  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'login_form', source_file: 'src/components/auth/LoginForm.tsx', label: 'LoginForm' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.source.preset, 'next-app');
  assert.equal(catalog.source.preset_resolution.mode, 'auto');
  assert.equal(catalog.source.repo_profile.id, 'web');
  assert.equal(catalog.source.warnings.some((item) => item.code === 'needs_domain_confirmation'), false);
  const storyIds = catalog.stories.map((story) => story.story_id);
  assert.equal(storyIds.includes('story-product-auth-account-access'), true);
  assert.ok(catalog.coverage.totals.graph_story_relevant_files > 0,
    `default preset must keep classifying src/ files as relevant`);
  const roles = catalog.coverage.by_role.map((entry) => entry.role);
  assert.ok(roles.includes('component'),
    `default preset must classify src/components/** as 'component', got ${JSON.stringify(roles)}`);
});

test('story derive uses document evidence without weak non-web code paths', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'services', 'profile'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'features'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'session_learning.py'), 'def load_session(): return None\n');
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'profile', 'profile_score.py'), 'def score_profile(): return 0\n');
  await writeFile(path.join(repo, 'docs', 'features', 'auth.md'), `---
story_id: story-product-auth-account-access
---

# Auth Story

User-facing account access is an explicit product requirement.
`);
  await writeFile(path.join(repo, 'docs', 'specs', 'profile.md'), `---
story_id: story-product-profile-personalization
---

# Profile Story

Profile personalization is an explicit product requirement.
`);
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'session', source_file: 'src/session_learning.py', label: 'load_session' },
      { id: 'profile_code', source_file: 'src/lib/services/profile/profile_score.py', label: 'profile_score' },
      { id: 'auth_doc', source_file: 'docs/features/auth.md', label: 'Auth Story' },
      { id: 'profile_doc', source_file: 'docs/specs/profile.md', label: 'Profile Story' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.source.repo_profile.product_surface_applicable, false);
  const story = catalog.stories.find((item) => item.story_id === 'story-product-auth-account-access');
  assert.ok(story, `expected doc-promoted auth story, got ${catalog.stories.map((item) => item.story_id).join(', ')}`);
  assert.equal(story.source.paths.includes('docs/features/auth.md'), true);
  assert.equal(story.source.paths.includes('src/session_learning.py'), false);

  const profileStory = catalog.stories.find((item) => item.story_id === 'story-product-profile-personalization');
  assert.ok(profileStory, `expected doc-promoted profile story, got ${catalog.stories.map((item) => item.story_id).join(', ')}`);
  assert.equal(profileStory.source.paths.includes('docs/specs/profile.md'), true);
  assert.equal(profileStory.source.paths.some((item) => item.startsWith('src/')), false);
  assert.equal(JSON.stringify(profileStory.derived?.story_definition ?? {}).includes('src/lib/services/profile/profile_score.py'), false);
  assert.equal(JSON.stringify(profileStory.derived?.story_definition ?? {}).includes('src/session_learning.py'), false);
});

test('story contract flags ambiguous internal authorization documents before product auth implementation', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'scripts'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'authorization_scoring.py'), 'def score_authorization(): return "advisory"\n');
  await writeFile(path.join(repo, 'scripts', 'run_authorization_audit.py'), 'print("audit")\n');
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-vibepro-pr-prepare-authorization-scoring.md'), `---
story_id: story-vibepro-pr-prepare-authorization-scoring
title: VibePro pr prepare should embed authorization scoring next to gate_status
---

# Story

VibePro should expose authorization scoring in pr prepare artifacts for reviewers.
This is internal developer tooling, not a user-facing account access feature.
`);
  await writeFile(path.join(repo, 'docs', 'specs', 'vibepro-pr-prepare-authorization-scoring.md'), `---
story_id: story-vibepro-pr-prepare-authorization-scoring
---

# Spec

authorization_scoring is advisory metadata next to gate_status.
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'vibepro-pr-prepare-authorization-scoring.md'), `---
story_id: story-vibepro-pr-prepare-authorization-scoring
---

# Architecture

The authorization scoring module is called from pr prepare.
`);
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'authorization_scoring', source_file: 'src/authorization_scoring.py', label: 'score_authorization' },
      { id: 'authorization_story', source_file: 'docs/management/stories/active/story-vibepro-pr-prepare-authorization-scoring.md', label: 'authorization scoring story' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.source.repo_profile.product_surface_applicable, false);
  const authStory = catalog.stories.find((item) => item.story_id === 'story-product-auth-account-access');
  assert.ok(authStory, `expected doc-promoted auth story, got ${catalog.stories.map((item) => item.story_id).join(', ')}`);
  assert.equal(authStory.source.paths.some((item) => item.startsWith('src/')), false);
  assert.equal(authStory.derived.story_contract.status, 'needs_clarification');
  assert.equal(authStory.derived.story_contract.story_type, 'new_capability');
  const sourceRoleCheck = authStory.derived.story_contract.checks.find((check) => check.id === 'source_role_integrity');
  assert.equal(sourceRoleCheck.status, 'needs_clarification');
  assert.equal(sourceRoleCheck.evidence.doc_story_ids.includes('story-vibepro-pr-prepare-authorization-scoring'), true);
  assert.equal(authStory.derived.open_questions.some((item) => item.field === 'story_contract_source_role'), true);
  assert.equal(catalog.open_questions.some((item) => item.story_id === 'story-product-auth-account-access' && item.field === 'story_contract_source_role'), true);

  const map = await readFile(path.join(repo, '.vibepro', 'stories', 'story-map.md'), 'utf8');
  assert.match(map, /Story Contract/);
  assert.match(map, /contract_needs_clarification/);

  await runCli(['story', 'plan', repo, '--limit', '5']);
  const plan = await readJson(path.join(repo, '.vibepro', 'stories', 'story-plan.json'));
  assert.equal(plan.questions.some((question) => question.field === 'story_contract_source_role'), true);
  assert.equal(plan.source_alignment_findings.items.some((finding) => finding.type === 'story_contract_source_role_mismatch'), true);
  assert.equal(plan.task_candidates.some((task) => task.id === 'story-product-auth-account-access-story-contract-recovery'), true);
});



test('--version prints the package version', async () => {
  const versions = [];
  for (const arg of ['--version', '-v', 'version']) {
    let out = '';
    const result = await runCli([arg], { stdout: { write: (text) => { out += text; } } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.command, 'version');
    assert.match(out.trim(), /^\d+\.\d+\.\d+/);
    versions.push(out.trim());
  }
  assert.equal(new Set(versions).size, 1);
});

test('package metadata and README are ready for Apache-2.0 OSS publication', async () => {
  const packageJson = await readJson(path.resolve('package.json'));
  const readme = await readFile(path.resolve('README.md'), 'utf8');
  const readmeJa = await readFile(path.resolve('README.ja.md'), 'utf8');
  const license = await readFile(path.resolve('LICENSE'), 'utf8');
  const requiredOpsFiles = [
    'CONTRIBUTING.md',
    'SECURITY.md',
    'CODE_OF_CONDUCT.md',
    'CHANGELOG.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/ISSUE_TEMPLATE/bug_report.yml',
    '.github/ISSUE_TEMPLATE/feature_request.yml',
    '.github/ISSUE_TEMPLATE/false_positive.yml',
    '.github/workflows/ci.yml'
  ];

  assert.equal(packageJson.license, 'Apache-2.0');
  assert.equal(packageJson.version, '0.2.0-beta.3');
  assert.match(packageJson.description, /Story, Spec, verification, review, and PR evidence/);
  assert.equal(packageJson.keywords.includes('ai-agents'), true);
  assert.equal(packageJson.keywords.includes('developer-tools'), true);
  assert.equal(packageJson.keywords.includes('software-quality'), true);
  assert.equal(packageJson.publishConfig.access, 'public');
  assert.equal(packageJson.files.includes('docs/releases'), false);
  assert.equal(packageJson.files.includes('docs/assets/vibepro-header.png'), true);
  assert.equal(packageJson.files.includes('docs/playbooks'), true);
  assert.equal(packageJson.files.some((entry) => (
    entry === 'docs'
    || (entry.startsWith('docs/')
      && !['docs/assets/vibepro-header.png', 'docs/playbooks'].includes(entry))
  )), false);
  assert.equal(packageJson.files.includes('.vibepro'), false);
  assert.equal(packageJson.files.includes('node_modules'), false);
  assert.match(license, /Apache License[\s\S]*Version 2\.0/);
  assert.match(readme, /Graphify is optional/);
  assert.match(readme, /Graphify is optional and is not bundled/);
  assert.match(readme, /former Gate DAG/);
  assert.match(readme, /does not implement your application/);
  assert.match(readme, /final review and merge authority remain outside VibePro/);
  assert.match(readme, /`pr create` can push/);
  assert.match(readme, /VibePro is licensed under Apache-2\.0/);
  assert.doesNotMatch(readme, /No license file is currently included/);
  assert.doesNotMatch(readme, /Internal beta release notes/);
  assert.match(readmeJa, /Graphifyは任意/);
  assert.match(readmeJa, /Graphifyは任意で、VibeProには同梱しません/);
  assert.match(readmeJa, /従来のGate DAG/);
  assert.match(readmeJa, /アプリを実装せず/);
  assert.match(readmeJa, /最終レビューとmerge権限はVibeProの外/);
  assert.match(readmeJa, /`pr create` は選択したbranchをpush/);
  assert.match(readmeJa, /VibeProはApache-2\.0で公開/);
  assert.doesNotMatch(readmeJa, /現在 license file は含まれていません/);
  assert.doesNotMatch(readmeJa, /社内βリリースノート/);
  for (const file of requiredOpsFiles) {
    assert.equal(await pathExists(path.resolve(file)), true, `${file} should exist for OSS operations`);
  }
});

test('npm dry-run package excludes VibePro workspace and internal artifacts', async () => {
  const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json'], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10
  });
  const pack = JSON.parse(stdout)[0];
  const files = pack.files.map((file) => file.path);

  assert.equal(files.includes('LICENSE'), true);
  assert.equal(files.includes('README.md'), true);
  assert.equal(files.includes('README.ja.md'), true);
  assert.equal(files.includes('docs/assets/vibepro-header.png'), true);
  assert.equal(files.includes('bin/vibepro.js'), true);
  assert.equal(files.some((file) => file === '.vibepro' || file.startsWith('.vibepro/')), false);
  assert.equal(files.some((file) => file === 'node_modules' || file.startsWith('node_modules/')), false);
  assert.equal(files.some((file) => file === 'docs/releases' || file.startsWith('docs/releases/')), false);
  assert.equal(files.some((file) => (
    file.startsWith('docs/')
    && file !== 'docs/assets/vibepro-header.png'
    && !file.startsWith('docs/playbooks/story-engineering-playbook/')
  )), false);
  assert.equal(files.some((file) => file.toLowerCase().includes('graphify') && !file.startsWith('src/') && !file.startsWith('README')), false);
});

test('doctor detects missing .vibepro/ entry in .gitignore and fixes it', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  // Overwrite .gitignore so .vibepro/ entry is missing
  await writeFile(path.join(repo, '.gitignore'), 'node_modules/\n');

  const dryRun = await runCli(['doctor', repo, '--json']);
  assert.equal(dryRun.exitCode, 0);
  assert.equal(dryRun.result.checks.some((check) => check.id === 'VP-DOCTOR-GITIGNORE-MISSING'), true);
  assert.equal(dryRun.result.overall_status, 'needs_maintenance');

  const fixed = await runCli(['doctor', repo, '--fix']);
  assert.equal(fixed.exitCode, 0);
  assert.equal(fixed.result.repairs.some((repair) => repair.id === 'ensure-gitignore-vibepro'), true);
  const gitignore = await readFile(path.join(repo, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.vibepro\/\*$/m);
  assert.match(gitignore, /^!\.vibepro\/config\.json$/m);
  assert.match(gitignore, /node_modules\//);

  const after = await runCli(['doctor', repo, '--json']);
  assert.equal(after.result.checks.some((check) => check.id === 'VP-DOCTOR-GITIGNORE-MISSING'), false);
});

test('doctor --fix creates .gitignore when it is absent', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  // Remove the .gitignore entirely.
  await writeFile(path.join(repo, '.gitignore'), '');

  const dryRun = await runCli(['doctor', repo, '--json']);
  assert.equal(dryRun.result.checks.some((check) => check.id === 'VP-DOCTOR-GITIGNORE-MISSING'), true);

  await runCli(['doctor', repo, '--fix']);
  const gitignore = await readFile(path.join(repo, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.vibepro\/\*$/m);
  assert.match(gitignore, /^!\.vibepro\/config\.json$/m);
});

test('story report writes index.html and links resolve to latest run artifacts', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-html', '--title', 'HTML Story', '--view', 'dev', '--period', '2026-W18']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }, { id: 'api' }],
    edges: [{ source: 'app', target: 'api', relation: 'calls', confidence: 'AMBIGUOUS' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  // Provide a graph.html artefact since graphify import may not produce one in tests.
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.html'), '<!doctype html><title>Graph</title>');
  await runCli(['story', 'select', repo, '--id', 'story-html']);
  await runCli(['diagnose', repo, '--run-id', 'run-old']);
  await runCli(['diagnose', repo, '--run-id', 'run-latest']);

  const result = await runCli(['story', 'report', repo]);
  assert.equal(result.exitCode, 0);
  const storyDir = path.join(repo, '.vibepro', 'stories', 'story-html');
  const htmlPath = path.join(storyDir, 'index.html');
  await stat(htmlPath);

  const html = await readFile(htmlPath, 'utf8');
  assert.match(html, /Latest Run Artifacts \(run-latest\)/);
  // Old run id should not appear in the latest-run section.
  assert.equal(html.includes('Latest Run Artifacts (run-old)'), false);

  // Extract every href and confirm it resolves to an actual file.
  const hrefMatches = [...html.matchAll(/href="([^"#]+)"/g)].map((match) => match[1]);
  assert.equal(hrefMatches.length > 0, true);
  for (const href of hrefMatches) {
    const resolved = path.resolve(storyDir, href);
    await stat(resolved);
  }

  // Spot-check: the summary link must point to the latest run, not the older one.
  const summaryHref = hrefMatches.find((href) => href.endsWith('summary.md'));
  assert.equal(summaryHref?.includes('run-latest'), true);
  assert.equal(summaryHref?.includes('run-old'), false);

  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.stories['story-html'].latest_report_html, '.vibepro/stories/story-html/index.html');
  assert.equal(manifest.stories['story-html'].latest_report_run_id, 'run-latest');
});

test('vibepro commands only write files under .vibepro/ in the target repo', async () => {
  const repo = await makeRepo();
  // Snapshot of repo top-level entries before any vibepro command (just index.html created by makeRepo).
  const before = new Set(await readdirSafe(repo));
  await runCli(['init', repo, '--story-id', 'story-stray', '--title', 'No Stray', '--view', 'dev', '--period', '2026-W18']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'a' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', 'run-stray']);
  await runCli(['story', 'report', repo]);
  await runCli(['doctor', repo, '--fix']);

  const after = new Set(await readdirSafe(repo));
  const allowed = new Set([...before, '.vibepro', '.gitignore', 'graphify-out']);
  for (const entry of after) {
    assert.equal(allowed.has(entry), true, `Unexpected top-level entry "${entry}" written by vibepro outside .vibepro/`);
  }
  // Verify nothing else changed under repo root that's not in allowed list.
  // Crucially the workspace must exist.
  await stat(path.join(repo, '.vibepro'));
});

async function readdirSafe(dir) {
  const { readdir } = await import('node:fs/promises');
  try {
    return await readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    }
  };
}

test('env graph command runs end-to-end and derives an environment graph', async () => {
  const repo = await makeGitRepoWithStory();
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ dependencies: { next: '14', '@prisma/client': '5' } }));
  await writeFile(path.join(repo, '.env.example'), 'DATABASE_URL=postgres://u:p@x.neon.tech/db\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: app deps and env']);
  const result = await runCli(['env', 'graph', repo, '--json']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.nodes.some((n) => n.type === 'database'), true);
  assert.equal(result.result.nodes.some((n) => n.type === 'frontend'), true);
});
