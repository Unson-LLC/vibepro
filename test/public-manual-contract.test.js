import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('public manual states the current positioning and human authority boundary', async () => {
  const [english, japanese, englishOverview, japaneseOverview] = await Promise.all([
    readFile(path.join(root, 'docs/index.md'), 'utf8'),
    readFile(path.join(root, 'docs/ja/index.md'), 'utf8'),
    readFile(path.join(root, 'docs/guide/what-is-vibepro.md'), 'utf8'),
    readFile(path.join(root, 'docs/ja/guide/what-is-vibepro.md'), 'utf8')
  ]);

  assert.match(english, /Make the product journey visible/);
  assert.match(english, /Humans hold the entry and exit decisions/);
  assert.match(japanese, /プロダクトジャーニーを可視化する/);
  assert.match(japanese, /人間が入口と出口を握ります/);
  assert.match(englishOverview, /repository-local control plane/);
  assert.match(japaneseOverview, /リポジトリローカル制御基盤/);
  for (const overview of [englishOverview, japaneseOverview]) {
    assert.match(overview, /Story/);
    assert.match(overview, /Architecture/);
    assert.match(overview, /Spec/);
    assert.match(overview, /adjudicat/i);
    assert.match(overview, /execute merge/);
  }
});

test('public build configuration excludes internal operating corpora', async () => {
  const config = await readFile(path.join(root, 'docs/.vitepress/config.mjs'), 'utf8');
  for (const internalPath of ['architecture/**', 'management/**', 'specs/**', 'stories/**']) {
    assert.match(config, new RegExp(internalPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(config, /vibepro-source-commit/);
  assert.match(config, /application\/ld\+json/);
  await Promise.all([
    readFile(path.join(root, 'docs/public/robots.txt'), 'utf8'),
    readFile(path.join(root, 'docs/public/llms.txt'), 'utf8')
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
