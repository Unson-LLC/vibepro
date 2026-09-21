import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { validateSpec } from '../src/spec-validator.js';

const root = process.cwd();

test('public manual states the current positioning and human authority boundary', async () => {
  const [english, japanese, englishOverview, japaneseOverview] = await Promise.all([
    readFile(path.join(root, 'docs/index.md'), 'utf8'),
    readFile(path.join(root, 'docs/ja/index.md'), 'utf8'),
    readFile(path.join(root, 'docs/guide/what-is-vibepro.md'), 'utf8'),
    readFile(path.join(root, 'docs/ja/guide/what-is-vibepro.md'), 'utf8')
  ]);

  assert.match(english, /Bring the reason for a change into its PR/);
  assert.match(japanese, /変更の目的を、PRレビューまで届ける/);
  assert.match(englishOverview, /maintain|maintenance/i);
  assert.match(japaneseOverview, /更新|維持|保守/);
  for (const overview of [englishOverview, japaneseOverview]) {
    assert.match(overview, /Story/);
    assert.match(overview, /Spec/);
    assert.match(overview, /verification|検証/i);
    assert.match(overview, /review|レビュー/i);
    assert.match(overview, /PR/);
    assert.match(overview, /Gate DAG/i);
    assert.match(overview, /approval|approve|承認/i);
    assert.match(overview, /merge|マージ/i);
    assert.match(overview, /README/);
  }
});

test('first-change guide distinguishes draft records, finalization, and actual review', async () => {
  for (const locale of ['', 'ja/']) {
    const content = await readFile(path.join(root, `docs/${locale}guide/control-loop.md`), 'utf8');
    assert.match(content, /--draft/);
    assert.match(content, /--final/);
    assert.match(content, /Graphify/);
    assert.match(content, /needs_changes/);
    assert.match(content, /pr-body\.md/);
    assert.match(content, /no accepted spec found/);
    assert.match(content, /docs\/management\/stories\/active\/story-example\.md/);
    const example = content.match(/```json\n([\s\S]*?)\n```/);
    assert.ok(example, 'Spec input is shown instead of referencing an unexplained file');
    const spec = JSON.parse(example[1]);
    assert.equal(spec.schema_version, '0.1.0');
    assert.equal(spec.story_id, 'story-example');
    assert.equal(spec.clauses[0].origin.story_refs[0].kind, 'acceptance_criteria');
    const validation = await validateSpec(root, spec, { expectedStoryId: 'story-example' });
    assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  }
});

test('public manual explains the advisory senior engineering judgment DAG in both locales', async () => {
  const [config, english, japanese, englishMap, japaneseMap] = await Promise.all([
    readFile(path.join(root, 'docs/.vitepress/config.mjs'), 'utf8'),
    readFile(path.join(root, 'docs/guide/senior-engineering-judgment.md'), 'utf8'),
    readFile(path.join(root, 'docs/ja/guide/senior-engineering-judgment.md'), 'utf8'),
    readFile(path.join(root, 'docs/guide/feature-map.md'), 'utf8'),
    readFile(path.join(root, 'docs/ja/guide/feature-map.md'), 'utf8')
  ]);

  assert.match(config, /Senior Engineering Judgment/);
  assert.match(config, /シニアエンジニア判断/);
  for (const guide of [english, japanese]) {
    assert.match(guide, /vibepro judgment evaluate/);
    assert.match(guide, /VALUE/);
    assert.match(guide, /SIMPLIFY/);
    assert.match(guide, /VALIDATE/);
    assert.match(guide, /human_ci_repository_rules/);
    assert.match(guide, /ready_for_pr_create/);
    assert.match(guide, /merge_allowed/);
  }
  assert.match(english, /advisory decision support/i);
  assert.match(japanese, /助言型の意思決定支援/);
  assert.match(englishMap, /`judgment evaluate`/);
  assert.match(japaneseMap, /`judgment evaluate`/);
});

test('public build configuration excludes internal operating corpora', async () => {
  const config = await readFile(path.join(root, 'docs/.vitepress/config.mjs'), 'utf8');
  for (const internalPath of [
    'architecture/**',
    'management/**',
    'specs/**',
    'stories/**',
    'contracts/**',
    'frames/**',
    'marketing/**',
    'playbooks/**',
    'static_site/**'
  ]) {
    assert.match(config, new RegExp(internalPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const internalReference of [
    'reference/gate-tuning/**',
    'reference/vibepro-ui-journey-e2e-dogfood.md'
  ]) {
    assert.match(config, new RegExp(internalReference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(config, /vibepro-source-commit/);
  assert.match(config, /VIBEPRO_SOURCE_COMMIT/);
  assert.match(config, /\$\{head\}-dirty/);
  assert.match(config, /application\/ld\+json/);
  await Promise.all([
    readFile(path.join(root, 'docs/public/robots.txt'), 'utf8'),
    readFile(path.join(root, 'docs/public/llms.txt'), 'utf8'),
    readFile(path.join(root, 'docs/public/assets/vibepro-header.png'))
  ]);
});

test('public guides do not use retired command argument contracts', async () => {
  const files = await markdownFiles([
    path.join(root, 'docs/guide'),
    path.join(root, 'docs/ja/guide')
  ]);
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    assert.doesNotMatch(content, /vibepro pr prepare \. --id(?:\s|$)/, file);
    assert.doesNotMatch(content, /--status passed(?:\s|$)/, file);
    for (const block of content.matchAll(/```(?:bash|sh|yaml)\n([\s\S]*?)```/g)) {
      assert.doesNotMatch(block[1], /(?:vibepro|vibepro@beta)\s+(?:execute|gate|checkpoint|check-pack)\s/, file);
    }
  }
});

async function markdownFiles(directories) {
  const output = [];
  for (const directory of directories) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) output.push(...await markdownFiles([target]));
      if (entry.isFile() && entry.name.endsWith('.md')) output.push(target);
    }
  }
  return output;
}
