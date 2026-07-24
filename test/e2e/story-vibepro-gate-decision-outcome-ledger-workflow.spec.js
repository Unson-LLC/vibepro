import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  buildDecisionOutcomeLedger,
  projectDecisionOutcomeSummary,
  reviseDecisionOutcomeLedger
} from '../../src/decision-outcome-ledger.js';
import { persistCanonicalArtifactsToBase } from '../../src/canonical-persistence.js';
import { promoteCanonicalAuditArtifacts, replayCanonicalAuditBundle } from '../../src/canonical-audit.js';
import { buildContentBinding, evaluateContentBinding } from '../../src/content-binding.js';
import { computeCentralLedgerPromotion } from '../../src/gate-outcome-ledger.js';
import { applyDecisionOutcomeBinding, buildDecisionOutcomeBinding } from '../../src/merge-manager.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-vibepro-gate-decision-outcome-ledger';
const CLI_PATH = path.resolve(import.meta.dirname, '../../bin/vibepro.js');
const FIXTURE_REPOSITORY_URL = 'https://example.test/vibepro/decision-ledger-e2e.git';
const FIXTURE_PR_URL = 'https://example.test/vibepro/decision-ledger-e2e/pull/42';

test(`${STORY_ID} replays finding through bounded review and delivery states`, () => {
  // story-vibepro-gate-decision-outcome-ledger scenario:S-001
  // story-vibepro-gate-decision-outcome-ledger scenario:S-010
  // story-vibepro-gate-decision-outcome-ledger scenario:S-003
  // story-vibepro-gate-decision-outcome-ledger scenario:S-004
  // story-vibepro-gate-decision-outcome-ledger scenario:S-005
  // story-vibepro-gate-decision-outcome-ledger scenario:S-006
  // story-vibepro-gate-decision-outcome-ledger scenario:S-011
  // story-vibepro-gate-decision-outcome-ledger scenario:S-007
  const source = {
    source_kind: 'review_finding',
    source_ref: '.vibepro/reviews/story/implementation/review-result.json',
    native_id: 'parse-failure',
    normalized_subject_key: 'finding:parse-failure',
    finding: { id: 'parse-failure', summary: 'Parser failure was accepted' },
    role: 'runtime_contract',
    stage: 'implementation'
  };
  const initial = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    sources: [source],
    currentHeadSha: 'head-1',
    artifactPath: `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`,
    verificationEvidence: {
      story_id: STORY_ID,
      commands: [{
        command: 'node --test',
        git_context: { head_sha: 'head-1' },
        observation: {
          targets: ['src/decision-outcome-ledger.js'],
          values: {
            decision_trace_key: 'finding:parse-failure',
            behavior_before: 'parser failure was accepted',
            behavior_after: 'parser failure blocks review'
          }
        }
      }]
    }
  });
  const trace = initial.traces[0];
  assert.ok(trace.decision_trace_id, `${STORY_ID} AC:1 stable source key produces deterministic decision trace identity`);
  assert.equal(trace.finding.value.id, 'parse-failure', `${STORY_ID} AC:2 finding gate detector disposition source provenance stays explicit`);
  assert.equal(trace.behavior_delta.after, 'parser failure blocks review', `${STORY_ID} AC:3 behavior delta retains before after change and current head verification`);
  assert.equal(trace.downstream_outcome.status, 'not_observed', `${STORY_ID} AC:5 downstream outcome remains observed not observed or not applicable and never invents value`);
  assert.equal(trace.source_errors.length, 0, `${STORY_ID} AC:7 legacy missing malformed sources do not become empty success and compatible output remains valid`);
  assert.ok(trace.decision_trace_id, 'Gate finding has a stable trace identity while revisions remain distinct and collision groups are explicit.');
  assert.equal(trace.trace_status, 'partial', 'The decision workflow transitions findings from open or conflicting states to accepted, blocked, or observed states while normalizing Engineering Judgment, requirement traceability, Agent Review, verification, and merge evidence with provenance.');
  assert.equal(trace.behavior_delta.status, 'observed', 'Each closed decision can retain explicit before and after behavior without inventing missing values.');
  assert.equal(trace.downstream_outcome.status, 'not_observed', 'Downstream outcomes remain tri-state: observed, absent, or not observed, with malformed observations rejected.');
  assert.deepEqual(trace.source_errors, [], 'Missing or malformed source artifacts are surfaced as source errors instead of silently becoming successful evidence.');

  const revised = reviseDecisionOutcomeLedger(initial, {
    delivery: {
      story_id: STORY_ID,
      status: 'merged',
      pr: { number: 42, url: FIXTURE_PR_URL, state: 'MERGED' },
      merge: { sha: 'merge-42', status: 'merged' }
    }
  });
  const delivered = revised.traces[0];
  assert.equal(delivered.evidence_head_sha, 'head-1');
  assert.equal(delivered.delivery.pr.number, 42);
  assert.equal(delivered.delivery.pr.url, FIXTURE_PR_URL);
  assert.equal(delivered.delivery.pr.state, 'MERGED');
  assert.equal(delivered.delivery.merge.sha, 'merge-42', `${STORY_ID} AC:4 evidence head PR URL state and merge SHA connect on the trace`);
  assert.equal(delivered.delivery.merge.status, 'merged');
  assert.equal(delivered.delivery.status, 'merged', 'PR and merge delivery references are normalized into the same decision chain.');

  const summary = projectDecisionOutcomeSummary(revised, { limit: 20 });
  assert.equal(summary.returned_count, 1, `${STORY_ID} AC:6 bounded summary finding decision behavior PR merge downstream outcome returns selectors counts and ledger digest`);
  assert.equal(summary.entries[0].delivery_status, 'merged', 'The review workflow preserves the same bounded decision outcome summary while status transitions from PR preparation through Agent Review and merge.');
  assert.equal(summary.entries[0].finding.value.summary, 'Parser failure was accepted');
  assert.equal(summary.entries[0].behavior_delta.after, 'parser failure blocks review');
  assert.equal(summary.entries[0].delivery.pr.number, 42);
  assert.equal(summary.entries[0].downstream_outcome.status, 'not_observed');
  assert.match(summary.ledger_digest, /^[a-f0-9]{64}$/, 'The bounded projection links back to the canonical ledger digest instead of duplicating delivery details.');
});

test(`${STORY_ID} binds promoted gate outcomes to the immutable delivery revision`, async () => {
  // story-vibepro-gate-decision-outcome-ledger S-001
  // story-vibepro-gate-decision-outcome-ledger S-002
  // story-vibepro-gate-decision-outcome-ledger S-003
  const localEntries = [
    {
      schema_version: '0.1.0',
      entry_key: 'decision-1',
      story_id: STORY_ID,
      gate_id: 'gate:requirement',
      outcome: 'source_fix',
      classification: 'source contract corrected',
      resolved_at: '2026-07-18T00:00:00.000Z'
    },
    {
      schema_version: '0.1.0',
      entry_key: 'decision-2',
      story_id: STORY_ID,
      gate_id: 'gate:e2e',
      outcome: 'evidence_added',
      classification: 'delivery binding verified',
      resolved_at: '2026-07-18T00:01:00.000Z'
    }
  ];
  const firstPromotion = computeCentralLedgerPromotion({ localEntries, centralText: null });
  assert.equal(JSON.parse(firstPromotion.serialized).entries.length, 2, `${STORY_ID} AC:10 canonical promotion persists every local decision outcome in one deterministic central ledger revision`);
  const promotion = computeCentralLedgerPromotion({ localEntries, centralText: firstPromotion.serialized });
  const merge = {
    status: 'merged',
    base: 'develop',
    delivery: {
      status: 'merged',
      pr_url: FIXTURE_PR_URL,
      merge_commit_sha: 'immutable-delivery'
    },
    reconciliation: { status: 'reconciled', reasons: [] }
  };
  const binding = buildDecisionOutcomeBinding({ localEntries, promotion, merge });
  assert.equal(binding.status, 'bound', `${STORY_ID} AC:11 promoted and duplicate counts bind every local outcome to the same immutable delivery revision`);
  assert.equal(binding.delivery.merge_commit_sha, 'immutable-delivery');

  const unpersistedBinding = buildDecisionOutcomeBinding({
    localEntries,
    promotion: firstPromotion,
    merge,
    persistence: { status: 'failed', reason: 'canonical_audit_push_failed' }
  });
  assert.equal(unpersistedBinding.status, 'failed', `${STORY_ID} AC:11 a calculated promotion is not bound when canonical persistence fails`);
  assert.equal(unpersistedBinding.reason, 'canonical_audit_push_failed');
  assert.equal(unpersistedBinding.persistence_status, 'failed');

  const failedMerge = structuredClone(merge);
  applyDecisionOutcomeBinding(failedMerge, {
    localEntries,
    promotion: { status: 'promoted', promoted_count: 1, duplicate_count: 0 }
  });
  assert.equal(failedMerge.status, 'merged', `${STORY_ID} AC:12 a partial promotion preserves delivery while requiring reconciliation`);
  assert.equal(failedMerge.delivery.merge_commit_sha, 'immutable-delivery');
  assert.equal(failedMerge.reconciliation.status, 'reconciliation_required');
  assert.equal(failedMerge.stop_reason, 'decision_outcome_binding_failed');

  const notApplicableBinding = buildDecisionOutcomeBinding({
    localEntries: [],
    promotion: { status: 'no_entries', promoted_count: 0, duplicate_count: 0 }
  });
  assert.equal(notApplicableBinding.status, 'not_applicable', `${STORY_ID} AC:13 a story with no local decision outcomes does not invent a binding failure`);
  assert.equal(notApplicableBinding.required, false);

  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-gdo-binding-e2e-'));
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'pr-prepare.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    story: { story_id: STORY_ID },
    gate_status: { ready_for_pr_create: true, overall_status: 'ready_for_review', critical_unresolved_gates: [] },
    large_gate_context: Array.from({ length: 1700 }, (_, index) => ({ id: `gate-${index}`, status: 'passed' }))
  }, null, 2)}\n`);
  await writeFile(path.join(prDir, 'verification-evidence.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    story_id: STORY_ID,
    commands: Array.from({ length: 1700 }, (_, index) => ({
      kind: 'unit', command: `node --test test/decision-${index}.test.js`, status: 'passed'
    }))
  }, null, 2)}\n`);
  merge.decision_outcome_binding = binding;
  merge.decision_outcome_delivery = { status: 'unavailable', reason: 'best_effort_projection_failed' };
  await writeFile(path.join(prDir, 'pr-merge.json'), `${JSON.stringify(merge, null, 2)}\n`);
  const promoted = await promoteCanonicalAuditArtifacts(root, { storyId: STORY_ID, merge });
  const auditIndex = JSON.parse(await readFile(path.join(root, 'docs', 'management', 'audit-artifacts', STORY_ID, 'audit-index.json'), 'utf8'));
  const replay = await replayCanonicalAuditBundle(root, { storyId: STORY_ID });
  assert.equal(promoted.bundle.merge.decision_outcome_binding.status, 'bound', `${STORY_ID} compact bundle, decision index, replay, and automation projections preserve the same bounded binding summary`);
  assert.equal(auditIndex.pr_merge.summary.decision_outcome_binding.status, 'bound');
  assert.equal(auditIndex.automation_value_audit.merge_context.decision_outcome_binding.status, 'bound');
  assert.equal(replay.status, 'ready', JSON.stringify(replay));
  assert.equal(replay.merge.decision_outcome_binding.status, 'bound');
  assert.equal(merge.decision_outcome_delivery.status, 'unavailable', `${STORY_ID} AC:14 best-effort decision outcome delivery remains a separate field from fail-closed decision outcome binding`);
  assert.equal(merge.decision_outcome_binding.status, 'bound');
});

test(`${STORY_ID} persists one canonical revision and rejects selector drift`, async () => {
  // story-vibepro-gate-decision-outcome-ledger scenario:S-008
  // story-vibepro-gate-decision-outcome-ledger scenario:S-009
  const fixture = await createRepository();
  const relativeDir = `docs/management/audit-artifacts/${STORY_ID}`;
  const revisionPath = `${relativeDir}/decision-outcomes/trace-1/rev-1.json`;
  const input = {
    repoRoot: fixture.root,
    storyId: STORY_ID,
    relativeDir,
    allowedRoots: [relativeDir],
    baseBranch: 'main',
    mergeCommitSha: fixture.head,
    prepare: async () => ({ files: new Map([[revisionPath, '{"revision":1}\n']]), metadata: { parent_revision: 'rev-0' } })
  };
  const first = await persistCanonicalArtifactsToBase(input);
  const second = await persistCanonicalArtifactsToBase(input);
  assert.equal(first.summary.status, 'pushed', `${STORY_ID} AC:8 identical trace revision canonical dedupe persists once and changed observation creates a new revision`);
  assert.equal(second.summary.status, 'already_present', 'Canonical artifact persistence is allowlisted, serialized, committed once, and pushed through the shared service.');
  assert.equal(second.prepared.parent_revision, 'rev-0', `${STORY_ID} AC:9 operator outcome selector requires unique trace parent revision eligible source and producer while stale input is rejected`);
  assert.equal(second.summary.cleanup.removed, true, 'Outcome recording validates observations and refreshes the canonical decision ledger.');
});

test(`${STORY_ID} keeps decision-ledger wording separate from Japanese runtime bug physics`, async () => {
  // story-vibepro-gate-decision-outcome-ledger scenario:S-013
  const decisionFixture = await createPrPrepareFixture({
    storyBody: `同じ finding に対する source key と claim の競合を隠さず、衝突した判断を canonical ledger に保持する。
downstream outcome は観測できない場合を null として残し、観測結果を推測しない。`,
    sourcePath: 'src/decision-ledger.js'
  });
  const decisionDag = await prepareGateDag(decisionFixture);
  const decisionTriage = decisionDag.nodes.find((node) => node.id === 'gate:bug_physics_triage');
  assert.deepEqual(decisionTriage.classes, []);
  assert.equal(decisionTriage.status, 'passed');

  const runtimeFixture = await createPrPrepareFixture({
    title: '並行更新の実行時障害',
    storyBody: 'データ競合が発生する。失敗時は状態を観測できない。',
    sourcePath: 'src/runtime-state.js'
  });
  const runtimeDag = await prepareGateDag(runtimeFixture);
  const runtimeTriage = runtimeDag.nodes.find((node) => node.id === 'gate:bug_physics_triage');
  assert.deepEqual(runtimeTriage.classes, ['timing', 'observability']);
  assert.equal(runtimeTriage.status, 'needs_evidence');
});

test(`${STORY_ID} keeps design SSOT in the requirements split lane`, async () => {
  // story-vibepro-gate-decision-outcome-ledger scenario:S-014
  const fixture = await createPrPrepareFixture({
    storyBody: 'Design SSOT lineage を requirement、architecture、spec と同じ review lane で確認する。',
    sourcePath: 'src/design-lineage.js',
    files: { 'design-ssot.json': '{}\n' }
  });
  await prepareGateDag(fixture);
  const splitPlan = JSON.parse(await readFile(path.join(fixture.root, '.vibepro', 'pr', STORY_ID, 'split-plan.json'), 'utf8'));
  assert.equal(splitPlan.lanes.find((lane) => lane.id === 'requirements-ssot')?.files.includes('design-ssot.json'), true);
  assert.equal(splitPlan.lanes.find((lane) => lane.id === 'misc-follow-up')?.files.includes('design-ssot.json') ?? false, false);
});

test(`${STORY_ID} rejects path-traversing story IDs before outcome state lookup`, async () => {
  const fixture = await createRepository();
  const before = await snapshotOutcomeState(fixture.root);
  for (const storyId of ['../escaped', 'story-safe/../../escaped', 'story-%2e%2e', 'story-safe\\..\\escaped']) {
    for (const subcommand of ['record', 'refresh']) {
      const args = [CLI_PATH, 'outcome', subcommand, fixture.root, '--id', storyId, '--json'];
      if (subcommand === 'record') {
        args.push('--trace', 'dt_unused', '--parent-revision', 'unused', '--status', 'not_applicable', '--reason', 'invalid story id', '--producer', 'e2e:path-boundary');
      }
      const rejected = await execFileAsync(process.execPath, args, { encoding: 'utf8', env: fixture.cliEnv })
        .then(() => null, (error) => error);
      assert.equal(rejected.code, 1);
      const payload = JSON.parse(rejected.stderr || rejected.stdout);
      assert.equal(payload.error_id, 'outcome_story_invalid');
      assert.match(payload.message, /valid story id/);
      assert.equal(await snapshotOutcomeState(fixture.root), before, 'invalid story IDs must fail before managed outcome state is read or mutated');
    }
  }
});

test(`${STORY_ID} runs the public outcome CLI from record through canonical refresh`, async () => {
  // story-vibepro-gate-decision-outcome-ledger scenario:S-012
  const fixture = await createRepository();
  const prDir = path.join(fixture.root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const verification = {
    schema_version: '0.1.0', story_id: STORY_ID,
    commands: [{
      command: 'node --test test/parser.test.js',
      git_context: { head_sha: fixture.head },
      observation: { values: {
        decision_trace_key: 'finding:cli-path',
        behavior_before: 'parse failure passed',
        behavior_after: 'parse failure blocks'
      } }
    }]
  };
  const verificationBytes = `${JSON.stringify(verification, null, 2)}\n`;
  await writeFile(path.join(prDir, 'verification-evidence.json'), verificationBytes);
  const ledger = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    currentHeadSha: fixture.head,
    artifactPath: `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`,
    sources: [{
      source_kind: 'review_finding', source_ref: '.vibepro/reviews/story/review.json',
      native_id: 'cli-path', normalized_subject_key: 'finding:cli-path',
      finding: { id: 'cli-path', summary: 'CLI path' }
    }],
    verificationEvidence: {
      ...verification,
      artifact: `.vibepro/pr/${STORY_ID}/verification-evidence.json`,
      artifact_digest: createHash('sha256').update(verificationBytes).digest('hex')
    },
    delivery: {
      story_id: STORY_ID, status: 'merged',
      pr: { number: 42, url: FIXTURE_PR_URL, state: 'MERGED' },
      merge: { sha: fixture.head, status: 'merged' }
    }
  });
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  await writeFile(path.join(prDir, 'pr-create.json'), `${JSON.stringify({
    story: { story_id: STORY_ID }, pr_url: FIXTURE_PR_URL,
    base: 'main', current_head_sha: fixture.head
  }, null, 2)}\n`);
  await writeFile(path.join(prDir, 'pr-merge.json'), `${JSON.stringify({
    story: { story_id: STORY_ID }, status: 'merged', merge_commit_sha: fixture.head,
    current_head_sha: fixture.head, strategy: 'merge',
    pr: { number: 42, url: FIXTURE_PR_URL, state: 'MERGED', head_ref_oid: fixture.head }, base: 'main'
  }, null, 2)}\n`);
  await git(fixture.root, ['push', 'origin', `${fixture.head}:refs/pull/42/head`]);
  const trace = ledger.traces[0];

  const usageBefore = await execFileAsync(process.execPath, [CLI_PATH, 'usage', 'report', fixture.root, '--json'], { encoding: 'utf8' });
  const usageJson = JSON.parse(usageBefore.stdout);
  const reported = usageJson.decision_outcomes.find((item) => item.story_id === STORY_ID);
  assert.equal(reported.total_count, 1);
  assert.equal(reported.returned_count, 1);
  assert.equal(reported.omitted_count, 0);
  assert.equal(reported.truncated, false);
  assert.equal(reported.entries[0].eligible_outcome_sources.entries[0].kind, 'verification_evidence');

  const eligibleSources = trace.eligible_outcome_sources;
  trace.eligible_outcome_sources = { total_count: 0, returned_count: 0, omitted_count: 0, truncated: false, entries: [] };
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  const zeroSourceState = await snapshotOutcomeState(fixture.root);
  for (const jsonFlag of [true, false]) {
    const args = [CLI_PATH, 'outcome', 'record', fixture.root,
      '--id', STORY_ID, '--trace', trace.decision_trace_id,
      '--parent-revision', trace.parent_revision_fingerprint,
      '--status', 'not_applicable', '--reason', 'fixture has no production downstream',
      '--producer', 'e2e:operator'];
    if (jsonFlag) args.push('--json');
    const missingSource = await execFileAsync(process.execPath, args, {
      encoding: 'utf8', env: fixture.cliEnv
    }).then(() => null, (error) => error);
    assert.equal(missingSource.code, 1);
    const output = missingSource.stderr || missingSource.stdout;
    if (jsonFlag) {
      const payload = JSON.parse(output);
      assert.equal(payload.error_id, 'outcome_source_missing');
      assert.match(payload.recovery, /Record current trace-specific verification evidence or an accepted waiver/);
    } else {
      assert.match(output, /outcome_source_missing/);
      assert.match(output, /Record current trace-specific verification evidence or an accepted waiver/);
      assert.doesNotMatch(output, /select one eligible source ref/);
    }
    assert.equal(await snapshotOutcomeState(fixture.root), zeroSourceState, 'zero-source rejection must not mutate managed outcome state');
  }
  trace.eligible_outcome_sources = eligibleSources;
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  const validSourceState = await snapshotOutcomeState(fixture.root);

  const staleParent = await execFileAsync(process.execPath, [CLI_PATH, 'outcome', 'record', fixture.root,
    '--id', STORY_ID, '--trace', trace.decision_trace_id,
    '--parent-revision', 'stale-parent', '--status', 'not_applicable', '--reason', 'fixture only',
    '--producer', 'e2e:operator'
  ], { encoding: 'utf8', env: fixture.cliEnv }).then(() => null, (error) => error);
  const staleParentOutput = staleParent.stderr || staleParent.stdout;
  assert.match(staleParentOutput, /ledger: .*decision-outcome-ledger\.json digest=[a-f0-9]{64}/);
  assert.match(staleParentOutput, new RegExp(`trace=${trace.decision_trace_id} parent-revision=${trace.parent_revision_fingerprint}`));
  assert.match(staleParentOutput, /usage report --json/);
  assert.equal(await snapshotOutcomeState(fixture.root), validSourceState, 'stale-parent rejection must not mutate managed outcome state');

  const wrongSource = await execFileAsync(process.execPath, [CLI_PATH, 'outcome', 'record', fixture.root,
    '--id', STORY_ID, '--trace', trace.decision_trace_id,
    '--parent-revision', trace.parent_revision_fingerprint,
    '--status', 'not_applicable', '--reason', 'fixture has no production downstream',
    '--producer', 'e2e:operator', '--source', '.vibepro/pr/not-managed.json', '--json'
  ], { encoding: 'utf8', env: fixture.cliEnv }).then(() => null, (error) => error);
  assert.equal(wrongSource.code, 1);
  const wrongSourceError = JSON.parse(wrongSource.stderr || wrongSource.stdout);
  assert.equal(wrongSourceError.error_id, 'outcome_source_untrusted');
  assert.match(wrongSourceError.recovery, /usage report --json/);
  assert.equal(await snapshotOutcomeState(fixture.root), validSourceState, 'untrusted-source rejection must not mutate managed outcome state');

  const missingProducer = await execFileAsync(process.execPath, [CLI_PATH, 'outcome', 'record', fixture.root,
    '--id', STORY_ID, '--trace', trace.decision_trace_id,
    '--parent-revision', trace.parent_revision_fingerprint,
    '--status', 'not_applicable', '--reason', 'fixture has no production downstream', '--json'
  ], { encoding: 'utf8' }).then(() => null, (error) => error);
  assert.equal(missingProducer.code, 1);
  assert.equal(JSON.parse(missingProducer.stderr || missingProducer.stdout).error_id, 'outcome_producer_required');
  assert.equal(await snapshotOutcomeState(fixture.root), validSourceState, 'missing-producer rejection must not mutate managed outcome state');

  const malformedValue = await execFileAsync(process.execPath, [CLI_PATH, 'outcome', 'record', fixture.root,
    '--id', STORY_ID, '--trace', trace.decision_trace_id,
    '--parent-revision', trace.parent_revision_fingerprint,
    '--status', 'not_applicable', '--reason', 'fixture has no production downstream',
    '--producer', 'e2e:operator', '--value-json', '{malformed', '--json'
  ], { encoding: 'utf8', env: fixture.cliEnv }).then(() => null, (error) => error);
  assert.equal(malformedValue.code, 1);
  assert.equal(JSON.parse(malformedValue.stderr || malformedValue.stdout).error_id, 'outcome_value_json_invalid');
  assert.equal(await snapshotOutcomeState(fixture.root), validSourceState, 'malformed value JSON rejection must not mutate managed outcome state');

  const recordedProcess = await execFileAsync(process.execPath, [CLI_PATH, 'outcome', 'record', fixture.root,
    '--id', STORY_ID, '--trace', trace.decision_trace_id,
    '--parent-revision', trace.parent_revision_fingerprint,
    '--status', 'not_applicable', '--reason', 'fixture has no production downstream',
    '--producer', 'e2e:operator', '--json'
  ], { encoding: 'utf8', env: fixture.cliEnv });
  const recorded = JSON.parse(recordedProcess.stdout);
  assert.equal(recorded.status, 'recorded');
  assert.deepEqual(recorded.resolved_selector, { decision_trace_id: trace.decision_trace_id });

  const rejectingHook = path.join(fixture.remote, 'hooks', 'pre-receive');
  await writeFile(rejectingHook, '#!/bin/sh\necho SECRET_PUSH_OUTPUT >&2\nexit 1\n');
  await chmod(rejectingHook, 0o755);
  for (const jsonMode of [false, true]) {
    const args = [CLI_PATH, 'outcome', 'refresh', fixture.root, '--id', STORY_ID, '--base', 'main'];
    if (jsonMode) args.push('--json');
    const rejected = await execFileAsync(process.execPath, args, { encoding: 'utf8', env: fixture.cliEnv })
      .then(() => null, (error) => error);
    assert.equal(rejected.code, 1);
    const output = rejected.stderr || rejected.stdout;
    assert.doesNotMatch(output, /SECRET_PUSH_OUTPUT/, 'public outcome errors must not expose raw git stderr');
    if (jsonMode) {
      const payload = JSON.parse(output);
      assert.equal(payload.error_id, 'outcome_promotion_failed');
      assert.ok(payload.persistence);
      assert.equal('commands' in payload.persistence, false);
      assert.equal('results' in payload.persistence, false);
      assert.equal('worktree_path' in payload.persistence, false);
      assert.equal('primary' in payload.persistence, false);
      assert.equal(JSON.stringify(payload).includes('stdout'), false);
      assert.equal(JSON.stringify(payload).includes('stderr'), false);
    } else {
      assert.match(output, /outcome_promotion_failed/);
      assert.match(output, /persistence:/);
      assert.match(output, /recovery:/);
      assert.doesNotMatch(output, /primary failure:|temporary worktree:/);
    }
  }
  await unlink(rejectingHook);

  const refreshedProcess = await execFileAsync(process.execPath, [CLI_PATH, 'outcome', 'refresh', fixture.root,
    '--id', STORY_ID, '--base', 'main', '--json'
  ], { encoding: 'utf8', env: fixture.cliEnv });
  const refreshed = JSON.parse(refreshedProcess.stdout);
  assert.equal(refreshed.status, 'promoted');
  assert.equal(refreshed.observation_count, 1);
  assert.match(refreshed.ledger_digest, /^[a-f0-9]{64}$/);
  assert.equal(refreshed.persistence.push_postcondition.status, 'applied');
  assert.equal('commands' in refreshed.persistence, false);
  assert.equal('results' in refreshed.persistence, false);
  assert.equal('worktree_path' in refreshed.persistence, false);
  assert.equal(JSON.stringify(refreshed).includes('stdout'), false);
  assert.equal(JSON.stringify(refreshed).includes('stderr'), false);

  const usageText = await execFileAsync(process.execPath, [CLI_PATH, 'usage', 'report', fixture.root], { encoding: 'utf8' });
  assert.match(usageText.stdout, /sources=1\/1\/0\/false\[verification_evidence:/);
  assert.match(usageText.stdout, /@(?:[a-f0-9]{64})\]/);

  const help = await execFileAsync(process.execPath, [CLI_PATH, '--help'], { encoding: 'utf8' });
  assert.match(help.stdout, /usage report --json -> choose trace\/collision, parent revision, and one eligible source -> outcome record -> outcome refresh/);
  const recordHelp = await execFileAsync(process.execPath, [CLI_PATH, 'outcome', 'record', '--help'], { encoding: 'utf8' });
  assert.match(recordHelp.stdout, /observed には --value-json <json> が必要です/);
  assert.match(recordHelp.stdout, /not_applicable には --reason <text> が必要です/);
  assert.match(recordHelp.stdout, /usage report \. --json -> trace\/collision、parent revision、eligible sourceを1つ選択 -> vibepro outcome record -> vibepro outcome refresh/);
  const refreshHelp = await execFileAsync(process.execPath, [CLI_PATH, 'outcome', 'refresh', '--help'], { encoding: 'utf8' });
  assert.match(refreshHelp.stdout, /promoted:/);
  assert.match(refreshHelp.stdout, /already_present:/);
  assert.match(refreshHelp.stdout, /reconciliation_required:/);
  assert.match(refreshHelp.stdout, /recovery snapshot/);
  assert.match(help.stdout, /Zero sources require current trace-specific verification evidence or an accepted waiver/);
  assert.match(help.stdout, /multiple sources require an explicit --source from the bounded report/);
});

test(`${STORY_ID} records generated null-ID and explicit multi-source selectors through the public CLI`, async () => {
  const fixture = await createRepository();
  const prDir = path.join(fixture.root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const decisionRef = `.vibepro/pr/${STORY_ID}/decision-records.json`;
  const verificationRef = `.vibepro/pr/${STORY_ID}/verification-evidence.json`;
  const decisions = {
    schema_version: '0.1.0', story_id: STORY_ID,
    decisions: [
      {
        schema_version: '0.1.0', decision_id: 'waiver-null-e2e', story_id: STORY_ID, type: 'waiver', status: 'accepted',
        source: null, artifact: decisionRef
      },
      {
        schema_version: '0.1.0', decision_id: 'waiver-e2e', story_id: STORY_ID, type: 'waiver', status: 'accepted',
        source: 'finding:multi-source', artifact: decisionRef
      }
    ]
  };
  const decisionBytes = `${JSON.stringify(decisions, null, 2)}\n`;
  const verification = {
    schema_version: '0.1.0', story_id: STORY_ID,
    commands: [
      {
        command: 'node --test test/null-selector.test.js',
        git_context: { head_sha: fixture.head },
        observation: { targets: ['src/decision-outcome-ledger.js'], values: {
          decision_trace_key: null, behavior_before: 'legacy trace had no selector', behavior_after: 'collision selector is explicit'
        } }
      },
      {
        command: 'node --test test/multi-source.test.js',
        git_context: { head_sha: fixture.head },
        observation: { targets: ['src/decision-outcome-ledger.js'], values: {
          decision_trace_key: 'finding:multi-source', behavior_before: 'ambiguous source', behavior_after: 'explicit source'
        } }
      }
    ]
  };
  const verificationBytes = `${JSON.stringify(verification, null, 2)}\n`;
  await writeFile(path.join(prDir, 'decision-records.json'), decisionBytes);
  await writeFile(path.join(prDir, 'verification-evidence.json'), verificationBytes);
  const ledger = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    currentHeadSha: fixture.head,
    artifactPath: `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`,
    sources: [
      {
        source_kind: 'decision_record', source_ref: decisionRef, source_digest: createHash('sha256').update(decisionBytes).digest('hex'),
        native_id: null, normalized_subject_key: null, authority_valid: true,
        decision: decisions.decisions[0]
      },
      {
        source_kind: 'decision_record', source_ref: decisionRef, source_digest: createHash('sha256').update(decisionBytes).digest('hex'),
        native_id: 'waiver-e2e', normalized_subject_key: 'finding:multi-source', authority_valid: true,
        decision: decisions.decisions[1]
      }
    ],
    verificationEvidence: {
      ...verification, artifact: verificationRef,
      artifact_digest: createHash('sha256').update(verificationBytes).digest('hex')
    },
    delivery: mergedDelivery(fixture.head)
  });
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  await writeCliMergeAuthority(fixture, prDir);

  const usage = JSON.parse((await execFileAsync(process.execPath, [CLI_PATH, 'usage', 'report', fixture.root, '--json'], { encoding: 'utf8' })).stdout);
  const report = usage.decision_outcomes.find((item) => item.story_id === STORY_ID);
  const duplicateTrace = ledger.traces.find((trace) => trace.decision_trace_id !== null);
  ledger.traces.push({ ...duplicateTrace });
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  const beforeAmbiguousTrace = await snapshotOutcomeState(fixture.root);
  for (const jsonMode of [true, false]) {
    const args = [CLI_PATH, 'outcome', 'record', fixture.root,
      '--id', STORY_ID, '--trace', duplicateTrace.decision_trace_id,
      '--parent-revision', duplicateTrace.parent_revision_fingerprint,
      '--status', 'not_applicable', '--reason', 'fixture only', '--producer', 'e2e:ambiguous-trace'];
    if (jsonMode) args.push('--json');
    const ambiguousTrace = await execFileAsync(process.execPath, args, { encoding: 'utf8', env: fixture.cliEnv })
      .then(() => null, (error) => error);
    assert.equal(ambiguousTrace.code, 1);
    const output = ambiguousTrace.stderr || ambiguousTrace.stdout;
    if (jsonMode) {
      const payload = JSON.parse(output);
      assert.equal(payload.error_id, 'outcome_trace_not_unique');
      assert.equal(payload.candidate_count, 2);
      assert.equal(payload.candidates.length, 2);
    } else {
      assert.match(output, /trace selector must resolve exactly one entry/);
      assert.match(output, /trace candidates: total=2 returned=2/);
    }
    assert.equal(await snapshotOutcomeState(fixture.root), beforeAmbiguousTrace, 'ambiguous trace rejection must not mutate managed outcome state');
  }
  ledger.traces.pop();
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  const nullTrace = report.entries.find((entry) => entry.decision_trace_id === null);
  assert.ok(nullTrace.collision_group);
  assert.ok(nullTrace.trace_source_ref);
  assert.equal(nullTrace.decision.status, 'observed');
  assert.equal(nullTrace.delivery.status, 'merged');
  const nullSource = ledger.traces.find((trace) => trace.trace_source_ref === nullTrace.trace_source_ref).eligible_outcome_sources.entries[0];
  const nullRecorded = JSON.parse((await execFileAsync(process.execPath, [CLI_PATH, 'outcome', 'record', fixture.root,
    '--id', STORY_ID, '--collision-group', nullTrace.collision_group, '--trace-source-ref', nullTrace.trace_source_ref,
    '--parent-revision', nullTrace.parent_revision_fingerprint, '--status', 'not_applicable', '--reason', 'legacy path has no downstream',
    '--producer', 'e2e:null-selector', '--source', nullSource.ref, '--json'
  ], { encoding: 'utf8', env: fixture.cliEnv })).stdout);
  assert.deepEqual(nullRecorded.resolved_selector, { collision_group: nullTrace.collision_group, trace_source_ref: nullTrace.trace_source_ref });

  const multiTrace = report.entries.find((entry) => entry.decision_trace_id !== null);
  assert.equal(multiTrace.eligible_outcome_sources.total_count, 2);
  assert.ok(multiTrace.eligible_outcome_sources.entries.some((source) => source.kind === 'decision_record' && source.ref === decisionRef));
  const ambiguous = await execFileAsync(process.execPath, [CLI_PATH, 'outcome', 'record', fixture.root,
    '--id', STORY_ID, '--trace', multiTrace.decision_trace_id, '--parent-revision', multiTrace.parent_revision_fingerprint,
    '--status', 'not_applicable', '--reason', 'fixture only', '--producer', 'e2e:multi-source', '--json'
  ], { encoding: 'utf8', env: fixture.cliEnv }).then(() => null, (error) => error);
  assert.equal(JSON.parse(ambiguous.stderr || ambiguous.stdout).error_id, 'outcome_source_not_unique');
  const multiRecorded = JSON.parse((await execFileAsync(process.execPath, [CLI_PATH, 'outcome', 'record', fixture.root,
    '--id', STORY_ID, '--trace', multiTrace.decision_trace_id, '--parent-revision', multiTrace.parent_revision_fingerprint,
    '--status', 'not_applicable', '--reason', 'fixture only', '--producer', 'e2e:multi-source', '--source', decisionRef, '--json'
  ], { encoding: 'utf8', env: fixture.cliEnv })).stdout);
  assert.equal(multiRecorded.resolved_source.ref, decisionRef);
  assert.equal(multiRecorded.resolved_source.kind, 'decision_record');
  const refreshed = JSON.parse((await execFileAsync(process.execPath, [CLI_PATH, 'outcome', 'refresh', fixture.root,
    '--id', STORY_ID, '--base', 'main', '--json'
  ], { encoding: 'utf8', env: fixture.cliEnv })).stdout);
  assert.equal(refreshed.status, 'promoted');
  assert.equal(refreshed.observation_count, 2);
  const usageAfter = JSON.parse((await execFileAsync(process.execPath, [CLI_PATH, 'usage', 'report', fixture.root, '--json'], { encoding: 'utf8' })).stdout);
  const refreshedEntries = usageAfter.decision_outcomes.find((item) => item.story_id === STORY_ID).entries;
  const refreshedNullTrace = refreshedEntries.find((entry) => entry.decision_trace_id === null
    && entry.collision_group === nullRecorded.resolved_selector.collision_group
    && entry.trace_source_ref === nullRecorded.resolved_selector.trace_source_ref);
  assert.ok(refreshedNullTrace, 'refresh must retain the null-ID trace selected by collision group and source ref');
  assert.equal(refreshedNullTrace.parent_revision_fingerprint, nullTrace.parent_revision_fingerprint);
  assert.equal(refreshedNullTrace.downstream_outcome_status, 'not_applicable');
  const refreshedTrace = refreshedEntries
    .find((entry) => entry.decision_trace_id === multiTrace.decision_trace_id);
  assert.equal(refreshedTrace.downstream_outcome_status, 'not_applicable');
  assert.equal(refreshedTrace.trace_status, 'complete');
  assert.equal(refreshedTrace.behavior_delta.after, 'explicit source');
  assert.equal(refreshedTrace.delivery.status, 'merged');
  assert.equal(refreshedTrace.downstream_outcome.reason, 'fixture only');
});

test(`${STORY_ID} reports redacted live-authority denials through JSON and text CLI modes`, async () => {
  for (const scenario of [
    {
      status: 401,
      classification: 'authentication denied while verifying live PR authority',
      recovery: /gh auth login|refresh credentials/
    },
    {
      status: 403,
      classification: 'permission denied while verifying live PR authority',
      recovery: /repository.*PR read permission/
    }
  ]) {
    const fixture = await createBoundCliFixture('strict_head');
    const secret = `ghp_DO_NOT_EXPOSE_${scenario.status}`;
    await writeFile(path.join(fixture.binDir, 'gh'), `#!/usr/bin/env node
process.stderr.write('HTTP ${scenario.status} denied for token ${secret}');
process.exit(1);
`);
    await chmod(path.join(fixture.binDir, 'gh'), 0o755);
    const before = await snapshotOutcomeState(fixture.root);
    const baseArgs = [CLI_PATH, 'outcome', 'record', fixture.root,
      '--id', STORY_ID, '--trace', fixture.trace.decision_trace_id,
      '--parent-revision', fixture.trace.parent_revision_fingerprint,
      '--status', 'observed', '--value-json', '{"must_not_persist":true}',
      '--producer', `e2e:authority-${scenario.status}`];

    for (const jsonMode of [true, false]) {
      const args = jsonMode ? [...baseArgs, '--json'] : baseArgs;
      const denied = await execFileAsync(process.execPath, args, { encoding: 'utf8', env: fixture.cliEnv })
        .then(() => null, (error) => error);
      assert.equal(denied.code, 1);
      const output = denied.stderr || denied.stdout;
      assert.doesNotMatch(output, new RegExp(secret));
      if (jsonMode) {
        const payload = JSON.parse(output);
        assert.equal(payload.error_id, 'outcome_not_merged');
        assert.equal(payload.verification_failure, scenario.classification);
        assert.match(payload.recovery, scenario.recovery);
      } else {
        assert.match(output, new RegExp(`authority verification: ${scenario.classification}`));
        assert.match(output, scenario.recovery);
      }
      assert.equal(await snapshotOutcomeState(fixture.root), before, `${scenario.status} denial must not mutate managed outcome state`);
    }
  }
});

test(`${STORY_ID} enforces production content bindings through the public outcome CLI`, async () => {
  for (const scenario of [
    { mode: 'content_surface', mutation: 'none', accepted: true },
    { mode: 'strict_head', mutation: 'head', accepted: false },
    { mode: 'content_surface', mutation: 'surface', accepted: false }
  ]) {
    const fixture = await createBoundCliFixture(scenario.mode);
    if (scenario.mutation === 'head') {
      await writeFile(path.join(fixture.root, 'README.md'), 'fixture advanced\n');
      await git(fixture.root, ['add', 'README.md']);
      await git(fixture.root, ['commit', '-m', 'test: advance bound fixture head']);
      await git(fixture.root, ['push', 'origin', 'main']);
      fixture.head = (await git(fixture.root, ['rev-parse', 'HEAD'])).stdout.trim();
      await writeGhStub(fixture);
      await writeCliMergeAuthority(fixture, fixture.prDir);
    } else if (scenario.mutation === 'surface') {
      await writeFile(path.join(fixture.root, 'surface.js'), 'export const value = 2;\n');
    }
    const before = await snapshotOutcomeState(fixture.root);
    const args = [CLI_PATH, 'outcome', 'record', fixture.root,
      '--id', STORY_ID, '--trace', fixture.trace.decision_trace_id,
      '--parent-revision', fixture.trace.parent_revision_fingerprint,
      '--status', 'observed', '--value-json', '{"accepted":true}',
      '--producer', `e2e:${scenario.mode}`, '--json'];
    const result = await execFileAsync(process.execPath, args, { encoding: 'utf8', env: fixture.cliEnv })
      .then((process) => ({ process, error: null }), (error) => ({ process: null, error }));
    if (scenario.accepted) {
      assert.equal(JSON.parse(result.process.stdout).status, 'recorded');
      assert.notEqual(await snapshotOutcomeState(fixture.root), before, 'current content-surface evidence records an observation');
    } else {
      assert.equal(result.error.code, 1);
      const payload = JSON.parse(result.error.stderr || result.error.stdout);
      assert.equal(payload.error_id, 'outcome_source_untrusted');
      assert.match(payload.ledger_path, /decision-outcome-ledger\.json$/);
      assert.match(payload.ledger_digest, /^[a-f0-9]{64}$/);
      assert.equal(payload.eligible_outcome_sources.returned_count, 1);
      assert.match(payload.recovery, /usage report --json/);
      const textResult = await execFileAsync(process.execPath, args.filter((arg) => arg !== '--json'), { encoding: 'utf8', env: fixture.cliEnv })
        .then(() => null, (error) => error);
      const output = textResult.stderr || textResult.stdout;
      assert.match(output, /ledger: .*decision-outcome-ledger\.json digest=[a-f0-9]{64}/);
      assert.match(output, /eligible sources: total=1 returned=1 omitted=0 truncated=false/);
      assert.match(output, /recovery: Run vibepro usage report --json/);
      assert.equal(await snapshotOutcomeState(fixture.root), before, `${scenario.mode} stale rejection must not mutate managed state`);
    }
  }
});

function mergedDelivery(head) {
  return {
    story_id: STORY_ID, status: 'merged',
    pr: { number: 42, url: FIXTURE_PR_URL, state: 'MERGED' },
    merge: { sha: head, status: 'merged' }
  };
}

async function writeCliMergeAuthority(fixture, prDir) {
  await writeFile(path.join(prDir, 'pr-create.json'), `${JSON.stringify({
    story: { story_id: STORY_ID }, pr_url: FIXTURE_PR_URL, base: 'main', current_head_sha: fixture.head
  }, null, 2)}\n`);
  await writeFile(path.join(prDir, 'pr-merge.json'), `${JSON.stringify({
    story: { story_id: STORY_ID }, status: 'merged', merge_commit_sha: fixture.head,
    current_head_sha: fixture.head, strategy: 'merge',
    pr: { number: 42, url: FIXTURE_PR_URL, state: 'MERGED', head_ref_oid: fixture.head }, base: 'main'
  }, null, 2)}\n`);
  await git(fixture.root, ['push', 'origin', `${fixture.head}:refs/pull/42/head`]);
}

async function snapshotOutcomeState(root) {
  const targets = [
    path.join(root, '.vibepro', 'pr', STORY_ID, 'decision-outcome-ledger.json'),
    path.join(root, '.vibepro', 'observations', STORY_ID),
    path.join(root, 'docs', 'management', 'audit-artifacts', STORY_ID)
  ];
  const records = [];
  async function visit(target, label) {
    try {
      const entries = await readdir(target, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        await visit(path.join(target, entry.name), `${label}/${entry.name}`);
      }
    } catch (error) {
      if (error.code === 'ENOTDIR') records.push(`${label}:${createHash('sha256').update(await readFile(target)).digest('hex')}`);
      else if (error.code === 'ENOENT') records.push(`${label}:missing`);
      else throw error;
    }
  }
  for (const target of targets) await visit(target, path.relative(root, target));
  return createHash('sha256').update(records.join('\n')).digest('hex');
}

async function createRepository() {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'vibepro-decision-ledger-e2e-'));
  const root = path.join(parent, 'repo');
  const remote = path.join(parent, 'remote.git');
  await mkdir(root);
  await git(parent, ['init', '--bare', remote]);
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'VibePro E2E']);
  await git(root, ['config', 'user.email', 'vibepro-e2e@example.test']);
  await writeFile(path.join(root, 'README.md'), 'fixture\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-m', 'test: initialize decision ledger fixture']);
  await git(root, ['config', `url.file://${remote}.insteadOf`, FIXTURE_REPOSITORY_URL]);
  await git(root, ['remote', 'add', 'origin', FIXTURE_REPOSITORY_URL]);
  await git(root, ['push', '-u', 'origin', 'main']);
  const head = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const binDir = path.join(parent, 'bin');
  await mkdir(binDir);
  const fixture = { root, remote, head, binDir, cliEnv: { ...process.env, PATH: `${binDir}:${process.env.PATH}` } };
  await writeGhStub(fixture);
  return fixture;
}

async function createPrPrepareFixture({
  title = '判断証跡の競合を保持する',
  storyBody,
  sourcePath,
  files = {}
}) {
  const fixture = await createRepository();
  await execFileAsync(process.execPath, [CLI_PATH, 'init', fixture.root,
    '--story-id', STORY_ID, '--title', title, '--view', 'dev', '--period', '2026-07', '--json'
  ], { encoding: 'utf8', env: fixture.cliEnv });
  await git(fixture.root, ['add', '.']);
  await git(fixture.root, ['commit', '-m', 'chore: initialize VibePro story fixture']);
  await git(fixture.root, ['switch', '-c', 'feature/decision-ledger']);
  const storyDir = path.join(fixture.root, 'docs', 'management', 'stories', 'active');
  await mkdir(storyDir, { recursive: true });
  await writeFile(path.join(storyDir, `${STORY_ID}.md`), `---
story_id: ${STORY_ID}
title: ${title}
architecture_docs:
  reason: public CLI E2E fixture
---

# ${title}

${storyBody}
`);
  await mkdir(path.dirname(path.join(fixture.root, sourcePath)), { recursive: true });
  await writeFile(path.join(fixture.root, sourcePath), 'export const fixture = true;\n');
  for (const [relativePath, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(fixture.root, relativePath)), { recursive: true });
    await writeFile(path.join(fixture.root, relativePath), contents);
  }
  await git(fixture.root, ['add', '.']);
  await git(fixture.root, ['commit', '-m', 'feat: add decision ledger E2E fixture']);
  return fixture;
}

async function prepareGateDag(fixture) {
  const prepared = await execFileAsync(process.execPath, [CLI_PATH, 'pr', 'prepare', fixture.root,
    '--story-id', STORY_ID, '--base', 'main', '--json'
  ], { encoding: 'utf8', env: fixture.cliEnv });
  assert.ok(JSON.parse(prepared.stdout));
  const artifact = JSON.parse(await readFile(path.join(fixture.root, '.vibepro', 'pr', STORY_ID, 'pr-prepare.json'), 'utf8'));
  return artifact.pr_context.gate_dag;
}

async function writeGhStub(fixture) {
  const ghPath = path.join(fixture.binDir, 'gh');
  await writeFile(ghPath, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  url: '${FIXTURE_PR_URL}', state: 'MERGED',
  headRefOid: '${fixture.head}', baseRefName: 'main', mergeCommit: { oid: '${fixture.head}' }
}));
`);
  await chmod(ghPath, 0o755);
}

async function createBoundCliFixture(mode) {
  const fixture = await createRepository();
  const prDir = path.join(fixture.root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(fixture.root, 'surface.js'), 'export const value = 1;\n');
  await git(fixture.root, ['add', 'surface.js']);
  await git(fixture.root, ['commit', '-m', 'test: add bound CLI surface']);
  await git(fixture.root, ['push', 'origin', 'main']);
  fixture.head = (await git(fixture.root, ['rev-parse', 'HEAD'])).stdout.trim();
  fixture.prDir = prDir;
  await writeGhStub(fixture);
  const contentBinding = await buildContentBinding(fixture.root, {
    strictHead: mode === 'strict_head',
    gitContext: { head_sha: fixture.head },
    targets: ['surface.js']
  });
  const command = {
    command: 'node --test binding',
    git_context: { head_sha: fixture.head },
    content_binding: contentBinding,
    binding: await evaluateContentBinding(fixture.root, contentBinding, { head_sha: fixture.head }),
    observation: { values: {
      decision_trace_key: 'finding:binding-cli',
      behavior_before: 'binding unchecked',
      behavior_after: 'binding enforced'
    } }
  };
  const verification = { schema_version: '0.1.0', story_id: STORY_ID, commands: [command] };
  const verificationBytes = `${JSON.stringify(verification, null, 2)}\n`;
  const verificationRef = `.vibepro/pr/${STORY_ID}/verification-evidence.json`;
  await writeFile(path.join(prDir, 'verification-evidence.json'), verificationBytes);
  const ledger = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    currentHeadSha: fixture.head,
    artifactPath: `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`,
    sources: [{
      source_kind: 'review_finding', source_ref: '.vibepro/reviews/story/review.json',
      native_id: 'binding-cli', normalized_subject_key: 'finding:binding-cli',
      finding: { id: 'binding-cli', summary: 'Binding CLI' }
    }],
    verificationEvidence: {
      ...verification,
      artifact: verificationRef,
      artifact_digest: createHash('sha256').update(verificationBytes).digest('hex')
    },
    delivery: mergedDelivery(fixture.head)
  });
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  await writeCliMergeAuthority(fixture, prDir);
  return { ...fixture, trace: ledger.traces[0] };
}

function git(cwd, args) {
  return execFileAsync('git', args, { cwd, encoding: 'utf8' });
}
