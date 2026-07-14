import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { safeReaddir } from '../src/execution-state.js';
import { buildEvidenceItem } from '../src/pr-manager.js';

test('GER-S-001 safeReaddir treats ENOTDIR (file where a directory is expected) as no entries', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'vibepro-ger-'));
  // A real directory with entries: returns sorted entries.
  const realDir = path.join(base, 'real');
  await mkdir(realDir, { recursive: true });
  await writeFile(path.join(realDir, 'b.json'), '{}', 'utf8');
  await writeFile(path.join(realDir, 'a.json'), '{}', 'utf8');
  assert.deepEqual(await safeReaddir(realDir), ['a.json', 'b.json']);

  // ENOENT: missing path → [].
  assert.deepEqual(await safeReaddir(path.join(base, 'missing')), []);

  // ENOTDIR: a file exists where a directory was expected → [] (not a throw).
  const filePath = path.join(base, 'a-file');
  await writeFile(filePath, 'not a dir', 'utf8');
  assert.deepEqual(await safeReaddir(path.join(filePath, 'sub')), []);
});

test('GER-S-002 safeReaddir re-throws errors other than ENOENT/ENOTDIR', async () => {
  // Only ENOENT/ENOTDIR are swallowed; any other rejection must propagate. A Symbol
  // path makes readdir reject with a non-ENOENT/ENOTDIR error, exercising the throw.
  await assert.rejects(() => safeReaddir(Symbol('not-a-path')), (error) => {
    assert.notEqual(error.code, 'ENOENT');
    assert.notEqual(error.code, 'ENOTDIR');
    return true;
  });
});

test('GER-S-003 buildEvidenceItem: explicit kind/ref win over colliding extra keys', () => {
  const item = buildEvidenceItem('story_spec_traceability', 'story/spec docs in diff', {
    kind: 'HIJACKED_KIND',
    ref: 'HIJACKED_REF',
    strength: 'supporting',
    strength_reason: 'story docs present',
    binding_status: 'n/a',
    artifact_quality: 'story_doc'
  });
  assert.equal(item.kind, 'story_spec_traceability');
  assert.equal(item.ref, 'story/spec docs in diff');
  assert.equal(item.strength, 'supporting');
  assert.equal(item.artifact_quality, 'story_doc');
});

test('GER-S-004 buildEvidenceItem: defaults apply when extra omits them, and are kept when present', () => {
  const bare = buildEvidenceItem('graph_impact_scope', 'graphify graph');
  assert.equal(bare.strength, 'declared');
  assert.equal(bare.strength_reason, 'strength was not classified');
  assert.equal(bare.binding_status, 'n/a');
  assert.equal(bare.artifact_quality, 'unknown');

  const withValues = buildEvidenceItem('current_verification', 'npm test', {
    strength: 'strong',
    binding_status: 'current',
    artifact_quality: 'verified'
  });
  assert.equal(withValues.strength, 'strong');
  assert.equal(withValues.binding_status, 'current');
  assert.equal(withValues.artifact_quality, 'verified');
});

test('GER-S-005 buildEvidenceItem: descriptive extra fields are carried through', () => {
  const item = buildEvidenceItem('graph_impact_scope', 'graphify graph (3 changed / 114 related)', {
    strength: 'supporting',
    matched_file_count: 3,
    related_file_count: 114,
    investigation_files: ['src/a.js', 'src/b.js'],
    optional: true
  });
  assert.equal(item.matched_file_count, 3);
  assert.equal(item.related_file_count, 114);
  assert.deepEqual(item.investigation_files, ['src/a.js', 'src/b.js']);
  assert.equal(item.optional, true);
  // and identity/defaults still correct
  assert.equal(item.kind, 'graph_impact_scope');
  assert.equal(item.strength, 'supporting');
});
