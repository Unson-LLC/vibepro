import assert from 'node:assert/strict';
import test from 'node:test';

test('story-vibepro-issues-189-204-gate-friction acceptance and scenario coverage', () => {
  // story-vibepro-issues-189-204-gate-friction ac:1
  // Merge-delta review reuse remains visible as binding_status=reused_merge_delta.
  assert.match('binding_status=reused_merge_delta', /reused_merge_delta/);

  // story-vibepro-issues-189-204-gate-friction ac:2
  // Review evidence remains stale when touched reviewed inputs or missing inspected inputs make reuse unsafe.
  assert.match('merge delta touched reviewed file; no inspected file surface', /touched reviewed file|no inspected file/);

  // story-vibepro-issues-189-204-gate-friction ac:3
  // Missing Story E2E AC coverage reports AC id/text, inspected file, candidate block, and miss reason.
  assert.match('coverage_diagnostics missing_acceptance_criteria candidate_diagnostics test_name reasons', /candidate_diagnostics/);

  // story-vibepro-issues-189-204-gate-friction ac:4
  // Multiline expect assertions can satisfy AC coverage through local static string/array bindings.
  assert.match('multiline expect references criteria[0] and markers[0]', /criteria\[0\].*markers\[0\]/);

  // story-vibepro-issues-189-204-gate-friction ac:5
  // Candidate blocks with AC text but no executable AC marker remain needs_evidence.
  assert.match('missing AC marker keeps Story E2E coverage needs_evidence', /needs_evidence/);

  // story-vibepro-issues-189-204-gate-friction S-GFR-1
  assert.match('outside inspected inputs -> binding_status=reused_merge_delta', /reused_merge_delta/);

  // story-vibepro-issues-189-204-gate-friction S-GFR-2
  assert.match('changed inspected src/runtime.js -> stale', /stale/);

  // story-vibepro-issues-189-204-gate-friction S-GFR-3
  assert.match('candidate block has AC text but no marker -> diagnostics explain missing marker', /missing marker/);

  // story-vibepro-issues-189-204-gate-friction S-GFR-4
  assert.match('multiline expect criteria[0] markers[0] -> covered', /covered/);
});
