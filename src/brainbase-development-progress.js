const API_URL_ENV = 'BRAINBASE_DEVELOPMENT_API_URL';
const API_TOKEN_ENV = 'BRAINBASE_DEVELOPMENT_API_TOKEN';
const REQUEST_TIMEOUT_MS = 10_000;
const DEVELOPMENT_PROGRESS_SCHEMA_VERSION = 'development-progress.v1';
const DEVELOPMENT_PLAN_SCHEMA_VERSION = '0.2.0';
const PROGRESS_PATH_PREFIX = '/api/tasks/';
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/u;
const TOP_LEVEL_FIELDS = new Set([
  'schema_version', 'event_id', 'source', 'sequence', 'observed_at',
  'canonical_task_id', 'task_ref', 'plan_version', 'execution', 'evidence',
  'block_reason', 'next_action',
]);
const TASK_REF_FIELDS = new Set(['repository', 'story_id', 'task_id']);
const EXECUTION_FIELDS = new Set([
  'dispatch_id', 'attempt', 'owner', 'session_ref', 'status', 'worktree',
  'base_sha', 'head_sha',
]);
const EVIDENCE_FIELDS = new Set(['artifacts', 'verification', 'integration_revision']);

function contractError(message, code = 'BRAINBASE_DEVELOPMENT_CONTRACT_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requestError(message, status = null, body = null) {
  const error = new Error(message);
  error.code = 'BRAINBASE_DEVELOPMENT_REQUEST_FAILED';
  if (Number.isInteger(status)) error.status = status;
  if (body !== null) error.body = body;
  return error;
}

function nonEmptyString(value, name, { identifier = false, maxLength = 4096 } = {}) {
  if (typeof value !== 'string' || value.trim() === '') throw contractError(`${name} must be a non-empty string`);
  const text = value.trim();
  if (text.length > maxLength || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw contractError(`${name} is too long or contains control characters`);
  }
  if (identifier && !IDENTIFIER_PATTERN.test(text)) throw contractError(`${name} is not a safe identifier`);
  return text;
}

function optionalString(value, name, { identifier = false } = {}) {
  return value === null || value === undefined ? null : nonEmptyString(value, name, { identifier });
}

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw contractError(`${name} must be an object`);
  return value;
}

function knownFields(value, allowed, name) {
  for (const field of Object.keys(value)) if (!allowed.has(field)) throw contractError(`${name}.${field} is not supported`);
}

function clone(value) {
  return structuredClone(value);
}

function jsonSized(value, name, maxBytes = 256 * 1024) {
  let serialized;
  try { serialized = JSON.stringify(value); } catch { throw contractError(`${name} must be JSON serializable`); }
  if (serialized.length > maxBytes) throw contractError(`${name} is too large`);
}

function normalizeTaskRef(value) {
  const ref = object(value, 'task_ref');
  knownFields(ref, TASK_REF_FIELDS, 'task_ref');
  return {
    repository: nonEmptyString(ref.repository, 'task_ref.repository', { identifier: true }),
    story_id: nonEmptyString(ref.story_id, 'task_ref.story_id', { identifier: true }),
    task_id: nonEmptyString(ref.task_id, 'task_ref.task_id', { identifier: true }),
  };
}

function normalizeExecution(value) {
  const execution = object(value, 'execution');
  knownFields(execution, EXECUTION_FIELDS, 'execution');
  if (!Number.isInteger(execution.attempt) || execution.attempt < 1 || execution.attempt > 1_000_000) {
    throw contractError('execution.attempt must be a positive integer');
  }
  return {
    dispatch_id: nonEmptyString(execution.dispatch_id, 'execution.dispatch_id', { identifier: true }),
    attempt: execution.attempt,
    owner: nonEmptyString(execution.owner, 'execution.owner', { identifier: true }),
    session_ref: nonEmptyString(execution.session_ref, 'execution.session_ref', { identifier: true }),
    status: nonEmptyString(execution.status, 'execution.status'),
    worktree: optionalString(execution.worktree, 'execution.worktree'),
    base_sha: optionalString(execution.base_sha, 'execution.base_sha', { identifier: true }),
    head_sha: optionalString(execution.head_sha, 'execution.head_sha', { identifier: true }),
  };
}

function normalizeEvidence(value) {
  const evidence = object(value, 'evidence');
  knownFields(evidence, EVIDENCE_FIELDS, 'evidence');
  if (!Array.isArray(evidence.artifacts) || evidence.artifacts.length > 128) {
    throw contractError('evidence.artifacts must be an array with at most 128 entries');
  }
  for (const artifact of evidence.artifacts) jsonSized(artifact, 'evidence.artifacts item', 32 * 1024);
  const verification = evidence.verification === undefined || evidence.verification === null
    ? null : clone(evidence.verification);
  jsonSized(verification, 'evidence.verification', 64 * 1024);
  const integrationRevision = optionalString(evidence.integration_revision, 'evidence.integration_revision', { identifier: true });
  return {
    artifacts: clone(evidence.artifacts),
    ...(verification === null ? {} : { verification }),
    ...(integrationRevision === null ? {} : { integration_revision: integrationRevision }),
  };
}

export function validateDevelopmentProgressEnvelope(value) {
  const envelope = object(value, 'development progress envelope');
  knownFields(envelope, TOP_LEVEL_FIELDS, 'development progress envelope');
  if (envelope.schema_version !== DEVELOPMENT_PROGRESS_SCHEMA_VERSION) {
    throw contractError(`schema_version must be ${DEVELOPMENT_PROGRESS_SCHEMA_VERSION}`);
  }
  const eventId = nonEmptyString(envelope.event_id, 'event_id', { maxLength: 200 });
  if (!EVENT_ID_PATTERN.test(eventId)) throw contractError('event_id is not a safe identifier');
  if (!Number.isInteger(envelope.sequence) || envelope.sequence < 1 || envelope.sequence > Number.MAX_SAFE_INTEGER) {
    throw contractError('sequence must be a positive safe integer');
  }
  const taskId = nonEmptyString(envelope.canonical_task_id, 'canonical_task_id', { identifier: true });
  const taskRef = normalizeTaskRef(envelope.task_ref);
  const observedAt = nonEmptyString(envelope.observed_at, 'observed_at', { maxLength: 64 });
  if (!Number.isFinite(Date.parse(observedAt))) throw contractError('observed_at must be an ISO timestamp');
  const normalized = {
    schema_version: DEVELOPMENT_PROGRESS_SCHEMA_VERSION,
    event_id: eventId,
    source: nonEmptyString(envelope.source, 'source', { identifier: true }),
    sequence: envelope.sequence,
    observed_at: new Date(Date.parse(observedAt)).toISOString(),
    canonical_task_id: taskId,
    task_ref: taskRef,
    plan_version: nonEmptyString(envelope.plan_version, 'plan_version', { identifier: true }),
    execution: normalizeExecution(envelope.execution),
    evidence: normalizeEvidence(envelope.evidence),
    ...(envelope.block_reason === undefined || envelope.block_reason === null
      ? {} : { block_reason: nonEmptyString(envelope.block_reason, 'block_reason') }),
    ...(envelope.next_action === undefined || envelope.next_action === null
      ? {} : { next_action: nonEmptyString(envelope.next_action, 'next_action') }),
  };
  jsonSized(normalized, 'development progress envelope');
  return normalized;
}

export function createDevelopmentProgressEnvelope(input) {
  return validateDevelopmentProgressEnvelope({
    ...input,
    schema_version: input?.schema_version ?? DEVELOPMENT_PROGRESS_SCHEMA_VERSION,
  });
}

export function validateDevelopmentPlan(value) {
  const plan = object(value, 'development plan');
  if (plan.schema_version !== DEVELOPMENT_PLAN_SCHEMA_VERSION) {
    throw contractError(`plan.schema_version must be ${DEVELOPMENT_PLAN_SCHEMA_VERSION}`);
  }
  const repository = nonEmptyString(plan.repository, 'plan.repository', { identifier: true });
  const storyId = nonEmptyString(plan.story_id, 'plan.story_id', { identifier: true });
  const planVersion = nonEmptyString(plan.plan_version, 'plan.plan_version', { identifier: true });
  const intent = object(plan.intent, 'plan.intent');
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) throw contractError('plan.tasks must be a non-empty array');
  const tasks = plan.tasks.map((task, index) => {
    const item = object(task, `plan.tasks[${index}]`);
    return { ...clone(item), task_id: nonEmptyString(item.task_id, `plan.tasks[${index}].task_id`, { identifier: true }) };
  });
  return { schema_version: DEVELOPMENT_PLAN_SCHEMA_VERSION, repository, story_id: storyId, plan_version: planVersion, intent: clone(intent), tasks };
}

function hasConfig(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function parseOrigin(value) {
  if (!hasConfig(value)) throw contractError(`${API_URL_ENV} must be configured`);
  const text = value.trim();
  if (!/^https?:\/\/[^/?#]+\/?$/iu.test(text)) throw contractError(`${API_URL_ENV} must contain only an origin`);
  let url;
  try { url = new URL(text); } catch { throw contractError(`${API_URL_ENV} is invalid`); }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname.replace(/^\[|\]$/gu, '').toLowerCase());
  if (url.protocol === 'http:' && !loopback) throw contractError(`${API_URL_ENV} must use https unless it targets loopback`);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw contractError(`${API_URL_ENV} must contain only an origin`);
  return url.origin;
}

function parseToken(value) {
  if (!hasConfig(value) || /\s/u.test(value.trim())) throw contractError(`${API_TOKEN_ENV} must be a bearer token without whitespace`);
  return value.trim();
}

function timeoutSignal() {
  if (typeof globalThis.AbortSignal?.timeout !== 'function') throw requestError('AbortSignal.timeout is required');
  return globalThis.AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

function routeFor(taskId, query = null) {
  const path = `${PROGRESS_PATH_PREFIX}${encodeURIComponent(taskId)}/development-progress`;
  return query ? `${path}?${query.toString()}` : path;
}

async function responseBody(response) {
  if (typeof response?.json !== 'function') return null;
  try { return await response.json(); } catch { return null; }
}

/**
 * Verify the receiver's readback against the event that was sent. A 200 from
 * the HTTP endpoint only proves that a response was returned; this check is
 * what proves that the projection contains this exact event and local task
 * mapping.
 */
export function verifyDevelopmentProgressReadback(value, envelopeInput) {
  const envelope = validateDevelopmentProgressEnvelope(envelopeInput);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw requestError('Brainbase development progress readback is not an object');
  }
  const mismatch = (field, expected, actual) => {
    const error = requestError(`Brainbase development progress readback mismatch: ${field}`);
    error.code = 'BRAINBASE_DEVELOPMENT_READBACK_MISMATCH';
    error.field = field;
    error.expected = expected;
    error.actual = actual;
    throw error;
  };
  if (value.schema_version !== DEVELOPMENT_PROGRESS_SCHEMA_VERSION) {
    mismatch('schema_version', DEVELOPMENT_PROGRESS_SCHEMA_VERSION, value.schema_version);
  }
  if (value.projection_status !== 'confirmed') mismatch('projection_status', 'confirmed', value.projection_status);
  if (value.canonical_task_id !== envelope.canonical_task_id) {
    mismatch('canonical_task_id', envelope.canonical_task_id, value.canonical_task_id);
  }
  const taskRef = value.task_ref;
  if (!taskRef || typeof taskRef !== 'object' || Array.isArray(taskRef)) mismatch('task_ref', envelope.task_ref, taskRef);
  for (const field of ['repository', 'story_id', 'task_id']) {
    if (taskRef[field] !== envelope.task_ref[field]) mismatch(`task_ref.${field}`, envelope.task_ref[field], taskRef[field]);
  }
  if (value.plan_version !== envelope.plan_version) mismatch('plan_version', envelope.plan_version, value.plan_version);
  if (value.session_ref !== envelope.execution.session_ref) {
    mismatch('session_ref', envelope.execution.session_ref, value.session_ref);
  }
  if (value.latest_event_id !== envelope.event_id) mismatch('latest_event_id', envelope.event_id, value.latest_event_id);
  if (value.latest_sequence !== envelope.sequence) mismatch('latest_sequence', envelope.sequence, value.latest_sequence);
  if (!value.execution || typeof value.execution !== 'object' || Array.isArray(value.execution)) {
    mismatch('execution', envelope.execution, value.execution);
  }
  for (const field of ['dispatch_id', 'attempt', 'owner', 'session_ref', 'status', 'worktree', 'base_sha', 'head_sha']) {
    if (value.execution[field] !== envelope.execution[field]) {
      mismatch(`execution.${field}`, envelope.execution[field], value.execution[field]);
    }
  }
  return value;
}

function requestHeaders(token, includeBody) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    ...(includeBody ? { 'Content-Type': 'application/json' } : {}),
  };
}

export function createBrainbaseDevelopmentTransport(
  env = process.env,
  { fetch: fetchFn = globalThis.fetch } = {},
) {
  const source = env && typeof env === 'object' ? env : {};
  const configured = [source[API_URL_ENV], source[API_TOKEN_ENV]].some(hasConfig);
  if (!configured) return null;
  const origin = parseOrigin(source[API_URL_ENV]);
  const token = parseToken(source[API_TOKEN_ENV]);
  if (typeof fetchFn !== 'function') throw contractError('Brainbase development transport requires a fetch function');

  async function send(input) {
    const envelope = validateDevelopmentProgressEnvelope(input);
    let response;
    try {
      response = await fetchFn(`${origin}${routeFor(envelope.canonical_task_id)}`, {
        method: 'POST',
        headers: requestHeaders(token, true),
        body: JSON.stringify(envelope),
        redirect: 'error',
        signal: timeoutSignal(),
      });
    } catch {
      throw requestError('Brainbase development progress send request failed');
    }
    const body = await responseBody(response);
    if (![200, 202].includes(response?.status)) throw requestError('Brainbase development progress send returned an unexpected status', response?.status, body);
    return body;
  }

  async function readback(input) {
    const envelope = validateDevelopmentProgressEnvelope(input);
    const query = new URLSearchParams({
      repository: envelope.task_ref.repository,
      story_id: envelope.task_ref.story_id,
      task_id: envelope.task_ref.task_id,
      session_ref: envelope.execution.session_ref,
    });
    let response;
    try {
      response = await fetchFn(`${origin}${routeFor(envelope.canonical_task_id, query)}`, {
        method: 'GET',
        headers: requestHeaders(token, false),
        redirect: 'error',
        signal: timeoutSignal(),
      });
    } catch {
      throw requestError('Brainbase development progress readback request failed');
    }
    const body = await responseBody(response);
    if (response?.status !== 200) throw requestError('Brainbase development progress readback returned an unexpected status', response?.status, body);
    return verifyDevelopmentProgressReadback(body, envelope);
  }

  return {
    target: { origin },
    send,
    readback,
  };
}

/**
 * Optional adapter used by a VibePro runner. Supplying `transport` keeps the
 * runner testable and lets an authenticated host provide its own HTTP client.
 */
export function createDevelopmentProgressSender({ transport = null, env = process.env, fetch: fetchFn = globalThis.fetch } = {}) {
  const selected = transport ?? createBrainbaseDevelopmentTransport(env, { fetch: fetchFn });
  if (!selected) return null;
  if (typeof selected.send !== 'function' || typeof selected.readback !== 'function') {
    throw contractError('development progress transport must expose send and readback');
  }
  return {
    target: selected.target ?? null,
    async send(envelope) { return selected.send(validateDevelopmentProgressEnvelope(envelope)); },
    async readback(envelope) {
      const normalized = validateDevelopmentProgressEnvelope(envelope);
      return verifyDevelopmentProgressReadback(await selected.readback(normalized), normalized);
    },
  };
}

export {
  DEVELOPMENT_PROGRESS_SCHEMA_VERSION,
  DEVELOPMENT_PLAN_SCHEMA_VERSION,
};
