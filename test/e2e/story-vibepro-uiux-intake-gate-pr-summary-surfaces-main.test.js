import assert from 'node:assert/strict';
import test from 'node:test';

import { buildHumanEvidenceDigest, renderPrGateSummary } from '../../src/pr-manager.js';

const STORY_ID = 'story-vibepro-uiux-intake-gate-pr-summary-surfaces';

// The gap: gate:uiux_intake_judgment (story-vibepro-uiux-intake-judgment-gate) exists in
// gate_dag.nodes and gate_status, but both curated human-summary label lists silently
// dropped it because they were never extended. Both render functions are currently
// unreferenced by production code (their caller chains were removed in earlier commits);
// this test pins the function contracts so the gate is not missing if they are re-wired.
function realisticGateDag({ withIntakeGate }) {
  const nodes = [
    { id: 'story', type: 'story_gate', label: 'Story', status: 'passed', required: true, reason: 'story registered' },
    { id: 'gate:pr_route_classification', type: 'route_gate', label: 'PR Route Classification Gate', status: 'passed', required: true, reason: 'route=agent_workflow' },
    ...(withIntakeGate ? [{
      id: 'gate:uiux_intake_judgment',
      type: 'uiux_intake_judgment_gate',
      label: 'UI/UX Intake Judgment Gate',
      status: 'needs_evidence',
      required: true,
      reason: 'No intake applicability judgment recorded.'
    }] : []),
    { id: 'gate:pr_body_contract', type: 'route_gate', label: 'PR Body Contract Gate', status: 'passed', required: true, reason: 'sections present' },
    { id: 'gate:unit', type: 'verification_gate', label: 'Unit Gate', status: 'passed', required: true, evidence: { artifact: 'verification-runs/unit.json' } }
  ];
  return {
    overall_status: 'needs_verification',
    summary: { acceptance_criteria_count: 3 },
    nodes
  };
}

test(`${STORY_ID} renders gate:uiux_intake_judgment on both human PR summary surfaces (AC-1 through AC-3)`, () => {
  // ${STORY_ID} PS-001
  // ${STORY_ID} ac:1
  // Given a gate DAG containing the gate:uiux_intake_judgment node, when renderPrGateSummary
  // renders the human gate summary, then the node's label, status, and required flag appear
  // as a line between PR Route Classification and PR Body Contract.
  const withGate = realisticGateDag({ withIntakeGate: true });
  const summary = renderPrGateSummary(withGate);
  const lines = summary.split('\n');
  const intakeIndex = lines.findIndex((line) => line.includes('UI/UX Intake Judgment Gate'));
  assert.notEqual(intakeIndex, -1, 'gate line must render');
  assert.match(lines[intakeIndex], /- UI\/UX Intake Judgment Gate: needs_evidence \(required\) - No intake applicability judgment recorded\./);
  assert.ok(intakeIndex > lines.findIndex((line) => line.includes('PR Route Classification Gate')));
  assert.ok(intakeIndex < lines.findIndex((line) => line.includes('PR Body Contract Gate')));

  // ${STORY_ID} PS-002
  // ${STORY_ID} ac:2
  // Given the same gate DAG, when buildHumanEvidenceDigest builds the human evidence digest,
  // then the digest includes the UI/UX Intake status between PR Route and PR Body.
  const digest = buildHumanEvidenceDigest(withGate);
  assert.match(digest, /PR Route passed \/ UI\/UX Intake needs_evidence \/ PR Body passed/);

  // ${STORY_ID} PS-003
  // ${STORY_ID} ac:3
  // Given a gate DAG without the gate:uiux_intake_judgment node, when both surfaces render,
  // then the output is exactly the with-gate output minus the intake entries — proving the
  // change is invisible for gate DAGs that do not define the gate.
  const withoutGate = realisticGateDag({ withIntakeGate: false });
  const summaryWithout = renderPrGateSummary(withoutGate);
  assert.deepEqual(
    summary.split('\n').filter((line) => !line.includes('UI/UX Intake Judgment Gate')),
    summaryWithout.split('\n')
  );
  const digestWithout = buildHumanEvidenceDigest(withoutGate);
  assert.equal(digestWithout, digest.replace(' / UI/UX Intake needs_evidence', ''));
});
