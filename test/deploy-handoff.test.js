import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDeployHandoff,
  validateDeployHandoff,
  validateDeployHandoffInput
} from '../src/deploy-handoff.js';

const HEAD_SHA = 'a'.repeat(40);
const DIGEST = 'b'.repeat(64);

function validInput(overrides = {}) {
  return {
    target: { repository: 'example/service', environment: 'staging' },
    acceptance_criteria: [{
      id: 'AC-1',
      condition: 'The staging endpoint returns the expected response.',
      evidence_method: 'Read the bounded staging smoke-test receipt.'
    }],
    mode: 'normal',
    authority_ref: 'authority://operator-approval/example',
    ...overrides
  };
}

function validHandoff(overrides = {}) {
  const input = validInput();
  return buildDeployHandoff({
    storyId: 'story-deploy-handoff',
    headSha: HEAD_SHA,
    storyRef: { path: 'docs/stories/story-deploy-handoff.md', sha256: DIGEST },
    verificationRef: { path: '.vibepro/pr/story-deploy-handoff/verification-evidence.json', sha256: DIGEST },
    prPrepareRef: { path: '.vibepro/pr/story-deploy-handoff/pr-prepare.json', sha256: DIGEST },
    target: input.target,
    acceptanceCriteria: input.acceptance_criteria,
    mode: input.mode,
    authorityRef: input.authority_ref,
    ...overrides
  });
}

test('builds a versioned local intent without merge or deployment state', () => {
  const handoff = validHandoff();

  assert.equal(handoff.schema_version, 'deploy-handoff.v1');
  assert.equal(handoff.source, 'vibepro');
  assert.equal(handoff.head_sha, HEAD_SHA);
  assert.equal(handoff.target.repository, 'example/service');
  assert.equal(handoff.mode, 'normal');
  assert.ok(/^dh-[0-9a-f]{32}$/.test(handoff.handoff_id));
  assert.equal('merge_sha' in handoff, false);
  assert.equal('merge_commit_sha' in handoff, false);
  assert.equal('request_id' in handoff, false);
  assert.equal('deployed' in handoff, false);
  assert.equal('accepted' in handoff, false);
});

test('normalizes caller input while keeping Brainbase optional', () => {
  const input = validateDeployHandoffInput({
    ...validInput(),
    target: { repository: ' example/service ', environment: ' staging ' },
    authority_ref: ' authority://operator-approval/example '
  });

  assert.deepEqual(input.target, { repository: 'example/service', environment: 'staging' });
  assert.equal(input.authority_ref, 'authority://operator-approval/example');
});

test('accepts standalone mode as an explicit second intent mode', () => {
  const handoff = validHandoff({ mode: 'standalone' });
  assert.equal(handoff.mode, 'standalone');
});

test('rejects unknown versions, invalid SHAs, and invalid targets', () => {
  assert.throws(
    () => validateDeployHandoffInput({ ...validInput(), schema_version: 'deploy-handoff.v2' }),
    (error) => error.code === 'unknown_version'
  );
  assert.throws(
    () => validHandoff({ headSha: 'not-a-sha' }),
    (error) => error.code === 'invalid_sha'
  );
  assert.throws(
    () => validHandoff({ headSha: '0'.repeat(40) }),
    (error) => error.code === 'invalid_sha'
  );
  assert.throws(
    () => validateDeployHandoffInput({ ...validInput(), target: { repository: 'example', environment: 'staging' } }),
    (error) => error.code === 'invalid_target'
  );
  assert.throws(
    () => validateDeployHandoffInput({ ...validInput(), target: { repository: 'org/team/service', environment: 'staging' } }),
    (error) => error.code === 'invalid_target'
  );
});

test('normalizes uppercase SHAs and enforces bridge field bounds', () => {
  const handoff = validHandoff({ headSha: 'A'.repeat(40) });
  assert.equal(handoff.head_sha, 'a'.repeat(40));
  assert.throws(
    () => validateDeployHandoffInput({
      ...validInput(),
      authority_ref: 'a'.repeat(513)
    }),
    (error) => error.code === 'invalid_string'
  );
  assert.throws(
    () => validateDeployHandoffInput({
      ...validInput(),
      acceptance_criteria: [{
        id: 'a'.repeat(129),
        condition: 'ok',
        evidence_method: 'receipt'
      }]
    }),
    (error) => error.code === 'invalid_string'
  );
  assert.throws(
    () => validateDeployHandoffInput({
      ...validInput(),
      acceptance_criteria: [{
        id: 'AC-1',
        condition: 'a'.repeat(1025),
        evidence_method: 'receipt'
      }]
    }),
    (error) => error.code === 'invalid_string'
  );
  assert.throws(
    () => validateDeployHandoffInput({
      ...validInput(),
      external_refs: Array.from({ length: 21 }, (_, index) => `https://example.invalid/${index}`)
    }),
    (error) => error.code === 'invalid_external_refs'
  );
});

test('rejects empty or duplicate acceptance criteria and unsafe refs', () => {
  assert.throws(
    () => validateDeployHandoffInput({ ...validInput(), acceptance_criteria: [] }),
    (error) => error.code === 'empty_criteria'
  );
  assert.throws(
    () => validateDeployHandoffInput({
      ...validInput(),
      acceptance_criteria: [validInput().acceptance_criteria[0], validInput().acceptance_criteria[0]]
    }),
    (error) => error.code === 'duplicate_criteria_id'
  );
  assert.throws(
    () => validHandoff({ storyRef: { path: '/tmp/story.md', sha256: DIGEST } }),
    (error) => error.code === 'invalid_reference_path'
  );
});

test('rejects forbidden second-stage fields and unknown fields', () => {
  assert.throws(
    () => validateDeployHandoff({ ...validHandoff(), merge_commit_sha: 'c'.repeat(40) }),
    (error) => error.code === 'forbidden_stage_field'
  );
  assert.throws(
    () => validateDeployHandoffInput({ ...validInput(), request_id: 'request-1' }),
    (error) => error.code === 'unknown_field'
  );
});
