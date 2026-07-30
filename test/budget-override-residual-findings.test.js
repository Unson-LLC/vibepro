import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

// story-vibepro-budget-override-residual-findings: the two residual
// architecture_boundary findings from story-vibepro-owner-gated-budget-override.

test('C-001: CHANGELOG describes the ungranted-override fallback without a direction guarantee', () => {
  const changelog = read('CHANGELOG.md');
  assert.match(changelog, /falls back\s+to the base budget — regardless of direction/);
  assert.match(changelog, /reverts to the looser base/);
  assert.doesNotMatch(changelog, /It never fails open/);
  assert.doesNotMatch(changelog, /the tighter one/);
});

test('C-002: the resolveEfficiencyPolicyDecision comment does not claim the fallback is the tighter budget', () => {
  const src = read('src/delivery-efficiency-guardrail.js');
  assert.match(src, /no direction is enforced, so a tightening\n\/\/ override also reverts to the base/);
  assert.doesNotMatch(src, /which is the tighter budget/);
});

test('C-003: the owner-gated-budget-override design root owns its six governed src surfaces', () => {
  const ssot = JSON.parse(read('design-ssot.json'));
  const roots = ssot.design_roots.filter((r) => r.id === 'vibepro-owner-gated-budget-override');
  assert.equal(roots.length, 1);
  const joined = roots[0].owned_surfaces.join(' ');
  for (const f of [
    'src/budget-override-authority.js',
    'src/delivery-efficiency-guardrail.js',
    'src/decision-records.js',
    'src/agent-review.js',
    'src/pr-manager.js',
    'src/cli.js'
  ]) {
    assert.ok(joined.includes(f), `owned_surfaces missing ${f}`);
  }
});
