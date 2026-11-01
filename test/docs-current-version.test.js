import './support/scratch-tmpdir.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { siteConfig as config, resolveNpmTags, loadSiteConfig, registryTags } from './support/docs-site-config.js';
import { projectPublishedVersion } from '../scripts/post-merge-release.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const { version } = JSON.parse(await read('package.json'));

test('AC1: docs softwareVersion equals resolved npm latest; source version equals package.json', () => {
  const schema = config.head.find(([tag, attrs]) => tag === 'script' && attrs.type === 'application/ld+json');
  assert.equal(JSON.parse(schema[2]).softwareVersion, registryTags.latest);
  assert.equal(config.themeConfig.version, version);
});
for (const locale of ['', 'ja/']) {
  test(`AC2: ${locale || 'en/'} home displays published npm latest`, async () => {
    const home = await read(`docs/${locale}index.md`);
    assert.match(home, /<code>{{ site.themeConfig.npmLatest }}<\/code>/);
    assert.doesNotMatch(home, /0\.2\.0-beta\.29/);
  });
  test(`AC3: ${locale || 'en/'} channel rows use their resolved versions and authority`, async () => {
    const history = await read(`docs/${locale}reference/version-history.md`);
    const rows = history.split('\n').filter(line => /^\| (npm `(?:latest|beta)`|Repository `main`)/.test(line));
    assert.equal(rows.length, 3);
    for (const [index, binding] of ['npmLatest', 'npmBeta', 'version'].entries()) {
      assert.ok(rows[index].includes(`{{ site.themeConfig.${binding} }}`));
      if (index < 2) assert.ok(rows[index].includes('{{ site.themeConfig.npmTagsSource }}'));
    }
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
    for (const locale of ['', 'ja/']) {
      const file = `docs/${locale}reference/version-history.md`;
      const npmRows = content => content.split('\n').filter(line => line.startsWith('| npm `'));
      assert.deepEqual(npmRows(await readFile(path.join(root, file), 'utf8')), npmRows(await read(file)));
    }
    assert.equal(await readFile(path.join(root, 'docs/.vitepress/config.mjs'), 'utf8'), await read('docs/.vitepress/config.mjs'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('registry success resolves distinct dist-tags with a five-second timeout', async () => {
  const tags = await resolveNpmTags('0.2.0-beta.33', async (url, { signal }) => {
    assert.equal(url, 'https://registry.npmjs.org/-/package/vibepro/dist-tags');
    assert.ok(signal instanceof AbortSignal);
    assert.equal(signal.aborted, false);
    return { ok: true, json: async () => registryTags };
  });
  assert.deepEqual(tags, { npmLatest: registryTags.latest, npmBeta: registryTags.beta, npmTagsSource: 'npm registry' });
  assert.equal(config.themeConfig.npmLatest, registryTags.latest);
  assert.equal(config.themeConfig.npmBeta, registryTags.beta);
  assert.equal(config.themeConfig.npmTagsSource, 'npm registry');
});

test('registry failure uses package.json and labels the offline fallback', async () => {
  const { default: offlineConfig } = await loadSiteConfig(async () => { throw new Error('offline'); }, 'offline');
  assert.equal(offlineConfig.themeConfig.npmLatest, version);
  assert.equal(offlineConfig.themeConfig.npmBeta, version);
  assert.equal(offlineConfig.themeConfig.npmTagsSource, 'package.json (offline fallback)');
  const schema = offlineConfig.head.find(([tag, attrs]) => tag === 'script' && attrs.type === 'application/ld+json');
  assert.equal(JSON.parse(schema[2]).softwareVersion, version);
});

for (const [name, response] of [
  ['HTTP error', { ok: false }],
  ['missing beta', { ok: true, json: async () => ({ latest: registryTags.latest }) }],
  ['invalid JSON', { ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } }]
]) {
  test(`registry ${name} uses the labeled fallback`, async () => {
    assert.deepEqual(await resolveNpmTags(version, async () => response), {
      npmLatest: version, npmBeta: version, npmTagsSource: 'package.json (offline fallback)'
    });
  });
}
