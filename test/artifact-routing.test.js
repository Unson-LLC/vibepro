import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  ArtifactRoutingError,
  buildArtifactMigrationPlan,
  resolveArtifactRoute,
  resolveArtifactRoutes
} from '../src/artifact-routing.js';
import { writeFinalArchitecture } from '../src/architecture-store.js';
import { readInferredSpec, writeInferredSpec } from '../src/spec-store.js';
import { createStoryTasks } from '../src/story-task-generator.js';
import { runCli } from '../src/cli.js';
import { createTasksFromPlan } from '../src/task-manager.js';

const execFileAsync = promisify(execFile);

async function repo(config = null) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-artifact-routing-'));
  if (config) {
    await mkdir(path.join(root, '.vibepro'), { recursive: true });
    await writeFile(path.join(root, '.vibepro', 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  }
  return root;
}

test('unconfigured repository preserves current artifact defaults', async () => {
  const root = await repo();
  const resolved = await resolveArtifactRoutes(root, { storyId: 'story-VibePro-Example' });
  assert.equal(resolved.configured, false);
  assert.equal(resolved.routes.story.canonical.relative_path, 'docs/management/stories/active/story-vibepro-example.md');
  assert.equal(resolved.routes.architecture.canonical.relative_path, 'docs/architecture/story-vibepro-example.md');
  assert.equal(resolved.routes.accepted_spec.canonical.relative_path, '.vibepro/spec/story-vibepro-example/spec.json');
  assert.equal(resolved.routes.task_plan.canonical.relative_path, '.vibepro/stories/story-vibepro-example/tasks/tasks.md');
  assert.equal(resolved.routes.graphify.canonical.relative_path, '.vibepro/graphify');
});

test('custom nested feature routing expands stable variables', async () => {
  const root = await repo({
    artifact_routing: {
      schema_version: '0.1.0',
      artifacts: {
        story: { canonical: 'docs/features/{feature_slug}/01_behavior_spec.md' },
        architecture: {
          canonical: 'docs/features/{feature_slug}/04_technical_delta.md',
          projections: [{ path: 'docs/generated/{story_id}/architecture.md', generated: true }]
        }
      }
    }
  });
  const resolved = await resolveArtifactRoutes(root, { storyId: 'story-VibePro-Payments' });
  assert.equal(resolved.variables.feature_slug, 'vibepro-payments');
  assert.equal(resolved.routes.story.canonical.relative_path, 'docs/features/vibepro-payments/01_behavior_spec.md');
  assert.equal(resolved.routes.architecture.projections[0].generated, true);
  assert.equal(resolved.routes.architecture.projections[0].relative_path, 'docs/generated/story-vibepro-payments/architecture.md');
});

test('tracked routing is restored and resolved in a fresh checkout', async () => {
  const source = await repo({
    artifact_routing: {
      artifacts: { story: { canonical: 'docs/features/{feature_slug}/story.md' } }
    }
  });
  await writeFile(path.join(source, '.gitignore'), '.vibepro/*\n!.vibepro/config.json\n');
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: source });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: source });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: source });
  await execFileAsync('git', ['add', '.gitignore', '.vibepro/config.json'], { cwd: source });
  await execFileAsync('git', ['commit', '-m', 'test: track artifact routing'], { cwd: source });

  const checkout = `${source}-checkout`;
  await execFileAsync('git', ['clone', '--quiet', source, checkout]);
  const resolved = await resolveArtifactRoute(checkout, 'story', { storyId: 'story-fresh-checkout' });
  assert.equal(resolved.canonical.relative_path, 'docs/features/fresh-checkout/story.md');
});

test('unconfigured fresh checkout preserves legacy artifact defaults', async () => {
  const source = await repo();
  await writeFile(path.join(source, 'README.md'), '# unconfigured repository\n');
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: source });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: source });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: source });
  await execFileAsync('git', ['add', 'README.md'], { cwd: source });
  await execFileAsync('git', ['commit', '-m', 'test: create unconfigured repository'], { cwd: source });

  const checkout = `${source}-checkout`;
  await execFileAsync('git', ['clone', '--quiet', source, checkout]);
  const resolved = await resolveArtifactRoutes(checkout, { storyId: 'story-fresh-defaults' });
  assert.equal(resolved.configured, false);
  assert.equal(resolved.routes.story.canonical.relative_path, 'docs/management/stories/active/story-fresh-defaults.md');
  assert.equal(resolved.routes.architecture.canonical.relative_path, 'docs/architecture/story-fresh-defaults.md');
  assert.equal(resolved.routes.accepted_spec.canonical.relative_path, '.vibepro/spec/story-fresh-defaults/spec.json');
  assert.equal(resolved.routes.task_plan.canonical.relative_path, '.vibepro/stories/story-fresh-defaults/tasks/tasks.md');
  assert.equal(resolved.routes.graphify.canonical.relative_path, '.vibepro/graphify');
});

test('artifact routing guides document configuration, migration, compatibility, and rollback', async () => {
  for (const guide of ['docs/guide/artifact-output-routing.md', 'docs/ja/guide/artifact-output-routing.md']) {
    const content = await readFile(path.resolve(guide), 'utf8');
    assert.match(content, /artifact_routing/);
    assert.match(content, /--dry-run/);
    assert.match(content, /legacy|従来|既存/i);
    assert.match(content, /roll(?:back| back)|ロールバック/i);
  }
});

test('routing fails closed for collisions, traversal, absolute paths, and unresolved variables', async (t) => {
  const cases = [
    ['path_collision', {
      story: { canonical: 'docs/{story_id}.md' },
      architecture: { canonical: 'docs/{story_id}.md' }
    }],
    ['repository_traversal', { story: { canonical: '../outside/{story_id}.md' } }],
    ['absolute_path', { story: { canonical: path.join(os.tmpdir(), '{story_id}.md') } }],
    ['unresolved_variable', { story: { canonical: 'docs/{unknown}.md' } }]
  ];
  for (const [code, artifacts] of cases) {
    await t.test(code, async () => {
      const root = await repo({ artifact_routing: { artifacts } });
      await assert.rejects(
        resolveArtifactRoutes(root, { storyId: 'story-example' }),
        (error) => error instanceof ArtifactRoutingError && error.code === code
      );
    });
  }
});

test('malformed routing config fails closed before changing repository files', async () => {
  const root = await repo();
  const configPath = path.join(root, '.vibepro', 'config.json');
  const existingArtifact = path.join(root, 'docs', 'existing.md');
  await mkdir(path.dirname(configPath), { recursive: true });
  await mkdir(path.dirname(existingArtifact), { recursive: true });
  await writeFile(configPath, '{"artifact_routing":');
  await writeFile(existingArtifact, 'unchanged\n');

  await assert.rejects(
    resolveArtifactRoutes(root, { storyId: 'story-example' }),
    (error) => error instanceof ArtifactRoutingError && error.code === 'invalid_config'
  );
  assert.equal(await readFile(existingArtifact, 'utf8'), 'unchanged\n');
  assert.equal(await readFile(configPath, 'utf8'), '{"artifact_routing":');
});

test('projections must be explicitly machine generated', async () => {
  const root = await repo({
    artifact_routing: { artifacts: { architecture: { projections: [{ path: 'docs/generated/architecture.md' }] } } }
  });
  await assert.rejects(
    resolveArtifactRoute(root, 'architecture', { storyId: 'story-example' }),
    (error) => error.code === 'ambiguous_projection'
  );
});

test('migration dry-run reports moves and collisions without editing files', async () => {
  const root = await repo({
    artifact_routing: {
      artifacts: { story: { canonical: 'docs/features/{feature_slug}/story.md' } }
    }
  });
  const source = path.join(root, 'docs/management/stories/active/story-example.md');
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, '# story\n');
  const before = await readFile(source, 'utf8');
  const plan = await buildArtifactMigrationPlan(root, { storyId: 'story-example' });
  assert.equal(plan.dry_run, true);
  assert.equal(plan.edits_performed, 0);
  assert.equal(plan.items.find((item) => item.kind === 'story').action, 'move_required');
  assert.equal(await readFile(source, 'utf8'), before);
});

test('migration dry-run blocks when source and destination contain different content', async () => {
  const root = await repo({
    artifact_routing: {
      artifacts: { story: { canonical: 'docs/features/{feature_slug}/story.md' } }
    }
  });
  const source = path.join(root, 'docs/management/stories/active/story-example.md');
  const destination = path.join(root, 'docs/features/example/story.md');
  await mkdir(path.dirname(source), { recursive: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(source, '# source\n');
  await writeFile(destination, '# destination\n');

  const plan = await buildArtifactMigrationPlan(root, { storyId: 'story-example' });
  const item = plan.items.find((candidate) => candidate.kind === 'story');
  assert.equal(item.action, 'collision');
  assert.equal(item.collision, true);
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.unresolved.some((entry) => entry.code === 'migration_collision'), true);
  assert.equal(plan.edits_performed, 0);
  assert.equal(await readFile(source, 'utf8'), '# source\n');
  assert.equal(await readFile(destination, 'utf8'), '# destination\n');
});

test('migration dry-run reports invalid routing as a blocked machine-readable plan', async () => {
  const root = await repo({
    artifact_routing: { artifacts: { story: { canonical: 'docs/{unknown}/story.md' } } }
  });
  const plan = await buildArtifactMigrationPlan(root, { storyId: 'story-example' });
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.edits_performed, 0);
  assert.equal(plan.unresolved[0].code, 'unresolved_variable');
});

test('write containment rejects a configured path through a symlink outside the repository', async () => {
  const root = await repo({
    artifact_routing: { artifacts: { story: { canonical: 'linked/{story_id}.md' } } }
  });
  const outside = await mkdtemp(path.join(os.tmpdir(), 'vibepro-artifact-outside-'));
  await symlink(outside, path.join(root, 'linked'), 'dir');
  const route = await resolveArtifactRoute(root, 'story', { storyId: 'story-example' });
  const { assertArtifactWritePath } = await import('../src/artifact-routing.js');
  await assert.rejects(
    assertArtifactWritePath(root, route.canonical.relative_path),
    (error) => error.code === 'repository_traversal'
  );
});

test('architecture and accepted spec read and write the same configured canonical paths', async () => {
  const root = await repo({
    artifact_routing: {
      artifacts: {
        architecture: { canonical: 'docs/features/{feature_slug}/04_technical_delta.md' },
        accepted_spec: { canonical: 'docs/features/{feature_slug}/02_functional_spec.json' }
      }
    }
  });
  const storyId = 'story-checkout-safe';
  const architecture = await writeFinalArchitecture(root, storyId, '# Architecture\n');
  const spec = { story_id: storyId, clauses: [] };
  const acceptedSpec = await writeInferredSpec(root, storyId, spec);

  assert.equal(path.relative(root, architecture), 'docs/features/checkout-safe/04_technical_delta.md');
  assert.equal(path.relative(root, acceptedSpec), 'docs/features/checkout-safe/02_functional_spec.json');
  assert.deepEqual(await readInferredSpec(root, storyId), spec);
});

test('generated projections mirror canonical writes but are never selected as read authority', async () => {
  const root = await repo({
    artifact_routing: {
      artifacts: {
        architecture: {
          canonical: 'docs/features/{feature_slug}/architecture.md',
          projections: [{ path: 'docs/generated/{story_id}/architecture.md', generated: true }]
        }
      }
    }
  });
  const storyId = 'story-projection-authority';
  await writeFinalArchitecture(root, storyId, '# Canonical architecture\n');
  const projection = path.join(root, 'docs/generated/story-projection-authority/architecture.md');
  assert.equal(await readFile(projection, 'utf8'), '# Canonical architecture\n');
  await writeFile(projection, '# Mutated projection\n');
  const route = await resolveArtifactRoute(root, 'architecture', { storyId });
  assert.equal(await readFile(route.canonical.absolute_path, 'utf8'), '# Canonical architecture\n');
});

test('unsafe projection fails before changing the canonical artifact', async () => {
  const outside = await mkdtemp(path.join(os.tmpdir(), 'vibepro-routing-outside-'));
  const root = await repo({
    artifact_routing: {
      artifacts: {
        architecture: {
          canonical: 'docs/architecture/{story_id}.md',
          projections: [{ path: 'escaped/{story_id}.md', generated: true }]
        }
      }
    }
  });
  await mkdir(path.join(root, 'docs', 'architecture'), { recursive: true });
  const canonical = path.join(root, 'docs', 'architecture', 'story-safe.md');
  await writeFile(canonical, '# Existing\n');
  await symlink(outside, path.join(root, 'escaped'));
  await assert.rejects(
    writeFinalArchitecture(root, 'story-safe', '# Replacement\n'),
    (error) => error.code === 'repository_traversal'
  );
  assert.equal(await readFile(canonical, 'utf8'), '# Existing\n');
});

test('accepted spec projection failure leaves canonical and history untouched', async () => {
  const outside = await mkdtemp(path.join(os.tmpdir(), 'vibepro-routing-spec-outside-'));
  const root = await repo({ artifact_routing: { artifacts: { accepted_spec: {
    canonical: 'docs/specs/{story_id}.json',
    projections: [{ path: 'escaped/{story_id}.json', generated: true }]
  } } } });
  await symlink(outside, path.join(root, 'escaped'));
  await assert.rejects(
    writeInferredSpec(root, 'story-safe', { story_id: 'story-safe', generated_at: '2026-07-19T00:00:00.000Z' }),
    (error) => error.code === 'repository_traversal'
  );
  await assert.rejects(access(path.join(root, 'docs/specs/story-safe.json')));
  await assert.rejects(access(path.join(root, '.vibepro/spec/story-safe/spec.history')));
});

test('story task projection failure creates neither task state nor task plan', async () => {
  const outside = await mkdtemp(path.join(os.tmpdir(), 'vibepro-routing-task-outside-'));
  const root = await repo({ artifact_routing: { artifacts: { task_plan: {
    canonical: 'docs/tasks/{story_id}.md',
    projections: [{ path: 'escaped/{story_id}.md', generated: true }]
  } } } });
  await symlink(outside, path.join(root, 'escaped'));
  await assert.rejects(
    createStoryTasks(root, {
      story: { story_id: 'story-safe', title: 'Safe' },
      evidence: { findings: [], action_candidates: [], gates: [] },
      runId: 'routing-test',
      gateStatus: 'pass'
    }),
    (error) => error.code === 'repository_traversal'
  );
  await assert.rejects(access(path.join(root, '.vibepro/stories/story-safe/tasks/tasks.json')));
  await assert.rejects(access(path.join(root, 'docs/tasks/story-safe.md')));
});

test('plan task projection failure leaves tasks and manifest routing fields untouched', async () => {
  const outside = await mkdtemp(path.join(os.tmpdir(), 'vibepro-routing-plan-task-outside-'));
  const root = await repo();
  await runCli(['init', root, '--story-id', 'story-safe', '--title', 'Safe']);
  const configPath = path.join(root, '.vibepro/config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.artifact_routing = { artifacts: { task_plan: {
    canonical: 'docs/tasks/{story_id}.md',
    projections: [{ path: 'escaped/{story_id}.md', generated: true }]
  } } };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await symlink(outside, path.join(root, 'escaped'));
  const storiesDir = path.join(root, '.vibepro/stories');
  await mkdir(storiesDir, { recursive: true });
  await writeFile(path.join(storiesDir, 'story-plan.json'), `${JSON.stringify({
    generated_at: '2026-07-19T00:00:00.000Z',
    priority_stories: [{ story_id: 'story-safe', title: 'Safe' }],
    task_candidates: [{ id: 'task-safe', story_id: 'story-safe', title: 'Safe task', target_files: ['src/safe.js'] }]
  }, null, 2)}\n`);
  const manifestPath = path.join(root, '.vibepro/vibepro-manifest.json');
  const manifestBefore = await readFile(manifestPath, 'utf8');

  await assert.rejects(
    createTasksFromPlan(root, { storyId: 'story-safe' }),
    (error) => error.code === 'repository_traversal'
  );
  await assert.rejects(access(path.join(root, '.vibepro/stories/story-safe/tasks')));
  await assert.rejects(access(path.join(root, 'docs/tasks/story-safe.md')));
  assert.equal(await readFile(manifestPath, 'utf8'), manifestBefore);
});

test('task plan writes its human-readable canonical to the configured feature packet', async () => {
  const root = await repo({
    artifact_routing: {
      artifacts: { task_plan: { canonical: 'docs/features/{feature_slug}/06_tasks.md' } }
    }
  });
  const story = { story_id: 'story-checkout-safe', title: 'Checkout safe' };
  const result = await createStoryTasks(root, {
    story,
    evidence: { findings: [], action_candidates: [], gates: [] },
    runId: 'routing-test',
    gateStatus: 'pass'
  });
  assert.equal(result.artifacts.story_tasks_markdown, 'docs/features/checkout-safe/06_tasks.md');
  assert.match(await readFile(path.join(root, result.artifacts.story_tasks_markdown), 'utf8'), /Checkout safe/);
});

test('projections fail closed for artifact kinds without a centralized writer', async () => {
  const root = await repo({
    artifact_routing: {
      artifacts: { pr: { projections: [{ path: 'docs/generated/pr.json', generated: true }] } }
    }
  });
  await assert.rejects(
    resolveArtifactRoute(root, 'pr', { storyId: 'story-example' }),
    (error) => error.code === 'unsupported_projection'
  );
});

test('directory artifact routes cannot contain another artifact destination', async () => {
  const root = await repo({
    artifact_routing: {
      artifacts: {
        graphify: { canonical: 'docs/features/{feature_slug}' },
        architecture: { canonical: 'docs/features/{feature_slug}/architecture.md' }
      }
    }
  });
  await assert.rejects(
    resolveArtifactRoute(root, 'graphify', { storyId: 'story-example' }),
    (error) => error.code === 'path_collision'
  );
});

test('file artifact routes cannot be ancestors of directory artifact routes', async () => {
  const root = await repo({
    artifact_routing: {
      artifacts: {
        story: { canonical: 'docs/features' },
        graphify: { canonical: 'docs/features/graph' }
      }
    }
  });
  await assert.rejects(
    resolveArtifactRoutes(root, { storyId: 'story-example' }),
    (error) => error.code === 'path_collision'
  );
});

test('configured review, gate, and PR routes are shared by production lifecycle writers', async () => {
  const root = await repo();
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src/index.js'), 'export const value = 1;\n');
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await runCli(['init', root, '--story-id', 'story-routing-lifecycle', '--title', 'Routing lifecycle']);
  const configPath = path.join(root, '.vibepro/config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.artifact_routing = { artifacts: {
    review: { canonical: 'docs/features/{feature_slug}/reviews' },
    gate: { canonical: 'docs/features/{feature_slug}/gate-dag.json' },
    pr: { canonical: 'docs/features/{feature_slug}/pr-prepare.json' }
  } };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'chore: bootstrap'], { cwd: root });
  await execFileAsync('git', ['switch', '-c', 'feature/routing'], { cwd: root });
  await writeFile(path.join(root, 'src/index.js'), 'export const value = 2;\n');
  await execFileAsync('git', ['add', 'src/index.js'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'feat: route artifacts'], { cwd: root });

  let commandOutput = '';
  const silent = { write(text) { commandOutput += text; } };
  const review = await runCli([
    'review', 'prepare', root, '--id', 'story-routing-lifecycle', '--stage', 'architecture_spec',
    '--role', 'regression_risk', '--json'
  ], { stdout: silent, stderr: silent });
  assert.equal(review.exitCode, 0);
  const prepare = await runCli([
    'pr', 'prepare', root, '--base', 'main', '--story-id', 'story-routing-lifecycle', '--allow-extra-files',
    '--evidence-depth', 'full', '--evidence-depth-reason', 'routing integration test',
    '--evidence-depth-consumer', 'artifact-routing-test', '--evidence-depth-target', 'gate:e2e'
  ], { stdout: silent, stderr: silent });
  assert.equal(prepare.exitCode, 0, commandOutput);

  const featureDir = path.join(root, 'docs/features/routing-lifecycle');
  await access(path.join(featureDir, 'reviews/architecture_spec/review-plan.json'));
  await access(path.join(featureDir, 'gate-dag.json'));
  const prArtifact = JSON.parse(await readFile(path.join(featureDir, 'pr-prepare.json'), 'utf8'));
  assert.equal(prArtifact.story.story_id, 'story-routing-lifecycle');
  await assert.rejects(access(path.join(root, '.vibepro/reviews/story-routing-lifecycle')));
  await assert.rejects(access(path.join(root, '.vibepro/pr/story-routing-lifecycle/gate-dag.json')));
  await assert.rejects(access(path.join(root, '.vibepro/pr/story-routing-lifecycle/pr-prepare.json')));
});

test('design-system derive binds Graphify evidence with --story-id', async () => {
  const storyId = 'story-routing-design-system';
  const root = await repo({
    artifact_routing: {
      schema_version: '0.1.0',
      artifacts: { graphify: { canonical: 'artifacts/{feature_slug}/graphify' } }
    }
  });
  const graphDir = path.join(root, 'artifacts', 'routing-design-system', 'graphify');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), `${JSON.stringify({
    nodes: [{ id: 'route:/settings', type: 'route' }],
    edges: []
  })}\n`);
  let output = '';
  const result = await runCli([
    'design-system', 'derive', root, '--id', 'routing-ds', '--story-id', storyId, '--json'
  ], { stdout: { write: (text) => { output += text; } } });
  assert.equal(result.exitCode, 0);
  const json = JSON.parse(output);
  assert.equal(json.source_evidence.graphify.status, 'available');
  assert.match(json.source_evidence.graphify.artifact, /artifacts\/routing-design-system\/graphify\/graph\.json/);
});
