import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename as renameFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  RUN_CONTEXT_CAPSULE_MAX_BYTES,
  RunContextCapsuleError,
  createRunContextCapsule,
  refreshActiveRunContextCapsule
} from '../src/run-context-capsule.js';

const STORY_ID = 'story-run-context-capsule-test';
const RUN_ID = 'run-20260716T020304Z-01020304';
const HEAD = '1234567890abcdef1234567890abcdef12345678';
const execFileAsync = promisify(execFile);

test('RCC-S-1 RCC-S-2 RCC-S-3 capsule is typed, bounded, and accounts for every reduced section', async (t) => {
  const fixture = await createFixture(t, {
    openDecisionCount: 160,
    objectiveLength: 2_000,
    evidenceCommandCount: 100,
    nonGoalCount: 20
  });
  const manager = fixture.manager();
  const result = await manager.refresh(fixture.root, {
    storyId: STORY_ID,
    runId: RUN_ID,
    reason: 'run_started'
  });

  assert.equal(result.regenerated, true);
  const raw = await readFile(fixture.capsuleFile, 'utf8');
  const capsule = JSON.parse(raw);
  assert.ok(Buffer.byteLength(raw) <= RUN_CONTEXT_CAPSULE_MAX_BYTES);
  assert.equal(capsule.size_bytes, Buffer.byteLength(raw));
  assert.equal(capsule.story_id, STORY_ID);
  assert.equal(capsule.run_id, RUN_ID);
  assert.equal(capsule.head_sha, HEAD);
  assert.equal(capsule.run_status, 'waiting_for_human');
  assert.equal(typeof capsule.objective, 'string');
  assert.ok(Array.isArray(capsule.invariants));
  assert.equal(capsule.bottleneck.id, 'gate:test_plan');
  assert.ok(Array.isArray(capsule.evidence_refs));
  assert.ok(Array.isArray(capsule.open_decisions));
  assert.deepEqual(capsule.budget_state, {
    attempt: 2,
    iteration: 7,
    max_attempts: 4,
    max_iterations: 12,
    deadline: null
  });
  assert.equal(capsule.last_progress.reason, 'human_decision_required');
  assert.ok(capsule.truncated_sections.includes('open_decisions'));
  assert.ok(capsule.truncated_sections.includes('objective'));
  assert.ok(capsule.truncated_sections.includes('evidence_refs'));
  assert.ok(capsule.truncated_sections.includes('invariants'));
  assert.doesNotMatch(raw, /RAW_TOOL_OUTPUT_SHOULD_NEVER_BE_COPIED/);
  assert.doesNotMatch(raw, /FULL_DIFF_SHOULD_NEVER_BE_COPIED/);
  assert.doesNotMatch(raw, /PROVIDER_TRANSCRIPT_SHOULD_NEVER_BE_COPIED/);
});

test('RCC-S-4 refresh is byte-stable until a meaningful source changes', async (t) => {
  const fixture = await createFixture(t);
  const manager = fixture.manager();
  const first = await manager.refresh(fixture.root, {
    storyId: STORY_ID,
    runId: RUN_ID,
    reason: 'verification_recorded'
  });
  const before = await readFile(fixture.capsuleFile, 'utf8');
  fixture.advanceClock();
  const duplicate = await manager.refresh(fixture.root, {
    storyId: STORY_ID,
    runId: RUN_ID,
    reason: 'review_recorded'
  });
  assert.equal(duplicate.regenerated, false);
  assert.equal(await readFile(fixture.capsuleFile, 'utf8'), before);
  assert.equal(duplicate.capsule.generated_at, first.capsule.generated_at);

  const evidence = JSON.parse(await readFile(fixture.evidenceFile, 'utf8'));
  evidence.commands[0].status = 'fail';
  await writeFile(fixture.evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
  const changed = await manager.refresh(fixture.root, {
    storyId: STORY_ID,
    runId: RUN_ID,
    reason: 'verification_recorded'
  });
  assert.equal(changed.regenerated, true);
  assert.notEqual(await readFile(fixture.capsuleFile, 'utf8'), before);
});

test('RCC-S-2 dependency contract is closed and authoritative bytes override caller snapshots', async (t) => {
  assert.throws(
    () => createRunContextCapsule({ transcriptLoader: async () => 'forbidden' }),
    /Unknown Run Context Capsule dependency key\(s\): transcriptLoader/
  );

  const fixture = await createFixture(t);
  const result = await fixture.manager().refresh(fixture.root, {
    storyId: STORY_ID,
    runId: RUN_ID,
    state: {
      story_id: STORY_ID,
      run_id: RUN_ID,
      status: 'cancelled',
      current_head_sha: HEAD,
      execution_context: { root_realpath: fixture.root }
    },
    reason: 'run_state_persisted'
  });
  assert.equal(result.capsule.run_status, 'waiting_for_human');
});

test('RCC-S-5 stale HEAD and missing sources fail closed without rewriting the capsule', async (t) => {
  const fixture = await createFixture(t);
  const manager = fixture.manager();
  await manager.refresh(fixture.root, { storyId: STORY_ID, runId: RUN_ID, reason: 'run_started' });
  const before = await readFile(fixture.capsuleFile, 'utf8');

  fixture.setHead('fedcba0987654321fedcba0987654321fedcba09');
  await assert.rejects(
    manager.read(fixture.root, { storyId: STORY_ID, runId: RUN_ID }),
    errorWithCode('stale_binding')
  );
  assert.equal(await readFile(fixture.capsuleFile, 'utf8'), before);

  fixture.setHead(HEAD);
  await rm(fixture.evidenceFile);
  await assert.rejects(
    manager.read(fixture.root, { storyId: STORY_ID, runId: RUN_ID }),
    errorWithCode('missing_source')
  );
  assert.equal(await readFile(fixture.capsuleFile, 'utf8'), before);
});

test('RCC-S-5 a newly available optional source stales the old capsule and explicit rebuild recovers it', async (t) => {
  const fixture = await createFixture(t, { includeDecisions: false });
  const manager = fixture.manager();
  await manager.refresh(fixture.root, { storyId: STORY_ID, runId: RUN_ID, reason: 'run_started' });
  const before = await readFile(fixture.capsuleFile, 'utf8');

  await writeFile(fixture.decisionFile, `${JSON.stringify({
    story_id: STORY_ID,
    decisions: [{ id: 'decision-post-generation', status: 'open', summary: 'Choose the new recovery boundary.' }]
  }, null, 2)}\n`);

  await assert.rejects(
    manager.read(fixture.root, { storyId: STORY_ID, runId: RUN_ID }),
    (error) => {
      assert.ok(error instanceof RunContextCapsuleError);
      assert.equal(error.code, 'stale_binding');
      assert.deepEqual(error.details.added_source_refs, [`.vibepro/pr/${STORY_ID}/decision-records.json`]);
      return true;
    }
  );
  assert.equal(await readFile(fixture.capsuleFile, 'utf8'), before);

  const recovery = await manager.recover(fixture.root, {
    storyId: STORY_ID,
    runId: RUN_ID,
    rebuildOnStale: true
  });
  assert.ok(recovery.open_decisions.some((decision) => decision.id === 'decision-post-generation'));
});

test('RCC-S-5 malformed capsule and malformed optional JSON fail closed without projection mutation', async (t) => {
  const fixture = await createFixture(t);
  const manager = fixture.manager();
  await manager.refresh(fixture.root, { storyId: STORY_ID, runId: RUN_ID, reason: 'run_started' });
  const validCapsule = await readFile(fixture.capsuleFile, 'utf8');

  await writeFile(fixture.capsuleFile, '{"schema_version":');
  await assert.rejects(
    manager.read(fixture.root, { storyId: STORY_ID, runId: RUN_ID }),
    errorWithCode('invalid_capsule')
  );

  await writeFile(fixture.capsuleFile, validCapsule);
  await writeFile(fixture.decisionFile, '{"decisions":');
  await assert.rejects(
    manager.refresh(fixture.root, { storyId: STORY_ID, runId: RUN_ID, reason: 'decision_recorded' }),
    errorWithCode('invalid_capsule')
  );
  assert.equal(await readFile(fixture.capsuleFile, 'utf8'), validCapsule);
});

test('RCC-S-5 explicit recovery replaces a malformed disposable capsule from authoritative sources', async (t) => {
  const fixture = await createFixture(t);
  const manager = fixture.manager();
  await manager.refresh(fixture.root, { storyId: STORY_ID, runId: RUN_ID, reason: 'run_started' });
  await writeFile(fixture.capsuleFile, '{"schema_version":');

  const recovery = await manager.recover(fixture.root, {
    storyId: STORY_ID,
    runId: RUN_ID,
    rebuildOnStale: true
  });

  assert.deepEqual(recovery.binding, { story_id: STORY_ID, run_id: RUN_ID, head_sha: HEAD });
  const rebuilt = await readFile(fixture.capsuleFile, 'utf8');
  assert.ok(Buffer.byteLength(rebuilt) <= RUN_CONTEXT_CAPSULE_MAX_BYTES);
  assert.equal(JSON.parse(rebuilt).generation_reason, 'explicit_rebuild');
});

test('RCC-S-5 explicit recovery replaces an oversized disposable capsule even when its event fingerprint is current', async (t) => {
  const fixture = await createFixture(t);
  const manager = fixture.manager();
  await manager.refresh(fixture.root, { storyId: STORY_ID, runId: RUN_ID, reason: 'run_started' });
  const oversized = JSON.parse(await readFile(fixture.capsuleFile, 'utf8'));
  oversized.padding = 'x'.repeat(RUN_CONTEXT_CAPSULE_MAX_BYTES);
  const oversizedRaw = serializeFixtureCapsule(oversized);
  assert.ok(Buffer.byteLength(oversizedRaw) > RUN_CONTEXT_CAPSULE_MAX_BYTES);
  await writeFile(fixture.capsuleFile, oversizedRaw);

  const recovery = await manager.recover(fixture.root, {
    storyId: STORY_ID,
    runId: RUN_ID,
    rebuildOnStale: true
  });

  assert.deepEqual(recovery.binding, { story_id: STORY_ID, run_id: RUN_ID, head_sha: HEAD });
  const rebuilt = await readFile(fixture.capsuleFile, 'utf8');
  assert.ok(Buffer.byteLength(rebuilt) <= RUN_CONTEXT_CAPSULE_MAX_BYTES);
  assert.equal(Object.hasOwn(JSON.parse(rebuilt), 'padding'), false);
});

test('RCC-S-5 atomic authority failure preserves the previous capsule bytes', async (t) => {
  const fixture = await createFixture(t);
  await fixture.manager().refresh(fixture.root, { storyId: STORY_ID, runId: RUN_ID, reason: 'run_started' });
  const before = await readFile(fixture.capsuleFile, 'utf8');
  const evidence = JSON.parse(await readFile(fixture.evidenceFile, 'utf8'));
  evidence.commands[0].status = 'fail';
  await writeFile(fixture.evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);

  const failingManager = fixture.manager({
    artifactIo: {
      rename: async (source, destination) => {
        if (path.resolve(destination) === path.resolve(fixture.capsuleFile)) throw new Error('injected authority rename failure');
        return renameFile(source, destination);
      }
    }
  });
  await assert.rejects(
    failingManager.refresh(fixture.root, { storyId: STORY_ID, runId: RUN_ID, reason: 'verification_recorded' }),
    /injected authority rename failure/
  );
  assert.equal(await readFile(fixture.capsuleFile, 'utf8'), before);
});

test('RCC-S-5 mirror failure is typed after the authority commits', async (t) => {
  const fixture = await createFixture(t);
  await fixture.manager().refresh(fixture.root, { storyId: STORY_ID, runId: RUN_ID, reason: 'run_started' });
  const before = await readFile(fixture.capsuleFile, 'utf8');
  const evidence = JSON.parse(await readFile(fixture.evidenceFile, 'utf8'));
  evidence.commands[0].status = 'fail';
  await writeFile(fixture.evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
  const mirrorStateFile = path.join(fixture.root, 'mirror', '.vibepro', 'executions', STORY_ID, 'runs', RUN_ID, 'state.json');
  const mirrorCapsuleFile = path.join(path.dirname(mirrorStateFile), 'context-capsule.json');

  const failingManager = fixture.manager({
    artifactIo: {
      rename: async (source, destination) => {
        if (path.resolve(destination) === path.resolve(mirrorCapsuleFile)) throw new Error('injected mirror rename failure');
        return renameFile(source, destination);
      }
    }
  });
  await assert.rejects(
    failingManager.refresh(fixture.root, {
      storyId: STORY_ID,
      runId: RUN_ID,
      mirrorFile: mirrorStateFile,
      reason: 'verification_recorded'
    }),
    errorWithCode('capsule_mirror_sync_failed')
  );
  assert.notEqual(await readFile(fixture.capsuleFile, 'utf8'), before);
  await assert.rejects(readFile(mirrorCapsuleFile, 'utf8'), { code: 'ENOENT' });
});

test('RCC-S-5 multiple active runs produce an explicit ambiguous result', async (t) => {
  const fixture = await createFixture(t);
  const secondRunId = 'run-20260716T020305Z-aabbccdd';
  const secondStateFile = path.join(fixture.root, '.vibepro', 'executions', STORY_ID, 'runs', secondRunId, 'state.json');
  const state = JSON.parse(await readFile(fixture.stateFile, 'utf8'));
  state.run_id = secondRunId;
  await mkdir(path.dirname(secondStateFile), { recursive: true });
  await writeFile(secondStateFile, `${JSON.stringify(state, null, 2)}\n`);

  const result = await refreshActiveRunContextCapsule(fixture.root, { storyId: STORY_ID, reason: 'decision_recorded' });
  assert.equal(result.status, 'ambiguous_active_run');
  assert.deepEqual(result.run_ids, [RUN_ID, secondRunId].sort());
});

test('RCC-S-5 mismatched Story frontmatter fails closed before capsule creation', async (t) => {
  const fixture = await createFixture(t);
  const storyFile = path.join(fixture.root, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`);
  const story = await readFile(storyFile, 'utf8');
  await writeFile(storyFile, story.replace(`story_id: ${STORY_ID}`, 'story_id: story-unrelated'));
  await assert.rejects(
    fixture.manager().refresh(fixture.root, { storyId: STORY_ID, runId: RUN_ID, reason: 'run_started' }),
    errorWithCode('stale_binding')
  );
  await assert.rejects(readFile(fixture.capsuleFile, 'utf8'), { code: 'ENOENT' });
});

test('RCC-S-6 RCC-S-7 fresh-process recovery reconstructs the blocker and decision context without transcript input', async (t) => {
  const fixture = await createFixture(t);
  await fixture.manager().refresh(fixture.root, {
    storyId: STORY_ID,
    runId: RUN_ID,
    reason: 'handoff'
  });

  const restarted = fixture.manager();
  const recovery = await restarted.recover(fixture.root, {
    storyId: STORY_ID,
    runId: RUN_ID
  });
  assert.deepEqual(recovery.binding, { story_id: STORY_ID, run_id: RUN_ID, head_sha: HEAD });
  assert.equal(recovery.status, 'waiting_for_human');
  assert.equal(recovery.bottleneck.id, 'gate:test_plan');
  assert.equal(recovery.open_decisions[0].id, 'decision-1');
  assert.equal(recovery.last_progress.reason, 'human_decision_required');
  assert.equal(Object.hasOwn(recovery, 'transcript'), false);
});

test('RCC-S-4 RCC-S-6 managed refresh mirrors exact bytes and a new process recovers decisions', async (t) => {
  const authorityRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-context-authority-'));
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-context-source-'));
  t.after(() => Promise.all([
    rm(authorityRoot, { recursive: true, force: true }),
    rm(sourceRoot, { recursive: true, force: true })
  ]));
  const storyDir = path.join(authorityRoot, 'docs', 'management', 'stories', 'active');
  await mkdir(storyDir, { recursive: true });
  await writeFile(path.join(storyDir, `${STORY_ID}.md`), `---\nstory_id: ${STORY_ID}\ntitle: Managed capsule\nstatus: active\n---\n\n# Managed capsule\n\n**So that** managed restarts recover from a bounded projection\n`);
  await execFileAsync('git', ['init', authorityRoot]);
  await execFileAsync('git', ['-C', authorityRoot, 'config', 'user.email', 'capsule@example.test']);
  await execFileAsync('git', ['-C', authorityRoot, 'config', 'user.name', 'Capsule Test']);
  await execFileAsync('git', ['-C', authorityRoot, 'add', 'docs']);
  await execFileAsync('git', ['-C', authorityRoot, 'commit', '-m', 'test: seed managed capsule']);
  const { stdout } = await execFileAsync('git', ['-C', authorityRoot, 'rev-parse', 'HEAD']);
  const head = stdout.trim();
  const authorityRunDir = path.join(authorityRoot, '.vibepro', 'executions', STORY_ID, 'runs', RUN_ID);
  const sourceRunDir = path.join(sourceRoot, '.vibepro', 'executions', STORY_ID, 'runs', RUN_ID);
  const prDir = path.join(authorityRoot, '.vibepro', 'pr', STORY_ID);
  await Promise.all([
    mkdir(authorityRunDir, { recursive: true }),
    mkdir(sourceRunDir, { recursive: true }),
    mkdir(prDir, { recursive: true })
  ]);
  const state = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    run_id: RUN_ID,
    status: 'running',
    attempt: 1,
    iteration: 0,
    current_head_sha: head,
    execution_context: { authority_kind: 'managed', root_realpath: authorityRoot },
    managed_worktree: { status: 'active', mode: 'managed', source_repo: sourceRoot },
    transitions: [{ sequence: 1, from: null, to: 'running', reason: 'run_created' }]
  };
  const stateRaw = `${JSON.stringify(state, null, 2)}\n`;
  await Promise.all([
    writeFile(path.join(authorityRunDir, 'state.json'), stateRaw),
    writeFile(path.join(sourceRunDir, 'state.json'), stateRaw),
    writeFile(path.join(prDir, 'pr-prepare.json'), `${JSON.stringify({
      gate_status: {
        execution_gate: {
          blocking_gates: [{ id: 'gate:review', status: 'needs_evidence', reason: 'Review evidence is missing.' }]
        }
      }
    }, null, 2)}\n`),
    writeFile(path.join(prDir, 'decision-records.json'), `${JSON.stringify({
      decisions: [{ id: 'decision-managed', status: 'open', summary: 'Choose the handoff owner.' }]
    }, null, 2)}\n`)
  ]);

  const result = await refreshActiveRunContextCapsule(authorityRoot, {
    storyId: STORY_ID,
    reason: 'verification_recorded'
  });
  assert.equal(result.regenerated, true);
  const authorityCapsuleFile = path.join(authorityRunDir, 'context-capsule.json');
  const sourceCapsuleFile = path.join(sourceRunDir, 'context-capsule.json');
  const authorityCapsule = await readFile(authorityCapsuleFile, 'utf8');
  const sourceCapsule = await readFile(sourceCapsuleFile, 'utf8');
  assert.equal(sourceCapsule, authorityCapsule);
  assert.equal(JSON.parse(authorityCapsule).head_sha, head);

  await writeFile(authorityCapsuleFile, '{"schema_version":');
  await createRunContextCapsule().recover(authorityRoot, {
    storyId: STORY_ID,
    runId: RUN_ID,
    rebuildOnStale: true
  });
  const rebuiltAuthorityCapsule = await readFile(authorityCapsuleFile, 'utf8');
  assert.notEqual(rebuiltAuthorityCapsule, authorityCapsule);
  assert.equal(await readFile(sourceCapsuleFile, 'utf8'), rebuiltAuthorityCapsule);

  const moduleUrl = pathToFileURL(path.resolve('src/run-context-capsule.js')).href;
  const recoveryScript = `import { recoverRunContext } from ${JSON.stringify(moduleUrl)};\nconst recovery = await recoverRunContext(${JSON.stringify(authorityRoot)}, { storyId: ${JSON.stringify(STORY_ID)}, runId: ${JSON.stringify(RUN_ID)} });\nprocess.stdout.write(JSON.stringify(recovery));`;
  const recovered = await execFileAsync(process.execPath, ['--input-type=module', '-e', recoveryScript]);
  const recovery = JSON.parse(recovered.stdout);
  assert.equal(recovery.bottleneck.id, 'gate:review');
  assert.equal(recovery.open_decisions[0].id, 'decision-managed');
  assert.equal(Object.hasOwn(recovery, 'transcript'), false);

  const authorityBeforeRejectedRecovery = await readFile(authorityCapsuleFile, 'utf8');
  const sourceBeforeRejectedRecovery = await readFile(sourceCapsuleFile, 'utf8');
  await writeFile(path.join(authorityRunDir, 'state.json'), `${JSON.stringify({
    ...state,
    run_id: 'run-wrong-binding'
  }, null, 2)}\n`);
  await assert.rejects(
    createRunContextCapsule().recover(sourceRoot, {
      storyId: STORY_ID,
      runId: RUN_ID,
      rebuildOnStale: true
    }),
    errorWithCode('stale_binding')
  );
  assert.equal(await readFile(authorityCapsuleFile, 'utf8'), authorityBeforeRejectedRecovery);
  assert.equal(await readFile(sourceCapsuleFile, 'utf8'), sourceBeforeRejectedRecovery);
});

async function createFixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-context-capsule-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runDir = path.join(root, '.vibepro', 'executions', STORY_ID, 'runs', RUN_ID);
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  const storyDir = path.join(root, 'docs', 'management', 'stories', 'active');
  await Promise.all([
    mkdir(runDir, { recursive: true }),
    mkdir(prDir, { recursive: true }),
    mkdir(storyDir, { recursive: true })
  ]);

  const state = {
    schema_version: '0.1.0',
    run_id: RUN_ID,
    story_id: STORY_ID,
    target: 'pr_ready',
    autonomy_mode: 'guarded',
    created_at: '2026-07-16T02:03:04.000Z',
    updated_at: '2026-07-16T02:05:00.000Z',
    status: 'waiting_for_human',
    stop_reason: { code: 'decision_required', message: 'Choose a safe boundary.', details: {} },
    attempt: 2,
    iteration: 7,
    budget: { max_attempts: 4, max_iterations: 12 },
    deadline: null,
    last_progress_at: '2026-07-16T02:05:00.000Z',
    pending_decision: { id: 'decision-1', prompt: 'Approve the bounded projection contract?' },
    current_head_sha: HEAD,
    execution_context: {
      authority_kind: 'repository',
      root_realpath: root,
      git_dir_realpath: path.join(root, '.git')
    },
    managed_worktree: { status: 'disabled', mode: 'disabled', source_repo: root },
    transitions: [
      { sequence: 1, from: null, to: 'running', reason: 'run_created', timestamp: '2026-07-16T02:03:04.000Z' },
      { sequence: 2, from: 'running', to: 'waiting_for_human', reason: 'human_decision_required', timestamp: '2026-07-16T02:05:00.000Z' }
    ]
  };
  const stateFile = path.join(runDir, 'state.json');
  const capsuleFile = path.join(runDir, 'context-capsule.json');
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const objective = options.objectiveLength
    ? `restart remains bounded ${'x'.repeat(options.objectiveLength)}`
    : 'restart does not require a transcript';
  const nonGoals = Array.from({ length: options.nonGoalCount ?? 2 }, (_, index) => `- Non-goal ${index + 1}: ${'n'.repeat(300)}`).join('\n');
  await writeFile(path.join(storyDir, `${STORY_ID}.md`), `---\nstory_id: ${STORY_ID}\ntitle: Capsule test\nstatus: active\n---\n\n# Capsule test\n\n## User Story\n\n**I want** recoverable bounded context\n**So that** ${objective}\n\n## Non Goals\n\n${nonGoals}\n`);

  await writeFile(path.join(prDir, 'pr-prepare.json'), `${JSON.stringify({
    gate_status: {
      execution_gate: {
        blocking_gates: [{ id: 'gate:test_plan', label: 'Test Plan Gate', status: 'needs_evidence', reason: 'Focused test evidence is missing.' }]
      }
    }
  }, null, 2)}\n`);
  const evidenceFile = path.join(prDir, 'verification-evidence.json');
  await writeFile(evidenceFile, `${JSON.stringify({
    story_id: STORY_ID,
    commands: Array.from({ length: options.evidenceCommandCount ?? 1 }, (_, index) => ({
      kind: `unit-${index}-${'k'.repeat(20)}`,
      status: 'pass',
      command: 'RAW_TOOL_OUTPUT_SHOULD_NEVER_BE_COPIED',
      output: 'FULL_DIFF_SHOULD_NEVER_BE_COPIED'
    }))
  }, null, 2)}\n`);
  const decisionFile = path.join(prDir, 'decision-records.json');
  const decisions = Array.from({ length: options.openDecisionCount ?? 1 }, (_, index) => ({
    id: index === 0 ? 'decision-1' : `decision-${index + 1}`,
    status: 'open',
    summary: `Decision ${index + 1}: ${'x'.repeat(300)}`,
    provider_transcript: 'PROVIDER_TRANSCRIPT_SHOULD_NEVER_BE_COPIED'
  }));
  if (options.includeDecisions !== false) {
    await writeFile(decisionFile, `${JSON.stringify({ story_id: STORY_ID, decisions }, null, 2)}\n`);
  }

  let head = HEAD;
  let now = new Date('2026-07-16T02:06:00.000Z');
  return {
    root,
    stateFile,
    capsuleFile,
    evidenceFile,
    decisionFile,
    manager: (dependencies = {}) => createRunContextCapsule({
      now: () => now,
      resolveHead: async () => head,
      ...dependencies
    }),
    setHead(value) { head = value; },
    advanceClock() { now = new Date(now.getTime() + 60_000); }
  };
}

function errorWithCode(code) {
  return (error) => {
    assert.ok(error instanceof RunContextCapsuleError);
    assert.equal(error.code, code);
    return true;
  };
}

function serializeFixtureCapsule(capsule) {
  for (let index = 0; index < 4; index += 1) {
    const raw = `${JSON.stringify(capsule, null, 2)}\n`;
    const size = Buffer.byteLength(raw);
    if (capsule.size_bytes === size) return raw;
    capsule.size_bytes = size;
  }
  return `${JSON.stringify(capsule, null, 2)}\n`;
}
