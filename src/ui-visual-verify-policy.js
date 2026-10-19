/**
 * UI visual measure pass/fail policy for verify / UIUX evidence.
 *
 * Nondeterministic surfaces must be declared on the Spec (`nondeterministic_surfaces[]`).
 * Only listed surfaces use computed-style path equality as pass/fail; pixel diff alone
 * must not fail a listed surface. Unlisted surfaces keep pixel diff as pass/fail.
 */

export const UI_VISUAL_OBSERVATION_KEYS = {
  surfaceId: 'ui_visual_surface_id',
  pixelPass: 'ui_visual_pixel_diff_pass',
  computedStylePass: 'ui_visual_computed_style_pass',
  nondeterministicSurfaces: 'ui_visual_nondeterministic_surfaces',
  beforeRepeatPixelDrift: 'ui_visual_before_repeat_pixel_drift',
  verdictPass: 'ui_visual_verdict_pass',
  pixelAdvisory: 'ui_visual_pixel_advisory_only'
};

function parseBoolean(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'pass', 'passed'].includes(normalized)) return true;
  if (['false', '0', 'no', 'fail', 'failed'].includes(normalized)) return false;
  return null;
}

function parseSurfaceList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value ?? '')
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSurfaceId(surfaceId) {
  return String(surfaceId ?? '').trim().toLowerCase();
}

export function isNondeterministicSurface(surfaceId, nondeterministicSurfaces = []) {
  const needle = normalizeSurfaceId(surfaceId);
  if (!needle) return false;
  return nondeterministicSurfaces
    .map((item) => normalizeSurfaceId(item))
    .includes(needle);
}

/**
 * @param {object} input
 * @param {string} input.surfaceId
 * @param {string[]} [input.nondeterministicSurfaces]
 * @param {boolean} input.pixelDiffPass
 * @param {boolean} input.computedStylePass
 * @param {number} [input.beforeRepeatPixelDrift]
 */
export function evaluateUiVisualSurfaceVerdict(input) {
  const surfaceId = String(input.surfaceId ?? '').trim();
  const nondeterministicSurfaces = Array.isArray(input.nondeterministicSurfaces)
    ? input.nondeterministicSurfaces
    : [];
  const listed = isNondeterministicSurface(surfaceId, nondeterministicSurfaces);
  const pixelDiffPass = input.pixelDiffPass === true;
  const computedStylePass = input.computedStylePass === true;
  const drift = Number(input.beforeRepeatPixelDrift);
  const hasDrift = Number.isFinite(drift) && drift > 0;

  if (listed) {
    const pass = computedStylePass;
    const pixelAdvisoryOnly = !pixelDiffPass && computedStylePass;
    return {
      surface_id: surfaceId,
      nondeterministic: true,
      pass,
      criterion: 'computed_style_paths',
      pixel_diff_pass: pixelDiffPass,
      computed_style_pass: computedStylePass,
      pixel_advisory_only: pixelAdvisoryOnly,
      before_repeat_pixel_drift: hasDrift ? drift : 0,
      fail_reason: pass ? null : 'computed_style_paths_mismatch'
    };
  }

  const pass = pixelDiffPass;
  return {
    surface_id: surfaceId,
    nondeterministic: false,
    pass,
    criterion: 'pixel_diff',
    pixel_diff_pass: pixelDiffPass,
    computed_style_pass: computedStylePass,
    pixel_advisory_only: false,
    before_repeat_pixel_drift: hasDrift ? drift : 0,
    fail_reason: pass ? null : 'pixel_diff_mismatch'
  };
}

/**
 * Apply policy to verify observation values. Mutates `values` with verdict fields.
 * Throws when a passing record contradicts the policy.
 */
export function applyUiVisualMeasurePolicy(values, { status } = {}) {
  if (!values || typeof values !== 'object') return null;
  const surfaceId = values[UI_VISUAL_OBSERVATION_KEYS.surfaceId];
  if (!surfaceId) return null;

  const pixelPass = parseBoolean(values[UI_VISUAL_OBSERVATION_KEYS.pixelPass]);
  const computedStylePass = parseBoolean(values[UI_VISUAL_OBSERVATION_KEYS.computedStylePass]);
  if (pixelPass === null || computedStylePass === null) {
    throw new Error(
      'ui visual measure requires boolean '
      + `${UI_VISUAL_OBSERVATION_KEYS.pixelPass} and ${UI_VISUAL_OBSERVATION_KEYS.computedStylePass}`
    );
  }

  const specSurfaces = parseSurfaceList(values[UI_VISUAL_OBSERVATION_KEYS.nondeterministicSurfaces]);
  const driftRaw = values[UI_VISUAL_OBSERVATION_KEYS.beforeRepeatPixelDrift];
  const drift = driftRaw === undefined ? 0 : Number(driftRaw);

  const verdict = evaluateUiVisualSurfaceVerdict({
    surfaceId,
    nondeterministicSurfaces: specSurfaces,
    pixelDiffPass: pixelPass,
    computedStylePass: computedStylePass,
    beforeRepeatPixelDrift: drift
  });

  values[UI_VISUAL_OBSERVATION_KEYS.verdictPass] = verdict.pass;
  values[UI_VISUAL_OBSERVATION_KEYS.pixelAdvisory] = verdict.pixel_advisory_only;

  const passing = ['pass', 'passed', 'success', 'ok'].includes(String(status ?? '').toLowerCase());
  if (passing && !verdict.pass) {
    throw new Error(
      `ui visual measure failed for surface "${surfaceId}" `
      + `(criterion=${verdict.criterion}): ${verdict.fail_reason}`
    );
  }

  return verdict;
}
