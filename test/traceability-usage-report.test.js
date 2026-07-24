import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getGateOutcomeLedgerPath } from '../src/gate-outcome-ledger.js';
import { createUsageReport, renderUsageReport } from '../src/usage-report.js';

function storyDoc(storyId, status = 'active') {
  return `---\nstory_id: ${storyId}\ntitle: ${storyId}\nstatus: ${status}\n---\n\n# ${storyId}\n`;
}

function traceabilityArtifact(storyId, lifecycle, source = 'trace_backfill', evidence = [], coverageSummary = null) {
  return JSON.stringify({
    schema_version: '0.1.0',
    story_id: storyId,
    story_doc_path: `docs/management/stories/active/${storyId}.md`,
    source,
    lifecycle,
    evidence,
    ...(coverageSummary ? { coverage_summary: coverageSummary } : {}),
    created_at: '2026-06-12T00:00:00.000Z',
    updated_at: '2026-06-12T00:00:00.000Z'
  }, null, 2);
}

async function setupReportRepo(stories) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-trace-report-'));
  const storyDir = path.join(root, 'docs', 'management', 'stories', 'active');
  await mkdir(storyDir, { recursive: true });
  for (const story of stories) {
    await writeFile(path.join(storyDir, `${story.story_id}.md`), storyDoc(story.story_id, story.status ?? 'active'));
    if (story.traceability) {
      const prDir = path.join(root, '.vibepro', 'pr', story.story_id);
      await mkdir(prDir, { recursive: true });
      await writeFile(
        path.join(prDir, 'traceability.json'),
        traceabilityArtifact(
          story.story_id,
          story.traceability.lifecycle,
          story.traceability.source,
          story.traceability.evidence ?? [],
          story.traceability.coverage_summary ?? null
        )
      );
    }
    if (story.prepare) {
      const prDir = path.join(root, '.vibepro', 'pr', story.story_id);
      await mkdir(prDir, { recursive: true });
      await writeFile(path.join(prDir, 'pr-prepare.json'), JSON.stringify({
        schema_version: '0.1.0',
        created_at: '2026-06-12T00:00:00.000Z',
        story: { story_id: story.story_id }
      }, null, 2));
    }
  }
  return root;
}

function findStory(report, storyId) {
  return report.stories.find((story) => story.story_id === storyId);
}

function missingGaps(story) {
  return story.traceability_gaps.filter((gap) => gap.kind === 'traceability_missing_pr_artifact');
}

test('skeleton alone does not clear the gap', async () => {
  const root = await setupReportRepo([
    { story_id: 'story-skeleton-only', traceability: { lifecycle: 'unknown' } }
  ]);
  const report = await createUsageReport(root);
  const story = findStory(report, 'story-skeleton-only');
  assert.equal(missingGaps(story).length, 1, 'unknown lifecycle skeleton must keep the gap');
});

test('story without any artifact keeps the gap (existing behavior)', async () => {
  const root = await setupReportRepo([
    { story_id: 'story-no-artifacts' }
  ]);
  const report = await createUsageReport(root);
  const story = findStory(report, 'story-no-artifacts');
  assert.equal(missingGaps(story).length, 1);
});

test('declared and merged_outside states surface as separate signals', async () => {
  const root = await setupReportRepo([
    { story_id: 'story-declared', traceability: { lifecycle: 'declared_not_started', source: 'story_add' } },
    {
      story_id: 'story-merged-noevidence',
      traceability: {
        lifecycle: 'merged_without_vibepro_evidence',
        evidence: [{ type: 'git_log', ref: 'abc123', summary: 'feat: implement story-merged-noevidence' }]
      }
    },
    {
      story_id: 'story-worktree-evidence',
      traceability: {
        lifecycle: 'evidence_in_other_worktree',
        evidence: [{ type: 'worktree_artifact', ref: '/tmp/other/.vibepro/pr/story-worktree-evidence/pr-prepare.json', summary: 'found in linked worktree' }]
      }
    },
    { story_id: 'story-still-gap' }
  ]);
  const report = await createUsageReport(root);

  const declared = findStory(report, 'story-declared');
  assert.equal(missingGaps(declared).length, 0, 'declared_not_started must not be a gap');
  assert.equal(declared.declared_unstarted, true);

  const merged = findStory(report, 'story-merged-noevidence');
  assert.equal(missingGaps(merged).length, 0, 'merged_without_vibepro_evidence must not be a gap');
  assert.equal(merged.merged_without_vibepro_evidence, true);

  const worktree = findStory(report, 'story-worktree-evidence');
  assert.equal(missingGaps(worktree).length, 0, 'evidence_in_other_worktree must not be a gap');
  assert.equal(worktree.evidence_in_other_worktree, true);

  const stillGap = findStory(report, 'story-still-gap');
  assert.equal(missingGaps(stillGap).length, 1);

  assert.equal(report.value_signals.declared_unstarted_story_count, 1);
  assert.equal(report.value_signals.merged_without_vibepro_evidence_story_count, 1);
  assert.equal(report.value_signals.evidence_in_other_worktree_story_count, 1);
  assert.equal(report.value_signals.traceability_gap_count, 1);
});

test('prepared story is unaffected by traceability accounting', async () => {
  const root = await setupReportRepo([
    { story_id: 'story-prepared', prepare: true, traceability: { lifecycle: 'in_progress', source: 'pr_prepare' } }
  ]);
  const report = await createUsageReport(root);
  const story = findStory(report, 'story-prepared');
  assert.equal(missingGaps(story).length, 0);
  assert.equal(story.prepared, true);
});

test('traceability clause coverage gaps surface in usage report', async () => {
  const root = await setupReportRepo([
    {
      story_id: 'story-weak-clause-map',
      prepare: true,
      traceability: {
        lifecycle: 'in_progress',
        source: 'pr_prepare',
        coverage_summary: {
          clause_count: 2,
          acceptance_criteria_count: 2,
          scenario_clause_count: 0,
          mapped_count: 1,
          weakly_mapped_count: 1,
          unmapped_count: 0,
          examples: [{ id: 'AC-2', status: 'weakly_mapped', source_text: 'Evidence is clause specific.' }]
        }
      }
    }
  ]);
  const report = await createUsageReport(root);
  const story = findStory(report, 'story-weak-clause-map');
  assert.equal(story.traceability_clause_coverage.weakly_mapped_count, 1);
  assert.equal(report.value_signals.traceability_clause_mapping_incomplete_count, 1);
  assert.equal(
    story.traceability_gaps.some((gap) => gap.kind === 'traceability_clause_mapping_incomplete'),
    true
  );
  assert.match(renderUsageReport(report), /clause_traceability=mapped=1\/weak=1\/unmapped=0/);
  assert.match(renderUsageReport(report), /traceability_clause_mapping_incomplete/);
  assert.match(renderUsageReport(report), /AC-2:weakly_mapped:Evidence is clause specific\./);
});

test('CAA-VERIFY-002 canonical audit bundle makes main-only usage report audit merged story artifacts', async () => {
  const root = await setupReportRepo([
    { story_id: 'story-canonical-audit' }
  ]);
  const auditDir = path.join(root, 'docs', 'management', 'audit-artifacts', 'story-canonical-audit');
  await mkdir(path.join(auditDir, 'pr'), { recursive: true });
  await writeFile(path.join(auditDir, 'audit-bundle.json'), JSON.stringify({
    schema_version: '0.1.0',
    story_id: 'story-canonical-audit',
    source: 'execute_merge',
    promoted_at: '2026-06-12T00:10:00.000Z',
    artifacts: [
      { kind: 'pr_prepare', canonical_path: 'docs/management/audit-artifacts/story-canonical-audit/pr/pr-prepare.json' },
      { kind: 'pr_merge', canonical_path: 'docs/management/audit-artifacts/story-canonical-audit/pr/pr-merge.json' }
    ]
  }, null, 2));
  await writeFile(path.join(auditDir, 'pr', 'pr-prepare.json'), JSON.stringify({
    schema_version: '0.1.0',
    created_at: '2026-06-12T00:00:00.000Z',
    story: { story_id: 'story-canonical-audit' },
    gate_status: { ready_for_pr_create: true, overall_status: 'ready_for_review' }
  }, null, 2));
  await writeFile(path.join(auditDir, 'pr', 'pr-merge.json'), JSON.stringify({
    schema_version: '0.1.0',
    created_at: '2026-06-12T00:05:00.000Z',
    story: { story_id: 'story-canonical-audit' },
    status: 'merged',
    merged_at: '2026-06-12T00:06:00.000Z'
  }, null, 2));

  const report = await createUsageReport(root);
  const story = findStory(report, 'story-canonical-audit');
  assert.equal(story.prepared, true);
  assert.equal(story.pr_merge_count, 1);
  assert.equal(missingGaps(story).length, 0);
  assert.equal(story.traceability_resolution.status, 'alternate_source_resolved');
  assert.equal(story.traceability_resolution.artifact_source, 'canonical_audit');
  assert.equal(story.artifact_sources.some((item) => item.source === 'canonical_audit' && item.kind === 'pr_merge'), true);
  assert.equal(report.artifact_counts.canonical_audit, 1);
  assert.equal(report.value_signals.traceability_gap_count, 0);
  assert.equal(report.value_signals.actual_missing_traceability_gap_count, 0);
  assert.equal(report.value_signals.alternate_source_resolved_traceability_count, 1);
  assert.match(renderUsageReport(report), /## Alternate Source Resolved\n\n- story-canonical-audit: source=canonical_audit/);
  assert.match(
    renderUsageReport(report),
    /artifact_source=pr_merge:canonical_audit:docs\/management\/audit-artifacts\/story-canonical-audit\/pr\/pr-merge\.json/
  );
});

test('compact canonical audit index resolves merged story and renders evidence cost', async () => {
  const root = await setupReportRepo([
    { story_id: 'story-compact-audit' }
  ]);
  const auditDir = path.join(root, 'docs', 'management', 'audit-artifacts', 'story-compact-audit');
  await mkdir(auditDir, { recursive: true });
  const costSummary = {
    schema_version: '0.1.0',
    evidence_depth: 'standard',
    artifact_lines: 2200,
    product_changed_lines: 20,
    artifact_code_ratio: 110,
    budget_status: 'exceeded',
    diff_stats_status: 'available',
    changed_lines: {
      status: 'available',
      buckets: {
        src: { files: 1, changed_lines: 8, unknown_files: 0, paths: ['src/canonical-audit.js'] },
        test: { files: 1, changed_lines: 4, unknown_files: 0, paths: ['test/canonical-audit.test.js'] },
        story_spec_architecture_docs: { files: 1, changed_lines: 6, unknown_files: 0, paths: ['docs/specs/vibepro-canonical-audit-diff-stats.md'] },
        audit_artifacts: { files: 1, changed_lines: 30, unknown_files: 0, paths: ['docs/management/audit-artifacts/story-x/audit-bundle.json'] },
        other: { files: 1, changed_lines: 2, unknown_files: 0, paths: ['README.md'] }
      }
    },
    token_accounting: { status: 'unavailable', total_tokens: null },
    elapsed_time_accounting: { status: 'unavailable', elapsed_ms: null }
  };
  const automationValueAudit = {
    schema_version: '0.1.0',
    artifact_kind: 'vibepro_automation_value_audit',
    story_id: 'story-compact-audit',
    status: 'partial',
    allocation: {
      implementation_changed_lines: 8,
      audit_evidence_changed_lines: 40
    },
    ratios: {
      automation_evidence_to_src: 5
    },
    findings: [
      { id: 'session_cost_unavailable', severity: 'needs_context' },
      { id: 'artifact_budget_exceeded', severity: 'cost_risk' },
      { id: 'evidence_heavy_relative_to_src', severity: 'cost_risk' }
    ]
  };
  await writeFile(path.join(auditDir, 'audit-index.json'), JSON.stringify({
    schema_version: '0.1.0',
    story_id: 'story-compact-audit',
    generated_at: '2026-06-23T00:10:00.000Z',
    evidence_depth: 'standard',
    budget_status: 'exceeded',
    cost_summary: costSummary,
    automation_value_audit: automationValueAudit,
    pr_prepare: {
      present: true,
      created_at: '2026-06-23T00:00:00.000Z',
      gate_status: { ready_for_pr_create: true, overall_status: 'ready_for_review' }
    },
    pr_create: {
      present: true,
      created_at: '2026-06-23T00:03:00.000Z',
      status: 'created',
      pr_url: 'https://github.com/example/repo/pull/2'
    },
    pr_merge: {
      present: true,
      summary: {
        status: 'merged',
        pr_url: 'https://github.com/example/repo/pull/2',
        merge_commit_sha: 'def456',
        merged_at: '2026-06-23T00:08:00.000Z'
      }
    },
    senior_gap_judgment: {
      present: true,
      status: 'passed_with_residual_risk',
      gap_count: 2,
      blocking_gap_count: 0,
      residual_risk_count: 2,
      followup_count: 1
    },
    traceability: { present: false },
    verification: { present: false },
    review: { summary_count: 0, result_count: 0, pass_count: 0, block_count: 0 },
    missing_artifacts: []
  }, null, 2));
  await writeFile(path.join(auditDir, 'audit-bundle.json'), JSON.stringify({
    schema_version: '0.1.0',
    story_id: 'story-compact-audit',
    source: 'execute_merge',
    promoted_at: '2026-06-23T00:10:00.000Z',
    evidence_depth: 'standard',
    handoff_replay_status: 'ready',
    cost_summary_ref: {
      source: 'docs/management/audit-artifacts/story-compact-audit/audit-index.json',
      pointer: '/cost_summary'
    },
    automation_value_audit_ref: {
      source: 'docs/management/audit-artifacts/story-compact-audit/audit-index.json',
      pointer: '/automation_value_audit'
    },
    replay_bundle: {
      compression: 'gzip',
      compressed_bytes: 512,
      expanded_bytes: 4096,
      expanded_line_count: 120,
      path: 'docs/management/audit-artifacts/story-compact-audit/audit-replay-bundle.json.gz'
    },
    artifacts: [
      { kind: 'audit_index', canonical_path: 'docs/management/audit-artifacts/story-compact-audit/audit-index.json' },
      { kind: 'compressed_replay_bundle', canonical_path: 'docs/management/audit-artifacts/story-compact-audit/audit-replay-bundle.json.gz' }
    ]
  }, null, 2));
  const ledgerPath = getGateOutcomeLedgerPath(root);
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await writeFile(ledgerPath, JSON.stringify({
    schema_version: '0.1.0',
    model: 'vibepro-gate-outcome-ledger-v3',
    entries: [
      {
        story_id: 'story-compact-audit',
        gate_id: 'gate:runtime_cost',
        outcome: 'evidence_added',
        resolved_at: '2026-06-23T00:06:00.000Z'
      }
    ]
  }, null, 2));

  const report = await createUsageReport(root);
  const story = findStory(report, 'story-compact-audit');
  assert.equal(story.prepared, true);
  assert.equal(story.pr_created, true);
  assert.equal(story.pr_merge_count, 1);
  assert.equal(missingGaps(story).length, 0);
  assert.equal(story.traceability_resolution.status, 'alternate_source_resolved');
  assert.equal(story.traceability_resolution.artifact_source, 'canonical_audit_summary');
  assert.equal(story.senior_gap_judgment.present, true);
  assert.equal(story.senior_gap_judgment.status, 'passed_with_residual_risk');
  assert.equal(story.senior_gap_judgment.residual_risk_count, 2);
  assert.equal(story.senior_gap_judgment.followup_count, 1);
  assert.equal(report.evidence_cost.budget_exceeded_count, 1);
  assert.equal(report.evidence_cost.token_accounting_status, 'unavailable');
  assert.equal(report.evidence_cost.elapsed_time_accounting_status, 'unavailable');
  assert.equal(report.evidence_cost.total_artifact_lines, 2200);
  assert.equal(report.gate_outcomes.distributions[0].gate_id, 'gate:runtime_cost');
  assert.equal(report.gate_outcomes.distributions[0].outcomes.evidence_added, 1);
  assert.equal(report.evidence_cost.by_story[0].replay_bundle.compressed_bytes, 512);
  assert.equal(report.evidence_cost.by_story[0].automation_value_audit.status, 'partial');
  assert.equal(report.evidence_cost.by_story[0].automation_value_audit.implementation_changed_lines, 8);
  assert.equal(report.evidence_cost.by_story[0].automation_value_audit.audit_evidence_changed_lines, 40);
  assert.deepEqual(report.evidence_cost.by_story[0].automation_value_audit.finding_ids, [
    'session_cost_unavailable',
    'artifact_budget_exceeded',
    'evidence_heavy_relative_to_src'
  ]);
  assert.equal(report.value_signals.senior_gap_judgment_story_count, 1);
  assert.equal(report.value_signals.senior_gap_residual_risk_story_count, 1);
  assert.match(renderUsageReport(report), /## 証跡コスト/);
  assert.match(renderUsageReport(report), /story-compact-audit: depth=standard budget=exceeded/);
  assert.match(renderUsageReport(report), /diff=available src=8 test=4 docs=6 audit=30 other=2/);
  assert.match(renderUsageReport(report), /automation_value=partial:impl=8:audit_evidence=40:evidence_to_src=5:findings=session_cost_unavailable,artifact_budget_exceeded,evidence_heavy_relative_to_src/);
  assert.match(renderUsageReport(report), /replay_bundle=gzip:compressed_bytes=512:expanded_lines=120/);
  assert.match(renderUsageReport(report), /tokens=未確認/);
  assert.match(renderUsageReport(report), /elapsed_ms=未確認/);
});

test('blocked canonical handoff replay is surfaced as a fake-value signal', async () => {
  const root = await setupReportRepo([
    { story_id: 'story-blocked-handoff' }
  ]);
  const auditDir = path.join(root, 'docs', 'management', 'audit-artifacts', 'story-blocked-handoff');
  await mkdir(path.join(auditDir, 'pr'), { recursive: true });
  await writeFile(path.join(auditDir, 'audit-bundle.json'), JSON.stringify({
    schema_version: '0.1.0',
    story_id: 'story-blocked-handoff',
    source: 'execute_merge',
    promoted_at: '2026-06-22T00:10:00.000Z',
    handoff_replay_status: 'blocked',
    handoff_replay: {
      status: 'blocked',
      unresolved_reference_count: 1
    },
    unresolved_references: [
      { source: '.vibepro/reviews/story-blocked-handoff/gate/subagent.json', reason: 'source_missing' }
    ],
    artifacts: [
      { kind: 'pr_merge', canonical_path: 'docs/management/audit-artifacts/story-blocked-handoff/pr/pr-merge.json' }
    ]
  }, null, 2));
  await writeFile(path.join(auditDir, 'pr', 'pr-merge.json'), JSON.stringify({
    schema_version: '0.1.0',
    story_id: 'story-blocked-handoff',
    status: 'merged',
    merged_at: '2026-06-22T00:11:00.000Z'
  }, null, 2));

  const report = await createUsageReport(root);
  const story = findStory(report, 'story-blocked-handoff');
  assert.equal(story.handoff_replay_status, 'blocked');
  assert.equal(report.value_signals.canonical_handoff_replay_blocked_count, 1);
  assert.equal(
    report.value_signals.traceability_gaps.some((gap) => gap.kind === 'canonical_handoff_replay_blocked'),
    true
  );
  assert.match(renderUsageReport(report), /canonical_handoff_replay_blocked/);
});

test('manifest merge record resolves traceability when pr artifacts are absent', async () => {
  const root = await setupReportRepo([
    { story_id: 'story-manifest-merge' }
  ]);
  const manifestDir = path.join(root, '.vibepro');
  await mkdir(manifestDir, { recursive: true });
  await writeFile(path.join(manifestDir, 'vibepro-manifest.json'), JSON.stringify({
    schema_version: '0.1.0',
    tool: 'vibepro',
    pr_merges: {
      'story-manifest-merge': {
        latest_merge: '.vibepro/pr/story-manifest-merge/pr-merge.json',
        latest_pr_url: 'https://github.com/Unson-LLC/vibepro/pull/123',
        latest_merge_commit: 'abc123manifest',
        latest_merged_at: '2026-06-19T00:00:00.000Z',
        latest_dry_run: false
      }
    }
  }, null, 2));

  const report = await createUsageReport(root);
  const story = findStory(report, 'story-manifest-merge');
  assert.equal(story.pr_merge_count, 1);
  assert.equal(story.latest_merge_status, 'merged');
  assert.equal(story.latest_merged_at, '2026-06-19T00:00:00.000Z');
  assert.equal(story.traceability_resolution.status, 'alternate_source_resolved');
  assert.equal(story.traceability_resolution.artifact_source, 'manifest');
  assert.equal(missingGaps(story).length, 0);
  assert.equal(story.artifact_sources.some((item) => item.kind === 'pr_merge' && item.source === 'manifest'), true);
  assert.match(renderUsageReport(report), /## Alternate Source Resolved\n\n- story-manifest-merge: source=manifest/);
  assert.match(
    renderUsageReport(report),
    /artifact_source=pr_merge:manifest:\.vibepro\/vibepro-manifest\.json#pr_merges\.story-manifest-merge/
  );
});

test('local pr-merge wins over manifest merge record without double counting', async () => {
  const root = await setupReportRepo([
    { story_id: 'story-local-manifest-dupe' }
  ]);
  const localDir = path.join(root, '.vibepro', 'pr', 'story-local-manifest-dupe');
  await mkdir(localDir, { recursive: true });
  await writeFile(path.join(localDir, 'pr-merge.json'), JSON.stringify({
    schema_version: '0.1.0',
    story_id: 'story-local-manifest-dupe',
    story: { story_id: 'story-local-manifest-dupe' },
    status: 'merged',
    base: 'develop',
    delivery: { status: 'merged', observed: true },
    reconciliation: { status: 'reconciliation_required', reasons: ['gate_not_ready'] },
    merged_at: '2026-06-19T00:20:00.000Z',
    pr: { url: 'https://github.com/Unson-LLC/vibepro/pull/124' }
  }, null, 2));
  await writeFile(path.join(root, '.vibepro', 'vibepro-manifest.json'), JSON.stringify({
    schema_version: '0.1.0',
    tool: 'vibepro',
    pr_merges: {
      'story-local-manifest-dupe': {
        latest_merge: '.vibepro/pr/story-local-manifest-dupe/pr-merge.json',
        latest_pr_url: 'https://github.com/Unson-LLC/vibepro/pull/124',
        latest_merge_commit: 'abc123manifest',
        latest_merged_at: '2026-06-19T00:20:00.000Z',
        latest_dry_run: false
      }
    }
  }, null, 2));

  const report = await createUsageReport(root);
  const story = findStory(report, 'story-local-manifest-dupe');
  assert.equal(story.pr_merge_count, 1);
  assert.equal(story.latest_delivery_status, 'merged');
  assert.equal(story.latest_reconciliation_status, 'reconciliation_required');
  assert.deepEqual(story.latest_reconciliation_reasons, ['gate_not_ready']);
  assert.equal(story.blocked, true);
  assert.match(renderUsageReport(report), /delivery=merged reconciliation=reconciliation_required reconciliation_reasons=gate_not_ready/);
  assert.match(renderUsageReport(report), /reconciliation_action="vibepro pr prepare \. --story-id story-local-manifest-dupe --base develop && vibepro execute merge \. --story-id story-local-manifest-dupe --base develop --pr https:\/\/github\.com\/Unson-LLC\/vibepro\/pull\/124"/);
  assert.equal(story.traceability_resolution.status, 'local_resolved');
  assert.equal(story.traceability_resolution.artifact_source, 'local');
  assert.deepEqual(story.artifact_sources.filter((item) => item.kind === 'pr_merge').map((item) => item.source), ['local']);
  assert.equal(report.artifact_counts.pr, 1);
});

test('DRS-S-5 canonical recovery equivalence keeps execution-state sync recovery authoritative', async () => {
  const root = await setupReportRepo([
    { story_id: 'story-sync-recovery' }
  ]);
  const localDir = path.join(root, '.vibepro', 'pr', 'story-sync-recovery');
  await mkdir(localDir, { recursive: true });
  const reconciliationAction = {
    status: 'required',
    reason: 'execution_state_sync_failed',
    commands: [
      'vibepro pr prepare . --story-id story-sync-recovery --base release/2026',
      'vibepro execute merge . --story-id story-sync-recovery --base release/2026 --pr https://github.com/Unson-LLC/vibepro/pull/205'
    ]
  };
  const recoveryCommand = 'vibepro execute reconcile . --story-id story-sync-recovery --base release/2026 --pr https://github.com/Unson-LLC/vibepro/pull/205';
  await writeFile(path.join(localDir, 'pr-merge.json'), JSON.stringify({
    schema_version: '0.1.0',
    story_id: 'story-sync-recovery',
    story: { story_id: 'story-sync-recovery' },
    status: 'merged_externally',
    base: 'release/2026',
    delivery: { status: 'merged_externally', observed: true },
    reconciliation: { status: 'reconciliation_required', reasons: ['execution_state_sync_failed'] },
    execution_state_sync: {
      status: 'failed',
      recovery_command: recoveryCommand
    },
    reconciliation_action: reconciliationAction,
    merged_at: '2026-07-18T00:20:00.000Z',
    pr: { url: 'https://github.com/Unson-LLC/vibepro/pull/205' }
  }, null, 2));

  const report = await createUsageReport(root);
  const story = findStory(report, 'story-sync-recovery');
  assert.equal(story.latest_reconciliation_action, 'vibepro execute reconcile . --story-id story-sync-recovery --base release/2026 --pr https://github.com/Unson-LLC/vibepro/pull/205');
  assert.match(renderUsageReport(report), /reconciliation_action="vibepro execute reconcile \. --story-id story-sync-recovery --base release\/2026 --pr https:\/\/github\.com\/Unson-LLC\/vibepro\/pull\/205"/);
  assert.doesNotMatch(renderUsageReport(report), /story-sync-recovery.*vibepro pr prepare/);

  const canonicalRoot = await setupReportRepo([{ story_id: 'story-sync-recovery' }]);
  const auditDir = path.join(canonicalRoot, 'docs', 'management', 'audit-artifacts', 'story-sync-recovery');
  await mkdir(auditDir, { recursive: true });
  await writeFile(path.join(auditDir, 'audit-index.json'), JSON.stringify({
    schema_version: '0.1.0',
    story_id: 'story-sync-recovery',
    generated_at: '2026-07-18T00:21:00.000Z',
    pr_prepare: { present: false },
    pr_create: { present: false },
    pr_merge: {
      present: true,
      summary: {
        status: 'merged_externally',
        base: 'release/2026',
        delivery: { status: 'merged_externally', observed: true },
        reconciliation: { status: 'reconciliation_required', reasons: ['execution_state_sync_failed'] },
        reconciliation_action: reconciliationAction,
        execution_state_sync: {
          status: 'failed',
          recovery_command: recoveryCommand
        },
        pr_url: 'https://github.com/Unson-LLC/vibepro/pull/205',
        merged_at: '2026-07-18T00:20:00.000Z'
      }
    },
    traceability: { present: false },
    verification: { present: false },
    review: { summary_count: 0, result_count: 0, pass_count: 0, block_count: 0 },
    missing_artifacts: []
  }, null, 2));
  await writeFile(path.join(auditDir, 'audit-bundle.json'), JSON.stringify({
    schema_version: '0.1.0',
    story_id: 'story-sync-recovery',
    source: 'execute_merge',
    promoted_at: '2026-07-18T00:21:00.000Z',
    handoff_replay_status: 'ready',
    artifacts: [{ kind: 'audit_index', canonical_path: 'docs/management/audit-artifacts/story-sync-recovery/audit-index.json' }]
  }, null, 2));

  const canonicalStory = findStory(await createUsageReport(canonicalRoot), 'story-sync-recovery');
  assert.equal(canonicalStory.latest_reconciliation_action, story.latest_reconciliation_action);
});

test('DRS-S-5 execution-state sync failure without a recovery command fails closed', async () => {
  const root = await setupReportRepo([
    { story_id: 'story-sync-recovery-missing' }
  ]);
  const localDir = path.join(root, '.vibepro', 'pr', 'story-sync-recovery-missing');
  await mkdir(localDir, { recursive: true });
  await writeFile(path.join(localDir, 'pr-merge.json'), JSON.stringify({
    schema_version: '0.1.0',
    story_id: 'story-sync-recovery-missing',
    story: { story_id: 'story-sync-recovery-missing' },
    status: 'merged_externally',
    base: 'main',
    delivery: { status: 'merged_externally', observed: true },
    reconciliation: { status: 'reconciliation_required', reasons: ['execution_state_sync_failed'] },
    execution_state_sync: {
      status: 'failed',
      recovery_command: null
    },
    reconciliation_action: {
      status: 'required',
      commands: [
        'vibepro pr prepare . --story-id story-sync-recovery-missing --base main',
        'vibepro execute merge . --story-id story-sync-recovery-missing --base main'
      ]
    },
    merged_at: '2026-07-18T00:20:00.000Z'
  }, null, 2));

  const story = findStory(await createUsageReport(root), 'story-sync-recovery-missing');
  assert.equal(story.blocked, true);
  assert.equal(story.latest_reconciliation_action, null);
  assert.equal(story.latest_reconciliation_reasons.includes('execution_state_sync_recovery_command_missing'), true);
  assert.doesNotMatch(renderUsageReport(await createUsageReport(root)), /vibepro pr prepare|vibepro execute merge/);
});

test('DRS-S-2 contradictory unverified delivery and reconciled state fails closed', async () => {
  const root = await setupReportRepo([
    { story_id: 'story-contradictory-delivery' }
  ]);
  const localDir = path.join(root, '.vibepro', 'pr', 'story-contradictory-delivery');
  await mkdir(localDir, { recursive: true });
  await writeFile(path.join(localDir, 'pr-merge.json'), JSON.stringify({
    schema_version: '0.1.0',
    story_id: 'story-contradictory-delivery',
    story: { story_id: 'story-contradictory-delivery' },
    status: 'failed',
    base: 'main',
    delivery: { status: 'unverified', observed: false },
    reconciliation: { status: 'reconciled', reasons: [] },
    merged_at: '2026-07-18T00:20:00.000Z'
  }, null, 2));

  const report = await createUsageReport(root);
  const story = findStory(report, 'story-contradictory-delivery');
  assert.equal(story.blocked, true);
  assert.equal(story.latest_reconciliation_status, 'blocked');
  assert.equal(story.latest_reconciliation_reasons.includes('delivery_unverified_reconciliation_reconciled'), true);
  assert.match(renderUsageReport(report), /delivery=unverified reconciliation=blocked reconciliation_reasons=delivery_unverified_reconciliation_reconciled/);
  assert.doesNotMatch(renderUsageReport(report), /vibepro pr prepare|vibepro execute merge/);
});

test('merged_externally delivery resolves traceability for active and completed stories', async () => {
  const stories = [
    { story_id: 'story-external-active', status: 'active' },
    { story_id: 'story-external-completed', status: 'completed' }
  ];
  const root = await setupReportRepo(stories);

  for (const story of stories) {
    const prDir = path.join(root, '.vibepro', 'pr', story.story_id);
    await mkdir(prDir, { recursive: true });
    await writeFile(path.join(prDir, 'pr-merge.json'), JSON.stringify({
      schema_version: '0.1.0',
      story_id: story.story_id,
      story: { story_id: story.story_id },
      status: 'merged_externally',
      base: 'main',
      delivery: { status: 'merged_externally', observed: true },
      reconciliation: { status: 'reconciled', reasons: [] },
      merged_at: '2026-07-18T00:00:00.000Z',
      pr: { url: `https://github.com/Unson-LLC/vibepro/pull/${story.status === 'active' ? 201 : 202}` }
    }, null, 2));
  }

  const report = await createUsageReport(root);
  for (const story of stories) {
    const usage = findStory(report, story.story_id);
    assert.equal(usage.latest_delivery_status, 'merged_externally');
    assert.equal(
      usage.traceability_gaps.some((gap) => gap.kind === 'traceability_stale_merge_artifact'),
      false,
      `${story.story_id} must accept canonical merged_externally delivery`
    );
  }
});

test('DRS-S-2 manifest-only fallback preserves explicitly unverified delivery', async () => {
  const root = await setupReportRepo([
    { story_id: 'story-manifest-unverified-delivery' }
  ]);
  const manifestDir = path.join(root, '.vibepro');
  await mkdir(manifestDir, { recursive: true });
  await writeFile(path.join(manifestDir, 'vibepro-manifest.json'), JSON.stringify({
    schema_version: '0.1.0',
    tool: 'vibepro',
    pr_merges: {
      'story-manifest-unverified-delivery': {
        latest_merge: '.vibepro/pr/story-manifest-unverified-delivery/pr-merge.json',
        latest_pr_url: 'https://github.com/Unson-LLC/vibepro/pull/126',
        latest_merge_commit: 'legacy-sha-must-not-win',
        latest_merged_at: '2026-06-19T00:30:00.000Z',
        latest_dry_run: false,
        latest_status: 'failed',
        latest_base: 'develop',
        latest_delivery: { status: 'unverified', observed: false },
        latest_reconciliation: { status: 'blocked', reasons: ['delivery_not_verified'] }
      }
    }
  }, null, 2));

  const report = await createUsageReport(root);
  const story = findStory(report, 'story-manifest-unverified-delivery');
  assert.equal(story.pr_merge_count, 1);
  assert.equal(story.latest_merge_status, 'failed');
  assert.equal(story.latest_delivery_status, 'unverified');
  assert.equal(story.latest_reconciliation_status, 'blocked');
  assert.deepEqual(story.latest_reconciliation_reasons, ['delivery_not_verified']);
  assert.match(renderUsageReport(report), /delivery=unverified reconciliation=blocked reconciliation_reasons=delivery_not_verified/);
  assert.match(renderUsageReport(report), /--base develop --pr https:\/\/github\.com\/Unson-LLC\/vibepro\/pull\/126/);
});

test('manifest dry-run merge record does not resolve traceability', async () => {
  const root = await setupReportRepo([
    { story_id: 'story-manifest-dry-run' }
  ]);
  const manifestDir = path.join(root, '.vibepro');
  await mkdir(manifestDir, { recursive: true });
  await writeFile(path.join(manifestDir, 'vibepro-manifest.json'), JSON.stringify({
    schema_version: '0.1.0',
    tool: 'vibepro',
    pr_merges: {
      'story-manifest-dry-run': {
        latest_merge: '.vibepro/pr/story-manifest-dry-run/pr-merge.json',
        latest_pr_url: 'https://github.com/Unson-LLC/vibepro/pull/125',
        latest_merge_commit: null,
        latest_merged_at: null,
        latest_dry_run: true
      }
    }
  }, null, 2));

  const report = await createUsageReport(root);
  const story = findStory(report, 'story-manifest-dry-run');
  assert.equal(story.pr_merge_count, 0);
  assert.equal(story.traceability_resolution.status, 'actual_missing');
  assert.equal(story.traceability_resolution.artifact_source, null);
  assert.equal(missingGaps(story).length, 1);
  assert.equal(report.artifact_counts.pr, 0);
});

test('malformed manifest does not resolve traceability or crash usage report', async () => {
  const root = await setupReportRepo([
    { story_id: 'story-malformed-manifest' }
  ]);
  const manifestDir = path.join(root, '.vibepro');
  await mkdir(manifestDir, { recursive: true });
  await writeFile(path.join(manifestDir, 'vibepro-manifest.json'), '{not valid json');

  const report = await createUsageReport(root);
  const story = findStory(report, 'story-malformed-manifest');
  assert.equal(story.pr_merge_count, 0);
  assert.equal(story.traceability_resolution.status, 'actual_missing');
  assert.equal(story.traceability_resolution.artifact_source, null);
  assert.equal(missingGaps(story).length, 1);
  assert.equal(report.artifact_counts.pr, 0);
  assert.equal(report.manifest_parse_failures.length, 1);
  assert.equal(report.manifest_parse_failures[0].kind, 'parse_failure');
  assert.equal(report.manifest_parse_failures[0].artifact, '.vibepro/vibepro-manifest.json');
  assert.match(renderUsageReport(report), /Manifest Parse Failures/);
  assert.match(renderUsageReport(report), /parse_failure: artifact=\.vibepro\/vibepro-manifest\.json/);
});

test('subagent ROI separates wall-clock time from concurrent agent consumption and agent system metrics', async () => {
  const root = await setupReportRepo([
    { story_id: 'story-agent-runtime-metrics' }
  ]);
  const reviewDir = path.join(root, '.vibepro', 'reviews', 'story-agent-runtime-metrics', 'gate');
  await mkdir(reviewDir, { recursive: true });
  await writeFile(path.join(reviewDir, 'review-summary.json'), JSON.stringify({
    story_id: 'story-agent-runtime-metrics',
    stage: 'gate',
    roles: [{
      role: 'gate_evidence',
      status: 'block',
      effective_status: 'block',
      findings: [{ severity: 'high', id: 'risk', detail: 'caught real risk' }],
      finding_dispositions: [{ finding_id: 'risk', disposition: 'accepted', resolved_by: ['commit abc123'] }],
      agent_usage: { input_tokens: 1000, output_tokens: 500, total_tokens: 1500 },
      agent_provenance: {
        system: 'codex',
        execution_mode: 'parallel_subagent',
        agent_id: 'codex-a',
        evidence_strength: 'strong',
        lifecycle: { agent_closed: true }
      },
      inspection: { inputs: ['src/usage-report.js'] },
      judgment_delta: ['pass -> block after reading artifacts'],
      lifecycle: {
        latest: {
          agent_id: 'codex-a',
          status: 'closed',
          effective_status: 'closed',
          started_at: '2026-06-02T00:00:00.000Z',
          closed_at: '2026-06-02T00:02:00.000Z',
          elapsed_ms: 120000
        }
      }
    }, {
      role: 'pr_split_scope',
      status: 'pass',
      effective_status: 'pass',
      findings: [],
      finding_dispositions: [],
      agent_usage: { input_tokens: 400, output_tokens: 100 },
      agent_provenance: {
        system: 'codex',
        execution_mode: 'parallel_subagent',
        agent_id: 'codex-b',
        evidence_strength: 'strong',
        lifecycle: { agent_closed: true }
      },
      inspection: { inputs: ['docs/specs/vibepro-usage-report.md'] },
      judgment_delta: ['unknown -> pass after checking scope'],
      lifecycle: {
        latest: {
          agent_id: 'codex-b',
          status: 'closed',
          effective_status: 'closed',
          started_at: '2026-06-02T00:00:30.000Z',
          closed_at: '2026-06-02T00:01:30.000Z',
          elapsed_ms: 60000
        }
      }
    }, {
      role: 'release_risk',
      status: 'needs_changes',
      effective_status: 'needs_changes',
      findings: [],
      finding_dispositions: [],
      agent_provenance: {
        system: 'claude_code',
        execution_mode: 'parallel_subagent',
        agent_id: 'claude-a',
        evidence_strength: 'strong',
        lifecycle: { agent_closed: true }
      },
      inspection: { inputs: ['.vibepro/reviews/story-agent-runtime-metrics/gate/review-summary.json'] },
      judgment_delta: ['pass -> needs_changes after checking release risk'],
      lifecycle: { latest: { agent_id: 'claude-a', status: 'closed', effective_status: 'closed' } }
    }],
    lifecycle: { entries: [] }
  }, null, 2));

  const report = await createUsageReport(root, { subagentRoi: true });
  assert.equal(report.subagent_roi.summary.total_agent_minutes, 3);
  assert.equal(report.subagent_roi.time_efficiency.wall_clock_minutes, 2);
  assert.equal(report.subagent_roi.time_efficiency.agent_consumption_minutes, 3);
  assert.equal(report.subagent_roi.time_efficiency.parallelism_factor, 1.5);
  assert.equal(report.subagent_roi.time_efficiency.interval_observed_review_count, 2);
  assert.equal(report.subagent_roi.time_efficiency.interval_missing_review_count, 1);
  assert.deepEqual(
    report.subagent_roi.time_efficiency.by_agent_system.map((item) => ({
      agent_system: item.agent_system,
      wall_clock_minutes: item.wall_clock_minutes,
      agent_consumption_minutes: item.agent_consumption_minutes,
      total_tokens: item.total_tokens,
      token_missing_review_count: item.token_missing_review_count
    })),
    [
      {
        agent_system: 'claude_code',
        wall_clock_minutes: null,
        agent_consumption_minutes: 0,
        total_tokens: null,
        token_missing_review_count: 1
      },
      {
        agent_system: 'codex',
        wall_clock_minutes: 2,
        agent_consumption_minutes: 3,
        total_tokens: 2000,
        token_missing_review_count: 0
      }
    ]
  );
  const rendered = renderUsageReport(report);
  assert.match(rendered, /wall_clock_minutes: 2/);
  assert.match(rendered, /agent_consumption_minutes: 3/);
  assert.match(rendered, /codex: reviews=2 wall_clock_minutes=2 agent_minutes=3 tokens=2000 missing_tokens=0/);
  assert.match(rendered, /claude_code: reviews=1 wall_clock_minutes=unknown agent_minutes=0 tokens=unknown missing_tokens=1/);
});

test('configured routes discover route-only PR authority and resolve gate and review artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-routed-usage-'));
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeFile(path.join(root, '.vibepro', 'config.json'), JSON.stringify({
    artifact_routing: { artifacts: {
      pr: { canonical: '.vibepro/routed/{story_id}-pr-prepare.json' },
      gate: { canonical: '.vibepro/gates/{story_id}.json' },
      review: { canonical: '.vibepro/routed-reviews/{story_id}' }
    } }
  }));
  await mkdir(path.join(root, '.vibepro', 'routed'), { recursive: true });
  await writeFile(path.join(root, '.vibepro', 'routed', 'story-route-only-pr-prepare.json'), JSON.stringify({
    story: { story_id: 'story-route-only' },
    created_at: '2026-06-12T00:00:00.000Z',
    gate_status: { overall_status: 'blocked', ready_for_pr_create: false }
  }));
  await mkdir(path.join(root, '.vibepro', 'gates'), { recursive: true });
  await writeFile(path.join(root, '.vibepro', 'gates', 'story-route-only.json'), JSON.stringify({
    story_id: 'story-route-only', generated_at: '2026-06-12T00:00:00.000Z', overall_status: 'blocked', nodes: []
  }));
  const reviewDir = path.join(root, '.vibepro', 'routed-reviews', 'story-route-only', 'gate');
  await mkdir(reviewDir, { recursive: true });
  await writeFile(path.join(reviewDir, 'review-summary.json'), JSON.stringify({
    story_id: 'story-route-only', updated_at: '2026-06-12T00:00:00.000Z', status: 'needs_changes', roles: []
  }));

  const report = await createUsageReport(root);
  const story = report.stories.find((item) => item.story_id === 'story-route-only');
  assert.equal(story?.prepared, true);
  assert.equal(story?.latest_gate_status, 'blocked');
  assert.ok(story?.artifacts.some((artifact) => artifact.includes('routed-reviews/story-route-only/gate/review-summary.json')));
});
