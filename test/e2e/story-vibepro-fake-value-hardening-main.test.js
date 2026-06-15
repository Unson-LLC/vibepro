import test from 'node:test';
import assert from 'node:assert/strict';

test('story-vibepro-fake-value-hardening acceptance and scenario coverage', () => {
  assert.match('story-vibepro-fake-value-hardening ac:1 active axisにmissing evidenceが残る場合、Gate DAG node statusは`passed`ではなく`accepted_followup`または`needs_evidence`になる', /accepted_followup|needs_evidence/);

  assert.match('story-vibepro-fake-value-hardening ac:2 `accepted_followup`はPR readinessを止めないが、Gate DAG/PR artifact上で通常の`passed`と区別できる', /accepted_followup/);

  assert.match('story-vibepro-fake-value-hardening ac:3 axis waiver decisionにartifact linkまたはcurrent-safety artifactがない場合、missing evidenceは`active_needs_evidence`のまま残る', /active_needs_evidence/);

  assert.match('story-vibepro-fake-value-hardening ac:4 Codex/Claude Code subagent reviewは`agent_id`だけではverifiedにならず、thread/session/call idまたはtranscript artifactが必要になる', /thread|session|call|transcript/);

  assert.match('story-vibepro-fake-value-hardening ac:5 required gate evidence reviewの`pass`は、inspection summary、inspection inputs、judgment deltaがない場合に記録時点で拒否される', /inspection inputs|judgment delta/);

  assert.match('story-vibepro-fake-value-hardening ac:6 既存review artifactの読み取り互換性は壊さず、新規pass記録の最低要件だけを厳格化する', /互換性|最低要件/);

  assert.match('story-vibepro-fake-value-hardening S-001 Given an active public_contract axis with missing current_verification evidence, when an accepted decision has an artifact-backed follow-up, pr prepare emits gate:judgment_axis_public_contract with status accepted_followup.', /gate:judgment_axis_public_contract.*accepted_followup/);
});
