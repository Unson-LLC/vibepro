import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function workflowJob(workflow, name) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `missing job ${name}`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z][a-z-]*:\n/u);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

test('story-vibepro-release-oidc-push-trigger spec maps every clause to an acceptance criterion and a concrete test', async () => {
  const story = await readFile(
    path.join(root, 'docs/management/stories/active/story-vibepro-release-oidc-push-trigger.md'),
    'utf8'
  );
  const acceptanceCriteria = [...story.matchAll(/^- (AC-\d+):/gmu)].map((match) => match[1]);
  assert.deepEqual(acceptanceCriteria, ['AC-1', 'AC-2', 'AC-3', 'AC-4', 'AC-5', 'AC-6']);

  const spec = JSON.parse(
    await readFile(path.join(root, '.vibepro/spec/story-vibepro-release-oidc-push-trigger/spec.json'), 'utf8')
  );
  assert.equal(spec.story_id, 'story-vibepro-release-oidc-push-trigger');
  assert.ok(spec.clauses.length > 0);

  const referenced = new Set();
  const fileContents = new Map();
  const readTestFile = async (relative) => {
    if (!fileContents.has(relative)) {
      fileContents.set(relative, await readFile(path.join(root, relative), 'utf8'));
    }
    return fileContents.get(relative);
  };

  for (const clause of spec.clauses) {
    const storyRefs = clause.origin?.story_refs ?? [];
    const criteriaRefs = storyRefs.filter((reference) => reference.kind === 'acceptance_criteria');
    assert.ok(criteriaRefs.length > 0, `${clause.id} must reference an acceptance criterion`);
    for (const reference of criteriaRefs) {
      assert.ok(acceptanceCriteria.includes(reference.ac_id), clause.id);
      referenced.add(reference.ac_id);
    }

    const testRefs = clause.origin?.test_refs ?? [];
    assert.ok(testRefs.length > 0, `${clause.id} must reference at least one test`);
    for (const reference of testRefs) {
      const content = await readTestFile(reference.file);
      const single = `test('${reference.case}'`;
      const backtick = `test(\`${reference.case}\``;
      assert.ok(content.includes(single) || content.includes(backtick), `${clause.id} ${reference.case}`);
    }

    if (clause.type === 'invariant') {
      const patterns = clause.verifiable_by?.test_pattern;
      assert.ok(Array.isArray(patterns) && patterns.length > 0, `${clause.id} must have a test_pattern`);
      for (const pattern of patterns) {
        const content = await readTestFile(pattern.file_glob);
        assert.ok(content.includes(pattern.must_contain), `${clause.id} ${pattern.file_glob} ${pattern.must_contain}`);
      }
    }
  }

  assert.deepEqual([...referenced].sort(), [...acceptanceCriteria].sort());
});

test('npm Trusted Publisher registration values are pinned by the publishing workflows', async () => {
  const postMerge = await readFile(path.join(root, '.github/workflows/post-merge-release.yml'), 'utf8');
  const npmPublish = await readFile(path.join(root, '.github/workflows/npm-publish.yml'), 'utf8');

  const release = workflowJob(postMerge, 'release');
  assert.match(release, /id-token: write/u);
  assert.match(release, /runs-on: ubuntu-latest/u);
  assert.doesNotMatch(release, /^\s+environment:/mu);

  // #599: no GitHub environment on either publish job; an environment claim in
  // the OIDC token would have to match the npm Trusted Publisher entry.
  const publish = workflowJob(npmPublish, 'publish');
  assert.doesNotMatch(publish, /^\s+environment:/mu);
  assert.doesNotMatch(postMerge, /^\s+environment:/mu);
  assert.doesNotMatch(npmPublish, /^\s+environment:/mu);
  assert.match(publish, /id-token: write/u);
  assert.match(publish, /runs-on: ubuntu-latest/u);

  const script = await readFile(path.join(root, 'scripts/post-merge-release.mjs'), 'utf8');
  assert.ok(script.includes("'dist-tag', 'add'"));

  const architecture = await readFile(
    path.join(root, 'docs/architecture/vibepro-pr-driven-continuous-release.md'),
    'utf8'
  );
  assert.ok(architecture.includes('post-merge-release.yml'));
  assert.ok(architecture.includes('npm-publish.yml'));
  assert.ok(architecture.includes('dist-tag'));
});
