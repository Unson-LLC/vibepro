import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const EVENT_KINDS = new Set(['progress', 'partial_result', 'completed', 'failed', 'cancelled']);
const PAYLOAD_KEYS = Object.freeze({
  progress: new Set(['heartbeat', 'message', 'progress_percent']),
  partial_result: new Set(['judgment_id', 'verdict', 'reason', 'summary', 'findings', 'surface_paths', 'judgments']),
  completed: new Set(['completion_status', 'changed_files', 'head_sha', 'test_suggestions', 'summary', 'agent_identity', 'thread_id', 'lifecycle', 'review_record', 'judgments', 'message', 'usage_accounting']),
  failed: new Set(['message', 'error_code', 'head_sha', 'usage_accounting']),
  cancelled: new Set(['message', 'error_code', 'head_sha', 'usage_accounting'])
});
const NESTED_KEYS = Object.freeze({
  review_record: new Set(['status', 'summary', 'findings', 'inspection_summary', 'inspection_evidence', 'judgment_deltas']),
  finding: new Set(['id', 'severity', 'detail']),
  judgment: new Set(['judgment_id', 'verdict', 'reason', 'summary', 'findings', 'surface_paths']),
  usage_accounting: new Set(['input_tokens', 'output_tokens', 'total_tokens', 'cost_usd'])
});

export function createAgentCompletionInbox({ repoRoot, now = () => new Date(), io = {} } = {}) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) throw new TypeError('repoRoot is required');
  const fs = { link, mkdir, readFile, readdir, unlink, writeFile, ...io };
  const root = path.join(repoRoot, '.vibepro', 'runtime-inbox');

  return Object.freeze({
    append: async (event) => appendEvent(fs, root, now, event),
    reconcile: async (dispatchId) => reconcileEvents(fs, root, dispatchId),
    acknowledge: async (dispatchId, eventId) => acknowledge(fs, root, now, dispatchId, eventId)
  });
}

async function appendEvent(fs, root, now, input) {
  const event = normalizeEvent(input, now);
  const directory = eventDirectory(root, event.dispatch_id);
  await fs.mkdir(directory, { recursive: true });
  const filename = `${safeName(event.event_id)}.json`;
  const target = path.join(directory, filename);
  try {
    const existing = JSON.parse(await fs.readFile(target, 'utf8'));
    if (stableJson(existing) !== stableJson(event)) throw new Error(`completion inbox event conflict: ${event.event_id}`);
    return { event: existing, reused: true };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const temporary = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(event, null, 2)}\n`, { flag: 'wx' });
  try {
    await fs.link(temporary, target);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = JSON.parse(await fs.readFile(target, 'utf8'));
    if (stableJson(existing) !== stableJson(event)) throw new Error(`completion inbox event conflict: ${event.event_id}`);
    return { event: existing, reused: true };
  } finally {
    await fs.unlink(temporary).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
  return { event, reused: false };
}

async function reconcileEvents(fs, root, dispatchId) {
  requireText(dispatchId, 'dispatch_id');
  const directory = eventDirectory(root, dispatchId);
  let names;
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return { dispatch_id: dispatchId, events: [], latest: null, completion: null, partial_results: [] };
    throw error;
  }
  const events = [];
  for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
    const event = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
    if (event.dispatch_id !== dispatchId) throw new Error(`completion inbox dispatch mismatch: ${name}`);
    events.push(event);
  }
  events.sort((left, right) => left.observed_at.localeCompare(right.observed_at) || left.event_id.localeCompare(right.event_id));
  const completion = [...events].reverse().find((event) => ['completed', 'failed', 'cancelled'].includes(event.kind)) ?? null;
  return {
    dispatch_id: dispatchId,
    events,
    latest: events.at(-1) ?? null,
    completion,
    partial_results: events.filter((event) => event.kind === 'partial_result').map((event) => event.payload)
  };
}

async function acknowledge(fs, root, now, dispatchId, eventId) {
  requireText(dispatchId, 'dispatch_id');
  requireText(eventId, 'event_id');
  const directory = path.join(root, safeName(dispatchId), 'receipts');
  await fs.mkdir(directory, { recursive: true });
  const receipt = { dispatch_id: dispatchId, event_id: eventId, acknowledged_at: now().toISOString() };
  const target = path.join(directory, `${safeName(eventId)}.json`);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  try {
    await fs.link(temporary, target);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  } finally {
    await fs.unlink(temporary).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
  return receipt;
}

function normalizeEvent(input, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('completion inbox event must be an object');
  const dispatchId = requireText(input.dispatch_id, 'dispatch_id');
  const kind = requireText(input.kind, 'kind');
  if (!EVENT_KINDS.has(kind)) throw new TypeError(`unsupported completion inbox event kind: ${kind}`);
  const observedAt = input.observed_at ?? now().toISOString();
  if (Number.isNaN(Date.parse(observedAt))) throw new TypeError('observed_at must be an ISO timestamp');
  const payload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload) ? input.payload : {};
  validatePayload(kind, payload);
  const eventId = input.event_id ?? `event-${createHash('sha256').update(`${dispatchId}:${kind}:${observedAt}:${stableJson(payload)}`).digest('hex').slice(0, 24)}`;
  return {
    schema_version: '1.0.0',
    event_id: requireText(eventId, 'event_id'),
    dispatch_id: dispatchId,
    provider_run_id: input.provider_run_id ?? null,
    kind,
    observed_at: observedAt,
    checkpoint_id: input.checkpoint_id ?? null,
    surface_hash: input.surface_hash ?? null,
    payload
  };
}

function validatePayload(kind, payload) {
  assertAllowedKeys(payload, PAYLOAD_KEYS[kind], `${kind} payload`);
  if (payload.review_record !== undefined) {
    assertRecord(payload.review_record, 'review_record');
    assertAllowedKeys(payload.review_record, NESTED_KEYS.review_record, 'review_record');
    validateFindings(payload.review_record.findings);
  }
  validateFindings(payload.findings);
  if (payload.usage_accounting !== undefined) {
    assertRecord(payload.usage_accounting, 'usage_accounting');
    assertAllowedKeys(payload.usage_accounting, NESTED_KEYS.usage_accounting, 'usage_accounting');
  }
  const judgments = payload.judgments ?? (payload.judgment_id ? [payload] : []);
  if (!Array.isArray(judgments)) throw new TypeError('judgments must be an array');
  for (const judgment of judgments) {
    assertRecord(judgment, 'judgment');
    assertAllowedKeys(judgment, NESTED_KEYS.judgment, 'judgment');
    validateFindings(judgment.findings);
  }
}

function validateFindings(findings) {
  if (findings === undefined) return;
  if (!Array.isArray(findings)) throw new TypeError('findings must be an array');
  for (const finding of findings) {
    assertRecord(finding, 'finding');
    assertAllowedKeys(finding, NESTED_KEYS.finding, 'finding');
  }
}

function assertRecord(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
}

function assertAllowedKeys(value, allowed, name) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new TypeError(`${name} contains unsupported fields: ${unknown.join(', ')}`);
}

function eventDirectory(root, dispatchId) {
  return path.join(root, safeName(requireText(dispatchId, 'dispatch_id')), 'events');
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value.trim();
}
