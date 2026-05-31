import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { analyzeRegressionRisk, scanRegressionRisk } from '../src/regression-risk-scanner.js';

// Minimal call graph: hub.js is called by three distinct modules, leaf.js by one.
function fixtureGraph() {
  const node = (id, file) => ({ id, source_file: file });
  const call = (s, t) => ({ relation: 'calls', source: s, target: t });
  return {
    nodes: [
      node('hub_fn', 'src/hub.js'),
      node('leaf_fn', 'src/leaf.js'),
      node('a_fn', 'src/a.js'),
      node('b_fn', 'src/b.js'),
      node('c_fn', 'src/c.js'),
      node('vendor_fn', 'node_modules/dep/index.js')
    ],
    links: [
      call('a_fn', 'hub_fn'),
      call('b_fn', 'hub_fn'),
      call('c_fn', 'hub_fn'),
      call('a_fn', 'leaf_fn'),
      call('a_fn', 'a_fn'), // self-call must be ignored (same module)
      call('vendor_fn', 'hub_fn') // out-of-scope caller still counts toward fan-in
    ]
  };
}

test('analyzeRegressionRisk ranks modules by distinct caller fan-in', () => {
  const result = analyzeRegressionRisk(fixtureGraph(), { highFanIn: 3, moderateFanIn: 2 });
  assert.equal(result.hotspots[0].file, 'src/hub.js');
  assert.equal(result.hotspots[0].fan_in, 4); // a, b, c, vendor — distinct callers
  assert.equal(result.hotspots[0].risk_tier, 'high');
  assert.equal(result.status, 'needs_review');
  const leaf = result.hotspots.find((h) => h.file === 'src/leaf.js');
  assert.equal(leaf.fan_in, 1);
  assert.equal(leaf.risk_tier, 'low');
});

test('analyzeRegressionRisk passes when no module crosses the high threshold', () => {
  const result = analyzeRegressionRisk(fixtureGraph(), { highFanIn: 99, moderateFanIn: 99 });
  assert.equal(result.status, 'pass');
  assert.equal(result.summary.high, 0);
});

test('analyzeRegressionRisk ignores structural (non-call) edges', () => {
  const graph = {
    nodes: [{ id: 'x', source_file: 'src/x.js' }, { id: 'y', source_file: 'src/y.js' }],
    links: [{ relation: 'contains', source: 'y', target: 'x' }]
  };
  const result = analyzeRegressionRisk(graph);
  assert.equal(result.summary.scored_modules, 0);
});

test('scanRegressionRisk gracefully skips when graphify graph is absent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-regrisk-'));
  const result = await scanRegressionRisk(root);
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /Graphify/);
  assert.deepEqual(result.hotspots, []);
});

test('coverage escalates a high-blast-radius low-coverage module to critical', () => {
  const coverage = new Map([['src/hub.js', 0.2]]); // 20% on the fan-in-4 hub
  const result = analyzeRegressionRisk(fixtureGraph(), {
    highFanIn: 3,
    moderateFanIn: 2,
    coverage,
    lowCoverage: 0.5
  });
  const hub = result.hotspots.find((h) => h.file === 'src/hub.js');
  assert.equal(hub.coverage_pct, 20);
  assert.equal(hub.priority, 'critical');
  assert.equal(result.summary.critical, 1);
  assert.equal(result.status, 'needs_review');
  assert.equal(result.hotspots[0].file, 'src/hub.js'); // critical sorts first
});

test('a well-covered hub is not critical and does not trigger review', () => {
  const coverage = new Map([['src/hub.js', 0.95]]);
  const result = analyzeRegressionRisk(fixtureGraph(), {
    highFanIn: 3,
    moderateFanIn: 2,
    coverage,
    lowCoverage: 0.5
  });
  const hub = result.hotspots.find((h) => h.file === 'src/hub.js');
  assert.equal(hub.coverage_pct, 95);
  assert.equal(hub.priority, 'high'); // still high blast radius, but not critical
  assert.equal(result.summary.critical, 0);
  assert.equal(result.status, 'pass'); // coverage present + no critical => pass
});

test('without coverage data, behavior is unchanged (high fan-in triggers review)', () => {
  const result = analyzeRegressionRisk(fixtureGraph(), { highFanIn: 3, moderateFanIn: 2 });
  const hub = result.hotspots.find((h) => h.file === 'src/hub.js');
  assert.equal(hub.coverage_pct, null);
  assert.equal(hub.priority, 'high');
  assert.equal(result.summary.coverage_source, null);
  assert.equal(result.status, 'needs_review');
});
