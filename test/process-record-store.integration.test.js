import './support/scratch-tmpdir.js';
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

async function makeCliRepo() {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'vibepro-store-cli-')));
  const repo = path.join(base, 'repo');
  await mkdir(repo);
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
  await runCli(['init', repo, '--story-id', STORY, '--title', 'T', '--view', 'dev', '--period', '2026-W18']);
  return { base, repo };
}

async function writeSpecInput(base) {
  const specInput = path.join(base, 'spec.json');
  await writeFile(specInput, JSON.stringify({ schema_version: '0.1.0', story_id: STORY, generated_by: { caller: 'test', stage: 'ai_synthesis' }, clauses: [] }));
  return specInput;
}

test('mutating CLI commands auto-snapshot durable records into the store', async () => {
  const { base, repo } = await makeCliRepo();
  const specInput = await writeSpecInput(base);
  const result = await runCli(['spec', 'write', repo, '--id', STORY, '--input', specInput, '--draft', '--json']);
  assert.equal(result.exitCode, 0);
  const mirrored = await readFile(path.join(repo, '.vibepro-store', STORY, 'spec', STORY, 'draft.json'), 'utf8');
  assert.ok(mirrored.length > 0);

  // decision record routes to pr/<story>/decision-records.json via artifact-routing
  // and must be mirrored by the same hook.
  const decision = await runCli(['decision', 'record', repo, '--id', STORY, '--type', 'needs_review',
    '--source', 'gate:test', '--status', 'accepted', '--summary', 's', '--reason', 'r', '--json']);
  assert.equal(decision.exitCode, 0);
  const mirroredDecision = await readFile(path.join(repo, '.vibepro-store', STORY, 'pr', STORY, 'decision-records.json'), 'utf8');
  assert.ok(mirroredDecision.includes('gate:test'));
});

test('auto-snapshot is fail-soft: an unwritable store never fails the producing command', async () => {
  const { base, repo } = await makeCliRepo();
  const specInput = await writeSpecInput(base);
  // Block the store root: a regular file where the directory must be created.
  await writeFile(path.join(repo, '.vibepro-store'), 'not a directory\n');
  const stderrChunks = [];
  const result = await runCli(
    ['spec', 'write', repo, '--id', STORY, '--input', specInput, '--draft', '--json'],
    { stderr: { write: (chunk) => stderrChunks.push(String(chunk)) } }
  );
  assert.equal(result.exitCode, 0);
  // The record itself still exists locally (legacy behavior preserved).
  const local = await readFile(path.join(repo, '.vibepro', 'spec', STORY, 'draft.json'), 'utf8');
  assert.ok(local.length > 0);
  assert.ok(stderrChunks.join('').includes('process-record snapshot failed'));
});

test('durability.enabled=false disables the auto-snapshot hook', async () => {
  const { base, repo } = await makeCliRepo();
  const specInput = await writeSpecInput(base);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.durability = { enabled: false };
  await writeFile(configPath, JSON.stringify(config, null, 2));
  const result = await runCli(['spec', 'write', repo, '--id', STORY, '--input', specInput, '--draft', '--json']);
  assert.equal(result.exitCode, 0);
  await assert.rejects(() => readFile(path.join(repo, '.vibepro-store', STORY, 'spec', STORY, 'draft.json'), 'utf8'));
});
