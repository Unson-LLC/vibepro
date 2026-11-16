import './support/scratch-tmpdir.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runCli, TOP_LEVEL_COMMANDS } from '../src/cli.js';

function capture() {
  let out = '';
  let err = '';
  return {
    io: { stdout: { write: (c) => { out += c; } }, stderr: { write: (c) => { err += c; } } },
    get out() { return out; },
    get err() { return err; }
  };
}

async function makeRepo() {
  const repo = await mkdtemp(path.join(tmpdir(), 'vibepro-journey-cli-'));
  await runCli(['init', repo, '--story-id', 'story-x', '--title', 'T', '--view', 'dev', '--period', '2026-W18'], capture().io);
  return repo;
}

test('journey is a top-level command', () => {
  assert.ok(TOP_LEVEL_COMMANDS.includes('journey'));
});

test('help lists journey derive, handoff and curate in both languages', async () => {
  for (const language of ['en', 'ja']) {
    const c = capture();
    const result = await runCli(['help', '--language', language], c.io);
    assert.equal(result.exitCode, 0);
    assert.match(c.out, /vibepro journey derive \[repo\] \[--id <journey-id>\] \[--json\]/);
    assert.match(c.out, /vibepro journey handoff \[repo\] \[--id <journey-id>\] \[--json\]/);
    assert.match(c.out, /vibepro journey curate \[repo\] --input <judgments\.json\|yaml>/);
  }
});

test('journey without a subcommand or with --help prints help', async () => {
  for (const argv of [['journey'], ['journey', '--help'], ['journey', 'derive', '--help']]) {
    const c = capture();
    const result = await runCli(argv, c.io);
    assert.equal(result.exitCode, 0, argv.join(' '));
    assert.match(c.out, /vibepro journey curate/);
  }
});

test('unknown journey subcommand fails with a journey-specific error, not Unknown command', async () => {
  const c = capture();
  const result = await runCli(['journey', 'bogus'], c.io);
  assert.equal(result.exitCode, 1);
  assert.match(c.err, /Unknown journey command: bogus/);
  assert.doesNotMatch(c.err, /^Unknown command: journey/);
});

test('journey derive and handoff route to the Journey workflow', async () => {
  const repo = await makeRepo();
  const derive = capture();
  const derived = await runCli(['journey', 'derive', repo, '--json'], derive.io);
  assert.equal(derived.exitCode, 0, derive.err);
  assert.equal(derived.subcommand, 'derive');
  const journey = JSON.parse(derive.out);
  assert.equal(journey.journey_id, 'default-product-journey');
  assert.ok(journey.handoff);

  const markdown = capture();
  assert.equal((await runCli(['journey', 'derive', repo], markdown.io)).exitCode, 0);
  assert.ok(markdown.out.length > 0);

  const handoff = capture();
  const handed = await runCli(['journey', 'handoff', repo, '--json'], handoff.io);
  assert.equal(handed.exitCode, 0, handoff.err);
  assert.deepEqual(JSON.parse(handoff.out), handed.result.journey.handoff);
});

test('journey curate requires --input and a context pack', async () => {
  const repo = await makeRepo();
  const noPack = capture();
  const missingPack = await runCli(['journey', 'curate', repo, '--input', 'j.json'], noPack.io);
  assert.equal(missingPack.exitCode, 1);
  assert.match(noPack.err, /Journey context pack is missing/);

  await runCli(['journey', 'derive', repo, '--json'], capture().io);
  const noInput = capture();
  const missingInput = await runCli(['journey', 'curate', repo], noInput.io);
  assert.equal(missingInput.exitCode, 1);
  assert.match(noInput.err, /journey curate requires --input <judgments\.json\|yaml>/);

  const json = capture();
  await runCli(['journey', 'curate', repo, '--json'], json.io);
  assert.match(JSON.parse(json.err).error?.message ?? json.err, /requires --input/);
});

test('journey curate routes --input, --id and --output to curateJourneyMap', async () => {
  const repo = await makeRepo();
  const derive = capture();
  await runCli(['journey', 'derive', repo, '--json'], derive.io);
  const pack = JSON.parse(derive.out);
  // Test fixture only: resolves every derived item so routing can be exercised.
  const fixture = {
    conflicts: Object.fromEntries((pack.conflicts ?? []).map((item) => [item.id, { status: 'accepted' }])),
    open_questions: Object.fromEntries((pack.open_questions ?? []).map((item) => [item.id, { status: 'accepted' }]))
  };
  await writeFile(path.join(repo, 'fixture-judgments.json'), JSON.stringify(fixture));
  const c = capture();
  const result = await runCli(['journey', 'curate', repo, '--input', 'fixture-judgments.json', '--output', 'out/curated.json'], c.io);
  assert.equal(result.exitCode, 0, c.err);
  assert.equal(result.subcommand, 'curate');
  assert.match(c.out, /# Journey Curated/);
  const curated = JSON.parse(await readFile(path.join(repo, 'out', 'curated.json'), 'utf8'));
  assert.equal(curated.curation_status, 'curated');
  assert.equal(curated.curation.input_path, 'fixture-judgments.json');
});

async function makeCuratableRepo() {
  const repo = await makeRepo();
  const derive = capture();
  await runCli(['journey', 'derive', repo, '--json'], derive.io);
  const pack = JSON.parse(derive.out);
  // Test fixture only: resolves every derived item so output handling can be exercised.
  const fixture = {
    conflicts: Object.fromEntries((pack.conflicts ?? []).map((item) => [item.id, { status: 'accepted' }])),
    open_questions: Object.fromEntries((pack.open_questions ?? []).map((item) => [item.id, { status: 'accepted' }]))
  };
  await writeFile(path.join(repo, 'fixture-judgments.json'), JSON.stringify(fixture));
  return repo;
}

test('journey --id without a value fails with exit 1', async () => {
  const repo = await makeRepo();
  for (const argv of [
    ['journey', 'derive', repo, '--id'],
    ['journey', 'derive', repo, '--id', '--json'],
    ['journey', 'handoff', repo, '--id', '--json'],
    ['journey', 'curate', repo, '--input', 'j.json', '--id', '--output', 'x.json']
  ]) {
    const c = capture();
    const result = await runCli(argv, c.io);
    assert.equal(result.exitCode, 1, argv.join(' '));
    assert.match(c.err, /--id requires a value/);
    assert.equal(c.out, '');
  }
});

test('journey curate --output refuses paths outside the repo', async () => {
  const repo = await makeCuratableRepo();
  const outside = await mkdtemp(path.join(tmpdir(), 'vibepro-journey-outside-'));
  for (const target of ['../escape.json', '../../escape.json', 'out/../../escape.json', path.join(outside, 'abs.json'), '.']) {
    const c = capture();
    const result = await runCli(['journey', 'curate', repo, '--input', 'fixture-judgments.json', '--output', target], c.io);
    assert.equal(result.exitCode, 1, target);
    assert.match(c.err, /must resolve to a file inside the repo/, target);
  }
  await assert.rejects(readFile(path.join(path.dirname(repo), 'escape.json'), 'utf8'));
  await assert.rejects(readFile(path.join(outside, 'abs.json'), 'utf8'));
});

test('journey curate --output refuses to overwrite unless --force, default path still works', async () => {
  const repo = await makeCuratableRepo();
  const def = capture();
  assert.equal((await runCli(['journey', 'curate', repo, '--input', 'fixture-judgments.json'], def.io)).exitCode, 0, def.err);
  const defAgain = capture();
  assert.equal((await runCli(['journey', 'curate', repo, '--input', 'fixture-judgments.json'], defAgain.io)).exitCode, 0, defAgain.err);

  const target = path.join(repo, 'out-existing.json');
  await writeFile(target, 'KEEP');
  const blocked = capture();
  const refused = await runCli(['journey', 'curate', repo, '--input', 'fixture-judgments.json', '--output', 'out-existing.json'], blocked.io);
  assert.equal(refused.exitCode, 1);
  assert.match(blocked.err, /already exists; pass --force/);
  assert.equal(await readFile(target, 'utf8'), 'KEEP');

  const forced = capture();
  const ok = await runCli(['journey', 'curate', repo, '--input', 'fixture-judgments.json', '--output', 'out-existing.json', '--force'], forced.io);
  assert.equal(ok.exitCode, 0, forced.err);
  assert.equal(JSON.parse(await readFile(target, 'utf8')).curation_status, 'curated');
});

test('journey curate --output refuses a directory symlink pointing outside the repo', async () => {
  const repo = await makeCuratableRepo();
  const outside = await mkdtemp(path.join(tmpdir(), 'vibepro-journey-outside-'));
  await symlink(outside, path.join(repo, 'linkdir'));
  const c = capture();
  const result = await runCli(['journey', 'curate', repo, '--input', 'fixture-judgments.json', '--output', 'linkdir/x.json', '--force'], c.io);
  assert.equal(result.exitCode, 1);
  assert.match(c.err, /must (resolve to a file inside the repo|not be or pass through a symlink)/);
  assert.deepEqual(await readdir(outside), []);
});

test('journey curate --output refuses a file symlink even with --force', async () => {
  const repo = await makeCuratableRepo();
  const outside = await mkdtemp(path.join(tmpdir(), 'vibepro-journey-outside-'));
  const victim = path.join(outside, 'victim.json');
  await writeFile(victim, 'KEEP');
  const inside = path.join(repo, 'inside.json');
  await writeFile(inside, 'INSIDE');
  for (const [name, target] of [['out-link.json', victim], ['in-link.json', inside]]) {
    await symlink(target, path.join(repo, name));
    const c = capture();
    const result = await runCli(['journey', 'curate', repo, '--input', 'fixture-judgments.json', '--output', name, '--force'], c.io);
    assert.equal(result.exitCode, 1, name);
    assert.match(c.err, /must (resolve to a file inside the repo|not be or pass through a symlink)/, name);
  }
  assert.equal(await readFile(victim, 'utf8'), 'KEEP');
  assert.equal(await readFile(inside, 'utf8'), 'INSIDE');
});

test('journey curate --output refuses a dangling symlink whose target is outside the repo', async () => {
  const repo = await makeCuratableRepo();
  const outside = await mkdtemp(path.join(tmpdir(), 'vibepro-journey-outside-'));
  const missing = path.join(outside, 'not-yet.json');
  await symlink(missing, path.join(repo, 'dangling.json'));
  await mkdir(path.join(outside, 'gone'));
  await symlink(path.join(outside, 'gone', 'sub'), path.join(repo, 'dangling-dir'));
  for (const argv of [['--output', 'dangling.json'], ['--output', 'dangling.json', '--force'], ['--output', 'dangling-dir/x.json']]) {
    const c = capture();
    const result = await runCli(['journey', 'curate', repo, '--input', 'fixture-judgments.json', ...argv], c.io);
    assert.equal(result.exitCode, 1, argv.join(' '));
    assert.match(c.err, /must not be or pass through a symlink/, argv.join(' '));
  }
  await assert.rejects(readFile(missing, 'utf8'));
  assert.deepEqual(await readdir(path.join(outside, 'gone')), []);
});

test('help documents --force for journey curate in both languages', async () => {
  for (const language of ['en', 'ja']) {
    const c = capture();
    await runCli(['help', '--language', language], c.io);
    assert.match(c.out, /vibepro journey curate .*--output <path>\] \[--force\]/);
  }
});
