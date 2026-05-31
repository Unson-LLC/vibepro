import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  extractGraphNodeSourceFile,
  getEdgeEndpoint,
  normalizeGraphEdges,
  normalizeGraphPath
} from './graph-context.js';
import { loadCoverage } from './coverage-report.js';
import { getWorkspaceDir } from './workspace.js';

// Regression-risk scanner: blast-radius core, optionally sharpened by coverage.
//
// Primary signal: module-level fan-in derived from the Graphify call graph. A
// module called by many distinct other modules has a large blast radius —
// changing it risks regressions in every caller. This is IMPACT risk, not defect
// probability: a static call graph cannot tell you a change is buggy, only how
// far its effects can reach. We name it accordingly and never claim prediction.
//
// Secondary signal (optional): real line coverage from the project's own tooling
// (c8/istanbul/lcov). When present, a high-blast-radius module with low coverage
// is escalated to `critical` — large reach AND a thin safety net is the genuine
// regression trap. Coverage is deliberately NOT inferred from the call graph:
// dogfooding VibePro showed static call-graph test-reachability mislabels
// CLI/subprocess-driven coverage as untested. When no coverage report exists we
// degrade cleanly to fan-in-only scoring with identical behavior to before.

const DEFAULT_HIGH_FAN_IN = 10;
const DEFAULT_MODERATE_FAN_IN = 5;
const DEFAULT_LOW_COVERAGE = 0.5;
const DEFAULT_TOP = 20;
const CALL_RELATIONS = new Set(['calls', 'call', 'invokes', 'uses']);

export async function scanRegressionRisk(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const graphPath = path.join(getWorkspaceDir(root), 'graphify', 'graph.json');

  let graph;
  try {
    graph = JSON.parse(await readFile(graphPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        status: 'skipped',
        reason:
          'Regression-risk scanning needs a Graphify call graph at .vibepro/graphify/graph.json. ' +
          'Graphify is optional: run a story diagnosis or import with --run-graphify / --from <graphify-out> first.',
        hotspots: [],
        summary: { scored_modules: 0, high: 0, moderate: 0 }
      };
    }
    throw error;
  }

  const loaded = await loadCoverage(root, { file: options.coverageFile });
  return analyzeRegressionRisk(graph, {
    ...options,
    coverage: loaded?.coverage ?? null,
    coverageSource: loaded?.source ?? null
  });
}

// Pure analysis over a loaded graph. Exported for unit testing without disk I/O.
export function analyzeRegressionRisk(graph, options = {}) {
  const includePrefixes = options.includePrefixes ?? ['src/'];
  const highFanIn = options.highFanIn ?? DEFAULT_HIGH_FAN_IN;
  const moderateFanIn = options.moderateFanIn ?? DEFAULT_MODERATE_FAN_IN;
  const lowCoverage = options.lowCoverage ?? DEFAULT_LOW_COVERAGE;
  const coverage = options.coverage ?? null;
  const hasCoverage = coverage instanceof Map && coverage.size > 0;
  const top = options.top ?? DEFAULT_TOP;

  const fileById = new Map();
  for (const node of graph?.nodes ?? []) {
    if (!node || typeof node.id !== 'string') continue;
    const sourceFile = extractGraphNodeSourceFile(node);
    if (sourceFile) fileById.set(node.id, normalizeGraphPath(sourceFile));
  }

  const { edges } = normalizeGraphEdges(graph);
  const callers = new Map(); // module -> Set of caller modules (fan-in)
  const callees = new Map(); // module -> Set of callee modules (fan-out)
  const inScope = (file) => Boolean(file) && includePrefixes.some((prefix) => file.startsWith(prefix));
  const add = (map, key, value) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
  };

  for (const edge of edges) {
    if (edge?.relation && !CALL_RELATIONS.has(edge.relation)) continue;
    const sourceFile = fileById.get(getEdgeEndpoint(edge, 'source'));
    const targetFile = fileById.get(getEdgeEndpoint(edge, 'target'));
    if (!sourceFile || !targetFile || sourceFile === targetFile) continue; // cross-module only
    if (inScope(targetFile)) add(callers, targetFile, sourceFile);
    if (inScope(sourceFile)) add(callees, sourceFile, targetFile);
  }

  const hotspots = [...callers.entries()]
    .map(([file, callerSet]) => {
      const fanIn = callerSet.size;
      const riskTier = fanIn >= highFanIn ? 'high' : fanIn >= moderateFanIn ? 'moderate' : 'low';
      const coveragePct = hasCoverage && coverage.has(file)
        ? Number((coverage.get(file) * 100).toFixed(1))
        : null;
      // critical = large blast radius AND a thin (known) safety net.
      const priority = riskTier === 'high' && coveragePct !== null && coveragePct < lowCoverage * 100
        ? 'critical'
        : riskTier;
      return {
        file,
        fan_in: fanIn,
        fan_out: callees.get(file)?.size ?? 0,
        risk_tier: riskTier,
        coverage_pct: coveragePct,
        priority
      };
    })
    .sort((a, b) => priorityRank(b) - priorityRank(a) || b.fan_in - a.fan_in || a.file.localeCompare(b.file));

  const high = hotspots.filter((h) => h.risk_tier === 'high').length;
  const moderate = hotspots.filter((h) => h.risk_tier === 'moderate').length;
  const critical = hotspots.filter((h) => h.priority === 'critical').length;

  // With coverage data, a well-tested hub is no longer a review trigger; only
  // high-blast-radius + low-coverage (critical) escalates. Without coverage,
  // behavior is unchanged: any high-blast-radius module triggers review.
  const status = hasCoverage ? (critical > 0 ? 'needs_review' : 'pass') : (high > 0 ? 'needs_review' : 'pass');

  return {
    status,
    hotspots: hotspots.slice(0, top),
    summary: {
      scored_modules: hotspots.length,
      high,
      moderate,
      critical,
      coverage_source: options.coverageSource ?? (hasCoverage ? 'provided' : null),
      thresholds: { high_fan_in: highFanIn, moderate_fan_in: moderateFanIn, low_coverage_pct: lowCoverage * 100 }
    }
  };
}

function priorityRank(hotspot) {
  return { critical: 3, high: 2, moderate: 1, low: 0 }[hotspot.priority] ?? 0;
}
