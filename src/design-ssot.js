import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_DESIGN_SSOT_REGISTRY_FILES = [
  'design-ssot.json',
  path.join('design-ssot', 'index.json'),
  path.join('docs', 'design-ssot.json'),
  path.join('docs', 'management', 'design-ssot.json')
];

export const DEFAULT_DESIGN_SSOT_REGISTRY_DIRS = [
  path.join('docs', 'design-ssot'),
  path.join('docs', 'management', 'design-ssot')
];

const CHILD_KINDS = new Set([
  'adr',
  'architecture',
  'story',
  'spec',
  'ux',
  'data_model',
  'workflow',
  'domain_contract',
  'design_system',
  'policy'
]);

const PASS_STATUSES = new Set(['passed', 'pass', 'ok']);

export async function initDesignSsot(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const id = sanitizeId(options.id);
  if (!id) throw new Error('design-ssot init requires --id <design-root-id>');
  if (!options.rootDoc) throw new Error('design-ssot init requires --root-doc <path>');
  const registryPath = normalizeRegistryPath(options.registry ?? 'design-ssot.json');
  const registry = await readEditableRegistry(root, registryPath);
  const rootDoc = toPosix(options.rootDoc);
  const existingIndex = registry.design_roots.findIndex((item) => item.id === id);
  const existing = existingIndex >= 0 ? registry.design_roots[existingIndex] : {};
  const entry = normalizeDesignRoot({
    ...existing,
    id,
    title: options.title ?? existing.title,
    root_doc: rootDoc,
    owner: options.owner ?? existing.owner,
    status: options.status ?? existing.status ?? 'active',
    required_child_kinds: options.requiredChildKinds
      ? parseCsv(options.requiredChildKinds)
      : existing.required_child_kinds
  }, registryPath);
  if (!entry.title) entry.title = titleFromId(id);
  if (existingIndex >= 0) registry.design_roots[existingIndex] = entry;
  else registry.design_roots.push(entry);
  const nextRegistry = {
    ...registry,
    schema_version: registry.schema_version ?? '0.1.0',
    model: 'vibepro-design-ssot-registry-v1',
    updated_at: new Date().toISOString(),
    design_roots: registry.design_roots
  };
  await writeRegistry(root, registryPath, nextRegistry);
  const snapshot = await writeDesignSsotRegistrySnapshot(root, entry.id, nextRegistry, registryPath);
  const normalizedRoots = nextRegistry.design_roots.map((item) => normalizeDesignRoot(item, registryPath));
  return {
    schema_version: '0.1.0',
    workflow: 'design-ssot-init',
    status: 'passed',
    registry: registryPath,
    design_root: entry,
    registry_summary: buildRegistrySummary(normalizedRoots, [registryPath]),
    artifacts: snapshot
  };
}

export async function linkDesignSsot(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const id = sanitizeId(options.id);
  if (!id) throw new Error('design-ssot link requires --id <design-root-id>');
  const kind = normalizeChildKind(options.kind);
  if (!kind) throw new Error(`design-ssot link requires --kind ${[...CHILD_KINDS].join('|')}`);
  if (!options.path) throw new Error('design-ssot link requires --path <child-doc>');
  const registryPath = normalizeRegistryPath(options.registry ?? 'design-ssot.json');
  const registry = await readEditableRegistry(root, registryPath);
  const index = registry.design_roots.findIndex((item) => item.id === id);
  if (index < 0) throw new Error(`Design SSOT root not found: ${id}. Run design-ssot init first.`);
  const entry = normalizeDesignRoot(registry.design_roots[index], registryPath);
  const child = normalizeChildLink({
    path: options.path,
    kind,
    required: options.required ?? true,
    relationship: options.relationship ?? 'implements',
    last_reviewed_root_hash: options.lastReviewedRootHash
  }, kind);
  const children = { ...(entry.children ?? {}) };
  const existing = new Set(normalizeChildren(children[kind]).map((item) => item.path));
  if (!existing.has(child.path)) {
    children[kind] = [...normalizeChildren(children[kind]), child];
  } else {
    children[kind] = normalizeChildren(children[kind]).map((item) => item.path === child.path ? { ...item, ...child } : item);
  }
  registry.design_roots[index] = normalizeDesignRoot({ ...entry, children }, registryPath);
  const nextRegistry = {
    ...registry,
    schema_version: registry.schema_version ?? '0.1.0',
    model: 'vibepro-design-ssot-registry-v1',
    updated_at: new Date().toISOString(),
    design_roots: registry.design_roots
  };
  await writeRegistry(root, registryPath, nextRegistry);
  const snapshot = await writeDesignSsotRegistrySnapshot(root, id, nextRegistry, registryPath);
  return {
    schema_version: '0.1.0',
    workflow: 'design-ssot-link',
    status: 'passed',
    registry: registryPath,
    design_root_id: id,
    child,
    artifacts: snapshot
  };
}

export async function getDesignSsotStatus(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const registry = await readDesignSsotRegistry(root, options);
  const roots = filterDesignRoots(registry.design_roots, options.id);
  return {
    schema_version: '0.1.0',
    workflow: 'design-ssot-status',
    status: roots.length > 0 ? 'passed' : 'not_applicable',
    registry_sources: registry.sources,
    summary: buildRegistrySummary(roots, registry.sources),
    design_roots: roots
  };
}

export async function auditDesignSsotCoverage(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const registry = await readDesignSsotRegistry(root, options);
  const roots = filterDesignRoots(registry.design_roots, options.id);
  const changedPaths = options.changedPaths ?? await resolveChangedPaths(root, options);
  const designDocs = await discoverDesignDocCandidates(root);
  const registeredDocs = buildRegisteredDesignDocIndex(roots);
  const coveredDocs = designDocs.map((doc) => {
    const registration = registeredDocs.get(doc.path) ?? null;
    return {
      ...doc,
      registered: Boolean(registration),
      registration
    };
  });
  const changedSet = new Set(changedPaths);
  const changedDocs = coveredDocs.filter((doc) => changedSet.has(doc.path));
  const unregisteredDocs = coveredDocs.filter((doc) => !doc.registered);
  const unregisteredChangedDocs = changedDocs.filter((doc) => !doc.registered);
  const result = {
    schema_version: '0.1.0',
    model: 'vibepro-design-ssot-coverage-v1',
    workflow: 'design-ssot-coverage',
    status: roots.length === 0 ? 'not_applicable' : unregisteredChangedDocs.length > 0 ? 'needs_review' : 'passed',
    generated_at: new Date().toISOString(),
    registry_sources: registry.sources,
    changed_paths: changedPaths,
    summary: {
      registry_source_count: registry.sources.length,
      design_root_count: roots.length,
      total_design_doc_count: coveredDocs.length,
      registered_root_count: coveredDocs.filter((doc) => doc.registration?.role === 'root').length,
      registered_child_count: coveredDocs.filter((doc) => doc.registration?.role === 'child').length,
      registered_doc_count: coveredDocs.filter((doc) => doc.registered).length,
      unregistered_doc_count: unregisteredDocs.length,
      changed_design_doc_count: changedDocs.length,
      changed_unregistered_design_doc_count: unregisteredChangedDocs.length,
      parent_design_declared_count: coveredDocs.filter((doc) => doc.parent_design.length > 0).length
    },
    registered_docs: coveredDocs.filter((doc) => doc.registered),
    unregistered_docs: unregisteredDocs,
    changed_docs: changedDocs,
    unregistered_changed_docs: unregisteredChangedDocs
  };
  if (options.writeArtifacts === false) {
    return { outDir: null, result };
  }
  const artifactId = options.id ? sanitizeId(options.id) : 'all';
  const artifacts = await writeDesignSsotCoverage(root, artifactId, result);
  return { outDir: path.dirname(path.join(root, artifacts.json)), result: { ...result, artifacts } };
}

export async function reconcileDesignSsot(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const registry = await readDesignSsotRegistry(root, options);
  const roots = filterDesignRoots(registry.design_roots, options.id);
  const changedPaths = options.changedPaths ?? await resolveChangedPaths(root, options);
  const coverage = await auditDesignSsotCoverage(root, {
    ...options,
    id: options.id,
    changedPaths,
    writeArtifacts: false
  });
  const reconciledRoots = [];
  for (const designRoot of roots) {
    reconciledRoots.push(await reconcileDesignRoot(root, designRoot, {
      changedPaths,
      registrySources: registry.sources
    }));
  }
  const coverageActions = buildCoverageActionItems(coverage.result);
  const actions = [
    ...reconciledRoots.flatMap((item) => item.action_items),
    ...coverageActions
  ];
  const status = resolveReconciliationStatus(reconciledRoots, registry.sources, changedPaths);
  const finalStatus = mergeReconciliationAndCoverageStatus(status, coverage.result.status);
  const result = {
    schema_version: '0.1.0',
    model: 'vibepro-design-ssot-reconciliation-v1',
    workflow: 'design-ssot-reconcile',
    status: finalStatus,
    generated_at: new Date().toISOString(),
    registry_sources: registry.sources,
    changed_paths: changedPaths,
    summary: {
      registry_source_count: registry.sources.length,
      design_root_count: roots.length,
      changed_design_root_count: reconciledRoots.filter((item) => item.changed.root_changed).length,
      changed_child_count: reconciledRoots.reduce((sum, item) => sum + item.changed.changed_children.length, 0),
      missing_required_child_count: actions.filter((item) => item.kind === 'missing_required_child').length,
      stale_child_count: actions.filter((item) => item.kind === 'stale_child_review').length,
      frontmatter_gap_count: actions.filter((item) => item.kind === 'frontmatter_gap').length,
      coverage_gap_count: actions.filter((item) => item.kind === 'unregistered_changed_design_doc').length,
      contradiction_count: actions.filter((item) => item.severity === 'block').length,
      action_item_count: actions.length
    },
    coverage: coverage.result,
    design_roots: reconciledRoots,
    action_items: actions
  };
  if (options.writeArtifacts === false) {
    return { outDir: null, result };
  }
  const artifactId = options.id ? sanitizeId(options.id) : 'all';
  const artifacts = await writeDesignSsotReconciliation(root, artifactId, result);
  return { outDir: path.dirname(path.join(root, artifacts.json)), result: { ...result, artifacts } };
}

export function buildDesignSsotGate(reconciliation, options = {}) {
  const status = reconciliation?.status ?? 'not_applicable';
  const summary = reconciliation?.summary ?? {};
  return {
    id: 'gate:design_ssot_reconciliation',
    type: 'design_ssot_reconciliation_gate',
    label: 'Design SSOT Reconciliation Gate',
    status,
    required: status !== 'not_applicable',
    reason: buildDesignSsotGateReason(reconciliation),
    artifact: options.artifact ?? null,
    registry_sources: reconciliation?.registry_sources ?? [],
    changed_paths: reconciliation?.changed_paths ?? [],
    summary,
    action_items: (reconciliation?.action_items ?? []).slice(0, 20)
  };
}

export function renderDesignSsotSummary(result) {
  const summary = result.summary ?? {};
  const coverage = result.coverage?.summary ?? {};
  const lines = [
    '# Design SSOT',
    '',
    `- status: ${result.status}`,
    `- registry_sources: ${summary.registry_source_count ?? result.registry_sources?.length ?? 0}`,
    `- design_roots: ${summary.design_root_count ?? result.design_roots?.length ?? 0}`,
    `- coverage_registered_docs: ${coverage.registered_doc_count ?? '-'}`,
    `- coverage_unregistered_docs: ${coverage.unregistered_doc_count ?? '-'}`,
    `- coverage_changed_unregistered_docs: ${coverage.changed_unregistered_design_doc_count ?? '-'}`,
    `- action_items: ${summary.action_item_count ?? result.action_items?.length ?? 0}`
  ];
  for (const action of (result.action_items ?? []).slice(0, 10)) {
    lines.push(`- ${action.severity}: ${action.kind} ${action.root_id ?? ''} ${action.path ?? action.root_doc ?? ''} - ${action.message}`);
  }
  return `${lines.join('\n')}\n`;
}

export function renderDesignSsotCoverageSummary(result) {
  const summary = result.summary ?? {};
  const lines = [
    '# Design SSOT Coverage',
    '',
    `- status: ${result.status}`,
    `- registry_sources: ${summary.registry_source_count ?? result.registry_sources?.length ?? 0}`,
    `- design_roots: ${summary.design_root_count ?? 0}`,
    `- total_design_docs: ${summary.total_design_doc_count ?? 0}`,
    `- registered_docs: ${summary.registered_doc_count ?? 0}`,
    `- unregistered_docs: ${summary.unregistered_doc_count ?? 0}`,
    `- changed_design_docs: ${summary.changed_design_doc_count ?? 0}`,
    `- changed_unregistered_docs: ${summary.changed_unregistered_design_doc_count ?? 0}`
  ];
  for (const doc of (result.unregistered_changed_docs ?? []).slice(0, 10)) {
    lines.push(`- needs_review: unregistered_changed_design_doc ${doc.path} (${doc.kind})`);
  }
  return `${lines.join('\n')}\n`;
}

export function renderDesignSsotStatus(result) {
  const lines = [
    '# Design SSOT Status',
    '',
    `- status: ${result.status}`,
    `- registry_sources: ${result.registry_sources.length}`,
    `- design_roots: ${result.summary.design_root_count}`,
    `- child_links: ${result.summary.child_link_count}`
  ];
  for (const root of result.design_roots.slice(0, 20)) {
    lines.push(`- ${root.id}: ${root.root_doc} (${root.child_links.length} children)`);
  }
  return `${lines.join('\n')}\n`;
}

function buildCoverageActionItems(coverage) {
  if (coverage?.status === 'not_applicable') return [];
  return (coverage?.unregistered_changed_docs ?? []).map((doc) => ({
    severity: 'needs_review',
    kind: 'unregistered_changed_design_doc',
    path: doc.path,
    child_kind: doc.kind,
    message: `Changed design doc is not registered in Design SSOT: ${doc.path}`
  }));
}

function mergeReconciliationAndCoverageStatus(reconciliationStatus, coverageStatus) {
  if (reconciliationStatus === 'block') return 'block';
  if (coverageStatus === 'needs_review') return 'needs_review';
  return reconciliationStatus;
}

function buildRegisteredDesignDocIndex(roots) {
  const index = new Map();
  for (const root of roots) {
    index.set(root.root_doc, {
      role: 'root',
      root_id: root.id,
      kind: 'architecture',
      source: root.source
    });
    for (const child of root.child_links) {
      index.set(child.path, {
        role: 'child',
        root_id: root.id,
        kind: child.kind,
        relationship: child.relationship,
        required: child.required,
        source: root.source
      });
    }
  }
  return index;
}

async function discoverDesignDocCandidates(root) {
  const markdownFiles = await listMarkdownFiles(path.join(root, 'docs'));
  const candidates = [];
  for (const absolutePath of markdownFiles) {
    const relativePath = toPosix(path.relative(root, absolutePath));
    const content = await readTextIfExists(absolutePath);
    const frontmatter = parseFrontmatter(content ?? '');
    const kind = inferDesignDocKind(relativePath, frontmatter);
    if (!kind) continue;
    candidates.push({
      path: relativePath,
      kind,
      title: String(frontmatter.title ?? ''),
      status: frontmatter.status ?? null,
      parent_design: normalizeStringList(frontmatter.parent_design ?? frontmatter.design_root ?? frontmatter.design_roots)
    });
  }
  return candidates.sort((a, b) => a.path.localeCompare(b.path));
}

async function listMarkdownFiles(dir) {
  const result = [];
  async function visit(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return;
      throw error;
    }
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.vibepro') continue;
        await visit(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        result.push(absolutePath);
      }
    }
  }
  await visit(dir);
  return result;
}

function inferDesignDocKind(relativePath, frontmatter = {}) {
  const file = toPosix(relativePath);
  if (/^docs\/architecture\/.*\.md$/.test(file)) {
    if (/(^|\/)(adr|ADR)[-_]?\d*|\/ADR[-_]/.test(file) || String(frontmatter.status ?? '').toLowerCase() === 'accepted') return 'adr';
    return 'architecture';
  }
  if (/^docs\/management\/stories\/.*\.md$/.test(file) || /^docs\/stories\/.*\.md$/.test(file)) return 'story';
  if (/^docs\/specs\/.*\.md$/.test(file)) return 'spec';
  if (/^docs\/design\/.*\.md$/.test(file)) return 'ux';
  if (/^docs\/workflows\/.*\.md$/.test(file)) return 'workflow';
  if (/^docs\/data-models\/.*\.md$/.test(file)) return 'data_model';
  if (frontmatter.parent_design || frontmatter.design_root || frontmatter.design_roots) return 'architecture';
  return null;
}

async function readDesignSsotRegistry(root, options = {}) {
  const files = [];
  const explicitFiles = options.registry ? [options.registry] : (options.registryFiles ?? DEFAULT_DESIGN_SSOT_REGISTRY_FILES);
  for (const relativePath of explicitFiles) {
    const loaded = await readJsonFile(root, relativePath);
    if (loaded) files.push(loaded);
  }
  const dirs = options.registry ? [] : (options.registryDirs ?? DEFAULT_DESIGN_SSOT_REGISTRY_DIRS);
  for (const relativeDir of dirs) {
    const dir = path.join(root, relativeDir);
    const entries = await listJsonFiles(dir);
    for (const filePath of entries) {
      const relativePath = toPosix(path.relative(root, filePath));
      if (files.some((file) => file.relative_path === relativePath)) continue;
      const loaded = await readJsonFile(root, relativePath);
      if (loaded) files.push(loaded);
    }
  }
  return {
    schema_version: '0.1.0',
    sources: files.map((file) => file.relative_path),
    design_roots: files.flatMap((file) => normalizeDesignRoots(file))
  };
}

async function readEditableRegistry(root, registryPath) {
  const existing = await readJsonFile(root, registryPath);
  if (!existing) {
    return {
      schema_version: '0.1.0',
      model: 'vibepro-design-ssot-registry-v1',
      design_roots: []
    };
  }
  return {
    schema_version: existing.data.schema_version ?? '0.1.0',
    model: existing.data.model ?? 'vibepro-design-ssot-registry-v1',
    design_roots: normalizeDesignRoots(existing)
  };
}

function normalizeDesignRoots(file) {
  const root = file.data;
  const entries = Array.isArray(root)
    ? root
    : root?.design_roots ?? root?.roots ?? [];
  return entries
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => normalizeDesignRoot(entry, file.relative_path))
    .filter((entry) => entry.id && entry.root_doc);
}

function normalizeDesignRoot(entry, source) {
  const children = normalizeChildMap(entry.children ?? entry.child_docs ?? {});
  const childLinks = Object.entries(children).flatMap(([kind, links]) => links.map((link) => ({ ...link, kind })));
  const requiredKinds = parseCsv(entry.required_child_kinds ?? entry.requiredChildKinds);
  return {
    id: sanitizeId(entry.id),
    title: String(entry.title ?? ''),
    root_doc: toPosix(entry.root_doc ?? entry.rootDoc ?? entry.path ?? ''),
    owner: entry.owner ? String(entry.owner) : null,
    status: String(entry.status ?? 'active'),
    authority_level: String(entry.authority_level ?? entry.authorityLevel ?? 'design_root'),
    scope: entry.scope ?? null,
    owned_surfaces: normalizeStringList(entry.owned_surfaces ?? entry.ownedSurfaces),
    required_child_kinds: requiredKinds,
    reconciliation_policy: {
      root_only_change: 'needs_review',
      missing_required_child: 'block',
      frontmatter_missing: 'needs_review',
      stale_review_hash: 'needs_review',
      accepted_adr_supersession_conflict: 'block',
      ...(entry.reconciliation_policy ?? entry.reconciliationPolicy ?? {})
    },
    children,
    child_links: childLinks,
    source
  };
}

function normalizeChildMap(children) {
  const result = {};
  for (const [kind, value] of Object.entries(children ?? {})) {
    const normalizedKind = normalizeChildKind(kind);
    if (!normalizedKind) continue;
    result[normalizedKind] = normalizeChildren(value).map((child) => normalizeChildLink(child, normalizedKind));
  }
  return result;
}

function normalizeChildren(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.map((item) => typeof item === 'string' ? { path: item } : item).filter(Boolean);
}

function normalizeChildLink(value, kind) {
  return {
    kind,
    path: toPosix(value.path ?? value.ref ?? value.file ?? ''),
    required: value.required !== false,
    relationship: String(value.relationship ?? 'implements'),
    last_reviewed_root_hash: value.last_reviewed_root_hash ?? value.lastReviewedRootHash ?? null
  };
}

async function reconcileDesignRoot(root, designRoot, options) {
  const rootDocPath = path.join(root, designRoot.root_doc);
  const rootContent = await readTextIfExists(rootDocPath);
  const rootExists = rootContent !== null;
  const rootHash = rootExists ? hashText(rootContent) : null;
  const rootFrontmatter = parseFrontmatter(rootContent ?? '');
  const childResults = [];
  const actionItems = [];
  const changedPaths = options.changedPaths ?? [];
  const rootChanged = changedPaths.includes(designRoot.root_doc);
  const childPaths = new Set(designRoot.child_links.map((child) => child.path));
  const changedChildren = changedPaths.filter((filePath) => childPaths.has(filePath));

  if (!rootExists) {
    actionItems.push({
      severity: 'block',
      kind: 'missing_root_doc',
      root_id: designRoot.id,
      root_doc: designRoot.root_doc,
      message: `Design root document is missing: ${designRoot.root_doc}`
    });
  }

  for (const requiredKind of designRoot.required_child_kinds) {
    const requiredChildren = designRoot.child_links.filter((child) => child.kind === requiredKind && child.required);
    if (requiredChildren.length === 0) {
      actionItems.push({
        severity: 'block',
        kind: 'missing_required_child',
        root_id: designRoot.id,
        child_kind: requiredKind,
        message: `Design root ${designRoot.id} requires at least one ${requiredKind} child.`
      });
    }
  }

  if (rootChanged && changedChildren.length === 0 && designRoot.child_links.length > 0) {
    actionItems.push({
      severity: 'needs_review',
      kind: 'root_only_change',
      root_id: designRoot.id,
      root_doc: designRoot.root_doc,
      message: `Root design doc changed without linked child doc updates. Review ${designRoot.child_links.length} linked child doc(s).`
    });
  }

  for (const child of designRoot.child_links) {
    const childResult = await reconcileChild(root, designRoot, child, {
      rootHash,
      rootFrontmatter,
      rootChanged,
      changed: changedPaths.includes(child.path)
    });
    childResults.push(childResult);
    actionItems.push(...childResult.action_items);
  }

  const status = resolveRootStatus(actionItems);
  return {
    id: designRoot.id,
    title: designRoot.title,
    source: designRoot.source,
    root_doc: designRoot.root_doc,
    root_exists: rootExists,
    root_hash: rootHash,
    status,
    changed: {
      root_changed: rootChanged,
      changed_children: changedChildren
    },
    summary: {
      child_count: childResults.length,
      action_item_count: actionItems.length,
      missing_required_child_count: actionItems.filter((item) => item.kind === 'missing_required_child').length,
      frontmatter_gap_count: actionItems.filter((item) => item.kind === 'frontmatter_gap').length,
      stale_child_count: actionItems.filter((item) => item.kind === 'stale_child_review').length,
      block_count: actionItems.filter((item) => item.severity === 'block').length
    },
    children: childResults,
    action_items: actionItems
  };
}

async function reconcileChild(root, designRoot, child, context) {
  const childContent = await readTextIfExists(path.join(root, child.path));
  const exists = childContent !== null;
  const frontmatter = parseFrontmatter(childContent ?? '');
  const actionItems = [];
  if (!exists && child.required) {
    actionItems.push({
      severity: 'block',
      kind: 'missing_required_child',
      root_id: designRoot.id,
      child_kind: child.kind,
      path: child.path,
      message: `Required ${child.kind} child is missing: ${child.path}`
    });
  }
  if (exists) {
    const parentDesigns = normalizeStringList(frontmatter.parent_design ?? frontmatter.design_root ?? frontmatter.design_roots);
    if (parentDesigns.length === 0) {
      actionItems.push({
        severity: 'needs_review',
        kind: 'frontmatter_gap',
        root_id: designRoot.id,
        child_kind: child.kind,
        path: child.path,
        field: 'parent_design',
        message: `Linked ${child.kind} child does not declare parent_design.`
      });
    } else if (!parentDesigns.includes(designRoot.id) && !parentDesigns.includes(designRoot.root_doc)) {
      actionItems.push({
        severity: 'needs_review',
        kind: 'frontmatter_gap',
        root_id: designRoot.id,
        child_kind: child.kind,
        path: child.path,
        field: 'parent_design',
        message: `Linked ${child.kind} child parent_design does not reference ${designRoot.id}.`
      });
    }
    const reviewedHash = child.last_reviewed_root_hash
      ?? frontmatter.last_reviewed_root_hash
      ?? frontmatter.design_root_hash
      ?? frontmatter.parent_design_hash
      ?? null;
    if (reviewedHash && context.rootHash && reviewedHash !== context.rootHash) {
      actionItems.push({
        severity: 'needs_review',
        kind: 'stale_child_review',
        root_id: designRoot.id,
        child_kind: child.kind,
        path: child.path,
        expected_hash: context.rootHash,
        actual_hash: reviewedHash,
        message: `Linked ${child.kind} child was reviewed against a stale root design hash.`
      });
    }
    const rootSupersedes = normalizeStringList(context.rootFrontmatter.supersedes);
    const childStatus = String(frontmatter.status ?? '').toLowerCase();
    const childSupersededBy = normalizeStringList(frontmatter.superseded_by ?? frontmatter.supersededBy);
    if (child.kind === 'adr' && childStatus === 'accepted' && rootSupersedes.includes(child.path) && childSupersededBy.length === 0) {
      actionItems.push({
        severity: 'block',
        kind: 'accepted_adr_supersession_conflict',
        root_id: designRoot.id,
        child_kind: child.kind,
        path: child.path,
        message: `Root design supersedes accepted ADR ${child.path}, but the ADR has no superseded_by frontmatter.`
      });
    }
  }
  return {
    kind: child.kind,
    path: child.path,
    required: child.required,
    relationship: child.relationship,
    exists,
    changed: context.changed,
    status: resolveRootStatus(actionItems),
    frontmatter: {
      parent_design: normalizeStringList(frontmatter.parent_design ?? frontmatter.design_root ?? frontmatter.design_roots),
      status: frontmatter.status ?? null,
      superseded_by: normalizeStringList(frontmatter.superseded_by ?? frontmatter.supersededBy),
      has_hash_binding: Boolean(frontmatter.last_reviewed_root_hash ?? frontmatter.design_root_hash ?? frontmatter.parent_design_hash ?? child.last_reviewed_root_hash)
    },
    action_items: actionItems
  };
}

function resolveReconciliationStatus(roots, sources, changedPaths) {
  if (sources.length === 0) return 'not_applicable';
  if (roots.length === 0) return 'not_applicable';
  if (roots.some((root) => root.status === 'block')) return 'block';
  if (roots.some((root) => root.status === 'needs_review')) return 'needs_review';
  if (changedPaths.length === 0 && roots.length > 0) return 'passed';
  return 'passed';
}

function resolveRootStatus(actionItems) {
  if (actionItems.some((item) => item.severity === 'block')) return 'block';
  if (actionItems.some((item) => item.severity === 'needs_review')) return 'needs_review';
  return 'passed';
}

function buildDesignSsotGateReason(reconciliation) {
  if (!reconciliation) return 'Design SSOT reconciliation was not evaluated';
  const summary = reconciliation.summary ?? {};
  if (reconciliation.status === 'not_applicable') return 'No Design SSOT registry was found for this repository.';
  if (reconciliation.status === 'passed') {
    return `${summary.design_root_count ?? 0} design root(s) reconciled without deterministic lineage gaps.`;
  }
  if (reconciliation.status === 'block') {
    return `${summary.contradiction_count ?? 0} blocking design lineage contradiction(s) or missing required child doc(s) found.`;
  }
  if (reconciliation.status === 'needs_review') {
    return `${summary.action_item_count ?? 0} design lineage action item(s) need review before the PR can be treated as design-consistent.`;
  }
  return `Design SSOT reconciliation status: ${reconciliation.status}`;
}

function buildRegistrySummary(roots, sources) {
  return {
    registry_source_count: sources.length,
    design_root_count: roots.length,
    child_link_count: roots.reduce((sum, item) => sum + item.child_links.length, 0),
    required_child_link_count: roots.reduce((sum, item) => sum + item.child_links.filter((child) => child.required).length, 0)
  };
}

function filterDesignRoots(roots, id) {
  const normalized = sanitizeId(id);
  if (!normalized) return roots;
  return roots.filter((root) => root.id === normalized);
}

async function resolveChangedPaths(root, options) {
  if (Array.isArray(options.git?.changed_files)) {
    return filterGeneratedVibeproPaths(options.git.changed_files.map((file) => toPosix(file.path ?? file)).filter(Boolean));
  }
  if (Array.isArray(options.changedFiles)) {
    return filterGeneratedVibeproPaths(options.changedFiles.map((file) => toPosix(file.path ?? file)).filter(Boolean));
  }
  if (!options.base) return [];
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const [{ stdout: committed }, { stdout: dirty }] = await Promise.all([
      execFileAsync('git', ['diff', '--name-only', `${options.base}...HEAD`], { cwd: root, encoding: 'utf8' }),
      execFileAsync('git', ['status', '--porcelain', '-uall'], { cwd: root, encoding: 'utf8' })
    ]);
    return filterGeneratedVibeproPaths(uniqueStrings([
      ...committed.split('\n').map((line) => toPosix(line.trim())).filter(Boolean),
      ...parseGitStatusPaths(dirty)
    ]));
  } catch {
    return [];
  }
}

async function writeDesignSsotRegistrySnapshot(root, id, registry, registryPath) {
  const outDir = path.join(root, '.vibepro', 'design-ssot', id);
  await mkdir(outDir, { recursive: true });
  const snapshot = {
    schema_version: '0.1.0',
    model: 'vibepro-design-ssot-registry-snapshot-v1',
    registry_path: registryPath,
    captured_at: new Date().toISOString(),
    registry
  };
  await writeFile(path.join(outDir, 'registry.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
  return {
    registry_snapshot: toPosix(path.relative(root, path.join(outDir, 'registry.json')))
  };
}

async function writeDesignSsotReconciliation(root, id, result) {
  const outDir = path.join(root, '.vibepro', 'design-ssot', id);
  await mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'reconciliation.json');
  const markdownPath = path.join(outDir, 'reconciliation.md');
  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(markdownPath, renderDesignSsotSummary(result));
  return {
    json: toPosix(path.relative(root, jsonPath)),
    markdown: toPosix(path.relative(root, markdownPath))
  };
}

async function writeDesignSsotCoverage(root, id, result) {
  const outDir = path.join(root, '.vibepro', 'design-ssot', id);
  await mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'coverage.json');
  const markdownPath = path.join(outDir, 'coverage.md');
  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(markdownPath, renderDesignSsotCoverageSummary(result));
  return {
    json: toPosix(path.relative(root, jsonPath)),
    markdown: toPosix(path.relative(root, markdownPath))
  };
}

async function writeRegistry(root, registryPath, registry) {
  const absolutePath = path.join(root, registryPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(registry, null, 2)}\n`);
}

async function readJsonFile(root, relativePath) {
  try {
    const normalized = normalizeRegistryPath(relativePath);
    const raw = await readFile(path.join(root, normalized), 'utf8');
    return {
      relative_path: normalized,
      data: JSON.parse(raw)
    };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

async function listJsonFiles(dir) {
  try {
    const dirStat = await stat(dir);
    if (!dirStat.isDirectory()) return [];
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(dir, entry.name));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

function parseFrontmatter(content) {
  const match = String(content ?? '').match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result = {};
  let currentKey = null;
  for (const rawLine of match[1].split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      const value = keyMatch[2].trim();
      result[currentKey] = value ? stripQuotes(value) : [];
      continue;
    }
    const itemMatch = line.match(/^\s*-\s*(.+)$/);
    if (itemMatch && currentKey) {
      if (!Array.isArray(result[currentKey])) result[currentKey] = result[currentKey] ? [result[currentKey]] : [];
      result[currentKey].push(stripQuotes(itemMatch[1].trim()));
    }
  }
  return result;
}

function parseCsv(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeStringList(value) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => String(item).trim()).filter(Boolean);
}

function parseGitStatusPaths(output) {
  return String(output ?? '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap((line) => {
      const value = line.slice(3).trim();
      if (!value) return [];
      const rename = value.match(/^(.+?)\s+->\s+(.+)$/);
      if (rename) return [toPosix(rename[1]), toPosix(rename[2])];
      return [toPosix(value)];
    });
}

function uniqueStrings(items) {
  return [...new Set(items.filter(Boolean))];
}

function filterGeneratedVibeproPaths(items) {
  return items.filter((item) => item && !item.startsWith('.vibepro/'));
}

function normalizeChildKind(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
  if (!CHILD_KINDS.has(normalized)) return null;
  return normalized;
}

function normalizeRegistryPath(value) {
  return toPosix(value).replace(/^\.\//, '');
}

function sanitizeId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleFromId(value) {
  return String(value ?? '').split(/[-_]+/).filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`).join(' ');
}

function stripQuotes(value) {
  return String(value ?? '').replace(/^['"]|['"]$/g, '');
}

function hashText(value) {
  return createHash('sha256').update(value).digest('hex');
}

function toPosix(value) {
  return String(value ?? '').replace(/\\/g, '/');
}
