import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { buildScanCoverage, describeScanStatus, resolveScanConclusiveness } from '../../src/scan-status.js';
import { renderFlowDesignReport, scanFlowDesign } from '../../src/flow-design-scanner.js';
import { scanNetworkContracts } from '../../src/network-contract-scanner.js';
import { analyzeRegressionRisk } from '../../src/regression-risk-scanner.js';

const execFileAsync = promisify(execFile);

async function makeRepo(files = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-sic-e2e-'));
  for (const [relative, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(repo, relative)), { recursive: true });
    await writeFile(path.join(repo, relative), content, 'utf8');
  }
  return repo;
}

const UI_STORY = { story_id: 'story-sic-e2e', title: '登録画面のUI導線を改善する', view: 'user' };
const BACKEND_STORY = { story_id: 'story-sic-e2e', title: '集計バッチの再計算', view: 'dev' };

// story-vibepro-scanner-inconclusive-coverage ac:1
test('SIC-E2E-001 story-vibepro-scanner-inconclusive-coverage ac:1 conclusiveness helper separates the three states', () => {
  // `resolveScanConclusiveness` は、走査0件かつ適用対象なら `inconclusive`、走査0件かつ適用外なら `not_applicable`、走査1件以上かつfindingsなしなら `pass` を返す
  assert.equal(resolveScanConclusiveness({ scannedCount: 0, applicable: true }).status, 'inconclusive');
  assert.equal(resolveScanConclusiveness({ scannedCount: 0, applicable: false }).status, 'not_applicable');
  // 走査1件以上はヘルパーが上書きせず（null）、findingsなしの既存判定がpassを返す
  assert.equal(resolveScanConclusiveness({ scannedCount: 3, applicable: true }).status, null);
});

// story-vibepro-scanner-inconclusive-coverage ac:2
// story-vibepro-scanner-inconclusive-coverage S-001
// story-vibepro-scanner-inconclusive-coverage S-002
test('SIC-E2E-002 story-vibepro-scanner-inconclusive-coverage ac:2 zero-file flow design scans never report pass', async () => {
  // flow-design-scannerはUI走査0件のとき `pass` を返さない: UI storyなら既存critical finding（FLOW-NO-UI-CODE）による `block` を維持し、非UI storyなら理由付き `not_applicable` になる
  // When the flow design scanner walks its UI roots and discovers zero files for a UI story, the pre-existing blocking verdict driven by the FLOW-NO-UI-CODE critical finding is preserved (block, never pass); the inconclusive vocabulary applies only when no findings force a stronger status.
  const empty = await makeRepo({ 'README.md': '# fixture\n' });
  const uiResult = await scanFlowDesign(empty, { story: UI_STORY });
  // UI storyの0件は既存critical finding（FLOW-NO-UI-CODE）のblock判定が優先され、passには決してならない
  assert.equal(uiResult.status, 'block');
  assert.notEqual(uiResult.status, 'pass');
  assert.ok(uiResult.value_alignment_hits.some((hit) => hit.id === 'FLOW-NO-UI-CODE'));

  // When the flow design scanner discovers zero files for a non-UI story, the result status transitions to not_applicable with an explicit reason instead of a silent pass.
  const backendResult = await scanFlowDesign(empty, { story: BACKEND_STORY });
  assert.equal(backendResult.status, 'not_applicable');
  assert.ok(backendResult.reason.length > 0);
  assert.equal(backendResult.value_alignment_hits.some((hit) => hit.id === 'FLOW-NO-UI-CODE'), false);
});

// story-vibepro-scanner-inconclusive-coverage ac:3
test('SIC-E2E-003 story-vibepro-scanner-inconclusive-coverage ac:3 scan coverage carries walked roots and counts', async () => {
  // flow-design-scannerの結果に走査root一覧と発見ファイル数を含む `scan_coverage` が入る
  const empty = await makeRepo({ 'README.md': '# fixture\n' });
  const result = await scanFlowDesign(empty, { story: UI_STORY });
  assert.equal(result.scan_coverage.scanned_count, 0);
  assert.ok(result.scan_coverage.roots.includes('app'));
  assert.deepEqual(buildScanCoverage({ scannedCount: 2, roots: ['app'] }), { scanned_count: 2, roots: ['app'] });
});

// story-vibepro-scanner-inconclusive-coverage ac:4
// story-vibepro-scanner-inconclusive-coverage S-003
test('SIC-E2E-004 story-vibepro-scanner-inconclusive-coverage ac:4 conclusive scans keep the pre-existing pass verdict', async () => {
  // UIファイルを1件以上走査しfindingsが無い場合は従来どおり `pass` になる（既存挙動の回帰なし）
  // When at least one UI file is scanned and no findings accumulate, the flow design scanner status remains pass exactly as before, so conclusive repositories see no behavior change.
  const repo = await makeRepo({ 'app/clean/page.tsx': 'export default function Page() { return null; }\n' });
  const result = await scanFlowDesign(repo, { story: UI_STORY });
  assert.equal(result.summary.scanned_ui_files, 1);
  assert.equal(result.status, 'pass');
  assert.equal(result.scan_coverage.scanned_count, 1);
});

// story-vibepro-scanner-inconclusive-coverage ac:5
// story-vibepro-scanner-inconclusive-coverage S-004
test('SIC-E2E-005 story-vibepro-scanner-inconclusive-coverage ac:5 network contract keeps block with candidates and goes inconclusive without them', async () => {
  // network-contract-scannerは候補ファイル走査0件のとき `inconclusive` になり、client呼び出し欠落の既存 `block` 判定は変わらない
  // When the network contract scanner examines zero candidate files the status transitions to inconclusive, while the existing block verdict for missing routes with candidates present is unchanged.
  const empty = await makeRepo({ 'README.md': '# fixture\n' });
  const inconclusive = await scanNetworkContracts(empty, { changedFiles: [] });
  assert.equal(inconclusive.status, 'inconclusive');
  assert.equal(inconclusive.scan_coverage.scanned_count, 0);

  const missingRoute = await makeRepo({
    'src/page.tsx': "export async function load() { return fetch('/api/detail'); }\n"
  });
  const blocked = await scanNetworkContracts(missingRoute, { changedFiles: [{ path: 'src/page.tsx' }] });
  assert.equal(blocked.status, 'block');
  assert.ok(blocked.missing_routes.length > 0);
});

// story-vibepro-scanner-inconclusive-coverage ac:6
// story-vibepro-scanner-inconclusive-coverage S-005
test('SIC-E2E-006 story-vibepro-scanner-inconclusive-coverage ac:6 regression risk with zero scored modules is inconclusive', () => {
  // regression-risk-scannerはcall graphで評価可能なmodule（scored modules）が0件のとき `inconclusive` になる
  // When the regression risk scanner has zero scored modules to evaluate, the status transitions to inconclusive instead of pass.
  const noCalls = analyzeRegressionRisk({ nodes: [{ id: 'a', kind: 'module', path: 'src/a.js' }], edges: [] }, {});
  assert.equal(noCalls.status, 'inconclusive');

  const scored = analyzeRegressionRisk({
    nodes: [
      { id: 'a', kind: 'module', path: 'src/a.js' },
      { id: 'b', kind: 'module', path: 'src/b.js' }
    ],
    edges: [{ from: 'a', to: 'b', kind: 'calls' }]
  }, {});
  assert.notEqual(scored.status, 'inconclusive');
});

// story-vibepro-scanner-inconclusive-coverage ac:7
test('SIC-E2E-007 story-vibepro-scanner-inconclusive-coverage ac:7 summary rendering distinguishes inconclusive from pass', async () => {
  // story diagnoseのsummary表示はinconclusiveをpassと区別し「検査対象を発見できなかった」ことを明示する
  assert.match(describeScanStatus('inconclusive'), /検査対象を発見できなかった/);
  assert.match(describeScanStatus('inconclusive'), /合格ではない/);
  assert.equal(describeScanStatus('pass'), 'pass');
  const empty = await makeRepo({ 'README.md': '# fixture\n' });
  const flow = await scanFlowDesign(empty, { story: BACKEND_STORY });
  const report = renderFlowDesignReport({ runId: 'sic-e2e', flowDesign: flow });
  assert.match(report, /not_applicable（このスキャナの対象外）/);
  assert.match(describeScanStatus('not_applicable'), /対象外/);
});

// story-vibepro-scanner-inconclusive-coverage ac:8
test('SIC-E2E-008 story-vibepro-scanner-inconclusive-coverage ac:8 inconclusive stays outside unresolved gate aggregation', async () => {
  // inconclusiveはgate_dagのunresolved集計に入らず、既存のready判定を変えない（非ブロッキング）
  // unresolved集計の正本（isUnresolvedGateStatusの列挙）にinconclusive/not_applicableが含まれないことを実ソースで検証する
  const prManagerSource = await readFile(path.resolve('src/pr-manager.js'), 'utf8');
  const unresolvedBlock = prManagerSource.match(/function isUnresolvedGateStatus\(status\) \{[\s\S]*?\n\}/)[0];
  assert.equal(unresolvedBlock.includes("'inconclusive'"), false);
  assert.equal(unresolvedBlock.includes("'not_applicable'"), false);
  const ledgerSource = await readFile(path.resolve('src/gate-outcome-ledger.js'), 'utf8');
  const ledgerList = ledgerSource.match(/UNRESOLVED_STATUSES[\s\S]*?\]/)[0];
  assert.equal(ledgerList.includes("'inconclusive'"), false);
});

// story-vibepro-scanner-inconclusive-coverage ac:9
test('SIC-E2E-009 story-vibepro-scanner-inconclusive-coverage ac:9 pre-existing scanner suites pass unchanged', async () => {
  // 既存テストが全てpassし、Next.js規約リポジトリの走査結果（pass/fail/block）は変化しない
  // 既存スキャナ回帰suiteを子プロセスで実実行して検証する（Next.js規約の走査結果はSIC-E2E-004/005のpass/block維持アサーションが直接担保）
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_OPTIONS;
  const { stdout } = await execFileAsync(process.execPath, ['--test', '--test-reporter=spec', 'test/regression-risk-scanner.test.js'], { cwd: path.resolve('.'), encoding: 'utf8', env: childEnv });
  assert.match(stdout, /fail 0/);
});

// story-vibepro-scanner-inconclusive-coverage ac:10
test('SIC-E2E-010 story-vibepro-scanner-inconclusive-coverage ac:10 the unit suite covers every required category and executes green', async () => {
  // テストは「3状態の分離」「UI story 0件のinconclusive+critical維持」「非UI story 0件のnot_applicable」「走査ありpassの回帰」「network/regressionの0件inconclusive」「表示の区別」を含む
  const unitSuite = await readFile(path.resolve('test/scan-status.test.js'), 'utf8');
  for (const testId of ['SCAN-S-001', 'SCAN-S-002', 'SCAN-S-003', 'SCAN-S-004', 'SCAN-S-005', 'SCAN-S-006', 'SCAN-S-007']) {
    assert.ok(unitSuite.includes(testId), `${testId} must exist`);
  }
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_OPTIONS;
  const { stdout } = await execFileAsync(process.execPath, ['--test', '--test-reporter=spec', 'test/scan-status.test.js'], { cwd: path.resolve('.'), encoding: 'utf8', env: childEnv });
  assert.match(stdout, /pass 8/);
  assert.match(stdout, /fail 0/);
});

test('SIC-E2E-011 malformed scan inputs degrade without crashing (parse failure robustness)', async () => {
  // parse failure: malformed / json的に壊れた入力でもスキャナはthrowせずdegradeする
  const repo = await makeRepo({
    'app/broken/page.tsx': 'export default function( { unbalanced ((( " binary-ish',
    'src/client.ts': "const raw = '{ not json'; fetch('/api/x');\n"
  });
  const flow = await scanFlowDesign(repo, { story: UI_STORY });
  assert.ok(['pass', 'block', 'needs_review'].includes(flow.status) || flow.summary.scanned_ui_files > 0);
  const network = await scanNetworkContracts(repo, { changedFiles: [{ path: 'src/client.ts' }] });
  assert.ok(network.status.length > 0);
  const malformedGraph = analyzeRegressionRisk({ nodes: 'not-an-array', edges: null }, {});
  assert.ok(malformedGraph.status.length > 0);
});
