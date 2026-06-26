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
        coverage_summary: { weakly_mapped_count: 0, unmapped_count: 0 }
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
  assert.equal(judgment.cost_context.token_accounting.status, 'not_collected_in_pr_prepare');
  assert.equal(judgment.cost_context.elapsed_time_accounting.status, 'not_collected_in_pr_prepare');
  const gate = buildSeniorGapJudgmentGate(judgment, { artifact: '.vibepro/pr/story-sgj/senior-gap-judgment.json' });
  assert.equal(gate.status, 'passed');
  assert.equal(gate.residual_risk_count, 1);
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
  assert.equal(result.artifacts.senior_gap_judgment, artifactPath);
  const gate = result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:senior_gap_judgment');
  assert.ok(gate);
  assert.equal(gate.type, 'senior_gap_judgment_gate');
  assert.equal(gate.status, 'needs_review');
  assert.equal(artifact.gaps.some((gap) => gap.kind === 'unresolved_required_gate'), true);
  assert.equal(result.preparation.pr_context.gate_dag.summary.senior_gap_judgment.status, artifact.decision.status);
  assert.equal(result.preparation.pr_context.senior_gap_judgment.model, 'vibepro-senior-gap-judgment-v1');
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
