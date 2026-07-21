import { access, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { readManifest } from './workspace.js';

export const ARTIFACT_ROUTING_SCHEMA_VERSION = '0.2.0';
export const LEGACY_ARTIFACT_ROUTING_SCHEMA_VERSION = '0.1.0';
export const ARTIFACT_KINDS = Object.freeze(['story', 'architecture', 'accepted_spec', 'task_plan', 'graphify', 'evidence', 'test_plan', 'review', 'gate', 'pr']);
export const DEFAULT_ARTIFACT_TEMPLATES = Object.freeze({
  story: 'docs/management/stories/active/{story_id}.md', architecture: 'docs/architecture/{story_id}.md',
  accepted_spec: '.vibepro/spec/{story_id}/spec.json', task_plan: '.vibepro/stories/{story_id}/tasks/tasks.md',
  graphify: '.vibepro/graphify', evidence: '.vibepro/evidence/{story_id}', test_plan: '.vibepro/test-plans/{story_id}.json',
  review: '.vibepro/reviews/{story_id}', gate: '.vibepro/pr/{story_id}/gate-dag.json', pr: '.vibepro/pr/{story_id}/pr-prepare.json'
});
const VARIABLE_PATTERN = /\{([a-z_][a-z0-9_]*)\}/g;
const SUPPORTED_VARIABLES = new Set(['story_id', 'feature_slug']);
const LEGACY_KINDS = new Set(['story', 'architecture', 'accepted_spec', 'task_plan', 'graphify', 'review', 'gate', 'pr']);
const LEGACY_PROJECTION_KINDS = new Set(['architecture', 'accepted_spec', 'task_plan']);
const DIRECTORY_ARTIFACT_KINDS = new Set(['graphify', 'evidence', 'review']);
const OWNERSHIP = new Set(['generated', 'curated', 'human_owned']);
const RENDERERS = new Map([['architecture_markdown', '1'], ['functional_spec_markdown', '1'], ['tasks_markdown', '1'], ['evidence_summary_markdown', '1'], ['test_plan_markdown', '1'], ['review_summary_markdown', '1'], ['gate_summary_markdown', '1'], ['release_summary_markdown', '1']]);

export class ArtifactRoutingError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'ArtifactRoutingError'; this.code = code; this.details = details; }
}

export async function readArtifactRoutingConfig(repoRoot) {
  const configPath = path.join(path.resolve(repoRoot), '.vibepro', 'config.json');
  try { const config = JSON.parse(await readFile(configPath, 'utf8')); return { configPath, config, routing: config.artifact_routing ?? null }; }
  catch (error) {
    if (error.code === 'ENOENT') return { configPath, config: {}, routing: null };
    if (error instanceof SyntaxError) throw new ArtifactRoutingError('invalid_config', `Invalid JSON in ${toPosix(path.relative(repoRoot, configPath))}: ${error.message}`);
    throw error;
  }
}

export async function resolveArtifactRoutes(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = normalizeStoryId(options.storyId);
  const { configPath, config, routing } = await readArtifactRoutingConfig(root);
  const schemaVersion = validateRoutingShape(routing);
  const selection = await resolveSelection(root, config, routing, schemaVersion, storyId, options.featureSlug);
  const effectiveSchemaVersion = selection.profile ? schemaVersion : LEGACY_ARTIFACT_ROUTING_SCHEMA_VERSION;
  const variables = { story_id: storyId, feature_slug: selection.featureSlug };
  const artifacts = selection.profile?.artifacts ?? (schemaVersion === LEGACY_ARTIFACT_ROUTING_SCHEMA_VERSION ? routing?.artifacts : {}) ?? {};
  const routes = {};
  for (const kind of ARTIFACT_KINDS) {
    const configured = artifacts[kind] ?? {};
    const canonicalTemplate = configured.canonical ?? DEFAULT_ARTIFACT_TEMPLATES[kind];
    const canonical = { ownership: configured.ownership ?? (effectiveSchemaVersion === '0.2.0' ? 'generated' : undefined), ...resolveTemplate(root, kind, canonicalTemplate, variables, 'canonical') };
    const projections = (configured.projections ?? []).map((projection, index) => normalizeProjection(root, kind, projection, index, variables, effectiveSchemaVersion));
    const canonicalWriter = canonical.ownership === 'generated' ? 'vibepro' : 'owner';
    routes[kind] = { kind, schema_version: effectiveSchemaVersion, story_id: storyId, feature_slug: variables.feature_slug, canonical_owner: canonical.ownership ?? 'legacy', canonical_writer: canonicalWriter, writer: canonicalWriter, read_authority: canonical.relative_path, canonical, projections, configured: Object.hasOwn(artifacts, kind), profile: selection.profileName };
  }
  assertNoCollisions(routes);
  return { schema_version: effectiveSchemaVersion, config_path: toPosix(path.relative(root, configPath)), configured: effectiveSchemaVersion === schemaVersion && Boolean(routing), story_id: storyId, profile: selection.profileName, metadata_source: selection.metadataSource, variables, routes };
}

export async function resolveArtifactRoute(repoRoot, kind, options = {}) {
  if (!ARTIFACT_KINDS.includes(kind)) throw new ArtifactRoutingError('unknown_kind', `Unknown artifact kind: ${kind}`, { kind });
  return (await resolveArtifactRoutes(repoRoot, options)).routes[kind];
}
export async function resolvePrArtifactFile(repoRoot, storyId, fileName = 'pr-prepare.json') { const r = await resolveArtifactRoute(repoRoot, 'pr', { storyId }); return fileName === 'pr-prepare.json' ? r.canonical.absolute_path : assertArtifactWritePath(repoRoot, toPosix(path.join(path.dirname(r.canonical.relative_path), fileName))); }
export async function resolveGateArtifactFile(repoRoot, storyId) { return (await resolveArtifactRoute(repoRoot, 'gate', { storyId })).canonical.absolute_path; }
export async function resolveGraphifyArtifactFile(repoRoot, storyId, fileName = 'graph.json') { const r = await resolveArtifactRoute(repoRoot, 'graphify', { storyId }); return assertArtifactWritePath(repoRoot, toPosix(path.join(r.canonical.relative_path, fileName))); }

export async function assertArtifactWritePath(repoRoot, relativePath) {
  if (path.isAbsolute(relativePath)) throw new ArtifactRoutingError('absolute_path', 'Artifact write target must be repository-relative and inside the repository', { target: relativePath });
  const root = path.resolve(repoRoot); const absolute = path.resolve(root, relativePath); assertLexicallyInside(root, absolute, 'write target');
  const rootReal = await realpath(root); const ancestor = await findExistingAncestor(path.dirname(absolute), root); assertRealPathInside(rootReal, await realpath(ancestor), 'write target');
  try { await lstat(absolute); assertRealPathInside(rootReal, await realpath(absolute), 'write target'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return absolute;
}

export async function writeArtifactProjections(repoRoot, route, content) {
  const prepared = await preflightArtifactProjectionWrites(repoRoot, route, content);
  const written = [];
  for (const { target, rendered } of prepared) { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, rendered); written.push(target); }
  return written;
}

export async function isCurrentGeneratedProjection(repoRoot, route, projection) {
  if (projection.ownership !== 'generated' || !projection.renderer) return false;
  let projectionBytes;
  try {
    projectionBytes = await readFile(projection.absolute_path);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  const firstLine = projectionBytes.toString('utf8').split('\n', 1)[0];
  const match = firstLine.match(/^<!-- vibepro-projection (.+) -->$/);
  if (!match) return false;
  const fields = Object.fromEntries(match[1].split(' ').map((part) => {
    const separator = part.indexOf('=');
    return [part.slice(0, separator), part.slice(separator + 1)];
  }));
  const expected = {
    story_id: route.story_id,
    feature_slug: route.feature_slug,
    ownership: 'generated',
    profile: route.profile ?? 'legacy',
    renderer: `${projection.renderer.id}@${projection.renderer.version}`,
    direct_edit: 'false'
  };
  if (Object.entries(expected).some(([key, value]) => fields[key] !== String(value))) return false;
  const canonicalBytes = await readCanonicalBytesForRoute(path.resolve(repoRoot), route, fields.source);
  if (!canonicalBytes) return false;
  const sourcePath = path.resolve(repoRoot, fields.source);
  const projectionRoute = {
    ...route,
    canonical_container_relative_path: route.canonical_container_relative_path ?? route.canonical.relative_path,
    canonical: { ...route.canonical, absolute_path: sourcePath, relative_path: fields.source }
  };
  return Buffer.compare(projectionBytes, Buffer.from(renderProjection(projectionRoute, projection, canonicalBytes))) === 0;
}

export async function preflightArtifactProjectionWrites(repoRoot, route, content) {
  const targets = await preflightArtifactWrites(repoRoot, route, { canonical: false }); const prepared = [];
  for (let i = 0; i < targets.length; i += 1) {
    const projection = route.projections[i];
    if (projection.ownership && projection.ownership !== 'generated') throw new ArtifactRoutingError('projection_owned', `Automatic projection write refused for ${projection.ownership} destination`, { path: projection.relative_path });
    await assertProjectionLineage(targets[i], route, projection);
    prepared.push({ target: targets[i], rendered: renderProjection(route, projection, content) });
  }
  return prepared;
}

export async function projectArtifact(repoRoot, kind, options = {}) {
  const route = await resolveArtifactRoute(repoRoot, kind, { storyId: options.storyId, featureSlug: options.featureSlug });
  if (route.canonical.ownership === 'human_owned') {
    return { kind, ownership: 'human_owned', canonical: route.canonical.relative_path, read_authority: route.canonical.relative_path, written: [], skipped: 'human_owned' };
  }
  const canonicalTarget = options.canonicalAbsolutePath ?? (DIRECTORY_ARTIFACT_KINDS.has(kind)
    ? path.join(route.canonical.absolute_path, options.canonicalFileName ?? `${kind}.json`)
    : route.canonical.absolute_path);
  const relativeTarget = toPosix(path.relative(path.resolve(repoRoot), canonicalTarget));
  const projectionRoute = { ...route, canonical_container_relative_path: route.canonical.relative_path, canonical: { ...route.canonical, absolute_path: canonicalTarget, relative_path: relativeTarget } };
  let canonicalBytes;
  let canonicalWriteTarget = null;
  if (options.writeCanonical === true) {
    canonicalBytes = Buffer.from(typeof options.content === 'string' ? options.content : `${JSON.stringify(options.content, null, 2)}\n`);
    canonicalWriteTarget = await assertArtifactWritePath(repoRoot, relativeTarget);
  } else {
    try { canonicalBytes = await readFile(canonicalTarget); }
    catch (error) { if (error.code !== 'ENOENT') throw error; throw new ArtifactRoutingError('missing_canonical', `Cannot render projection before canonical exists`, { kind, canonical: relativeTarget }); }
  }
  // Render and validate every projection before mutating either canonical or projections.
  const prepared = await preflightArtifactProjectionWrites(repoRoot, projectionRoute, canonicalBytes);
  if (canonicalWriteTarget) { await mkdir(path.dirname(canonicalWriteTarget), { recursive: true }); await writeFile(canonicalWriteTarget, canonicalBytes); }
  const written = [];
  for (const { target, rendered } of prepared) { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, rendered); written.push(target); }
  return { kind, ownership: route.canonical.ownership ?? 'legacy', canonical: route.canonical.relative_path, read_authority: route.canonical.relative_path, written };
}

export async function preflightArtifactWrites(repoRoot, route, options = {}) {
  const destinations = [...(options.canonical === false ? [] : [route.canonical]), ...route.projections]; const targets = [];
  for (const destination of destinations) {
    if (destination.ownership === 'human_owned') throw new ArtifactRoutingError('human_owned_write', `Automatic write refused for human-owned artifact`, { path: destination.relative_path });
    if (destination !== route.canonical && destination.ownership === 'curated') throw new ArtifactRoutingError('curated_projection_write', `Automatic projection write refused for curated artifact`, { path: destination.relative_path });
    targets.push(await assertArtifactWritePath(repoRoot, destination.relative_path));
  }
  for (const relativePath of options.additionalPaths ?? []) targets.push(await assertArtifactWritePath(repoRoot, relativePath));
  return targets;
}

export async function buildArtifactMigrationPlan(repoRoot, options = {}) {
  const root = path.resolve(repoRoot); let resolved;
  try { resolved = await resolveArtifactRoutes(root, options); } catch (error) {
    if (!(error instanceof ArtifactRoutingError)) throw error;
    return { schema_version: ARTIFACT_ROUTING_SCHEMA_VERSION, dry_run: true, story_id: options.storyId ?? null, feature_slug: options.featureSlug ?? null, config_path: '.vibepro/config.json', status: 'blocked', edits_performed: 0, items: [], unresolved: [{ code: error.code, message: error.message, ...error.details }] };
  }
  const items = [];
  for (const kind of ARTIFACT_KINDS) {
    const source = resolveTemplate(root, kind, DEFAULT_ARTIFACT_TEMPLATES[kind], resolved.variables, 'default').relative_path;
    const destination = resolved.routes[kind].canonical.relative_path;
    const [sourceExists, destinationExists] = await Promise.all([exists(path.join(root, source)), exists(path.join(root, destination))]);
    let action;
    if (resolved.schema_version === LEGACY_ARTIFACT_ROUTING_SCHEMA_VERSION) action = source !== destination && sourceExists && destinationExists ? 'collision' : source !== destination && sourceExists ? 'move_required' : 'none';
    else if (source === destination) action = destinationExists ? 'noop' : 'create';
    else if (sourceExists && destinationExists) action = await sameFile(path.join(root, source), path.join(root, destination)) || await isManagedLegacyMirror(root, resolved.routes[kind], source, destination) ? 'noop' : 'conflict';
    else if (sourceExists) action = 'create'; else if (destinationExists) action = 'noop'; else action = 'create';
    const collision = action === 'collision' || action === 'conflict';
    const projection_items = resolved.schema_version === '0.2.0'
      ? await Promise.all(resolved.routes[kind].projections.map((projection) => inspectProjectionMigration(root, resolved.routes[kind], projection)))
      : [];
    const projectionConflict = projection_items.some((item) => item.action === 'conflict');
    const renderers = resolved.routes[kind].projections.map((p) => p.renderer ? `${p.renderer.id}@${p.renderer.version}` : null).filter(Boolean);
    items.push({ kind, source, destination, ownership: resolved.routes[kind].canonical_owner, canonical_writer: resolved.routes[kind].canonical_writer, renderer: renderers.length ? renderers.join(',') : null, source_exists: sourceExists, destination_exists: destinationExists, action, reason: action === 'noop' ? 'canonical already current' : action === 'create' ? 'canonical is absent' : action === 'update' ? 'managed canonical is stale' : 'canonical contents conflict', collision: collision || projectionConflict, projections: resolved.routes[kind].projections.map((p) => p.relative_path), projection_items });
  }
  return { schema_version: resolved.schema_version, dry_run: true, story_id: resolved.variables.story_id, feature_slug: resolved.variables.feature_slug, profile: resolved.profile, config_path: resolved.config_path, status: items.some((i) => i.collision) ? 'blocked' : 'ready', edits_performed: 0, items, unresolved: items.filter((i) => i.collision).map((i) => ({ code: 'migration_collision', kind: i.kind, source: i.source, destination: i.destination, message: `Both migration source and destination exist for ${i.kind}` })) };
}

async function isManagedLegacyMirror(root, route, source, destination) {
  if (route.kind !== 'task_plan' || !source.endsWith('/tasks/tasks.md') || !destination.endsWith('/tasks/tasks.json')) return false;
  const sourceText = await readFile(path.join(root, source), 'utf8');
  const firstLine = sourceText.split('\n', 1)[0];
  const lineage = firstLine.match(/^<!-- vibepro-projection (.+) -->$/);
  if (lineage) {
    const fields = Object.fromEntries(lineage[1].split(' ').map((part) => { const at = part.indexOf('='); return [part.slice(0, at), part.slice(at + 1)]; }));
    const canonicalHash = await hashCanonicalForRoute(root, route, fields.source);
    return fields.story_id === route.story_id
      && fields.ownership === 'generated'
      && fields.renderer === 'tasks_markdown@1'
      && fields.source === destination
      && Boolean(canonicalHash)
      && fields.source_sha256 === canonicalHash;
  }

  const storyIdMarker = `| Story ID | ${route.story_id} |`;
  if (firstLine !== '# VibePro 生成タスク' || !sourceText.includes(storyIdMarker)) return false;
  const manifest = await readManifest(root);
  return (manifest.runs ?? []).some((run) => run.story_id === route.story_id
    && run.artifacts?.story_tasks_markdown === source
    && run.artifacts?.story_tasks_json === destination
    && sourceText.includes(`| Run ID | ${run.run_id} |`));
}

async function inspectProjectionMigration(root, route, projection) {
  const renderer = projection.renderer ? `${projection.renderer.id}@${projection.renderer.version}` : null;
  if (!await exists(projection.absolute_path)) return { role: 'projection', path: projection.relative_path, ownership: projection.ownership, renderer, action: projection.ownership === 'generated' ? 'create' : 'conflict', reason: projection.ownership === 'generated' ? 'generated projection is absent' : `${projection.ownership} projection is not auto-managed` };
  if (projection.ownership !== 'generated') return { role: 'projection', path: projection.relative_path, ownership: projection.ownership, renderer, action: 'conflict', reason: `existing ${projection.ownership} bytes must remain unchanged` };
  const firstLine = (await readFile(projection.absolute_path, 'utf8')).split('\n', 1)[0];
  const match = firstLine.match(/^<!-- vibepro-projection (.+) -->$/);
  if (!match) return { role: 'projection', path: projection.relative_path, ownership: projection.ownership, renderer, action: 'conflict', reason: 'existing projection is unmanaged' };
  const fields = Object.fromEntries(match[1].split(' ').map((part) => { const at = part.indexOf('='); return [part.slice(0, at), part.slice(at + 1)]; }));
  const sourcePath = fields.source;
  const canonicalHash = await hashCanonicalForRoute(root, route, sourcePath);
  const expected = { story_id: route.story_id, feature_slug: route.feature_slug, profile: route.profile, ownership: 'generated', renderer: `${projection.renderer.id}@${projection.renderer.version}` };
  if (!isCanonicalLineageSource(route, sourcePath)) return { role: 'projection', path: projection.relative_path, ownership: projection.ownership, renderer, action: 'conflict', reason: 'lineage source mismatch' };
  const identityMismatch = ['story_id', 'ownership'].find((key) => fields[key] !== String(expected[key]));
  if (identityMismatch) return { role: 'projection', path: projection.relative_path, ownership: projection.ownership, renderer, action: 'conflict', reason: `lineage ${identityMismatch} mismatch` };
  const staleMetadata = ['feature_slug', 'profile', 'renderer'].filter((key) => fields[key] !== String(expected[key]));
  if (!canonicalHash) return { role: 'projection', path: projection.relative_path, ownership: projection.ownership, renderer, action: 'conflict', reason: 'canonical source is absent' };
  const staleHash = fields.source_sha256 !== canonicalHash;
  return { role: 'projection', path: projection.relative_path, ownership: projection.ownership, renderer, action: staleHash || staleMetadata.length ? 'update' : 'noop', reason: staleMetadata.length ? `managed projection lineage metadata is stale: ${staleMetadata.join(', ')}` : staleHash ? 'managed projection source hash is stale' : 'lineage and canonical hash match' };
}
function isCanonicalLineageSource(route, sourcePath) {
  if (typeof sourcePath !== 'string' || !sourcePath) return false;
  if (!DIRECTORY_ARTIFACT_KINDS.has(route.kind)) return sourcePath === route.canonical.relative_path;
  const canonicalDirectory = route.canonical_container_relative_path ?? route.canonical.relative_path;
  return sourcePath.startsWith(`${canonicalDirectory}/`) && !sourcePath.includes('../');
}
async function hashCanonicalForRoute(root, route, sourcePath) {
  const content = await readCanonicalBytesForRoute(root, route, sourcePath);
  return content ? createHash('sha256').update(content).digest('hex') : null;
}
async function readCanonicalBytesForRoute(root, route, sourcePath) {
  if (!isCanonicalLineageSource(route, sourcePath)) return null;
  try {
    const absolute = path.resolve(root, sourcePath);
    assertLexicallyInside(root, absolute, `${route.kind} lineage source`);
    const rootReal = await realpath(root);
    const ancestor = await findExistingAncestor(path.dirname(absolute), path.resolve(root));
    assertRealPathInside(rootReal, await realpath(ancestor), `${route.kind} lineage source`);
    await lstat(absolute);
    assertRealPathInside(rootReal, await realpath(absolute), `${route.kind} lineage source`);
    return readFile(absolute);
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function resolveSelection(root, config, routing, schemaVersion, storyId, explicitFeature) {
  if (schemaVersion !== '0.2.0') return { profile: null, profileName: null, featureSlug: explicitFeature == null ? slugify(storyId.replace(/^story-/, ''), 'feature') : slugify(explicitFeature, 'feature'), metadataSource: explicitFeature == null ? 'derived' : 'option' };
  const matches = (config.brainbase?.stories ?? []).filter((s) => normalizeStoryId(s.story_id ?? s.id) === storyId);
  if (matches.length > 1) throw new ArtifactRoutingError('duplicate_story_metadata', `Multiple catalog entries found for ${storyId}`);
  const entry = matches[0];
  if (!entry) throw new ArtifactRoutingError('missing_story_metadata', `Catalog entry is required for schema 0.2.0 Story ${storyId}`);
  const hasProfile = entry.artifact_profile != null;
  const hasFeatureSlug = entry.feature_slug != null;
  if (!hasProfile && !hasFeatureSlug) return { profile: null, profileName: null, featureSlug: explicitFeature == null ? slugify(storyId.replace(/^story-/, ''), 'feature') : slugify(explicitFeature, 'feature'), metadataSource: explicitFeature == null ? 'derived' : 'option' };
  if (!hasProfile || !hasFeatureSlug) throw new ArtifactRoutingError('incomplete_story_metadata', `Catalog entry for ${storyId} must define both artifact_profile and feature_slug`);
  const featureSlug = slugify(entry.feature_slug, 'feature');
  if (explicitFeature != null && slugify(explicitFeature, 'feature') !== featureSlug) throw new ArtifactRoutingError('metadata_mismatch', `featureSlug does not match catalog metadata for ${storyId}`);
  const profile = routing.profiles?.[entry.artifact_profile];
  if (!profile) throw new ArtifactRoutingError('unknown_profile', `Unknown artifact profile: ${entry.artifact_profile}`);
  const missing = ARTIFACT_KINDS.filter((kind) => !profile.artifacts?.[kind]);
  if (missing.length) throw new ArtifactRoutingError('incomplete_profile', `Artifact profile ${entry.artifact_profile} is missing: ${missing.join(', ')}`, { missing });
  const storyPath = resolveTemplate(root, 'story', profile.artifacts.story.canonical, { story_id: storyId, feature_slug: featureSlug }, 'canonical').absolute_path;
  let frontmatter; try { frontmatter = parseFrontmatter(await readFile(storyPath, 'utf8')); } catch (error) { if (error.code === 'ENOENT') throw new ArtifactRoutingError('missing_story_mirror', `Story frontmatter mirror is required for named profile ${entry.artifact_profile}`, { story_path: toPosix(path.relative(root, storyPath)) }); throw error; }
  if (frontmatter.artifact_profile == null || frontmatter.feature_slug == null) throw new ArtifactRoutingError('missing_story_mirror', `Story frontmatter must mirror artifact_profile and feature_slug for named profile ${entry.artifact_profile}`, { story_path: toPosix(path.relative(root, storyPath)) });
  if (frontmatter.artifact_profile !== entry.artifact_profile || slugify(frontmatter.feature_slug, 'feature') !== featureSlug) throw new ArtifactRoutingError('metadata_mismatch', `Story frontmatter routing metadata does not match catalog for ${storyId}`, { catalog: { artifact_profile: entry.artifact_profile, feature_slug: featureSlug }, frontmatter });
  return { profile, profileName: entry.artifact_profile, featureSlug, metadataSource: 'brainbase.stories' };
}

function validateRoutingShape(routing) {
  if (routing == null) return LEGACY_ARTIFACT_ROUTING_SCHEMA_VERSION;
  if (!routing || typeof routing !== 'object' || Array.isArray(routing)) throw new ArtifactRoutingError('invalid_config', 'artifact_routing must be an object');
  const schema = routing.schema_version ?? LEGACY_ARTIFACT_ROUTING_SCHEMA_VERSION;
  if (![LEGACY_ARTIFACT_ROUTING_SCHEMA_VERSION, ARTIFACT_ROUTING_SCHEMA_VERSION].includes(schema)) throw new ArtifactRoutingError('unsupported_schema', `Unsupported artifact_routing schema_version: ${schema}`);
  if (schema === '0.2.0' && routing.artifacts && Object.keys(routing.artifacts).length) throw new ArtifactRoutingError('ambiguous_profile', 'schema 0.2.0 routes must be declared in complete named profiles');
  if (schema === '0.2.0' && Object.keys(routing.profiles ?? {}).length < 2) throw new ArtifactRoutingError('incomplete_profiles', 'schema 0.2.0 requires at least two complete named profiles');
  const collections = schema === '0.2.0' ? Object.entries(routing.profiles ?? {}).map(([name, p]) => [`profiles.${name}.artifacts`, p?.artifacts]) : [['artifacts', routing.artifacts]];
  for (const [label, artifacts] of collections) {
    if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) { if (schema === '0.2.0') throw new ArtifactRoutingError('invalid_config', `artifact_routing.${label} must be an object`); continue; }
    if (schema === '0.2.0') {
      const missing = ARTIFACT_KINDS.filter((kind) => !Object.hasOwn(artifacts, kind));
      if (missing.length) throw new ArtifactRoutingError('incomplete_profile', `artifact_routing.${label} is missing: ${missing.join(', ')}`, { profile: label, missing });
    }
    for (const [kind, value] of Object.entries(artifacts)) validateArtifact(kind, value, schema, label);
  }
  return schema;
}

function validateArtifact(kind, value, schema, label) {
  if (!(schema === '0.1.0' ? LEGACY_KINDS : new Set(ARTIFACT_KINDS)).has(kind)) throw new ArtifactRoutingError('unknown_kind', `Unknown artifact kind in configuration: ${kind}`, { kind });
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ArtifactRoutingError('invalid_config', `artifact_routing.${label}.${kind} must be an object`);
  if (schema === '0.2.0' && (typeof value.canonical !== 'string' || !value.canonical.trim())) throw new ArtifactRoutingError('missing_canonical', `artifact_routing.${label}.${kind}.canonical must be a non-empty path template`, { kind, profile: label });
  if (value.canonical !== undefined && typeof value.canonical !== 'string') throw new ArtifactRoutingError('ambiguous_canonical', `artifact_routing.${label}.${kind}.canonical must be one path template`);
  if (value.projections !== undefined && !Array.isArray(value.projections)) throw new ArtifactRoutingError('ambiguous_projection', `artifact_routing.${label}.${kind}.projections must be an array`);
  if (schema === '0.1.0' && value.projections?.length && !LEGACY_PROJECTION_KINDS.has(kind)) throw new ArtifactRoutingError('unsupported_projection', `artifact_routing.artifacts.${kind}.projections is not supported because this artifact has no centralized projection writer`, { kind });
  if (schema === '0.2.0' && !OWNERSHIP.has(value.ownership)) throw new ArtifactRoutingError('invalid_ownership', `artifact_routing.${label}.${kind}.ownership is required`);
}

function normalizeProjection(root, kind, projection, index, variables, schema) {
  if (!projection || typeof projection !== 'object' || typeof projection.path !== 'string') throw new ArtifactRoutingError('ambiguous_projection', `Projection ${kind}[${index}] must declare a path`, { kind, index });
  if (schema === '0.1.0') { if (projection.generated !== true) throw new ArtifactRoutingError('ambiguous_projection', `artifact_routing.artifacts.${kind}.projections[${index}] must declare { path, generated: true }`, { kind, index }); return { generated: true, renderer: null, renderer_id: null, renderer_version: null, lineage_required: false, overwrite_policy: 'legacy_generated', ...resolveTemplate(root, kind, projection.path, variables, `projection[${index}]`) }; }
  if (!OWNERSHIP.has(projection.ownership)) throw new ArtifactRoutingError('invalid_ownership', `Projection ${kind}[${index}] must declare ownership`);
  if (projection.ownership === 'generated' && (!projection.renderer?.id || !projection.renderer?.version)) throw new ArtifactRoutingError('missing_renderer', `Generated projection ${kind}[${index}] must declare renderer id and version`);
  if (projection.ownership === 'generated' && RENDERERS.get(projection.renderer.id) !== String(projection.renderer.version)) throw new ArtifactRoutingError('unsupported_renderer', `Unsupported renderer: ${projection.renderer.id}@${projection.renderer.version}`, { kind, index });
  return { ownership: projection.ownership, renderer: projection.renderer ?? null, renderer_id: projection.renderer?.id ?? null, renderer_version: projection.renderer?.version == null ? null : String(projection.renderer.version), lineage_required: projection.ownership === 'generated', overwrite_policy: projection.ownership === 'generated' ? 'replace_if_lineage_matches' : 'never', generated: projection.ownership === 'generated', ...resolveTemplate(root, kind, projection.path, variables, `projection[${index}]`) };
}

function renderProjection(route, projection, content) {
  if (!projection.renderer) return content;
  const source = Buffer.isBuffer(content) ? content : Buffer.from(typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  const hash = createHash('sha256').update(source).digest('hex');
  const header = `<!-- vibepro-projection story_id=${route.story_id} feature_slug=${route.feature_slug} ownership=${projection.ownership} profile=${route.profile ?? 'legacy'} source=${route.canonical.relative_path} source_sha256=${hash} renderer=${projection.renderer.id}@${projection.renderer.version} direct_edit=false -->\n`;
  if (projection.renderer.id === 'architecture_markdown') return `${header}${source.toString('utf8')}`;
  let data; try { data = JSON.parse(source.toString('utf8')); } catch { data = { content: source.toString('utf8').trim() }; }
  if (projection.renderer.id === 'tasks_markdown') return `${header}${renderTasksMarkdown(data)}`;
  if (projection.renderer.id === 'gate_summary_markdown') return `${header}${renderGateSummary(data)}`;
  if (projection.renderer.id === 'release_summary_markdown') return `${header}${renderReleaseSummary(data)}`;
  if (projection.renderer.id === 'review_summary_markdown') return `${header}${renderReviewProjection(data)}`;
  if (projection.renderer.id === 'evidence_summary_markdown') return `${header}${renderEvidenceProjection(data)}`;
  if (projection.renderer.id === 'test_plan_markdown') return `${header}${renderTestPlanProjection(data)}`;
  if (projection.renderer.id === 'functional_spec_markdown') return `${header}${renderFunctionalSpec(data)}`;
  return `${header}# ${titleForRenderer(projection.renderer.id)}\n\n${renderKeyValues(data)}\n`;
}
async function assertProjectionLineage(target, route, projection) {
  let firstLine;
  try { firstLine = (await readFile(target, 'utf8')).split('\n', 1)[0]; }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (route.schema_version === LEGACY_ARTIFACT_ROUTING_SCHEMA_VERSION) return;
  const match = firstLine.match(/^<!-- vibepro-projection (.+) -->$/);
  if (!match) throw new ArtifactRoutingError('unmanaged_projection', `Existing projection has no VibePro lineage and will not be overwritten`, { path: projection.relative_path });
  const fields = Object.fromEntries(match[1].split(' ').map((part) => { const at = part.indexOf('='); return [part.slice(0, at), part.slice(at + 1)]; }));
  const expected = { story_id: route.story_id, feature_slug: route.feature_slug, ownership: 'generated', profile: route.profile ?? 'legacy', renderer: `${projection.renderer.id}@${projection.renderer.version}` };
  for (const [key, value] of Object.entries(expected)) if (fields[key] !== value) throw new ArtifactRoutingError('projection_lineage_mismatch', `Existing projection lineage ${key} does not match`, { path: projection.relative_path, expected: value, actual: fields[key] });
  // A directory artifact is a lifecycle container. Its projection may be refreshed
  // from a different generated file as stages are added, but never from outside
  // the same routed canonical directory. File artifacts remain exact-source bound.
  if (!isCanonicalLineageSource(route, fields.source)) throw new ArtifactRoutingError('projection_lineage_mismatch', `Existing projection lineage source does not match`, { path: projection.relative_path, expected: route.canonical.relative_path, actual: fields.source });
}

function renderTasksMarkdown(data) {
  const tasks = [...(data.tasks ?? [])].sort((a, b) => compareCodePoints(a.id, b.id));
  const ids = new Set(); for (const task of tasks) { if (ids.has(task.id)) throw new ArtifactRoutingError('duplicate_task_id', `Duplicate task id: ${task.id}`); ids.add(task.id); }
  return `# Tasks\n\n${tasks.map((t) => `## ${t.id}: ${t.title ?? ''}\n\n- story_id: ${t.story_id ?? data.story?.story_id ?? ''}\n- status: ${t.status ?? ''}\n- target_files: ${(t.target_files ?? []).join(', ')}\n- dependencies: ${(t.dependencies ?? []).join(', ')}\n- acceptance_criteria:\n${(t.acceptance_criteria ?? []).map((v) => `  - ${v}`).join('\n')}`).join('\n\n')}\n`;
}
function renderGateSummary(data) { const gates = data.gates ?? data.nodes ?? []; return `# Gate Summary\n\n- Status: ${data.status ?? data.overall_status ?? data.gate_status ?? 'unknown'}\n- Ready: ${data.ready_for_pr_create ?? data.ready ?? 'unknown'}\n- Unresolved: ${data.unresolved_gate_count ?? gates.filter((g) => !['pass', 'passed', 'complete'].includes(g.status)).length}\n\n## Gates\n\n${gates.length ? [...gates].sort((a, b) => String(a.id ?? a.name).localeCompare(String(b.id ?? b.name), 'en')).map((g) => `- ${g.id ?? g.name}: ${g.status ?? 'unknown'}${g.reason ? ` — ${g.reason}` : ''}`).join('\n') : '- No gate entries'}\n`; }
function renderReleaseSummary(data) { const gate = data.gate_status ?? data.gateStatus ?? data.pr_context?.gate_status ?? data.status ?? 'unknown'; const pr = data.pull_request ?? data.pr ?? {}; return `# Release Summary\n\n- Story: ${data.story_id ?? data.story?.story_id ?? '-'}\n- Status: ${data.status ?? data.overall_status ?? '-'}\n- Gate: ${typeof gate === 'object' ? gate.status ?? 'unknown' : gate}\n- PR: ${pr.url ?? data.url ?? '-'}\n- Ready for create: ${data.ready_for_pr_create ?? '-'}\n- Merge status: ${data.merge_status ?? pr.merge_state_status ?? '-'}\n`; }
function renderReviewProjection(data) { const findings = data.findings ?? data.results ?? []; return `# Review Summary\n\n- Stage: ${data.stage ?? '-'}\n- Status: ${data.status ?? data.overall_status ?? '-'}\n- Findings: ${findings.length}\n\n${findings.length ? findings.map((f) => `- ${f.id ?? f.title ?? 'finding'}: ${f.status ?? f.severity ?? '-'}`).join('\n') : '- No findings'}\n`; }
function renderEvidenceProjection(data) { const findings = data.findings ?? []; return `# Evidence Summary\n\n- Run: ${data.run_id ?? data.runId ?? '-'}\n- Gate: ${data.gate_status ?? data.gates?.[0]?.status ?? '-'}\n- Findings: ${findings.length}\n- Generated at: ${data.generated_at ?? '-'}\n`; }
function renderTestPlanProjection(data) { const commands = data.verification_commands ?? data.commands ?? []; return `# Test Plan\n\n- Status: ${data.status ?? '-'}\n- Commands: ${commands.length}\n\n${commands.length ? commands.map((c) => `- ${typeof c === 'string' ? c : c.command ?? c.id ?? '-'}`).join('\n') : '- No commands'}\n`; }
function renderFunctionalSpec(data) { const clauses = [...(data.clauses ?? data.requirements ?? [])].sort((a, b) => compareCodePoints(a.id ?? a.clause_id, b.id ?? b.clause_id)); const diagrams = [...(data.diagrams ?? [])].sort((a, b) => compareCodePoints(a.id ?? a.title ?? a.kind, b.id ?? b.title ?? b.kind)); return `# Functional Spec\n\n- Story: ${data.story_id ?? '-'}\n- Status: ${data.status ?? '-'}\n- Clauses: ${clauses.length}\n\n${clauses.map((c) => { const origin = c.origin ?? {}; const refs = [...(origin.story_refs ?? []), ...(origin.architecture_refs ?? []), ...(origin.code_refs ?? []), ...(origin.test_refs ?? [])].map((r) => stableJson(r)).sort(compareCodePoints); return `## ${c.id ?? c.clause_id ?? 'Clause'}\n\n${c.statement ?? c.text ?? c.requirement ?? c.description ?? ''}\n\n### Origin refs\n\n${refs.length ? refs.map((r) => `- ${r}`).join('\n') : '- none'}`; }).join('\n\n')}\n\n## Diagrams\n\n${diagrams.length ? diagrams.map((d) => `### ${d.id ?? d.title ?? d.kind ?? 'Diagram'}\n\n${d.mermaid ?? d.content ?? d.source ?? ''}`).join('\n\n') : '- none'}\n`; }
function renderKeyValues(data) { if (!data || typeof data !== 'object') return String(data ?? ''); return Object.keys(data).sort().filter((key) => ['string', 'number', 'boolean'].includes(typeof data[key])).map((key) => `- ${key}: ${data[key]}`).join('\n'); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`; return JSON.stringify(value); }
function compareCodePoints(left, right) { const a = Array.from(String(left ?? ''), (c) => c.codePointAt(0)); const b = Array.from(String(right ?? ''), (c) => c.codePointAt(0)); for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; }
function titleForRenderer(id) { return id.split('_').map((v) => v[0]?.toUpperCase() + v.slice(1)).join(' '); }
function parseFrontmatter(text) { const match = text.match(/^---\s*\n([\s\S]*?)\n---/); if (!match) return {}; const out = {}; for (const line of match[1].split('\n')) { const m = line.match(/^([a-z_][a-z0-9_]*):\s*["']?([^"']*?)["']?\s*$/); if (m) out[m[1]] = m[2].trim(); } return out; }

function normalizeStoryId(value) { if (!value) throw new ArtifactRoutingError('missing_variable', 'storyId is required to resolve artifact routes'); const raw = String(value).trim(); return /^[A-Z][A-Z0-9]*-\d+$/.test(raw) ? raw : slugify(raw, 'story'); }
function resolveTemplate(root, kind, template, variables, role) { if (typeof template !== 'string' || !template.trim()) throw new ArtifactRoutingError('invalid_template', `Artifact ${kind} ${role} path must be a non-empty string`, { kind, role }); if (path.isAbsolute(template)) throw new ArtifactRoutingError('absolute_path', `Artifact ${kind} ${role} path must be repository-relative: ${template}`, { kind, role, template }); const referenced = [...template.matchAll(VARIABLE_PATTERN)].map((m) => m[1]); const unsupported = referenced.filter((n) => !SUPPORTED_VARIABLES.has(n)); if (unsupported.length) throw new ArtifactRoutingError('unresolved_variable', `Artifact ${kind} ${role} path has unsupported variables: ${unsupported.join(', ')}`, { kind, role, variables: unsupported }); const expanded = template.replace(VARIABLE_PATTERN, (_, n) => variables[n]); if (/[{}]/.test(expanded)) throw new ArtifactRoutingError('unresolved_variable', `Artifact ${kind} ${role} path contains an unresolved variable: ${template}`, { kind, role, template }); const absolute = path.resolve(root, expanded); assertLexicallyInside(root, absolute, `${kind} ${role}`); const relative = toPosix(path.relative(root, absolute)); if (!relative || relative === '.') throw new ArtifactRoutingError('invalid_template', `Artifact ${kind} ${role} path cannot resolve to the repository root`, { kind, role }); return { template, relative_path: relative, absolute_path: absolute }; }
function assertNoCollisions(routes) { const destinations = new Map(); for (const route of Object.values(routes)) for (const d of [route.canonical, ...route.projections]) { const existing = destinations.get(d.relative_path); if (existing) throw new ArtifactRoutingError('path_collision', `Artifact path collision: ${existing.kind} and ${route.kind} resolve to ${d.relative_path}`, { path: d.relative_path, first: existing, second: { kind: route.kind } }); destinations.set(d.relative_path, { kind: route.kind, role: d === route.canonical ? 'canonical' : 'projection' }); } const entries = [...destinations.entries()]; for (const [candidatePath, candidate] of entries) { const ancestorDirectory = entries.find(([dir, owner]) => dir !== candidatePath && DIRECTORY_ARTIFACT_KINDS.has(owner.kind) && owner.role === 'canonical' && candidatePath.startsWith(`${dir}/`)); if (ancestorDirectory) throw new ArtifactRoutingError('path_collision', `Artifact directory collision: ${ancestorDirectory[0]} contains ${candidatePath}`, { path: ancestorDirectory[0] }); const nestedDirectory = entries.find(([dir, owner]) => dir !== candidatePath && DIRECTORY_ARTIFACT_KINDS.has(owner.kind) && owner.role === 'canonical' && dir.startsWith(`${candidatePath}/`)); if (nestedDirectory) throw new ArtifactRoutingError('path_collision', `Artifact path collision: ${candidatePath} is an ancestor of ${nestedDirectory[0]}`, { path: candidatePath }); } }
function assertLexicallyInside(root, target, label) { const relative = path.relative(root, target); if (relative.startsWith('..') || path.isAbsolute(relative)) throw new ArtifactRoutingError('repository_traversal', `Artifact ${label} must stay inside the repository`, { target }); }
function assertRealPathInside(rootReal, targetReal, label) { const relative = path.relative(rootReal, targetReal); if (relative.startsWith('..') || path.isAbsolute(relative)) throw new ArtifactRoutingError('repository_traversal', `Artifact ${label} must resolve inside the repository and cannot traverse a symlink outside it`, { target: targetReal }); }
async function findExistingAncestor(target, root) { let cursor = target; while (true) { try { await lstat(cursor); return cursor; } catch (error) { if (error.code !== 'ENOENT') throw error; if (cursor === root || path.dirname(cursor) === cursor) return root; cursor = path.dirname(cursor); } } }
async function exists(target) { try { await access(target); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function sameFile(a, b) { try { const [x, y] = await Promise.all([readFile(a), readFile(b)]); return createHash('sha256').update(x).digest('hex') === createHash('sha256').update(y).digest('hex'); } catch { return false; } }
function slugify(value, fallback) { return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback; }
function toPosix(value) { return value.split(path.sep).join('/'); }
