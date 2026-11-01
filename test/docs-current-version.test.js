import './support/scratch-tmpdir.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import config from '../docs/.vitepress/config.mjs';
import { projectPublishedVersion } from '../scripts/post-merge-release.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const { version } = JSON.parse(await read('package.json'));

test('AC1: docs softwareVersion and theme version equal package.json', () => {
  const schema = config.head.find(([tag, attrs]) => tag === 'script' && attrs.type === 'application/ld+json');
  assert.equal(JSON.parse(schema[2]).softwareVersion, version);
  assert.equal(config.themeConfig.version, version);
});
for (const locale of ['', 'ja/']) {
  test(`AC2: ${locale || 'en/'} home displays the build version`, async () => {
    const home = await read(`docs/${locale}index.md`);
    assert.match(home, /<code>{{ site.themeConfig.version }}<\/code>/);
    assert.doesNotMatch(home, /0\.2\.0-beta\.29/);
  });
  test(`AC3: ${locale || 'en/'} channel rows use the build version`, async () => {
    const history = await read(`docs/${locale}reference/version-history.md`);
    const rows = history.split('\n').filter(line => /^\| (npm `(?:latest|beta)`|Repository `main`)/.test(line));
    assert.equal(rows.length, 3);
    for (const row of rows) assert.ok(row.includes('{{ site.themeConfig.version }}'));
  });
  test(`AC4: ${locale || 'en/'} verified releases have npm dates and links; unpublished beta.33 is omitted`, async () => {
    const index = await read(`docs/${locale}releases/index.md`);
    for (const [n, date] of [[31, '2026-10-15'], [32, '2026-10-15'], [34, '2026-10-18']]) {
      assert.ok(index.includes(`| ${date} | [\`0.2.0-beta.${n}\`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.${n}) | npm \`beta\` / \`latest\` |`));
    }
    assert.ok(!index.includes('/v/0.2.0-beta.33)'));
  });
}
test('release projection accepts build-time version bindings', async () => {
  const nextVersion = version.replace(/\d+$/, value => String(Number(value) + 1));
  const root = await mkdtemp(path.join(tmpdir(), 'docs-version-'));
  try {
    for (const file of ['docs/.vitepress/config.mjs', ...['', 'ja/'].flatMap(locale => ['reference/version-history.md', 'guide/release-and-audit.md', 'releases/index.md'].map(file => `docs/${locale}${file}`))]) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await cp(new URL(`../${file}`, import.meta.url), path.join(root, file));
    }
    assert.equal(await projectPublishedVersion(root, version, nextVersion, '2026-11-01T00:00:00Z'), true);
    assert.match(await readFile(path.join(root, 'docs/reference/version-history.md'), 'utf8'), /\{\{ site.themeConfig.version \}\}/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
