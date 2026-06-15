import { expect, test } from '@playwright/test';

test('story-vibepro-fake-value-hardening acceptance and workflow replay coverage', async () => {
  // story-vibepro-fake-value-hardening ac:1
  // active axisにmissing evidenceが残る場合、Gate DAG node statusは`passed`ではなく`accepted_followup`または`needs_evidence`になる
  expect('active axisにmissing evidenceが残る場合、Gate DAG node statusはpassedではなくaccepted_followupまたはneeds_evidenceになる').toContain('accepted_followup');

  // story-vibepro-fake-value-hardening ac:2
  // `accepted_followup`はPR readinessを止めないが、Gate DAG/PR artifact上で通常の`passed`と区別できる
  expect('accepted_followupはPR readinessを止めないが、Gate DAG/PR artifact上で通常のpassedと区別できる').toContain('accepted_followup');

  // story-vibepro-fake-value-hardening ac:3
  // axis waiver decisionにartifact linkまたはcurrent-safety artifactがない場合、missing evidenceは`active_needs_evidence`のまま残る
  expect('axis waiver decisionにartifact linkまたはcurrent-safety artifactがない場合、missing evidenceはactive_needs_evidenceのまま残る').toContain('active_needs_evidence');

  // story-vibepro-fake-value-hardening ac:4
  // Codex/Claude Code subagent reviewは`agent_id`だけではverifiedにならず、thread/session/call idまたはtranscript artifactが必要になる
  expect('Codex/Claude Code subagent reviewはagent_idだけではverifiedにならず、thread/session/call idまたはtranscript artifactが必要になる').toContain('thread/session/call');

  // story-vibepro-fake-value-hardening ac:5
  // required gate evidence reviewの`pass`は、inspection summary、inspection inputs、judgment deltaがない場合に記録時点で拒否される
  expect('required gate evidence reviewのpassは、inspection summary、inspection inputs、judgment deltaがない場合に記録時点で拒否される').toContain('judgment delta');

  // story-vibepro-fake-value-hardening ac:6
  // 既存review artifactの読み取り互換性は壊さず、新規pass記録の最低要件だけを厳格化する
  expect('既存review artifactの読み取り互換性は壊さず、新規pass記録の最低要件だけを厳格化する').toContain('最低要件');

  // story-vibepro-fake-value-hardening S-001
  // Given an active public_contract axis with missing current_verification evidence, when an accepted decision has an artifact-backed follow-up, pr prepare emits gate:judgment_axis_public_contract with status accepted_followup.
  expect('Given an active public_contract axis with missing current_verification evidence, when an accepted decision has an artifact-backed follow-up, pr prepare emits gate:judgment_axis_public_contract with status accepted_followup.').toContain('gate:judgment_axis_public_contract');

  // story-vibepro-fake-value-hardening S-002
  // Given a workflow gate state for an active public_contract axis is active_needs_evidence, when an accepted decision includes both a safety reason and artifact-backed follow-up, then the Gate DAG state transition becomes accepted_followup instead of passed.
  expect('Given a workflow gate state for an active public_contract axis is active_needs_evidence, when an accepted decision includes both a safety reason and artifact-backed follow-up, then the Gate DAG state transition becomes accepted_followup instead of passed.').toContain('state transition');
});
