import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { runCli, TOP_LEVEL_COMMANDS } from '../src/cli.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

// A git repo with a VibePro workspace, a feature branch, and one source change —
// the minimal state most commands need to run their real (exit 0) path.
async function makeStoryRepo() {
  const repo = await mkdtemp(path.join(tmpdir(), 'vibepro-smoke-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 't@e.com']);
  await git(repo, ['config', 'user.name', 'T']);
  await runCli(['init', repo, '--story-id', 'story-x', '--title', 'T', '--view', 'dev', '--period', '2026-W18']);
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ dependencies: { next: '14' } }));
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: init']);
  await git(repo, ['switch', '-c', 'feature/x']);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'a.js'), 'export const a = 1;\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'feat: a']);
  return repo;
}

async function makeBareGitRepo() {
  const repo = await mkdtemp(path.join(tmpdir(), 'vibepro-smoke-bare-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 't@e.com']);
  await git(repo, ['config', 'user.name', 'T']);
  return repo;
}

// One smoke entry per top-level command. `args(repo)` returns the argv for a
// real success path; `setup` decides what repo the command needs.
// This layer exists to catch handler-import wiring breaks (e.g. a command whose
// module import is missing/broken) BEFORE merge — exactly the class of bug that
// `env graph` and the deploy gate shipped with, which module-only unit tests
// could not see because no test invoked the command end-to-end.
const SMOKE = {
  version: { setup: 'none', args: () => ['version'] },
  help: { setup: 'none', args: () => ['help'] },
  init: { setup: 'bare', args: (r) => ['init', r, '--story-id', 'story-i', '--title', 'T', '--view', 'dev', '--period', '2026-W18'] },
  config: { setup: 'story', args: (r) => ['config', 'language', r, '--language', 'en'] },
  doctor: { setup: 'story', args: (r) => ['doctor', r] },
  graph: { setup: 'story', args: (r) => ['graph', r] },
  env: { setup: 'story', args: (r) => ['env', 'graph', r] },
  harness: { setup: 'story', args: (r) => ['harness', 'status', r] },
  skills: { setup: 'story', args: (r) => ['skills', 'list', r] },
  codex: { setup: 'story', args: (r) => ['codex', 'verify', r] },
  brainbase: { setup: 'none', args: () => ['brainbase'] },
  pr: { setup: 'story', args: (r) => ['pr', 'prepare', r, '--base', 'main'] },
  story: { setup: 'story', args: (r) => ['story', 'add', r, '--id', 'story-y', '--title', 'Y', '--view', 'dev', '--period', '2026-W18'] },
  playbook: { setup: 'story', args: (r) => ['playbook', 'export', r, '--id', 'story-x'] },
  journey: { setup: 'story', args: (r) => ['journey', 'status', r] },
  execute: { setup: 'story', args: (r) => ['execute', 'status', r, '--story-id', 'story-x', '--json'] },
  task: { setup: 'story', args: (r) => ['task', r] },
  decision: { setup: 'story', args: (r) => ['decision', 'status', r, '--id', 'story-x'] },
  verify: { setup: 'story', args: (r) => ['verify', r] },
  review: { setup: 'story', args: (r) => ['review', 'status', r, '--id', 'story-x'] },
  checkpoint: { setup: 'story', args: (r) => ['checkpoint', r] },
  gate: { setup: 'story', args: (r) => ['gate', 'check', r, '--story-id', 'story-x'] },
  spec: { setup: 'story', args: (r) => ['spec', r] },
  report: { setup: 'story', args: (r) => ['report', r] },
  audit: { setup: 'story', args: (r) => ['audit', 'replay', r, '--story-id', 'story-x', '--json'] },
  'design-modernize': { setup: 'story', args: (r) => ['design-modernize', r] },
  'design-system': { setup: 'story', args: (r) => ['design-system', r] },
  'design-ssot': { setup: 'story', args: (r) => ['design-ssot', 'status', r] },
  uiux: { setup: 'story', args: (r) => ['uiux', 'intake', 'template', r, '--id', 'story-x'] },
  explore: { setup: 'story', args: (r) => ['explore', r] },
  performance: { setup: 'story', args: (r) => ['performance', r] },
  nocodb: { setup: 'none', args: () => ['nocodb'] },
  'repo-status': { setup: 'story', args: (r) => ['repo-status', r] },
  workspace: { setup: 'story', args: (r) => ['workspace', 'status', r, '--json'] }
};

async function repoFor(setup) {
  if (setup === 'story') return makeStoryRepo();
  if (setup === 'bare') return makeBareGitRepo();
  return null;
}

// The contract this layer enforces is "every command's handler is wired and
// reachable": runCli must not THROW (a missing/broken import throws at dispatch),
// and must return a result with a numeric exitCode. It deliberately does NOT
// require exit 0 — several commands legitimately exit non-zero on a minimal repo
// (e.g. unresolved gates). Throwing is the #117/#118 failure mode; a clean
// non-zero exit is normal. This catches the wiring-break class without coupling
// to each command's success preconditions.
test('CLI smoke: every top-level command is wired and runs without throwing', async () => {
  for (const [name, spec] of Object.entries(SMOKE)) {
    const repo = await repoFor(spec.setup);
    const argv = spec.args(repo);
    let result;
    try {
      result = await runCli(argv);
    } catch (err) {
      assert.fail(`command "${name}" threw during runCli (likely a broken/missing handler import): ${err.message}`);
    }
    assert.equal(typeof result, 'object', `command "${name}" should return a result object`);
    assert.equal(typeof result.exitCode, 'number', `command "${name}" should return a numeric exitCode`);
  }
});

test('CLI smoke coverage: every TOP_LEVEL_COMMANDS entry has a smoke test', () => {
  const smoked = new Set(Object.keys(SMOKE));
  const missing = TOP_LEVEL_COMMANDS.filter((c) => !smoked.has(c));
  assert.deepEqual(missing, [], `these commands lack a CLI smoke test: ${missing.join(', ')}`);
  // And no stale smoke entries for removed commands.
  const known = new Set(TOP_LEVEL_COMMANDS);
  const stale = [...smoked].filter((c) => !known.has(c));
  assert.deepEqual(stale, [], `these smoke entries are not real commands: ${stale.join(', ')}`);
});
