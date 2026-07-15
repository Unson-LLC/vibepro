import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../src/cli.js';
import { scanPublicDiscovery } from '../src/public-discovery-scanner.js';

const COMPLETE_HTML = `<!doctype html>
<html><head>
<title>VibePro</title>
<meta name="description" content="VibePro public discovery documentation">
<meta property="og:title" content="VibePro">
<link rel="canonical" href="https://example.test/">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization"}</script>
</head><body><main><h1>VibePro</h1><p>${'Public documentation with useful context. '.repeat(30)}</p>
<p>Author: VibePro team. Published 2026-07-15. About company and privacy.</p>
<a href="/guide">Guide</a><h2>FAQ</h2><p>Question and Answer</p></main></body></html>`;

async function makeRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-public-targets-'));
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  return root;
}

async function writeCrawlerFiles(root) {
  await writeFile(path.join(root, 'robots.txt'), [
    'User-agent: *', 'Allow: /',
    'User-agent: GPTBot', 'Allow: /',
    'User-agent: ClaudeBot', 'Allow: /',
    'User-agent: PerplexityBot', 'Allow: /', ''
  ].join('\n'));
  await writeFile(path.join(root, 'llms.txt'), '# VibePro\n');
  await writeFile(path.join(root, '_headers'), '/*\n  Cache-Control: public, max-age=60\n  X-Content-Type-Options: nosniff\n  Strict-Transport-Security: max-age=31536000\n');
}

test('PDLT-AC-001/003: built mode recursively scans HTML and wins over source mode', async () => {
  const repo = await makeRepository();
  await writeFile(path.join(repo, 'index.html'), '<main>source must not be selected</main>');
  const output = path.join(repo, 'dist');
  await mkdir(path.join(output, 'guide'), { recursive: true });
  await writeFile(path.join(output, 'index.html'), COMPLETE_HTML);
  await writeFile(path.join(output, 'guide', 'index.html'), COMPLETE_HTML.replace('VibePro</title>', 'Guide</title>'));
  await writeCrawlerFiles(output);

  const scan = await scanPublicDiscovery(repo, { publicDir: 'dist' });

  assert.equal(scan.scan_coverage.mode, 'built');
  assert.deepEqual(scan.scan_coverage.roots, ['dist']);
  assert.equal(scan.scan_coverage.discovered_count, 2);
  assert.equal(scan.scan_coverage.scanned_count, 2);
  assert.equal(scan.scan_coverage.failed_count, 0);
  assert.equal(scan.scan_coverage.status, 'pass');
  assert.equal(scan.route_targets.every((target) => target.file.startsWith('dist/')), true);
});

test('PDLT-AC-003: built coverage distinguishes discovered, selected, and omitted pages at the cap', async () => {
  const repo = await makeRepository();
  const output = path.join(repo, 'dist');
  await mkdir(output, { recursive: true });
  await Promise.all(Array.from({ length: 430 }, (_, index) => (
    writeFile(path.join(output, `page-${String(index).padStart(3, '0')}.html`), COMPLETE_HTML)
  )));

  const scan = await scanPublicDiscovery(repo, { publicDir: 'dist' });

  assert.equal(scan.scan_coverage.discovered_count, 430);
  assert.equal(scan.scan_coverage.eligible_count, 430);
  assert.equal(scan.scan_coverage.selected_count, 400);
  assert.equal(scan.scan_coverage.scanned_count, 400);
  assert.equal(scan.scan_coverage.omitted_count, 30);
  assert.equal(scan.scan_coverage.omission_summary.page_limit, 30);
  assert.equal(scan.scan_coverage.omissions.length, 25);
  assert.equal(scan.scan_coverage.omission_samples_truncated, true);
});

test('PDLT-AC-004/007: zero source pages are inconclusive instead of a vacuum pass', async () => {
  const repo = await makeRepository();
  await mkdir(path.join(repo, 'public'), { recursive: true });
  await writeCrawlerFiles(path.join(repo, 'public'));

  const scan = await scanPublicDiscovery(repo);

  assert.equal(scan.scan_coverage.mode, 'source');
  assert.equal(scan.scan_coverage.scanned_count, 0);
  assert.equal(scan.scan_coverage.status, 'inconclusive');
  assert.match(scan.scan_coverage.reason, /no scan targets|検査対象/);
  assert.equal(scan.status, 'inconclusive');
});

test('PDLT-AC-005/008: findings remain stronger than conclusive coverage', async () => {
  const repo = await makeRepository();
  await writeFile(path.join(repo, 'index.html'), '<main>thin page without metadata</main>');

  const scan = await scanPublicDiscovery(repo);

  assert.equal(scan.scan_coverage.status, 'pass');
  assert.equal(scan.scan_coverage.scanned_count, 1);
  assert.equal(scan.status, 'needs_review');
  assert.equal(scan.metadata_findings.some((finding) => finding.kind === 'missing_title'), true);
});

test('PDLT-AC-007: missing explicit public directory is recorded without source fallback', async () => {
  const repo = await makeRepository();
  await writeFile(path.join(repo, 'index.html'), COMPLETE_HTML);

  const scan = await scanPublicDiscovery(repo, { publicDir: 'missing-dist' });

  assert.equal(scan.scan_coverage.mode, 'built');
  assert.equal(scan.scan_coverage.scanned_count, 0);
  assert.equal(scan.scan_coverage.failed_count > 0, true);
  assert.match(scan.scan_coverage.errors[0].reason, /does not exist|存在しない/);
  assert.equal(scan.route_targets.length, 0);

  const outside = await mkdtemp(path.join(os.tmpdir(), 'vibepro-public-outside-'));
  await writeFile(path.join(outside, 'index.html'), COMPLETE_HTML);
  const escaped = await scanPublicDiscovery(repo, { publicDir: outside });
  assert.equal(escaped.scan_coverage.status, 'inconclusive');
  assert.match(escaped.scan_coverage.errors[0].reason, /inside the repository|repository内/);

  await symlink(outside, path.join(repo, 'escaped-dist'));
  const symlinkEscaped = await scanPublicDiscovery(repo, { publicDir: 'escaped-dist' });
  assert.equal(symlinkEscaped.scan_coverage.status, 'inconclusive');
  assert.match(symlinkEscaped.scan_coverage.errors[0].reason, /symlink/);
});

test('PDLT-AC-002/003: live mode scans root and same-origin sitemap pages only', async () => {
  const requests = [];
  const requestOptions = [];
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    requests.push(url.href);
    requestOptions.push(options);
    if (url.pathname === '/sitemap.xml') {
      return new Response(`<?xml version="1.0"?><urlset>
        <url><loc>https://site.example/guide</loc></url>
        <url><loc>https://external.example/private</loc></url>
      </urlset>`, { status: 200, headers: { 'content-type': 'application/xml' } });
    }
    if (url.pathname === '/robots.txt') {
      return new Response('User-agent: *\nAllow: /\nUser-agent: GPTBot\nAllow: /\nUser-agent: ClaudeBot\nAllow: /\nUser-agent: PerplexityBot\nAllow: /\n');
    }
    if (url.pathname === '/llms.txt') return new Response('# VibePro\n');
    return new Response(COMPLETE_HTML, {
      status: 200,
      headers: {
        'content-type': 'text/html',
        'cache-control': 'public, max-age=60',
        'x-content-type-options': 'nosniff',
        'strict-transport-security': 'max-age=31536000'
      }
    });
  };
  const baseUrl = 'https://site.example/';

  const scan = await scanPublicDiscovery(await makeRepository(), {
    baseUrl,
    publicDir: 'must-not-win',
    fetchImpl
  });

  assert.equal(scan.scan_coverage.mode, 'live');
  assert.equal(scan.scan_coverage.discovered_count, 3);
  assert.equal(scan.scan_coverage.eligible_count, 2);
  assert.equal(scan.scan_coverage.selected_count, 2);
  assert.equal(scan.scan_coverage.omitted_count, 1);
  assert.equal(scan.scan_coverage.omission_summary.cross_origin, 1);
  assert.equal(scan.scan_coverage.scanned_count, 2);
  assert.equal(scan.scan_coverage.status, 'pass');
  assert.equal(requests.includes('https://site.example/guide'), true);
  assert.equal(requests.some((url) => url.includes('external.example')), false);
  assert.equal(scan.route_targets.some((target) => target.file === '/guide'), true);
  assert.equal(requestOptions.every((options) => options.method === 'GET' && options.redirect === 'manual'), true);
});

test('PDLT-AC-002: live mode rejects redirects/non-HTML and caps sitemap pages at 40', async () => {
  const repo = await makeRepository();
  const redirect = await scanPublicDiscovery(repo, {
    baseUrl: 'https://redirect.example/',
    fetchImpl: async () => new Response('', { status: 302, headers: { location: 'https://redirect.example/home' } })
  });
  assert.equal(redirect.scan_coverage.scanned_count, 0);
  assert.equal(redirect.scan_coverage.status, 'inconclusive');
  assert.equal(redirect.scan_coverage.errors.some((error) => /HTTP 302/.test(error.reason)), true);

  const nonHtml = await scanPublicDiscovery(repo, {
    baseUrl: 'https://json.example/',
    fetchImpl: async (input) => new URL(input).pathname === '/'
      ? new Response('<main>HTML-shaped JSON</main>', { headers: { 'content-type': 'application/json' } })
      : new Response('', { status: 404 })
  });
  assert.equal(nonHtml.scan_coverage.scanned_count, 0);
  assert.equal(nonHtml.scan_coverage.errors.some((error) => /not HTML/.test(error.reason)), true);

  const pageRequests = [];
  const locations = Array.from({ length: 50 }, (_, index) => `<url><loc>https://limit.example/page-${index + 1}</loc></url>`).join('');
  const capped = await scanPublicDiscovery(repo, {
    baseUrl: 'https://limit.example/',
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname === '/sitemap.xml') return new Response(`<urlset>${locations}</urlset>`, { headers: { 'content-type': 'application/xml' } });
      if (url.pathname === '/robots.txt' || url.pathname === '/llms.txt') return new Response('User-agent: *\n');
      pageRequests.push(url.pathname);
      return new Response(COMPLETE_HTML, { headers: { 'content-type': 'text/html' } });
    }
  });
  assert.equal(capped.scan_coverage.discovered_count, 51);
  assert.equal(capped.scan_coverage.eligible_count, 51);
  assert.equal(capped.scan_coverage.selected_count, 40);
  assert.equal(capped.scan_coverage.scanned_count, 40);
  assert.equal(capped.scan_coverage.omitted_count, 11);
  assert.equal(capped.scan_coverage.omission_summary.page_limit, 11);
  assert.equal(pageRequests.length, 40);
});

test('PDLT-AC-002/007: live timeout and malformed sitemap remain explicit', async () => {
  const repo = await makeRepository();
  const timeout = await scanPublicDiscovery(repo, {
    baseUrl: 'https://timeout.example/',
    liveLimits: { max_pages: 40, max_response_bytes: 2 * 1024 * 1024, timeout_ms: 5 },
    fetchImpl: async (_input, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted by timeout')), { once: true });
    })
  });
  assert.equal(timeout.scan_coverage.status, 'inconclusive');
  assert.equal(timeout.scan_coverage.scanned_count, 0);
  assert.equal(timeout.scan_coverage.errors.some((error) => /timeout|aborted/.test(error.reason)), true);

  const malformed = await scanPublicDiscovery(repo, {
    baseUrl: 'https://malformed.example/',
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname === '/sitemap.xml') {
        return new Response('<urlset><url><loc>https://malformed.example/guide</loc></url>', {
          headers: { 'content-type': 'application/xml' }
        });
      }
      if (url.pathname === '/robots.txt' || url.pathname === '/llms.txt') return new Response('User-agent: *\n');
      return new Response(COMPLETE_HTML, { headers: { 'content-type': 'text/html' } });
    }
  });
  assert.equal(malformed.scan_coverage.scanned_count, 1);
  assert.equal(malformed.scan_coverage.errors.some((error) => /sitemap XML/.test(error.reason)), true);
  assert.equal(malformed.scan_coverage.failed_count > 0, true);
});

test('PDLT-AC-002/007: invalid or unreachable live input is explicit and inconclusive', async () => {
  const repo = await makeRepository();
  const invalid = await scanPublicDiscovery(repo, { baseUrl: 'file:///tmp/site' });
  assert.equal(invalid.scan_coverage.mode, 'live');
  assert.equal(invalid.scan_coverage.status, 'inconclusive');
  assert.match(invalid.scan_coverage.errors[0].reason, /HTTP\(S\)|http/i);

  const unreachable = await scanPublicDiscovery(repo, {
    baseUrl: 'https://unreachable.example/',
    fetchImpl: async () => { throw new Error('simulated network failure'); }
  });
  assert.equal(unreachable.scan_coverage.status, 'inconclusive');
  assert.equal(unreachable.scan_coverage.failed_count > 0, true);
  assert.match(unreachable.scan_coverage.reason, /--base-url/);

  const oversized = await scanPublicDiscovery(repo, {
    baseUrl: 'https://oversized.example/',
    fetchImpl: async () => new Response(COMPLETE_HTML, {
      headers: { 'content-length': String(2 * 1024 * 1024 + 1), 'content-type': 'text/html' }
    })
  });
  assert.equal(oversized.scan_coverage.scanned_count, 0);
  assert.equal(oversized.scan_coverage.status, 'inconclusive');
  assert.equal(oversized.scan_coverage.errors.some((error) => /exceeds/.test(error.reason)), true);
});

test('PDLT-AC-006/009: CLI forwards public-dir and renders independent coverage evidence', async () => {
  const repo = await makeRepository();
  const output = path.join(repo, 'dist');
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'index.html'), COMPLETE_HTML);
  await writeCrawlerFiles(output);

  const capture = { stdout: '', stderr: '' };
  const result = await runCli([
    'check', 'all', repo, '--public-dir', 'dist', '--run-id', 'built-target', '--json'
  ], {
    stdout: { write: (chunk) => { capture.stdout += chunk; } },
    stderr: { write: (chunk) => { capture.stderr += chunk; } }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.check.evidence.public_discovery.scan_coverage.mode, 'built');
  const coverage = result.result.check.checks.find((check) => check.id === 'public_discovery.coverage');
  assert.equal(coverage.status, 'pass');
  assert.match(coverage.summary, /built/);
  const markdown = await readFile(path.join(repo, '.vibepro', 'checks', 'all', 'built-target', 'check.md'), 'utf8');
  assert.match(markdown, /Public discovery: Coverage/);

  const helpCapture = { output: '' };
  await runCli(['help'], { stdout: { write: (chunk) => { helpCapture.output += chunk; } } });
  assert.match(helpCapture.output, /vibepro check .*--base-url <url>.*--public-dir <dir>/);
  assert.match(helpCapture.output, /検査0件は合格ではなくinconclusive/);

  const englishHelpCapture = { output: '' };
  await runCli(['help', '--language', 'en'], { stdout: { write: (chunk) => { englishHelpCapture.output += chunk; } } });
  assert.match(englishHelpCapture.output, /Zero scanned pages are inconclusive,\s+not a clean pass/);
});

test('PDLT-AC-002/006/009: CLI forwards live targets for public-discovery and all', async () => {
  const repo = await makeRepository();
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === '/sitemap.xml') {
      return new Response(`<urlset>
        <url><loc>https://cli-live.example/guide</loc></url>
        <url><loc>https://external.example/private</loc></url>
      </urlset>`, { headers: { 'content-type': 'application/xml' } });
    }
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /\n');
    if (url.pathname === '/llms.txt') return new Response('# CLI live\n');
    return new Response(COMPLETE_HTML, { headers: { 'content-type': 'text/html' } });
  };

  for (const pack of ['public-discovery', 'all']) {
    const capture = { stdout: '', stderr: '' };
    const result = await runCli([
      'check', pack, repo, '--base-url', 'https://cli-live.example/', '--run-id', `live-${pack}`, '--json'
    ], {
      fetchImpl,
      stdout: { write: (chunk) => { capture.stdout += chunk; } },
      stderr: { write: (chunk) => { capture.stderr += chunk; } }
    });

    assert.equal(result.exitCode, 0);
    const coverage = result.result.check.evidence.public_discovery.scan_coverage;
    assert.equal(coverage.mode, 'live');
    assert.equal(coverage.discovered_count, 3);
    assert.equal(coverage.selected_count, 2);
    assert.equal(coverage.omitted_count, 1);
    const coverageRow = result.result.check.checks.find((check) => check.id === 'public_discovery.coverage');
    assert.match(coverageRow.summary, /selected=2; omitted=1/);
    const markdown = await readFile(path.join(repo, '.vibepro', 'checks', pack, `live-${pack}`, 'check.md'), 'utf8');
    assert.match(markdown, /selected=2; omitted=1/);
  }
});
