import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildHumanEvidenceDigest, renderPrGateSummary } from '../src/pr-manager.js';

function gateDagWith(nodes) {
  return {
    overall_status: 'needs_verification',
    summary: { acceptance_criteria_count: 0 },
    nodes
  };
}

const uiuxIntakeNode = {
  id: 'gate:uiux_intake_judgment',
  type: 'uiux_intake_judgment_gate',
  label: 'UI/UX Intake Judgment Gate',
  status: 'needs_evidence',
  required: true,
  reason: 'No intake applicability judgment recorded.'
};

test('renderPrGateSummary renders gate:uiux_intake_judgment when present in the gate DAG', () => {
  const output = renderPrGateSummary(gateDagWith([uiuxIntakeNode]));
  assert.match(output, /- UI\/UX Intake Judgment Gate: needs_evidence \(required\) - No intake applicability judgment recorded\./);
});

test('buildHumanEvidenceDigest includes gate:uiux_intake_judgment status when present', () => {
  const digest = buildHumanEvidenceDigest(gateDagWith([
    uiuxIntakeNode,
    { id: 'gate:pr_route_classification', status: 'passed' }
  ]));
  assert.match(digest, /PR Route passed/);
  assert.match(digest, /UI\/UX Intake needs_evidence/);
});

test('both human summary surfaces are unchanged when the gate node is absent', () => {
  const dag = gateDagWith([{ id: 'gate:pr_route_classification', status: 'passed' }]);
  assert.doesNotMatch(renderPrGateSummary(dag), /UI\/UX Intake/);
  assert.doesNotMatch(buildHumanEvidenceDigest(dag), /UI\/UX Intake/);
});
