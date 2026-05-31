import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeGraphPath } from './graph-context.js';

// Coverage ingestion for regression-risk scoring.
//
// Reads a coverage report produced by the project's own tooling (c8 / istanbul /
// nyc) and returns a Map of repo-relative file path -> line-coverage fraction
// (0..1). We never run coverage ourselves: coverage commands vary per project
// and belong to the project's test setup, not to a static scanner. If no report
// is present we return null so callers degrade to fan-in-only scoring.

// Standard locations, most specific (already has percentages) first.
const COVERAGE_CANDIDATES = [
  'coverage/coverage-summary.json',
  'coverage/coverage-final.json',
  'coverage/lcov.info'
];

export async function loadCoverage(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const candidates = options.file ? [options.file] : COVERAGE_CANDIDATES;

  for (const candidate of candidates) {
    const absolute = path.resolve(root, candidate);
    let raw;
    try {
      raw = await readFile(absolute, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const parsed = candidate.endsWith('.info') ? parseLcov(raw) : parseIstanbulJson(raw);
    if (parsed && parsed.size > 0) {
      return { coverage: normalizeCoveragePaths(parsed, root), source: candidate };
    }
  }
  return null;
}

// lcov.info -> Map<rawPath, fraction>. Uses line counts (LF/LH).
export function parseLcov(text) {
  const coverage = new Map();
  let file = null;
  let found = 0;
  let hit = 0;
  for (const line of String(text).split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      file = line.slice(3).trim();
      found = 0;
      hit = 0;
    } else if (line.startsWith('LF:')) {
      found = Number(line.slice(3).trim()) || 0;
    } else if (line.startsWith('LH:')) {
      hit = Number(line.slice(3).trim()) || 0;
    } else if (line.startsWith('end_of_record') && file) {
      coverage.set(file, found > 0 ? hit / found : 1);
      file = null;
    }
  }
  return coverage;
}

// istanbul coverage-summary.json or coverage-final.json -> Map<rawPath, fraction>.
export function parseIstanbulJson(text) {
  const data = JSON.parse(text);
  const coverage = new Map();
  for (const [key, value] of Object.entries(data)) {
    if (key === 'total' || !value || typeof value !== 'object') continue;
    // coverage-summary.json shape: { lines: { total, covered, pct } }
    if (value.lines && typeof value.lines === 'object') {
      const { total, covered, pct } = value.lines;
      if (typeof covered === 'number' && typeof total === 'number') {
        coverage.set(key, total > 0 ? covered / total : 1);
      } else if (typeof pct === 'number') {
        coverage.set(key, pct / 100);
      }
      continue;
    }
    // coverage-final.json shape: { statementMap, s: { id: hitCount } }
    if (value.s && typeof value.s === 'object') {
      const counts = Object.values(value.s);
      const total = counts.length;
      const covered = counts.filter((count) => count > 0).length;
      coverage.set(key, total > 0 ? covered / total : 1);
    }
  }
  return coverage;
}

function normalizeCoveragePaths(rawCoverage, root) {
  const normalized = new Map();
  for (const [rawPath, fraction] of rawCoverage) {
    const relative = path.isAbsolute(rawPath) ? path.relative(root, rawPath) : rawPath;
    normalized.set(normalizeGraphPath(relative), fraction);
  }
  return normalized;
}
