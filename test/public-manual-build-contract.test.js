import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  checkPublicManualBuild,
  FORBIDDEN_PUBLIC_CORPORA,
  REQUIRED_PUBLIC_ROUTES
} from '../scripts/check-public-manual-build.mjs';

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
