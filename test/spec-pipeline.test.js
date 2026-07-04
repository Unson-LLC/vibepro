import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { buildSpecFingerprint } from '../src/spec-fingerprint.js';
import { validateSpec, globToRegExp, matchGlob } from '../src/spec-validator.js';
import { buildSpecDrift } from '../src/spec-drift.js';
import { similarity, stabilizeClauseIds, writeInferredSpec, writePreSpecReadiness } from '../src/spec-store.js';

const STORY_ID = 'story-spec-pipeline-test';
const execFileAsync = promisify(execFile);

async function makeSpecRepo(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-spec-'));
  await mkdir(path.join(root, 'src', 'lib', 'services'), { recursive: true });
  await mkdir(path.join(root, 'test'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, 'src', 'lib', 'services', 'billing.ts'), `
export function handleCancel(user, sub) {
  if (sub.cancelAtPeriodEnd === true && user.userType === 2) {
    return { userType: 2, status: 'premium_pending_cancel' };
  }
  if (sub.cancelAtPeriodEnd === false) {
    return { userType: 2, status: 'premium' };
  }
  return { userType: 1, status: 'free' };
}
`);
  await writeFile(path.join(root, 'test', 'billing.test.ts'), `
import { handleCancel } from '../src/lib/services/billing.ts';
test('keeps userType=2 until cancelAtPeriodEnd resolves', () => {
  const result = handleCancel({ userType: 2 }, { cancelAtPeriodEnd: true });
  expect(result.userType).toBe(2);
});
`);
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`), `---
story_id: ${STORY_ID}
---
# Premium 維持の不変条件

## 受け入れ基準
- premium ユーザーは current_period_end まで userType=2 を保持する
- cancelAtPeriodEnd が true でも期間内は premium を維持する
`);
  await runCli(['init', root, '--story-id', STORY_ID, '--title', 'spec pipeline test']);
  if (options.readyPreSpecEvidence !== false) {
    await writeReadyPreSpecEvidence(root, STORY_ID);
  }
  return root;
}

async function writeReadyPreSpecEvidence(repo, storyId) {
  await writePreSpecReadiness(repo, storyId, {
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
    nodes: [{ id: 'src/lib/services/billing.ts' }, { id: `docs/management/stories/active/${storyId}.md` }],
    links: [{ source: 'src/lib/services/billing.ts', target: `docs/management/stories/active/${storyId}.md` }]
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
    stdin: options.stdin ?? null,
    stdout: { write: (text) => { stdout += text; } },
    stderr: { write: (text) => { stderr += text; } }
  });
  return { ...result, stdout, stderr };
}

test('spec fingerprint emits story, code, test, schema, and digests', async () => {
  const repo = await makeSpecRepo();
  const { exitCode, stdout } = await captureRunCli(['spec', 'fingerprint', repo, '--id', STORY_ID, '--include-instructions']);
  assert.equal(exitCode, 0);
  const fp = JSON.parse(stdout);
  assert.equal(fp.story_id, STORY_ID);
  assert.ok(fp.story?.acceptance_criteria?.length > 0, 'story acceptance_criteria captured');
  assert.ok(fp.code_fingerprint.branches.length > 0, 'code branches detected');
  assert.ok(fp.test_fingerprint.files.length > 0, 'test files detected');
  assert.equal(typeof fp.inputs_digest.story_sha, 'string');
  assert.equal(fp.previous_spec, null);
  assert.ok(fp.schema_for_your_output.$id.includes('spec'));
  assert.ok(typeof fp.instructions === 'string' && fp.instructions.length > 0);
});

test('spec fingerprint includes architecture IA and flow evidence for scenario synthesis', async () => {
  const repo = await makeSpecRepo();
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'architecture', `${STORY_ID}.md`), `# Premium Journey Architecture

## Information Architecture

Account settings shows subscription status before cancellation controls.

## UI Flow

Given a premium user, when cancellation is pending, then the account screen keeps the premium status visible until current period end.

## Boundary

Billing state remains owned by the billing service and the UI only renders the derived status.
`);

  const { exitCode, stdout } = await captureRunCli(['spec', 'fingerprint', repo, '--id', STORY_ID, '--include-instructions']);
  assert.equal(exitCode, 0);
  const fp = JSON.parse(stdout);
  assert.equal(fp.architecture_fingerprint.files_scanned, 1);
  assert.equal(fp.architecture_fingerprint.files[0].path, `docs/architecture/${STORY_ID}.md`);
  assert.ok(fp.architecture_fingerprint.files[0].evidence_kind.includes('information_architecture'));
  assert.ok(fp.architecture_fingerprint.files[0].evidence_kind.includes('flow'));
  assert.equal(typeof fp.inputs_digest.architecture_sha, 'string');
  assert.match(fp.instructions, /BDD-style scenario guidance/);
  assert.match(fp.instructions, /origin\.architecture_refs/);
});

test('spec write accepts scenario clauses derived from architecture refs', async () => {
  const repo = await makeSpecRepo();
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'architecture', `${STORY_ID}.md`), `# Premium IA

## UI Flow

Premium users see the current subscription status before cancellation controls.
`);
  const valid = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    clauses: [{
      id: 'S-NEW-1',
      type: 'scenario',
      statement: 'Given a premium user on account settings, when cancellation is pending, then premium status remains visible before cancellation controls.',
      rationale: 'Story acceptance criteria plus account IA flow.',
      origin: {
        story_refs: [{ kind: 'acceptance_criteria', index: 0 }],
        architecture_refs: [{ file: `docs/architecture/${STORY_ID}.md`, section: 'UI Flow' }]
      }
    }]
  };

  const write = await captureRunCli(
    ['spec', 'write', repo, '--id', STORY_ID, '--from-stdin', '--caller', 'codex'],
    { stdin: readableFrom(JSON.stringify(valid)) }
  );
  assert.equal(write.exitCode, 0);

  const show = await captureRunCli(['spec', 'show', repo, '--id', STORY_ID]);
  const stored = JSON.parse(show.stdout);
  assert.equal(stored.clauses[0].id, 'S-001');
  assert.equal(stored.clauses[0].origin.architecture_refs[0].file, `docs/architecture/${STORY_ID}.md`);
});

test('spec write final blocks when pre-spec readiness is missing', async () => {
  const repo = await makeSpecRepo({ readyPreSpecEvidence: false });
  const valid = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    clauses: [{
      id: 'INV-NEW-1',
      type: 'invariant',
      statement: 'premium users keep userType=2 until cancellation completes',
      origin: { story_refs: [{ kind: 'acceptance_criteria', index: 0 }] }
    }]
  };

  const blocked = await captureRunCli(
    ['spec', 'write', repo, '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--final'],
    { stdin: readableFrom(JSON.stringify(valid)) }
  );
  assert.equal(blocked.exitCode, 1);
  assert.match(blocked.stderr, /requires Pre-Spec Readiness evidence/);
});

test('spec write final blocks when pre-spec readiness is blocked, while draft remains writable', async () => {
  const repo = await makeSpecRepo();
  await mkdir(path.join(repo, '.vibepro', 'spec', STORY_ID), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'spec', STORY_ID, 'pre-spec-readiness.json'), JSON.stringify({
    schema_version: '0.1.0',
    story_id: STORY_ID,
    status: 'blocked',
    checks: [{ id: 'engineering_judgment', status: 'blocked', reason: 'missing' }]
  }));
  const valid = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    clauses: [{
      id: 'INV-NEW-1',
      type: 'invariant',
      statement: 'premium users keep userType=2 until cancellation completes',
      origin: { story_refs: [{ kind: 'acceptance_criteria', index: 0 }] }
    }]
  };

  const blocked = await captureRunCli(
    ['spec', 'write', repo, '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--final'],
    { stdin: readableFrom(JSON.stringify(valid)) }
  );
  assert.equal(blocked.exitCode, 1);
  assert.match(blocked.stderr, /Pre-Spec Readiness/);

  const draft = await captureRunCli(
    ['spec', 'write', repo, '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--draft'],
    { stdin: readableFrom(JSON.stringify(valid)) }
  );
  assert.equal(draft.exitCode, 0);
  const report = JSON.parse(draft.stdout);
  assert.equal(report.mode, 'draft');
});

test('spec write final blocks stale pre-spec readiness recorded for another HEAD', async () => {
  const repo = await makeSpecRepo();
  await initGitRepo(repo);
  await writePreSpecReadiness(repo, STORY_ID, {
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
  const valid = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    clauses: [{
      id: 'INV-NEW-1',
      type: 'invariant',
      statement: 'premium users keep userType=2 until cancellation completes',
      origin: { story_refs: [{ kind: 'acceptance_criteria', index: 0 }] }
    }]
  };

  const blocked = await captureRunCli(
    ['spec', 'write', repo, '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--final'],
    { stdin: readableFrom(JSON.stringify(valid)) }
  );
  assert.equal(blocked.exitCode, 1);
  assert.match(blocked.stderr, /current_head=stale/);
});

test('spec readiness records required pre-spec evidence surfaces', async () => {
  const repo = await makeSpecRepo();
  await initGitRepo(repo);
  await execFileAsync('git', ['checkout', '-b', 'feature/spec-readiness'], { cwd: repo });
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'billing.ts'), `
export function handleCancel(user, sub) {
  if (sub.cancelAtPeriodEnd === true && user.userType === 2) {
    return { userType: 2, status: 'premium_pending_cancel' };
  }
  return { userType: 1, status: 'free' };
}

export function specReadinessMarker() {
  return 'pre-spec-readiness';
}
`);
  await commitAll(repo, 'change billing for readiness');
  await writeMinimalReadinessPrerequisites(repo, STORY_ID);
  const { stdout: headStdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repo });
  const { exitCode, stdout } = await captureRunCli([
    'spec',
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
  assert.ok(readiness.engineering_judgment.active_axis_count >= 0);
});

test('spec readiness missing diagnosis action uses design-input phase', async () => {
  const repo = await makeSpecRepo();
  await initGitRepo(repo);
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [{ id: 'src/lib/services/billing.ts' }],
    links: []
  }));

  const { exitCode, stdout } = await captureRunCli([
    'spec',
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

test('spec fingerprint resolves the explicit story id instead of falling back to existing STR-001', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-spec-story-id-'));
  await mkdir(path.join(repo, 'src', 'lib'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'search.ts'), `
export function searchDetail(params) {
  if (params.detail === true) return 'detail';
  return 'basic';
}
`);
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'STR-001.md'), `---
story_id: STR-001
---
# Existing STR story

## Acceptance Criteria
- Existing STR-001 acceptance criterion must not be selected for a new story.
`);
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-new-network-contract.md'), `---
story_id: story-new-network-contract
---
# New Network Contract Story

## Acceptance Criteria
- New story acceptance criterion must be selected by explicit --id.
`);

  const { exitCode, stdout } = await captureRunCli([
    'spec',
    'fingerprint',
    repo,
    '--id',
    'story-new-network-contract'
  ]);

  assert.equal(exitCode, 0);
  const fp = JSON.parse(stdout);
  assert.equal(fp.story_id, 'story-new-network-contract');
  assert.equal(fp.story.story_id, 'story-new-network-contract');
  assert.equal(fp.story.path, 'docs/management/stories/active/story-new-network-contract.md');
  assert.equal(fp.story.acceptance_criteria.includes('New story acceptance criterion must be selected by explicit --id.'), true);
  assert.equal(fp.story.acceptance_criteria.includes('Existing STR-001 acceptance criterion must not be selected for a new story.'), false);
});

test('spec write rejects clauses whose code_refs do not exist', async () => {
  const repo = await makeSpecRepo();
  const bogus = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    clauses: [{
      id: 'INV-NEW-1',
      type: 'invariant',
      statement: 'bogus clause referencing missing file',
      origin: { code_refs: [{ file: 'src/does-not-exist.ts', anchor: 'x' }] }
    }]
  };
  const { exitCode, stdout } = await captureRunCli(
    ['spec', 'write', repo, '--id', STORY_ID, '--from-stdin', '--caller', 'test'],
    { stdin: readableFrom(JSON.stringify(bogus)) }
  );
  assert.equal(exitCode, 2);
  const report = JSON.parse(stdout);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((err) => err.code === 'code_ref_missing'));
});

test('spec write accepts valid clause and assigns stable id; spec show reads it back', async () => {
  const repo = await makeSpecRepo();
  const valid = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    clauses: [{
      id: 'INV-NEW-1',
      type: 'invariant',
      statement: 'premium ユーザーは current_period_end まで userType=2 を保持する',
      rationale: 'Story 受け入れ基準と service.ts cancelAtPeriodEnd 分岐から',
      origin: {
        story_refs: [{ kind: 'acceptance_criteria', index: 0 }],
        code_refs: [{ file: 'src/lib/services/billing.ts', anchor: 'cancelAtPeriodEnd' }]
      },
      verifiable_by: {
        code_pattern: [{
          file_glob: 'src/lib/services/**/*.ts',
          must_contain: 'cancelAtPeriodEnd'
        }],
        test_pattern: [{
          file_glob: 'test/**/billing*.test.{js,ts}',
          must_cover: 'cancelAtPeriodEnd'
        }]
      }
    }]
  };
  const write = await captureRunCli(
    ['spec', 'write', repo, '--id', STORY_ID, '--from-stdin', '--caller', 'claude-code'],
    { stdin: readableFrom(JSON.stringify(valid)) }
  );
  assert.equal(write.exitCode, 0);

  const show = await captureRunCli(['spec', 'show', repo, '--id', STORY_ID]);
  assert.equal(show.exitCode, 0);
  const stored = JSON.parse(show.stdout);
  assert.equal(stored.clauses.length, 1);
  assert.equal(stored.clauses[0].id, 'INV-001', 'first invariant gets INV-001');
  assert.equal(stored.generated_by.caller, 'claude-code');
});

test('spec drift surfaces missing must_contain as high severity', async () => {
  // Simulate a spec that was valid earlier but now drifted from code: bypass the validator
  // by writing directly through spec-store, then run the drift detector.
  const repo = await makeSpecRepo();
  const driftedSpec = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    generated_at: new Date().toISOString(),
    clauses: [{
      id: 'INV-001',
      type: 'invariant',
      statement: 'service には STRIPE_WEBHOOK_VERIFIED マーカーが残る',
      origin: {
        code_refs: [{ file: 'src/lib/services/billing.ts', anchor: 'cancelAtPeriodEnd' }]
      },
      verifiable_by: {
        code_pattern: [{
          file_glob: 'src/lib/services/**/*.ts',
          must_contain: 'STRIPE_WEBHOOK_VERIFIED'
        }]
      }
    }]
  };
  await writeInferredSpec(repo, STORY_ID, driftedSpec);
  const drift = await captureRunCli(['spec', 'drift', repo, '--id', STORY_ID, '--json']);
  assert.equal(drift.exitCode, 0);
  const driftJson = JSON.parse(drift.stdout);
  assert.equal(driftJson.status, 'drift_detected');
  const high = driftJson.items.filter((item) => item.severity === 'high');
  assert.ok(high.length > 0, 'must_contain miss surfaces high-severity drift');
  assert.equal(high[0].axis, 'spec_code');
});

test('stabilizeClauseIds preserves id for similar statement', async () => {
  const previous = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    clauses: [{
      id: 'INV-001',
      type: 'invariant',
      statement: 'premium ユーザーは current_period_end まで userType=2 を保持する',
      first_seen_at: '2026-01-01T00:00:00.000Z',
      origin: { story_refs: [{ kind: 'acceptance_criteria', index: 0 }] }
    }]
  };
  const next = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    clauses: [{
      id: 'INV-NEW-9',
      type: 'invariant',
      statement: 'プレミアム ユーザーは current_period_end まで userType=2 を保持する',
      origin: { story_refs: [{ kind: 'acceptance_criteria', index: 0 }] }
    }]
  };
  const stabilized = stabilizeClauseIds(next, previous);
  assert.equal(stabilized.clauses[0].id, 'INV-001');
  assert.equal(stabilized.clauses[0].first_seen_at, '2026-01-01T00:00:00.000Z');
});

test('similarity returns 1 for identical and >0.7 for paraphrase', () => {
  assert.equal(similarity('abc def ghi', 'abc def ghi'), 1);
  const score = similarity(
    'premium ユーザーは current_period_end まで userType=2 を保持する',
    'プレミアム ユーザーは current_period_end まで userType=2 を保持する'
  );
  assert.ok(score >= 0.7, `similarity ${score} should be >= 0.7 for paraphrase`);
});

test('globToRegExp + matchGlob match nested directories', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-glob-'));
  await mkdir(path.join(repo, 'src', 'a', 'b'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'a', 'b', 'foo.ts'), 'export const ok = true');
  await writeFile(path.join(repo, 'src', 'a', 'b', 'bar.test.ts'), 'test("ok", () => {})');
  const matched = await matchGlob(repo, 'src/**/*.ts');
  assert.ok(matched.includes('src/a/b/foo.ts'));
  assert.ok(matched.includes('src/a/b/bar.test.ts'));
  const regex = globToRegExp('test/**/*.{test,spec}.{js,ts}');
  assert.ok(regex.test('test/foo.test.ts'));
  assert.ok(regex.test('test/nested/bar.spec.js'));
  assert.equal(regex.test('test/foo.tsx'), false);
});

test('validateSpec accepts well-formed spec built from real repo', async () => {
  const repo = await makeSpecRepo();
  const fingerprint = await buildSpecFingerprint(repo, { storyId: STORY_ID });
  assert.ok(fingerprint.code_fingerprint.files.includes('src/lib/services/billing.ts'));
  const spec = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    clauses: [{
      id: 'INV-NEW-1',
      type: 'invariant',
      statement: 'cancelAtPeriodEnd 分岐が service に存在し続ける',
      origin: {
        code_refs: [{ file: 'src/lib/services/billing.ts', anchor: 'cancelAtPeriodEnd' }]
      },
      verifiable_by: {
        code_pattern: [{ file_glob: 'src/lib/services/**/*.ts', must_contain: 'cancelAtPeriodEnd' }]
      }
    }]
  };
  const validation = await validateSpec(repo, spec, { expectedStoryId: STORY_ID });
  assert.equal(validation.ok, true, `unexpected errors: ${JSON.stringify(validation.errors)}`);
});

test('buildSpecDrift returns inconclusive when no spec exists', async () => {
  const repo = await makeSpecRepo();
  const drift = await buildSpecDrift(repo, { storyId: STORY_ID });
  assert.equal(drift.status, 'inconclusive');
  assert.equal(drift.items.length, 0);
});
