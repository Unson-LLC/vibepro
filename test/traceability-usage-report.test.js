import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createUsageReport, renderUsageReport } from '../src/usage-report.js';

function storyDoc(storyId, status = 'active') {
  return `---\nstory_id: ${storyId}\ntitle: ${storyId}\nstatus: ${status}\n---\n\n# ${storyId}\n`;
}

function traceabilityArtifact(storyId, lifecycle, source = 'trace_backfill', evidence = []) {
  return JSON.stringify({
    schema_version: '0.1.0',
    story_id: storyId,
    story_doc_path: `docs/management/stories/active/${storyId}.md`,
    source,
    lifecycle,
    evidence,
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
        traceabilityArtifact(story.story_id, story.traceability.lifecycle, story.traceability.source, story.traceability.evidence ?? [])
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
  assert.match(
    renderUsageReport(report),
    /artifact_source=pr_merge:canonical_audit:docs\/management\/audit-artifacts\/story-canonical-audit\/pr\/pr-merge\.json/
  );
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
  assert.equal(story.traceability_resolution.status, 'local_resolved');
  assert.equal(story.traceability_resolution.artifact_source, 'local');
  assert.deepEqual(story.artifact_sources.filter((item) => item.kind === 'pr_merge').map((item) => item.source), ['local']);
  assert.equal(report.artifact_counts.pr, 1);
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
