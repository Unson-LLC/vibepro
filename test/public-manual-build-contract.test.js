import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkPublicManualBuild } from '../scripts/check-public-manual-build.mjs';

test('built public surface requires discovery files, social asset, provenance, and no internal routes', async (t) => {
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
