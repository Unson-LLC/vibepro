import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const EVENT_KINDS = new Set(['progress', 'partial_result', 'completed', 'failed', 'cancelled']);

export function createAgentCompletionInbox({ repoRoot, now = () => new Date(), io = {} } = {}) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) throw new TypeError('repoRoot is required');
  const fs = { mkdir, readFile, readdir, rename, writeFile, ...io };
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
    await fs.rename(temporary, target);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = JSON.parse(await fs.readFile(target, 'utf8'));
    if (stableJson(existing) !== stableJson(event)) throw new Error(`completion inbox event conflict: ${event.event_id}`);
    return { event: existing, reused: true };
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
  await fs.rename(temporary, target);
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
