import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildResolvedGateOutcomeEntries,
  classifyGateOutcome,
  getGateOutcomeLedgerPath,
  recordResolvedGateOutcomes,
  summarizeGateOutcomeLedger
} from '../src/gate-outcome-ledger.js';
import { createUsageReport, renderUsageReport } from '../src/usage-report.js';

const PREVIOUS_DAG = {
  story_id: 'story-gate-roi',
  nodes: [
    {
      id: 'gate:requirement',
      type: 'requirement_gate',
      status: 'needs_review',
      required: true
    }
  ]
};

const CURRENT_DAG = {
  story_id: 'story-gate-roi',
  nodes: [
    {
      id: 'gate:requirement',
      type: 'requirement_gate',
      status: 'satisfied',
      required: true
    }
  ]
};

test('GRL-S-1/2/3/4 classifies resolved gate outcomes and supports override', () => {
  assert.equal(classifyGateOutcome({
    git: { changed_files: [{ path: 'src/app.js' }] },
    fileGroups: { source: { count: 1 } }
  }).outcome, 'source_fix');

  assert.equal(classifyGateOutcome({
    previousPrepareCreatedAt: '2026-07-05T00:00:00.000Z',
    verificationEvidence: {
      commands: [
        {
          command: 'npm test',
          status: 'pass',
          recorded_at: '2026-07-05T01:00:00.000Z'
        }
      ]
    }
  }).outcome, 'evidence_added');

  const waiver = classifyGateOutcome({
    previousPrepareCreatedAt: '2026-07-05T00:00:00.000Z',
    decisionRecords: {
      decisions: [
        {
          decision_id: 'decision-waiver-1',
          type: 'waiver',
          status: 'accepted',
          recorded_at: '2026-07-05T01:00:00.000Z'
        }
      ]
    }
  });
  assert.equal(waiver.outcome, 'waiver');
  assert.equal(waiver.decision_refs[0].decision_id, 'decision-waiver-1');

  assert.equal(classifyGateOutcome({
    git: { changed_files: [{ path: 'docs/management/stories/active/story-gate-roi.md' }] }
  }).outcome, 'rewording_only');

  const override = classifyGateOutcome({
    overrideOutcome: 'unclassified',
    git: { changed_files: [{ path: 'src/app.js' }] },
    fileGroups: { source: { count: 1 } }
  });
  assert.equal(override.outcome, 'unclassified');
  assert.equal(override.overridden, true);
});

test('GRL-S-1 records source_fix entries when a previously blocked gate resolves', () => {
  const entries = buildResolvedGateOutcomeEntries('/repo', {
    storyId: 'story-gate-roi',
    previousGateDag: PREVIOUS_DAG,
    currentGateDag: CURRENT_DAG,
    previousPrepareCreatedAt: '2026-07-05T00:00:00.000Z',
    createdAt: '2026-07-05T01:00:00.000Z',
    git: {
      changed_files: [{ path: 'src/app.js' }],
      head_sha: 'abc123'
    },
    fileGroups: { source: { count: 1 } }
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].gate_id, 'gate:requirement');
  assert.equal(entries[0].previous_status, 'needs_review');
  assert.equal(entries[0].resolved_status, 'satisfied');
  assert.equal(entries[0].outcome, 'source_fix');
});

test('GRL-S-1/3 keeps outcome classification specific to each resolved gate', () => {
  const previousGateDag = {
    story_id: 'story-gate-roi',
    nodes: [
      {
        id: 'gate:requirement',
        type: 'requirement_gate',
        status: 'needs_review',
        required: true
      },
      {
        id: 'gate:agent_review',
        type: 'agent_review_gate',
        status: 'needs_review',
        required: true
      }
    ]
  };
  const currentGateDag = {
    story_id: 'story-gate-roi',
    nodes: [
      {
        id: 'gate:requirement',
        type: 'requirement_gate',
        status: 'satisfied',
        required: true
      },
      {
        id: 'gate:agent_review',
        type: 'agent_review_gate',
        status: 'satisfied',
        required: true
      }
    ]
  };
  const entries = buildResolvedGateOutcomeEntries('/repo', {
    storyId: 'story-gate-roi',
    previousGateDag,
    currentGateDag,
    previousPrepareCreatedAt: '2026-07-05T00:00:00.000Z',
    createdAt: '2026-07-05T01:00:00.000Z',
    git: { changed_files: [{ path: 'src/app.js' }] },
    fileGroups: { source: { count: 1 } },
    agentReviews: {
      stages: [
        {
          stage: 'gate',
          roles: [
            {
              role: 'gate_evidence',
              status: 'pass',
              summary: 'gate:agent_review evidence is closed with parallel_subagent provenance',
              recorded_at: '2026-07-05T00:30:00.000Z'
            }
          ]
        }
      ]
    }
  });
  const byGate = Object.fromEntries(entries.map((entry) => [entry.gate_id, entry]));
  assert.equal(byGate['gate:requirement'].outcome, 'source_fix');
  assert.equal(byGate['gate:agent_review'].outcome, 'evidence_added');
  assert.equal(byGate['gate:agent_review'].evidence_refs[0].kind, 'agent_review');
});

test('missing reviews and short generic gate tokens do not count as evidence_added', () => {
  const result = classifyGateOutcome({
    gate: { id: 'spec', type: 'spec_gate', label: 'Spec Gate' },
    previousPrepareCreatedAt: '2026-07-05T00:00:00.000Z',
    agentReviews: {
      stages: [
        {
          stage: 'gate',
          roles: [
            {
              role: 'gate_evidence',
              status: 'missing',
              summary: 'docs/specs/story-vibepro-gate-outcome-roi-ledger.md still needs review',
              recorded_at: '2026-07-05T00:30:00.000Z'
            }
          ]
        }
      ]
    },
    verificationEvidence: {
      commands: [
        {
          command: 'npm run typecheck',
          status: 'pass',
          summary: 'checked docs/specs/story-vibepro-gate-outcome-roi-ledger.md',
          recorded_at: '2026-07-05T00:40:00.000Z'
        }
      ]
    }
  });
  assert.equal(result.outcome, 'unclassified');
});

test('GRL-S-5/7 aggregates usage report outcome distributions and demotion candidates', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-gate-roi-'));
  const ledgerPath = getGateOutcomeLedgerPath(repo);
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await writeFile(ledgerPath, `${JSON.stringify({
    schema_version: '0.1.0',
    model: 'vibepro-gate-outcome-ledger-v3',
    entries: [
      {
        story_id: 'story-old',
        gate_id: 'gate:requirement',
        outcome: 'source_fix',
        resolved_at: '2026-06-01T00:00:00.000Z'
      },
      {
        story_id: 'story-a',
        gate_id: 'gate:requirement',
        outcome: 'rewording_only',
        resolved_at: '2026-07-05T00:00:00.000Z'
      },
      {
        story_id: 'story-b',
        gate_id: 'gate:requirement',
        outcome: 'rewording_only',
        resolved_at: '2026-07-05T01:00:00.000Z'
      },
      {
        story_id: 'story-c',
        gate_id: 'gate:agent_review',
        outcome: 'waiver',
        resolved_at: '2026-07-05T01:30:00.000Z'
      }
    ]
  }, null, 2)}\n`);

  const report = await createUsageReport(repo, {
    since: '2026-07-01',
    language: 'en'
  });
  assert.equal(report.gate_outcomes.entry_count, 3);
  const requirement = report.gate_outcomes.distributions.find((item) => item.gate_id === 'gate:requirement');
  assert.equal(requirement.outcomes.rewording_only, 2);
  assert.equal(report.gate_outcomes.demotion_candidates[0].gate_id, 'gate:requirement');
  assert.match(renderUsageReport(report), /Gate Outcome ROI/);
  assert.match(renderUsageReport(report), /Demotion candidates/);

  const summarized = summarizeGateOutcomeLedger({ entries: [] });
  assert.equal(summarized.entry_count, 0);
});

test('legacy v1/v2 ledger entries are ignored after per-gate classifier model update', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-gate-roi-legacy-'));
  const ledgerPath = getGateOutcomeLedgerPath(repo);
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  for (const model of ['vibepro-gate-outcome-ledger-v1', 'vibepro-gate-outcome-ledger-v2']) {
    await writeFile(ledgerPath, `${JSON.stringify({
      schema_version: '0.1.0',
      model,
      entries: [
        {
          story_id: 'story-old',
          gate_id: 'gate:agent_review',
          outcome: 'source_fix',
          resolved_at: '2026-07-05T00:00:00.000Z'
        }
      ]
    }, null, 2)}\n`);

    const report = await createUsageReport(repo, { language: 'en' });
    assert.equal(report.gate_outcomes.entry_count, 0);
  }
});

test('GRL-S-6 recording ledger entries does not mutate gate status', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-gate-roi-record-'));
  const currentDag = structuredClone(CURRENT_DAG);
  const result = await recordResolvedGateOutcomes(repo, {
    storyId: 'story-gate-roi',
    previousGateDag: PREVIOUS_DAG,
    currentGateDag: currentDag,
    previousPrepareCreatedAt: '2026-07-05T00:00:00.000Z',
    createdAt: '2026-07-05T01:00:00.000Z',
    git: { changed_files: [{ path: 'docs/story.md' }] }
  });
  assert.equal(result.status, 'recorded');
  assert.equal(currentDag.nodes[0].status, 'satisfied');
});

test('invalid operator override is rejected even without a previous gate DAG', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-gate-roi-invalid-'));
  await assert.rejects(
    () => recordResolvedGateOutcomes(repo, { overrideOutcome: 'typo' }),
    /gate outcome must be one of/
  );
});
