import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyChangeRisk } from '../src/change-risk-classifier.js';

const fileGroups = (sourceFiles) => ({ source: { files: sourceFiles } });
const hotspot = (file, tier, priority, coveragePct) => ({
  file,
  fan_in: tier === 'high' ? 18 : 6,
  coverage_pct: coveragePct,
  risk_tier: tier,
  priority
});

test('a changed critical hotspot forces the workflow_heavy gate profile', () => {
  const result = classifyChangeRisk({
    fileGroups: fileGroups(['src/workspace.js']),
    regressionRisk: { hotspots: [hotspot('src/workspace.js', 'high', 'critical', 22)] }
  });
  assert.equal(result.profile, 'workflow_heavy');
  assert.equal(result.required_gate_profile, 'workflow_heavy');
  assert.equal(result.regression_escalated, true);
  assert.ok(result.risk_surfaces.includes('regression_blast_radius'));
  assert.ok(result.reasons.some((r) => /critical regression hotspot/.test(r)));
  assert.equal(result.regression_hotspots[0].file, 'src/workspace.js');
});

test('a changed high blast-radius module adds a surface but does not force workflow_heavy', () => {
  const result = classifyChangeRisk({
    fileGroups: fileGroups(['src/workspace.js']),
    regressionRisk: { hotspots: [hotspot('src/workspace.js', 'high', 'high', 95)] }
  });
  assert.ok(result.risk_surfaces.includes('regression_blast_radius'));
  assert.equal(result.regression_escalated, false);
  assert.notEqual(result.profile, 'workflow_heavy'); // well-covered hub is not a critical trap
  assert.ok(result.reasons.some((r) => /high blast-radius module changed/.test(r)));
});

test('a hotspot not present in the diff does not escalate', () => {
  const result = classifyChangeRisk({
    fileGroups: fileGroups(['src/language.js']),
    regressionRisk: { hotspots: [hotspot('src/workspace.js', 'high', 'critical', 10)] }
  });
  assert.ok(!result.risk_surfaces.includes('regression_blast_radius'));
  assert.equal(result.regression_escalated, false);
  assert.deepEqual(result.regression_hotspots, []);
});

test('without regression data, classification is unchanged (backward compatible)', () => {
  const result = classifyChangeRisk({ fileGroups: fileGroups(['src/language.js']) });
  assert.equal(result.profile, 'light');
  assert.equal(result.regression_escalated, false);
  assert.deepEqual(result.regression_hotspots, []);
  assert.ok(!result.risk_surfaces.includes('regression_blast_radius'));
});
