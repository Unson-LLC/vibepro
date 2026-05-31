import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  extractGraphNodeSourceFile,
  getEdgeEndpoint,
  normalizeGraphEdges,
  normalizeGraphPath
} from './graph-context.js';
import { getWorkspaceDir } from './workspace.js';

// Regression-risk scanner (minimal: blast-radius core).
//
// Signal: module-level fan-in derived from the Graphify call graph. A module
// called by many distinct other modules has a large blast radius — changing it
// risks regressions in every caller. This is IMPACT risk, not defect
// probability: a static call graph cannot tell you a change is buggy, only how
// far its effects can reach. We name it accordingly and never claim prediction.
//
// Test reachability was deliberately NOT used as a signal here. Dogfooding
// VibePro itself showed that codebases driving code through a CLI entry point or
// subprocess spawn make static call-graph reachability mislabel covered modules
// as untested. Coverage-aware scoring is left to a later iteration backed by
// real coverage data (c8/lcov), not graph inference.

const DEFAULT_HIGH_FAN_IN = 10;
const DEFAULT_MODERATE_FAN_IN = 5;
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

  return analyzeRegressionRisk(graph, options);
}

// Pure analysis over a loaded graph. Exported for unit testing without disk I/O.
export function analyzeRegressionRisk(graph, options = {}) {
  const includePrefixes = options.includePrefixes ?? ['src/'];
  const highFanIn = options.highFanIn ?? DEFAULT_HIGH_FAN_IN;
  const moderateFanIn = options.moderateFanIn ?? DEFAULT_MODERATE_FAN_IN;
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
      return {
        file,
        fan_in: fanIn,
        fan_out: callees.get(file)?.size ?? 0,
        risk_tier: fanIn >= highFanIn ? 'high' : fanIn >= moderateFanIn ? 'moderate' : 'low'
      };
    })
    .sort((a, b) => b.fan_in - a.fan_in || a.file.localeCompare(b.file));

  const high = hotspots.filter((h) => h.risk_tier === 'high').length;
  const moderate = hotspots.filter((h) => h.risk_tier === 'moderate').length;

  return {
    status: high > 0 ? 'needs_review' : 'pass',
    hotspots: hotspots.slice(0, top),
    summary: {
      scored_modules: hotspots.length,
      high,
      moderate,
      thresholds: { high_fan_in: highFanIn, moderate_fan_in: moderateFanIn }
    }
  };
}
