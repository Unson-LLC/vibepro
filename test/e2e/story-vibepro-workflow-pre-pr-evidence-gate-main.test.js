import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('story-vibepro-workflow-pre-pr-evidence-gate covers pre-PR workflow evidence scenarios', async () => {
  const agentReview = await readFile(new URL('../../src/agent-review.js', import.meta.url), 'utf8');
  const prManager = await readFile(new URL('../../src/pr-manager.js', import.meta.url), 'utf8');
  const flowVerifier = await readFile(new URL('../../src/flow-verifier.js', import.meta.url), 'utf8');
  const gateRegressionTest = await readFile(new URL('../risk-adaptive-gate.test.js', import.meta.url), 'utf8');

  assert.equal(agentReview.includes("role: 'preview_smoke'"), false, 'AC1 preview_smoke is not a PR-final required review');
  assert.match(agentReview, /human_usability/, 'AC2 human usability remains pre-PR review evidence');
  assert.match(prManager, /flow_replay/, 'S-002 flow_replay observation is accepted as workflow replay evidence');
  assert.match(prManager, /scenario_clause_e2e/, 'S-002 scenario_clause_e2e observation is required with flow replay');
  assert.match(prManager, /hasExplicitObservationMarker/, 'S-002 workflow replay requires explicit structured observation markers');
  assert.match(prManager, /observation_check/, 'S-003 marker-only or observation-free E2E remains unresolved');
  assert.match(prManager, /flow_design\.runtime_probes\[\]/, 'S-001 zero-probe flow evidence has runtime probe registration action');
  assert.match(flowVerifier, /flow_runtime_probes_missing/, 'S-001 zero-probe Flow Verification remains unresolved');
  assert.match(flowVerifier, /BASIC_AUTH_USER && BASIC_AUTH_PASSWORD/, 'S-004 Basic Auth branch is explicitly covered');
  assert.match(gateRegressionTest, /flowReplayOnlyGate\.status/, 'S-003 flow_replay-only story E2E target remains unresolved');
  assert.match(gateRegressionTest, /scenario_clause_e2e: workflow state scenario clause was asserted/, 'S-002 positive replay fixture binds a scenario clause explicitly');
});
