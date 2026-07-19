import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getCanonicalAuditDir, promoteCanonicalAuditArtifacts } from '../src/canonical-audit.js';
import { buildDecisionOutcomeLedger, reviseDecisionOutcomeLedger } from '../src/decision-outcome-ledger.js';

const STORY_ID = 'story-canonical-decision-revisions';
const HEAD_SHA = 'a'.repeat(40);

test('canonical promotion retains an earlier decision revision when a later revision is promoted', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-canonical-decision-revisions-'));
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  const ledgerPath = path.join(prDir, 'decision-outcome-ledger.json');
  await mkdir(prDir, { recursive: true });

  const initial = buildDecisionOutcomeLedger({
    storyId: STORY_ID,
    currentHeadSha: HEAD_SHA,
    artifactPath: `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`,
    createdAt: '2026-07-15T00:00:00.000Z',
    sources: [{
      source_kind: 'review_finding',
      source_ref: `.vibepro/reviews/${STORY_ID}/implementation/review-result.json`,
      native_id: 'canonical-revision',
      normalized_subject_key: 'finding:canonical-revision',
      finding: { id: 'canonical-revision', summary: 'preserve canonical revisions' },
      role: 'runtime_contract',
      stage: 'implementation'
    }],
    delivery: { story_id: STORY_ID, status: 'pr_created', pr: { number: 1, url: 'https://github.test/vibepro/pull/1' } }
  });
  const later = reviseDecisionOutcomeLedger(initial, {
    delivery: {
      story_id: STORY_ID,
      status: 'merged',
      pr: { number: 1, url: 'https://github.test/vibepro/pull/1' },
      merge: { sha: HEAD_SHA, status: 'merged', merged_at: '2026-07-15T00:01:00.000Z' }
    }
  });
  const traceId = initial.traces[0].decision_trace_id;
  const revisionA = initial.traces[0].revision_fingerprint;
  const revisionB = later.traces[0].revision_fingerprint;

  await writeFile(ledgerPath, `${JSON.stringify(initial, null, 2)}\n`);
  await promoteCanonicalAuditArtifacts(root, { storyId: STORY_ID, now: '2026-07-15T00:00:00.000Z' });

  await writeFile(ledgerPath, `${JSON.stringify(later, null, 2)}\n`);
  await promoteCanonicalAuditArtifacts(root, { storyId: STORY_ID, now: '2026-07-15T00:01:00.000Z' });

  const revisionDir = path.join(
    getCanonicalAuditDir(root, STORY_ID),
    'decision-outcomes',
    `trace-${traceId}`
  );
  const files = (await readdir(revisionDir)).sort();
  assert.deepEqual(files, [`${revisionA}.json`, `${revisionB}.json`].sort());

  const revisions = await Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(revisionDir, file), 'utf8'))));
  const initialRevision = revisions.find((revision) => revision.revision_fingerprint === revisionA);
  const laterRevision = revisions.find((revision) => revision.revision_fingerprint === revisionB);
  assert.equal(initialRevision.trace.delivery.status, 'pr_created');
  assert.equal(laterRevision.trace.delivery.status, 'merged');
  assert.notEqual(laterRevision.parent_revision_fingerprint, initialRevision.parent_revision_fingerprint);
});
