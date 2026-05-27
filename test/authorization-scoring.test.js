import assert from 'node:assert/strict';
import test from 'node:test';

import { scoreAuthorization } from '../src/authorization-scoring.js';

function riskProfile(profile, riskSurfaces = []) {
  return {
    schema_version: '0.1.0',
    profile,
    change_type: `${profile}_change`,
    risk_surfaces: riskSurfaces
  };
}

test('empty inputs resolve to unknown without throwing', () => {
  const result = scoreAuthorization();
  assert.equal(result.authorization_level, 'unknown');
  assert.equal(result.review_outcome_recommendation, 'allow');
  assert.equal(result.matrix_cell.risk_profile, 'light');
  assert.equal(result.matrix_cell.authorization_level, 'unknown');
  assert.equal(result.matrix_cell.known_profile, true);
  assert.equal(result.schema_version, '0.1.0');
  assert.deepEqual(result.signals, []);
});

test('light profile always allows regardless of authorization level', () => {
  for (const level of ['high', 'medium', 'low', 'unknown']) {
    const result = scoreAuthorization({
      riskProfile: riskProfile('light', []),
      storySource: level === 'unknown' ? null : { title: 'auth', acceptance_criteria: ['handles auth boundary'] },
      decisions: level === 'high'
        ? [{ status: 'accepted', source: 'gate:agent_review', decision_id: 'dec-1' }]
        : []
    });
    assert.equal(result.review_outcome_recommendation, 'allow', `light + ${level} should allow`);
  }
});

test('accepted decision with valid source qualifies as high', () => {
  const result = scoreAuthorization({
    riskProfile: riskProfile('workflow_heavy', ['core_workflow_state']),
    storySource: { title: 'refactor', acceptance_criteria: [] },
    decisions: [
      { status: 'accepted', source: 'gate:agent_review', decision_id: 'dec-42' }
    ]
  });
  assert.equal(result.authorization_level, 'high');
  assert.equal(result.review_outcome_recommendation, 'allow');
  const accepted = result.signals.find((s) => s.kind === 'decision_record_accepted');
  assert.ok(accepted, 'expected decision_record_accepted signal');
  assert.equal(accepted.source, 'gate:agent_review');
});

test('accepted decision without source is marked invalid and does not reach high', () => {
  const result = scoreAuthorization({
    riskProfile: riskProfile('api_contract', ['server_api']),
    storySource: null,
    decisions: [
      { status: 'accepted', source: '', decision_id: 'dec-7' }
    ]
  });
  assert.notEqual(result.authorization_level, 'high');
  const invalid = result.signals.find((s) => s.kind === 'decision_record_invalid_source');
  assert.ok(invalid, 'expected invalid source signal');
});

test('accepted decision with unparseable source is rejected', () => {
  const result = scoreAuthorization({
    riskProfile: riskProfile('api_contract', ['server_api']),
    storySource: null,
    decisions: [
      { status: 'accepted', source: 'just-text-no-ref', decision_id: 'dec-9' }
    ]
  });
  assert.notEqual(result.authorization_level, 'high');
  const invalid = result.signals.find((s) => s.kind === 'decision_record_invalid_source');
  assert.ok(invalid);
});

test('story acceptance criteria mentioning a surface yields medium', () => {
  const result = scoreAuthorization({
    riskProfile: riskProfile('api_contract', ['server_api']),
    storySource: {
      title: 'add new endpoint',
      acceptance_criteria: ['The new server_api route returns 201 with the created entity.']
    },
    decisions: []
  });
  assert.equal(result.authorization_level, 'medium');
  assert.ok(result.signals.some((s) => s.kind === 'acceptance_criteria_mentions_surface' && s.surface === 'server_api'));
});

test('story background that mentions the surface (via alias) yields medium when AC do not', () => {
  const result = scoreAuthorization({
    riskProfile: riskProfile('ui_interaction', ['frontend_interaction']),
    storySource: {
      title: 'tweak',
      background: 'We need to update the frontend interaction model on the dashboard.',
      acceptance_criteria: ['Dashboard loads in under 2s.']
    },
    decisions: []
  });
  assert.equal(result.authorization_level, 'medium');
  assert.ok(result.signals.some((s) => s.kind === 'story_background_mentions_surface' && s.surface === 'frontend_interaction'));
});

test('story present but does not mention surface yields low when risk surfaces exist', () => {
  const result = scoreAuthorization({
    riskProfile: riskProfile('workflow_heavy', ['core_workflow_state']),
    storySource: {
      title: 'rename a button label',
      acceptance_criteria: ['Button label reads "Submit".']
    },
    decisions: []
  });
  assert.equal(result.authorization_level, 'low');
});

test('vague AC cannot reach high (INV-RAS-1)', () => {
  const result = scoreAuthorization({
    riskProfile: riskProfile('workflow_heavy', ['core_workflow_state']),
    storySource: {
      title: 'improvements',
      acceptance_criteria: ['Make things better.', 'Reduce friction.']
    },
    decisions: []
  });
  assert.notEqual(result.authorization_level, 'high');
  assert.notEqual(result.authorization_level, 'medium');
});

test('workflow_heavy + low MUST NOT be allow (INV-RAS-3)', () => {
  const result = scoreAuthorization({
    riskProfile: riskProfile('workflow_heavy', ['core_workflow_state']),
    storySource: { title: 'unrelated text', acceptance_criteria: ['unrelated AC'] },
    decisions: []
  });
  assert.equal(result.authorization_level, 'low');
  assert.notEqual(result.review_outcome_recommendation, 'allow');
  assert.equal(result.review_outcome_recommendation, 'block');
});

test('workflow_heavy + unknown MUST NOT be allow (INV-RAS-3)', () => {
  const result = scoreAuthorization({
    riskProfile: riskProfile('workflow_heavy', ['core_workflow_state']),
    storySource: null,
    decisions: []
  });
  assert.equal(result.authorization_level, 'unknown');
  assert.equal(result.review_outcome_recommendation, 'block');
});

test('unknown risk profile falls through to require_human_review', () => {
  const result = scoreAuthorization({
    riskProfile: { profile: 'unrecognized', risk_surfaces: ['something'] },
    storySource: null,
    decisions: []
  });
  assert.equal(result.review_outcome_recommendation, 'require_human_review');
  assert.equal(result.matrix_cell.known_profile, false);
});

test('all 16 matrix cells produce the expected recommendation', () => {
  const expected = {
    light: { high: 'allow', medium: 'allow', low: 'allow', unknown: 'allow' },
    ui_interaction: { high: 'allow', medium: 'allow', low: 'require_human_review', unknown: 'require_human_review' },
    api_contract: { high: 'allow', medium: 'require_human_review', low: 'require_human_review', unknown: 'block' },
    workflow_heavy: { high: 'allow', medium: 'require_human_review', low: 'block', unknown: 'block' }
  };

  const buildInputs = (profile, level) => {
    const surfaces = profile === 'ui_interaction'
      ? ['frontend_interaction']
      : profile === 'api_contract'
        ? ['server_api']
        : profile === 'workflow_heavy'
          ? ['core_workflow_state']
          : ['frontend_interaction'];
    if (level === 'high') {
      return {
        riskProfile: riskProfile(profile, surfaces),
        storySource: { title: 't' },
        decisions: [{ status: 'accepted', source: 'gate:agent_review', decision_id: 'd' }]
      };
    }
    if (level === 'medium') {
      const surfaceWord = surfaces[0];
      return {
        riskProfile: riskProfile(profile, surfaces),
        storySource: { title: 't', acceptance_criteria: [`Covers ${surfaceWord} change.`] },
        decisions: []
      };
    }
    if (level === 'low') {
      return {
        riskProfile: riskProfile(profile, surfaces),
        storySource: { title: 'unrelated', acceptance_criteria: ['something else'] },
        decisions: []
      };
    }
    return {
      riskProfile: riskProfile(profile, surfaces),
      storySource: null,
      decisions: []
    };
  };

  let asserted = 0;
  for (const [profile, byLevel] of Object.entries(expected)) {
    for (const [level, outcome] of Object.entries(byLevel)) {
      const inputs = buildInputs(profile, level);
      const result = scoreAuthorization(inputs);
      assert.equal(
        result.authorization_level,
        level,
        `matrix[${profile}][${level}] level mismatch: got ${result.authorization_level}`
      );
      assert.equal(
        result.review_outcome_recommendation,
        outcome,
        `matrix[${profile}][${level}] expected ${outcome}, got ${result.review_outcome_recommendation} (level=${result.authorization_level})`
      );
      assert.equal(result.matrix_cell.authorization_level, level);
      assert.equal(result.matrix_cell.risk_profile, profile);
      assert.equal(result.schema_version, '0.1.0');
      asserted += 1;
    }
  }
  assert.equal(asserted, 16, 'all 16 matrix cells must be asserted');
});

test('decision_record_accepted records addresses_risk_surface when source matches', () => {
  const result = scoreAuthorization({
    riskProfile: riskProfile('api_contract', ['server_api']),
    storySource: null,
    decisions: [
      { status: 'accepted', source: 'finding:server_api/breaking-change', decision_id: 'dec-X' }
    ]
  });
  const accepted = result.signals.find((s) => s.kind === 'decision_record_accepted');
  assert.equal(accepted.addresses_risk_surface, 'server_api');
});

test('non-accepted decisions do not contribute to high', () => {
  const result = scoreAuthorization({
    riskProfile: riskProfile('workflow_heavy', ['core_workflow_state']),
    storySource: null,
    decisions: [
      { status: 'open', source: 'gate:agent_review', decision_id: 'd1' },
      { status: 'rejected', source: 'gate:agent_review', decision_id: 'd2' }
    ]
  });
  assert.notEqual(result.authorization_level, 'high');
});
