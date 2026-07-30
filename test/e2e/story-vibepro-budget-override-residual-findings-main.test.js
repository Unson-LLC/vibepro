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

test('story-vibepro-budget-override-residual-findings acceptance coverage', () => {
  const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const guardrail = readFileSync(path.join(root, 'src/delivery-efficiency-guardrail.js'), 'utf8');
  const ssot = JSON.parse(readFileSync(path.join(root, 'design-ssot.json'), 'utf8'));
  // story-vibepro-budget-override-residual-findings ac:1 CHANGELOG states the fallback is to base regardless of direction and warns tightening consumers
  assert.match(changelog, /regardless of direction/);
  assert.match(changelog, /reverts to the looser base/);
  assert.doesNotMatch(changelog, /It never fails open/);
  // story-vibepro-budget-override-residual-findings ac:2 source comment no longer claims the fallback is the tighter budget
  assert.match(guardrail, /no direction is enforced/);
  assert.doesNotMatch(guardrail, /which is the tighter budget/);
  // story-vibepro-budget-override-residual-findings ac:3 design root declares its six governed src surfaces and gains a required architecture child link that reconciliation actually consumes
  const ownerRoot = ssot.design_roots.find((r) => r.id === 'vibepro-owner-gated-budget-override');
  assert.equal(ownerRoot.owned_surfaces.length, 6);
  assert.ok(ownerRoot.required_child_kinds.includes('architecture'));
  assert.ok(ownerRoot.child_links.filter((c) => c.kind === 'architecture' && c.required).length >= 1);
  // story-vibepro-budget-override-residual-findings ac:4 runtime behavior unchanged: unauthorized override still falls back to base with applied=false
  const decision = resolveEfficiencyPolicyDecision({
    budgets: {
      delivery_efficiency: { max_commits: 40 },
      delivery_efficiency_by_story: { 'story-y': { amendment_reason: 'raise', max_commits: 90 } }
    }
  }, 'story-y', { decisions: [] });
  assert.equal(decision.override.applied, false);
  assert.equal(decision.policy.max_commits, 40);
});

test('S: the design root registers the guardrail surface so reconciliation sees this file family', () => {
  const ssot = JSON.parse(readFileSync(path.join(root, 'design-ssot.json'), 'utf8'));
  const ownerRoot = ssot.design_roots.find((r) => r.id === 'vibepro-owner-gated-budget-override');
  assert.ok(ownerRoot, 'design root present');
  assert.ok(ownerRoot.owned_surfaces.length >= 6, 'governed surfaces registered');
  assert.ok(ownerRoot.owned_surfaces.join(' ').includes('src/delivery-efficiency-guardrail.js'));
});
