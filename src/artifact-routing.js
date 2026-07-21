import { access, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const ARTIFACT_ROUTING_SCHEMA_VERSION = '0.1.0';

export const ARTIFACT_KINDS = Object.freeze([
  'story',
  'architecture',
  'accepted_spec',
  'task_plan',
  'graphify',
  'review',
  'gate',
  'pr'
]);

export const DEFAULT_ARTIFACT_TEMPLATES = Object.freeze({
  story: 'docs/management/stories/active/{story_id}.md',
  architecture: 'docs/architecture/{story_id}.md',
  accepted_spec: '.vibepro/spec/{story_id}/spec.json',
  task_plan: '.vibepro/stories/{story_id}/tasks/tasks.md',
  graphify: '.vibepro/graphify',
  review: '.vibepro/reviews/{story_id}',
  gate: '.vibepro/pr/{story_id}/gate-dag.json',
  pr: '.vibepro/pr/{story_id}/pr-prepare.json'
});

const VARIABLE_PATTERN = /\{([a-z_][a-z0-9_]*)\}/g;
const SUPPORTED_VARIABLES = new Set(['story_id', 'feature_slug']);
const PROJECTION_SUPPORTED_KINDS = new Set(['architecture', 'accepted_spec', 'task_plan']);
const DIRECTORY_ARTIFACT_KINDS = new Set(['graphify', 'review']);

export class ArtifactRoutingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ArtifactRoutingError';
    this.code = code;
    this.details = details;
  }
}

export async function readArtifactRoutingConfig(repoRoot) {
  const configPath = path.join(path.resolve(repoRoot), '.vibepro', 'config.json');
  try {
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    return { configPath, routing: config.artifact_routing ?? null };
  } catch (error) {
    if (error.code === 'ENOENT') return { configPath, routing: null };
    if (error instanceof SyntaxError) {
      throw new ArtifactRoutingError('invalid_config', `Invalid JSON in ${toPosix(path.relative(repoRoot, configPath))}: ${error.message}`);
    }
    throw error;
  }
}

export async function resolveArtifactRoutes(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const variables = normalizeVariables(options);
  const { configPath, routing } = await readArtifactRoutingConfig(root);
  validateRoutingShape(routing);

  const routes = {};
  for (const kind of ARTIFACT_KINDS) {
    const configured = routing?.artifacts?.[kind] ?? {};
    const canonicalTemplate = configured.canonical ?? DEFAULT_ARTIFACT_TEMPLATES[kind];
    const canonical = resolveTemplate(root, kind, canonicalTemplate, variables, 'canonical');
    const projections = (configured.projections ?? []).map((projection, index) => {
      if (!projection || typeof projection !== 'object' || projection.generated !== true || typeof projection.path !== 'string') {
        throw new ArtifactRoutingError(
          'ambiguous_projection',
          `artifact_routing.artifacts.${kind}.projections[${index}] must declare { path, generated: true }`,
          { kind, index }
        );
      }
      return {
        generated: true,
        ...resolveTemplate(root, kind, projection.path, variables, `projection[${index}]`)
      };
    });
    routes[kind] = {
      kind,
      canonical,
      projections,
      configured: Object.hasOwn(routing?.artifacts ?? {}, kind)
    };
  }
  assertNoCollisions(routes);
  return {
    schema_version: ARTIFACT_ROUTING_SCHEMA_VERSION,
    config_path: toPosix(path.relative(root, configPath)),
    configured: Boolean(routing),
    variables,
    routes
  };
}

export async function resolveArtifactRoute(repoRoot, kind, options = {}) {
  if (!ARTIFACT_KINDS.includes(kind)) {
    throw new ArtifactRoutingError('unknown_kind', `Unknown artifact kind: ${kind}`, { kind });
  }
  return (await resolveArtifactRoutes(repoRoot, options)).routes[kind];
}

export async function resolvePrArtifactFile(repoRoot, storyId, fileName = 'pr-prepare.json') {
  const route = await resolveArtifactRoute(repoRoot, 'pr', { storyId });
  if (fileName === 'pr-prepare.json') return route.canonical.absolute_path;
  return assertArtifactWritePath(repoRoot, toPosix(path.join(path.dirname(route.canonical.relative_path), fileName)));
}

export async function resolveGateArtifactFile(repoRoot, storyId) {
  return (await resolveArtifactRoute(repoRoot, 'gate', { storyId })).canonical.absolute_path;
}

export async function resolveGraphifyArtifactFile(repoRoot, storyId, fileName = 'graph.json') {
  const route = await resolveArtifactRoute(repoRoot, 'graphify', { storyId });
  return assertArtifactWritePath(repoRoot, toPosix(path.join(route.canonical.relative_path, fileName)));
}

export async function assertArtifactWritePath(repoRoot, relativePath) {
  if (path.isAbsolute(relativePath)) {
    throw new ArtifactRoutingError('absolute_path', 'Artifact write target must be repository-relative and inside the repository', { target: relativePath });
  }
  const root = path.resolve(repoRoot);
  const absolute = path.resolve(root, relativePath);
  assertLexicallyInside(root, absolute, 'write target');
  const rootReal = await realpath(root);
  const ancestor = await findExistingAncestor(path.dirname(absolute), root);
  assertRealPathInside(rootReal, await realpath(ancestor), 'write target');
  try {
    await lstat(absolute);
    assertRealPathInside(rootReal, await realpath(absolute), 'write target');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return absolute;
}

export async function writeArtifactProjections(repoRoot, route, content) {
  const targets = await preflightArtifactWrites(repoRoot, route, { canonical: false });
  const written = [];
  for (const target of targets) {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
    written.push(target);
  }
  return written;
}

export async function preflightArtifactWrites(repoRoot, route, options = {}) {
  const destinations = [...(options.canonical === false ? [] : [route.canonical]), ...route.projections];
  const targets = [];
  for (const destination of destinations) targets.push(await assertArtifactWritePath(repoRoot, destination.relative_path));
  for (const relativePath of options.additionalPaths ?? []) targets.push(await assertArtifactWritePath(repoRoot, relativePath));
  return targets;
}

export async function buildArtifactMigrationPlan(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  let resolved;
  try {
    resolved = await resolveArtifactRoutes(root, options);
  } catch (error) {
    if (!(error instanceof ArtifactRoutingError)) throw error;
    return {
      schema_version: ARTIFACT_ROUTING_SCHEMA_VERSION,
      dry_run: true,
      story_id: options.storyId ?? null,
      feature_slug: options.featureSlug ?? null,
      config_path: '.vibepro/config.json',
      status: 'blocked',
      edits_performed: 0,
      items: [],
      unresolved: [{ code: error.code, message: error.message, ...error.details }]
    };
  }
  const items = [];
  for (const kind of ARTIFACT_KINDS) {
    const source = resolveTemplate(root, kind, DEFAULT_ARTIFACT_TEMPLATES[kind], resolved.variables, 'default').relative_path;
    const destination = resolved.routes[kind].canonical.relative_path;
    const [sourceExists, destinationExists] = await Promise.all([
      exists(path.join(root, source)),
      exists(path.join(root, destination))
    ]);
    const collision = source !== destination && sourceExists && destinationExists;
    items.push({
      kind,
      source,
      destination,
      source_exists: sourceExists,
      destination_exists: destinationExists,
      action: collision ? 'collision' : source !== destination && sourceExists ? 'move_required' : 'none',
      collision,
      projections: resolved.routes[kind].projections.map((entry) => entry.relative_path)
    });
  }
  return {
    schema_version: ARTIFACT_ROUTING_SCHEMA_VERSION,
    dry_run: true,
    story_id: resolved.variables.story_id,
    feature_slug: resolved.variables.feature_slug,
    config_path: resolved.config_path,
    status: items.some((item) => item.collision) ? 'blocked' : 'ready',
    edits_performed: 0,
    items,
    unresolved: items
      .filter((item) => item.collision)
      .map((item) => ({
        code: 'migration_collision',
        kind: item.kind,
        source: item.source,
        destination: item.destination,
        message: `Both migration source and destination exist for ${item.kind}`
      }))
  };
}

function normalizeVariables(options) {
  if (!options.storyId) {
    throw new ArtifactRoutingError('missing_variable', 'storyId is required to resolve artifact routes');
  }
  const storyId = normalizeStoryId(options.storyId);
  const explicitFeature = options.featureSlug === undefined || options.featureSlug === null
    ? null
    : slugify(options.featureSlug, 'feature');
  return {
    story_id: storyId,
    feature_slug: explicitFeature ?? slugify(storyId.replace(/^story-/, ''), 'feature')
  };
}

function normalizeStoryId(value) {
  const raw = String(value).trim();
  return /^[A-Z][A-Z0-9]*-\d+$/.test(raw) ? raw : slugify(raw, 'story');
}

function validateRoutingShape(routing) {
  if (routing === null) return;
  if (!routing || typeof routing !== 'object' || Array.isArray(routing)) {
    throw new ArtifactRoutingError('invalid_config', 'artifact_routing must be an object');
  }
  if (routing.schema_version && routing.schema_version !== ARTIFACT_ROUTING_SCHEMA_VERSION) {
    throw new ArtifactRoutingError('unsupported_schema', `Unsupported artifact_routing schema_version: ${routing.schema_version}`);
  }
  if (routing.artifacts !== undefined && (!routing.artifacts || typeof routing.artifacts !== 'object' || Array.isArray(routing.artifacts))) {
    throw new ArtifactRoutingError('invalid_config', 'artifact_routing.artifacts must be an object');
  }
  for (const [kind, value] of Object.entries(routing.artifacts ?? {})) {
    if (!ARTIFACT_KINDS.includes(kind)) {
      throw new ArtifactRoutingError('unknown_kind', `Unknown artifact kind in configuration: ${kind}`, { kind });
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ArtifactRoutingError('invalid_config', `artifact_routing.artifacts.${kind} must be an object`);
    }
    if (value.canonical !== undefined && typeof value.canonical !== 'string') {
      throw new ArtifactRoutingError('ambiguous_canonical', `artifact_routing.artifacts.${kind}.canonical must be one path template`);
    }
    if (value.projections !== undefined && !Array.isArray(value.projections)) {
      throw new ArtifactRoutingError('ambiguous_projection', `artifact_routing.artifacts.${kind}.projections must be an array`);
    }
    if (Array.isArray(value.projections) && value.projections.length > 0 && !PROJECTION_SUPPORTED_KINDS.has(kind)) {
      throw new ArtifactRoutingError(
        'unsupported_projection',
        `artifact_routing.artifacts.${kind}.projections is not supported because this artifact has no centralized projection writer`,
        { kind }
      );
    }
  }
}

function resolveTemplate(root, kind, template, variables, role) {
  if (typeof template !== 'string' || !template.trim()) {
    throw new ArtifactRoutingError('invalid_template', `Artifact ${kind} ${role} path must be a non-empty string`, { kind, role });
  }
  if (path.isAbsolute(template)) {
    throw new ArtifactRoutingError('absolute_path', `Artifact ${kind} ${role} path must be repository-relative: ${template}`, { kind, role, template });
  }
  const referenced = [...template.matchAll(VARIABLE_PATTERN)].map((match) => match[1]);
  const unsupported = referenced.filter((name) => !SUPPORTED_VARIABLES.has(name));
  if (unsupported.length) {
    throw new ArtifactRoutingError('unresolved_variable', `Artifact ${kind} ${role} path has unsupported variables: ${unsupported.join(', ')}`, { kind, role, variables: unsupported });
  }
  const expanded = template.replace(VARIABLE_PATTERN, (_, name) => variables[name]);
  if (/[{}]/.test(expanded)) {
    throw new ArtifactRoutingError('unresolved_variable', `Artifact ${kind} ${role} path contains an unresolved variable: ${template}`, { kind, role, template });
  }
  const absolute = path.resolve(root, expanded);
  assertLexicallyInside(root, absolute, `${kind} ${role}`);
  const relative = toPosix(path.relative(root, absolute));
  if (!relative || relative === '.') {
    throw new ArtifactRoutingError('invalid_template', `Artifact ${kind} ${role} path cannot resolve to the repository root`, { kind, role });
  }
  return { template, relative_path: relative, absolute_path: absolute };
}

function assertNoCollisions(routes) {
  const destinations = new Map();
  for (const route of Object.values(routes)) {
    for (const destination of [route.canonical, ...route.projections]) {
      const existing = destinations.get(destination.relative_path);
      if (existing) {
        throw new ArtifactRoutingError(
          'path_collision',
          `Artifact path collision: ${existing.kind} ${existing.role} and ${route.kind} ${destination === route.canonical ? 'canonical' : 'projection'} resolve to ${destination.relative_path}`,
          { path: destination.relative_path, first: existing, second: { kind: route.kind } }
        );
      }
      destinations.set(destination.relative_path, {
        kind: route.kind,
        role: destination === route.canonical ? 'canonical' : 'projection'
      });
    }
  }
  const entries = [...destinations.entries()];
  for (const [candidatePath, candidate] of entries) {
    if (DIRECTORY_ARTIFACT_KINDS.has(candidate.kind) && candidate.role === 'canonical') continue;
    const nestedDirectory = entries.find(([directoryPath, directory]) => (
      directoryPath !== candidatePath
      && DIRECTORY_ARTIFACT_KINDS.has(directory.kind)
      && directory.role === 'canonical'
      && directoryPath.startsWith(`${candidatePath}/`)
    ));
    if (nestedDirectory) {
      throw new ArtifactRoutingError(
        'path_collision',
        `Artifact path collision: ${candidate.kind} ${candidate.role} ${candidatePath} is an ancestor of ${nestedDirectory[1].kind} canonical ${nestedDirectory[0]}`,
        { path: candidatePath, first: candidate, second: nestedDirectory[1] }
      );
    }
  }
  for (const [directoryPath, directory] of entries) {
    if (!DIRECTORY_ARTIFACT_KINDS.has(directory.kind) || directory.role !== 'canonical') continue;
    const nested = entries.find(([candidatePath]) => candidatePath !== directoryPath && candidatePath.startsWith(`${directoryPath}/`));
    if (nested) {
      throw new ArtifactRoutingError(
        'path_collision',
        `Artifact directory collision: ${directory.kind} canonical ${directoryPath} contains ${nested[1].kind} ${nested[1].role} ${nested[0]}`,
        { path: directoryPath, first: directory, second: nested[1] }
      );
    }
  }
}

function assertLexicallyInside(root, target, label) {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ArtifactRoutingError('repository_traversal', `Artifact ${label} must stay inside the repository`, { target });
  }
}

function assertRealPathInside(rootReal, targetReal, label) {
  const relative = path.relative(rootReal, targetReal);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ArtifactRoutingError('repository_traversal', `Artifact ${label} must resolve inside the repository and cannot traverse a symlink outside it`, { target: targetReal });
  }
}

async function findExistingAncestor(target, root) {
  let cursor = target;
  while (true) {
    try {
      await lstat(cursor);
      return cursor;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (cursor === root || path.dirname(cursor) === cursor) return root;
      cursor = path.dirname(cursor);
    }
  }
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function slugify(value, fallback) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}
