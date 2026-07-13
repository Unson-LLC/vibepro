import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildEvidencePlan,
  buildEvidenceDrilldownEntry
} from '../../src/evidence-depth-planner.js';

const STORY_ID = 'story-vibepro-summary-drilldown-log';

test('summary-first and explicit drill-down contracts replay end to end', async () => {
  const acceptanceMarkers = [
    `${STORY_ID} ac:1`,
    `${STORY_ID} ac:2`,
    `${STORY_ID} ac:3`,
    `${STORY_ID} ac:4`,
    `${STORY_ID} ac:5`
  ];
  assert.equal(new Set(acceptanceMarkers).size, 5, acceptanceMarkers.join(' '));

  const summary = buildEvidencePlan({
    story: { story_id: STORY_ID },
    git: { head_sha: 'abc123' },
    prContext: {
      change_classification: {
        profile: 'high_risk',
        risk_surfaces: ['source_code']
      }
    }
  });
  assert.equal(summary.evidence_depth, 'summary', `${STORY_ID} ac:1`);
  assert.ok(summary.risk_signals.length > 0, `${STORY_ID} ac:1`);

  assert.throws(
    () => buildEvidencePlan({ story: { story_id: STORY_ID }, requestedDepth: 'full' }),
    /reason.*consumer.*target/s,
    `${STORY_ID} ac:2`
  );

  const full = buildEvidencePlan({
    story: { story_id: STORY_ID },
    prContext: {
      gate_dag: { nodes: [{ id: 'gate:agent_review' }] }
    },
    requestedDepth: 'full',
    requestedDepthReason: 'inspect the blocking gate',
    requestedDepthConsumer: 'gate-reviewer',
    requestedDepthTargets: ['gate:agent_review']
  });
  const entry = buildEvidenceDrilldownEntry({
    evidencePlan: full,
    git: { head_sha: 'abc123' }
  });
  assert.equal(entry.depth, 'full', `${STORY_ID} ac:3`);
  assert.deepEqual(entry.targets, ['gate:agent_review'], `${STORY_ID} ac:3`);
  assert.equal(entry.head_sha, 'abc123', `${STORY_ID} ac:3`);
  assert.equal(entry.actual_read, undefined, `${STORY_ID} ac:4`);
  assert.equal(entry.used_for_decision, undefined, `${STORY_ID} ac:4`);

  const [readme, readmeJa] = await Promise.all([
    readFile(new URL('../../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../../README.ja.md', import.meta.url), 'utf8')
  ]);
  assert.match(readme, /--evidence-depth-target/, `${STORY_ID} ac:5`);
  assert.match(readmeJa, /--evidence-depth-target/, `${STORY_ID} ac:5`);
});
