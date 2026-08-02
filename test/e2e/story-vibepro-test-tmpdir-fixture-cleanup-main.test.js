import '../support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const helperPath = path.join(repoRoot, 'test/support/scratch-tmpdir.js');
const helperUrl = pathToFileURL(helperPath).href;
const storyId = 'story-vibepro-test-tmpdir-fixture-cleanup';
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;

function statSyncSafe(target) {
  try {
    statSync(target);
    return true;
  } catch {
    return false;
  }
}

// story-vibepro-test-tmpdir-fixture-cleanup S-001
// Given a process that imports test/support/scratch-tmpdir.js, when that process (or any code it runs in-process, or any child process it spawns via inherited environment variables) calls mkdtemp against os.tmpdir(), then the resulting directory is created inside a per-process vibepro-scratch- root under the real $TMPDIR, and that scratch root no longer exists once the process exits normally.
test('story-vibepro-test-tmpdir-fixture-cleanup ac:1 a process importing the helper leaves no fixture behind in the real TMPDIR after normal exit', async () => {
  const realTmpDirBefore = os.tmpdir();
  const script = `
    import { mkdtemp } from 'node:fs/promises';
    import os from 'node:os';
    import path from 'node:path';
    import { scratchRoot } from '${helperUrl}';

    const created = await mkdtemp(path.join(os.tmpdir(), 'ac1-leak-check-'));
    process.stdout.write(JSON.stringify({ created, scratchRoot }));
  `;
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: repoRoot
  });
  const { created, scratchRoot } = JSON.parse(stdout.trim());

  assert.match(
    path.basename(scratchRoot),
    /^vibepro-scratch-/,
    'story-vibepro-test-tmpdir-fixture-cleanup ac:1 AC1: mkdtempを使う全テストファイルがscratch隔離ヘルパーをimportし、テストプロセス正常終了時にそのプロセスが作ったfixtureディレクトリがホストの実$TMPDIR直下に残らない。the scratch root uses the vibepro-scratch- prefix'
  );
  assert.equal(
    path.dirname(scratchRoot),
    realTmpDirBefore,
    'story-vibepro-test-tmpdir-fixture-cleanup ac:1 AC1: mkdtempを使う全テストファイルがscratch隔離ヘルパーをimportし、テストプロセス正常終了時にそのプロセスが作ったfixtureディレクトリがホストの実$TMPDIR直下に残らない。the scratch root itself is created directly under the real host TMPDIR'
  );
  assert.ok(
    created.startsWith(scratchRoot + path.sep),
    'story-vibepro-test-tmpdir-fixture-cleanup ac:1 AC1: mkdtempを使う全テストファイルがscratch隔離ヘルパーをimportし、テストプロセス正常終了時にそのプロセスが作ったfixtureディレクトリがホストの実$TMPDIR直下に残らない。the mkdtemp fixture landed inside the scratch root, not directly under the real TMPDIR'
  );

  // S-001: after the child process that imported the helper exits normally,
  // its scratch root (and everything mkdtemp'd inside it) must be gone from
  // the real, parent-visible $TMPDIR.
  assert.equal(
    statSyncSafe(scratchRoot),
    false,
    'story-vibepro-test-tmpdir-fixture-cleanup S-001 Given a process that imports test/support/scratch-tmpdir.js, when that process calls mkdtemp against os.tmpdir(), then the resulting directory is created inside a per-process vibepro-scratch- root under the real $TMPDIR, and that scratch root no longer exists once the process exits normally.'
  );
  assert.equal(
    readdirSync(realTmpDirBefore).includes(path.basename(scratchRoot)),
    false,
    'story-vibepro-test-tmpdir-fixture-cleanup ac:1 no fixture directory for this run remains visible in the real host TMPDIR listing after the process exited'
  );
});

test('story-vibepro-test-tmpdir-fixture-cleanup ac:2 isolation reaches src-code mkdtemp calls made in-process and mkdtemp calls made by a spawned child inheriting the environment', async () => {
  const script = `
    import { execFile } from 'node:child_process';
    import { mkdtemp } from 'node:fs/promises';
    import os from 'node:os';
    import path from 'node:path';
    import { promisify } from 'node:util';
    import { scratchRoot } from '${helperUrl}';

    const execFileAsync = promisify(execFile);

    // in-process mkdtemp, simulating an src-code call site reached from inside a test.
    const inProcessDir = await mkdtemp(path.join(os.tmpdir(), 'ac2-in-process-'));

    // spawned grandchild inherits process.env (and therefore TMPDIR) from this
    // process, which itself inherited it from the parent test process.
    const grandchildScript = "import { mkdtempSync } from 'node:fs'; import os from 'node:os'; import path from 'node:path'; process.stdout.write(mkdtempSync(path.join(os.tmpdir(), 'ac2-grandchild-')));";
    const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', grandchildScript]);

    process.stdout.write(JSON.stringify({ scratchRoot, inProcessDir, grandchildDir: stdout.trim() }));
  `;
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: repoRoot
  });
  const { scratchRoot, inProcessDir, grandchildDir } = JSON.parse(stdout.trim());

  assert.ok(
    inProcessDir.startsWith(scratchRoot + path.sep),
    'story-vibepro-test-tmpdir-fixture-cleanup ac:2 AC2: 隔離はテスト内で呼ばれるsrc本体のmkdtempと、テストがspawnする子プロセス(git等)にも及ぶ(環境変数継承で保証)。in-process mkdtemp call landed inside the importing process scratch root'
  );
  assert.ok(
    grandchildDir.startsWith(scratchRoot + path.sep),
    'story-vibepro-test-tmpdir-fixture-cleanup ac:2 AC2: 隔離はテスト内で呼ばれるsrc本体のmkdtempと、テストがspawnする子プロセス(git等)にも及ぶ(環境変数継承で保証)。spawned child process mkdtemp call also landed inside the same scratch root via inherited TMPDIR env vars'
  );
});

test('story-vibepro-test-tmpdir-fixture-cleanup ac:3 a conformance guard exists that fails offending test files that skip the helper import', async () => {
  const conformancePath = path.join(repoRoot, 'test/scratch-tmpdir-conformance.test.js');
  const conformanceSource = readFileSync(conformancePath, 'utf8');

  assert.ok(
    statSyncSafe(conformancePath),
    'story-vibepro-test-tmpdir-fixture-cleanup ac:3 AC3: 回帰ガード: mkdtemp/os.tmpdir()を参照するテストファイルがヘルパーをimportしていない場合に失敗するconformanceテストが存在する。the conformance guard file exists at test/scratch-tmpdir-conformance.test.js'
  );
  assert.ok(
    conformanceSource.includes('mkdtemp') && conformanceSource.includes('os.tmpdir('),
    'story-vibepro-test-tmpdir-fixture-cleanup ac:3 AC3: 回帰ガード: mkdtemp/os.tmpdir()を参照するテストファイルがヘルパーをimportしていない場合に失敗するconformanceテストが存在する。the guard scans test files for mkdtemp/os.tmpdir() references'
  );
  assert.ok(
    conformanceSource.includes('support/scratch-tmpdir.js'),
    'story-vibepro-test-tmpdir-fixture-cleanup ac:3 AC3: 回帰ガード: mkdtemp/os.tmpdir()を参照するテストファイルがヘルパーをimportしていない場合に失敗するconformanceテストが存在する。the guard requires the scratch-tmpdir helper import to be present'
  );

  const { stdout, stderr } = await execFileAsync(process.execPath, ['--test', 'test/scratch-tmpdir-conformance.test.js'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: childEnv
  });
  assert.doesNotMatch(
    stderr,
    /not ok/,
    'story-vibepro-test-tmpdir-fixture-cleanup ac:3 AC3: 回帰ガード: mkdtemp/os.tmpdir()を参照するテストファイルがヘルパーをimportしていない場合に失敗するconformanceテストが存在する。the conformance guard suite itself passes when run standalone'
  );
  assert.match(
    stdout,
    /pass 3/,
    'story-vibepro-test-tmpdir-fixture-cleanup ac:3 AC3: 回帰ガード: mkdtemp/os.tmpdir()を参照するテストファイルがヘルパーをimportしていない場合に失敗するconformanceテストが存在する。all three conformance guard assertions passed'
  );
});

// story-vibepro-test-tmpdir-fixture-cleanup S-002
// Given a vibepro-scratch- directory left in the real $TMPDIR with an mtime older than 24 hours (e.g. from a process killed before its exit handler ran), when any process imports test/support/scratch-tmpdir.js, then that stale directory is removed as part of the helper's self-healing sweep at import time.
test('story-vibepro-test-tmpdir-fixture-cleanup ac:4 a 24-hour-old stale scratch root is swept away when the helper is imported by any process', async () => {
  const realTmpDir = os.tmpdir();
  const staleDir = mkdtempSync(path.join(realTmpDir, 'vibepro-scratch-ac4-stale-'));
  mkdirSync(path.join(staleDir, 'nested'), { recursive: true });
  writeFileSync(path.join(staleDir, 'nested', 'marker.txt'), 'stale-from-a-killed-process');

  const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
  utimesSync(staleDir, twentyFiveHoursAgo, twentyFiveHoursAgo);

  try {
    const script = `import '${helperUrl}'; process.stdout.write('ok');`;
    await execFileAsync(process.execPath, ['--input-type=module', '-e', script], { cwd: repoRoot });

    assert.equal(
      statSyncSafe(staleDir),
      false,
      'story-vibepro-test-tmpdir-fixture-cleanup ac:4 AC4: クラッシュ残骸の自己回復: 24時間以上前のscratch root残骸をヘルパー起動時に掃除する。the 25-hour-old scratch root was removed by the self-healing sweep at helper import time'
    );
    assert.equal(
      statSyncSafe(staleDir),
      false,
      "story-vibepro-test-tmpdir-fixture-cleanup S-002 Given a vibepro-scratch- directory left in the real $TMPDIR with an mtime older than 24 hours (e.g. from a process killed before its exit handler ran), when any process imports test/support/scratch-tmpdir.js, then that stale directory is removed as part of the helper's self-healing sweep at import time."
    );
  } finally {
    try {
      rmSync(staleDir, { recursive: true, force: true });
    } catch {
      // Already removed by the sweep under test; ignore.
    }
  }
});

test('story-vibepro-test-tmpdir-fixture-cleanup ac:5 the existing test suite keeps passing after adding the scratch TMPDIR isolation helper', async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ['--test', 'test/autonomy-roadmap-rebaseline.test.js'],
    { cwd: repoRoot, encoding: 'utf8', env: childEnv }
  );

  assert.doesNotMatch(
    stderr,
    /not ok/,
    'story-vibepro-test-tmpdir-fixture-cleanup ac:5 AC5: 既存テストスイートが引き続き全件パスする。 a representative existing suite runs clean under stderr with the scratch helper active in this process'
  );
  assert.match(
    stdout,
    /pass 1/,
    'story-vibepro-test-tmpdir-fixture-cleanup ac:5 AC5: 既存テストスイートが引き続き全件パスする。 the representative existing suite still reports its one passing test'
  );
  assert.match(
    stdout,
    /fail 0/,
    'story-vibepro-test-tmpdir-fixture-cleanup ac:5 AC5: 既存テストスイートが引き続き全件パスする。 the representative existing suite reports zero failures'
  );
});
