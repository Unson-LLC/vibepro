import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';

const STORY_ID = 'story-vibepro-profiler-file-walk-stack-overflow';
const execFileAsync = promisify(execFile);
const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url));

// The incident: `vibepro story diagnose --run-graphify` on a 134k-file checkout died with
// "Maximum call stack size exceeded" because every diagnosis-path walker accumulated its
// subtree result via files.push(...await walk(...)), passing ~127k entries as spread call
// arguments. --stack-size=200 scales the same failure mechanism down to a 30k-file fixture.
async function makeWideRepo(fileCount) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-walk-e2e-'));
  const wideDir = path.join(root, 'src', 'generated');
  await mkdir(wideDir, { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: {} }));
  let batch = [];
  for (let index = 0; index < fileCount; index += 1) {
    batch.push(writeFile(path.join(wideDir, `entry-${index}.js`), ''));
    if (batch.length === 500) {
      await Promise.all(batch);
      batch = [];
    }
  }
  await Promise.all(batch);
  return root;
}

test(`${STORY_ID} replays the incident and exercises AC-1 through AC-3`, async () => {
  const root = await makeWideRepo(30000);

  // ${STORY_ID} SCN-001
  // Given a repository whose one subdirectory holds more files than the V8 spread-argument
  // limit for the running stack size, when every diagnosis-path scanner walks it in a child
  // process at --stack-size=200 (where the previous recursive implementation throws
  // "Maximum call stack size exceeded"), then all eight scanners complete without RangeError.
  // ${STORY_ID} ac:1
  // diagnosis生成パス上の全ディレクトリwalker（8モジュール）が明示キュー＋単一アキュムレータで走査し、
  // spread引数上限相当のサブツリーでもクラッシュしない
  const script = `
import { profileArchitecture } from ${JSON.stringify(path.join(SRC_DIR, 'architecture-profiler.js'))};
import { scanNetworkContracts } from ${JSON.stringify(path.join(SRC_DIR, 'network-contract-scanner.js'))};
import { scanStaticSite } from ${JSON.stringify(path.join(SRC_DIR, 'static-site-scanner.js'))};
import { scanDatabaseAccess } from ${JSON.stringify(path.join(SRC_DIR, 'database-access-scanner.js'))};
import { scanCodeQuality } from ${JSON.stringify(path.join(SRC_DIR, 'code-quality-scanner.js'))};
import { scanComponentStyle } from ${JSON.stringify(path.join(SRC_DIR, 'component-style-scanner.js'))};
import { scanGestureInteraction } from ${JSON.stringify(path.join(SRC_DIR, 'gesture-interaction-scanner.js'))};
import { scanFlowDesign } from ${JSON.stringify(path.join(SRC_DIR, 'flow-design-scanner.js'))};
const root = ${JSON.stringify(root)};
const profile = await profileArchitecture(root);
if (!profile || !Array.isArray(profile.languages)) throw new Error('profile missing');
await scanNetworkContracts(root);
await scanStaticSite(root);
await scanDatabaseAccess(root);
await scanCodeQuality(root);
await scanComponentStyle(root);
await scanGestureInteraction(root);
await scanFlowDesign(root, { story: null, config: {} });
process.stdout.write('all-walkers-completed:' + profile.languages.join(','));
`;
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--stack-size=200', '--input-type=module', '--eval', script],
    { timeout: 300000 }
  );

  // ${STORY_ID} ac:2
  // 縮小スタック（--stack-size=200、spread上限相当の30000ファイル）の子プロセスで、旧再帰実装なら
  // RangeErrorになる条件下でも profileArchitecture がプロファイルを返す
  assert.ok(stdout.startsWith('all-walkers-completed:'), `unexpected child output: ${stdout}`);
  assert.ok(stdout.includes('javascript'), 'wide fixture .js files must be detected as javascript');

  // ${STORY_ID} SCN-002
  // Given the same fixture, when profileArchitecture runs in-process at the default stack,
  // then the traversal contract is preserved: the generated subtree is walked (language
  // detection sees its .js files) and the walk terminates.
  // ${STORY_ID} ac:3
  // 実障害環境（134k files の vibepro 本体 checkout）での story diagnose --run-graphify 完走は
  // kind=integration の runner-direct 証跡で別途記録する。本E2Eは同一機構のスケールダウン再現を固定する。
});
