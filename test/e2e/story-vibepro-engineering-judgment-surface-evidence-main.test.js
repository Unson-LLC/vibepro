import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('story-vibepro-engineering-judgment-surface-evidence acceptance evidence is implemented and tested', async () => {
  const [implementation, cliTests, story, spec, architecture] = await Promise.all([
    readFile(new URL('../../src/pr-manager.js', import.meta.url), 'utf8'),
    readFile(new URL('../vibepro-cli.test.js', import.meta.url), 'utf8'),
    readFile(new URL('../../docs/management/stories/active/story-vibepro-engineering-judgment-surface-evidence.md', import.meta.url), 'utf8'),
    readFile(new URL('../../docs/specs/vibepro-engineering-judgment-surface-evidence.md', import.meta.url), 'utf8'),
    readFile(new URL('../../docs/architecture/vibepro-engineering-judgment-surface-evidence.md', import.meta.url), 'utf8')
  ]);

  assert.match(story, /story-vibepro-engineering-judgment-surface-evidence/);
  assert.match(spec, /surface/);
  assert.match(architecture, /matched evidence|matched_evidence/);

  assert.match(implementation, /function deriveJudgmentSurfaceProfile/);
  assert.match(implementation, /function classifyVerificationEvidenceItem/);
  assert.match(implementation, /surface === 'workflow'\) return \['flow_replay', 'artifact_replay', 'scenario_clause_e2e'\]/);
  assert.match(implementation, /surface === 'auth_boundary'\) return \['auth_denied', 'permission_denied', 'boundary_condition', 'negative_path'\]/);
  assert.match(implementation, /return \['focused_test', 'runtime_path_evidence', 'integration_runtime_path', 'e2e_runtime_path'\]/);
  assert.equal(implementation.includes("if (!generic && /\\b(flow replay|flow_replay|verify flow|journey|replay)\\b"), true);
  assert.equal(implementation.includes("if (!generic && /\\b(artifact replay|artifact_replay|gate-dag|pr-prepare|pr-create|stale artifact|stale readiness)\\b"), true);
  assert.match(implementation, /'design_diagrams_gate'/);
  assert.match(implementation, /gate\.id === 'gate:design_diagrams' && gate\.status !== 'satisfied'/);
  assert.match(implementation, /surface: surfaceProfile\.surface/);
  assert.match(implementation, /required_evidence_kind: highRisk \? failureModesRequirement/);
  assert.match(implementation, /matched_evidence: evidenceMatches\.failure_modes/);
  assert.match(implementation, /const currentRealityMissing = missingEvidenceKinds/);
  assert.match(implementation, /const failureModesMissing = missingEvidenceKinds/);
  assert.match(implementation, /const doneEvidenceMissing = missingEvidenceKinds/);
  assert.match(implementation, /currentRealityMissing\.length === 0 \? 'passed' : 'needs_evidence'/);
  assert.match(implementation, /function isGenericVerificationCommand/);

  assert.match(cliTests, /common judgment spine requires surface-specific evidence instead of generic tests/);
  assert.match(cliTests, /assert\.equal\(runtimeReality\.surface, 'runtime'\)/);
  assert.match(cliTests, /assert\.equal\(runtimeReality\.status, 'needs_evidence'\)/);
  assert.match(cliTests, /flow replay and artifact replay scenario clause evidence passed/);
  assert.match(cliTests, /assert\.equal\(partialWorkflowSpine\.status, 'needs_evidence'\)/);
  assert.match(cliTests, /assert\.deepEqual\(partialWorkflowReality\.missing_evidence, \['scenario_clause_e2e'\]\)/);
  assert.match(cliTests, /assert\.deepEqual\(workflowDone\.matched_evidence, \[\]\)/);
  assert.match(cliTests, /missing required design diagrams as critical unresolved readiness gates/);
  assert.match(cliTests, /assert\.equal\(authFailureModes\.surface, 'auth_boundary'\)/);
  assert.match(cliTests, /assert\.equal\(authFailureModes\.status, 'needs_evidence'\)/);
  assert.match(cliTests, /assert\.equal\(docsReality\.surface, 'docs_only'\)/);
  assert.match(cliTests, /assert\.match\(prBody, \/- done_evidence: needs_evidence/);
});
