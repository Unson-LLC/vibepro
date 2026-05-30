import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getWorkspaceDir } from './workspace.js';

const execFileAsync = promisify(execFile);

const SCHEMA_VERSION = '0.1.0';

// L0 dependency signals -> typed Resource/Component facts.
// type one of: database | cache | queue | storage | auth | external_api | frontend | backend
const DEP_SIGNALS = [
  { match: ['next'], kind: 'component', type: 'frontend', label: 'Next.js app', provider: null },
  { match: ['nuxt'], kind: 'component', type: 'frontend', label: 'Nuxt app', provider: null },
  { match: ['@remix-run/react', '@remix-run/node'], kind: 'component', type: 'frontend', label: 'Remix app', provider: null },
  { match: ['react', 'vue', 'svelte', '@angular/core'], kind: 'component', type: 'frontend', label: 'Web frontend', provider: null },
  { match: ['express', 'fastify', '@nestjs/core', 'koa', 'hono'], kind: 'component', type: 'backend', label: 'API server', provider: null },
  { match: ['@prisma/client', 'prisma', 'pg', 'postgres'], kind: 'resource', type: 'database', label: 'PostgreSQL', provider: null, engine: 'postgres' },
  { match: ['mysql', 'mysql2'], kind: 'resource', type: 'database', label: 'MySQL', provider: null, engine: 'mysql' },
  { match: ['mongoose', 'mongodb'], kind: 'resource', type: 'database', label: 'MongoDB', provider: null, engine: 'mongodb' },
  { match: ['@planetscale/database'], kind: 'resource', type: 'database', label: 'PlanetScale', provider: 'planetscale', engine: 'mysql' },
  { match: ['@supabase/supabase-js'], kind: 'resource', type: 'database', label: 'Supabase', provider: 'supabase', engine: 'postgres' },
  { match: ['ioredis', 'redis', '@upstash/redis'], kind: 'resource', type: 'cache', label: 'Redis', provider: null, engine: 'redis' },
  { match: ['bullmq', 'bull'], kind: 'resource', type: 'queue', label: 'Job queue (Redis)', provider: null, engine: 'redis' },
  { match: ['@aws-sdk/client-sqs'], kind: 'resource', type: 'queue', label: 'AWS SQS', provider: 'aws', engine: 'sqs' },
  { match: ['@aws-sdk/client-s3'], kind: 'resource', type: 'storage', label: 'AWS S3', provider: 'aws', engine: 's3' },
  { match: ['next-auth', '@auth/core'], kind: 'resource', type: 'auth', label: 'Auth.js', provider: null },
  { match: ['@clerk/nextjs', '@clerk/clerk-sdk-node'], kind: 'resource', type: 'auth', label: 'Clerk', provider: 'clerk' },
  { match: ['stripe', '@stripe/stripe-js'], kind: 'resource', type: 'external_api', label: 'Stripe', provider: 'stripe' },
  { match: ['openai'], kind: 'resource', type: 'external_api', label: 'OpenAI', provider: 'openai' },
  { match: ['@anthropic-ai/sdk'], kind: 'resource', type: 'external_api', label: 'Anthropic', provider: 'anthropic' }
];

// L0 env-key signals -> typed Resource facts.
const ENV_SIGNALS = [
  { match: /^(DATABASE_URL|POSTGRES(QL)?_URL|PG.*URL)$/i, type: 'database', label: 'Database', engine: 'postgres' },
  { match: /^(MYSQL_URL|MYSQL_DATABASE_URL)$/i, type: 'database', label: 'MySQL', engine: 'mysql' },
  { match: /^(MONGO(DB)?_URL|MONGO_URI)$/i, type: 'database', label: 'MongoDB', engine: 'mongodb' },
  { match: /^(REDIS_URL|UPSTASH_REDIS.*)$/i, type: 'cache', label: 'Redis', engine: 'redis' },
  { match: /^(NEXT_PUBLIC_)?SUPABASE_URL$/i, type: 'database', label: 'Supabase', provider: 'supabase', engine: 'postgres' },
  { match: /^STRIPE_(SECRET|PUBLISHABLE|API)?_?KEY$/i, type: 'external_api', label: 'Stripe', provider: 'stripe' },
  { match: /^OPENAI_API_KEY$/i, type: 'external_api', label: 'OpenAI', provider: 'openai' },
  { match: /^ANTHROPIC_API_KEY$/i, type: 'external_api', label: 'Anthropic', provider: 'anthropic' },
  { match: /^(CLERK_|NEXT_PUBLIC_CLERK_)/i, type: 'auth', label: 'Clerk', provider: 'clerk' },
  { match: /^(NEXTAUTH_|AUTH_)/i, type: 'auth', label: 'Auth.js' },
  { match: /^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|REGION|S3_BUCKET)$/i, type: 'storage', label: 'AWS', provider: 'aws' }
];

// Connection-string host -> provider attribution.
const HOST_PROVIDERS = [
  { match: /\.neon\.tech$/i, provider: 'neon' },
  { match: /\.supabase\.(co|com)$/i, provider: 'supabase' },
  { match: /\.upstash\.io$/i, provider: 'upstash' },
  { match: /(\.psdb\.cloud|\.planetscale\.)/i, provider: 'planetscale' },
  { match: /\.rds\.amazonaws\.com$/i, provider: 'aws_rds' },
  { match: /\.mongodb\.net$/i, provider: 'mongodb_atlas' },
  { match: /\.render\.com$/i, provider: 'render' },
  { match: /\.railway\.app$/i, provider: 'railway' }
];

// Identity discriminator: infra resources are keyed by engine (postgres/redis/...)
// so a dependency signal and a connection-string signal for the same datastore
// merge even when only one knows the hosting provider. External/auth services are
// keyed by provider so e.g. Stripe and OpenAI stay distinct.
const ENGINE_KEYED = new Set(['database', 'cache', 'queue', 'storage']);
function nodeKey(kind, type, provider, engine) {
  if (kind === 'component') return `component:${type}`;
  const disc = ENGINE_KEYED.has(type) ? (engine ?? provider ?? 'unknown') : (provider ?? engine ?? type);
  return `resource:${type}:${disc}`;
}

function rankConfidence(c) {
  return { ambiguous: 0, inferred: 1, confirmed: 2 }[c] ?? 0;
}

function mergeNode(map, node, source) {
  const key = nodeKey(node.kind, node.type, node.provider, node.engine);
  const existing = map.get(key);
  if (!existing) {
    map.set(key, { ...node, id: key, sources: [source] });
    return;
  }
  // Corroboration: independent source pointing at the same service.
  if (!existing.sources.includes(source)) existing.sources.push(source);
  existing.provider = existing.provider ?? node.provider;
  existing.engine = existing.engine ?? node.engine;
  // Two independent sources -> upgrade inferred -> confirmed is reserved for IaC (L2);
  // in L0, corroboration upgrades ambiguous -> inferred.
  if (existing.sources.length >= 2 && rankConfidence(existing.confidence) < rankConfidence('inferred')) {
    existing.confidence = 'inferred';
  }
}

/**
 * Pure L0 graph builder. No filesystem access.
 * @param {object} input
 * @param {string[]} input.deps - dependency names (deps + devDeps)
 * @param {Array<{key:string, host:(string|null)}>} input.envEntries
 */
export function buildEnvironmentGraph({ deps = [], envEntries = [] } = {}) {
  const nodes = new Map();
  const gaps = [];

  for (const dep of deps) {
    const sig = DEP_SIGNALS.find((s) => s.match.includes(dep));
    if (!sig) continue;
    mergeNode(nodes, {
      kind: sig.kind,
      type: sig.type,
      label: sig.label,
      provider: sig.provider ?? null,
      engine: sig.engine ?? null,
      // A recognized dependency is a strong-ish signal: inferred.
      confidence: 'inferred'
    }, `package.json:${dep}`);
  }

  for (const { key, host } of envEntries) {
    const sig = ENV_SIGNALS.find((s) => s.match.test(key));
    const hostProvider = host ? HOST_PROVIDERS.find((h) => h.match.test(host))?.provider ?? null : null;
    if (!sig) {
      // Unrecognized *_URL / *_KEY -> ambiguous gap, not a confident node.
      if (/_(URL|URI|KEY|TOKEN|SECRET|DSN)$/i.test(key)) {
        gaps.push({ kind: 'unclassified_env', key, note: 'environment key suggests an external dependency but could not be typed' });
      }
      continue;
    }
    mergeNode(nodes, {
      kind: 'resource',
      type: sig.type,
      label: sig.label,
      provider: sig.provider ?? hostProvider ?? null,
      engine: sig.engine ?? null,
      // A single env key is weaker than a dependency: ambiguous, upgraded by corroboration.
      confidence: 'ambiguous'
    }, host ? `.env:${key}@${host}` : `.env:${key}`);
  }

  const nodeList = [...nodes.values()];

  // Ensure at least one Component exists so resources have an owner edge.
  let appComponent = nodeList.find((n) => n.kind === 'component');
  if (!appComponent && nodeList.length > 0) {
    appComponent = {
      id: 'component:application:unknown',
      kind: 'component',
      type: 'application',
      label: 'Application (unclassified)',
      provider: null,
      engine: null,
      confidence: 'ambiguous',
      sources: ['inferred:has-resources-without-explicit-component']
    };
    nodeList.push(appComponent);
    gaps.push({ kind: 'unidentified_component', note: 'resources detected but no frontend/backend framework identified' });
  }

  const RELATION = {
    database: 'reads_writes', cache: 'reads_writes', storage: 'reads_writes',
    queue: 'publishes_to', auth: 'authenticates_with', external_api: 'consumes_api'
  };
  const edges = appComponent
    ? nodeList
        .filter((n) => n.kind === 'resource')
        .map((r) => ({
          from: appComponent.id,
          to: r.id,
          relation: RELATION[r.type] ?? 'depends_on',
          confidence: rankConfidence(r.confidence) <= rankConfidence(appComponent.confidence) ? r.confidence : appComponent.confidence,
          sources: r.sources
        }))
    : [];

  if (!nodeList.some((n) => n.kind === 'resource')) {
    gaps.push({ kind: 'no_resources', note: 'no managed runtime resources derived from L0 signals' });
  }
  gaps.push({ kind: 'deploy_target_unknown', note: 'no L1/L2 deploy config (vercel/fly/Dockerfile/IaC) parsed in L0; provider/environment unverified' });

  const byConfidence = nodeList.reduce((acc, n) => {
    acc[n.confidence] = (acc[n.confidence] ?? 0) + 1; return acc;
  }, {});

  return {
    schema_version: SCHEMA_VERSION,
    derivation_level: 'L0',
    nodes: nodeList,
    edges,
    coverage: {
      node_count: nodeList.length,
      edge_count: edges.length,
      by_confidence: byConfidence,
      gaps,
      complete: false,
      note: 'L0 derivation (dependencies + env). Absence of IaC is expected; gaps are honest, not failures.'
    }
  };
}

function parseEnv(text) {
  const entries = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    let value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    let host = null;
    if (value.includes('://')) {
      try { host = new URL(value).hostname || null; } catch { host = null; }
    }
    // Never retain the raw value (may be a secret); keep key + host only.
    if (key) entries.push({ key, host });
  }
  return entries;
}

async function readIfExists(file) {
  try {
    await access(file);
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Derive the L0 Environment Graph from repo artifacts, bind it to the current
 * git head, and write it under .vibepro/environment/graph.json. No network,
 * no provisioning; reads files + `git rev-parse HEAD` only.
 */
export async function deriveEnvironmentGraph(repoRoot, options = {}) {
  const pkgRaw = await readIfExists(path.join(repoRoot, 'package.json'));
  let deps = [];
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw);
      deps = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
    } catch { /* malformed package.json -> no deps */ }
  }

  const envEntries = [];
  for (const name of ['.env', '.env.example', '.env.local', '.env.sample']) {
    const text = await readIfExists(path.join(repoRoot, name));
    if (text) for (const e of parseEnv(text)) envEntries.push(e);
  }

  const graph = buildEnvironmentGraph({ deps, envEntries });

  let headSha = null;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
    headSha = stdout.trim() || null;
  } catch { headSha = null; }

  const artifact = {
    ...graph,
    generated_for_sha: headSha,
    sources_scanned: {
      package_json: Boolean(pkgRaw),
      env_files: envEntries.length > 0
    }
  };

  if (options.write !== false) {
    const dir = path.join(getWorkspaceDir(repoRoot), 'environment');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'graph.json'), `${JSON.stringify(artifact, null, 2)}\n`);
    artifact.artifact_path = path.join('.vibepro', 'environment', 'graph.json');
  }

  return artifact;
}

export function renderEnvironmentGraphSummary(graph) {
  const lines = [
    `Environment Graph (${graph.derivation_level}) — bound to ${graph.generated_for_sha ?? 'no-git'}`,
    `Nodes: ${graph.coverage.node_count} (by confidence: ${JSON.stringify(graph.coverage.by_confidence)}), Edges: ${graph.coverage.edge_count}`
  ];
  for (const n of graph.nodes) {
    lines.push(`  - [${n.kind}/${n.type}] ${n.label}${n.provider ? ` (${n.provider})` : ''} — ${n.confidence} {${n.sources.join(', ')}}`);
  }
  if (graph.coverage.gaps.length) {
    lines.push('Coverage gaps:');
    for (const g of graph.coverage.gaps) lines.push(`  ! ${g.kind}: ${g.note ?? g.key ?? ''}`);
  }
  return `${lines.join('\n')}\n`;
}
