import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UI_VISUAL_OBSERVATION_KEYS,
  evaluateUiVisualSurfaceVerdict,
  applyUiVisualMeasurePolicy
} from '../src/ui-visual-verify-policy.js';
import { buildObservation } from '../src/verification-evidence.js';

test('listed nondeterministic surface: computed-style pass wins over pixel fail', () => {
  const verdict = evaluateUiVisualSurfaceVerdict({
    surfaceId: 'world',
    nondeterministicSurfaces: ['world'],
    pixelDiffPass: false,
    computedStylePass: true,
    beforeRepeatPixelDrift: 12
  });
  assert.equal(verdict.pass, true);
  assert.equal(verdict.criterion, 'computed_style_paths');
  assert.equal(verdict.pixel_advisory_only, true);
});

test('listed nondeterministic surface: computed-style fail fails even if pixel passes', () => {
  const verdict = evaluateUiVisualSurfaceVerdict({
    surfaceId: 'world',
    nondeterministicSurfaces: ['world'],
    pixelDiffPass: true,
    computedStylePass: false
  });
  assert.equal(verdict.pass, false);
  assert.equal(verdict.fail_reason, 'computed_style_paths_mismatch');
});

test('unlisted surface: pixel diff remains pass/fail', () => {
  const fail = evaluateUiVisualSurfaceVerdict({
    surfaceId: 'sidebar',
    nondeterministicSurfaces: ['world'],
    pixelDiffPass: false,
    computedStylePass: true
  });
  assert.equal(fail.pass, false);
  assert.equal(fail.criterion, 'pixel_diff');

  const pass = evaluateUiVisualSurfaceVerdict({
    surfaceId: 'sidebar',
    nondeterministicSurfaces: ['world'],
    pixelDiffPass: true,
    computedStylePass: false
  });
  assert.equal(pass.pass, true);
});

test('verify buildObservation enforces ui visual policy on passing records', () => {
  const values = {
    [UI_VISUAL_OBSERVATION_KEYS.surfaceId]: 'world',
    [UI_VISUAL_OBSERVATION_KEYS.pixelPass]: 'false',
    [UI_VISUAL_OBSERVATION_KEYS.computedStylePass]: 'true',
    [UI_VISUAL_OBSERVATION_KEYS.nondeterministicSurfaces]: 'world'
  };
  const observation = buildObservation({
    status: 'pass',
    observed: Object.entries(values).map(([key, value]) => `${key}=${value}`)
  });
  assert.equal(observation.values.ui_visual_verdict_pass, true);

  assert.throws(() => buildObservation({
    status: 'pass',
    observed: [
      'ui_visual_surface_id=sidebar',
      'ui_visual_pixel_diff_pass=false',
      'ui_visual_computed_style_pass=true',
      'ui_visual_nondeterministic_surfaces=world'
    ]
  }), /pixel_diff_mismatch/);
});

test('applyUiVisualMeasurePolicy rejects contradictory passing status', () => {
  assert.throws(() => applyUiVisualMeasurePolicy({
    ui_visual_surface_id: 'world',
    ui_visual_pixel_diff_pass: 'false',
    ui_visual_computed_style_pass: 'false',
    ui_visual_nondeterministic_surfaces: 'world'
  }, { status: 'pass' }), /computed_style_paths_mismatch/);
});
