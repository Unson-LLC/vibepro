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
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = path.join(REPO_ROOT, 'bin', 'vibepro.js');

// ${STORY_ID} ac:3
// The real incident environment (a 134k-file checkout) cannot be embedded in the suite, so
// this integration test replays the same failure mechanism through the real CLI pipeline:
// `story diagnose` over a fixture whose one subtree exceeds the spread-argument limit for a
// --stack-size=200 child, the condition under which the previous walkers threw
// "Maximum call stack size exceeded" after "graphify artifacts imported".
test(`${STORY_ID} story diagnose completes through the CLI on a spread-limit-scale tree at reduced stack`, async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'vibepro-diagnose-integration-'));
  const wideDir = path.join(fixture, 'src', 'generated');
  await mkdir(wideDir, { recursive: true });
  await writeFile(path.join(fixture, 'package.json'), JSON.stringify({ name: 'fixture' }));
  let batch = [];
  for (let index = 0; index < 30000; index += 1) {
    batch.push(writeFile(path.join(wideDir, `entry-${index}.js`), ''));
    if (batch.length === 500) {
      await Promise.all(batch);
      batch = [];
    }
  }
  await Promise.all(batch);

  // Pre-seeded graphify artifacts so the diagnose pipeline runs without the graphify binary.
  const graphifyOut = path.join(fixture, 'graphify-out');
  await mkdir(graphifyOut, { recursive: true });
  await writeFile(path.join(graphifyOut, 'graph.json'), JSON.stringify({ nodes: [], edges: [] }));
  await writeFile(path.join(graphifyOut, 'GRAPH_REPORT.md'), '# fixture graph\n');

  await execFileAsync(process.execPath, [CLI, 'init', fixture, '--language', 'ja', '--story-id', 'story-fixture-walk', '--title', 'fixture'], { timeout: 60000 });

  const { stdout } = await execFileAsync(
    process.execPath,
    ['--stack-size=200', CLI, 'story', 'diagnose', fixture, '--id', 'story-fixture-walk'],
    { cwd: REPO_ROOT, timeout: 420000, maxBuffer: 16 * 1024 * 1024 }
  );

  assert.match(stdout, /graphify artifacts imported/);
  assert.match(stdout, /diagnosis created/, 'diagnosis must complete past the point where the recursive walkers previously crashed');
  assert.doesNotMatch(stdout, /Maximum call stack size exceeded/);
});
