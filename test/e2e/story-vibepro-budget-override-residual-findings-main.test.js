import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveEfficiencyPolicyDecision } from '../../src/delivery-efficiency-guardrail.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// story-vibepro-budget-override-residual-findings scenario clauses.
// The CHANGELOG paragraph now documents that an ungranted override reverts to
// the base policy regardless of direction. This spec replays that exact
// scenario against the real resolver: a Story override that TIGHTENS a limit,
// with no grant, must yield the looser base — the behavior the old
// "never fails open" wording contradicted.

test('S: an ungranted tightening override reverts to the looser base, as the reworded CHANGELOG states', () => {
  const config = {
    budgets: {
      delivery_efficiency: { max_commits: 40 },
      delivery_efficiency_by_story: {
        'story-x': { amendment_reason: 'tighten for a risky story', max_commits: 5 }
      }
    }
  };
  const decision = resolveEfficiencyPolicyDecision(config, 'story-x', { decisions: [] });
  assert.equal(decision.override.applied, false);
  assert.equal(decision.policy.max_commits, 40, 'fallback is the base as written, not the tighter of the two');

  const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /regardless of direction/);
  assert.match(changelog, /reverts to the looser base/);
  assert.doesNotMatch(changelog, /It never fails open/);
});

test('S: the design root registers the guardrail surface so reconciliation sees this file family', () => {
  const ssot = JSON.parse(readFileSync(path.join(root, 'design-ssot.json'), 'utf8'));
  const ownerRoot = ssot.design_roots.find((r) => r.id === 'vibepro-owner-gated-budget-override');
  assert.ok(ownerRoot, 'design root present');
  assert.ok(ownerRoot.owned_surfaces.length >= 6, 'governed surfaces registered');
  assert.ok(ownerRoot.owned_surfaces.join(' ').includes('src/delivery-efficiency-guardrail.js'));
});
