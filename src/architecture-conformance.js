import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { WORKSPACE_DIR } from './workspace.js';

export const CONFORMANCE_SCHEMA_VERSION = '0.1.0';
export const DEFAULT_TARGET_MODEL_PATH = path.join('docs', 'architecture', 'target-model.json');

// Graphify "calls" edges were found to be mostly extraction noise (identifier
// references attributed to the wrong direction): an independent audit of the
// largest violation pair (workspace-infra -> story, 46 edges) found only 3
// real dependencies (see PR #387 / story-vibepro-infra-story-dependency-cut).
// Dependency violations are therefore measured from a deterministic scan of
// actual import/export/require statements, not from Graphify's call graph.
export const EDGE_SOURCE = 'import_scan';
export const EDGE_SOURCE_NOTE =
  'graphifyの"calls"エッジは識別子参照の逆向き帰属によるノイズが大半だった' +
  '(PR #387実測: 最大違反ペアworkspace-infra->storyの46 edges中、実依存は3本のみ)。' +
  'モジュール間依存の判定は実import/export/require文の決定論的スキャンへ移行し、graph.jsonは文脈情報としてのみ扱う。';

const GRAPH_CONTEXT_RELATIONS = new Set(['calls', 'imports_from', 'method']);
const RESOLVABLE_EXTENSIONS = ['.js', '.mjs', '.cjs'];
const INDEX_CANDIDATES = ['index.js', 'index.mjs', 'index.cjs'];

const STATIC_IMPORT_RE = /\bimport\s+(?:[^'"();]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
const EXPORT_FROM_RE = /\bexport\s+(?:[^'"();]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
const REFERENCE_REGEXPS = [STATIC_IMPORT_RE, EXPORT_FROM_RE, DYNAMIC_IMPORT_RE, REQUIRE_RE];

export async function runArchitectureConformance(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const modelPath = path.resolve(root, options.modelPath ?? DEFAULT_TARGET_MODEL_PATH);
  const graphPath = path.resolve(root, options.graphPath ?? path.join(WORKSPACE_DIR, 'graphify', 'graph.json'));

  const model = await loadTargetModel(modelPath);
  const graphContext = await loadGraphContext(root, graphPath);

  const { jsFiles, allFiles } = await collectScopeSource(root, model.scope_roots);
  if (jsFiles.length === 0) {
    throw new Error(
      `scope_roots (${model.scope_roots.join(', ')}) 配下に .js/.mjs/.cjs ファイルが見つからない。import scan を実行できない。`
    );
  }

  const assignments = assignFilesToModules(jsFiles.map((entry) => entry.file), model.modules);
  const { edges: importEdges, unresolvedReferenceCount } = buildImportDependencyEdges({ jsFiles, allFiles });
  const dependencyFindings = findDependencyViolations({ importEdges, model, assignments });
  const budgetFindings = findBudgetViolations({ scopeFiles: jsFiles, model, assignments });
  const orphanFindings = assignments.orphans.map((file) => ({
    kind: 'orphan_file',
    severity: 'review',
    rule_id: null,
    id: `orphan_file:${file}`,
    file,
    summary: `${file} はtarget modelのどのモジュールにも属していない`
  }));
  const stalePatternFindings = assignments.stalePatterns.map((entry) => ({
    kind: 'stale_pattern',
    severity: 'review',
    rule_id: null,
    id: `stale_pattern:${entry.module}:${entry.pattern}`,
    module: entry.module,
    pattern: entry.pattern,
    summary: `モジュール ${entry.module} のパターン ${entry.pattern} に一致するファイルが存在しない`
  }));
  const { cycleFindings, mutualFindings } = findDependencyCycles({ importEdges, assignments });

  const violations = [
    ...dependencyFindings,
    ...budgetFindings,
    ...orphanFindings,
    ...stalePatternFindings,
    ...cycleFindings,
    ...mutualFindings
  ];
  const result = {
    schema_version: CONFORMANCE_SCHEMA_VERSION,
    mode: 'dry_run',
    edge_source: EDGE_SOURCE,
    edge_source_note: EDGE_SOURCE_NOTE,
    model: {
      path: toRepoRelative(root, modelPath),
      status: model.status,
      version: model.model_version,
      adjudicated_by: model.adjudicated_by ?? null,
      module_count: model.modules.length
    },
    advisory_notice: model.status === 'draft'
      ? 'target model は未裁定(draft)。violation は参考値であり、モデル裁定後に確定する。'
      : null,
    import_scan: {
      scanned_file_count: jsFiles.length,
      edge_count: importEdges.length,
      unresolved_reference_count: unresolvedReferenceCount
    },
    graph_context: graphContext,
    summary: {
      violation_count: violations.length,
      undeclared_dependency_count: dependencyFindings.length,
      budget_violation_count: budgetFindings.length,
      orphan_file_count: orphanFindings.length,
      stale_pattern_count: stalePatternFindings.length,
      dependency_cycle_count: cycleFindings.length,
      mutual_dependency_count: mutualFindings.length,
      module_file_counts: Object.fromEntries(
        model.modules.map((module) => [module.name, assignments.filesByModule.get(module.name)?.length ?? 0])
      )
    },
    violations
  };

  if (options.write !== false) {
    const outDir = path.join(root, WORKSPACE_DIR, 'architecture', 'conformance');
    await mkdir(outDir, { recursive: true });
    const jsonPath = path.join(outDir, 'conformance.json');
    await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
    const mdPath = path.join(outDir, 'conformance.md');
    await writeFile(mdPath, renderConformanceMarkdown(result));
    result.artifacts = {
      json: toRepoRelative(root, jsonPath),
      markdown: toRepoRelative(root, mdPath)
    };
  }
  return result;
}

export async function loadTargetModel(modelPath) {
  let raw;
  try {
    raw = await readFile(modelPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`target model が存在しない: ${modelPath}。docs/architecture/target-model.json を作成してから実行する。`);
    }
    throw error;
  }
  let model;
  try {
    model = JSON.parse(raw);
  } catch (error) {
    throw new Error(`target model のJSONが不正: ${modelPath} (${error.message})`);
  }
  if (!Array.isArray(model.modules) || model.modules.length === 0) {
    throw new Error(`target model に modules が定義されていない: ${modelPath}`);
  }
  for (const module of model.modules) {
    if (!module.name || !Array.isArray(module.paths) || module.paths.length === 0) {
      throw new Error(`target model の module 定義が不正 (name/paths 必須): ${JSON.stringify(module?.name ?? module)}`);
    }
  }
  if (!model.status || !['draft', 'adjudicated'].includes(model.status)) {
    throw new Error(`target model の status は draft|adjudicated が必須: ${modelPath}`);
  }
  return {
    scope_roots: model.scope_roots ?? ['src', 'bin'],
    status: model.status,
    adjudicated_by: model.adjudicated_by ?? null,
    model_version: parseModelVersion(model.model_version, modelPath),
    governance: model.governance ?? null,
    modules: model.modules,
    allowed_dependencies: model.allowed_dependencies ?? {},
    budgets: {
      default_max_file_lines: model.budgets?.default_max_file_lines ?? null,
      file_line_baseline: model.budgets?.file_line_baseline ?? {}
    }
  };
}

// TMG-S-2: model_version identifies which adjudicated revision of the target model a measurement
// was taken against. It is optional (older/consumer models predate it) and degrades to null rather
// than failing the scan, but a present-yet-malformed value is an error: silently treating "0" or
// "v2" as "no version" would let a delta silently compare across model revisions -- exactly the
// misreading versioning exists to prevent (see governance.model_version_policy in target-model.json).
export function parseModelVersion(value, modelPath) {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(
      `target model の model_version は1以上の整数が必須 (received: ${JSON.stringify(value)}): ${modelPath}`
    );
  }
  return value;
}

// graph.json is optional context only (dependency-violation detection no
// longer reads it). Its absence must not fail the conformance run.
async function loadGraphContext(root, graphPath) {
  const relPath = toRepoRelative(root, graphPath);
  let raw;
  try {
    raw = await readFile(graphPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        available: false,
        path: relPath,
        reason: 'graph.json が存在しない(任意情報。import scanはgraph.json無しで動作する)'
      };
    }
    throw error;
  }
  let graph;
  try {
    graph = JSON.parse(raw);
  } catch (error) {
    throw new Error(`graph.json のparseに失敗: ${graphPath} (${error.message})`);
  }
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const links = Array.isArray(graph.links) ? graph.links : Array.isArray(graph.edges) ? graph.edges : [];
  const callsEdgeCount = links.filter((link) => GRAPH_CONTEXT_RELATIONS.has(link.relation ?? link.type ?? null)).length;
  return {
    available: true,
    path: relPath,
    node_count: nodes.length,
    calls_edge_count: callsEdgeCount,
    note: 'graph.jsonの"calls"等のエッジは文脈情報のみ。violation判定には使わない (edge_source: import_scan を参照)'
  };
}

// Walk each scope root once and return both the full file set (any
// extension, used to resolve import specifiers) and the subset of
// .js/.mjs/.cjs source files (used for import scanning + line-budget checks).
export async function collectScopeSource(root, scopeRoots) {
  const allFiles = new Set();
  const jsFiles = [];
  for (const scopeRoot of scopeRoots) {
    const absRoot = path.join(root, scopeRoot);
    let entries;
    try {
      entries = await walk(absRoot);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const absFile of entries) {
      const relFile = normalizePath(path.relative(root, absFile));
      allFiles.add(relFile);
      if (!/\.(js|mjs|cjs)$/.test(absFile)) continue;
      const content = await readFile(absFile, 'utf8');
      const lineCount = content.length === 0 ? 0 : content.split('\n').length;
      jsFiles.push({ file: relFile, line_count: lineCount, content });
    }
  }
  jsFiles.sort((a, b) => a.file.localeCompare(b.file));
  return { jsFiles, allFiles };
}

async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await walk(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

export function assignFilesToModules(files, modules) {
  const filesByModule = new Map(modules.map((module) => [module.name, []]));
  const moduleByFile = new Map();
  const matchedPatterns = new Set();
  const orphans = [];
  for (const file of files) {
    const match = matchModule(file, modules);
    if (match) {
      filesByModule.get(match.module.name).push(file);
      moduleByFile.set(file, match.module.name);
      matchedPatterns.add(`${match.module.name} ${match.pattern}`);
    } else {
      orphans.push(file);
    }
  }
  const stalePatterns = [];
  for (const module of modules) {
    for (const pattern of module.paths) {
      if (!matchedPatterns.has(`${module.name} ${pattern}`)) {
        stalePatterns.push({ module: module.name, pattern });
      }
    }
  }
  return { filesByModule, moduleByFile, orphans, stalePatterns };
}

function matchModule(file, modules) {
  for (const module of modules) {
    for (const pattern of module.paths) {
      if (matchPattern(file, pattern)) return { module, pattern };
    }
  }
  return null;
}

export function matchPattern(file, pattern) {
  const normalized = normalizePath(pattern);
  if (normalized.endsWith('/')) return file.startsWith(normalized);
  if (normalized.endsWith('*')) return file.startsWith(normalized.slice(0, -1));
  return file === normalized;
}

// Strip block and line comments (best-effort, regex-based) so that import-ish
// text inside comments does not produce phantom edges. The negative
// lookbehind-style guard `(^|[^:])` prevents `https://` style strings from
// being mistaken for a line comment.
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// Extract every distinct module specifier referenced via static import,
// `export ... from`, dynamic `import()`, or `require()` in a file's source.
export function extractImportSpecifiers(source) {
  const stripped = stripComments(source);
  const specifiers = new Set();
  for (const re of REFERENCE_REGEXPS) {
    re.lastIndex = 0;
    let match = re.exec(stripped);
    while (match !== null) {
      specifiers.add(match[1]);
      match = re.exec(stripped);
    }
  }
  return [...specifiers];
}

// Resolve a relative import specifier written inside `fromFile` to a
// repo-relative path, trying the specifier as-is, then with resolvable
// extensions, then as a directory index. Returns null if nothing on disk
// (within the scanned scope) matches -- e.g. bare/node: specifiers were
// already filtered out by the caller, so an unresolved relative specifier
// here means the target is outside scope_roots or does not exist.
export function resolveRelativeImport(fromFile, specifier, allFiles) {
  const fromDir = path.posix.dirname(fromFile);
  const rawTarget = normalizePath(path.posix.normalize(path.posix.join(fromDir, specifier)));
  const hasKnownExtension = RESOLVABLE_EXTENSIONS.some((ext) => rawTarget.endsWith(ext)) || rawTarget.endsWith('.json');
  const candidates = hasKnownExtension
    ? [rawTarget]
    : [
        ...RESOLVABLE_EXTENSIONS.map((ext) => `${rawTarget}${ext}`),
        ...INDEX_CANDIDATES.map((idx) => `${rawTarget}/${idx}`)
      ];
  for (const candidate of candidates) {
    if (allFiles.has(candidate)) return candidate;
  }
  return null;
}

// Build the internal (repo-relative) import dependency edge set. node:
// builtins and npm packages (any specifier not starting with '.') are
// excluded by construction -- only relative specifiers are resolved.
export function buildImportDependencyEdges({ jsFiles, allFiles }) {
  const edges = [];
  let unresolvedReferenceCount = 0;
  for (const { file, content } of jsFiles) {
    const specifiers = extractImportSpecifiers(content);
    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) continue;
      const resolved = resolveRelativeImport(file, specifier, allFiles);
      if (!resolved) {
        unresolvedReferenceCount += 1;
        continue;
      }
      if (resolved === file) continue;
      edges.push({ source_file: file, target_file: resolved });
    }
  }
  return { edges, unresolvedReferenceCount };
}

function findDependencyViolations({ importEdges, model, assignments }) {
  const allowed = new Map(
    Object.entries(model.allowed_dependencies).map(([from, toList]) => [from, new Set(toList)])
  );
  const grouped = new Map();
  for (const edge of importEdges) {
    const fromModule = assignments.moduleByFile.get(edge.source_file);
    const toModule = assignments.moduleByFile.get(edge.target_file);
    if (!fromModule || !toModule || fromModule === toModule) continue;
    const allowedTargets = allowed.get(fromModule);
    if (allowedTargets && (allowedTargets.has(toModule) || allowedTargets.has('*'))) continue;
    const key = `${fromModule} -> ${toModule}`;
    if (!grouped.has(key)) {
      grouped.set(key, { from_module: fromModule, to_module: toModule, edge_count: 0, example_edges: [] });
    }
    const entry = grouped.get(key);
    entry.edge_count += 1;
    if (entry.example_edges.length < 3) {
      entry.example_edges.push(`${edge.source_file} -> ${edge.target_file}`);
    }
  }
  return [...grouped.values()]
    .sort((a, b) => b.edge_count - a.edge_count)
    .map((entry) => ({
      kind: 'undeclared_dependency',
      severity: 'review',
      rule_id: deriveUndeclaredDependencyRuleId(entry),
      id: `undeclared_dependency:${entry.from_module}->${entry.to_module}`,
      from_module: entry.from_module,
      to_module: entry.to_module,
      edge_count: entry.edge_count,
      example_edges: entry.example_edges,
      summary: `${entry.from_module} -> ${entry.to_module} は宣言されていない依存 (${entry.edge_count} edges, import scan)`
    }));
}

// Independent dimension (CDL-S-6, reshaped by DCS-S-2/S-4): module-level circularity derived from
// the same import-scan edges used for dependency-violation detection (not graph.json "calls" edges
// -- see EDGE_SOURCE_NOTE). Circularity is reported regardless of whether its edges are individually
// "allowed" by allowed_dependencies: a declared but circular dependency pair is still a design smell
// the ledger must surface, distinct from (and orthogonal to) undeclared_dependency.
//
// The unit is the strongly connected component, not the simple cycle. Enumerating every simple cycle
// produced 69,490 violations on this repository for what is, canonically, a single tangle of 16
// modules (see docs/architecture/vibepro-dependency-cycle-scc-reduction.md): the simple-cycle set
// encodes the same fact exponentially redundantly, drowns any real regression, and makes the count
// useless as a ratchet signal. SCCs are the unique, order-independent decomposition of "which nodes
// participate in a cycle", so one SCC = one violation.
//
// An SCC alone says "there is a tangle" but not where to cut it, so mutually dependent module pairs
// (2-cycles) are emitted as their own `mutual_dependency` dimension. They are the smallest and most
// actionable cut candidates, and a separate kind is what lets the delta ledger count one pair being
// resolved (by_kind is keyed on `kind`).
function findDependencyCycles({ importEdges, assignments }) {
  const moduleEdgeStats = new Map();
  for (const edge of importEdges) {
    const fromModule = assignments.moduleByFile.get(edge.source_file);
    const toModule = assignments.moduleByFile.get(edge.target_file);
    if (!fromModule || !toModule || fromModule === toModule) continue;
    const key = `${fromModule}->${toModule}`;
    if (!moduleEdgeStats.has(key)) {
      moduleEdgeStats.set(key, {
        from: fromModule,
        to: toModule,
        import_edge_count: 0,
        example_edges: []
      });
    }
    const entry = moduleEdgeStats.get(key);
    entry.import_edge_count += 1;
    if (entry.example_edges.length < 3) {
      entry.example_edges.push(`${edge.source_file} -> ${edge.target_file}`);
    }
  }
  const moduleEdges = [...moduleEdgeStats.values()].map(({ from, to }) => ({ from, to }));
  const mutualPairs = findMutualDependencyPairs(moduleEdgeStats);

  const cycleFindings = detectModuleSccs(moduleEdges).map((members) => {
    const memberSet = new Set(members);
    const internalEdges = [...moduleEdgeStats.values()].filter(
      (entry) => memberSet.has(entry.from) && memberSet.has(entry.to)
    );
    const importEdgeCount = internalEdges.reduce((total, entry) => total + entry.import_edge_count, 0);
    const internalMutualPairs = mutualPairs.filter(
      (pair) => memberSet.has(pair.modules[0]) && memberSet.has(pair.modules[1])
    );
    return {
      kind: 'dependency_cycle',
      severity: 'review',
      rule_id: null,
      id: `dependency_cycle_scc:${members.join('+')}`,
      members,
      module_edge_count: internalEdges.length,
      import_edge_count: importEdgeCount,
      mutual_pairs: internalMutualPairs.map((pair) => pair.modules),
      feedback_edge_candidates: rankFeedbackEdgeCandidates(internalEdges),
      summary:
        `モジュール循環依存 (強連結成分, ${members.length} modules): ${members.join(', ')} ` +
        `— 内部 ${internalEdges.length} module edges / ${importEdgeCount} imports, ` +
        `相互依存ペア ${internalMutualPairs.length} 組`
    };
  });

  const mutualFindings = mutualPairs.map((pair) => {
    const [a, b] = pair.modules;
    const importEdgeCount = pair.directions.reduce((total, entry) => total + entry.import_edge_count, 0);
    return {
      kind: 'mutual_dependency',
      severity: 'review',
      rule_id: null,
      id: `mutual_dependency:${a}+${b}`,
      modules: pair.modules,
      import_edge_count: importEdgeCount,
      directions: pair.directions,
      summary:
        `モジュール相互依存: ${a} <-> ${b} ` +
        `(${pair.directions.map((entry) => `${entry.from}->${entry.to} ${entry.import_edge_count} imports`).join(', ')})`
    };
  });

  return { cycleFindings, mutualFindings };
}

// DCS-S-4: module pairs that import each other in both directions. Identity is the alphabetically
// sorted pair, so it does not depend on which direction was scanned first (CDL-S-1/S-2).
function findMutualDependencyPairs(moduleEdgeStats) {
  const pairs = [];
  for (const entry of moduleEdgeStats.values()) {
    if (!(entry.from < entry.to)) continue;
    const reverse = moduleEdgeStats.get(`${entry.to}->${entry.from}`);
    if (!reverse) continue;
    pairs.push({
      modules: [entry.from, entry.to],
      directions: [toEdgeDetail(entry), toEdgeDetail(reverse)]
    });
  }
  return pairs.sort((a, b) => a.modules.join('+').localeCompare(b.modules.join('+')));
}

// DCS-S-5: a *heuristic* cut-candidate list, not a minimum feedback arc set -- that problem is
// NP-hard and would trade the scanner's deterministic linear-time behaviour for an approximation
// whose output moves with the search. The proxy is edge weight: an intra-SCC module dependency
// carried by only one or two real imports is the cheapest place to break the tangle. Ties are
// broken by edge identity so the list is stable across re-scans.
function rankFeedbackEdgeCandidates(internalEdges) {
  return [...internalEdges]
    .sort((a, b) => {
      if (a.import_edge_count !== b.import_edge_count) return a.import_edge_count - b.import_edge_count;
      return `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`);
    })
    .slice(0, FEEDBACK_EDGE_CANDIDATE_LIMIT)
    .map(toEdgeDetail);
}

function toEdgeDetail(entry) {
  return {
    from: entry.from,
    to: entry.to,
    import_edge_count: entry.import_edge_count,
    example_edges: entry.example_edges
  };
}

// DCS-S-1: strongly connected components of a directed module graph via an *iterative* Tarjan
// (explicit work stack, no recursion). The graph measured today is 16 modules, where recursion would
// be fine, but this detector is the natural thing to point at a file-level graph next, and VibePro
// has already been bitten by depth-proportional recursion blowing the stack (PR #409). Runtime is
// O(V+E) and the output order (members sorted, components sorted by their joined key) is derived
// from the module names themselves, never from traversal order, so ids are stable (CDL-S-1/S-2).
//
// Only components that actually contain a cycle are returned: size > 1, or a single node with a
// self-loop. Single nodes without a self-loop are trivially strongly connected and are not cycles.
export function detectModuleSccs(moduleEdges) {
  const adjacency = new Map();
  const nodes = new Set();
  const selfLoops = new Set();
  for (const { from, to } of moduleEdges) {
    nodes.add(from);
    nodes.add(to);
    if (from === to) selfLoops.add(from);
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push(to);
  }
  for (const targets of adjacency.values()) targets.sort();

  const index = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  let nextIndex = 0;

  for (const root of [...nodes].sort()) {
    if (index.has(root)) continue;
    index.set(root, nextIndex);
    lowlink.set(root, nextIndex);
    nextIndex += 1;
    stack.push(root);
    onStack.add(root);
    const work = [{ node: root, edgeIndex: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const targets = adjacency.get(frame.node) ?? [];
      if (frame.edgeIndex < targets.length) {
        const next = targets[frame.edgeIndex];
        frame.edgeIndex += 1;
        if (!index.has(next)) {
          index.set(next, nextIndex);
          lowlink.set(next, nextIndex);
          nextIndex += 1;
          stack.push(next);
          onStack.add(next);
          work.push({ node: next, edgeIndex: 0 });
        } else if (onStack.has(next)) {
          lowlink.set(frame.node, Math.min(lowlink.get(frame.node), index.get(next)));
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        lowlink.set(parent, Math.min(lowlink.get(parent), lowlink.get(frame.node)));
      }
      if (lowlink.get(frame.node) === index.get(frame.node)) {
        const component = [];
        let popped;
        do {
          popped = stack.pop();
          onStack.delete(popped);
          component.push(popped);
        } while (popped !== frame.node);
        components.push(component.sort());
      }
    }
  }

  return components
    .filter((component) => component.length > 1 || selfLoops.has(component[0]))
    .sort((a, b) => a.join('+').localeCompare(b.join('+')));
}

const FEEDBACK_EDGE_CANDIDATE_LIMIT = 5;

// DEPRECATED (DCS-S-7): exhaustive simple-cycle enumeration. Kept exported with an unchanged
// signature because the merged Spec of story-vibepro-conformance-delta-ledger (clause S-003) binds
// this exact anchor and its CDL-S-6 test; removing it would break a past story's spec anchors. It is
// no longer part of the conformance pipeline -- `findDependencyCycles` uses `detectModuleSccs`.
// Do not reintroduce it as a measurement source: on this repository's 16-module dependency graph it
// enumerates 69,490 cycles (length histogram peaking at 11-12 hops) for a graph whose entire
// circular structure is one SCC. Cycle counts grow factorially with module count, so any threshold,
// cap, or truncation applied to the output is arbitrary and breaks delta id stability.
export function detectModuleCycles(moduleEdges) {
  const adjacency = new Map();
  for (const { from, to } of moduleEdges) {
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from).add(to);
  }
  const cycleByKey = new Map();
  for (const start of adjacency.keys()) {
    const stack = [];
    const onStack = new Set();
    const visit = (node) => {
      stack.push(node);
      onStack.add(node);
      for (const next of adjacency.get(node) ?? []) {
        const idx = stack.indexOf(next);
        if (idx !== -1) {
          const normalized = normalizeCycle(stack.slice(idx));
          cycleByKey.set(normalized.join('->'), normalized);
        } else if (!onStack.has(next)) {
          visit(next);
        }
      }
      stack.pop();
      onStack.delete(node);
    };
    visit(start);
  }
  return [...cycleByKey.values()].sort((a, b) => a.join('->').localeCompare(b.join('->')));
}

function normalizeCycle(cyclePath) {
  let minIndex = 0;
  for (let i = 1; i < cyclePath.length; i += 1) {
    if (cyclePath[i] < cyclePath[minIndex]) minIndex = i;
  }
  return [...cyclePath.slice(minIndex), ...cyclePath.slice(0, minIndex)];
}

function deriveUndeclaredDependencyRuleId(entry) {
  if (entry.from_module === 'workspace-infra') return 'R-001';
  if (entry.to_module === 'cli') return 'R-002';
  return 'R-004';
}

function findBudgetViolations({ scopeFiles, model, assignments }) {
  const findings = [];
  const defaultMax = model.budgets.default_max_file_lines;
  const baseline = model.budgets.file_line_baseline;
  for (const { file, line_count: lineCount } of scopeFiles) {
    const limit = baseline[file] ?? defaultMax;
    if (limit == null) continue;
    if (lineCount > limit) {
      findings.push({
        kind: 'budget_violation',
        severity: 'review',
        rule_id: 'R-003',
        id: `budget_violation:file:${file}`,
        file,
        line_count: lineCount,
        limit,
        baseline: baseline[file] != null,
        summary: baseline[file] != null
          ? `${file} は baseline (${limit}行) を超過して成長した (${lineCount}行)`
          : `${file} は行数予算 (${limit}行) を超過 (${lineCount}行)`
      });
    }
  }
  for (const module of model.modules) {
    if (module.max_files == null) continue;
    const count = assignments.filesByModule.get(module.name)?.length ?? 0;
    if (count > module.max_files) {
      findings.push({
        kind: 'budget_violation',
        severity: 'review',
        rule_id: 'R-003',
        id: `budget_violation:module:${module.name}`,
        module: module.name,
        file_count: count,
        limit: module.max_files,
        summary: `モジュール ${module.name} のファイル数 (${count}) が上限 (${module.max_files}) を超過`
      });
    }
  }
  return findings;
}

export function renderConformanceMarkdown(result) {
  const lines = [
    '# Architecture Conformance (dry-run)',
    '',
    `- model: ${result.model.path} (status=${result.model.status}, version=${result.model.version ?? 'unversioned'}, modules=${result.model.module_count})`,
    `- edge_source: ${result.edge_source} (${result.import_scan.scanned_file_count} files scanned, ${result.import_scan.edge_count} internal import edges, ${result.import_scan.unresolved_reference_count} unresolved references)`,
    `- graph_context: ${result.graph_context.available ? `${result.graph_context.path} (nodes=${result.graph_context.node_count}, calls_edges=${result.graph_context.calls_edge_count}, context only)` : `unavailable (${result.graph_context.reason})`}`,
    `- violations: ${result.summary.violation_count} (undeclared_dependency=${result.summary.undeclared_dependency_count}, budget=${result.summary.budget_violation_count}, orphan=${result.summary.orphan_file_count}, stale_pattern=${result.summary.stale_pattern_count}, dependency_cycle=${result.summary.dependency_cycle_count}, mutual_dependency=${result.summary.mutual_dependency_count})`
  ];
  if (result.edge_source_note) {
    lines.push('', `> ${result.edge_source_note}`);
  }
  if (result.advisory_notice) {
    lines.push('', `> ${result.advisory_notice}`);
  }
  const byKind = [
    ['undeclared_dependency', '## 宣言外のモジュール間依存'],
    ['budget_violation', '## 複雑性予算超過'],
    ['orphan_file', '## 孤児ファイル'],
    ['stale_pattern', '## 一致ファイルのないパターン'],
    ['dependency_cycle', '## モジュール循環依存 (強連結成分)'],
    ['mutual_dependency', '## モジュール相互依存 (循環の最小切断候補)']
  ];
  for (const [kind, heading] of byKind) {
    const items = result.violations.filter((violation) => violation.kind === kind);
    if (items.length === 0) continue;
    lines.push('', heading, '');
    for (const item of items) {
      lines.push(`- ${item.summary}`);
      for (const example of item.example_edges ?? []) {
        lines.push(`  - ${example}`);
      }
      for (const direction of item.directions ?? []) {
        lines.push(
          `  - ${direction.from} -> ${direction.to} (${direction.import_edge_count} imports): ${direction.example_edges.join(', ')}`
        );
      }
      for (const candidate of item.feedback_edge_candidates ?? []) {
        lines.push(
          `  - 切断候補 (重み最小・厳密解ではない): ${candidate.from} -> ${candidate.to} (${candidate.import_edge_count} imports): ${candidate.example_edges.join(', ')}`
        );
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function toRepoRelative(root, absPath) {
  return normalizePath(path.relative(root, absPath));
}
