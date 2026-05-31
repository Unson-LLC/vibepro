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
  const unclassified = graph.coverage.gaps.find((g) => g.kind === 'unclassified_env' && g.key === 'SOME_WEIRD_TOKEN');
  assert.ok(unclassified);
  // the human-facing note must name the key so note-only renderers stay actionable
  assert.match(unclassified.note, /SOME_WEIRD_TOKEN/);
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

test('V-ENV-L1-1: parseFlyToml and parseCompose produce confirmed deploy facts', async () => {
  const { parseFlyToml, parseCompose } = await import('../src/environment-graph.js');
  const fly = parseFlyToml('app = "my-api"\nprimary_region = "nrt"\n');
  assert.equal(fly[0].type, 'backend');
  assert.equal(fly[0].provider, 'fly');
  assert.equal(fly[0].confidence, 'confirmed');
  assert.equal(fly[0].environment, 'production:nrt');

  const compose = parseCompose('services:\n  db:\n    image: postgres:16\n  cache:\n    image: redis:7\n');
  assert.equal(compose.some((f) => f.type === 'database' && f.engine === 'postgres' && f.confidence === 'confirmed'), true);
  assert.equal(compose.some((f) => f.type === 'cache' && f.engine === 'redis'), true);
});

test('V-ENV-L1-2: a confirmed deploy fact upgrades an inferred L0 node and removes the deploy gap', () => {
  const graph = buildEnvironmentGraph({
    deps: ['next', '@prisma/client'],
    envEntries: [{ key: 'DATABASE_URL', host: 'x.neon.tech' }],
    deployTargets: [
      { kind: 'component', type: 'frontend', label: 'Vercel frontend', provider: 'vercel', environment: 'production', confidence: 'confirmed', source: 'vercel.json' },
      { kind: 'resource', type: 'database', label: 'PostgreSQL (compose)', engine: 'postgres', provider: 'self_hosted', environment: 'local', confidence: 'confirmed', source: 'docker-compose.yml:postgres:16' }
    ]
  });
  assert.equal(graph.derivation_level, 'L1');
  const frontend = graph.nodes.find((n) => n.type === 'frontend');
  assert.equal(frontend.provider, 'vercel');
  assert.equal(frontend.confidence, 'confirmed');
  const db = graph.nodes.find((n) => n.type === 'database');
  assert.equal(db.confidence, 'confirmed'); // upgraded from inferred by the confirmed compose fact
  assert.equal(graph.coverage.gaps.some((g) => g.kind === 'deploy_target_unknown'), false);
});

test('V-ENV-L1-3: deriveEnvironmentGraph reports L1 when a deploy config is present', async () => {
  const repo = await mkdtemp(path.join(tmpdir(), 'envg-l1-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.email', 't@e.com'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.name', 'T'], { cwd: repo });
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ dependencies: { next: '14' } }));
  await writeFile(path.join(repo, 'vercel.json'), '{}');
  await writeFile(path.join(repo, 'fly.toml'), 'app = "api"\n');
  await execFileAsync('git', ['add', '-A'], { cwd: repo });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repo });

  const graph = await deriveEnvironmentGraph(repo);
  assert.equal(graph.derivation_level, 'L1');
  assert.equal(graph.sources_scanned.deploy_config, true);
  assert.equal(graph.nodes.some((n) => n.provider === 'vercel' && n.confidence === 'confirmed'), true);
  assert.equal(graph.nodes.some((n) => n.provider === 'fly'), true);
});

test('V-ENV-L1-4: a connection-string host provider outranks a compose self_hosted placeholder', () => {
  const graph = buildEnvironmentGraph({
    deps: ['@prisma/client', 'ioredis'],
    envEntries: [
      { key: 'DATABASE_URL', host: 'ep-x.neon.tech' },
      { key: 'REDIS_URL', host: 'us1.upstash.io' }
    ],
    deployTargets: [
      { kind: 'resource', type: 'database', engine: 'postgres', provider: 'self_hosted', environment: 'local', confidence: 'confirmed', source: 'docker-compose.yml:postgres:16' },
      { kind: 'resource', type: 'cache', engine: 'redis', provider: 'self_hosted', environment: 'local', confidence: 'confirmed', source: 'docker-compose.yml:redis:7' }
    ]
  });
  const db = graph.nodes.find((n) => n.type === 'database');
  const cache = graph.nodes.find((n) => n.type === 'cache');
  assert.equal(db.provider, 'neon');
  assert.equal(cache.provider, 'upstash');
  assert.equal(db.confidence, 'confirmed');
});
