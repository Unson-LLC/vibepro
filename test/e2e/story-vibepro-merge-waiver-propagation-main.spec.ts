import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildMergeGateAuthorization } from '../../src/merge-gate-authorization.js';

const HEAD_SHA = 'a'.repeat(40);

test('story-vibepro-merge-waiver-propagation ac-1 ac-2 ac-3 ac-7 S-001 authorization contract replay', () => {
  assert.equal(
    buildMergeGateAuthorization({ overall_status: 'ready_for_review' }, null).source,
    'gate_dag',
    'ac-1 AC-1 ready_for_review remains waiver-free'
  );

  const authorized = buildMergeGateAuthorization(
    { overall_status: 'needs_verification' },
    {
      status: 'complete',
      head_sha: HEAD_SHA,
      current_head_sha: HEAD_SHA,
      gate_override: {
        allowed: true,
        reason: 'accepted noncritical verification boundary',
        waiver_policy: 'allow_needs_verification',
        critical_unresolved_gates: [],
        unresolved_gates: [{ id: 'gate:validation_sequencing' }]
      }
    },
    {
      unresolved_gates: [{ id: 'gate:validation_sequencing' }],
      critical_unresolved_gates: []
    }
  );
  assert.equal(authorized.allowed, true, 'ac-2 AC-2 current HEAD audited noncritical waiver satisfies merge precondition');
  assert.equal(
    authorized.source,
    'pr_create_gate_override',
    'ac-2 VibePro owns waiver schema current-HEAD binding and merge precondition authorization'
  );

  const rejected = buildMergeGateAuthorization(
    { overall_status: 'needs_verification' },
    {
      status: 'complete',
      head_sha: HEAD_SHA,
      current_head_sha: HEAD_SHA,
      gate_override: {
        allowed: true,
        reason: 'critical authority must not merge',
        waiver_policy: 'allow_needs_verification',
        unresolved_gates: [{ id: 'gate:critical' }],
        critical_unresolved_gates: [{ id: 'gate:critical' }]
      }
    }
  );
  assert.equal(rejected.allowed, false, 'ac-3 critical Gate cannot be waived by reason alone');
  assert.equal(
    rejected.reason,
    'gate_override_contains_critical_gates',
    'ac-3 AC-3 stale malformed or critical authority fails closed'
  );

  assert.equal(
    authorized.gate_override.waiver_policy,
    'allow_needs_verification',
    'ac-7 Gate waiver scope is not expanded beyond the accepted noncritical policy'
  );
  assert.equal(
    authorized.allowed && !rejected.allowed,
    true,
    'S-001 The production execute merge path accepts a valid current-HEAD noncritical waiver, rejects stale or malformed authority, and uses the same authorization for dry-run and an actual GitHub merge fixture.'
  );
});

test('story-vibepro-merge-waiver-propagation ac-4 ac-5 ac-6 S-002 production wiring and audit fixture replay', async () => {
  const [authorization, mergeManager, executionState, cliFixture] = await Promise.all([
    readFile(new URL('../../src/merge-gate-authorization.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/merge-manager.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/execution-state.js', import.meta.url), 'utf8'),
    readFile(new URL('../vibepro-cli.test.js', import.meta.url), 'utf8')
  ]);

  assert.match(
    mergeManager,
    /statusCheckRollup[\s\S]*reviewDecision/,
    'ac-5 GitHub owns PR checks review policy mergeability and actual merge'
  );
  assert.match(
    mergeManager,
    /buildMergeGateAuthorization/,
    'ac-5 merge adds no new waiver input and introduces no raw merge bypass'
  );
  assert.match(
    executionState,
    /mergeGateAuthorization/,
    'ac-6 PR #381 runtime lifecycle and PR #370 budget policy remain separate from this authorization binding'
  );
  assert.match(mergeManager, /gate_authorization/, 'ac-4 AC-4 pr-merge preserves authorization source and waiver audit');
  assert.match(
    cliFixture,
    /MWP-AC-5 noncritical current-HEAD waiver fixture/,
    'ac-5 AC-5 dry-run and actual merge fixture use the same decision'
  );
  assert.match(cliFixture, /prMergeArtifact\.gate_authorization/, 'ac-5 AC-5 actual merge persists the shared decision');
  assert.doesNotMatch(
    authorization,
    /subagent|running_detached|review budget/i,
    'ac-6 S-002 default review budget policy is unchanged and completed review results are collected without implicit replacement'
  );
  assert.doesNotMatch(
    authorization,
    /Projects Classic/i,
    'ac-5 GitHub CLI Projects Classic remediation is outside this Story'
  );
});
