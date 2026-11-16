import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  checkPublicManualBuild as checkBuild,
  findUnlistedPublishedVersions,
  FORBIDDEN_PUBLIC_CORPORA,
  REQUIRED_PUBLIC_ROUTES
} from '../scripts/check-public-manual-build.mjs';

const checkPublicManualBuild = (dist) => checkBuild(dist, { loadNpmTime: async () => ({}) });

test('built public surface requires discovery files, social asset, provenance, and no internal routes', async (t) => {
  const dist = await createValidBuild(t);

  assert.equal((await checkPublicManualBuild(dist)).status, 'pass');

  await writeFile(
    path.join(dist, 'sitemap.xml'),
    '<loc>https://vibepro.pages.dev/reference/vibepro-ui-journey-e2e-dogfood</loc>'
  );
  await assert.rejects(
    checkPublicManualBuild(dist),
    /references forbidden route reference\/vibepro-ui-journey-e2e-dogfood/
  );

  await writeFile(path.join(dist, 'sitemap.xml'), '<urlset></urlset>');
  await writeFile(path.join(dist, 'assets/search.js'), 'const artifact = "/Users/operator/work/vibepro";');
  await assert.rejects(
    checkPublicManualBuild(dist),
    /exposes a local absolute path in assets\/search\.js/
  );

  await rm(path.join(dist, 'assets/vibepro-header.png'));
  await assert.rejects(
    checkPublicManualBuild(dist),
    /missing required file: assets\/vibepro-header\.png/
  );
});

test('built public surface rejects Mermaid fences left as highlighted code', async (t) => {
  const dist = await createValidBuild(t);
  await writeFile(path.join(dist, 'guide/expert-judgment-nodes.html'),
    '<div class="language-mermaid vp-adaptive-theme"><pre>flowchart TD</pre></div>');
  await assert.rejects(checkPublicManualBuild(dist), /unrendered Mermaid code fence/);
  await writeFile(path.join(dist, 'guide/expert-judgment-nodes.html'),
    '<div class="mermaid-diagram" data-mermaid-state="pending"><pre>flowchart TD</pre></div>');
  assert.equal((await checkPublicManualBuild(dist)).status, 'pass');
});

test('built public surface rejects missing guide destinations including locale switches', async (t) => {
  const dist = await createValidBuild(t);
  await writeFile(path.join(dist, 'guide/feature-map.html'),
    '<a href="/ja/guide/missing#details">日本語</a>');
  await assert.rejects(checkPublicManualBuild(dist), /missing guide link destination.*ja\/guide\/missing/);
  await writeFile(path.join(dist, 'ja/guide/missing.html'), '<h1>Details</h1>');
  assert.equal((await checkPublicManualBuild(dist)).status, 'pass');
});

test('built public surface preserves the explicit compatibility route inventory', async (t) => {
  const dist = await createValidBuild(t);
  const missingRoute = REQUIRED_PUBLIC_ROUTES.find((route) => route === 'guide/control-loop.html');
  await rm(path.join(dist, missingRoute));
  await assert.rejects(
    checkPublicManualBuild(dist),
    /missing required file: guide\/control-loop\.html/
  );
});

test('built public surface rejects every internal corpus output and route', async (t) => {
  for (const corpus of FORBIDDEN_PUBLIC_CORPORA) {
    await t.test(corpus, async (t) => {
      const dist = await createValidBuild(t);
      await mkdir(path.join(dist, corpus), { recursive: true });
      await writeFile(path.join(dist, corpus, 'internal.html'), '<h1>internal</h1>');
      await assert.rejects(
        checkPublicManualBuild(dist),
        new RegExp(`contains forbidden corpus output: ${corpus}/internal\\.html`)
      );

      await rm(path.join(dist, corpus), { recursive: true, force: true });
      await writeFile(
        path.join(dist, 'sitemap.xml'),
        `<loc>https://vibepro.pages.dev/${corpus}/internal</loc>`
      );
      await assert.rejects(
        checkPublicManualBuild(dist),
        new RegExp(`references forbidden corpus ${corpus} in sitemap\\.xml`)
      );
    });
  }
});

async function createValidBuild(t) {
  const dist = await mkdtemp(path.join(os.tmpdir(), 'vibepro-public-build-'));
  t.after(() => rm(dist, { recursive: true, force: true }));
  await Promise.all([
    mkdir(path.join(dist, 'ja'), { recursive: true }),
    mkdir(path.join(dist, 'assets'), { recursive: true })
  ]);
  const index = [
    '<meta property="og:image" content="https://vibepro.pages.dev/assets/vibepro-header.png">',
    '<meta name="twitter:image" content="https://vibepro.pages.dev/assets/vibepro-header.png">',
    '<meta name="vibepro-source-commit" content="abc123">',
    '<script type="application/ld+json">{}</script>'
  ].join('\n');
  await Promise.all([
    writeFile(path.join(dist, 'index.html'), index),
    writeFile(path.join(dist, 'ja/index.html'), '<html lang="ja"></html>'),
    writeFile(path.join(dist, 'assets/vibepro-header.png'), 'image'),
    writeFile(path.join(dist, 'robots.txt'), 'User-agent: *'),
    writeFile(path.join(dist, 'llms.txt'), '# VibePro'),
    writeFile(path.join(dist, 'sitemap.xml'), '<urlset></urlset>')
  ]);
  await Promise.all(REQUIRED_PUBLIC_ROUTES.map(async (route) => {
    const output = path.join(dist, route);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, '<html></html>');
  }));
  return dist;
}

const npmTime = Object.fromEntries([31, 32, 34, 35].map((n) => [`0.2.0-beta.${n}`, '2026-10-18T00:00:00Z']));

test('version history check fails when the history lags npm', () => {
  const expected = [31, 32, 34].map((n) => `0.2.0-beta.${n}`);
  assert.deepEqual(findUnlistedPublishedVersions('## 0.2.0-beta.30', npmTime, '0.2.0-beta.34'), expected);
  assert.deepEqual(findUnlistedPublishedVersions(expected.map((v) => `## ${v}`).join('\n'), npmTime, '0.2.0-beta.34'), []);
  const html = expected.map((v) => `<h2 id="${v}">${v}<a class="header-anchor" href="#${v}" aria-label="Permalink">&#8203;</a></h2>`).join('');
  assert.deepEqual(findUnlistedPublishedVersions(html, npmTime, '0.2.0-beta.34'), []);
  assert.deepEqual(findUnlistedPublishedVersions(`<p>${expected.join(' ')}</p>`, npmTime, '0.2.0-beta.34'), expected);
});

test('version history check ignores npm versions older than the oldest ledger heading', () => {
  const withPreLedger = { ...npmTime, '0.1.0-alpha.0': '2026-06-07T00:00:00Z', '0.2.0-beta.1': '2026-07-18T00:00:00Z' };
  const ledger = [34, 32, 31, 30].map((n) => `## 0.2.0-beta.${n}`).join('\n');
  assert.deepEqual(findUnlistedPublishedVersions(ledger, withPreLedger, '0.2.0-beta.34'), []);
  assert.deepEqual(findUnlistedPublishedVersions('<h2>0.2.0-beta.30</h2>', withPreLedger, '0.2.0-beta.34'), [31, 32, 34].map((n) => `0.2.0-beta.${n}`));
});

test('built version history rejects missing npm versions in either locale', async (t) => {
  const dist = await createValidBuild(t);
  const options = { loadNpmTime: async () => npmTime };
  await assert.rejects(checkBuild(dist, options), /history lags npm in reference\/version-history.html.*beta.31/);
  const html = [31, 32, 34].map((n) => `<h2>0.2.0-beta.${n}</h2>`).join('');
  await writeFile(path.join(dist, 'reference/version-history.html'), html);
  await assert.rejects(checkBuild(dist, options), /history lags npm in ja\/reference\/version-history.html/);
  await writeFile(path.join(dist, 'ja/reference/version-history.html'), html);
  assert.equal((await checkBuild(dist, options)).status, 'pass');
});
