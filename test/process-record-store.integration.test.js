import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);
const STORY = 'story-x';

test('mutating CLI commands auto-snapshot durable records into the store', async () => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'vibepro-store-cli-')));
  const repo = path.join(base, 'repo');
  await mkdir(repo);
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
  await runCli(['init', repo, '--story-id', STORY, '--title', 'T', '--view', 'dev', '--period', '2026-W18']);
  const specInput = path.join(base, 'spec.json');
  await writeFile(specInput, JSON.stringify({ schema_version: '0.1.0', story_id: STORY, generated_by: { caller: 'test', stage: 'ai_synthesis' }, clauses: [] }));
  const result = await runCli(['spec', 'write', repo, '--id', STORY, '--input', specInput, '--draft', '--json']);
  assert.equal(result.exitCode, 0);
  const mirrored = await readFile(path.join(repo, '.vibepro-store', STORY, 'spec', STORY, 'draft.json'), 'utf8');
  assert.ok(mirrored.length > 0);
});
