const API_URL_ENV = 'BRAINBASE_KNOWLEDGE_API_URL';
const API_TOKEN_ENV = 'BRAINBASE_KNOWLEDGE_API_TOKEN';
const ORGANIZATION_ID_ENV = 'BRAINBASE_KNOWLEDGE_ORGANIZATION_ID';
const REQUEST_TIMEOUT_MS = 10_000;
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;

const EVENT_PATH = '/api/knowledge/events';
const CYCLE_PATH = '/api/knowledge/cycles';

function configurationError(message) {
  const error = new Error(message);
  error.code = 'BRAINBASE_TRANSPORT_CONFIG_INVALID';
  return error;
}

function candidateError(message) {
  const error = new Error(message);
  error.code = 'BRAINBASE_TRANSPORT_CANDIDATE_INVALID';
  return error;
}

function requestError(message) {
  const error = new Error(message);
  error.code = 'BRAINBASE_TRANSPORT_REQUEST_FAILED';
  return error;
}

function hasConfigValue(value) {
  return value !== undefined && value !== null
    && (typeof value !== 'string' || value.trim() !== '');
}

function nonEmptyString(value, name, errorFactory = configurationError) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw errorFactory(`${name} must be a non-empty string`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw errorFactory(`${name} contains control characters`);
  }
  return value.trim();
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (normalized === 'localhost' || normalized === 'localhost.') return true;
  if (normalized === '::1') return true;

  const ipv4 = normalized.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u);
  if (!ipv4) return false;
  return ipv4.slice(1).every((part) => Number(part) >= 0 && Number(part) <= 255);
}

function parseOrigin(value) {
  const input = nonEmptyString(value, API_URL_ENV);

  // An API URL is deliberately limited to an origin. Checking the input as
  // well as URL.pathname rejects dot-segment paths that URL normalizes to `/`.
  if (!/^https?:\/\/[^/?#]+\/?$/iu.test(input)) {
    throw configurationError(`${API_URL_ENV} must contain only an origin`);
  }

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw configurationError(`${API_URL_ENV} is invalid`);
  }

  if (parsed.origin === 'null' || !parsed.hostname) {
    throw configurationError(`${API_URL_ENV} must contain a valid origin`);
  }
  if (parsed.username || parsed.password) {
    throw configurationError(`${API_URL_ENV} must not contain credentials`);
  }
  if (parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw configurationError(`${API_URL_ENV} must not contain a path, query, or hash`);
  }
  if (parsed.protocol === 'http:' && !isLoopbackHostname(parsed.hostname)) {
    throw configurationError(`${API_URL_ENV} must use https unless it targets loopback`);
  }

  return parsed.origin;
}

function parseToken(value) {
  const token = nonEmptyString(value, API_TOKEN_ENV);
  if (/\s/u.test(token)) {
    throw configurationError(`${API_TOKEN_ENV} must be a Bearer token without whitespace`);
  }
  return token;
}

function parseOrganizationId(value) {
  return nonEmptyString(value, ORGANIZATION_ID_ENV);
}

function readCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw candidateError('Brainbase Knowledge candidate must be an object');
  }

  const eventId = nonEmptyString(candidate.event_id, 'candidate.event_id', candidateError);
  if (!EVENT_ID_PATTERN.test(eventId)) {
    throw candidateError('candidate.event_id must be a safe event identifier');
  }
  const projectCode = nonEmptyString(
    candidate.applicability_scope?.project_code,
    'candidate.applicability_scope.project_code',
    candidateError
  );

  if (candidate.subject?.type !== 'development_learning'
      || candidate.decision_authority?.authorized !== false
      || candidate.decision_authority?.graph_promotion_allowed !== false
      || candidate.permission_snapshot?.graph_promotion !== false) {
    throw candidateError('Brainbase Knowledge transport only accepts non-promotable development-learning candidates');
  }

  return { eventId, projectCode };
}

function assertOrganizationClaims(candidate, organizationId) {
  const claims = [
    candidate.organization_id,
    candidate.applicability_scope?.organization_id,
    candidate.correction_event?.organization_id,
    candidate.correction_event?.applicability_scope?.organization_id
  ];
  for (const claim of claims) {
    if (claim === undefined || claim === null || claim === '') continue;
    if (typeof claim !== 'string' || claim !== organizationId) {
      throw candidateError('Brainbase Knowledge candidate organization scope does not match the configured organization');
    }
  }
}

function encodePathSegment(value) {
  return encodeURIComponent(value);
}

function timeoutSignal() {
  const abortSignal = globalThis.AbortSignal;
  if (typeof abortSignal?.timeout !== 'function') {
    throw requestError('Brainbase Knowledge transport requires AbortSignal.timeout');
  }
  return abortSignal.timeout(REQUEST_TIMEOUT_MS);
}

function jsonHeaders(token, organizationId, includeBody) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'x-brainbase-organization-id': organizationId,
    ...(includeBody ? { 'Content-Type': 'application/json' } : {})
  };
}

async function readJsonResponse(response, expectedStatus, operation) {
  if (!response || response.status !== expectedStatus) {
    const status = response && Number.isInteger(response.status) ? ` (${response.status})` : '';
    throw requestError(`Brainbase Knowledge API ${operation} returned an unexpected status${status}`);
  }
  if (typeof response.json !== 'function') {
    throw requestError(`Brainbase Knowledge API ${operation} did not return JSON`);
  }
  try {
    return await response.json();
  } catch {
    throw requestError(`Brainbase Knowledge API ${operation} returned invalid JSON`);
  }
}

export function createBrainbaseTransport(
  env = process.env,
  { fetch: fetchFn = globalThis.fetch } = {}
) {
  const source = env && typeof env === 'object' ? env : {};
  const rawUrl = source[API_URL_ENV];
  const rawToken = source[API_TOKEN_ENV];
  const rawOrganizationId = source[ORGANIZATION_ID_ENV];

  if (![rawUrl, rawToken, rawOrganizationId].some(hasConfigValue)) return null;

  const origin = parseOrigin(rawUrl);
  const token = parseToken(rawToken);
  const organizationId = parseOrganizationId(rawOrganizationId);
  if (typeof fetchFn !== 'function') {
    throw configurationError('Brainbase Knowledge transport requires a fetch function');
  }

  const target = { origin, organization_id: organizationId };

  async function send(candidate, _item) {
    readCandidate(candidate);
    assertOrganizationClaims(candidate, organizationId);
    let body;
    try {
      body = JSON.stringify(candidate);
    } catch {
      throw candidateError('Brainbase Knowledge candidate could not be serialized as JSON');
    }

    let response;
    try {
      response = await fetchFn(`${origin}${EVENT_PATH}`, {
        method: 'POST',
        headers: jsonHeaders(token, organizationId, true),
        body,
        redirect: 'error',
        signal: timeoutSignal()
      });
    } catch {
      throw requestError('Brainbase Knowledge API event send request failed');
    }
    return readJsonResponse(response, 202, 'event send');
  }

  async function readback(candidate, _item) {
    const { eventId, projectCode } = readCandidate(candidate);
    assertOrganizationClaims(candidate, organizationId);

    let response;
    try {
      response = await fetchFn(
        `${origin}${CYCLE_PATH}/${encodePathSegment(eventId)}?project_code=${encodeURIComponent(projectCode)}`,
        {
          method: 'GET',
          headers: jsonHeaders(token, organizationId, false),
          redirect: 'error',
          signal: timeoutSignal()
        }
      );
    } catch {
      throw requestError('Brainbase Knowledge API cycle readback request failed');
    }
    return readJsonResponse(response, 200, 'cycle readback');
  }

  return { target, send, readback };
}
