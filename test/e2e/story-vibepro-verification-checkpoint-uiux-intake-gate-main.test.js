import assert from 'node:assert/strict';
import test from 'node:test';

import { listCheckpointStages } from '../../src/checkpoint-manager.js';

const STORY_ID = 'story-vibepro-verification-checkpoint-uiux-intake-gate';

// The gap: gate:uiux_intake_judgment (story-vibepro-uiux-intake-judgment-gate) will be an
// always-required gate DAG node, but the verification checkpoint's curated gate_ids list
// contained every sibling route/policy gate except it. Once the gate lands, the
// verification checkpoint would report "passed" while the final pr checkpoint blocks on
// the required gate. The checkpoint lookup drops ids without a matching DAG node
// (.map(find).filter(Boolean)), so landing the list entry ahead of the gate is a no-op
// for current gate DAGs — the same forward-compatible pattern PR #416 used for the
// human PR summary surfaces.
test(`${STORY_ID} verification checkpoint blocks on gate:uiux_intake_judgment alongside its sibling route gates (AC-1)`, () => {
  // story-vibepro-verification-checkpoint-uiux-intake-gate VC-001
  // story-vibepro-verification-checkpoint-uiux-intake-gate ac:1
  // Given the checkpoint policy table, when the verification stage is listed, then
  // gate:uiux_intake_judgment appears in gate_ids directly after
  // gate:pr_route_classification, matching the sibling route/policy gate ordering used
  // by the gate DAG and the human PR summary surfaces.
  const verification = listCheckpointStages().find((entry) => entry.stage === 'verification');
  assert.ok(verification, 'verification stage must exist');
  const routeIndex = verification.gate_ids.indexOf('gate:pr_route_classification');
  const intakeIndex = verification.gate_ids.indexOf('gate:uiux_intake_judgment');
  assert.notEqual(intakeIndex, -1, 'gate:uiux_intake_judgment must be in the verification gate list');
  assert.equal(intakeIndex, routeIndex + 1, 'intake judgment must follow route classification');
});

test(`${STORY_ID} no other checkpoint stage gained gate:uiux_intake_judgment (AC-2)`, () => {
  // story-vibepro-verification-checkpoint-uiux-intake-gate VC-002
  // story-vibepro-verification-checkpoint-uiux-intake-gate ac:2
  // Given the checkpoint policy table, when every non-verification stage is listed, then
  // none of their gate_ids contains gate:uiux_intake_judgment and the pr stage still
  // delegates to all required gates (gate_ids null) — the addition is scoped to the
  // verification checkpoint only.
  for (const entry of listCheckpointStages()) {
    if (entry.stage === 'verification') continue;
    if (entry.stage === 'pr') {
      assert.equal(entry.gate_ids, null, 'pr stage must keep delegating to all required gates');
      continue;
    }
    assert.ok(
      !entry.gate_ids.includes('gate:uiux_intake_judgment'),
      `${entry.stage} must not include gate:uiux_intake_judgment`
    );
  }
});
