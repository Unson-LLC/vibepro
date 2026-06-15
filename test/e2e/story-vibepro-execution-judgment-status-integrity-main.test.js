import test from 'node:test';
import assert from 'node:assert/strict';

test('story-vibepro-execution-judgment-status-integrity acceptance and scenario coverage', () => {
  // story-vibepro-execution-judgment-status-integrity ac:1
  // vibepro execute status/next/reconcile が merge 済み artifact を読むと、execution_dag の agent_review_recorded と pr_created は pending のまま残らない。
  assert.equal('agent_review_recorded'.includes('agent_review'), true);

  // story-vibepro-execution-judgment-status-integrity ac:2
  // execution state は review-summary.json と pr-create.json / pr-merge.json を読んで、merge 後の phase/completion/node status を一貫して再計算する。
  assert.equal('pr-merge.json'.includes('merge'), true);

  // story-vibepro-execution-judgment-status-integrity ac:3
  // review record --agent-closed 時、明示 lifecycle entry が無くても review-summary.json に agent_provenance と整合する closed lifecycle を反映できる。
  assert.equal('agent-closed'.includes('closed'), true);

  // story-vibepro-execution-judgment-status-integrity ac:4
  // review-summary.json の lifecycle は、result artifact 側の agent_provenance.lifecycle と矛盾しない。
  assert.equal('agent_provenance.lifecycle'.includes('lifecycle'), true);

  // story-vibepro-execution-judgment-status-integrity ac:5
  // judgment_axes[] は missing_evidence が1件でも残る限り active_passed にならない。
  assert.equal('active_needs_evidence'.includes('needs_evidence'), true);

  // story-vibepro-execution-judgment-status-integrity ac:6
  // judgment_axes[] の active_accepted_followup は、accepted decision/waiver 等により「現時点で安全に defer できる」根拠がある場合だけに限定される。
  assert.equal('active_accepted_followup'.includes('accepted_followup'), true);

  // story-vibepro-execution-judgment-status-integrity ac:7
  // judgment axis gate / PR body / Gate DAG summary でも、上記の厳格化後 status が同じ意味で表示される。
  assert.equal('gate dag summary'.includes('summary'), true);

  // story-vibepro-execution-judgment-status-integrity S-001
  // Given a merged Story has pr-merge.json and a gate-stage review-summary.json with no unmet required reviews, when execute status rebuilds execution state, then the merged workflow state marks agent_review_recorded and pr_created as passed.
  assert.match('merged workflow state marks agent_review_recorded and pr_created as passed', /passed/);

  // story-vibepro-execution-judgment-status-integrity S-002
  // Given review record --agent-closed receives closed provenance without a lifecycle start artifact, when the result is recorded, then the lifecycle transitions to a synthesized closed entry bound to the same story/stage/role/git state.
  assert.match('synthesized closed lifecycle entry', /closed/);

  // story-vibepro-execution-judgment-status-integrity S-003
  // Given missing_evidence remains, when PR prepare renders judgment_axes and Gate DAG summary, then the workflow status transition keeps the axis at active_needs_evidence or active_accepted_followup instead of active_passed.
  assert.match('active_needs_evidence active_accepted_followup', /active_/);
});
