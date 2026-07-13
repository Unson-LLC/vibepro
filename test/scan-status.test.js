import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildScanCoverage, describeScanStatus, resolveScanConclusiveness } from '../src/scan-status.js';
import { scanFlowDesign } from '../src/flow-design-scanner.js';
import { scanNetworkContracts } from '../src/network-contract-scanner.js';
import { analyzeRegressionRisk } from '../src/regression-risk-scanner.js';

async function makeRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-scan-status-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  return root;
}

// SCAN-S-001: resolveScanConclusiveness separates the three states.
test('SCAN-S-001: resolveScanConclusiveness separates pass/inconclusive/not_applicable', () => {
  const zeroApplicable = resolveScanConclusiveness({ scannedCount: 0, applicable: true });
  assert.equal(zeroApplicable.status, 'inconclusive');
  assert.match(zeroApplicable.reason, /検査対象/);

  const zeroNotApplicable = resolveScanConclusiveness({ scannedCount: 0, applicable: false });
  assert.equal(zeroNotApplicable.status, 'not_applicable');
  assert.match(zeroNotApplicable.reason, /対象外|not_applicable|該当/);

  const scanned = resolveScanConclusiveness({ scannedCount: 3, applicable: true });
  assert.equal(scanned.status, null);
  assert.equal(scanned.reason, null);
});

// SCAN-S-002: UI story with zero scanned UI files must not read as a pass,
// and the existing FLOW-NO-UI-CODE critical finding must still fire.
test('SCAN-S-002: flow-design UI story with 0 UI files is inconclusive and keeps FLOW-NO-UI-CODE', async () => {
  const repo = await makeRepo();
  const result = await scanFlowDesign(repo, {
    story: { story_id: 'U-100', title: 'ユーザー登録フォームの導線を改善する', view: 'user' }
  });

  assert.equal(result.status, 'inconclusive');
  assert.equal(result.summary.scanned_ui_files, 0);
  assert.equal(
    result.value_alignment_hits.some((hit) => hit.id === 'FLOW-NO-UI-CODE' && hit.severity === 'Critical'),
    true
  );
});

// SCAN-S-003: non-UI story with zero scanned UI files is an explicit
// not_applicable, not a silent pass, and carries a reason.
test('SCAN-S-003: flow-design non-UI story with 0 UI files is not_applicable with a reason', async () => {
  const repo = await makeRepo();
  const result = await scanFlowDesign(repo, {
    story: { story_id: 'B-100', title: 'バッチ集計処理のリファクタリング', view: 'dev' }
  });

  assert.equal(result.status, 'not_applicable');
  assert.equal(result.summary.scanned_ui_files, 0);
  assert.ok(typeof result.reason === 'string' && result.reason.length > 0);
  assert.equal(
    result.value_alignment_hits.some((hit) => hit.id === 'FLOW-NO-UI-CODE'),
    false
  );
});

// SCAN-S-004: regression check — scanning at least one UI file with no
// findings must still resolve to 'pass' (no behavior change for the
// Next.js-convention case this scanner was built for).
test('SCAN-S-004: flow-design with scanned files and no findings still passes', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'clean'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'clean', 'page.tsx'), `
export default function CleanPage() {
  return <div>static content</div>;
}
`);

  const result = await scanFlowDesign(repo, {
    story: { story_id: 'B-101', title: 'バッチ集計処理のリファクタリング', view: 'dev' }
  });

  assert.equal(result.summary.scanned_ui_files, 1);
  assert.equal(result.status, 'pass');
});

// SCAN-S-005: scan_coverage is attached with the roots actually walked and
// the scanned-file count, in both the zero-file and non-zero-file cases.
test('SCAN-S-005: flow-design attaches scan_coverage with roots and scanned_count', async () => {
  const repoEmpty = await makeRepo();
  const empty = await scanFlowDesign(repoEmpty, {
    story: { story_id: 'B-102', title: 'バッチ集計処理のリファクタリング', view: 'dev' }
  });
  assert.deepEqual(empty.scan_coverage, buildScanCoverage({ scannedCount: 0, roots: empty.scan_coverage.roots }));
  assert.equal(empty.scan_coverage.scanned_count, 0);
  assert.ok(empty.scan_coverage.roots.includes('app'));

  const repoWithFiles = await makeRepo();
  await mkdir(path.join(repoWithFiles, 'src', 'app', 'clean'), { recursive: true });
  await writeFile(path.join(repoWithFiles, 'src', 'app', 'clean', 'page.tsx'), 'export default function P() { return <div>x</div>; }\n');
  const withFiles = await scanFlowDesign(repoWithFiles, {
    story: { story_id: 'B-103', title: 'バッチ集計処理のリファクタリング', view: 'dev' }
  });
  assert.equal(withFiles.scan_coverage.scanned_count, 1);
  assert.ok(withFiles.scan_coverage.roots.includes('app'));
});

// SCAN-S-006: network-contract-scanner: zero candidate files (no route dirs,
// no scannable source files) is inconclusive; with candidates present, a
// missing route still blocks as before.
test('SCAN-S-006: network-contract-scanner is inconclusive with 0 candidates, still blocks with candidates', async () => {
  const emptyRepo = await makeRepo();
  const emptyResult = await scanNetworkContracts(emptyRepo);
  assert.equal(emptyResult.status, 'inconclusive');
  assert.equal(emptyResult.scan_coverage.scanned_count, 0);
  assert.ok(typeof emptyResult.reason === 'string' && emptyResult.reason.length > 0);

  const repoWithMissingRoute = await makeRepo();
  await mkdir(path.join(repoWithMissingRoute, 'src', 'app', 'detail'), { recursive: true });
  await writeFile(path.join(repoWithMissingRoute, 'src', 'app', 'detail', 'page.tsx'), `
export async function loadDetail(id) {
  return fetch('/api/detail/' + id);
}
`);
  const blockResult = await scanNetworkContracts(repoWithMissingRoute);
  assert.equal(blockResult.status, 'block');
  assert.equal(blockResult.missing_routes.some((item) => item.api_path === '/api/detail'), true);
  assert.ok(blockResult.scan_coverage.scanned_count > 0);
});

// SCAN-S-007: regression-risk-scanner: zero scored modules (nothing the call
// graph could evaluate blast radius for) is inconclusive rather than a
// silent pass.
test('SCAN-S-007: regression-risk-scanner is inconclusive when zero modules are scored', () => {
  const structuralOnlyGraph = {
    nodes: [
      { id: 'x', source_file: 'src/x.js' },
      { id: 'y', source_file: 'src/y.js' }
    ],
    links: [{ relation: 'contains', source: 'y', target: 'x' }]
  };
  const result = analyzeRegressionRisk(structuralOnlyGraph);
  assert.equal(result.summary.scored_modules, 0);
  assert.equal(result.status, 'inconclusive');
  assert.ok(typeof result.reason === 'string' && result.reason.length > 0);
  assert.ok(Array.isArray(result.scan_coverage.roots));

  // Regression guard: normal call-graph scoring is unaffected.
  const node = (id, file) => ({ id, source_file: file });
  const call = (s, t) => ({ relation: 'calls', source: s, target: t });
  const scoredGraph = {
    nodes: [node('hub_fn', 'src/hub.js'), node('a_fn', 'src/a.js')],
    links: [call('a_fn', 'hub_fn')]
  };
  const scoredResult = analyzeRegressionRisk(scoredGraph, { highFanIn: 99, moderateFanIn: 99 });
  assert.equal(scoredResult.summary.scored_modules, 1);
  assert.equal(scoredResult.status, 'pass');
});

test('describeScanStatus renders inconclusive/not_applicable distinctly and passes through other statuses', () => {
  assert.match(describeScanStatus('inconclusive'), /inconclusive/);
  assert.match(describeScanStatus('inconclusive'), /検査対象/);
  assert.match(describeScanStatus('inconclusive', 'en'), /not a pass/);
  assert.match(describeScanStatus('not_applicable'), /not_applicable/);
  assert.equal(describeScanStatus('pass'), 'pass');
  assert.equal(describeScanStatus('block'), 'block');
});
