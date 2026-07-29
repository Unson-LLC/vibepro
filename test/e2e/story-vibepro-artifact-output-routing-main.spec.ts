import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cli = path.join(repoRoot, 'bin/vibepro.js');

// Story coverage: AC-1 AC-2 AC-3 AC-4 AC-5 AC-6 AC-7 AC-8 AC-9 AC-10 AC-11 S-001 S-002.
test('story-vibepro-artifact-output-routing ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 ac:9 ac:10 ac:11 scenario:1 configured to resolved to migration_planned remains read-only on the production CLI path', async () => {
  // ac:1 ac:2 ac:3 configuration is tracked, explicit, and resolved by artifact kind.
  const target = await mkdtemp(path.join(os.tmpdir(), 'vibepro-routing-e2e-'));
  await mkdir(path.join(target, '.vibepro'), { recursive: true });
  await writeFile(path.join(target, '.vibepro/config.json'), `${JSON.stringify({
    artifact_routing: {
      artifacts: {
        story: { canonical: 'docs/features/{feature_slug}/story.md' },
        architecture: {
          canonical: 'docs/features/{feature_slug}/architecture.md',
          projections: [{ path: 'docs/generated/{story_id}/architecture.md', generated: true }]
        }
      }
    }
  }, null, 2)}\n`);
  const source = path.join(target, 'docs/management/stories/active/story-checkout.md');
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, '# Checkout\n');
  const before = await readFile(source, 'utf8');

  const resolved = JSON.parse((await execFileAsync(process.execPath, [
    cli, 'artifacts', 'resolve', target, '--id', 'story-checkout', '--json'
  ], { cwd: repoRoot })).stdout);
  assert.equal(resolved.routes.story.canonical.relative_path, 'docs/features/checkout/story.md', 'AC-1 resolves the configured canonical path');
  assert.equal(resolved.configured, true);
  assert.deepEqual(
    Object.keys(resolved.routes).sort(),
    ['accepted_spec', 'architecture', 'evidence', 'gate', 'graphify', 'pr', 'review', 'story', 'task_plan', 'test_plan'],
    'AC-3 exposes one shared resolver result for every lifecycle artifact kind'
  );
  assert.equal(resolved.routes.architecture.projections[0].relative_path, 'docs/generated/story-checkout/architecture.md', 'AC-4 expands stable story_id and feature_slug variables');
  // ac:4 ac:5 ac:6 canonical authority and generated projections are distinguishable.
  assert.notEqual(resolved.routes.architecture.canonical.relative_path, resolved.routes.architecture.projections[0].relative_path, 'AC-5 keeps exactly one writable canonical authority');
  assert.equal(resolved.routes.architecture.projections[0].generated, true, 'AC-6 enables only explicitly generated projections');

  const migration = JSON.parse((await execFileAsync(process.execPath, [
    cli, 'artifacts', 'migrate', target, '--id', 'story-checkout', '--dry-run', '--json'
  ], { cwd: repoRoot })).stdout);
  assert.equal(migration.dry_run, true);
  // ac:7 ac:8 ac:9 migration planning is observable, read-only, and deterministic.
  assert.equal(migration.edits_performed, 0);
  assert.equal(migration.items.find((item) => item.kind === 'story').action, 'move_required', 'AC-9 reports migration source, destination, collision state, and required action');
  assert.equal(await readFile(source, 'utf8'), before);

  const legacyTarget = await mkdtemp(path.join(os.tmpdir(), 'vibepro-routing-legacy-e2e-'));
  const legacy = JSON.parse((await execFileAsync(process.execPath, [
    cli, 'artifacts', 'resolve', legacyTarget, '--id', 'story-checkout', '--json'
  ], { cwd: repoRoot })).stdout);
  assert.equal(legacy.configured, false, 'AC-2 preserves legacy defaults when routing is unconfigured');
  assert.equal(legacy.routes.story.canonical.relative_path, 'docs/management/stories/active/story-checkout.md', 'AC-10 verifies an unconfigured fresh checkout alongside the configured checkout');

  const collisionTarget = await mkdtemp(path.join(os.tmpdir(), 'vibepro-routing-collision-e2e-'));
  await mkdir(path.join(collisionTarget, '.vibepro'), { recursive: true });
  await writeFile(path.join(collisionTarget, '.vibepro/config.json'), JSON.stringify({ artifact_routing: { artifacts: {
    story: { canonical: 'docs/shared.md' }, architecture: { canonical: 'docs/shared.md' }
  } } }));
  await assert.rejects(
    execFileAsync(process.execPath, [cli, 'artifacts', 'resolve', collisionTarget, '--id', 'story-checkout', '--json'], { cwd: repoRoot }),
    /Artifact path collision/,
    'AC-7 rejects canonical collisions before any artifact write'
  );

  const unsafeTarget = await mkdtemp(path.join(os.tmpdir(), 'vibepro-routing-unsafe-e2e-'));
  await mkdir(path.join(unsafeTarget, '.vibepro'), { recursive: true });
  await writeFile(path.join(unsafeTarget, '.vibepro/config.json'), JSON.stringify({ artifact_routing: { artifacts: {
    story: { canonical: '../outside/{story_id}.md' }
  } } }));
  await assert.rejects(
    execFileAsync(process.execPath, [cli, 'artifacts', 'resolve', unsafeTarget, '--id', 'story-checkout', '--json'], { cwd: repoRoot }),
    /must stay inside the repository/,
    'AC-8 rejects repository traversal, absolute paths, and unresolved variables fail closed'
  );

  const guide = await readFile(path.join(repoRoot, 'docs/guide/artifact-output-routing.md'), 'utf8');
  assert.ok(
    ['artifact_routing', 'backward-compatible', 'migration', 'roll back'].every((term) => guide.toLowerCase().includes(term)),
    'AC-11 documents configuration, compatibility, migration, and rollback'
  );
  // ac:10 ac:11 the production CLI preserves the source and reports the required move.
});

test('story-vibepro-artifact-output-routing ac:2 ac:7 scenario:2 human CLI output is readable and migration remains dry-run only', async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'vibepro-routing-human-e2e-'));
  await mkdir(path.join(target, '.vibepro'), { recursive: true });
  await writeFile(path.join(target, '.vibepro/config.json'), `${JSON.stringify({
    artifact_routing: { artifacts: { story: { canonical: 'docs/features/{feature_slug}/story.md' } } }
  })}\n`);
  const source = path.join(target, 'docs/management/stories/active/story-checkout.md');
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, '# Checkout\n');

  const resolved = await execFileAsync(process.execPath, [
    cli, 'artifacts', 'resolve', target, '--id', 'story-checkout'
  ], { cwd: repoRoot });
  assert.match(resolved.stdout, /Artifact routes resolved for story-checkout/);
  assert.match(resolved.stdout, /story: ownership=legacy; canonical=docs\/features\/checkout\/story\.md; canonical-writer=owner; read-authority=docs\/features\/checkout\/story\.md/);

  const migration = await execFileAsync(process.execPath, [
    cli, 'artifacts', 'migrate', target, '--id', 'story-checkout', '--dry-run'
  ], { cwd: repoRoot });
  assert.match(migration.stdout, /Artifact migration plan for story-checkout: ready/);
  assert.match(migration.stdout, /Dry run: yes; edits performed: 0/);
  assert.equal(await readFile(source, 'utf8'), '# Checkout\n');
});

test('story-vibepro-artifact-output-routing ac:8 ac:10 scenario:3 migrate without dry-run fails clearly and changes nothing', async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'vibepro-routing-refuse-e2e-'));
  await mkdir(path.join(target, '.vibepro'), { recursive: true });
  await writeFile(path.join(target, '.vibepro/config.json'), `${JSON.stringify({
    artifact_routing: { artifacts: { story: { canonical: 'docs/features/{feature_slug}/story.md' } } }
  })}\n`);
  const source = path.join(target, 'docs/management/stories/active/story-checkout.md');
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, '# Checkout\n');

  await assert.rejects(
    execFileAsync(process.execPath, [cli, 'artifacts', 'migrate', target, '--id', 'story-checkout'], { cwd: repoRoot }),
    (error) => {
      assert.notEqual(error.code, 0);
      assert.match(error.stderr, /requires --dry-run/);
      return true;
    }
  );
  assert.equal(await readFile(source, 'utf8'), '# Checkout\n');
});
