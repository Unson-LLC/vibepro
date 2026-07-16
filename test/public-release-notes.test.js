import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('VRNH-AC-001/002/004 release index separates published versions from the PR snapshot', async () => {
  for (const path of ['docs/ja/releases/index.md', 'docs/releases/index.md']) {
    const content = await read(path);
    assert.match(content, /281/);
    assert.match(content, /273/);
    assert.match(content, /0\.1\.0-beta\.0/);
    assert.match(content, /0\.1\.0-alpha\.0/);
    assert.match(content, /v0\.1\.0-internal-beta\.1/);
  }
});

test('VRNH-AC-003/007 monthly notes preserve language parity and PR evidence', async () => {
  for (const month of ['01', '05', '06', '07']) {
    const [ja, en] = await Promise.all([
      read(`docs/ja/releases/2026-${month}.md`),
      read(`docs/releases/2026-${month}.md`)
    ]);
    assert.match(ja, /https:\/\/github\.com\/Unson-LLC\/vibepro\/pull\/\d+/);
    assert.match(en, /https:\/\/github\.com\/Unson-LLC\/vibepro\/pull\/\d+/);
  }
});

test('VRNH-AC-005/006 public navigation and build contract require release notes', async () => {
  const [config, contract, jaVersion, enVersion] = await Promise.all([
    read('docs/.vitepress/config.mjs'),
    read('scripts/check-public-manual-build.mjs'),
    read('docs/ja/reference/version-history.md'),
    read('docs/reference/version-history.md')
  ]);
  assert.match(config, /\/releases\//);
  assert.match(config, /\/ja\/releases\//);
  for (const route of ['releases/index.html', 'ja/releases/index.html', 'releases/2026-07.html', 'ja/releases/2026-07.html']) {
    assert.match(contract, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(jaVersion, /\/ja\/releases\//);
  assert.match(enVersion, /\/releases\//);
});
