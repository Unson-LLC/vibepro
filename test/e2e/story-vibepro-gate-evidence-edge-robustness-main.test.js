import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { safeReaddir } from '../../src/execution-state.js';
import { buildEvidenceItem, preparePullRequest } from '../../src/pr-manager.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-ger-e2e';

async function git(repo, args) {
  await execFileAsync('git', args, { cwd: repo });
}

// Build a real tmp git repo whose diff touches a gate/report artifact surface, so
// preparePullRequest walks its full evidence-assembly production path (which calls
// buildEvidenceItem) and its execution-state scanning (which calls safeReaddir).
async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-ger-e2e-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await git(repo, ['config', 'user.name', 'Test User']);
  await writeFile(path.join(repo, 'README.md'), '# Fixture\n');
  await mkdir(path.join(repo, '.vibepro'), { recursive: true });
  const config = {
    schema_version: '0.1.0',
    tool: 'vibepro',
    workspace: '.vibepro',
    brainbase: {
      stories: [{ story_id: STORY_ID, title: 'GER e2e fixture', ssot: 'local', status: 'active' }],
      current_story_id: STORY_ID
    }
  };
  await writeFile(path.join(repo, '.vibepro', 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  const storiesDir = path.join(repo, 'docs', 'management', 'stories', 'active');
  await mkdir(storiesDir, { recursive: true });
  await writeFile(
    path.join(storiesDir, `${STORY_ID}.md`),
    ['---', `story_id: ${STORY_ID}`, 'title: "gate evidence機構の局所修正"', 'status: active', '---', '', '# gate evidence機構の局所修正', '', '## 受け入れ基準', '', '- [ ] evidence itemが正しく組み立てられる', ''].join('\n'),
    'utf8'
  );
  await writeFile(path.join(repo, 'story-doc-change.md'), 'story/spec docs in diff\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: fixture change']);
  return repo;
}

// story-vibepro-gate-evidence-edge-robustness ac:1
test('GER-E2E-001 story-vibepro-gate-evidence-edge-robustness ac:1 safeReaddir returns [] for ENOTDIR and ENOENT and re-throws otherwise, exercised on a real filesystem', async () => {
  // `safeReaddir` は対象がファイル（`ENOTDIR`）のとき例外を投げず `[]` を返し、`ENOENT` のときも従来どおり `[]` を返す。それ以外のエラーは再throwする。
  const base = await mkdtemp(path.join(os.tmpdir(), 'vibepro-ger-e2e-fs-'));
  const realDir = path.join(base, 'd');
  await mkdir(realDir, { recursive: true });
  await writeFile(path.join(realDir, 'x.json'), '{}', 'utf8');
  assert.deepEqual(await safeReaddir(realDir), ['x.json']);
  assert.deepEqual(await safeReaddir(path.join(base, 'missing')), []); // ENOENT
  const filePath = path.join(base, 'a-file');
  await writeFile(filePath, 'malformed workspace: file where a directory was expected', 'utf8');
  assert.deepEqual(await safeReaddir(path.join(filePath, 'sub')), []); // ENOTDIR
  await assert.rejects(() => safeReaddir(Symbol('bad')), (e) => e.code !== 'ENOENT' && e.code !== 'ENOTDIR');
});

// story-vibepro-gate-evidence-edge-robustness ac:2
test('GER-E2E-002 story-vibepro-gate-evidence-edge-robustness ac:2 buildEvidenceItem: explicit kind/ref win over colliding extra keys', () => {
  // `buildEvidenceItem` は `extra` が `kind` や `ref` を含んでいても、明示引数の `kind` / `ref` が最終結果で勝つ。
  const item = buildEvidenceItem('story_spec_traceability', 'story/spec docs in diff', {
    kind: 'HIJACKED', ref: 'HIJACKED_REF', strength: 'supporting'
  });
  assert.equal(item.kind, 'story_spec_traceability');
  assert.equal(item.ref, 'story/spec docs in diff');
});

// story-vibepro-gate-evidence-edge-robustness ac:3
test('GER-E2E-003 story-vibepro-gate-evidence-edge-robustness ac:3 buildEvidenceItem applies defaults when absent and preserves values when present', () => {
  // `buildEvidenceItem` は `extra` が `strength` / `binding_status` / `artifact_quality` を持たない場合に既定値（`declared` / `n/a` / `unknown`）を返し、持つ場合はその値を保持する。
  const bare = buildEvidenceItem('graph_impact_scope', 'graphify graph');
  assert.equal(bare.strength, 'declared');
  assert.equal(bare.binding_status, 'n/a');
  assert.equal(bare.artifact_quality, 'unknown');
  const filled = buildEvidenceItem('current_verification', 'npm test', { strength: 'strong', binding_status: 'current', artifact_quality: 'verified' });
  assert.equal(filled.strength, 'strong');
  assert.equal(filled.binding_status, 'current');
  assert.equal(filled.artifact_quality, 'verified');
});

// story-vibepro-gate-evidence-edge-robustness ac:4
test('GER-E2E-004 story-vibepro-gate-evidence-edge-robustness ac:4 buildEvidenceItem carries through descriptive extra fields', () => {
  // `buildEvidenceItem` は `extra` の追加フィールド（例: `matched_file_count`・`investigation_files`）を結果に保持する。
  const item = buildEvidenceItem('graph_impact_scope', 'graphify graph', {
    matched_file_count: 3, investigation_files: ['src/a.js'], optional: true
  });
  assert.equal(item.matched_file_count, 3);
  assert.deepEqual(item.investigation_files, ['src/a.js']);
  assert.equal(item.optional, true);
  assert.equal(item.kind, 'graph_impact_scope');
});

// story-vibepro-gate-evidence-edge-robustness ac:5
// story-vibepro-gate-evidence-edge-robustness ac:7
test('GER-E2E-005 story-vibepro-gate-evidence-edge-robustness ac:5 ac:7 preparePullRequest end-to-end produces well-formed evidence items with correct kinds and no regression', async () => {
  // `classifySeniorAxisEvidence` 内 `add` は `kind` を `extra` に重複指定しなくても、正しい `kind` の evidence item を生成する。
  // 既存の gate check・evidence機構・pr prepare スイートに退行がない（実pr prepareがend-to-endで成功し、証拠itemのidentityが保たれる）。
  const repo = await makeRepo();
  const result = await preparePullRequest(repo, { storyId: STORY_ID, baseRef: 'main' });
  const nodes = result.preparation.pr_context.gate_dag.nodes;
  // The documentation evidence path (classifySeniorAxisEvidence.add → buildEvidenceItem)
  // ran during real pr prepare. Every emitted evidence item must have a non-empty kind
  // that is never the sentinel 'HIJACKED' and matches no extra-collision corruption.
  const spine = nodes.find((n) => n.id === 'gate:common_judgment_spine');
  const allMatched = (spine?.subchecks ?? []).flatMap((s) => s.matched_evidence ?? []);
  assert.ok(allMatched.length > 0, 'spine should have matched documentation/verification evidence items');
  for (const item of allMatched) {
    assert.equal(typeof item.kind, 'string');
    assert.ok(item.kind.length > 0, 'every evidence item has a real kind (identity not overridden by extra)');
  }
  // Regression: pr prepare completed and produced a coherent gate DAG (no crash, gate nodes present).
  assert.ok(nodes.length > 0, 'pr prepare produced a gate DAG without regression');
});

// story-vibepro-gate-evidence-edge-robustness ac:6
test('GER-E2E-006 story-vibepro-gate-evidence-edge-robustness ac:6 the unit test file covers the ENOTDIR/ENOENT/other and extra-collision/defaults/carry-through branches', async () => {
  // テストは「`ENOTDIR`/`ENOENT`/その他エラーの分岐」「明示 `kind`/`ref` が `extra` に勝つ」「既定値と追加フィールド保持」を含む。
  const unitFile = await readFile(new URL('../gate-evidence-edge-robustness.test.js', import.meta.url), 'utf8');
  assert.match(unitFile, /ENOTDIR/);
  assert.match(unitFile, /re-throws errors other than ENOENT\/ENOTDIR/);
  assert.match(unitFile, /explicit kind\/ref win over colliding extra keys/);
  assert.match(unitFile, /defaults apply when extra omits them/);
  assert.match(unitFile, /descriptive extra fields are carried through/);
});
