import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getCanonicalAuditDir, promoteCanonicalAuditArtifacts } from '../src/canonical-audit.js';

const STORY_ID = 'story-canonical-decision-revisions';
const TRACE_ID = `dt_${'a'.repeat(64)}`;
const TRACE_SOURCE_REF = `tsr_${'d'.repeat(64)}`;
const REVISION_A = 'b'.repeat(64);
const REVISION_B = 'c'.repeat(64);

function ledgerFor(revisionFingerprint, parentRevisionFingerprint = null) {
  return {
    schema_version: '0.1.0',
    artifact_path: `.vibepro/pr/${STORY_ID}/decision-outcome-ledger.json`,
    artifact_digest: `digest-${revisionFingerprint}`,
    traces: [{
      decision_trace_id: TRACE_ID,
      trace_source_ref: TRACE_SOURCE_REF,
      parent_revision_fingerprint: parentRevisionFingerprint,
      revision_fingerprint: revisionFingerprint,
      delivery: { status: revisionFingerprint === REVISION_B ? 'merged' : 'pending' },
      downstream_outcome: { status: 'not_observed' }
    }]
  };
}

test('canonical promotion retains an earlier decision revision when a later revision is promoted', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-canonical-decision-revisions-'));
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  const ledgerPath = path.join(prDir, 'decision-outcome-ledger.json');
  await mkdir(prDir, { recursive: true });

  await writeFile(ledgerPath, `${JSON.stringify(ledgerFor(REVISION_A), null, 2)}\n`);
  await promoteCanonicalAuditArtifacts(root, { storyId: STORY_ID, now: '2026-07-15T00:00:00.000Z' });

  await writeFile(ledgerPath, `${JSON.stringify(ledgerFor(REVISION_B, REVISION_A), null, 2)}\n`);
  await promoteCanonicalAuditArtifacts(root, { storyId: STORY_ID, now: '2026-07-15T00:01:00.000Z' });

  const revisionDir = path.join(
    getCanonicalAuditDir(root, STORY_ID),
    'decision-outcomes',
    `trace-${TRACE_ID}`
  );
  const files = (await readdir(revisionDir)).sort();
  assert.deepEqual(files, [`${REVISION_A}.json`, `${REVISION_B}.json`]);

  const revisions = await Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(revisionDir, file), 'utf8'))));
  assert.equal(revisions[0].revision_fingerprint, REVISION_A);
  assert.equal(revisions[1].parent_revision_fingerprint, REVISION_A);
  assert.equal(revisions[1].trace.delivery.status, 'merged');
});
