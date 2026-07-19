import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  buildDecisionOutcomeLedger,
  collectDecisionOutcomeSources,
  matchesDecisionOutcomeObservation,
  projectDecisionOutcomeSummary,
  reviseDecisionOutcomeLedger,
  validateDecisionOutcomeObservation,
  writeDecisionOutcomeLedger
} from '../src/decision-outcome-ledger.js';
import {
  buildArtifactSummaryContent,
  planArtifactBudget,
  resolveHandoffArtifact
} from '../src/pr-artifact-budget.js';
import {
  bindDecisionOutcomeDelivery,
  prUrlMatchesRemote,
  recordOutcome,
  refreshOutcome,
  tryBindDecisionOutcomeDelivery
} from '../src/outcome-manager.js';
import { getCanonicalAuditDir, promoteCanonicalAuditArtifacts } from '../src/canonical-audit.js';
import { createUsageReport, renderUsageReport } from '../src/usage-report.js';
import { buildContentBinding, evaluateContentBinding } from '../src/content-binding.js';
import { readReviewResultForDecisionOutcome, renderDecisionOutcomeReviewInput } from '../src/agent-review.js';
import { atomicReplaceFile } from '../src/atomic-file.js';

const STORY_ID = 'story-decision-outcome';
const execFileAsync = promisify(execFile);

test('GDL-CONTRACT-009 remote and PR identity comparison fails closed and supports GitHub Enterprise', () => {
  assert.equal(prUrlMatchesRemote(
    'https://github.example.test/platform/vibepro/pull/42',
    'git@github.example.test:platform/vibepro.git'
  ), true);
  assert.equal(prUrlMatchesRemote(
    'https://github.example.test/other/vibepro/pull/42',
    'https://github.example.test/platform/vibepro.git'
  ), false);
  assert.equal(prUrlMatchesRemote(
    'https://github.example.test/platform/vibepro/pull/42',
    '/tmp/unparseable-local-origin.git'
  ), false);
});

function observationFor(trace, overrides = {}) {
  const status = overrides.status ?? 'observed';
  const core = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    trace_selector: { decision_trace_id: trace.decision_trace_id },
    parent_revision_fingerprint: trace.parent_revision_fingerprint,
    status,
    observed_at: '2026-07-16T00:00:00.000Z',
    producer: 'operator:test',
    source_ref: '.vibepro/pr/story-decision-outcome/verification-evidence.json',
    value: status === 'observed' ? { defect_recurred: false } : null,
    reason: status === 'not_applicable' ? 'no downstream runtime exists' : null,
    authority: {
      kind: 'verification_evidence',
      source_digest: 'a'.repeat(64),
      recorded_by: 'vibepro'
    },
    ...overrides
  };
  delete core.observation_id;
  const canonical = JSON.stringify(sortFixture(core));
  return {
    ...core,
    observation_id: `obs_${createHash('sha256').update(canonical).digest('hex')}`
  };
}

function sortFixture(value) {
  if (Array.isArray(value)) return value.map(sortFixture);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortFixture(value[key])]));
}

function finding(id, overrides = {}) {
  return {
    source_kind: 'review_finding',
    source_ref: `.vibepro/reviews/${STORY_ID}/implementation/review-result.json`,
    native_id: id,
    normalized_subject_key: id ? `finding:${id}` : null,
    finding: { id, summary: `finding ${id ?? 'legacy'}` },
    role: 'runtime_contract',
    stage: 'implementation',
    ...overrides
  };
}

test('GDL-S-1 stable trace identity is source/order independent and missing keys stay explicit', () => {
  const a = finding('parse-failure', { source_ref: 'review-a.json' });
  const b = finding(null, { source_ref: null, native_id: null });
  const first = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [a, b] });
  const second = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [b, { ...a, source_ref: 'review-b.json' }] });

  const stableA = first.traces.find((trace) => trace.decision_trace_id);
  const stableB = second.traces.find((trace) => trace.decision_trace_id);
  assert.equal(stableA.decision_trace_id, stableB.decision_trace_id);

  const missingA = first.traces.find((trace) => !trace.decision_trace_id);
  const missingB = second.traces.find((trace) => !trace.decision_trace_id);
  assert.equal(missingA.missing_reason, 'stable_source_key_missing');
  assert.equal(missingA.collision_group, missingB.collision_group);
  assert.equal(missingA.trace_source_ref, missingB.trace_source_ref);
});

test('GDL-S-1 duplicate subjects without an explicit link remain distinct addressable traces', () => {
  const ledger = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    sources: [
      finding('same-id', { role: 'runtime_contract' }),
      finding('same-id', { role: 'code_spec_alignment' })
    ]
  });

  assert.equal(ledger.traces.length, 2);
  assert.ok(ledger.traces.every((trace) => trace.decision_trace_id === null));
  assert.ok(ledger.traces.every((trace) => trace.missing_reason === 'ambiguous_subject_instance'));
  assert.equal(new Set(ledger.traces.map((trace) => trace.collision_group)).size, 1);
  assert.equal(new Set(ledger.traces.map((trace) => trace.trace_source_ref)).size, 2);
});

test('GDL-S-1 byte-identical source instances collapse with explicit multiplicity', () => {
  const source = finding(null, { source_ref: null, native_id: null });
  const single = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [source] });
  const ledger = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [source, structuredClone(source)] });

  assert.equal(ledger.traces.length, 1);
  assert.equal(ledger.traces[0].source_identity.multiplicity, 2);
  assert.ok(ledger.traces[0].trace_source_ref);
  assert.equal(
    ledger.traces[0].trace_source_ref,
    single.traces[0].trace_source_ref,
    'duplicate multiplicity is observation metadata and must not change the public source selector'
  );
});

test('GDL-S-1 observations recorded with the legacy multiplicity selector survive an upgrade', () => {
  const source = finding(null, { source_ref: null, native_id: null });
  const sources = [source, structuredClone(source)];
  const initial = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources });
  const trace = initial.traces[0];
  const legacySourceRef = `tsr_${createHash('sha256').update(JSON.stringify(sortFixture({
    story_id: STORY_ID,
    normalized_subject_key: null,
    source_kind: trace.source_identity.source_kind,
    source_ref: trace.source_identity.source_ref,
    native_id: trace.source_identity.native_id,
    role: source.role,
    stage: source.stage,
    source_instance_digest: trace.source_identity.digest,
    source_multiplicity: trace.source_identity.multiplicity
  }))).digest('hex')}`;
  const legacyParentRevision = createHash('sha256').update(JSON.stringify(sortFixture({
    story_id: STORY_ID,
    decision_trace_id: trace.decision_trace_id,
    collision_group: trace.collision_group,
    trace_source_ref: legacySourceRef,
    normalized_subject_key: trace.normalized_subject_key,
    source_identity: trace.source_identity,
    evidence_head_sha: trace.evidence_head_sha,
    behavior_delta: trace.behavior_delta,
    delivery: trace.delivery
  }))).digest('hex');
  const legacyObservation = observationFor(trace, {
    trace_selector: { collision_group: trace.collision_group, trace_source_ref: legacySourceRef },
    parent_revision_fingerprint: legacyParentRevision,
    value: { defect_recurred: false },
    source_ref: 'legacy-observation.json'
  });

  const upgraded = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources, observations: [legacyObservation] });

  assert.notEqual(legacySourceRef, upgraded.traces[0].trace_source_ref);
  assert.equal(upgraded.traces[0].downstream_outcome.status, 'observed');
  assert.deepEqual(upgraded.traces[0].downstream_outcome.value, { defect_recurred: false });
  assert.equal(upgraded.traces[0].source_errors.length, 0);
  assert.deepEqual(upgraded.traces[0].observation_read_aliases, [{
    trace_selector: { collision_group: trace.collision_group, trace_source_ref: legacySourceRef },
    parent_revision_fingerprint: legacyParentRevision
  }]);
});

test('GDL-S-1 outcome refresh preserves a managed observation recorded with the legacy multiplicity selector', async () => {
  const fixture = await createOutcomeRepository('vibepro-outcome-legacy-selector-');
  const prDir = path.join(fixture.root, '.vibepro', 'pr', STORY_ID);
  const observationDir = path.join(fixture.root, '.vibepro', 'observations', STORY_ID);
  await mkdir(prDir, { recursive: true });
  await mkdir(observationDir, { recursive: true });
  const source = finding(null, { source_ref: null, native_id: null });
  const verification = {
    schema_version: '0.1.0', story_id: STORY_ID,
    commands: [{
      command: 'node --test legacy-selector', git_context: { head_sha: fixture.head }, binding: { status: 'current' },
      observation: { values: { decision_trace_key: null, behavior_before: 'legacy', behavior_after: 'current' } }
    }]
  };
  const verificationBytes = `${JSON.stringify(verification, null, 2)}\n`;
  const verificationPath = `.vibepro/pr/${STORY_ID}/verification-evidence.json`;
  await writeFile(path.join(prDir, 'verification-evidence.json'), verificationBytes);
  const ledger = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    currentHeadSha: fixture.head,
    artifactPath: `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`,
    sources: [source, structuredClone(source)],
    verificationEvidence: {
      ...verification,
      artifact: verificationPath,
      artifact_digest: createHash('sha256').update(verificationBytes).digest('hex')
    }
  });
  const trace = ledger.traces[0];
  const alias = trace.observation_read_aliases[0];
  const observation = observationFor(trace, {
    trace_selector: alias.trace_selector,
    parent_revision_fingerprint: alias.parent_revision_fingerprint,
    source_ref: verificationPath,
    authority: {
      kind: 'verification_evidence',
      source_digest: createHash('sha256').update(verificationBytes).digest('hex'),
      recorded_by: 'vibepro'
    }
  });
  const observationBytes = `${JSON.stringify(observation, null, 2)}\n`;
  delete ledger.traces[0].observation_read_aliases;
  assert.equal(Object.hasOwn(ledger.traces[0], 'observation_read_aliases'), false);
  assert.equal(matchesDecisionOutcomeObservation(ledger.traces[0], observation), true);
  const metadataMismatch = structuredClone(ledger.traces[0]);
  metadataMismatch.detector.value.detected_by = 'different-role';
  assert.equal(matchesDecisionOutcomeObservation(metadataMismatch, observation), false);
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  await writeMergeAuthority(prDir, fixture.head);
  await writeFile(path.join(observationDir, `${observation.observation_id}.json`), observationBytes);
  await writeFile(path.join(observationDir, 'manifest.json'), `${JSON.stringify({
    schema_version: '0.1.0', story_id: STORY_ID, entries: [{
      observation_id: observation.observation_id,
      artifact_name: `${observation.observation_id}.json`,
      artifact_digest: createHash('sha256').update(observationBytes).digest('hex'),
      source_ref: observation.source_ref,
      source_digest: observation.authority.source_digest,
      parent_revision_fingerprint: observation.parent_revision_fingerprint,
      trace_selector: observation.trace_selector
    }]
  }, null, 2)}\n`);

  await refreshOutcome(fixture.root, {
    storyId: STORY_ID,
    githubPrView: authoritativePr(fixture.head),
    persistenceService: async () => ({ summary: { status: 'pushed' } })
  });
  const revised = JSON.parse(await readFile(path.join(prDir, 'decision-outcome-ledger.json'), 'utf8'));
  assert.equal(revised.traces[0].downstream_outcome.status, 'observed');
  assert.deepEqual(revised.traces[0].downstream_outcome.value, { defect_recurred: false });
});

test('GDL-S-7 actual review source failures remain visible through the bounded consumer', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-source-failure-'));
  const missingPath = path.join(root, 'missing.json');
  const malformedPath = path.join(root, 'malformed.json');
  const unreadablePath = path.join(root, 'unreadable.json');
  await writeFile(malformedPath, '{broken');
  await writeFile(unreadablePath, '{}');
  const missing = await readReviewResultForDecisionOutcome(missingPath, { expected: true, sourceRef: 'missing.json' });
  const malformed = await readReviewResultForDecisionOutcome(malformedPath, { expected: true, sourceRef: 'malformed.json' });
  const unreadable = await readReviewResultForDecisionOutcome(unreadablePath, {
    expected: true,
    sourceRef: 'unreadable.json',
    readText: async () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); }
  });
  const roles = [missing, malformed, unreadable].map((source, index) => ({
    role: `source_${index}`,
    artifact: source.source_errors[0].source_ref,
    source_errors: source.source_errors,
    findings: [],
    finding_dispositions: []
  }));
  const sources = collectDecisionOutcomeSources({
    storyId: STORY_ID,
    agentReviews: { stages: [{ stage: 'implementation', roles }] }
  });
  const ledger = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    sources
  });

  assert.equal(ledger.traces.length, 3, 'broken sources cannot collapse into an empty successful ledger');
  const legacy = ledger.traces.find((trace) => trace.source_errors.some((error) => error.code === 'source_missing'));
  assert.equal(legacy.finding.value.summary, 'Review source source_missing', 'failed producer retains a compatible claim for existing consumers');
  assert.equal(legacy.source_errors[0].code, 'source_missing');
  for (const code of ['source_malformed', 'source_unreadable']) {
    const trace = ledger.traces.find((item) => item.source_errors.some((error) => error.code === code));
    assert.equal(trace.trace_status, 'conflicting');
    assert.equal(trace.finding.status, 'observed');
  }
  const summary = projectDecisionOutcomeSummary(ledger);
  assert.equal(summary.total_count, 3);
  assert.equal(summary.returned_count, 3);
  assert.ok(summary.entries.every((entry) => typeof entry.finding_status === 'string'));
  assert.deepEqual(
    ledger.traces.flatMap((trace) => trace.source_errors.map((error) => error.code)).sort(),
    ['source_malformed', 'source_missing', 'source_unreadable']
  );
});

test('GDL-S-2 unverified review claims without provenance fail closed instead of becoming observed', () => {
  const sources = collectDecisionOutcomeSources({
    storyId: STORY_ID,
    agentReviews: {
      stages: [{
        stage: 'implementation',
        roles: [{
          role: 'runtime_contract',
          artifact: null,
          provenance_status: 'unverified_agent',
          findings: [{ id: 'unverified-claim', summary: 'must not become canonical' }],
          finding_dispositions: []
        }]
      }]
    }
  });
  const ledger = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources });

  assert.equal(sources[0].authority_valid, false);
  assert.deepEqual(sources[0].source_errors, [{ code: 'claim_provenance_missing', source_ref: null }]);
  assert.equal(ledger.traces[0].trace_status, 'conflicting');
  assert.equal(ledger.traces[0].finding.status, 'not_observed');
  assert.equal(ledger.traces[0].detector.status, 'not_observed');
  assert.deepEqual(ledger.traces[0].finding.provenance, []);
});

test('GDL-S-2 invalid linked claims do not suppress independent authoritative claims', () => {
  const artifact = `.vibepro/pr/${STORY_ID}/decision-records.json`;
  const sources = collectDecisionOutcomeSources({
    storyId: STORY_ID,
    agentReviews: {
      stages: [{
        stage: 'implementation',
        roles: [{
          role: 'runtime_contract',
          artifact: null,
          provenance_status: 'unverified_agent',
          findings: [{ id: 'mixed-authority', summary: 'unverified finding' }],
          finding_dispositions: []
        }]
      }]
    },
    decisionRecords: {
      story_id: STORY_ID,
      artifact,
      artifact_digest: 'decision-digest',
      decisions: [{
        decision_id: 'waiver-mixed-authority',
        story_id: STORY_ID,
        type: 'waiver',
        status: 'accepted',
        source: 'finding:mixed-authority',
        artifact
      }]
    }
  });
  const ledger = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources });
  const trace = ledger.traces[0];

  assert.equal(trace.trace_status, 'conflicting', 'invalid linked evidence remains visible');
  assert.equal(trace.finding.status, 'not_observed');
  assert.equal(trace.detector.status, 'not_observed');
  assert.equal(trace.decision.status, 'observed', 'independent authoritative decision survives');
  assert.equal(trace.decision.provenance[0].source_ref, artifact);
  assert.deepEqual(trace.eligible_outcome_sources.entries, [{
    kind: 'decision_record', ref: artifact, digest: 'decision-digest'
  }]);

  const mixedReviewSources = collectDecisionOutcomeSources({
    storyId: STORY_ID,
    agentReviews: {
      stages: [{
        stage: 'implementation',
        roles: [{
          role: 'runtime_contract',
          artifact: 'verified-review.json',
          provenance_status: 'verified_agent',
          findings: [{ id: 'mixed-review-authority', summary: 'verified finding' }],
          finding_dispositions: []
        }, {
          role: 'code_spec_alignment',
          artifact: 'unverified-disposition.json',
          provenance_status: 'unverified_agent',
          findings: [],
          finding_dispositions: [{ finding_id: 'mixed-review-authority', disposition: 'fixed' }]
        }]
      }]
    }
  });
  const mixedReviewTrace = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: mixedReviewSources }).traces[0];
  assert.equal(mixedReviewTrace.trace_status, 'conflicting');
  assert.equal(mixedReviewTrace.finding.status, 'observed', 'verified finding survives invalid disposition');
  assert.equal(mixedReviewTrace.detector.status, 'observed');
  assert.equal(mixedReviewTrace.disposition.status, 'not_observed');
  assert.equal(mixedReviewTrace.finding.provenance[0].source_ref, 'verified-review.json');
});

test('GDL-S-2 explicit linked claims join while contradictory decisions remain conflicting', () => {
  const ledger = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    sources: [
      finding('linked'),
      {
        source_kind: 'finding_disposition',
        source_ref: 'review-disposition.json',
        native_id: 'linked',
        normalized_subject_key: 'finding:linked',
        decision: { finding_id: 'linked', disposition: 'fixed' },
        explicit_link: true
      },
      {
        source_kind: 'decision_record',
        source_ref: `.vibepro/pr/${STORY_ID}/decision-records.json`,
        native_id: 'decision-2',
        normalized_subject_key: 'finding:linked',
        decision: { decision_id: 'decision-2', disposition: 'accepted_risk' },
        explicit_link: true
      }
    ]
  });
  assert.equal(ledger.traces.length, 1);
  assert.ok(ledger.traces[0].decision_trace_id);
  assert.equal(ledger.traces[0].trace_status, 'conflicting');
  assert.equal(ledger.traces[0].source_errors[0].code, 'claim_conflict');
  assert.equal(ledger.traces[0].detector.value.detected_by, 'runtime_contract');
  assert.equal(ledger.traces[0].disposition.value.disposition, 'fixed');
  assert.equal(ledger.traces[0].finding.provenance[0].source_ref, `.vibepro/reviews/${STORY_ID}/implementation/review-result.json`);
  assert.equal(ledger.traces[0].disposition.provenance[0].source_ref, 'review-disposition.json');
  assert.equal(ledger.traces[0].decision.provenance[0].source_ref, `.vibepro/pr/${STORY_ID}/decision-records.json`);
});

test('GDL-S-2 every decision-chain value retains its own source provenance', () => {
  const source = {
    ...finding('provenance-chain', { source_ref: 'review-finding.json' }),
    gate_claim: { gate_id: 'gate:engineering' },
    detector_claim: { detected_by: 'runtime_contract' },
    disposition_claim: { finding_id: 'provenance-chain', disposition: 'fixed' },
    decision: { decision_id: 'decision-provenance', disposition: 'fixed' }
  };
  const trace = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [source] }).traces[0];

  for (const field of ['finding', 'gate', 'detector', 'disposition', 'decision']) {
    assert.equal(trace[field].status, 'observed', `${field} is independently observed`);
    assert.equal(trace[field].provenance.length, 1, `${field} has one explicit provenance entry`);
    assert.equal(trace[field].provenance[0].source_ref, 'review-finding.json', `${field} retains source_ref`);
  }
  assert.equal(trace.gate.value.gate_id, 'gate:engineering');
  assert.equal(trace.detector.value.detected_by, 'runtime_contract');
});

test('GDL-S-2 gate waiver refs are re-resolved against accepted managed decisions', () => {
  const decisionRecords = {
    story_id: STORY_ID,
    artifact: `.vibepro/pr/${STORY_ID}/decision-records.json`,
    artifact_digest: 'decision-digest',
    decisions: [{
      decision_id: 'waiver-1', story_id: STORY_ID, type: 'waiver', status: 'accepted',
      source: 'finding:parse-failure', artifact: `.vibepro/pr/${STORY_ID}/decision-records.json`
    }]
  };
  const validSources = collectDecisionOutcomeSources({
    storyId: STORY_ID,
    decisionRecords,
    gateOutcomeLedger: {
      artifact: '.vibepro/gate-outcomes/ledger.json',
      entries: [{ gate_id: 'gate:engineering', decision_refs: [{
        decision_id: 'waiver-1', source: 'finding:parse-failure', artifact: decisionRecords.artifact
      }] }]
    }
  });
  assert.ok(validSources.some((source) => source.source_kind === 'gate_outcome' && source.normalized_subject_key === 'finding:parse-failure' && source.authority_valid));
  const validLedger = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: validSources });
  assert.equal(validLedger.traces.length, 1);
  assert.equal(validLedger.traces[0].trace_status, 'partial');
  assert.deepEqual(validLedger.traces[0].source_errors, []);
  assert.deepEqual(validLedger.traces[0].eligible_outcome_sources.entries, [{
    kind: 'decision_record', ref: decisionRecords.artifact, digest: decisionRecords.artifact_digest
  }]);
  const invalid = collectDecisionOutcomeSources({
    storyId: STORY_ID,
    decisionRecords,
    gateOutcomeLedger: { entries: [{ gate_id: 'gate:engineering', decision_refs: [{ decision_id: 'missing', source: 'finding:parse-failure' }] }] }
  }).find((source) => source.source_kind === 'gate_outcome');
  assert.equal(invalid.normalized_subject_key, 'gate:engineering');
  assert.equal(invalid.source_errors[0].code, 'decision_authority_invalid');
});

test('GDL-S-2 conflicting authority-valid gate claims remain explicit', () => {
  const decisionRecords = {
    story_id: STORY_ID,
    artifact: `.vibepro/pr/${STORY_ID}/decision-records.json`,
    artifact_digest: 'decision-digest',
    decisions: [{
      decision_id: 'waiver-shared', story_id: STORY_ID, type: 'waiver', status: 'accepted',
      source: 'finding:shared-waiver', artifact: `.vibepro/pr/${STORY_ID}/decision-records.json`
    }]
  };
  const sources = collectDecisionOutcomeSources({
    storyId: STORY_ID,
    decisionRecords,
    gateOutcomeLedger: {
      artifact: '.vibepro/gate-outcomes/ledger.json',
      entries: [
        { gate_id: 'gate:engineering', decision_refs: [{ decision_id: 'waiver-shared', source: 'finding:shared-waiver', artifact: decisionRecords.artifact }] },
        { gate_id: 'gate:workflow', decision_refs: [{ decision_id: 'waiver-shared', source: 'finding:shared-waiver', artifact: decisionRecords.artifact }] }
      ]
    }
  });

  const ledger = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources });
  assert.equal(ledger.traces.length, 1);
  assert.equal(ledger.traces[0].trace_status, 'conflicting');
  assert.ok(ledger.traces[0].source_errors.some((error) => error.code === 'claim_conflict'));
  assert.deepEqual(
    ledger.traces[0].gate.provenance.map((source) => source.native_id).sort(),
    ['gate:engineering', 'gate:workflow']
  );
});

test('GDL-S-2 direct waiver authority is story-bound and survives an explicit finding join', () => {
  const artifact = `.vibepro/pr/${STORY_ID}/decision-records.json`;
  const valid = {
    story_id: STORY_ID,
    artifact,
    artifact_digest: 'decision-digest',
    decisions: [{
      decision_id: 'waiver-linked', story_id: STORY_ID, type: 'waiver', status: 'accepted',
      source: 'finding:linked-waiver', artifact
    }]
  };
  const sources = collectDecisionOutcomeSources({
    storyId: STORY_ID,
    decisionRecords: valid,
    agentReviews: { stages: [{ stage: 'implementation', roles: [{
      role: 'runtime_contract', artifact: 'review.json', provenance_status: 'verified_agent',
      findings: [{ id: 'linked-waiver', summary: 'linked waiver finding' }], finding_dispositions: []
    }] }] }
  });
  const ledger = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources });

  assert.equal(ledger.traces.length, 1);
  assert.deepEqual(ledger.traces[0].eligible_outcome_sources.entries, [{
    kind: 'decision_record', ref: artifact, digest: 'decision-digest'
  }]);

  const wrongStory = collectDecisionOutcomeSources({
    storyId: STORY_ID,
    decisionRecords: {
      ...valid,
      decisions: [{ ...valid.decisions[0], decision_id: 'wrong-story', story_id: 'story-other' }]
    }
  });
  assert.equal(wrongStory[0].authority_valid, false);
  assert.equal(buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: wrongStory }).traces[0].eligible_outcome_sources.total_count, 0);
});

test('GDL-S-10 build-time waiver authority fails closed across story and artifact boundaries', () => {
  const artifact = `.vibepro/pr/${STORY_ID}/decision-records.json`;
  const decision = {
    decision_id: 'waiver-boundary', story_id: STORY_ID, type: 'waiver', status: 'accepted',
    source: 'finding:boundary', artifact
  };
  const validRecords = {
    story_id: STORY_ID,
    artifact,
    artifact_digest: 'decision-digest',
    decisions: [decision]
  };

  const directCrossStory = collectDecisionOutcomeSources({
    storyId: STORY_ID,
    decisionRecords: {
      ...validRecords,
      story_id: 'story-other',
      decisions: [{ ...decision, story_id: 'story-other', artifact: `.vibepro/pr/story-other/decision-records.json` }],
      artifact: `.vibepro/pr/story-other/decision-records.json`
    }
  })[0];
  assert.equal(directCrossStory.authority_valid, false);

  for (const mutation of [
    { name: 'missing decision story', decision: { ...decision, story_id: undefined } },
    { name: 'missing decision artifact', decision: { ...decision, artifact: undefined } },
    { name: 'missing ref artifact', ref: { decision_id: decision.decision_id, source: decision.source } }
  ]) {
    const records = { ...validRecords, decisions: [mutation.decision ?? decision] };
    const ref = mutation.ref ?? { decision_id: decision.decision_id, source: decision.source, artifact };
    const source = collectDecisionOutcomeSources({
      storyId: STORY_ID,
      decisionRecords: records,
      gateOutcomeLedger: { entries: [{ gate_id: 'gate:engineering', decision_refs: [ref] }] }
    }).find((candidate) => candidate.source_kind === 'gate_outcome');
    assert.equal(source.authority_valid, false, mutation.name);
    assert.equal(source.normalized_subject_key, 'gate:engineering', mutation.name);
    assert.equal(source.source_errors[0].code, 'decision_authority_invalid', mutation.name);
    assert.equal(source.source_errors.length, 1, `${mutation.name} does not duplicate the authority error`);
  }
});

test('GDL-S-3 behavior delta only accepts explicit values from a matching current command', () => {
  const ledger = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    currentHeadSha: 'head-1',
    sources: [finding('parse-failure')],
    verificationEvidence: {
      story_id: STORY_ID,
      commands: [{
        command: 'node --test test/parser.test.js',
        git_context: { head_sha: 'head-1' },
        observation: {
          values: {
            decision_trace_key: 'finding:parse-failure',
            behavior_before: 'parse failures were accepted',
            behavior_after: 'parse failures block the gate'
          },
          targets: ['src/reviewer.js']
        }
      }, {
        command: 'stale',
        git_context: { head_sha: 'old-head' },
        observation: {
          values: {
            decision_trace_key: 'finding:parse-failure',
            behavior_before: 'stale before',
            behavior_after: 'stale after'
          }
        }
      }]
    }
  });

  assert.equal(ledger.traces[0].behavior_delta.status, 'observed');
  assert.equal(ledger.traces[0].behavior_delta.before, 'parse failures were accepted');
  assert.equal(ledger.traces[0].behavior_delta.after, 'parse failures block the gate');
  assert.deepEqual(ledger.traces[0].behavior_delta.change_refs, ['src/reviewer.js']);
  assert.deepEqual(ledger.traces[0].behavior_delta.verification_refs, ['node --test test/parser.test.js']);
  assert.equal(ledger.traces[0].behavior_delta.excluded_sources[0].reason, 'strict_head_mismatch');
});

test('GDL-S-3 behavior delta rejects evidence with no current-head binding', () => {
  const ledger = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    currentHeadSha: 'head-1',
    sources: [finding('unbound')],
    verificationEvidence: {
      commands: [{
        command: 'node --test',
        observation: { values: {
          decision_trace_key: 'finding:unbound',
          behavior_before: 'before',
          behavior_after: 'after'
        } }
      }]
    }
  });
  assert.equal(ledger.traces[0].behavior_delta.status, 'partial');
  assert.equal(ledger.traces[0].behavior_delta.missing_reason, 'current_head_binding_missing');
});

test('GDL-S-3 equivalent behavior deltas merge deterministically across command order', () => {
  const commands = [{
    command: 'node --test a',
    git_context: { head_sha: 'head-1' },
    observation: {
      values: { decision_trace_key: 'finding:canonical-delta', behavior_before: 'open', behavior_after: 'blocked' },
      targets: ['src/b.js', 'src/a.js']
    }
  }, {
    command: 'node --test b',
    git_context: { head_sha: 'head-1' },
    observation: {
      values: { decision_trace_key: 'finding:canonical-delta', behavior_before: 'open', behavior_after: 'blocked' },
      targets: ['src/c.js', 'src/a.js']
    }
  }];
  const build = (items) => buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    currentHeadSha: 'head-1',
    sources: [finding('canonical-delta')],
    verificationEvidence: { commands: items }
  });
  const first = build(commands);
  const second = build([...commands].reverse());

  assert.deepEqual(first.traces[0].behavior_delta, second.traces[0].behavior_delta);
  assert.equal(first.traces[0].parent_revision_fingerprint, second.traces[0].parent_revision_fingerprint);
  assert.deepEqual(first.traces[0].behavior_delta.change_refs, ['src/a.js', 'src/b.js', 'src/c.js']);
  assert.deepEqual(first.traces[0].behavior_delta.verification_refs, ['node --test a', 'node --test b']);
});

test('GDL-S-3 contradictory current behavior deltas fail closed independent of order', () => {
  const commands = ['blocked', 'allowed'].map((after) => ({
    command: `verify ${after}`,
    git_context: { head_sha: 'head-1' },
    observation: {
      values: { decision_trace_key: 'finding:conflicting-delta', behavior_before: 'open', behavior_after: after },
      targets: [`src/${after}.js`]
    }
  }));
  const build = (items) => buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    currentHeadSha: 'head-1',
    sources: [finding('conflicting-delta')],
    verificationEvidence: { commands: items }
  });
  const first = build(commands);
  const second = build([...commands].reverse());

  assert.equal(first.traces[0].behavior_delta.status, 'conflicting');
  assert.equal(first.traces[0].trace_status, 'conflicting');
  assert.equal(first.traces[0].behavior_delta.missing_reason, 'behavior_delta_conflict');
  assert.deepEqual(first.traces[0].behavior_delta, second.traces[0].behavior_delta);
  assert.equal(first.traces[0].parent_revision_fingerprint, second.traces[0].parent_revision_fingerprint);
});

test('GDL-S-5 missing outcome is not_observed, not a zero-value claim', () => {
  const ledger = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [finding('parse-failure')] });
  assert.deepEqual(ledger.traces[0].behavior_delta, {
    status: 'not_observed',
    before: null,
    after: null,
    change_refs: [],
    verification_refs: [],
    verification_sources: [],
    missing_reason: 'explicit_behavior_delta_missing',
    excluded_sources: []
  });
  assert.deepEqual(ledger.traces[0].downstream_outcome, {
    status: 'not_observed',
    value: null,
    reason: null,
    source_ref: null,
    missing_reason: 'observation_missing'
  });
});

test('GDL-S-5 observation resolution selects the exact parent revision and preserves tri-state trust errors', () => {
  const initial = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [finding('history')] });
  const trace = initial.traces[0];
  const historical = observationFor(trace, {
    parent_revision_fingerprint: 'old-parent',
    value: { old: true },
    source_ref: 'old.json'
  });
  const notApplicable = observationFor(trace, {
    status: 'not_applicable',
    reason: 'no downstream runtime exists',
    value: null,
    source_ref: 'current.json'
  });
  const revised = reviseDecisionOutcomeLedger(initial, { observations: [historical, notApplicable] });
  assert.equal(revised.traces[0].downstream_outcome.status, 'not_applicable');
  assert.equal(revised.traces[0].downstream_outcome.reason, 'no downstream runtime exists');

  const untrusted = reviseDecisionOutcomeLedger(initial, { observations: [observationFor(trace, {
    status: 'not_applicable',
    reason: 'no downstream runtime exists',
    value: null,
    source_ref: 'current.json',
    authority: null
  })] });
  assert.equal(untrusted.traces[0].downstream_outcome.status, 'not_observed');
  assert.equal(untrusted.traces[0].downstream_outcome.missing_reason, 'observation_untrusted');
  assert.equal(untrusted.traces[0].source_errors[0].code, 'observation_untrusted');
});

test('GDL-S-9 observation resolution rejects incomplete authority envelopes instead of promoting their value', () => {
  const initial = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [finding('malformed-authority')] });
  const trace = initial.traces[0];
  const revised = reviseDecisionOutcomeLedger(initial, { observations: [{
    story_id: STORY_ID,
    trace_selector: { decision_trace_id: trace.decision_trace_id },
    parent_revision_fingerprint: trace.parent_revision_fingerprint,
    status: 'observed',
    value: { defect_recurred: false },
    authority: { recorded_by: 'vibepro', source_digest: 'digest-without-authority-kind' }
  }] });

  assert.equal(revised.traces[0].downstream_outcome.status, 'not_observed');
  assert.equal(revised.traces[0].downstream_outcome.missing_reason, 'observation_malformed');
  assert.equal(revised.traces[0].source_errors[0].code, 'observation_malformed');
});

test('GDL-S-9 observation schema rejects non-string timestamps and Windows absolute source refs', () => {
  const initial = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [finding('schema-boundary')] });
  const trace = initial.traces[0];
  const base = observationFor(trace);
  for (const mutation of [
    { observed_at: 0 },
    { source_ref: 'C:/outside.json' }
  ]) {
    const candidate = observationFor(trace, mutation);
    assert.deepEqual(validateDecisionOutcomeObservation(candidate, {
      storyId: STORY_ID,
      selector: { decision_trace_id: trace.decision_trace_id },
      parentRevision: trace.parent_revision_fingerprint
    }), { valid: false, code: 'observation_malformed' });
  }
  assert.equal(validateDecisionOutcomeObservation(base).valid, true);
});

test('GDL-S-5 observing one trace leaves unrelated traces explicitly not observed', () => {
  const initial = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    sources: [finding('observed-trace'), finding('unobserved-trace')]
  });
  const observed = initial.traces.find((trace) => trace.normalized_subject_key === 'finding:observed-trace');
  const revised = reviseDecisionOutcomeLedger(initial, { observations: [observationFor(observed, {
    value: { fixed: true },
    source_ref: 'observed.json'
  })] });
  const untouched = revised.traces.find((trace) => trace.normalized_subject_key === 'finding:unobserved-trace');

  assert.equal(untouched.downstream_outcome.status, 'not_observed');
  assert.equal(untouched.downstream_outcome.missing_reason, 'observation_missing');
  assert.deepEqual(untouched.source_errors, []);
  assert.notEqual(untouched.trace_status, 'conflicting');
});

test('GDL-S-4 mismatched PR identity remains an explicit delivery conflict', () => {
  const initial = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    sources: [finding('delivery-conflict')],
    delivery: {
      story_id: STORY_ID,
      status: 'pr_created',
      pr: { url: 'https://github.test/pr/1', state: 'OPEN' }
    }
  });
  const revised = reviseDecisionOutcomeLedger(initial, {
    delivery: {
      story_id: STORY_ID,
      status: 'merged',
      pr: { url: 'https://github.test/pr/2', state: 'MERGED' },
      merge: { sha: 'merge-2', status: 'merged' }
    }
  });

  assert.equal(revised.traces[0].delivery.status, 'conflicting');
  assert.equal(revised.traces[0].trace_status, 'conflicting');
  assert.ok(revised.traces[0].source_errors.some((error) => error.code === 'delivery_binding_mismatch'));
});

test('GDL-S-4 matching delivery identity is refreshed from current authority instead of stale ledger fields', () => {
  const initial = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    sources: [finding('delivery-authority-refresh')],
    delivery: {
      story_id: STORY_ID,
      status: 'merged',
      pr: { number: 41, url: 'https://github.test/pr/41', state: 'OPEN' },
      merge: { sha: 'merge-41', status: 'pending', merged_at: '2026-07-14T00:00:00.000Z' }
    }
  });
  const revised = reviseDecisionOutcomeLedger(initial, {
    delivery: {
      story_id: STORY_ID,
      status: 'merged',
      pr: { number: 41, url: 'https://github.test/pr/41', state: 'MERGED' },
      merge: { sha: 'merge-41', status: 'merged', merged_at: '2026-07-15T00:00:00.000Z' }
    }
  });

  assert.deepEqual(revised.traces[0].delivery, {
    status: 'merged',
    pr: { number: 41, url: 'https://github.test/pr/41', state: 'MERGED' },
    merge: { sha: 'merge-41', status: 'merged', merged_at: '2026-07-15T00:00:00.000Z' }
  });
  assert.equal(revised.traces[0].trace_status, 'partial');
});

test('GDL-S-4 mismatched PR number remains conflicting even when URL and merge SHA match', () => {
  const initial = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    sources: [finding('delivery-number-conflict')],
    delivery: {
      story_id: STORY_ID,
      status: 'merged',
      pr: { number: 41, url: 'https://github.test/pr/41', state: 'MERGED' },
      merge: { sha: 'merge-41', status: 'merged' }
    }
  });
  const revised = reviseDecisionOutcomeLedger(initial, {
    delivery: {
      story_id: STORY_ID,
      status: 'merged',
      pr: { number: 99, url: 'https://github.test/pr/41', state: 'MERGED' },
      merge: { sha: 'merge-41', status: 'merged' }
    }
  });

  assert.equal(revised.traces[0].delivery.status, 'conflicting');
  assert.equal(revised.traces[0].trace_status, 'conflicting');
  assert.ok(revised.traces[0].source_errors.some((error) => error.code === 'delivery_binding_mismatch'));
});

test('GDL-S-4 current authority supplements legacy delivery metadata without changing identity', () => {
  const initial = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    sources: [finding('delivery-legacy-supplement')],
    delivery: {
      story_id: STORY_ID,
      status: 'merged',
      pr: { url: 'https://github.test/pr/41', state: 'MERGED' },
      merge: { sha: 'merge-41', status: 'merged' }
    }
  });
  const revised = reviseDecisionOutcomeLedger(initial, {
    delivery: {
      story_id: STORY_ID,
      status: 'merged',
      pr: { number: 41, url: 'https://github.test/pr/41', state: 'MERGED' },
      merge: { sha: 'merge-41', status: 'merged', merged_at: '2026-07-15T00:00:00.000Z' }
    }
  });

  assert.deepEqual(revised.traces[0].delivery, {
    status: 'merged',
    pr: { number: 41, url: 'https://github.test/pr/41', state: 'MERGED' },
    merge: { sha: 'merge-41', status: 'merged', merged_at: '2026-07-15T00:00:00.000Z' }
  });
  assert.equal(revised.traces[0].trace_status, 'partial');
});

test('GDL-S-4 complementary legacy and authority fields cannot synthesize a contradictory PR identity', () => {
  const initial = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    sources: [finding('delivery-partial-identity-conflict')],
    delivery: {
      story_id: STORY_ID,
      status: 'merged',
      pr: { number: 41, state: 'MERGED' },
      merge: { sha: 'merge-41', status: 'merged' }
    }
  });
  const revised = reviseDecisionOutcomeLedger(initial, {
    delivery: {
      story_id: STORY_ID,
      status: 'merged',
      pr: { url: 'https://github.test/pull/99', state: 'MERGED' },
      merge: { sha: 'merge-41', status: 'merged' }
    }
  });

  assert.equal(revised.traces[0].delivery.status, 'conflicting');
  assert.equal(revised.traces[0].trace_status, 'conflicting');
  assert.ok(revised.traces[0].source_errors.some((error) => error.code === 'delivery_binding_mismatch'));
});

test('GDL-S-4 omitted current mutable metadata clears stale legacy values', () => {
  const initial = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    sources: [finding('delivery-mutable-omission')],
    delivery: {
      story_id: STORY_ID,
      status: 'merged',
      pr: { number: 41, url: 'https://github.test/pull/41', state: 'OPEN' },
      merge: { sha: 'merge-41', status: 'pending', merged_at: '2026-07-14T00:00:00.000Z' }
    }
  });
  const revised = reviseDecisionOutcomeLedger(initial, {
    delivery: {
      story_id: STORY_ID,
      status: 'merged',
      pr: { url: 'https://github.test/pull/41' },
      merge: { sha: 'merge-41' }
    }
  });

  assert.deepEqual(revised.traces[0].delivery, {
    status: 'merged',
    pr: { number: 41, url: 'https://github.test/pull/41', state: null },
    merge: { sha: 'merge-41', status: null, merged_at: null }
  });
  assert.deepEqual(revised.traces[0].source_errors, []);
});

test('GDL-S-4 production delivery binding derives PR identity and clears omitted mutable metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-delivery-bind-'));
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const initial = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    sources: [finding('delivery-production-shape')],
    artifactPath: `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`,
    delivery: {
      story_id: STORY_ID,
      status: 'merged',
      pr: { number: 41, state: 'OPEN' },
      merge: { sha: 'merge-41', status: 'pending', merged_at: '2026-07-14T00:00:00.000Z' }
    }
  });
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(initial, null, 2)}\n`);

  const bound = await bindDecisionOutcomeDelivery(root, STORY_ID, {
    story_id: STORY_ID,
    status: 'merged',
    pr: { url: 'https://github.test/pull/41', head_sha: 'head-41' },
    merge: { sha: 'merge-41' }
  });

  assert.deepEqual(bound.traces[0].delivery, {
    status: 'merged',
    pr: { url: 'https://github.test/pull/41', head_sha: 'head-41', number: 41, state: null },
    merge: { sha: 'merge-41', status: null, merged_at: null }
  });
  const persisted = JSON.parse(await readFile(path.join(prDir, 'decision-outcome-ledger.json'), 'utf8'));
  assert.deepEqual(persisted.traces[0].delivery, bound.traces[0].delivery);
});

test('GDL-S-9 direct delivery binding rejects traversal story IDs without mutating escaped state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-delivery-bind-containment-'));
  const escapedDir = path.join(root, '.vibepro', 'escaped');
  const escapedLedgerPath = path.join(escapedDir, 'decision-outcome-ledger.json');
  await mkdir(escapedDir, { recursive: true });
  const ledger = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [finding('escaped-binding')] });
  const original = `${JSON.stringify(ledger, null, 2)}\n`;
  await writeFile(escapedLedgerPath, original);

  await assert.rejects(bindDecisionOutcomeDelivery(root, '../escaped', {
    story_id: '../escaped',
    status: 'merged'
  }), (error) => error.error_id === 'outcome_story_invalid');
  assert.equal(await readFile(escapedLedgerPath, 'utf8'), original);
});

test('GDL-S-9 best-effort delivery binding reports invalid traversal IDs without mutating escaped state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-delivery-try-bind-containment-'));
  const escapedDir = path.join(root, '.vibepro', 'escaped');
  const escapedLedgerPath = path.join(escapedDir, 'decision-outcome-ledger.json');
  await mkdir(escapedDir, { recursive: true });
  const ledger = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [finding('escaped-try-binding')] });
  const original = `${JSON.stringify(ledger, null, 2)}\n`;
  await writeFile(escapedLedgerPath, original);

  const result = await tryBindDecisionOutcomeDelivery(root, '../escaped', {
    story_id: '../escaped',
    status: 'merged'
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.error.code, 'outcome_story_invalid');
  assert.equal(await readFile(escapedLedgerPath, 'utf8'), original);
});

test('GDL-S-9 manager record and refresh reject traversal IDs before ledger lookup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-outcome-manager-containment-'));

  await assert.rejects(recordOutcome(root, { storyId: '../escaped' }),
    (error) => error.error_id === 'outcome_story_invalid');
  await assert.rejects(refreshOutcome(root, { storyId: '../escaped' }),
    (error) => error.error_id === 'outcome_story_invalid');
  await assert.rejects(stat(path.join(root, '.vibepro', 'escaped')),
    (error) => error.code === 'ENOENT');
});

test('GDL-S-7 derived delivery binding failure stays explicit without interrupting the caller lifecycle', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-delivery-bind-failure-'));
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), '{broken');

  const result = await tryBindDecisionOutcomeDelivery(root, STORY_ID, {
    story_id: STORY_ID,
    status: 'merged'
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.error.code, 'decision_outcome_delivery_binding_failed');
  assert.equal(result.error.message, 'Decision outcome delivery binding is unavailable.');
  assert.doesNotMatch(JSON.stringify(result), /ghp_REVIEW_SECRET|JSON|position/i);
});

test('GDL-S-9 best-effort delivery binding never exposes malformed-ledger parser details or secrets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-delivery-bind-redaction-'));
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), '{"token":"ghp_REVIEW_SECRET",broken');

  const result = await tryBindDecisionOutcomeDelivery(root, STORY_ID, {
    story_id: STORY_ID,
    status: 'merged'
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.error.code, 'decision_outcome_delivery_binding_failed');
  assert.equal(result.error.message, 'Decision outcome delivery binding is unavailable.');
  assert.equal(result.error.recovery, 'Repair or regenerate the local decision outcome ledger, then retry the delivery operation.');
  assert.doesNotMatch(JSON.stringify(result), /ghp_REVIEW_SECRET|JSON|position/i);
});

test('GDL-S-9 base ledger write preserves prior bytes when atomic replacement fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-ledger-base-atomic-'));
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  const ledgerPath = path.join(prDir, 'decision-outcome-ledger.json');
  await mkdir(prDir, { recursive: true });
  const original = '{"preserved":true}\n';
  await writeFile(ledgerPath, original);

  await assert.rejects(writeDecisionOutcomeLedger(root, STORY_ID, {
    sources: [finding('base-atomic')]
  }, {
    atomicWrite: async () => { throw new Error('injected atomic replacement failure'); }
  }), /injected atomic replacement failure/);
  assert.equal(await readFile(ledgerPath, 'utf8'), original);
});

test('GDL-S-9 atomic replacement preserves an existing ledger file mode', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-ledger-atomic-mode-'));
  const ledgerPath = path.join(root, 'decision-outcome-ledger.json');
  await writeFile(ledgerPath, '{"before":true}\n');
  await chmod(ledgerPath, 0o640);
  const previousUmask = process.umask(0o077);
  try {
    await atomicReplaceFile(ledgerPath, '{"after":true}\n');
  } finally {
    process.umask(previousUmask);
  }

  assert.equal((await stat(ledgerPath)).mode & 0o777, 0o640);
  assert.equal(await readFile(ledgerPath, 'utf8'), '{"after":true}\n');
  assert.deepEqual(await readdir(root), ['decision-outcome-ledger.json']);
});

test('GDL-S-9 atomic replacement treats post-rename durability errors as committed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-ledger-atomic-durability-'));
  const ledgerPath = path.join(root, 'decision-outcome-ledger.json');
  await writeFile(ledgerPath, '{"before":true}\n');
  let durabilityError = null;

  await atomicReplaceFile(ledgerPath, '{"after":true}\n', {
    syncDirectory: async () => { throw new Error('injected directory sync failure'); },
    onDurabilityError: (error) => { durabilityError = error; }
  });

  assert.equal(await readFile(ledgerPath, 'utf8'), '{"after":true}\n');
  assert.match(durabilityError?.message ?? '', /injected directory sync failure/);
  assert.deepEqual(await readdir(root), ['decision-outcome-ledger.json']);
});

test('GDL-S-9 delivery binding preserves prior ledger bytes when atomic replacement fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-ledger-bind-atomic-'));
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  const ledgerPath = path.join(prDir, 'decision-outcome-ledger.json');
  await mkdir(prDir, { recursive: true });
  const ledger = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [finding('bind-atomic')] });
  const original = `${JSON.stringify(ledger, null, 2)}\n`;
  await writeFile(ledgerPath, original);

  await assert.rejects(bindDecisionOutcomeDelivery(root, STORY_ID, {
    story_id: STORY_ID,
    status: 'merged',
    pr: { url: 'https://github.test/pull/41' },
    merge: { sha: 'merge-41' }
  }, {
    atomicWrite: async () => { throw new Error('injected atomic replacement failure'); }
  }), /injected atomic replacement failure/);
  assert.equal(await readFile(ledgerPath, 'utf8'), original);
});

test('GDL-S-6 common summary is bounded, deterministic, and reconstructs a redacted decision chain', () => {
  const sources = Array.from({ length: 25 }, (_, index) => finding(`finding-${String(index).padStart(2, '0')}`, {
    finding: {
      id: `finding-${String(index).padStart(2, '0')}`,
      summary: `parser must fail closed token=ghp_${'secret'.repeat(8)}`
    }
  }));
  const ledger = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    sources,
    artifactPath: `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`
  });
  const summary = projectDecisionOutcomeSummary(ledger, { limit: 20 });

  assert.equal(summary.total_count, 25);
  assert.equal(summary.returned_count, 20);
  assert.equal(summary.omitted_count, 5);
  assert.equal(summary.truncated, true);
  assert.equal(summary.entries.length, 20);
  assert.ok(summary.entries.every((entry) => 'trace_source_ref' in entry));
  assert.equal(summary.entries[0].finding.value.summary, 'parser must fail closed token=[REDACTED]');
  assert.match(summary.entries[0].finding.value.id, /^finding-\d{2}$/);
  assert.equal(summary.entries[0].behavior_delta.status, 'not_observed');
  assert.equal(summary.entries[0].delivery.status, 'not_delivered');
  assert.equal(summary.entries[0].downstream_outcome.status, 'not_observed');
  assert.ok(!JSON.stringify(summary).includes('ghp_'));
  const reviewInput = renderDecisionOutcomeReviewInput(summary);
  assert.match(reviewInput, /parser must fail closed/);
  assert.match(reviewInput, /behavior_delta/);
  assert.ok(!reviewInput.includes('ghp_'));
  assert.equal(summary.ledger_path, `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`);
  assert.match(summary.ledger_digest, /^[a-f0-9]{64}$/);
});

test('GDL-S-6 summary orders risk status before stable trace identity', () => {
  const traces = [
    { trace_status: 'complete', decision_trace_id: 'dt_b' },
    { trace_status: 'partial', decision_trace_id: 'dt_b' },
    { trace_status: 'conflicting', decision_trace_id: 'dt_z' },
    { trace_status: 'incomplete', decision_trace_id: 'dt_a' },
    { trace_status: 'conflicting', decision_trace_id: 'dt_a' }
  ];
  const summary = projectDecisionOutcomeSummary({ story_id: STORY_ID, traces });

  assert.deepEqual(
    summary.entries.map((entry) => `${entry.trace_status}:${entry.decision_trace_id}`),
    ['conflicting:dt_a', 'conflicting:dt_z', 'incomplete:dt_a', 'partial:dt_b', 'complete:dt_b']
  );
});

test('GDL-S-6 over-budget handoff preserves the common decision-outcome projection', () => {
  const ledger = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    sources: Array.from({ length: 25 }, (_, index) => finding(`bounded-${String(index).padStart(2, '0')}`)),
    artifactPath: `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`,
    currentHeadSha: 'head-current'
  });
  const content = `${JSON.stringify(ledger, null, 2)}\n`;
  const summary = JSON.parse(buildArtifactSummaryContent({
    filename: 'decision-outcome-ledger.json',
    content,
    bytes: Buffer.byteLength(content),
    budgetBytes: 1024
  }));

  assert.equal(summary.conclusion.status_fields.ledger_path, `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`);
  assert.match(summary.conclusion.status_fields.ledger_digest, /^[a-f0-9]{64}$/);
  assert.equal(summary.conclusion.status_fields.evidence_head_sha, 'head-current');
  assert.ok(summary.details.entries.length > 0 && summary.details.entries.length <= 5);
  assert.equal(Object.values(summary.details.status_counts).reduce((sum, count) => sum + count, 0), 25);
  assert.ok(summary.details.entries.every((entry) => entry.trace_source_ref));
});

test('GDL-S-6 real nine-trace shape compacts until the bounded summary and handoff fit', () => {
  const ledger = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    sources: Array.from({ length: 9 }, (_, index) => finding('real-shape-' + index, {
      source_errors: [{
        code: 'review_context_unavailable',
        source_ref: '.vibepro/reviews/' + STORY_ID + '/implementation/review-result-' + index + '.json',
        detail: ('bounded-real-ledger-' + index + '-').repeat(40)
      }]
    })),
    artifactPath: '.vibepro/pr/' + STORY_ID + '/decision-outcome-ledger.json',
    currentHeadSha: 'head-current'
  });
  const content = JSON.stringify(ledger, null, 2) + '\n';
  const bytes = Buffer.byteLength(content);
  const plan = planArtifactBudget({
    artifacts: [{ filename: 'decision-outcome-ledger.json', content }],
    budgetBytes: 1024
  });
  const summaryEntry = plan.over_budget[0];
  const summaryContent = plan.summaries[0]?.content;

  assert.equal(ledger.traces.length, 9);
  assert.ok(bytes >= 30000 && bytes <= 50000, 'expected realistic ledger size, received ' + bytes);
  assert.equal(summaryEntry.summary_status, 'generated');
  assert.ok(summaryContent);
  assert.ok(Buffer.byteLength(summaryContent) <= Math.floor(bytes * 0.1));
  const summary = JSON.parse(summaryContent);
  assert.ok(summary.details.entries.length > 0 && summary.details.entries.length < 5);
  assert.equal(summary.conclusion.top_level_counts.total_count, 9);
  const handoff = resolveHandoffArtifact(plan, 'decision-outcome-ledger.json', '.vibepro/pr/story');
  assert.equal(handoff.is_summary, true);
  assert.match(handoff.path, /decision-outcome-ledger\.summary\.json$/);
  assert.match(handoff.full_path, /decision-outcome-ledger\.json$/);
});

test('GDL-S-9 outcome record resolves one eligible managed source and refreshes the merged trace', async () => {
  const fixture = await createOutcomeRepository('vibepro-outcome-');
  const { root } = fixture;
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const verification = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    commands: [{
      command: 'node --test',
      git_context: { head_sha: fixture.head },
      observation: {
        values: {
          decision_trace_key: 'finding:parse-failure',
          behavior_before: 'accepted',
          behavior_after: 'blocked'
        }
      }
    }]
  };
  const verificationBytes = `${JSON.stringify(verification, null, 2)}\n`;
  await writeFile(path.join(prDir, 'verification-evidence.json'), verificationBytes);
  const ledger = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    currentHeadSha: fixture.head,
    artifactPath: `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`,
    sources: [finding('parse-failure')],
    verificationEvidence: {
      ...verification,
      artifact: `.vibepro/pr/${STORY_ID}/verification-evidence.json`,
      artifact_digest: createHash('sha256').update(verificationBytes).digest('hex')
    },
    delivery: {
      story_id: STORY_ID,
      status: 'merged',
      pr: { number: 1, url: 'https://github.test/vibepro/outcome-fixture/pull/1', state: 'MERGED' },
      merge: { sha: fixture.head, status: 'merged' }
    }
  });
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  await writeMergeAuthority(prDir, fixture.head);

  const trace = ledger.traces[0];
  const recorded = await recordOutcome(root, {
    storyId: STORY_ID,
    traceId: trace.decision_trace_id,
    parentRevision: trace.parent_revision_fingerprint,
    status: 'observed',
    producer: 'operator:test',
    value: { defect_recurred: false },
    githubPrView: authoritativePr(fixture.head)
  });
  assert.equal(recorded.resolved_source.kind, 'verification_evidence');
  assert.match(recorded.artifact_digest, /^[a-f0-9]{64}$/);

  let preparedFiles = null;
  const refreshed = await refreshOutcome(root, {
    storyId: STORY_ID,
    githubPrView: authoritativePr(fixture.head),
    persistenceService: async ({ prepare }) => {
      const prepared = await prepare({ worktreeRoot: root });
      preparedFiles = prepared.files;
      return { summary: { status: 'pushed', commit_sha: 'canonical-1' }, prepared: prepared.metadata };
    }
  });
  assert.equal(refreshed.status, 'promoted');
  assert.ok([...preparedFiles.keys()].some((entry) => entry.includes('/decision-outcomes/') && entry.endsWith('.json')));
  const updated = JSON.parse(await readFile(path.join(prDir, 'decision-outcome-ledger.json'), 'utf8'));
  assert.equal(updated.traces[0].downstream_outcome.status, 'observed');
  assert.deepEqual(updated.traces[0].downstream_outcome.value, { defect_recurred: false });
  const usage = await createUsageReport(root);
  assert.equal(usage.decision_outcomes[0].story_id, STORY_ID);
  assert.equal(usage.decision_outcomes[0].total_count, 1);
  const rendered = renderUsageReport(usage);
  assert.match(rendered, /## Decision Outcomes/);
  assert.match(rendered, new RegExp(`trace:${trace.decision_trace_id}:complete:merged:observed`));
  assert.match(rendered, /returned=1 omitted=0 truncated=false/);
  assert.match(rendered, /chain=/);
  assert.match(rendered, /defect_recurred/);
});

test('GDL-S-9 outcome record validates producer reason and JSON-safe values before mutation', async () => {
  const fixture = await createBoundOutcomeFixture('strict_head');
  const cases = [{
    options: { status: 'observed', value: { nested: undefined }, producer: 'operator:test' },
    errorId: 'outcome_value_invalid'
  }, {
    options: { status: 'observed', value: null, producer: 'operator:test' },
    errorId: 'outcome_observation_invalid'
  }, {
    options: { status: 'observed', value: true, producer: `operator:${'x'.repeat(300)}` },
    errorId: 'outcome_producer_invalid'
  }, {
    options: { status: 'not_applicable', reason: `reason ${'x'.repeat(4100)}`, producer: 'operator:test' },
    errorId: 'outcome_reason_invalid'
  }];

  for (const scenario of cases) {
    const before = await snapshotManagedOutcomeState(fixture.root);
    await assert.rejects(recordOutcome(fixture.root, {
      storyId: STORY_ID,
      traceId: fixture.trace.decision_trace_id,
      parentRevision: fixture.trace.parent_revision_fingerprint,
      githubPrView: authoritativePr(fixture.head),
      ...scenario.options
    }), (error) => {
      assert.equal(error.error_id, scenario.errorId, JSON.stringify(error.toJSON?.() ?? error));
      return true;
    });
    assert.equal(await snapshotManagedOutcomeState(fixture.root), before, scenario.errorId);
  }
});

test('GDL-S-9 outcome record rejects an accepted waiver for a different trace', async () => {
  const fixture = await createOutcomeRepository('vibepro-outcome-waiver-binding-');
  const prDir = path.join(fixture.root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const artifact = `.vibepro/pr/${STORY_ID}/decision-records.json`;
  const decisions = {
    schema_version: '0.1.0', story_id: STORY_ID,
    decisions: [{
      schema_version: '0.1.0', decision_id: 'waiver-wrong-trace', story_id: STORY_ID, type: 'waiver', status: 'accepted',
      source: 'finding:other-trace', artifact
    }]
  };
  const bytes = `${JSON.stringify(decisions, null, 2)}\n`;
  await writeFile(path.join(prDir, 'decision-records.json'), bytes);
  const ledger = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    artifactPath: `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`,
    sources: [{
      source_kind: 'decision_record', source_ref: artifact, source_digest: createHash('sha256').update(bytes).digest('hex'),
      native_id: 'waiver-wrong-trace', normalized_subject_key: 'finding:selected-trace',
      decision: decisions.decisions[0], authority_valid: true, explicit_link: true
    }],
    delivery: {
      story_id: STORY_ID, status: 'merged', pr: { url: 'https://github.test/pr/1', state: 'MERGED' },
      merge: { sha: fixture.head, status: 'merged' }
    }
  });
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  await writeMergeAuthority(prDir, fixture.head);
  const trace = ledger.traces[0];

  await assert.rejects(recordOutcome(fixture.root, {
    storyId: STORY_ID,
    traceId: trace.decision_trace_id,
    parentRevision: trace.parent_revision_fingerprint,
    status: 'not_applicable',
    reason: 'waived risk has no downstream runtime',
    producer: 'operator:test',
    githubPrView: authoritativePr(fixture.head)
  }), (error) => error.error_id === 'outcome_source_untrusted');
});

test('GDL-S-9 failed canonical persistence restores the prior local ledger', async () => {
  const fixture = await createOutcomeRepository('vibepro-outcome-atomic-');
  const { root } = fixture;
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const ledger = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [finding('atomic')] });
  const ledgerPath = path.join(prDir, 'decision-outcome-ledger.json');
  const original = `${JSON.stringify(ledger, null, 2)}\n`;
  await writeFile(ledgerPath, original);
  await writeMergeAuthority(prDir, fixture.head);

  await assert.rejects(refreshOutcome(root, {
    storyId: STORY_ID,
    githubPrView: authoritativePr(fixture.head),
    persistenceService: async () => ({ summary: { status: 'push_failed' } })
  }), (error) => error.error_id === 'outcome_promotion_failed');
  assert.equal(await readFile(ledgerPath, 'utf8'), original);
  await assert.rejects(readFile(path.join(root, 'docs', 'management', 'audit-artifacts', STORY_ID, 'audit-bundle.json')), { code: 'ENOENT' });
});

test('GDL-S-9 outcome refresh rejects a requested base that differs from live PR authority', async () => {
  const fixture = await createOutcomeRepository('vibepro-outcome-base-authority-');
  const prDir = path.join(fixture.root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const ledger = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [finding('base-authority')] });
  const ledgerPath = path.join(prDir, 'decision-outcome-ledger.json');
  const original = `${JSON.stringify(ledger, null, 2)}\n`;
  await writeFile(ledgerPath, original);
  await writeMergeAuthority(prDir, fixture.head);

  await assert.rejects(refreshOutcome(fixture.root, {
    storyId: STORY_ID,
    baseRef: 'origin/develop',
    githubPrView: authoritativePr(fixture.head, { base: 'main' }),
    persistenceService: async () => assert.fail('persistence must not run for a mismatched base')
  }), (error) => error.error_id === 'outcome_base_authority_mismatch'
    && error.details.requested_base === 'develop'
    && error.details.authoritative_base === 'main');
  assert.equal(await readFile(ledgerPath, 'utf8'), original);
});

test('GDL-S-9 refresh finalization preserves prior ledger bytes when atomic replacement fails', async () => {
  const fixture = await createOutcomeRepository('vibepro-outcome-refresh-finalize-atomic-');
  const { root } = fixture;
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  const ledgerPath = path.join(prDir, 'decision-outcome-ledger.json');
  await mkdir(prDir, { recursive: true });
  const ledger = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [finding('refresh-finalize-atomic')] });
  const original = `${JSON.stringify(ledger, null, 2)}\n`;
  await writeFile(ledgerPath, original);
  await writeMergeAuthority(prDir, fixture.head);
  let writeCount = 0;

  await assert.rejects(refreshOutcome(root, {
    storyId: STORY_ID,
    githubPrView: authoritativePr(fixture.head),
    persistenceService: async () => ({ summary: { status: 'pushed', commit_sha: 'canonical-atomic' } }),
    atomicWrite: async (target, data) => {
      writeCount += 1;
      if (writeCount === 3) throw new Error('injected refresh finalization failure');
      return atomicReplaceFile(target, data);
    }
  }), /injected refresh finalization failure/);
  assert.equal(writeCount, 3);
  assert.equal(await readFile(ledgerPath, 'utf8'), original);
});

test('GDL-S-1 canonical refresh preserves every null-id collision revision', async () => {
  const fixture = await createOutcomeRepository('vibepro-outcome-collisions-');
  const { root } = fixture;
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const ledger = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    artifactPath: `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`,
    sources: [
      finding(null, { source_ref: 'review-a.json', role: 'runtime_contract' }),
      finding(null, { source_ref: 'review-b.json', role: 'code_spec_alignment' })
    ]
  });
  assert.equal(ledger.traces.length, 2);
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  await writeMergeAuthority(prDir, fixture.head);
  let revisionPaths = [];
  await refreshOutcome(root, {
    storyId: STORY_ID,
    githubPrView: authoritativePr(fixture.head),
    persistenceService: async ({ prepare }) => {
      const prepared = await prepare();
      revisionPaths = [...prepared.files.keys()].filter((entry) => entry.includes('/decision-outcomes/collision-'));
      return { summary: { status: 'pushed' } };
    }
  });
  assert.equal(revisionPaths.length, 2);
  assert.equal(new Set(revisionPaths).size, 2);
});

test('GDL-S-9 outcome record rejects stale parent without mutating observations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-outcome-stale-'));
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const ledger = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [finding('stale')] });
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  const before = await snapshotManagedOutcomeState(root);
  await assert.rejects(recordOutcome(root, {
    storyId: STORY_ID,
    traceId: ledger.traces[0].decision_trace_id,
    parentRevision: 'stale',
    status: 'observed',
    producer: 'operator:test',
    value: true
  }), (error) => error.error_id === 'outcome_parent_stale'
    && error.details.candidates[0].parent_revision_fingerprint === ledger.traces[0].parent_revision_fingerprint
    && /usage report --json/.test(error.details.recovery));
  assert.equal(await snapshotManagedOutcomeState(root), before);
});

test('GDL-S-9 collision selector records one trusted source and bounds zero or multiple candidates', async () => {
  const fixture = await createOutcomeRepository('vibepro-outcome-collision-record-');
  const { root } = fixture;
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const verification = {
    schema_version: '0.1.0', story_id: STORY_ID,
    commands: [{
      command: 'node --test', git_context: { head_sha: fixture.head },
      observation: { values: {
        decision_trace_key: 'finding:collision-record', behavior_before: 'before', behavior_after: 'after'
      } }
    }]
  };
  const bytes = `${JSON.stringify(verification, null, 2)}\n`;
  await writeFile(path.join(prDir, 'verification-evidence.json'), bytes);
  const ledger = buildDecisionOutcomeLedger({
    storyId: STORY_ID, currentHeadSha: fixture.head, sources: [finding('collision-record')],
    verificationEvidence: {
      ...verification, artifact: `.vibepro/pr/${STORY_ID}/verification-evidence.json`,
      artifact_digest: createHash('sha256').update(bytes).digest('hex')
    }
  });
  const trace = ledger.traces[0];
  trace.decision_trace_id = null;
  trace.collision_group = 'cg_fixture';
  trace.trace_source_ref = 'tsr_fixture';
  await writeMergeAuthority(prDir, fixture.head);

  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  const recorded = await recordOutcome(root, {
    storyId: STORY_ID, collisionGroup: 'cg_fixture', traceSourceRef: 'tsr_fixture',
    parentRevision: trace.parent_revision_fingerprint, status: 'not_applicable',
    reason: 'fixture outcome does not apply', producer: 'operator:test',
    githubPrView: authoritativePr(fixture.head)
  });
  assert.deepEqual(recorded.resolved_selector, { collision_group: 'cg_fixture', trace_source_ref: 'tsr_fixture' });

  trace.eligible_outcome_sources = { total_count: 0, returned_count: 0, omitted_count: 0, truncated: false, entries: [] };
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  const zeroBefore = await snapshotManagedOutcomeState(root);
  await assert.rejects(recordOutcome(root, {
    storyId: STORY_ID, collisionGroup: 'cg_fixture', traceSourceRef: 'tsr_fixture',
    parentRevision: trace.parent_revision_fingerprint, status: 'observed', value: true, producer: 'operator:test',
    githubPrView: authoritativePr(fixture.head)
  }), (error) => error.error_id === 'outcome_source_missing'
    && error.details.eligible_outcome_sources.total_count === 0
    && /Record current trace-specific verification evidence/.test(error.details.recovery));
  assert.equal(await snapshotManagedOutcomeState(root), zeroBefore);

  trace.eligible_outcome_sources = {
    total_count: 7, returned_count: 5, omitted_count: 2, truncated: true,
    entries: Array.from({ length: 5 }, (_, index) => ({ kind: 'verification_evidence', ref: `candidate-${index}`, digest: `digest-${index}` }))
  };
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  const multipleBefore = await snapshotManagedOutcomeState(root);
  await assert.rejects(recordOutcome(root, {
    storyId: STORY_ID, collisionGroup: 'cg_fixture', traceSourceRef: 'tsr_fixture',
    parentRevision: trace.parent_revision_fingerprint, status: 'observed', value: true, producer: 'operator:test',
    githubPrView: authoritativePr(fixture.head)
  }), (error) => error.error_id === 'outcome_source_not_unique'
    && error.details.eligible_outcome_sources.returned_count === 5
    && error.details.eligible_outcome_sources.omitted_count === 2
    && error.details.eligible_outcome_sources.truncated === true);
  assert.equal(await snapshotManagedOutcomeState(root), multipleBefore);
});

test('GDL-S-9 trace selectors reject zero and multiple ledger matches without mutation', async () => {
  const fixture = await createOutcomeRepository('vibepro-outcome-trace-cardinality-');
  const prDir = path.join(fixture.root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const ledger = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [finding('selector-cardinality')] });
  const trace = ledger.traces[0];
  const ledgerPath = path.join(prDir, 'decision-outcome-ledger.json');
  await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

  const zeroBefore = await snapshotManagedOutcomeState(fixture.root);
  await assert.rejects(recordOutcome(fixture.root, {
    storyId: STORY_ID, traceId: 'dt_missing', parentRevision: trace.parent_revision_fingerprint,
    status: 'observed', value: true, producer: 'operator:test'
  }), (error) => error.error_id === 'outcome_trace_not_unique'
    && error.details.candidate_count === 0);
  assert.equal(await snapshotManagedOutcomeState(fixture.root), zeroBefore);

  const duplicateLedger = { ...ledger, traces: [trace, { ...trace }] };
  await writeFile(ledgerPath, `${JSON.stringify(duplicateLedger, null, 2)}\n`);
  const multipleBefore = await snapshotManagedOutcomeState(fixture.root);
  await assert.rejects(recordOutcome(fixture.root, {
    storyId: STORY_ID, traceId: trace.decision_trace_id, parentRevision: trace.parent_revision_fingerprint,
    status: 'observed', value: true, producer: 'operator:test'
  }), (error) => error.error_id === 'outcome_trace_not_unique'
    && error.details.candidate_count === 2
    && error.details.candidates.length === 2);
  assert.equal(await snapshotManagedOutcomeState(fixture.root), multipleBefore);
});

test('GDL-S-9 outcome refresh rejects an unregistered hand-written observation explicitly', async () => {
  const fixture = await createOutcomeRepository('vibepro-outcome-malformed-');
  const { root } = fixture;
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  const observationDir = path.join(root, '.vibepro', 'observations', STORY_ID);
  await mkdir(prDir, { recursive: true });
  await mkdir(observationDir, { recursive: true });
  const ledger = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [finding('malformed')] });
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  await writeMergeAuthority(prDir, fixture.head);
  await writeFile(path.join(observationDir, 'broken.json'), '{broken');

  await assert.rejects(refreshOutcome(root, {
    storyId: STORY_ID,
    githubPrView: authoritativePr(fixture.head),
    persistenceService: async () => assert.fail('persistence must not run for malformed input')
  }), (error) => error.error_id === 'outcome_observation_untrusted');
});

test('GDL-S-3 production content_binding status cannot be bypassed by git_context fallback', () => {
  const staleStrict = buildDecisionOutcomeLedger({
    storyId: STORY_ID, currentHeadSha: 'head-1', sources: [finding('strict-stale')],
    verificationEvidence: { commands: [{
      command: 'node --test', git_context: { head_sha: 'head-1' },
      content_binding: { mode: 'strict_head', status: 'stale', recorded_head_sha: 'head-1' },
      observation: { values: { decision_trace_key: 'finding:strict-stale', behavior_before: 'before', behavior_after: 'after' } }
    }] }
  });
  assert.equal(staleStrict.traces[0].behavior_delta.status, 'partial');
  assert.equal(staleStrict.traces[0].behavior_delta.missing_reason, 'content_binding_stale');

  const staleOverridesLegacyCurrent = buildDecisionOutcomeLedger({
    storyId: STORY_ID, currentHeadSha: 'head-1', sources: [finding('binding-precedence')],
    verificationEvidence: { commands: [{
      command: 'node --test', git_context: { head_sha: 'head-1' },
      binding: { status: 'current' },
      content_binding: { mode: 'content_surface', status: 'stale' },
      observation: { values: { decision_trace_key: 'finding:binding-precedence', behavior_before: 'before', behavior_after: 'after' } }
    }] }
  });
  assert.equal(staleOverridesLegacyCurrent.traces[0].behavior_delta.status, 'partial');
  assert.equal(staleOverridesLegacyCurrent.traces[0].behavior_delta.missing_reason, 'content_binding_stale');

  const oldSurface = buildDecisionOutcomeLedger({
    storyId: STORY_ID, currentHeadSha: 'head-1', sources: [finding('surface-old')],
    verificationEvidence: { commands: [{
      command: 'node --test', git_context: { head_sha: 'old-head' },
      content_binding: { mode: 'content_surface', status: 'recorded' },
      binding: { status: 'current', content_binding: { mode: 'content_surface', recorded_surface_hash: 'hash', current_surface_hash: 'hash' } },
      observation: { values: { decision_trace_key: 'finding:surface-old', behavior_before: 'before', behavior_after: 'after' } }
    }] }
  });
  assert.equal(oldSurface.traces[0].behavior_delta.status, 'observed');

  const unevaluatedSurface = buildDecisionOutcomeLedger({
    storyId: STORY_ID, currentHeadSha: 'head-1', sources: [finding('surface-recorded')],
    verificationEvidence: { commands: [{
      command: 'node --test', git_context: { head_sha: 'head-1' },
      content_binding: { mode: 'content_surface', status: 'recorded' },
      observation: { values: { decision_trace_key: 'finding:surface-recorded', behavior_before: 'before', behavior_after: 'after' } }
    }] }
  });
  assert.equal(unevaluatedSurface.traces[0].behavior_delta.status, 'partial');
  assert.equal(unevaluatedSurface.traces[0].behavior_delta.missing_reason, 'content_binding_unverified');
});

test('GDL-S-3 outcome record evaluates strict-head and content-surface bindings at mutation time', async () => {
  for (const scenario of [
    { mode: 'strict_head', mutate: false, accepted: true },
    { mode: 'strict_head', mutate: true, accepted: false },
    { mode: 'content_surface', mutate: false, accepted: true },
    { mode: 'content_surface', mutate: true, accepted: false }
  ]) {
    const fixture = await createBoundOutcomeFixture(scenario.mode);
    if (scenario.mutate && scenario.mode === 'strict_head') {
      await writeFile(path.join(fixture.root, 'README.md'), 'fixture changed\n');
      await execFileAsync('git', ['add', 'README.md'], { cwd: fixture.root });
      await execFileAsync('git', ['commit', '-m', 'test: advance fixture head'], { cwd: fixture.root });
      await execFileAsync('git', ['push', 'origin', 'main'], { cwd: fixture.root });
      const latestHead = await gitOutput(fixture.root, ['rev-parse', 'HEAD']);
      await writeMergeAuthority(fixture.prDir, latestHead);
    }
    if (scenario.mutate && scenario.mode === 'content_surface') {
      await writeFile(path.join(fixture.root, 'surface.js'), 'export const value = 2;\n');
    }
    const operation = recordOutcome(fixture.root, {
      storyId: STORY_ID, traceId: fixture.trace.decision_trace_id,
      parentRevision: fixture.trace.parent_revision_fingerprint,
      status: 'observed', producer: 'operator:binding-test', value: { accepted: true },
      githubPrView: authoritativePr(await gitOutput(fixture.root, ['rev-parse', 'HEAD']))
    });
    if (scenario.accepted) {
      assert.equal((await operation).status, 'recorded', `${scenario.mode} current evidence must be accepted`);
    } else {
      await assert.rejects(operation, (error) => error.error_id === 'outcome_source_untrusted', `${scenario.mode} stale evidence must be rejected`);
    }
  }
});

test('GDL-S-9 concurrent outcome records preserve every manifest entry', async () => {
  const fixture = await createOutcomeRepository('vibepro-outcome-concurrent-');
  const prDir = path.join(fixture.root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const commands = ['concurrent-a', 'concurrent-b'].map((id) => ({
    command: `node --test ${id}`,
    git_context: { head_sha: fixture.head },
    observation: { values: { decision_trace_key: `finding:${id}`, behavior_before: 'before', behavior_after: 'after' } }
  }));
  const verification = { schema_version: '0.1.0', story_id: STORY_ID, commands };
  const bytes = `${JSON.stringify(verification, null, 2)}\n`;
  await writeFile(path.join(prDir, 'verification-evidence.json'), bytes);
  const ledger = buildDecisionOutcomeLedger({
    storyId: STORY_ID, currentHeadSha: fixture.head,
    artifactPath: `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`,
    sources: [finding('concurrent-a'), finding('concurrent-b')],
    verificationEvidence: { ...verification, artifact: `.vibepro/pr/${STORY_ID}/verification-evidence.json`, artifact_digest: createHash('sha256').update(bytes).digest('hex') }
  });
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  await writeMergeAuthority(prDir, fixture.head);
  await Promise.all(ledger.traces.map((trace) => recordOutcome(fixture.root, {
    storyId: STORY_ID, traceId: trace.decision_trace_id,
    parentRevision: trace.parent_revision_fingerprint,
    status: 'observed', producer: 'operator:concurrency-test', value: trace.normalized_subject_key,
    githubPrView: authoritativePr(fixture.head)
  })));
  const manifest = JSON.parse(await readFile(path.join(fixture.root, '.vibepro', 'observations', STORY_ID, 'manifest.json'), 'utf8'));
  assert.equal(manifest.entries.length, 2);
  assert.equal(new Set(manifest.entries.map((entry) => entry.observation_id)).size, 2);
});

test('GDL-S-9 outcome record fails closed when the existing managed observation state is inconsistent', async () => {
  for (const scenario of ['duplicate-id', 'duplicate-name', 'missing-artifact', 'digest-mismatch']) {
    const fixture = await createBoundOutcomeFixture('strict_head');
    const first = await recordOutcome(fixture.root, {
      storyId: STORY_ID, traceId: fixture.trace.decision_trace_id,
      parentRevision: fixture.trace.parent_revision_fingerprint,
      status: 'observed', producer: 'operator:manifest-fixture', value: { first: true },
      githubPrView: authoritativePr(fixture.head)
    });
    const observationDir = path.join(fixture.root, '.vibepro', 'observations', STORY_ID);
    const manifestPath = path.join(observationDir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (scenario === 'duplicate-id') {
      manifest.entries.push({ ...manifest.entries[0], artifact_name: 'duplicate.json' });
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    } else if (scenario === 'duplicate-name') {
      manifest.entries.push({ ...manifest.entries[0], observation_id: 'obs_duplicate' });
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    } else if (scenario === 'missing-artifact') {
      await unlink(path.join(fixture.root, first.artifact_path));
    } else {
      await writeFile(path.join(fixture.root, first.artifact_path), '{"tampered":true}\n');
    }
    const before = await snapshotManagedOutcomeState(fixture.root);
    await assert.rejects(recordOutcome(fixture.root, {
      storyId: STORY_ID, traceId: fixture.trace.decision_trace_id,
      parentRevision: fixture.trace.parent_revision_fingerprint,
      status: 'observed', producer: 'operator:manifest-fixture', value: { attempt: scenario },
      githubPrView: authoritativePr(fixture.head)
    }), (error) => ['outcome_observation_untrusted', 'outcome_observation_malformed'].includes(error.error_id), scenario);
    assert.equal(await snapshotManagedOutcomeState(fixture.root), before, `${scenario} rejection must rollback the pending observation`);
  }
});

test('GDL-S-9 forged merge artifact without git and PR authority cannot mutate observations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-outcome-forged-'));
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const ledger = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [finding('forged')] });
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger)}\n`);
  await writeFile(path.join(prDir, 'pr-create.json'), `${JSON.stringify({ story: { story_id: STORY_ID }, pr_url: 'https://github.test/pr/1', base: 'main' })}\n`);
  await writeFile(path.join(prDir, 'pr-merge.json'), `${JSON.stringify({ story: { story_id: STORY_ID }, status: 'merged', merge_commit_sha: 'deadbeef', base: 'main', pr: { url: 'https://github.test/pr/1' } })}\n`);
  await assert.rejects(recordOutcome(root, {
    storyId: STORY_ID, traceId: ledger.traces[0].decision_trace_id,
    parentRevision: ledger.traces[0].parent_revision_fingerprint,
    status: 'observed', producer: 'attacker', value: true
  }), (error) => error.error_id === 'outcome_not_merged');
});

test('GDL-S-9 live PR authentication denial is fail-closed, redacted, and leaves observations unchanged', async () => {
  const fixture = await createBoundOutcomeFixture('strict_head');
  const before = await snapshotManagedOutcomeState(fixture.root);
  const secret = 'ghp_DO_NOT_EXPOSE';

  await assert.rejects(recordOutcome(fixture.root, {
    storyId: STORY_ID,
    traceId: fixture.trace.decision_trace_id,
    parentRevision: fixture.trace.parent_revision_fingerprint,
    status: 'observed',
    producer: 'operator:auth-denied',
    value: { must_not_persist: true },
    githubPrView: async () => {
      throw new Error(`HTTP 401 authentication failed for token ${secret}`);
    }
  }), (error) => {
    assert.equal(error.error_id, 'outcome_not_merged');
    assert.equal(error.details.verification_failure, 'authentication denied while verifying live PR authority');
    assert.doesNotMatch(JSON.stringify(error), new RegExp(secret));
    return true;
  });

  assert.equal(await snapshotManagedOutcomeState(fixture.root), before);
});

test('GDL-S-9 live authority timeout is typed, finite, fail-closed, and leaves managed state unchanged', async () => {
  const fixture = await createBoundOutcomeFixture('strict_head');
  const before = await snapshotManagedOutcomeState(fixture.root);
  const startedAt = Date.now();

  await assert.rejects(recordOutcome(fixture.root, {
    storyId: STORY_ID,
    traceId: fixture.trace.decision_trace_id,
    parentRevision: fixture.trace.parent_revision_fingerprint,
    status: 'observed',
    producer: 'operator:authority-timeout',
    value: { must_not_persist: true },
      commandTimeoutMs: 2_000,
      githubPrViewTimeoutMs: 60,
    githubPrView: () => new Promise(() => {})
  }), (error) => {
    assert.equal(error.error_id, 'outcome_authority_timeout');
    assert.equal(error.details.stage, 'outcome_authority.github_pr_view');
    assert.equal(error.details.failure_kind, 'runner_timeout');
    assert.match(error.details.recovery, /retry/i);
    assert.doesNotMatch(JSON.stringify(error.toJSON()), /token|authorization/i);
    return true;
  });

  assert.ok(Date.now() - startedAt < 1_000, 'injected authority runner must have an outer deadline');
  assert.equal(await snapshotManagedOutcomeState(fixture.root), before);
});

test('GDL-S-9 locally forged authority cannot substitute an unrelated canonical ancestor for the remote PR head', async () => {
  const fixture = await createOutcomeRepository('vibepro-outcome-forged-ancestor-');
  const forgedHead = fixture.head;
  await writeFile(path.join(fixture.root, 'README.md'), 'real pull head\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: fixture.root });
  await execFileAsync('git', ['commit', '-m', 'test: create real pull head'], { cwd: fixture.root });
  await execFileAsync('git', ['push', 'origin', 'main'], { cwd: fixture.root });
  const realHead = await gitOutput(fixture.root, ['rev-parse', 'HEAD']);
  await execFileAsync('git', ['push', 'origin', `${realHead}:refs/pull/1/head`], { cwd: fixture.root });
  const prDir = path.join(fixture.root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const ledger = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [finding('forged-ancestor')] });
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger)}\n`);
  await writeFile(path.join(prDir, 'pr-create.json'), `${JSON.stringify({
    story: { story_id: STORY_ID }, pr_url: 'https://github.test/pr/1', base: 'main', current_head_sha: forgedHead
  })}\n`);
  await writeFile(path.join(prDir, 'pr-merge.json'), `${JSON.stringify({
    story: { story_id: STORY_ID }, status: 'merged', merge_commit_sha: forgedHead,
    current_head_sha: forgedHead, strategy: 'merge', base: 'main',
    pr: { number: 1, url: 'https://github.test/pr/1', state: 'MERGED', head_ref_oid: forgedHead }
  })}\n`);
  await assert.rejects(recordOutcome(fixture.root, {
    storyId: STORY_ID, traceId: ledger.traces[0].decision_trace_id,
    parentRevision: ledger.traces[0].parent_revision_fingerprint,
    status: 'observed', producer: 'attacker', value: true
  }), (error) => error.error_id === 'outcome_not_merged');
});

test('GDL-S-9 live PR authority rejects a later canonical commit falsely claimed as the PR merge commit', async () => {
  const fixture = await createOutcomeRepository('vibepro-outcome-forged-later-');
  const prHead = fixture.head;
  await writeFile(path.join(fixture.root, 'later.txt'), 'not produced by the pull request\n');
  await execFileAsync('git', ['add', 'later.txt'], { cwd: fixture.root });
  await execFileAsync('git', ['commit', '-m', 'test: advance canonical base after merge'], { cwd: fixture.root });
  await execFileAsync('git', ['push', 'origin', 'main'], { cwd: fixture.root });
  const laterHead = await gitOutput(fixture.root, ['rev-parse', 'HEAD']);
  const prDir = path.join(fixture.root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const ledger = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [finding('forged-later')] });
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger)}\n`);
  await writeMergeAuthority(prDir, laterHead, { prHead });

  await assert.rejects(recordOutcome(fixture.root, {
    storyId: STORY_ID, traceId: ledger.traces[0].decision_trace_id,
    parentRevision: ledger.traces[0].parent_revision_fingerprint,
    status: 'observed', producer: 'attacker', value: true,
    githubPrView: authoritativePr(prHead, { mergeCommitSha: prHead })
  }), (error) => error.error_id === 'outcome_not_merged'
    && error.details.verification_failure === 'live PR authority verification failed');
});

test('GDL-S-9 authoritative squash and rebase merges remain valid when the canonical base changes the resulting tree', async () => {
  for (const strategy of ['squash', 'rebase']) {
    const fixture = await createOutcomeRepository(`vibepro-outcome-${strategy}-`);
    const prHead = fixture.head;
    await writeFile(path.join(fixture.root, `${strategy}.txt`), 'canonical merge result\n');
    await execFileAsync('git', ['add', `${strategy}.txt`], { cwd: fixture.root });
    await execFileAsync('git', ['commit', '-m', `test: create ${strategy} merge result`], { cwd: fixture.root });
    await execFileAsync('git', ['push', 'origin', 'main'], { cwd: fixture.root });
    const mergeCommitSha = await gitOutput(fixture.root, ['rev-parse', 'HEAD']);
    const prDir = path.join(fixture.root, '.vibepro', 'pr', STORY_ID);
    await mkdir(prDir, { recursive: true });
    const verification = {
      schema_version: '0.1.0', story_id: STORY_ID,
      commands: [{
        command: 'node --test', git_context: { head_sha: prHead }, binding: { status: 'current' },
        observation: { values: { decision_trace_key: `finding:${strategy}`, behavior_before: 'before', behavior_after: 'after' } }
      }]
    };
    const bytes = `${JSON.stringify(verification, null, 2)}\n`;
    await writeFile(path.join(prDir, 'verification-evidence.json'), bytes);
    const ledger = buildDecisionOutcomeLedger({
      storyId: STORY_ID, currentHeadSha: mergeCommitSha, sources: [finding(strategy)],
      artifactPath: `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`,
      verificationEvidence: { ...verification, artifact: `.vibepro/pr/${STORY_ID}/verification-evidence.json`, artifact_digest: createHash('sha256').update(bytes).digest('hex') }
    });
    await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
    await writeMergeAuthority(prDir, mergeCommitSha, { prHead, strategy });
    const trace = ledger.traces[0];
    const recorded = await recordOutcome(fixture.root, {
      storyId: STORY_ID, traceId: trace.decision_trace_id,
      parentRevision: trace.parent_revision_fingerprint,
      status: 'not_applicable', reason: `${strategy} fixture`, producer: 'operator:test',
      githubPrView: authoritativePr(prHead, { mergeCommitSha })
    });
    assert.equal(recorded.status, 'recorded', `${strategy} must use live merge identity instead of whole-tree equality`);
  }
});

test('GDL-S-9 outcome refresh rejects a manifest entry whose registered artifact disappeared', async () => {
  const fixture = await createBoundOutcomeFixture('strict_head');
  const trace = fixture.trace;
  const recorded = await recordOutcome(fixture.root, {
    storyId: STORY_ID, traceId: trace.decision_trace_id,
    parentRevision: trace.parent_revision_fingerprint,
    status: 'not_applicable', reason: 'manifest integrity fixture', producer: 'operator:test',
    githubPrView: authoritativePr(fixture.head)
  });
  await unlink(path.join(fixture.root, recorded.artifact_path));
  await assert.rejects(refreshOutcome(fixture.root, {
    storyId: STORY_ID,
    githubPrView: authoritativePr(fixture.head),
    persistenceService: async () => assert.fail('persistence must not run when a registered observation disappeared')
  }), (error) => error.error_id === 'outcome_observation_malformed'
    && error.details.artifact_path === recorded.artifact_path);
});

test('GDL-S-9 outcome refresh rejects a malformed manifest even when no observation artifacts exist', async () => {
  const fixture = await createBoundOutcomeFixture('strict_head');
  const observationDir = path.join(fixture.root, '.vibepro', 'observations', STORY_ID);
  await mkdir(observationDir, { recursive: true });
  await writeFile(path.join(observationDir, 'manifest.json'), '{not-json\n');

  await assert.rejects(refreshOutcome(fixture.root, {
    storyId: STORY_ID,
    githubPrView: authoritativePr(fixture.head),
    persistenceService: async () => assert.fail('persistence must not run for a malformed managed manifest')
  }), (error) => error.error_id === 'outcome_observation_untrusted');
});

test('GDL-S-9 outcome refresh rejects a manifest-registered observation with an incomplete schema', async () => {
  const fixture = await createBoundOutcomeFixture('strict_head');
  const recorded = await recordOutcome(fixture.root, {
    storyId: STORY_ID,
    traceId: fixture.trace.decision_trace_id,
    parentRevision: fixture.trace.parent_revision_fingerprint,
    status: 'observed',
    value: { defect_recurred: false },
    producer: 'operator:test',
    githubPrView: authoritativePr(fixture.head)
  });
  const oldPath = path.join(fixture.root, recorded.artifact_path);
  const observation = JSON.parse(await readFile(oldPath, 'utf8'));
  delete observation.producer;
  delete observation.observation_id;
  const replacementId = `obs_${createHash('sha256').update(JSON.stringify(sortFixture(observation))).digest('hex')}`;
  observation.observation_id = replacementId;
  const replacementBytes = `${JSON.stringify(observation, null, 2)}\n`;
  const replacementPath = path.join(path.dirname(oldPath), `${replacementId}.json`);
  await writeFile(replacementPath, replacementBytes);
  await unlink(oldPath);
  const manifestPath = path.join(path.dirname(oldPath), 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.entries[0].observation_id = replacementId;
  manifest.entries[0].artifact_name = `${replacementId}.json`;
  manifest.entries[0].artifact_digest = createHash('sha256').update(replacementBytes).digest('hex');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await assert.rejects(refreshOutcome(fixture.root, {
    storyId: STORY_ID,
    githubPrView: authoritativePr(fixture.head),
    persistenceService: async () => assert.fail('persistence must not run for an incomplete observation schema')
  }), (error) => error.error_id === 'outcome_observation_malformed');
});

test('GDL-S-9 outcome refresh revalidates a registered observation against managed source bytes', async () => {
  const fixture = await createBoundOutcomeFixture('strict_head');
  const recorded = await recordOutcome(fixture.root, {
    storyId: STORY_ID,
    traceId: fixture.trace.decision_trace_id,
    parentRevision: fixture.trace.parent_revision_fingerprint,
    status: 'observed',
    value: { defect_recurred: false },
    producer: 'operator:test',
    githubPrView: authoritativePr(fixture.head)
  });
  const oldPath = path.join(fixture.root, recorded.artifact_path);
  const observation = JSON.parse(await readFile(oldPath, 'utf8'));
  observation.authority.source_digest = 'b'.repeat(64);
  delete observation.observation_id;
  const replacementId = `obs_${createHash('sha256').update(JSON.stringify(sortFixture(observation))).digest('hex')}`;
  observation.observation_id = replacementId;
  const replacementBytes = `${JSON.stringify(observation, null, 2)}\n`;
  const replacementPath = path.join(path.dirname(oldPath), `${replacementId}.json`);
  await writeFile(replacementPath, replacementBytes);
  await unlink(oldPath);
  const manifestPath = path.join(path.dirname(oldPath), 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.entries[0].observation_id = replacementId;
  manifest.entries[0].artifact_name = `${replacementId}.json`;
  manifest.entries[0].artifact_digest = createHash('sha256').update(replacementBytes).digest('hex');
  manifest.entries[0].source_digest = observation.authority.source_digest;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await assert.rejects(refreshOutcome(fixture.root, {
    storyId: STORY_ID,
    githubPrView: authoritativePr(fixture.head),
    persistenceService: async () => assert.fail('persistence must not run for an untrusted observation source')
  }), (error) => error.error_id === 'outcome_observation_untrusted');
});

test('GDL-S-7 canonical promotion rejects a malformed decision ledger instead of silently omitting it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-outcome-ledger-malformed-'));
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), '{broken');
  await assert.rejects(
    promoteCanonicalAuditArtifacts(root, { storyId: STORY_ID }),
    (error) => error.code === 'decision_outcome_ledger_malformed'
  );
});

test('GDL-S-7 canonical promotion rejects structurally untrusted decision ledgers', async (t) => {
  const cases = [
    ['empty object', () => ({}), 'schema_version'],
    ['wrong schema', (ledger) => ({ ...ledger, schema_version: '9.9.9' }), 'schema_version'],
    ['wrong model', (ledger) => ({ ...ledger, model: 'wrong-model' }), 'model'],
    ['wrong story', (ledger) => ({ ...ledger, story_id: 'story-other' }), 'story_id'],
    ['wrong artifact digest', (ledger) => ({ ...ledger, artifact_digest: 'f'.repeat(64) }), 'artifact_digest'],
    ['wrong parent fingerprint', (ledger) => ({
      ...ledger,
      traces: [{ ...ledger.traces[0], parent_revision_fingerprint: 'e'.repeat(64) }]
    }), 'parent_revision_fingerprint'],
    ['wrong revision fingerprint', (ledger) => ({
      ...ledger,
      traces: [{ ...ledger.traces[0], revision_fingerprint: 'd'.repeat(64) }]
    }), 'revision_fingerprint']
  ];

  for (const [label, mutate, field] of cases) {
    await t.test(label, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-outcome-ledger-structural-'));
      const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
      await mkdir(prDir, { recursive: true });
      const valid = buildDecisionOutcomeLedger({
        storyId: STORY_ID,
        artifactPath: `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`,
        sources: [finding('structural-validation')]
      });
      await writeFile(
        path.join(prDir, 'decision-outcome-ledger.json'),
        `${JSON.stringify(mutate(valid), null, 2)}\n`
      );

      await assert.rejects(
        promoteCanonicalAuditArtifacts(root, { storyId: STORY_ID }),
        (error) => error.code === 'decision_outcome_ledger_invalid' && error.field === field
      );
      await assert.rejects(
        stat(path.join(getCanonicalAuditDir(root, STORY_ID), 'decision-outcomes')),
        (error) => error.code === 'ENOENT'
      );
    });
  }
});

test('GDL-S-7 canonical promotion rejects escaped revision identifiers before writing any revision', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-outcome-ledger-path-escape-'));
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const ledger = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    artifactPath: `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`,
    sources: [finding('path-escape')]
  });
  ledger.traces.push({
    ...ledger.traces[0],
    decision_trace_id: `dt_${'a'.repeat(64)}`,
    trace_source_ref: `tsr_${'b'.repeat(64)}`,
    revision_fingerprint: '../../../../escaped'
  });
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);

  await assert.rejects(
    promoteCanonicalAuditArtifacts(root, { storyId: STORY_ID }),
    (error) => error.code === 'decision_outcome_ledger_invalid'
      && error.field === 'revision_fingerprint'
  );
  await assert.rejects(
    stat(path.join(getCanonicalAuditDir(root, STORY_ID), 'decision-outcomes')),
    (error) => error.code === 'ENOENT'
  );
});

test('GDL-S-7 canonical promotion rejects a missing revision fingerprint before writing valid siblings', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-outcome-ledger-missing-revision-'));
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const ledger = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    artifactPath: `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`,
    sources: [finding('valid-revision'), finding('missing-revision')]
  });
  delete ledger.traces[1].revision_fingerprint;
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);

  await assert.rejects(
    promoteCanonicalAuditArtifacts(root, { storyId: STORY_ID }),
    (error) => error.code === 'decision_outcome_ledger_invalid'
      && error.field === 'revision_fingerprint'
  );
  await assert.rejects(
    stat(path.join(getCanonicalAuditDir(root, STORY_ID), 'decision-outcomes')),
    (error) => error.code === 'ENOENT'
  );
});

test('GDL-S-8 canonical promotion preserves every computed revision across delivery and outcome changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-outcome-ledger-revisions-'));
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const artifactPath = `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`;
  const writeLedger = async (ledger) => {
    await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
    await promoteCanonicalAuditArtifacts(root, { storyId: STORY_ID, now: '2026-07-15T00:00:00.000Z' });
  };

  const initial = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    currentHeadSha: 'head-before-merge',
    artifactPath,
    sources: [finding('revision-history')]
  });
  await writeLedger(initial);

  const headOnly = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    currentHeadSha: 'head-after-code-change',
    artifactPath,
    sources: [finding('revision-history')]
  });
  await writeLedger(headOnly);

  const delivered = reviseDecisionOutcomeLedger(initial, {
    delivery: {
      story_id: STORY_ID,
      status: 'merged',
      pr: { number: 42, url: 'https://example.test/pr/42', state: 'MERGED' },
      merge: { sha: 'merge-42', status: 'merged' }
    }
  });
  await writeLedger(delivered);

  const deliveredTrace = delivered.traces[0];
  const observed = reviseDecisionOutcomeLedger(delivered, {
    observations: [observationFor(deliveredTrace, {
      source_ref: '.vibepro/outcomes/revision-history.json'
    })]
  });
  await writeLedger(observed);

  const traces = [initial, headOnly, delivered, observed].map((ledger) => ledger.traces[0]);
  assert.notEqual(initial.traces[0].parent_revision_fingerprint, headOnly.traces[0].parent_revision_fingerprint,
    'a head-only code revision creates a new immutable parent revision');
  assert.equal(new Set(traces.map((trace) => trace.revision_fingerprint)).size, 4,
    'head/delivery and downstream observation changes must produce distinct computed revisions');
  const selectorDir = path.join(
    getCanonicalAuditDir(root, STORY_ID),
    'decision-outcomes',
    `trace-${traces[0].decision_trace_id}`
  );
  const files = (await readdir(selectorDir)).sort();
  assert.deepEqual(
    files,
    traces.map((trace) => `${trace.revision_fingerprint}.json`).sort(),
    'canonical promotion must preserve old revisions when later delivery and outcome revisions are promoted'
  );
  const persisted = await Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(selectorDir, file), 'utf8'))));
  assert.deepEqual(
    new Set(persisted.map((revision) => revision.revision_fingerprint)),
    new Set(traces.map((trace) => trace.revision_fingerprint))
  );
  assert.ok(persisted.some((revision) => revision.trace.delivery.status === 'merged'));
  assert.ok(persisted.some((revision) => revision.trace.downstream_outcome.status === 'observed'));
});

test('GDL-S-8 canonical promotion deduplicates identical revisions when unrelated ledger traces change', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-outcome-ledger-dedupe-'));
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const artifactPath = `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`;
  const initial = buildDecisionOutcomeLedger({ storyId: STORY_ID, artifactPath, sources: [finding('stable')] });
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(initial, null, 2)}\n`);
  await promoteCanonicalAuditArtifacts(root, { storyId: STORY_ID });
  const stableTrace = initial.traces[0];
  const target = path.join(getCanonicalAuditDir(root, STORY_ID), 'decision-outcomes',
    `trace-${stableTrace.decision_trace_id}`, `${stableTrace.revision_fingerprint}.json`);
  const before = await readFile(target, 'utf8');

  const expanded = buildDecisionOutcomeLedger({
    storyId: STORY_ID, artifactPath, sources: [finding('stable'), finding('unrelated')]
  });
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(expanded, null, 2)}\n`);
  await promoteCanonicalAuditArtifacts(root, { storyId: STORY_ID });
  assert.equal(await readFile(target, 'utf8'), before);
});

test('GDL-S-8 canonical promotion rejects tampered bytes before immutable revision comparison', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-outcome-ledger-conflict-'));
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const ledger = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [finding('conflict')] });
  const ledgerPath = path.join(prDir, 'decision-outcome-ledger.json');
  await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  await promoteCanonicalAuditArtifacts(root, { storyId: STORY_ID });
  ledger.traces[0].finding.summary = 'tampered bytes under the same revision identity';
  await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

  await assert.rejects(
    promoteCanonicalAuditArtifacts(root, { storyId: STORY_ID }),
    (error) => error.code === 'decision_outcome_ledger_invalid'
      && error.field === 'artifact_digest'
  );
});

test('GDL-S-8 canonical promotion preserves a legacy revision whose only extra field is ledger_digest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-outcome-ledger-legacy-envelope-'));
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const ledger = buildDecisionOutcomeLedger({ storyId: STORY_ID, sources: [finding('legacy-envelope')] });
  const ledgerPath = path.join(prDir, 'decision-outcome-ledger.json');
  await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  await promoteCanonicalAuditArtifacts(root, { storyId: STORY_ID });
  const trace = ledger.traces[0];
  const target = path.join(getCanonicalAuditDir(root, STORY_ID), 'decision-outcomes',
    `trace-${trace.decision_trace_id}`, `${trace.revision_fingerprint}.json`);
  const legacy = JSON.parse(await readFile(target, 'utf8'));
  legacy.ledger_digest = ledger.artifact_digest;
  const legacyBytes = `${JSON.stringify(legacy, null, 2)}\n`;
  await writeFile(target, legacyBytes);

  await promoteCanonicalAuditArtifacts(root, { storyId: STORY_ID });
  assert.equal(await readFile(target, 'utf8'), legacyBytes);
});

async function createOutcomeRepository(prefix) {
  const parent = await mkdtemp(path.join(os.tmpdir(), prefix));
  const root = path.join(parent, 'repo');
  const remote = path.join(parent, 'remote.git');
  await mkdir(root);
  await execFileAsync('git', ['init', '--bare', remote], { cwd: parent });
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), 'fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'test: initialize outcome fixture'], { cwd: root });
  const authorityUrl = 'https://github.test/vibepro/outcome-fixture.git';
  await execFileAsync('git', ['config', `url.file://${remote}.insteadOf`, authorityUrl], { cwd: root });
  await execFileAsync('git', ['remote', 'add', 'origin', authorityUrl], { cwd: root });
  await execFileAsync('git', ['push', '-u', 'origin', 'main'], { cwd: root });
  const head = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })).stdout.trim();
  return { root, head };
}

async function writeMergeAuthority(prDir, mergeCommitSha, options = {}) {
  const prUrl = options.prUrl ?? 'https://github.test/vibepro/outcome-fixture/pull/1';
  const root = path.resolve(prDir, '../../..');
  const prHead = options.prHead ?? mergeCommitSha;
  await execFileAsync('git', ['push', '--force', 'origin', `${prHead}:refs/pull/1/head`], { cwd: root });
  await writeFile(path.join(prDir, 'pr-create.json'), `${JSON.stringify({
    story: { story_id: STORY_ID }, pr_url: prUrl, base: 'main', current_head_sha: prHead
  })}\n`);
  await writeFile(path.join(prDir, 'pr-merge.json'), `${JSON.stringify({
    story: { story_id: STORY_ID }, status: 'merged', merge_commit_sha: mergeCommitSha,
    current_head_sha: prHead, strategy: options.strategy ?? 'merge', base: 'main',
    git: { base_branch: 'main', base_ref: 'origin/main' },
    pr: { number: 1, url: prUrl, state: 'MERGED', head_ref_oid: prHead }
  })}\n`);
}

function authoritativePr(headRefOid, options = {}) {
  return async () => ({
    url: options.url ?? 'https://github.test/vibepro/outcome-fixture/pull/1',
    state: options.state ?? 'MERGED',
    headRefOid,
    baseRefName: options.base ?? 'main',
    mergeCommit: { oid: options.mergeCommitSha ?? headRefOid }
  });
}

async function createBoundOutcomeFixture(mode) {
  const fixture = await createOutcomeRepository(`vibepro-outcome-binding-${mode}-`);
  const prDir = path.join(fixture.root, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(fixture.root, 'surface.js'), 'export const value = 1;\n');
  await execFileAsync('git', ['add', 'surface.js'], { cwd: fixture.root });
  await execFileAsync('git', ['commit', '-m', 'test: add bound surface'], { cwd: fixture.root });
  await execFileAsync('git', ['push', 'origin', 'main'], { cwd: fixture.root });
  const head = await gitOutput(fixture.root, ['rev-parse', 'HEAD']);
  const contentBinding = await buildContentBinding(fixture.root, {
    strictHead: mode === 'strict_head', gitContext: { head_sha: head }, targets: ['surface.js']
  });
  const evaluated = await evaluateContentBinding(fixture.root, contentBinding, { head_sha: head });
  const command = {
    command: 'node --test binding', git_context: { head_sha: head }, content_binding: contentBinding,
    binding: evaluated,
    observation: { values: { decision_trace_key: 'finding:binding-record', behavior_before: 'before', behavior_after: 'after' } }
  };
  const verification = { schema_version: '0.1.0', story_id: STORY_ID, commands: [command] };
  const bytes = `${JSON.stringify(verification, null, 2)}\n`;
  await writeFile(path.join(prDir, 'verification-evidence.json'), bytes);
  const ledger = buildDecisionOutcomeLedger({
    storyId: STORY_ID, currentHeadSha: head, sources: [finding('binding-record')],
    artifactPath: `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`,
    verificationEvidence: { ...verification, artifact: `.vibepro/pr/${STORY_ID}/verification-evidence.json`, artifact_digest: createHash('sha256').update(bytes).digest('hex') }
  });
  await writeFile(path.join(prDir, 'decision-outcome-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  await writeMergeAuthority(prDir, head);
  return { ...fixture, head, prDir, trace: ledger.traces[0] };
}

async function gitOutput(cwd, args) {
  return (await execFileAsync('git', args, { cwd, encoding: 'utf8' })).stdout.trim();
}

async function snapshotManagedOutcomeState(root) {
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
