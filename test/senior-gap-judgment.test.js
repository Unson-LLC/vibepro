import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { preparePullRequest } from '../src/pr-manager.js';
import {
  buildSeniorGapJudgment,
  buildSeniorGapJudgmentGate
} from '../src/senior-gap-judgment.js';

const execFileAsync = promisify(execFile);

test('SGJ-S-001 senior gap judgment preserves missing cost telemetry as residual risk', () => {
  const judgment = buildSeniorGapJudgment({
    story: { story_id: 'story-sgj', title: 'Senior gap judgment' },
    prContext: {
      story_source: {
        story_id: 'story-sgj',
        title: 'Senior gap judgment',
        acceptance_criteria: ['SGJ-AC-005 missing token telemetry is explicit']
      },
      engineering_judgment: {
        route_type: 'agent_workflow',
        active_axes: [],
        judgment_axes: []
      },
      gate_dag: {
        nodes: [{ id: 'story', type: 'story', required: true, status: 'present' }]
      },
      traceability_clause_coverage: {
        clause_count: 1,
        mapped_count: 1,
        weakly_mapped_count: 0,
        unmapped_count: 0
      }
    },
    gateStatus: {
      ready_for_pr_create: true,
      unresolved_gates: [],
      critical_unresolved_gates: []
    },
    evidencePlan: { evidence_depth: 'standard' },
    evidenceReuse: {
      status: 'hit',
      evidence_key: 'evk_test',
      artifact_value_ledger: {
        status: 'present',
        head_binding: { status: 'current_head_bound' },
        summary: {
          decision_bound_count: 5,
          decision_changed_count: 2,
          decision_change_unconfirmed_count: 2,
          unused_artifact_count: 1,
          linked_consumer_count: 5,
          total_token_estimate: 120
        }
      },
      session_attribution_ledger: {
        status: 'not_collected_in_pr_prepare',
        confidence: 'none',
        reason: 'fixture'
      },
      full_evidence: {
        generation_count: 2,
        cumulative_generation_count: 5
      }
    },
    createdAt: '2026-06-26T00:00:00.000Z'
  });

  assert.equal(judgment.decision.status, 'passed_with_residual_risk');
  assert.equal(judgment.decision.blocking_gap_count, 0);
  assert.equal(judgment.gaps.some((gap) => gap.kind === 'cost_telemetry_unavailable'), true);
  assert.equal(judgment.cost_context.evidence_reuse.full_evidence_generation_count, 2);
  assert.equal(judgment.cost_context.evidence_reuse.full_evidence_cumulative_generation_count, 5);
  assert.equal(judgment.cost_context.artifact_value_ledger.decision_bound_count, 5);
  assert.equal(judgment.cost_context.artifact_value_ledger.decision_changed_count, 2);
  assert.equal(judgment.cost_context.artifact_value_ledger.decision_change_unconfirmed_count, 2);
  assert.equal(judgment.cost_context.artifact_value_ledger.unused_artifact_count, 1);
  assert.equal(judgment.cost_context.session_attribution_ledger.status, 'not_collected_in_pr_prepare');
  assert.equal(judgment.current_state.artifact_value_ledger_status, 'present');
  assert.equal(judgment.current_state.session_attribution_status, 'not_collected_in_pr_prepare');
  assert.equal(judgment.decision_card.artifact_value_status, 'present');
  assert.equal(judgment.decision_card.session_attribution_status, 'not_collected_in_pr_prepare');
  assert.equal(judgment.decision_card.subagent_review_budget.recommended_action, 'no_subagent_needed');
  assert.equal(judgment.cost_context.token_accounting.status, 'not_collected_in_pr_prepare');
  assert.equal(judgment.cost_context.elapsed_time_accounting.status, 'not_collected_in_pr_prepare');
  assert.equal(judgment.current_state.traceability_clause_coverage.clause_count, 1);
  const gate = buildSeniorGapJudgmentGate(judgment, { artifact: '.vibepro/pr/story-sgj/senior-gap-judgment.json' });
  assert.equal(gate.status, 'passed');
  assert.equal(gate.residual_risk_count, 2);
});

test('SGJ-S-001b senior gap judgment closes cost telemetry residual when artifact policy bounds PR-body exposure', () => {
  const judgment = buildSeniorGapJudgment({
    story: { story_id: 'story-sgj-cost-bounded', title: 'Bounded cost context' },
    prContext: {
      story_source: {
        story_id: 'story-sgj-cost-bounded',
        title: 'Bounded cost context',
        acceptance_criteria: ['SGJ-AC-006 unavailable telemetry is bounded by artifact policy']
      },
      engineering_judgment: {
        route_type: 'agent_workflow',
        active_axes: [],
        judgment_axes: []
      },
      gate_dag: { nodes: [] },
      traceability_clause_coverage: {
        clause_count: 1,
        mapped_count: 1,
        weakly_mapped_count: 0,
        unmapped_count: 0
      }
    },
    gateStatus: {
      ready_for_pr_create: true,
      unresolved_gates: [],
      critical_unresolved_gates: []
    },
    evidencePlan: {
      evidence_depth: 'standard',
      consumers: ['evidence-reuse.json', 'decision-index.json', 'senior-gap-judgment.json', 'pr-body.md'],
      artifact_policy: {
        pr_body_token_policy: {
          status: 'bounded_by_artifact_links',
          duplicates_canonical_artifacts: false
        },
        generated_artifacts: ['pr-body.md', 'gate-dag.json']
      }
    },
    evidenceReuse: { status: 'hit', evidence_key: 'evk_cost_bounded' },
    createdAt: '2026-06-26T00:00:00.000Z'
  });

  assert.equal(judgment.cost_context.token_accounting.status, 'not_collected_in_pr_prepare');
  assert.equal(judgment.cost_context.elapsed_time_accounting.status, 'not_collected_in_pr_prepare');
  assert.equal(judgment.cost_context.telemetry_unavailability.status, 'bounded_by_artifact_policy');
  assert.equal(judgment.gaps.some((gap) => gap.kind === 'cost_telemetry_unavailable'), false);
  assert.equal(judgment.decision.status, 'passed');
  assert.equal(buildSeniorGapJudgmentGate(judgment).residual_risk_count, 0);
});

test('SGJ-S-001b2 senior gap judgment does not infer bounded cost policy from PR body generation alone', () => {
  const judgment = buildSeniorGapJudgment({
    story: { story_id: 'story-sgj-cost-unbounded', title: 'Unbounded cost context' },
    prContext: {
      story_source: {
        story_id: 'story-sgj-cost-unbounded',
        title: 'Unbounded cost context',
        acceptance_criteria: ['SGJ-AC-006 unavailable telemetry needs explicit artifact policy']
      },
      engineering_judgment: {
        route_type: 'agent_workflow',
        active_axes: [],
        judgment_axes: []
      },
      gate_dag: { nodes: [] },
      traceability_clause_coverage: {
        clause_count: 1,
        mapped_count: 1,
        weakly_mapped_count: 0,
        unmapped_count: 0
      }
    },
    gateStatus: {
      ready_for_pr_create: true,
      unresolved_gates: [],
      critical_unresolved_gates: []
    },
    evidencePlan: {
      evidence_depth: 'standard',
      consumers: ['pr-body.md'],
      artifact_policy: {
        generated_artifacts: ['pr-body.md', 'gate-dag.json']
      }
    },
    evidenceReuse: { status: 'hit', evidence_key: 'evk_cost_unbounded' },
    createdAt: '2026-06-26T00:00:00.000Z'
  });

  assert.equal(judgment.cost_context.telemetry_unavailability.status, 'residual_risk');
  assert.equal(judgment.gaps.some((gap) => gap.kind === 'cost_telemetry_unavailable'), true);
  assert.equal(judgment.decision.status, 'passed_with_residual_risk');
});

test('SGJ-S-001c senior gap judgment accepts explicit token and elapsed-time accounting', () => {
  const judgment = buildSeniorGapJudgment({
    story: { story_id: 'story-sgj-cost-available', title: 'Available cost context' },
    prContext: {
      story_source: { story_id: 'story-sgj-cost-available', acceptance_criteria: [] },
      engineering_judgment: { judgment_axes: [] },
      gate_dag: { nodes: [] },
      cost_context: {
        token_accounting: {
          total_tokens: 1234,
          input_tokens: 1000,
          output_tokens: 234,
          source: 'fixture'
        },
        elapsed_time_accounting: {
          elapsed_ms: 5678,
          source: 'fixture'
        }
      }
    },
    gateStatus: {
      ready_for_pr_create: true,
      unresolved_gates: [],
      critical_unresolved_gates: []
    }
  });

  assert.equal(judgment.cost_context.token_accounting.status, 'available');
  assert.equal(judgment.cost_context.elapsed_time_accounting.status, 'available');
  assert.equal(judgment.cost_context.telemetry_unavailability.status, 'not_applicable');
  assert.equal(judgment.gaps.some((gap) => gap.kind === 'cost_telemetry_unavailable'), false);
  assert.equal(judgment.decision.status, 'passed');
});

test('SGJ-S-002 senior gap judgment turns unresolved gates into non-deferrable gaps', () => {
  const judgment = buildSeniorGapJudgment({
    story: { story_id: 'story-sgj-blocked', title: 'Blocked senior gap judgment' },
    prContext: {
      story_source: { story_id: 'story-sgj-blocked', acceptance_criteria: [] },
      engineering_judgment: { judgment_axes: [] },
      gate_dag: { nodes: [] }
    },
    gateStatus: {
      ready_for_pr_create: false,
      critical_unresolved_gates: [{
        id: 'gate:requirement',
        type: 'requirement_gate',
        label: 'Requirement Gate',
        status: 'contradicted',
        reason: 'Story and implementation contradict'
      }],
      unresolved_gates: []
    }
  });

  assert.equal(judgment.decision.status, 'block');
  assert.equal(judgment.gaps.some((gap) => gap.kind === 'unresolved_required_gate' && gap.safe_to_defer === false), true);
  assert.equal(buildSeniorGapJudgmentGate(judgment).status, 'block');
});

test('SGJ-IDEAL-001 ideal_state.target_architecture is null when no target model was supplied', () => {
  const judgment = buildSeniorGapJudgment({
    story: { story_id: 'story-sgj-no-target-model', title: 'No target model' },
    prContext: {
      story_source: { story_id: 'story-sgj-no-target-model', acceptance_criteria: [] },
      engineering_judgment: { judgment_axes: [] },
      gate_dag: { nodes: [] }
    },
    gateStatus: {
      ready_for_pr_create: true,
      unresolved_gates: [],
      critical_unresolved_gates: []
    }
  });

  assert.equal(judgment.ideal_state.target_architecture, null);
});

test('SGJ-IDEAL-002 ideal_state.target_architecture surfaces the adjudicated target model, not just the Story ACs', () => {
  const targetArchitecture = {
    model_path: 'docs/architecture/target-model.json',
    status: 'adjudicated',
    adjudicated_rules: [
      { id: 'R-001', statement: 'workspace-infra は他のどのモジュールにも依存しない' },
      { id: 'R-002', statement: 'cli 以外のモジュールは cli に依存しない' },
      { id: 'R-003', statement: 'budgets.file_line_baseline の13ファイルは凍結行数を超えて成長しない(default 1500行)' },
      { id: 'R-004', statement: 'モジュール間の新規依存は target-model への宣言(人間の承認)を先に必要とする' }
    ],
    conformance_summary: { violation_count: 68, undeclared_dependency_count: 66 }
  };
  const judgment = buildSeniorGapJudgment({
    story: { story_id: 'story-sgj-target-model', title: 'Target model backed' },
    prContext: {
      story_source: { story_id: 'story-sgj-target-model', acceptance_criteria: ['AC-1 does not violate the target architecture'] },
      engineering_judgment: { judgment_axes: [] },
      gate_dag: { nodes: [] }
    },
    gateStatus: {
      ready_for_pr_create: true,
      unresolved_gates: [],
      critical_unresolved_gates: []
    },
    targetArchitecture
  });

  assert.deepEqual(judgment.ideal_state.target_architecture, targetArchitecture);
  // Ideal state is not purely self-referential anymore: the Story's own AC count is still
  // present alongside (not replaced by) the independently adjudicated architecture norm.
  assert.equal(judgment.ideal_state.acceptance_criteria_count, 1);
  assert.equal(judgment.ideal_state.target_architecture.adjudicated_rules.length, 4);
});

test('SGJ-S-003 senior gap judgment keeps accepted followups as residual gaps', () => {
  const judgment = buildSeniorGapJudgment({
    story: { story_id: 'story-sgj-followup', title: 'Accepted followup senior gap judgment' },
    prContext: {
      story_source: { story_id: 'story-sgj-followup', acceptance_criteria: [] },
      engineering_judgment: {
        judgment_axes: [{
          axis: 'public_contract',
          status: 'active_accepted_followup',
          confidence: 'high',
          decision_question: 'Is the public contract impact bounded?',
          acceptable_followup: 'Public contract replay can be deferred because no public API changed.',
          matched_evidence: [{ artifact: '.vibepro/decisions/story-sgj-followup.json' }]
        }]
      },
      gate_dag: { nodes: [] }
    },
    gateStatus: {
      ready_for_pr_create: true,
      unresolved_gates: [],
      critical_unresolved_gates: []
    },
    evidenceReuse: { status: 'hit', evidence_key: 'evk_followup' }
  });

  const followupGap = judgment.gaps.find((gap) => gap.kind === 'accepted_followup');
  assert.ok(followupGap);
  assert.equal(followupGap.safe_to_defer, true);
  assert.equal(judgment.decision.status, 'passed_with_residual_risk');
  assert.equal(judgment.followups.some((followup) => followup.source === 'gate:judgment_axis_public_contract'), true);
});

test('SGJ-S-003b senior gap judgment treats accepted blocker waivers as residual followups', () => {
  const judgment = buildSeniorGapJudgment({
    story: { story_id: 'story-sgj-waived-blocker', title: 'Accepted blocker waiver senior gap judgment' },
    prContext: {
      story_source: { story_id: 'story-sgj-waived-blocker', acceptance_criteria: [] },
      engineering_judgment: {
        judgment_axes: [{
          axis: 'release_ops',
          status: 'active_blocked',
          confidence: 'high',
          decision_question: 'Is release operations evidence complete?',
          acceptable_followup: 'No operator action is required and release operations are documented.',
          missing_evidence: ['release_note', 'rollback_instruction'],
          blocker_waiver: {
            decision_id: 'decision-sgj-waived-release-ops',
            reason: 'Release operations are documented and no operator action is required.',
            artifact: 'docs/specs/story-sgj-waived-blocker-spec.md'
          },
          matched_evidence: [{ artifact: 'docs/specs/story-sgj-waived-blocker-spec.md' }]
        }]
      },
      gate_dag: { nodes: [] }
    },
    gateStatus: {
      ready_for_pr_create: true,
      unresolved_gates: [],
      critical_unresolved_gates: []
    },
    evidenceReuse: { status: 'hit', evidence_key: 'evk_waived_blocker' }
  });

  const waivedGap = judgment.gaps.find((gap) => gap.id === 'gap:judgment_axis:release_ops');
  assert.ok(waivedGap);
  assert.equal(waivedGap.safe_to_defer, true);
  assert.equal(waivedGap.severity, 'minor');
  assert.equal(waivedGap.decision_effect, 'accepted_followup');
  assert.equal(judgment.decision.status, 'passed_with_residual_risk');
  assert.equal(judgment.decision.blocking_gap_count, 0);
  assert.equal(judgment.followups.some((followup) => followup.source === 'gate:judgment_axis_release_ops'), true);
  assert.equal(buildSeniorGapJudgmentGate(judgment).status, 'passed');
});

test('SGJ-S-004 pr prepare writes senior gap judgment artifact and gate', async () => {
  const repo = await makeRepo();
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: baseline']);
  await git(repo, ['switch', '-c', 'feature/senior-gap']);
  await writeSeniorGapFixture(repo);
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'docs: add senior gap judgment story']);

  const result = await preparePullRequest(repo, {
    storyId: 'story-senior-gap',
    baseRef: 'main',
    branchName: 'feature/senior-gap',
    evidenceDepth: 'summary'
  });

  const artifactPath = result.artifacts.senior_gap_judgment;
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
  assert.equal(artifact.model, 'vibepro-senior-gap-judgment-v1');
  assert.ok(artifact.ideal_state);
  assert.ok(artifact.current_state);
  assert.ok(Array.isArray(artifact.gaps));
  assert.ok(artifact.decision);
  assert.ok(Array.isArray(artifact.residual_risks));
  assert.ok(Array.isArray(artifact.followups));
  assert.equal(artifact.cost_context.token_accounting.status, 'not_collected_in_pr_prepare');
  assert.equal(typeof artifact.current_state.traceability_clause_coverage?.clause_count, 'number');
  assert.equal(result.artifacts.senior_gap_judgment, artifactPath);
  const gate = result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:senior_gap_judgment');
  assert.ok(gate);
  assert.equal(gate.type, 'senior_gap_judgment_gate');
  assert.equal(gate.status, 'needs_review');
  assert.equal(artifact.gaps.some((gap) => gap.kind === 'unresolved_required_gate'), true);
  assert.equal(result.preparation.pr_context.gate_dag.summary.senior_gap_judgment.status, artifact.decision.status);
  assert.equal(result.preparation.pr_context.senior_gap_judgment.model, 'vibepro-senior-gap-judgment-v1');
  // This fixture repo has no docs/architecture/target-model.json: the wiring must not throw
  // and must report the absence explicitly rather than fabricating a target architecture.
  assert.equal(artifact.ideal_state.target_architecture, null);
});

test('SGJ-S-005 pr prepare wires the adjudicated target model and conformance summary into ideal_state', async () => {
  const repo = await makeRepo();
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: baseline']);
  await git(repo, ['switch', '-c', 'feature/senior-gap-target-model']);
  await writeSeniorGapFixture(repo);
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await writeFile(
    path.join(repo, 'docs', 'architecture', 'target-model.json'),
    `${JSON.stringify({
      schema_version: '0.1.0',
      status: 'adjudicated',
      adjudicated_by: 'sato_keigo',
      adjudicated_at: '2026-07-22',
      rules: [
        { id: 'R-001', statement: 'workspace-infra は他のどのモジュールにも依存しない', status: 'adjudicated' },
        { id: 'R-002', statement: 'cli 以外のモジュールは cli に依存しない', status: 'adjudicated' }
      ],
      scope_roots: ['src'],
      modules: [{ name: 'story', responsibility: 'story', paths: ['src/story.js'] }],
      allowed_dependencies: { story: [] },
      budgets: { default_max_file_lines: 1500, file_line_baseline: {} }
    }, null, 2)}\n`
  );
  await mkdir(path.join(repo, '.vibepro', 'architecture', 'conformance'), { recursive: true });
  await writeFile(
    path.join(repo, '.vibepro', 'architecture', 'conformance', 'conformance.json'),
    `${JSON.stringify({
      schema_version: '0.1.0',
      mode: 'dry_run',
      summary: { violation_count: 3, undeclared_dependency_count: 2, budget_violation_count: 1 }
    }, null, 2)}\n`
  );
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'docs: add senior gap judgment story with adjudicated target model']);

  const result = await preparePullRequest(repo, {
    storyId: 'story-senior-gap',
    baseRef: 'main',
    branchName: 'feature/senior-gap-target-model',
    evidenceDepth: 'summary'
  });

  const artifactPath = result.artifacts.senior_gap_judgment;
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
  const targetArchitecture = artifact.ideal_state.target_architecture;
  assert.ok(targetArchitecture);
  assert.equal(targetArchitecture.model_path, 'docs/architecture/target-model.json');
  assert.equal(targetArchitecture.status, 'adjudicated');
  assert.equal(targetArchitecture.adjudicated_rules.length, 2);
  assert.equal(targetArchitecture.adjudicated_rules[0].id, 'R-001');
  assert.equal(targetArchitecture.conformance_summary.violation_count, 3);
  // The dry-run conformance check must stay non-blocking: adding target_architecture context
  // must not by itself turn the senior gap judgment gate into a block.
  assert.notEqual(result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:senior_gap_judgment').status, 'block');
});

test('SGJ-S-006 pr prepare degrades a malformed target-model.json to target_architecture=null instead of crashing', async () => {
  // docs/architecture/target-model.json is unconditionally read by every Story's pr prepare, not
  // just architecture-related ones, and is a hand-edited singleton file outside this Story's own
  // review/write boundary. A transient authoring mistake there must not turn into a repo-wide
  // pr prepare outage: this must degrade the same way a missing file does (SGJ-S-004), not throw.
  const repo = await makeRepo();
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: baseline']);
  await git(repo, ['switch', '-c', 'feature/senior-gap-malformed-target-model']);
  await writeSeniorGapFixture(repo);
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await writeFile(
    path.join(repo, 'docs', 'architecture', 'target-model.json'),
    '{ "schema_version": "0.1.0", "status": "adjudicated", not valid json'
  );
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'docs: add senior gap judgment story with a malformed target model']);

  const result = await preparePullRequest(repo, {
    storyId: 'story-senior-gap',
    baseRef: 'main',
    branchName: 'feature/senior-gap-malformed-target-model',
    evidenceDepth: 'summary'
  });

  const artifactPath = result.artifacts.senior_gap_judgment;
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
  assert.equal(artifact.ideal_state.target_architecture, null);
  assert.notEqual(result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:senior_gap_judgment').status, 'block');
});

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-sgj-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await git(repo, ['config', 'user.name', 'Test User']);
  await writeFile(path.join(repo, '.gitignore'), '.vibepro/\n');
  await writeFile(path.join(repo, 'README.md'), '# Fixture\n');
  return repo;
}

async function writeSeniorGapFixture(repo) {
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'architecture', 'senior-gap.md'), `---
title: Senior Gap
status: active
---

# Senior Gap

The architecture records alternatives, compatibility impact, rollback plan, boundary, and accepted followups.
`);
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-senior-gap.md'), `---
story_id: story-senior-gap
title: Senior gap judgment fixture
status: active
parent_design: senior-gap
architecture_docs:
  - docs/architecture/senior-gap.md
spec_docs:
  - docs/specs/senior-gap.md
---

# Story

VibePro should expose senior gap judgment evidence.

## Acceptance Criteria

- SGJ-AC-001 pr prepare writes senior-gap-judgment.json.
- SGJ-AC-002 the artifact contains ideal_state current_state gaps decision residual_risks followups cost_context.
- SGJ-AC-003 the Gate DAG includes gate:senior_gap_judgment.
- SGJ-AC-005 missing token telemetry remains unavailable instead of zero.
`);
  await writeFile(path.join(repo, 'docs', 'specs', 'senior-gap.md'), `---
title: Senior Gap Spec
status: active
parent_design: senior-gap
---

# Spec

## Invariants

- SGJ-INV-002: Senior Gap Judgment contains ideal_state current_state gaps decision residual_risks followups cost_context.
`);
  await writeFile(path.join(repo, 'design-ssot.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    model: 'vibepro-design-ssot-registry-v1',
    design_roots: [{
      id: 'senior-gap',
      title: 'Senior Gap',
      root_doc: 'docs/architecture/senior-gap.md',
      required_child_kinds: ['story', 'spec'],
      children: {
        story: ['docs/management/stories/active/story-senior-gap.md'],
        spec: ['docs/specs/senior-gap.md']
      }
    }]
  }, null, 2)}\n`);
}

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}
