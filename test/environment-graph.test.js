import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildEnvironmentGraph, deriveEnvironmentGraph } from '../src/environment-graph.js';

const execFileAsync = promisify(execFile);

test('V-ENV-1: derives Component/Resource nodes from deps + env with no IaC', () => {
  const graph = buildEnvironmentGraph({
    deps: ['next', '@prisma/client', 'stripe', 'ioredis'],
    envEntries: [
      { key: 'DATABASE_URL', host: 'ep-cool-1.neon.tech' },
      { key: 'REDIS_URL', host: 'apt-1.upstash.io' },
      { key: 'STRIPE_SECRET_KEY', host: null }
    ]
  });
  const byType = (t) => graph.nodes.find((n) => n.type === t);
  assert.equal(byType('frontend')?.kind, 'component');
  assert.equal(byType('database')?.provider, 'neon');
  assert.equal(byType('cache')?.provider, 'upstash');
  assert.equal(byType('external_api')?.provider, 'stripe');
  // edges connect the component to each resource with a typed relation
  const dbEdge = graph.edges.find((e) => e.to === byType('database').id);
  assert.equal(dbEdge.relation, 'reads_writes');
  assert.equal(graph.edges.find((e) => e.to === byType('external_api').id).relation, 'consumes_api');
});

test('V-ENV-2: corroboration upgrades confidence and records both sources', () => {
  const graph = buildEnvironmentGraph({
    deps: ['@prisma/client'],
    envEntries: [{ key: 'DATABASE_URL', host: 'x.neon.tech' }]
  });
  const db = graph.nodes.find((n) => n.type === 'database');
  assert.equal(db.confidence, 'inferred');
  assert.equal(db.sources.length, 2);
  assert.ok(db.sources.some((s) => s.startsWith('package.json:')));
  assert.ok(db.sources.some((s) => s.startsWith('.env:')));
});

test('V-ENV-3: coverage counts, gaps, and ambiguous signals do not become confident nodes', () => {
  const graph = buildEnvironmentGraph({
    deps: [],
    envEntries: [{ key: 'SOME_WEIRD_TOKEN', host: null }]
  });
  // an unrecognized *_TOKEN does not produce a confident node
  assert.equal(graph.nodes.length, 0);
  assert.ok(graph.coverage.gaps.some((g) => g.kind === 'unclassified_env' && g.key === 'SOME_WEIRD_TOKEN'));
  assert.ok(graph.coverage.gaps.some((g) => g.kind === 'deploy_target_unknown'));
  assert.equal(graph.coverage.complete, false);
});

test('V-ENV-3b: a single env-only signal stays below confirmed', () => {
  const graph = buildEnvironmentGraph({
    deps: [],
    envEntries: [{ key: 'REDIS_URL', host: 'x.upstash.io' }]
  });
  const cache = graph.nodes.find((n) => n.type === 'cache');
  assert.equal(cache.confidence, 'ambiguous');
  assert.equal(cache.provider, 'upstash');
});

test('V-ENV-5: deriveEnvironmentGraph writes artifact bound to head SHA and leaks no secret values', async () => {
  const repo = await mkdtemp(path.join(tmpdir(), 'envg-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.email', 't@e.com'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.name', 'T'], { cwd: repo });
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ dependencies: { next: '14', '@prisma/client': '5' } }));
  await writeFile(path.join(repo, '.env.example'), 'DATABASE_URL=postgres://u:supersecret@x.neon.tech/db\n');
  await execFileAsync('git', ['add', '-A'], { cwd: repo });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repo });
  const { stdout: shaOut } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repo });
  const headSha = shaOut.trim();

  const graph = await deriveEnvironmentGraph(repo);
  assert.equal(graph.generated_for_sha, headSha);
  assert.equal(graph.derivation_level, 'L0');
  assert.equal(graph.sources_scanned.package_json, true);
  assert.equal(graph.sources_scanned.env_files, true);

  const written = await readFile(path.join(repo, '.vibepro', 'environment', 'graph.json'), 'utf8');
  assert.ok(written.includes('"generated_for_sha"'));
  // secret value must never be persisted; only key + host are retained
  assert.equal(written.includes('supersecret'), false);
  assert.ok(written.includes('x.neon.tech'));
});

test('V-ENV-2b: absence of IaC and package.json does not fail derivation', async () => {
  const repo = await mkdtemp(path.join(tmpdir(), 'envg-empty-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.email', 't@e.com'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.name', 'T'], { cwd: repo });
  await writeFile(path.join(repo, 'README.md'), '# empty\n');
  await execFileAsync('git', ['add', '-A'], { cwd: repo });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repo });

  const graph = await deriveEnvironmentGraph(repo);
  assert.equal(graph.derivation_level, 'L0');
  assert.equal(graph.coverage.complete, false);
  assert.ok(graph.coverage.gaps.some((g) => g.kind === 'no_resources'));
});
