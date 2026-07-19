import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const HUMAN_DECISION_SCHEMA_VERSION = '0.1.0';
export const HUMAN_DECISION_TYPES = new Set([
  'clarification', 'scope_split', 'waiver_request', 'external_side_effect', 'security_boundary'
]);

export class HumanDecisionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'HumanDecisionError';
    this.code = code;
    this.details = details;
  }
}

export async function createHumanDecision(repoRoot, state, input, options = {}) {
  validateInput(input);
  const now = toIso(options.now?.() ?? new Date());
  const fingerprint = createHash('sha256').update(JSON.stringify({
    head_sha: state.current_head_sha,
    type: input.type,
    material_reason: input.material_reason,
    impact_scope: [...input.impact_scope].sort(),
    source_refs: [...(input.source_refs ?? [])].sort()
  })).digest('hex');
  const directory = decisionDirectory(repoRoot, state.story_id, state.run_id);
  await mkdir(directory, { recursive: true });
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.json') || name === 'index.json') continue;
    const existing = await readDecisionArtifact(path.join(directory, name));
    if (existing.fingerprint === fingerprint) {
      await writeIndex(directory);
      return existing;
    }
  }
  const decisionId = `decision-${fingerprint.slice(0, 16)}`;
  const artifact = {
    schema_version: HUMAN_DECISION_SCHEMA_VERSION,
    decision_id: decisionId,
    story_id: state.story_id,
    run_id: state.run_id,
    head_sha: state.current_head_sha,
    status: 'pending',
    type: input.type,
    question: input.question.trim(),
    choices: input.choices ?? [],
    material_reason: input.material_reason.trim(),
    impact_scope: input.impact_scope,
    source_refs: input.source_refs ?? [],
    brainbase_handoff_ref: input.brainbase_handoff_ref ?? null,
    critical_gate: input.critical_gate === true,
    requested_at: now,
    answer: null,
    answered_by: null,
    answered_at: null,
    reflected_in: [],
    fingerprint
  };
  await writeJsonAtomic(path.join(directory, `${decisionId}.json`), artifact);
  await writeIndex(directory);
  return artifact;
}

export async function resolveHumanDecision(repoRoot, state, input, options = {}) {
  if (state.status === 'cancelled') throw error('cancelled_run', 'A cancelled Run cannot accept a decision answer.');
  if (!/^decision-[0-9a-f]{16}$/.test(input.decisionId ?? '') || typeof input.answer !== 'string' || !input.answer.trim()) {
    throw error('decision_answer_required', 'Decision id and non-empty answer are required.');
  }
  if (Buffer.byteLength(JSON.stringify(input)) > 16384) throw error('invalid_decision', 'Human decision answer exceeds 16384 bytes.');
  const directory = decisionDirectory(repoRoot, state.story_id, state.run_id);
  const file = path.join(directory, `${input.decisionId}.json`);
  let artifact;
  try {
    artifact = await readDecisionArtifact(file);
  } catch (cause) {
    if (cause instanceof HumanDecisionError) throw cause;
    throw error('decision_not_found', `Human decision was not found: ${input.decisionId}.`, { cause: cause.code });
  }
  if (artifact.run_id !== state.run_id || artifact.story_id !== state.story_id) throw error('decision_run_mismatch', 'Decision belongs to another Run.');
  if (artifact.head_sha !== state.current_head_sha) throw error('stale_decision_head', 'Decision was recorded for another HEAD.');
  if (artifact.status !== 'pending') {
    if (options.allowResolvedReplay === true
        && artifact.status === 'resolved'
        && artifact.answer === input.answer.trim()
        && state.pending_decision?.decision_id === artifact.decision_id) {
      await writeIndex(directory);
      return artifact;
    }
    throw error('decision_already_resolved', 'Decision is already resolved.');
  }
  if (artifact.type === 'waiver_request' && artifact.critical_gate) {
    throw error('critical_gate_waiver_forbidden', 'Critical gates require evidence, split, or block; they cannot be waived.');
  }
  const resolved = {
    ...artifact,
    status: 'resolved',
    answer: input.answer.trim(),
    answered_by: input.answeredBy?.trim() || 'operator',
    answered_at: toIso(options.now?.() ?? new Date()),
    reflected_in: input.reflectedIn ?? []
  };
  await writeJsonAtomic(file, resolved);
  await writeIndex(directory);
  return resolved;
}

function validateInput(input) {
  if (!input || !HUMAN_DECISION_TYPES.has(input.type)) throw error('invalid_decision_type', `Unknown human decision type: ${input?.type ?? 'missing'}.`);
  if (typeof input.question !== 'string' || !input.question.trim()) throw error('invalid_decision', 'Human decision requires a question.');
  if (typeof input.material_reason !== 'string' || !input.material_reason.trim()) throw error('invalid_decision', 'Human decision requires a material reason.');
  if (!Array.isArray(input.impact_scope) || input.impact_scope.length === 0 || input.impact_scope.some((item) => typeof item !== 'string')) {
    throw error('invalid_decision', 'Human decision requires a non-empty impact scope.');
  }
  if (Buffer.byteLength(JSON.stringify(input)) > 16384) throw error('invalid_decision', 'Human decision input exceeds 16384 bytes.');
}

function decisionDirectory(repoRoot, storyId, runId) {
  return path.join(repoRoot, '.vibepro', 'executions', storyId, 'runs', runId, 'decisions');
}

async function writeIndex(directory) {
  const decisions = [];
  for (const name of await readdir(directory)) {
    if (!name.startsWith('decision-') || !name.endsWith('.json')) continue;
    const item = await readDecisionArtifact(path.join(directory, name));
    decisions.push({ decision_id: item.decision_id, type: item.type, status: item.status, head_sha: item.head_sha, reflected_in: item.reflected_in });
  }
  decisions.sort((a, b) => a.decision_id.localeCompare(b.decision_id));
  await writeJsonAtomic(path.join(directory, 'index.json'), { schema_version: HUMAN_DECISION_SCHEMA_VERSION, decisions });
}

async function readDecisionArtifact(file) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (cause) {
    throw cause;
  }
  try {
    return JSON.parse(raw);
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause;
    throw error('invalid_decision_artifact', 'Human decision artifact contains malformed JSON.', {
      artifact: file,
      cause: cause.message
    });
  }
}

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw error('invalid_timestamp', 'Human decision timestamp is invalid.');
  return date.toISOString();
}

function error(code, message, details = {}) {
  return new HumanDecisionError(code, message, details);
}
