import { createHash } from 'node:crypto';
import path from 'node:path';

export const DEPLOY_HANDOFF_SCHEMA_VERSION = 'deploy-handoff.v1';
export const DEPLOY_HANDOFF_MODES = Object.freeze(['normal', 'standalone']);

const FORBIDDEN_STAGE_FIELDS = new Set([
  'merge_sha',
  'merge_commit_sha',
  'request_id',
  'deployed',
  'accepted'
]);
const INPUT_FIELDS = new Set([
  'schema_version',
  'target',
  'acceptance_criteria',
  'mode',
  'authority_ref',
  'external_refs'
]);
const OUTPUT_FIELDS = new Set([
  'schema_version',
  'source',
  'handoff_id',
  'created_at',
  'story_id',
  'head_sha',
  'story_ref',
  'verification_ref',
  'pr_prepare_ref',
  'target',
  'acceptance_criteria',
  'mode',
  'authority_ref',
  'external_refs'
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_REFERENCE_LENGTH = 512;
const MAX_CRITERION_ID_LENGTH = 128;
const MAX_CRITERION_TEXT_LENGTH = 1024;
const REPOSITORY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const ENVIRONMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HANDOFF_ID_PATTERN = /^dh-[0-9a-f]{32}$/;

export class DeployHandoffValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DeployHandoffValidationError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Validate the small caller-owned input file before PR artifacts are written.
 * This function has no filesystem or network side effects.
 */
export function validateDeployHandoffInput(input) {
  assertRecord(input, 'input');
  rejectUnknownFields(input, INPUT_FIELDS, 'input');
  if (input.schema_version !== undefined && input.schema_version !== DEPLOY_HANDOFF_SCHEMA_VERSION) {
    throw invalid('unknown_version', `Unsupported deploy handoff version: ${String(input.schema_version)}`);
  }

  return {
    target: validateTarget(input.target),
    acceptance_criteria: validateAcceptanceCriteria(input.acceptance_criteria),
    mode: validateMode(input.mode),
    authority_ref: validateReferenceString(input.authority_ref, 'authority_ref'),
    ...(input.external_refs === undefined ? {} : { external_refs: validateExternalRefs(input.external_refs) })
  };
}

/**
 * Build a deploy-handoff.v1 intent from already materialized repository refs.
 * The caller supplies file digests; this module never reads repository files.
 */
export function buildDeployHandoff({
  schemaVersion = DEPLOY_HANDOFF_SCHEMA_VERSION,
  storyId,
  headSha,
  storyRef,
  verificationRef,
  prPrepareRef,
  target,
  acceptanceCriteria,
  mode,
  authorityRef,
  externalRefs,
  createdAt = new Date().toISOString(),
  handoffId
} = {}) {
  if (schemaVersion !== DEPLOY_HANDOFF_SCHEMA_VERSION) {
    throw invalid('unknown_version', `Unsupported deploy handoff version: ${String(schemaVersion)}`);
  }
  const normalizedInput = validateDeployHandoffInput({
    target,
    acceptance_criteria: acceptanceCriteria,
    mode,
    authority_ref: authorityRef,
    ...(externalRefs === undefined ? {} : { external_refs: externalRefs })
  });
  const normalizedStoryId = validateStoryId(storyId);
  const normalizedHeadSha = validateCommitSha(headSha);
  const normalizedRefs = {
    story_ref: validateRelativeReference(storyRef, 'story_ref'),
    verification_ref: validateRelativeReference(verificationRef, 'verification_ref'),
    pr_prepare_ref: validateRelativeReference(prPrepareRef, 'pr_prepare_ref')
  };
  const normalizedCreatedAt = validateCreatedAt(createdAt);
  const stableIdentity = JSON.stringify({
    schema_version: DEPLOY_HANDOFF_SCHEMA_VERSION,
    story_id: normalizedStoryId,
    head_sha: normalizedHeadSha,
    ...normalizedRefs,
    target: normalizedInput.target,
    acceptance_criteria: normalizedInput.acceptance_criteria,
    mode: normalizedInput.mode,
    authority_ref: normalizedInput.authority_ref,
    external_refs: normalizedInput.external_refs ?? []
  });
  const normalizedHandoffId = handoffId === undefined
    ? `dh-${createHash('sha256').update(stableIdentity).digest('hex').slice(0, 32)}`
    : validateHandoffId(handoffId);

  const handoff = {
    schema_version: DEPLOY_HANDOFF_SCHEMA_VERSION,
    source: 'vibepro',
    handoff_id: normalizedHandoffId,
    created_at: normalizedCreatedAt,
    story_id: normalizedStoryId,
    head_sha: normalizedHeadSha,
    ...normalizedRefs,
    target: normalizedInput.target,
    acceptance_criteria: normalizedInput.acceptance_criteria,
    mode: normalizedInput.mode,
    authority_ref: normalizedInput.authority_ref,
    ...(normalizedInput.external_refs === undefined ? {} : { external_refs: normalizedInput.external_refs })
  };
  return validateDeployHandoff(handoff);
}

/**
 * Validate a complete deploy-handoff.v1 object, returning a normalized copy.
 */
export function validateDeployHandoff(handoff) {
  assertRecord(handoff, 'handoff');
  for (const key of Object.keys(handoff)) {
    if (FORBIDDEN_STAGE_FIELDS.has(key)) {
      throw invalid('forbidden_stage_field', `deploy-handoff.v1 cannot contain ${key}`);
    }
  }
  rejectUnknownFields(handoff, OUTPUT_FIELDS, 'handoff');
  if (handoff.schema_version !== DEPLOY_HANDOFF_SCHEMA_VERSION) {
    throw invalid('unknown_version', `Unsupported deploy handoff version: ${String(handoff.schema_version)}`);
  }
  if (handoff.source !== 'vibepro') {
    throw invalid('invalid_source', 'deploy-handoff.v1 source must be vibepro');
  }
  return {
    schema_version: DEPLOY_HANDOFF_SCHEMA_VERSION,
    source: 'vibepro',
    handoff_id: validateHandoffId(handoff.handoff_id),
    created_at: validateCreatedAt(handoff.created_at),
    story_id: validateStoryId(handoff.story_id),
    head_sha: validateCommitSha(handoff.head_sha),
    story_ref: validateRelativeReference(handoff.story_ref, 'story_ref'),
    verification_ref: validateRelativeReference(handoff.verification_ref, 'verification_ref'),
    pr_prepare_ref: validateRelativeReference(handoff.pr_prepare_ref, 'pr_prepare_ref'),
    target: validateTarget(handoff.target),
    acceptance_criteria: validateAcceptanceCriteria(handoff.acceptance_criteria),
    mode: validateMode(handoff.mode),
    authority_ref: validateReferenceString(handoff.authority_ref, 'authority_ref'),
    ...(handoff.external_refs === undefined ? {} : { external_refs: validateExternalRefs(handoff.external_refs) })
  };
}

function validateTarget(target) {
  assertRecord(target, 'target');
  rejectUnknownFields(target, new Set(['repository', 'environment']), 'target');
  const repository = validateReferenceString(target.repository, 'target.repository');
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw invalid('invalid_target', 'target.repository must be an owner/name identifier');
  }
  const environment = validateReferenceString(target.environment, 'target.environment');
  if (!ENVIRONMENT_PATTERN.test(environment) || environment === '.' || environment === '..') {
    throw invalid('invalid_target', 'target.environment must be a simple environment identifier');
  }
  return { repository, environment };
}

function validateAcceptanceCriteria(criteria) {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    throw invalid('empty_criteria', 'acceptance_criteria must contain at least one item');
  }
  if (criteria.length > 100) throw invalid('invalid_criteria', 'acceptance_criteria cannot contain more than 100 items');
  const seen = new Set();
  return criteria.map((item, index) => {
    assertRecord(item, `acceptance_criteria[${index}]`);
    rejectUnknownFields(item, new Set(['id', 'condition', 'evidence_method']), `acceptance_criteria[${index}]`);
    const id = validateReferenceString(item.id, `acceptance_criteria[${index}].id`, MAX_CRITERION_ID_LENGTH);
    if (seen.has(id)) throw invalid('duplicate_criteria_id', `Duplicate acceptance criterion id: ${id}`);
    seen.add(id);
    return {
      id,
      condition: validateReferenceString(item.condition, `acceptance_criteria[${index}].condition`, MAX_CRITERION_TEXT_LENGTH),
      evidence_method: validateReferenceString(item.evidence_method, `acceptance_criteria[${index}].evidence_method`, MAX_CRITERION_TEXT_LENGTH)
    };
  });
}

function validateExternalRefs(refs) {
  if (!Array.isArray(refs)) throw invalid('invalid_external_refs', 'external_refs must be an array');
  if (refs.length > 20) throw invalid('invalid_external_refs', 'external_refs cannot contain more than 20 items');
  return refs.map((ref, index) => validateReferenceString(ref, `external_refs[${index}]`));
}

function validateRelativeReference(reference, fieldName) {
  assertRecord(reference, fieldName);
  rejectUnknownFields(reference, new Set(['path', 'sha256']), fieldName);
  const refPath = validateReferenceString(reference.path, `${fieldName}.path`);
  if (isAbsoluteOrEscapingPath(refPath)) {
    throw invalid('invalid_reference_path', `${fieldName}.path must be repository-relative`);
  }
  const digest = validateDigest(reference.sha256, `${fieldName}.sha256`);
  return { path: refPath, sha256: digest };
}

function validateCommitSha(value) {
  const sha = validateReferenceString(value, 'head_sha');
  if (!COMMIT_SHA_PATTERN.test(sha)) throw invalid('invalid_sha', 'head_sha must be a 40-character hexadecimal SHA');
  const normalized = sha.toLowerCase();
  if (/^0{40}$/.test(normalized)) throw invalid('invalid_sha', 'head_sha must not be all zeroes');
  return normalized;
}

function validateDigest(value, fieldName) {
  const digest = validateReferenceString(value, fieldName);
  if (!SHA256_PATTERN.test(digest)) throw invalid('invalid_digest', `${fieldName} must be a 64-character hexadecimal SHA-256`);
  return digest.toLowerCase();
}

function validateMode(mode) {
  if (!DEPLOY_HANDOFF_MODES.includes(mode)) {
    throw invalid('invalid_mode', `mode must be one of: ${DEPLOY_HANDOFF_MODES.join(', ')}`);
  }
  return mode;
}

function validateStoryId(storyId) {
  return validateReferenceString(storyId, 'story_id');
}

function validateReferenceString(value, fieldName, maxLength = MAX_REFERENCE_LENGTH) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid('invalid_string', `${fieldName} must be a non-empty string`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    throw invalid('invalid_string', `${fieldName} cannot contain control characters`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw invalid('invalid_string', `${fieldName} cannot exceed ${maxLength} characters`);
  }
  return normalized;
}

function validateCreatedAt(value) {
  const createdAt = validateReferenceString(value, 'created_at');
  if (!Number.isFinite(Date.parse(createdAt))) throw invalid('invalid_timestamp', 'created_at must be an ISO timestamp');
  return createdAt;
}

function validateHandoffId(value) {
  const handoffId = validateReferenceString(value, 'handoff_id');
  if (!HANDOFF_ID_PATTERN.test(handoffId)) throw invalid('invalid_handoff_id', 'handoff_id must use the dh- plus 32 hex format');
  return handoffId;
}

function isAbsoluteOrEscapingPath(value) {
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || value.startsWith('\\\\')) return true;
  if (value.includes('\\')) return true;
  const segments = value.split('/');
  return segments.length === 0 || segments.some((segment) => segment === '' || segment === '.' || segment === '..');
}

function assertRecord(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('invalid_object', `${fieldName} must be an object`);
  }
}

function rejectUnknownFields(value, allowed, fieldName) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw invalid('unknown_field', `${fieldName} contains unknown field: ${key}`);
  }
}

function invalid(code, message, details = {}) {
  return new DeployHandoffValidationError(code, message, details);
}
