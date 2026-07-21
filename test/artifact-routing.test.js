import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  ArtifactRoutingError,
  buildArtifactMigrationPlan,
  projectArtifact,
  resolveArtifactRoute,
  resolveArtifactRoutes,
  writeArtifactProjections
} from '../src/artifact-routing.js';
import { writeFinalArchitecture } from '../src/architecture-store.js';
import { readInferredSpec, writeInferredSpec } from '../src/spec-store.js';
import { createStoryTasks } from '../src/story-task-generator.js';
import { runCli } from '../src/cli.js';
import { createTasksFromPlan } from '../src/task-manager.js';
import { importGraphifyArtifacts } from '../src/graphify-adapter.js';

const execFileAsync = promisify(execFile);

test('upgraded repository keeps legacy catalog Stories operable while the selected Story uses a named profile', async () => {
  const root = path.resolve(process.cwd());
  const config = JSON.parse(await readFile(path.join(root, '.vibepro/config.json'), 'utf8'));
  const stories = config.brainbase.stories;
  assert.ok(stories.some((story) => story.story_id === 'story-vibepro-story-run-portfolio-controller'));
  for (const story of stories) {
    const resolved = await resolveArtifactRoutes(root, { storyId: story.story_id });
    if (story.story_id === 'story-vibepro-routing-profiles-rendered-projections') {
      assert.equal(story.artifact_profile, 'feature_packet');
      assert.equal(resolved.profile, story.artifact_profile);
      assert.equal(resolved.variables.feature_slug, story.feature_slug);
    } else {
      assert.equal(story.artifact_profile, undefined, story.story_id);
      assert.equal(resolved.profile, null, story.story_id);
      assert.equal(resolved.schema_version, '0.1.0', story.story_id);
      assert.equal(resolved.configured, false, story.story_id);
      assert.equal(resolved.routes.story.canonical_owner, 'legacy', story.story_id);
      assert.equal(resolved.routes.story.canonical_writer, 'owner', story.story_id);
      assert.deepEqual(resolved.routes.story.projections, [], story.story_id);
    }
  }
});

function completeProfile(overrides = {}) {
  const artifacts = {};
  for (const kind of ['story', 'architecture', 'accepted_spec', 'task_plan', 'graphify', 'evidence', 'test_plan', 'review', 'gate', 'pr']) {
    artifacts[kind] = { canonical: ({ story: 'docs/management/stories/active/{story_id}.md', architecture: 'docs/architecture/{story_id}.md', accepted_spec: '.vibepro/spec/{story_id}/spec.json', task_plan: '.vibepro/stories/{story_id}/tasks/tasks.json', graphify: '.vibepro/graphify', evidence: '.vibepro/evidence/{story_id}', test_plan: '.vibepro/test-plans/{story_id}.json', review: '.vibepro/reviews/{story_id}', gate: '.vibepro/pr/{story_id}/gate-dag.json', pr: '.vibepro/pr/{story_id}/pr-prepare.json' })[kind], ownership: kind === 'story' || kind === 'architecture' ? 'curated' : 'generated', ...overrides[kind] };
  }
  return { artifacts };
}

async function namedProfileRepo(profileOverrides = {}) {
  const storyId = 'story-routing-profile';
  const root = await repo({ brainbase: { stories: [{ story_id: storyId, artifact_profile: 'feature_packet', feature_slug: 'payments' }] }, artifact_routing: { schema_version: '0.2.0', artifacts: {}, profiles: { feature_packet: completeProfile(profileOverrides), governance_packet: completeProfile() } } });
  await mkdir(path.join(root, 'docs/management/stories/active'), { recursive: true });
  await writeFile(path.join(root, `docs/management/stories/active/${storyId}.md`), '---\nstory_id: story-routing-profile\nartifact_profile: feature_packet\nfeature_slug: payments\n---\n');
  return { root, storyId };
}

function projectedPacketProfile(prefix) {
  return completeProfile({
    architecture: { canonical: 'docs/architecture/{story_id}.md', ownership: 'curated', projections: [{ path: `${prefix}/architecture.md`, ownership: 'generated', renderer: { id: 'architecture_markdown', version: '1' } }] },
    accepted_spec: { canonical: '.vibepro/spec/{story_id}/spec.json', ownership: 'generated', projections: [{ path: `${prefix}/functional-spec.md`, ownership: 'generated', renderer: { id: 'functional_spec_markdown', version: '1' } }] },
    task_plan: { canonical: '.vibepro/stories/{story_id}/tasks/tasks.json', ownership: 'generated', projections: [{ path: `${prefix}/tasks.md`, ownership: 'generated', renderer: { id: 'tasks_markdown', version: '1' } }] },
    evidence: { canonical: '.vibepro/evidence/{story_id}', ownership: 'generated', projections: [{ path: `${prefix}/evidence.md`, ownership: 'generated', renderer: { id: 'evidence_summary_markdown', version: '1' } }] },
    test_plan: { canonical: '.vibepro/test-plans/{story_id}.json', ownership: 'generated', projections: [{ path: `${prefix}/test-plan.md`, ownership: 'generated', renderer: { id: 'test_plan_markdown', version: '1' } }] },
    review: { canonical: '.vibepro/reviews/{story_id}', ownership: 'generated', projections: [{ path: `${prefix}/review.md`, ownership: 'generated', renderer: { id: 'review_summary_markdown', version: '1' } }] },
    gate: { canonical: '.vibepro/pr/{story_id}/gate-dag.json', ownership: 'generated', projections: [{ path: `${prefix}/gate.md`, ownership: 'generated', renderer: { id: 'gate_summary_markdown', version: '1' } }] },
    pr: { canonical: '.vibepro/pr/{story_id}/pr-prepare.json', ownership: 'generated', projections: [{ path: `${prefix}/release.md`, ownership: 'generated', renderer: { id: 'release_summary_markdown', version: '1' } }] }
  });
}

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

test('named artifact-routing profile: schema 0.2 selects a complete profile from catalog authority', async () => {
  const { root, storyId } = await namedProfileRepo();
  const resolved = await resolveArtifactRoutes(root, { storyId });
  assert.equal(resolved.profile, 'feature_packet');
  assert.equal(resolved.story_id, storyId);
  assert.equal(resolved.metadata_source, 'brainbase.stories');
  assert.equal(resolved.variables.feature_slug, 'payments');
  assert.equal(resolved.routes.task_plan.canonical.relative_path, `.vibepro/stories/${storyId}/tasks/tasks.json`);
  await writeFile(path.join(root, `docs/management/stories/active/${storyId}.md`), '---\nartifact_profile: governance_packet\nfeature_slug: payments\n---\n');
  await assert.rejects(() => resolveArtifactRoutes(root, { storyId }), (error) => error.code === 'metadata_mismatch');
});

test('named profile requires a complete matching Story mirror before writes', async () => {
  const { root, storyId } = await namedProfileRepo();
  const storyPath = path.join(root, `docs/management/stories/active/${storyId}.md`);
  for (const frontmatter of [
    '---\nstory_id: story-routing-profile\n---\n',
    '---\nstory_id: story-routing-profile\nartifact_profile: feature_packet\n---\n',
    '---\nstory_id: story-routing-profile\nfeature_slug: payments\n---\n'
  ]) {
    await writeFile(storyPath, frontmatter);
    await assert.rejects(() => resolveArtifactRoutes(root, { storyId }), (error) => error.code === 'missing_story_mirror');
  }
  await writeFile(storyPath, '---\nstory_id: story-routing-profile\nartifact_profile: feature_packet\nfeature_slug: other\n---\n');
  await assert.rejects(() => resolveArtifactRoutes(root, { storyId }), (error) => error.code === 'metadata_mismatch');
});

test('catalog metadata authority and Story frontmatter conflict fail closed', async () => {
  const { root, storyId } = await namedProfileRepo();
  const configPath = path.join(root, '.vibepro/config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  delete config.artifact_routing.profiles.feature_packet.artifacts.gate;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await assert.rejects(() => resolveArtifactRoutes(root, { storyId }), (error) => error.code === 'incomplete_profile');
});

test('task JSON remains read authority after Markdown regeneration', async () => {
  const { root, storyId } = await namedProfileRepo({ task_plan: { canonical: '.vibepro/stories/{story_id}/tasks/tasks.json', ownership: 'generated', projections: [{ path: 'docs/features/{feature_slug}/06_tasks.md', ownership: 'generated', renderer: { id: 'tasks_markdown', version: '1' } }] } });
  const route = await resolveArtifactRoute(root, 'task_plan', { storyId });
  const content = JSON.stringify({ story: { story_id: storyId }, tasks: [{ id: 'B', title: 'second' }, { id: 'A', title: 'first' }] });
  await writeArtifactProjections(root, route, content);
  const rendered = await readFile(path.join(root, 'docs/features/payments/06_tasks.md'), 'utf8');
  assert.match(rendered, /source_sha256=[a-f0-9]{64}/);
  assert.ok(rendered.indexOf('## A: first') < rendered.indexOf('## B: second'));
  await assert.rejects(() => writeArtifactProjections(root, route, JSON.stringify({ tasks: [{ id: 'A' }, { id: 'A' }] })), (error) => error.code === 'duplicate_task_id');
});

test('artifact resolve text and JSON expose ownership, canonical authority, profile, and renderer', async () => {
  const { root, storyId } = await namedProfileRepo({
    evidence: { canonical: '.vibepro/evidence/{story_id}', ownership: 'human_owned' },
    task_plan: { canonical: '.vibepro/stories/{story_id}/tasks/tasks.json', ownership: 'generated', projections: [{ path: 'docs/features/{feature_slug}/06_tasks.md', ownership: 'generated', renderer: { id: 'tasks_markdown', version: '1' } }] }
  });
  let textOutput = '';
  const textSink = { write(value) { textOutput += value; } };
  const textResult = await runCli(['artifacts', 'resolve', root, '--id', storyId], { stdout: textSink, stderr: textSink });
  assert.equal(textResult.exitCode, 0);
  assert.match(textOutput, /Profile: feature_packet/);
  assert.match(textOutput, new RegExp(`Variables: story_id=${storyId}; feature_slug=payments`));
  assert.match(textOutput, /evidence: ownership=human_owned; canonical=.*canonical-writer=owner; read-authority=/);
  assert.match(textOutput, /renderer=tasks_markdown@1/);
  let jsonOutput = '';
  const jsonSink = { write(value) { jsonOutput += value; } };
  const jsonResult = await runCli(['artifacts', 'resolve', root, '--id', storyId, '--json'], { stdout: jsonSink, stderr: jsonSink });
  assert.equal(jsonResult.exitCode, 0);
  const parsed = JSON.parse(jsonOutput);
  assert.equal(parsed.routes.evidence.canonical.ownership, 'human_owned');
  assert.equal(parsed.story_id, storyId);
  assert.equal(parsed.routes.evidence.canonical_owner, 'human_owned');
  assert.equal(parsed.routes.evidence.canonical_writer, 'owner');
  assert.equal(parsed.routes.evidence.writer, 'owner');
  assert.equal(parsed.routes.evidence.read_authority, parsed.routes.evidence.canonical.relative_path);
  const taskProjection = parsed.routes.task_plan.projections[0];
  assert.equal(taskProjection.path, undefined);
  assert.equal(taskProjection.relative_path, 'docs/features/payments/06_tasks.md');
  assert.equal(taskProjection.renderer_id, 'tasks_markdown');
  assert.equal(taskProjection.renderer_version, '1');
  assert.equal(taskProjection.lineage_required, true);
  assert.equal(taskProjection.overwrite_policy, 'replace_if_lineage_matches');

  let migrationOutput = '';
  const migrationSink = { write(value) { migrationOutput += value; } };
  const migrationResult = await runCli(['artifacts', 'migrate', root, '--id', storyId, '--dry-run'], { stdout: migrationSink, stderr: migrationSink });
  assert.equal(migrationResult.exitCode, 0);
  assert.match(migrationOutput, /Profile: feature_packet; feature_slug=payments/);
  assert.match(migrationOutput, /task_plan: action=.*reason=.*collision=.*ownership=generated; canonical-writer=vibepro; renderer=tasks_markdown@1/);
  assert.match(migrationOutput, /projection: action=.*reason=.*ownership=generated; renderer=tasks_markdown@1; path=docs\/features\/payments\/06_tasks\.md/);
});

test('projection lineage hashes exact routed canonical bytes and migration classifies noop then update', async () => {
  const { root, storyId } = await namedProfileRepo({
    task_plan: { canonical: '.vibepro/stories/{story_id}/tasks/tasks.json', ownership: 'generated', projections: [{ path: 'docs/features/{feature_slug}/06_tasks.md', ownership: 'generated', renderer: { id: 'tasks_markdown', version: '1' } }] }
  });
  const canonical = Buffer.from('{"story":{"story_id":"story-routing-profile"},"tasks":[]}\n');
  const canonicalPath = path.join(root, `.vibepro/stories/${storyId}/tasks/tasks.json`);
  await mkdir(path.dirname(canonicalPath), { recursive: true });
  await writeFile(canonicalPath, canonical);
  await projectArtifact(root, 'task_plan', { storyId });
  const projectionPath = path.join(root, 'docs/features/payments/06_tasks.md');
  const projection = await readFile(projectionPath, 'utf8');
  assert.match(projection, new RegExp(`source_sha256=${createHash('sha256').update(canonical).digest('hex')}`));

  let plan = await buildArtifactMigrationPlan(root, { storyId });
  assert.equal(plan.items.find((item) => item.kind === 'task_plan').projection_items[0].action, 'noop');
  await writeFile(canonicalPath, '{"story":{"story_id":"story-routing-profile"},"tasks":[{"id":"A"}]}\n');
  plan = await buildArtifactMigrationPlan(root, { storyId });
  assert.equal(plan.items.find((item) => item.kind === 'task_plan').projection_items[0].action, 'update');
});

test('schema 0.1 generated projections retain legacy byte-copy overwrite compatibility', async () => {
  const root = await repo({ artifact_routing: { schema_version: '0.1.0', artifacts: { architecture: {
    canonical: 'docs/architecture/{story_id}.md',
    projections: [{ path: 'docs/generated/{story_id}/architecture.md', generated: true }]
  } } } });
  const storyId = 'story-legacy-projection';
  const route = await resolveArtifactRoute(root, 'architecture', { storyId });
  await mkdir(path.dirname(route.canonical.absolute_path), { recursive: true });
  await writeFile(route.canonical.absolute_path, '# First\n');
  await projectArtifact(root, 'architecture', { storyId });
  await writeFile(route.canonical.absolute_path, '# Second\n');
  await projectArtifact(root, 'architecture', { storyId });
  assert.equal(await readFile(path.join(root, `docs/generated/${storyId}/architecture.md`), 'utf8'), '# Second\n');
});

test('migration classifies stale generated lineage metadata as update, not conflict', async () => {
  const { root, storyId } = await namedProfileRepo({
    task_plan: { canonical: '.vibepro/stories/{story_id}/tasks/tasks.json', ownership: 'generated', projections: [{ path: 'docs/features/{feature_slug}/06_tasks.md', ownership: 'generated', renderer: { id: 'tasks_markdown', version: '1' } }] }
  });
  const canonicalPath = path.join(root, `.vibepro/stories/${storyId}/tasks/tasks.json`);
  await mkdir(path.dirname(canonicalPath), { recursive: true });
  await writeFile(canonicalPath, '{"tasks":[]}\n');
  await projectArtifact(root, 'task_plan', { storyId });
  const projectionPath = path.join(root, 'docs/features/payments/06_tasks.md');
  const original = await readFile(projectionPath, 'utf8');
  for (const [current, stale] of [
    ['feature_slug=payments', 'feature_slug=old-payments'],
    ['profile=feature_packet', 'profile=old_profile'],
    ['renderer=tasks_markdown@1', 'renderer=tasks_markdown@0']
  ]) {
    await writeFile(projectionPath, original.replace(current, stale));
    const plan = await buildArtifactMigrationPlan(root, { storyId });
    const item = plan.items.find((entry) => entry.kind === 'task_plan').projection_items[0];
    assert.equal(item.action, 'update');
    assert.match(item.reason, /metadata is stale/);
    assert.equal(plan.status, 'ready');
  }
});

test('named profiles reject unknown renderer contracts before writing', async () => {
  const { root, storyId } = await namedProfileRepo({
    task_plan: { canonical: '.vibepro/stories/{story_id}/tasks/tasks.json', ownership: 'generated', projections: [{ path: 'docs/features/{feature_slug}/06_tasks.md', ownership: 'generated', renderer: { id: 'tasks_markdown', version: '999' } }] }
  });
  await assert.rejects(() => resolveArtifactRoutes(root, { storyId }), (error) => error.code === 'unsupported_renderer');
});

test('schema 0.2 validates every profile is complete, including an unselected profile', async () => {
  const { root, storyId } = await namedProfileRepo();
  const configPath = path.join(root, '.vibepro/config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  delete config.artifact_routing.profiles.governance_packet.artifacts.review;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await assert.rejects(() => resolveArtifactRoutes(root, { storyId }), (error) => error.code === 'incomplete_profile' && error.details.missing.includes('review'));
});

test('schema 0.2 requires a non-empty canonical for every kind in selected and unselected profiles', async (t) => {
  for (const [profileName, canonical] of [['feature_packet', undefined], ['governance_packet', '   ']]) {
    await t.test(profileName, async () => {
      const { root, storyId } = await namedProfileRepo();
      const configPath = path.join(root, '.vibepro/config.json');
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      if (canonical === undefined) delete config.artifact_routing.profiles[profileName].artifacts.gate.canonical;
      else config.artifact_routing.profiles[profileName].artifacts.gate.canonical = canonical;
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
      await assert.rejects(() => resolveArtifactRoutes(root, { storyId }), (error) => error.code === 'missing_canonical');
    });
  }
});

test('schema 0.2 rejects repository-global legacy artifacts instead of silently falling back', async () => {
  const root = await repo({ artifact_routing: { schema_version: '0.2.0', artifacts: { story: { canonical: 'legacy/{story_id}.md' } }, profiles: { feature_packet: completeProfile(), governance_packet: completeProfile() } } });
  await assert.rejects(() => resolveArtifactRoutes(root, { storyId: 'story-no-fallback' }), (error) => error.code === 'ambiguous_profile');
});

test('projectArtifact preflights generated projections before canonical mutation', async () => {
  const { root, storyId } = await namedProfileRepo({
    test_plan: { canonical: '.vibepro/test-plans/{story_id}.json', ownership: 'generated', projections: [{ path: 'docs/features/{feature_slug}/05_test_plan.md', ownership: 'generated', renderer: { id: 'test_plan_markdown', version: '1' } }] }
  });
  const canonicalPath = path.join(root, `.vibepro/test-plans/${storyId}.json`);
  const projectionPath = path.join(root, 'docs/features/payments/05_test_plan.md');
  await mkdir(path.dirname(canonicalPath), { recursive: true });
  await mkdir(path.dirname(projectionPath), { recursive: true });
  await writeFile(canonicalPath, 'canonical-before\n');
  await writeFile(projectionPath, 'human bytes\n');
  await assert.rejects(() => projectArtifact(root, 'test_plan', { storyId, writeCanonical: true, content: { status: 'new' } }), (error) => error.code === 'unmanaged_projection');
  assert.equal(await readFile(canonicalPath, 'utf8'), 'canonical-before\n');
  assert.equal(await readFile(projectionPath, 'utf8'), 'human bytes\n');
});

test('directory canonical migration hashes the lineage source file', async () => {
  const { root, storyId } = await namedProfileRepo({
    review: { canonical: '.vibepro/reviews/{story_id}', ownership: 'generated', projections: [{ path: 'docs/features/{feature_slug}/08_review.md', ownership: 'generated', renderer: { id: 'review_summary_markdown', version: '1' } }] }
  });
  const canonicalPath = path.join(root, `.vibepro/reviews/${storyId}/review-summary.json`);
  await projectArtifact(root, 'review', { storyId, writeCanonical: true, canonicalAbsolutePath: canonicalPath, content: { story_id: storyId, stage: 'architecture_spec', status: 'pass' } });
  const projection = await readFile(path.join(root, 'docs/features/payments/08_review.md'), 'utf8');
  assert.match(projection, new RegExp(`source=\\.vibepro/reviews/${storyId}/review-summary\\.json`));
  const plan = await buildArtifactMigrationPlan(root, { storyId });
  assert.equal(plan.items.find((item) => item.kind === 'review').projection_items[0].action, 'noop');
  assert.equal(plan.edits_performed, 0);
});

test('directory projection may advance lineage to another file in the same canonical directory only', async () => {
  const { root, storyId } = await namedProfileRepo({
    review: { canonical: '.vibepro/reviews/{story_id}', ownership: 'generated', projections: [{ path: 'docs/features/{feature_slug}/08_review.md', ownership: 'generated', renderer: { id: 'review_summary_markdown', version: '1' } }] }
  });
  const reviewDir = path.join(root, `.vibepro/reviews/${storyId}`);
  const architectureSummary = path.join(reviewDir, 'architecture_spec/review-summary.json');
  const implementationSummary = path.join(reviewDir, 'implementation/review-summary.json');
  await projectArtifact(root, 'review', { storyId, writeCanonical: true, canonicalAbsolutePath: architectureSummary, content: { stage: 'architecture_spec', status: 'pass' } });
  await projectArtifact(root, 'review', { storyId, writeCanonical: true, canonicalAbsolutePath: implementationSummary, content: { stage: 'implementation', status: 'pass' } });
  const projectionPath = path.join(root, 'docs/features/payments/08_review.md');
  const projection = await readFile(projectionPath, 'utf8');
  assert.match(projection, new RegExp(`source=\\.vibepro/reviews/${storyId}/implementation/review-summary\\.json`));

  const outsideSource = `.vibepro/reviews/another-story/review-summary.json`;
  await writeFile(projectionPath, projection.replace(`source=.vibepro/reviews/${storyId}/implementation/review-summary.json`, `source=${outsideSource}`));
  await assert.rejects(
    () => projectArtifact(root, 'review', { storyId, writeCanonical: true, canonicalAbsolutePath: implementationSummary, content: { stage: 'implementation', status: 'updated' } }),
    (error) => error.code === 'projection_lineage_mismatch' && error.details.actual === outsideSource
  );
});

test('directory migration refuses a lineage source symlink that escapes the repository', async () => {
  const { root, storyId } = await namedProfileRepo({
    review: { canonical: '.vibepro/reviews/{story_id}', ownership: 'generated', projections: [{ path: 'docs/features/{feature_slug}/08_review.md', ownership: 'generated', renderer: { id: 'review_summary_markdown', version: '1' } }] }
  });
  const outside = await mkdtemp(path.join(os.tmpdir(), 'vibepro-lineage-outside-'));
  await writeFile(path.join(outside, 'review-summary.json'), '{}\n');
  const canonicalDir = path.join(root, `.vibepro/reviews/${storyId}`);
  await mkdir(canonicalDir, { recursive: true });
  await symlink(path.join(outside, 'review-summary.json'), path.join(canonicalDir, 'review-summary.json'));
  const projectionPath = path.join(root, 'docs/features/payments/08_review.md');
  await mkdir(path.dirname(projectionPath), { recursive: true });
  await writeFile(projectionPath, `<!-- vibepro-projection story_id=${storyId} feature_slug=payments ownership=generated profile=feature_packet source=.vibepro/reviews/${storyId}/review-summary.json source_sha256=stale renderer=review_summary_markdown@1 direct_edit=false -->\n`);
  await assert.rejects(() => buildArtifactMigrationPlan(root, { storyId }), (error) => error.code === 'repository_traversal');
});

test('Functional Spec renderer preserves actual statement origin diagram shape in code-point order', async () => {
  const { root, storyId } = await namedProfileRepo({
    accepted_spec: { canonical: '.vibepro/spec/{story_id}/spec.json', ownership: 'generated', projections: [{ path: 'docs/features/{feature_slug}/02_functional_spec.md', ownership: 'generated', renderer: { id: 'functional_spec_markdown', version: '1' } }] }
  });
  await projectArtifact(root, 'accepted_spec', { storyId, writeCanonical: true, content: {
    story_id: storyId,
    clauses: [
      { id: 'ä', statement: 'later code point', origin: { code_refs: [{ file: 'src/z.js', anchor: 'z' }] } },
      { id: 'Z', statement: 'first code point', origin: { story_refs: [{ kind: 'acceptance_criteria', index: 0 }] } }
    ],
    diagrams: [{ kind: 'flow', mermaid: 'flowchart LR\n A --> B' }]
  } });
  const rendered = await readFile(path.join(root, 'docs/features/payments/02_functional_spec.md'), 'utf8');
  assert.ok(rendered.indexOf('## Z') < rendered.indexOf('## ä'));
  assert.match(rendered, /first code point/);
  assert.match(rendered, /"file":"src\/z\.js"/);
  assert.match(rendered, /### flow[\s\S]*flowchart LR/);
});

test('human-owned and curated bytes are never overwritten and schema 0.2 never falls back to legacy metadata', async () => {
  const { root, storyId } = await namedProfileRepo({
    evidence: { canonical: '.vibepro/evidence/{story_id}', ownership: 'human_owned' },
    review: { canonical: '.vibepro/reviews/{story_id}', ownership: 'generated', projections: [{ path: 'docs/features/{feature_slug}/08_review.md', ownership: 'curated' }] }
  });
  const humanPath = path.join(root, `.vibepro/evidence/${storyId}/evidence.json`);
  const curatedPath = path.join(root, 'docs/features/payments/08_review.md');
  await mkdir(path.dirname(humanPath), { recursive: true }); await writeFile(humanPath, 'human canonical\n');
  await mkdir(path.dirname(curatedPath), { recursive: true }); await writeFile(curatedPath, 'curated projection\n');
  const skipped = await projectArtifact(root, 'evidence', { storyId, writeCanonical: true, content: { changed: true } });
  assert.equal(skipped.skipped, 'human_owned');
  await assert.rejects(() => projectArtifact(root, 'review', { storyId, writeCanonical: true, canonicalFileName: 'review.json', content: { changed: true } }), (error) => error.code === 'curated_projection_write');
  assert.equal(await readFile(humanPath, 'utf8'), 'human canonical\n');
  assert.equal(await readFile(curatedPath, 'utf8'), 'curated projection\n');
  const configPath = path.join(root, '.vibepro/config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.brainbase.stories = [];
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await assert.rejects(() => resolveArtifactRoutes(root, { storyId }), (error) => error.code === 'missing_story_metadata');
});

test('review gate and release views expose ownership and lineage to users', async () => {
  const { root, storyId } = await namedProfileRepo({
    gate: { canonical: '.vibepro/pr/{story_id}/gate-dag.json', ownership: 'generated', projections: [{ path: 'docs/features/{feature_slug}/09_gate.md', ownership: 'generated', renderer: { id: 'gate_summary_markdown', version: '1' } }] },
    pr: { canonical: '.vibepro/pr/{story_id}/pr-prepare.json', ownership: 'generated', projections: [{ path: 'docs/features/{feature_slug}/10_release.md', ownership: 'generated', renderer: { id: 'release_summary_markdown', version: '1' } }] }
  });
  await writeArtifactProjections(root, await resolveArtifactRoute(root, 'gate', { storyId }), { status: 'blocked', gates: [{ id: 'z', status: 'fail' }, { id: 'a', status: 'pass' }] });
  await writeArtifactProjections(root, await resolveArtifactRoute(root, 'pr', { storyId }), { story_id: storyId, status: 'ready', gate_status: 'pass', ready_for_pr_create: true });
  const gate = await readFile(path.join(root, 'docs/features/payments/09_gate.md'), 'utf8');
  const release = await readFile(path.join(root, 'docs/features/payments/10_release.md'), 'utf8');
  assert.match(gate, /# Gate Summary[\s\S]*- a: pass[\s\S]*- z: fail/);
  assert.match(release, /# Release Summary[\s\S]*Ready for create: true/);
  assert.doesNotMatch(gate, /```json/);
  assert.doesNotMatch(release, /```json/);
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
  const trackerRoutes = await resolveArtifactRoutes(root, { storyId: 'STR-047' });
  assert.equal(trackerRoutes.variables.story_id, 'STR-047');
  assert.equal(
    trackerRoutes.routes.architecture.projections[0].relative_path,
    'docs/generated/STR-047/architecture.md',
    'opaque tracker story IDs must preserve case in resolved paths on case-sensitive filesystems'
  );
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

test('fresh checkout resolves and renders complete feature and governance packet lifecycle surfaces', async () => {
  const stories = [
    { story_id: 'story-feature-checkout', artifact_profile: 'feature_packet', feature_slug: 'checkout-feature' },
    { story_id: 'story-governance-checkout', artifact_profile: 'governance_packet', feature_slug: 'checkout-governance' }
  ];
  const source = await repo({ brainbase: { stories }, artifact_routing: { schema_version: '0.2.0', profiles: {
    feature_packet: projectedPacketProfile('docs/features/{feature_slug}'),
    governance_packet: projectedPacketProfile('docs/governance/{feature_slug}')
  } } });
  for (const story of stories) {
    const storyPath = path.join(source, `docs/management/stories/active/${story.story_id}.md`);
    await mkdir(path.dirname(storyPath), { recursive: true });
    await writeFile(storyPath, `---\nstory_id: ${story.story_id}\nartifact_profile: ${story.artifact_profile}\nfeature_slug: ${story.feature_slug}\n---\n`);
  }
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: source });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: source });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: source });
  await execFileAsync('git', ['add', '.'], { cwd: source });
  await execFileAsync('git', ['commit', '-m', 'test: packet profiles'], { cwd: source });
  const checkout = `${source}-profiles-checkout`;
  await execFileAsync('git', ['clone', '--quiet', source, checkout]);

  for (const story of stories) {
    const resolved = await resolveArtifactRoutes(checkout, { storyId: story.story_id });
    assert.equal(resolved.profile, story.artifact_profile);
    assert.deepEqual(Object.keys(resolved.routes), ['story', 'architecture', 'accepted_spec', 'task_plan', 'graphify', 'evidence', 'test_plan', 'review', 'gate', 'pr']);
    for (const route of Object.values(resolved.routes)) assert.equal(route.feature_slug, story.feature_slug);
    const architecturePath = resolved.routes.architecture.canonical.absolute_path;
    await mkdir(path.dirname(architecturePath), { recursive: true }); await writeFile(architecturePath, '# Architecture\n');
    await writeArtifactProjections(checkout, resolved.routes.architecture, await readFile(architecturePath));
    await projectArtifact(checkout, 'accepted_spec', { storyId: story.story_id, writeCanonical: true, content: { story_id: story.story_id, clauses: [] } });
    await projectArtifact(checkout, 'task_plan', { storyId: story.story_id, writeCanonical: true, content: { story: { story_id: story.story_id }, tasks: [] } });
    await projectArtifact(checkout, 'evidence', { storyId: story.story_id, writeCanonical: true, canonicalFileName: 'evidence.json', content: { story_id: story.story_id, gate_status: 'pass', findings: [] } });
    await projectArtifact(checkout, 'test_plan', { storyId: story.story_id, writeCanonical: true, content: { story_id: story.story_id, status: 'ready', commands: ['node --test'] } });
    await projectArtifact(checkout, 'review', { storyId: story.story_id, writeCanonical: true, canonicalFileName: 'review-summary.json', content: { story_id: story.story_id, stage: 'gate', status: 'pass' } });
    await projectArtifact(checkout, 'gate', { storyId: story.story_id, writeCanonical: true, content: { story_id: story.story_id, status: 'passed', nodes: [] } });
    await projectArtifact(checkout, 'pr', { storyId: story.story_id, writeCanonical: true, content: { story_id: story.story_id, status: 'ready', gate_status: 'pass', ready_for_pr_create: true } });
    await mkdir(resolved.routes.graphify.canonical.absolute_path, { recursive: true });
    const outputRoot = path.join(checkout, story.artifact_profile === 'feature_packet' ? 'docs/features' : 'docs/governance', story.feature_slug);
    assert.match(await readFile(path.join(outputRoot, 'gate.md'), 'utf8'), /# Gate Summary[\s\S]*Status: passed/);
    assert.match(await readFile(path.join(outputRoot, 'release.md'), 'utf8'), /# Release Summary[\s\S]*Ready for create: true/);
    let textOutput = ''; await runCli(['artifacts', 'resolve', checkout, '--id', story.story_id], { stdout: { write: (v) => { textOutput += v; } } });
    assert.match(textOutput, new RegExp(`Profile: ${story.artifact_profile}`));
    let jsonOutput = ''; await runCli(['artifacts', 'resolve', checkout, '--id', story.story_id, '--json'], { stdout: { write: (v) => { jsonOutput += v; } } });
    assert.equal(JSON.parse(jsonOutput).story_id, story.story_id);
    let statusOutput = ''; const statusResult = await runCli(['story', 'status', checkout, '--id', story.story_id], { stdout: { write: (v) => { statusOutput += v; } }, stderr: { write: (v) => { statusOutput += v; } } });
    assert.equal(statusResult.exitCode, 0, statusOutput);
    assert.match(statusOutput, /## Artifact Authority[\s\S]*canonical-writer=(?:owner|vibepro); read-authority=/);
    assert.match(statusOutput, /projection: ownership=generated; path=.*; renderer=[a-z_]+@1/);
    const migration = await buildArtifactMigrationPlan(checkout, { storyId: story.story_id });
    assert.equal(migration.edits_performed, 0);
    assert.equal(migration.status, 'ready');
    assert.equal(migration.unresolved.length, 0);
    assert.equal(migration.items.every((item) => item.action === 'noop'), true);
    assert.equal(migration.items.flatMap((item) => item.projection_items).every((item) => item.action === 'noop'), true);
  }
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

test('task plan migration treats a manifest-bound generated legacy mirror as noop but unknown Markdown as conflict', async () => {
  const { root, storyId } = await namedProfileRepo();
  const source = path.join(root, `.vibepro/stories/${storyId}/tasks/tasks.md`);
  const destination = path.join(root, `.vibepro/stories/${storyId}/tasks/tasks.json`);
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(destination, `${JSON.stringify({ story: { story_id: storyId }, tasks: [] })}\n`);
  await writeFile(source, `# VibePro 生成タスク\n\n| 項目 | 内容 |\n|------|------|\n| Story ID | ${storyId} |\n| Run ID | run-generated |\n`);
  await buildArtifactMigrationPlan(root, { storyId });
  const manifestPath = path.join(root, '.vibepro/vibepro-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.runs = [{
    run_id: 'run-generated',
    story_id: storyId,
    artifacts: {
      story_tasks_markdown: `.vibepro/stories/${storyId}/tasks/tasks.md`,
      story_tasks_json: `.vibepro/stories/${storyId}/tasks/tasks.json`
    }
  }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  let plan = await buildArtifactMigrationPlan(root, { storyId });
  assert.equal(plan.items.find((item) => item.kind === 'task_plan').action, 'noop');
  assert.equal(plan.unresolved.length, 0);

  await writeFile(source, '# Human task notes\n');
  plan = await buildArtifactMigrationPlan(root, { storyId });
  assert.equal(plan.items.find((item) => item.kind === 'task_plan').action, 'conflict');
  assert.equal(plan.unresolved.some((entry) => entry.kind === 'task_plan'), true);
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

test('task plan JSON writers honor a custom routed canonical instead of the legacy workspace path', async () => {
  const root = await repo({ artifact_routing: { artifacts: { task_plan: { canonical: 'artifacts/{feature_slug}/tasks.json' } } } });
  const story = { story_id: 'story-checkout-safe', title: 'Checkout safe' };
  const generated = await createStoryTasks(root, {
    story,
    evidence: { findings: [], action_candidates: [], gates: [] },
    runId: 'routing-test',
    gateStatus: 'pass'
  });
  assert.equal(generated.artifacts.story_tasks_json, 'artifacts/checkout-safe/tasks.json');
  await access(path.join(root, 'artifacts/checkout-safe/tasks.json'));
  await assert.rejects(access(path.join(root, '.vibepro/stories/story-checkout-safe/tasks/tasks.json')));

  await mkdir(path.join(root, '.vibepro/stories'), { recursive: true });
  await writeFile(path.join(root, '.vibepro/stories/story-plan.json'), `${JSON.stringify({
    generated_at: '2026-07-21T00:00:00.000Z',
    priority_stories: [story],
    task_candidates: [{ id: 'task-checkout', story_id: story.story_id, title: 'Checkout task', target_files: ['src/index.js'] }]
  }, null, 2)}\n`);
  const planned = await createTasksFromPlan(root, { storyId: story.story_id });
  assert.equal(planned.results[0].artifacts.json, 'artifacts/checkout-safe/tasks.json');
  const routed = JSON.parse(await readFile(path.join(root, 'artifacts/checkout-safe/tasks.json'), 'utf8'));
  assert.equal(routed.source_run.run_id, 'story-plan');
  await assert.rejects(access(path.join(root, '.vibepro/stories/story-checkout-safe/tasks/tasks.json')));
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

test('Story Architecture Spec Task Graphify Review Gate PR status migration use one profile', async () => {
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

test('named profile Graphify review and PR producers leave the removed legacy directory absent', async () => {
  const storyId = 'story-named-producer-routing';
  const featureSlug = 'named-producer-routing';
  const root = await repo();
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src/index.js'), 'export const value = 1;\n');
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await runCli(['init', root, '--story-id', storyId, '--title', 'Named producer routing']);
  const configPath = path.join(root, '.vibepro/config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const routedProfile = completeProfile({
    graphify: { canonical: '.vibepro/packets/{feature_slug}/graphify', ownership: 'generated' },
    review: { canonical: '.vibepro/packets/{feature_slug}/reviews', ownership: 'generated', projections: [{ path: 'docs/features/{feature_slug}/08_review.md', ownership: 'generated', renderer: { id: 'review_summary_markdown', version: '1' } }] },
    gate: { canonical: '.vibepro/packets/{feature_slug}/gate-dag.json', ownership: 'generated', projections: [{ path: 'docs/features/{feature_slug}/09_gate.md', ownership: 'generated', renderer: { id: 'gate_summary_markdown', version: '1' } }] },
    pr: { canonical: '.vibepro/packets/{feature_slug}/pr-prepare.json', ownership: 'generated', projections: [{ path: 'docs/features/{feature_slug}/10_release.md', ownership: 'generated', renderer: { id: 'release_summary_markdown', version: '1' } }] }
  });
  config.artifact_routing = { schema_version: '0.2.0', profiles: { feature_packet: routedProfile, governance_packet: completeProfile() } };
  const entry = config.brainbase.stories.find((story) => story.story_id === storyId);
  entry.artifact_profile = 'feature_packet'; entry.feature_slug = featureSlug;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const storyPath = path.join(root, `docs/management/stories/active/${storyId}.md`);
  await mkdir(path.dirname(storyPath), { recursive: true });
  await writeFile(storyPath, `---\nstory_id: ${storyId}\ntitle: Named producer routing\nstatus: active\nartifact_profile: feature_packet\nfeature_slug: ${featureSlug}\n---\n\n# Named producer routing\n`);
  const graphSource = path.join(root, 'graph-source');
  await mkdir(graphSource, { recursive: true });
  await writeFile(path.join(graphSource, 'graph.json'), '{"nodes":[],"edges":[]}\n');
  await writeFile(path.join(graphSource, 'GRAPH_REPORT.md'), '# Graph\n');
  await importGraphifyArtifacts(root, { storyId, sourceDir: 'graph-source' });
  await rm(path.join(root, '.vibepro/graphify'), { recursive: true, force: true });
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'chore: named routing fixture'], { cwd: root });
  await execFileAsync('git', ['switch', '-c', 'feature/named-routing'], { cwd: root });
  await writeFile(path.join(root, 'src/index.js'), 'export const value = 2;\n');
  await execFileAsync('git', ['add', 'src/index.js'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'feat: routed producer'], { cwd: root });
  let output = '';
  const io = { stdout: { write: (v) => { output += v; } }, stderr: { write: (v) => { output += v; } } };
  const review = await runCli(['review', 'prepare', root, '--id', storyId, '--stage', 'architecture_spec', '--role', 'regression_risk', '--json'], io);
  assert.equal(review.exitCode, 0, output);
  const start = await runCli([
    'review', 'start', root, '--id', storyId, '--stage', 'architecture_spec', '--role', 'regression_risk',
    '--agent-system', 'codex', '--agent-id', 'routing-test-agent', '--json'
  ], io);
  assert.equal(start.exitCode, 0, output);
  const prepare = await runCli(['pr', 'prepare', root, '--base', 'main', '--story-id', storyId, '--allow-extra-files', '--evidence-depth', 'full', '--evidence-depth-reason', 'named routing regression', '--evidence-depth-consumer', 'artifact-routing-test', '--evidence-depth-target', 'gate:e2e'], io);
  assert.equal(prepare.exitCode, 0, output);
  await access(path.join(root, `.vibepro/packets/${featureSlug}/graphify/graph.json`));
  await access(path.join(root, `.vibepro/packets/${featureSlug}/reviews/architecture_spec/review-plan.json`));
  await access(path.join(root, `.vibepro/packets/${featureSlug}/gate-dag.json`));
  await access(path.join(root, `.vibepro/packets/${featureSlug}/pr-prepare.json`));
  await assert.rejects(access(path.join(root, '.vibepro/graphify')));
  await assert.rejects(access(path.join(root, `.vibepro/reviews/${storyId}`)));
  await assert.rejects(access(path.join(root, `.vibepro/pr/${storyId}/gate-dag.json`)));
  await assert.rejects(access(path.join(root, `.vibepro/pr/${storyId}/pr-prepare.json`)));

  let migrationOutput = '';
  const migration = await runCli(['artifacts', 'migrate', root, '--id', storyId, '--dry-run', '--json'], {
    stdout: { write: (v) => { migrationOutput += v; } },
    stderr: { write: (v) => { migrationOutput += v; } }
  });
  assert.equal(migration.exitCode, 0, migrationOutput);
  const migrationPlan = JSON.parse(migrationOutput);
  assert.equal(migrationPlan.status, 'ready', migrationOutput);
  assert.deepEqual(migrationPlan.unresolved, []);
});

test('story derive binds global Graphify import to the configured current Story under schema 0.2', async () => {
  const { root, storyId } = await namedProfileRepo();
  const graphSource = path.join(root, 'graph-source');
  await mkdir(graphSource, { recursive: true });
  await writeFile(path.join(graphSource, 'graph.json'), '{"nodes":[],"edges":[]}\n');
  await writeFile(path.join(graphSource, 'GRAPH_REPORT.md'), '# Graph\n');
  const result = await runCli(['story', 'derive', root, '--from', path.join('graph-source', 'graph.json'), '--json']);
  assert.equal(result.exitCode, 0, result.error?.message);
  assert.match(result.result.graph.graphifyDir, /\.vibepro\/graphify$/);
  assert.doesNotMatch(JSON.stringify(result.result), /story-default/);
  await access(path.join(root, '.vibepro/graphify/graph.json'));
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
