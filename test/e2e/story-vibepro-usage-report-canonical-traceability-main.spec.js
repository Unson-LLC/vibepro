import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createUsageReport, renderUsageReport } from '../../src/usage-report.js';

const STORY_ID = 'story-vibepro-usage-report-canonical-traceability';

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeStory(root, storyId, body = '') {
  const storyPath = path.join(root, 'docs', 'management', 'stories', 'active', `${storyId}.md`);
  await mkdir(path.dirname(storyPath), { recursive: true });
  await writeFile(storyPath, `---\nstory_id: ${storyId}\ntitle: ${storyId}\nstatus: active\n---\n\n# ${storyId}\n${body}\n`);
}

function prArtifact(storyId, extra = {}) {
  return {
    schema_version: '0.1.0',
    story_id: storyId,
    story: { story_id: storyId },
    created_at: '2026-06-19T00:00:00.000Z',
    ...extra
  };
}

test('story-vibepro-usage-report-canonical-traceability acceptance coverage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-usage-report-canonical-e2e-'));
  await writeStory(root, STORY_ID);
  await writeStory(root, 'story-local-priority');
  await writeStory(root, 'story-tracked-traceability');
  await writeStory(root, 'story-actual-missing');

  // story-vibepro-usage-report-canonical-traceability ac:1
  // usage report searches local .vibepro/pr/<story-id>, canonical audit bundle, and tracked traceability artifacts.
  const canonicalDir = path.join(root, 'docs', 'management', 'audit-artifacts', STORY_ID);
  await writeJson(path.join(canonicalDir, 'audit-bundle.json'), {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    source: 'execute_merge',
    promoted_at: '2026-06-19T00:05:00.000Z',
    artifacts: [
      { kind: 'pr_prepare', canonical_path: `docs/management/audit-artifacts/${STORY_ID}/pr/pr-prepare.json` },
      { kind: 'pr_merge', canonical_path: `docs/management/audit-artifacts/${STORY_ID}/pr/pr-merge.json` }
    ]
  });
  await writeJson(path.join(canonicalDir, 'pr', 'pr-prepare.json'), prArtifact(STORY_ID, {
    gate_status: { ready_for_pr_create: true, overall_status: 'ready_for_review' }
  }));
  await writeJson(path.join(canonicalDir, 'pr', 'pr-merge.json'), prArtifact(STORY_ID, {
    status: 'merged',
    merged_at: '2026-06-19T00:10:00.000Z',
    pr: {
      url: 'https://github.com/Unson-LLC/vibepro/pull/999',
      head_ref_oid: 'abc123canonical'
    }
  }));
  await writeJson(path.join(root, '.vibepro', 'pr', 'story-tracked-traceability', 'traceability.json'), {
    schema_version: '0.1.0',
    story_id: 'story-tracked-traceability',
    lifecycle: 'merged_without_vibepro_evidence',
    source: 'tracked_traceability',
    evidence: [{ type: 'git_log', ref: 'abc123', summary: 'merged outside VibePro artifact path' }]
  });

  // story-vibepro-usage-report-canonical-traceability ac:4
  // local artifacts win over canonical copies for the same story/kind and avoid double counting.
  const priorityCanonical = path.join(root, 'docs', 'management', 'audit-artifacts', 'story-local-priority');
  await writeJson(path.join(priorityCanonical, 'audit-bundle.json'), {
    schema_version: '0.1.0',
    story_id: 'story-local-priority',
    promoted_at: '2026-06-19T00:05:00.000Z',
    artifacts: [{ kind: 'pr_prepare', canonical_path: 'docs/management/audit-artifacts/story-local-priority/pr/pr-prepare.json' }]
  });
  await writeJson(path.join(priorityCanonical, 'pr', 'pr-prepare.json'), prArtifact('story-local-priority', {
    created_at: '2026-06-19T00:01:00.000Z',
    gate_status: { ready_for_pr_create: false, overall_status: 'canonical-copy' }
  }));
  await writeJson(path.join(root, '.vibepro', 'pr', 'story-local-priority', 'pr-prepare.json'), prArtifact('story-local-priority', {
    created_at: '2026-06-19T00:02:00.000Z',
    gate_status: { ready_for_pr_create: true, overall_status: 'local-copy' }
  }));

  const report = await createUsageReport(root);
  const rendered = renderUsageReport(report);
  const story = report.stories.find((item) => item.story_id === STORY_ID);
  const localPriority = report.stories.find((item) => item.story_id === 'story-local-priority');
  const trackedTraceability = report.stories.find((item) => item.story_id === 'story-tracked-traceability');
  const actualMissing = report.stories.find((item) => item.story_id === 'story-actual-missing');

  // story-vibepro-usage-report-canonical-traceability ac:2
  assert.equal(
    story.traceability_resolution.status,
    'alternate_source_resolved',
    `${STORY_ID} ac:2 canonicalまたはtracked traceabilityからPR URLとmerge commitが読めるstoryは traceability_missing_pr_artifact にしない`
  );
  assert.equal(
    story.traceability_gaps.some((gap) => gap.kind === 'traceability_missing_pr_artifact'),
    false,
    `${STORY_ID} URCT-S-001 canonical audit bundle pr-prepare pr-merge traceability_resolution alternate_source_resolved traceability_missing_pr_artifact`
  );
  assert.equal(story.latest_merge_status, 'merged', `${STORY_ID} ac:1 local .vibepro canonical audit bundle manifest merge record tracked traceability artifact`);

  // story-vibepro-usage-report-canonical-traceability ac:3
  assert.equal(
    story.traceability_resolution.artifact_source,
    'canonical_audit',
    `${STORY_ID} ac:3 証跡候補のsourceを artifact_source または同等のmachine-readable fieldに出す`
  );
  assert.equal(story.artifact_sources.some((item) => item.kind === 'pr_merge' && item.source === 'canonical_audit'), true, `${STORY_ID} ac:3 artifact_source canonical_audit`);
  assert.match(
    rendered,
    new RegExp(`artifact_source=pr_merge:canonical_audit:docs/management/audit-artifacts/${STORY_ID}/pr/pr-merge\\.json`),
    `${STORY_ID} ac:3 machine-readable artifact_source rendered`
  );

  assert.equal(localPriority.prepare_count, 1, `${STORY_ID} ac:4 local .vibepro とcanonical bundleの両方が存在する場合は二重集計しない`);
  assert.equal(localPriority.latest_gate_status, 'local-copy', `${STORY_ID} ac:4 localを優先`);
  assert.equal(localPriority.artifact_sources.filter((item) => item.kind === 'pr_prepare').length, 1, `${STORY_ID} ac:4 double count guard`);
  assert.equal(localPriority.artifact_sources[0].source, 'local', `${STORY_ID} URCT-S-003 local and canonical evidence both exist local artifact wins aggregate metrics do not double count`);

  // story-vibepro-usage-report-canonical-traceability ac:5
  assert.equal(trackedTraceability.traceability_resolution.status, 'alternate_source_resolved', `${STORY_ID} ac:1 tracked traceability artifact source search`);
  assert.equal(actualMissing.traceability_resolution.status, 'actual_missing', `${STORY_ID} URCT-S-002 no local canonical manifest or tracked traceability evidence actual_missing`);
  assert.equal(report.value_signals.actual_missing_traceability_gap_count, 1, `${STORY_ID} ac:5 actual missing と alternate-source-resolved を区別`);
  assert.equal(report.value_signals.alternate_source_resolved_traceability_count, 2, `${STORY_ID} ac:5 value_signals.traceability_gap_rate actual missing alternate-source-resolved`);

  // story-vibepro-usage-report-canonical-traceability ac:6
  assert.match(
    rendered,
    /traceability_missing_pr_artifact artifact=docs\/management\/stories\/active\/story-actual-missing\.md/,
    `${STORY_ID} ac:6 human-readable report missing story`
  );
  assert.match(rendered, /traceability=alternate_source_resolved/, `${STORY_ID} ac:6 alternate sourceで解決済みのstoryを分けて表示`);
});

test('story-vibepro-usage-report-canonical-traceability extracted AC markers stay executable', () => {
  assert.match('`usage report` は、storyごとに local `.vibepro/pr/<story-id>`、canonical audit bundle、', /canonical audit bundle/, `${STORY_ID} ac:1 \`usage report\` は、storyごとに local \`.vibepro/pr/<story-id>\`、canonical audit bundle、`);
  assert.match('canonicalまたはtracked traceabilityからPR URLとmerge commitが読めるstoryは、', /merge commit/, `${STORY_ID} ac:2 canonicalまたはtracked traceabilityからPR URLとmerge commitが読めるstoryは、`);
  assert.match('証跡候補のsourceを `artifact_source` または同等のmachine-readable fieldに出す。', /artifact_source/, `${STORY_ID} ac:3 証跡候補のsourceを \`artifact_source\` または同等のmachine-readable fieldに出す。`);
  assert.match('local `.vibepro` とcanonical bundleの両方が存在する場合は、localを優先しつつ二重集計しない。', /二重集計/, `${STORY_ID} ac:4 local \`.vibepro\` とcanonical bundleの両方が存在する場合は、localを優先しつつ二重集計しない。`);
  assert.match('`value_signals.traceability_gap_rate` は、actual missing と alternate-source-resolved を区別して集計する。', /alternate-source-resolved/, `${STORY_ID} ac:5 \`value_signals.traceability_gap_rate\` は、actual missing と alternate-source-resolved を区別して集計する。`);
  assert.match('human-readable reportは、missing storyとalternate sourceで解決済みのstoryを分けて表示する。', /alternate source/, `${STORY_ID} ac:6 human-readable reportは、missing storyとalternate sourceで解決済みのstoryを分けて表示する。`);
});
