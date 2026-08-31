import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { resolvePrArtifactFile } from './artifact-routing.js';
import { collectGitContext, compareFingerprintContexts } from './git-fingerprint.js';
import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

const execFileAsync = promisify(execFile);

const CONTEXT_SCHEMA = 'vibepro-brainbase-context.v1';
const HANDOFF_SCHEMA = 'brainbase-vibepro-context-handoff.v1';
const EVENT_SCHEMA = 'knowledge_event.v1';
const EVENT_PAYLOAD_SCHEMA = 'vibepro-development-learning.v1';
const ALLOWED_KNOWLEDGE_TYPES = new Set(['canonical_fact', 'team_document', 'source_document']);
const ROUTE_CONTRACTS = new Map([
  ['canonical_fact', { sourceClass: 'graph', retrievalCapability: 'graph.search' }],
  ['team_document', { sourceClass: 'owning_repo', retrievalCapability: 'repository.read' }],
  ['source_document', { sourceClass: 'team_drive', retrievalCapability: 'drive.read' }]
]);
const PASS_STATUSES = new Set(['pass', 'passed', 'success', 'ok']);
const COMPUTED_EVIDENCE_SOURCES = new Set(['runner_direct', 'ci_import', 'autopilot_run']);
const SENSITIVE_CONTENT = [
  /\b(?:api[_-]?key|password|passwd|secret|token)\s*[:=]\s*\S+/iu,
  /\bsk-[a-z0-9_-]{8,}\b/iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu
];

function compareCodePoints(left, right) {
  const a = Array.from(left, (value) => value.codePointAt(0));
  const b = Array.from(right, (value) => value.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON only supports finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort(compareCodePoints).map((key) => {
      if (value[key] === undefined) throw new TypeError('canonical JSON does not support undefined');
      return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
    }).join(',')}}`;
  }
  throw new TypeError(`canonical JSON does not support ${typeof value}`);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${name} contains control characters`);
  return value.trim();
}

function safeIdentifier(value, name) {
  const normalized = requiredString(value, name);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(normalized)) {
    throw new Error(`${name} must contain only letters, numbers, dot, underscore, or hyphen`);
  }
  return normalized;
}

function sha256Field(value, name) {
  const normalized = requiredString(value, name);
  if (!/^[a-f0-9]{64}$/u.test(normalized)) throw new Error(`${name} must be a lowercase SHA-256 digest`);
  return normalized;
}

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value;
}

function stringArray(value, name, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`${name} must be an array`);
  const output = value.map((entry, index) => requiredString(entry, `${name}[${index}]`));
  if (new Set(output).size !== output.length) throw new Error(`${name} must not contain duplicates`);
  return output;
}

function isSensitive(value) {
  return SENSITIVE_CONTENT.some((pattern) => pattern.test(value));
}

function contextPath(repoRoot, storyId) {
  return path.join(getWorkspaceDir(repoRoot), 'integrations', 'brainbase', safeIdentifier(storyId, 'story_id'), 'context.json');
}

function eventPath(repoRoot, storyId) {
  return path.join(getWorkspaceDir(repoRoot), 'integrations', 'brainbase', safeIdentifier(storyId, 'story_id'), 'knowledge-event.json');
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${label} not found: ${filePath}`);
    if (error instanceof SyntaxError) throw new Error(`${label} is invalid JSON: ${filePath}`);
    throw error;
  }
}

function validateJudgmentReceipt(receipt, projectCode) {
  object(receipt, 'episode.initial_route_receipt');
  requiredString(receipt.resolution_id, 'judgment.resolution_id');
  requiredString(receipt.turn_id, 'judgment.turn_id');
  sha256Field(receipt.request_digest, 'judgment.request_digest');
  sha256Field(receipt.plan_digest, 'judgment.plan_digest');
  sha256Field(receipt.manifest_digest, 'judgment.manifest_digest');
  requiredString(receipt.runtime_version, 'judgment.runtime_version');
  if (receipt.status !== 'resolved') throw new Error('Brainbase judgment must be resolved before VibePro binds it');
  if (receipt.autonomy_decision !== 'continue') throw new Error('Brainbase judgment must allow continue before VibePro binds it');
  if (receipt.project_code !== projectCode) throw new Error('Brainbase judgment project_code does not match the handoff');
  const hostBinding = object(receipt.host_binding, 'judgment.host_binding');
  if (hostBinding.status !== 'managed' || hostBinding.enforcement_level !== 'host_contract') {
    throw new Error('Brainbase judgment requires a managed host binding');
  }
  const unresolved = stringArray(receipt.unresolved ?? [], 'judgment.unresolved');
  if (unresolved.length > 0) throw new Error('Brainbase judgment has unresolved items');
  const selectedDagIds = stringArray(receipt.selected_dag_ids, 'judgment.selected_dag_ids', { allowEmpty: false });
  const activeNodes = stringArray(receipt.active_nodes, 'judgment.active_nodes', { allowEmpty: false });
  const policies = Array.isArray(receipt.applicable_policies) ? receipt.applicable_policies : [];
  const requiredCapabilities = Array.isArray(receipt.required_capabilities) ? receipt.required_capabilities : [];
  return {
    selectedDagIds,
    activeNodes,
    policyIds: policies.map((policy, index) => requiredString(object(policy, `judgment.applicable_policies[${index}]`).id, `judgment.applicable_policies[${index}].id`)),
    requiredCapabilities
  };
}

function knowledgeCapabilityInput(value, name) {
  const capability = object(value, name);
  if (capability.capability !== 'knowledge.resolve' || capability.status !== 'required' || capability.receipt_required !== true) {
    throw new Error(`${name} is not a required knowledge.resolve capability`);
  }
  const input = object(capability.input, `${name}.input`);
  const projectCode = requiredString(input.project_code, `${name}.input.project_code`);
  if (input.intent !== 'lookup') throw new Error(`${name}.input.intent must be lookup`);
  if (!['team', 'organization'].includes(input.audience)) {
    throw new Error(`${name} cannot persist personal knowledge in a VibePro repository context`);
  }
  if (!ALLOWED_KNOWLEDGE_TYPES.has(input.content_type)) {
    throw new Error(`${name}.input.content_type is not supported by the stable project knowledge integration`);
  }
  return {
    intent: 'lookup',
    audience: input.audience,
    content_type: input.content_type,
    project_code: projectCode
  };
}

function validateReference(value, expectedRoute, name) {
  const reference = object(value, name);
  if (reference.source_class !== expectedRoute.sourceClass) throw new Error(`${name}.source_class does not match the routing receipt`);
  if (reference.retrieval_capability !== expectedRoute.retrievalCapability) {
    throw new Error(`${name}.retrieval_capability does not match the routing receipt`);
  }
  const sourceRef = requiredString(reference.source_ref, `${name}.source_ref`);
  if (!/^(?:brainbase|graph|repo|github|drive|https):\/\//u.test(sourceRef) || /^file:\/\//u.test(sourceRef)) {
    throw new Error(`${name}.source_ref must be a non-local canonical URI`);
  }
  const contentDigest = sha256Field(reference.content_digest, `${name}.content_digest`);
  const title = reference.title === undefined ? null : requiredString(reference.title, `${name}.title`);
  return {
    source_class: expectedRoute.sourceClass,
    retrieval_capability: expectedRoute.retrievalCapability,
    source_ref: sourceRef,
    content_digest: contentDigest,
    ...(title ? { title } : {})
  };
}

function validateKnowledgeEntry(value, expectedInput, name) {
  const entry = object(value, name);
  const capabilityInput = object(entry.capability_input, `${name}.capability_input`);
  if (canonicalJson(capabilityInput) !== canonicalJson(expectedInput)) {
    throw new Error(`${name}.capability_input does not match the required Brainbase capability`);
  }
  const receipt = object(entry.routing_receipt, `${name}.routing_receipt`);
  requiredString(receipt.resolution_id, `${name}.routing_receipt.resolution_id`);
  if (receipt.status !== 'resolved') throw new Error(`${name}.routing_receipt must be resolved`);
  if (receipt.project_code !== expectedInput.project_code) throw new Error(`${name}.routing_receipt.project_code does not match`);
  if (receipt.content_type !== expectedInput.content_type) throw new Error(`${name}.routing_receipt.content_type does not match`);
  const expectedRoute = ROUTE_CONTRACTS.get(expectedInput.content_type);
  if (receipt.source_class !== expectedRoute.sourceClass || receipt.retrieval_capability !== expectedRoute.retrievalCapability) {
    throw new Error(`${name}.routing_receipt does not match the canonical Brainbase route`);
  }
  object(receipt.canonical_location, `${name}.routing_receipt.canonical_location`);
  if (!Array.isArray(entry.references) || entry.references.length === 0) {
    throw new Error(`${name}.references must contain actual retrieval references; a routing receipt alone is not knowledge retrieval`);
  }
  const references = entry.references.map((reference, index) => validateReference(reference, expectedRoute, `${name}.references[${index}]`));
  return {
    capability_input: expectedInput,
    routing: {
      resolution_id: receipt.resolution_id,
      source_class: expectedRoute.sourceClass,
      canonical_location: receipt.canonical_location,
      retrieval_capability: expectedRoute.retrievalCapability,
      confidence: Number.isFinite(receipt.confidence) ? receipt.confidence : null
    },
    references
  };
}

function validateHandoff(raw, storyId) {
  const handoff = object(raw, 'Brainbase handoff');
  if (handoff.schema_version !== HANDOFF_SCHEMA) throw new Error(`handoff.schema_version must be ${HANDOFF_SCHEMA}`);
  if (handoff.story_id !== storyId) throw new Error('handoff.story_id does not match --id');
  const projectCode = safeIdentifier(handoff.project_code, 'handoff.project_code');
  const episode = object(handoff.episode, 'handoff.episode');
  if (episode.schema_version !== 'brainbase-judgment-episode-v1') {
    throw new Error('handoff.episode.schema_version must be brainbase-judgment-episode-v1');
  }
  const episodeId = requiredString(episode.episode_id, 'handoff.episode.episode_id');
  const receipt = object(episode.initial_route_receipt, 'handoff.episode.initial_route_receipt');
  const receiptDigest = sha256(canonicalJson(receipt));
  if (sha256Field(episode.initial_route_receipt_digest, 'handoff.episode.initial_route_receipt_digest') !== receiptDigest) {
    throw new Error('handoff.episode.initial_route_receipt_digest does not match the receipt');
  }
  const judgment = validateJudgmentReceipt(receipt, projectCode);
  const requiredKnowledge = judgment.requiredCapabilities
    .filter((capability) => capability?.capability === 'knowledge.resolve')
    .map((capability, index) => knowledgeCapabilityInput(capability, `judgment.required_capabilities[${index}]`));
  const providedKnowledge = Array.isArray(handoff.knowledge) ? handoff.knowledge : [];
  const consumed = new Set();
  const knowledge = requiredKnowledge.map((expectedInput) => {
    const matchIndex = providedKnowledge.findIndex((entry, candidateIndex) => (
      !consumed.has(candidateIndex)
      && canonicalJson(entry?.capability_input) === canonicalJson(expectedInput)
    ));
    if (matchIndex < 0) throw new Error(`required knowledge.resolve capability has no handoff entry: ${canonicalJson(expectedInput)}`);
    consumed.add(matchIndex);
    return validateKnowledgeEntry(providedKnowledge[matchIndex], expectedInput, `handoff.knowledge[${matchIndex}]`);
  });
  if (providedKnowledge.length !== consumed.size) {
    throw new Error('handoff.knowledge contains entries that were not required by the Brainbase judgment receipt');
  }
  return { handoff, projectCode, episodeId, receipt, receiptDigest, judgment, knowledge };
}

export async function bindBrainbaseContext(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = safeIdentifier(options.storyId, 'story_id');
  const inputPath = path.resolve(root, requiredString(options.input, 'input'));
  const raw = await readJson(inputPath, 'Brainbase handoff');
  const validated = validateHandoff(raw, storyId);
  const stableProjection = {
    schema_version: CONTEXT_SCHEMA,
    story_id: storyId,
    project_code: validated.projectCode,
    source: {
      handoff_digest: sha256(canonicalJson(validated.handoff))
    },
    judgment: {
      authority: 'brainbase',
      snapshot_not_authority: true,
      episode_id: validated.episodeId,
      resolution_id: validated.receipt.resolution_id,
      turn_id: validated.receipt.turn_id,
      receipt_digest: validated.receiptDigest,
      plan_digest: validated.receipt.plan_digest,
      runtime_version: validated.receipt.runtime_version,
      manifest_digest: validated.receipt.manifest_digest,
      autonomy_decision: validated.receipt.autonomy_decision,
      selected_dag_ids: validated.judgment.selectedDagIds,
      applicable_policy_ids: validated.judgment.policyIds,
      active_node_ids: validated.judgment.activeNodes
    },
    knowledge: validated.knowledge
  };
  const context = {
    ...stableProjection,
    context_digest: sha256(canonicalJson(stableProjection)),
    bound_at: (options.now ?? (() => new Date()))().toISOString()
  };
  const outputPath = contextPath(root, storyId);
  await writeJsonAtomic(outputPath, context);
  return {
    status: 'bound',
    story_id: storyId,
    project_code: context.project_code,
    context_digest: context.context_digest,
    knowledge_reference_count: context.knowledge.reduce((count, entry) => count + entry.references.length, 0),
    artifact: toWorkspaceRelative(root, outputPath)
  };
}

function passingVerificationCommands(evidence, context, gitContext) {
  const commands = Array.isArray(evidence?.commands) ? evidence.commands : [];
  const boundAt = Date.parse(context.bound_at);
  if (!Number.isFinite(boundAt)) throw new Error('Brainbase context bound_at is invalid');
  return commands.filter((command) => {
    if (!PASS_STATUSES.has(String(command?.status || '').toLowerCase())) return false;
    if (!COMPUTED_EVIDENCE_SOURCES.has(command?.evidence_source)) return false;
    const executedAt = Date.parse(command?.executed_at);
    if (!Number.isFinite(executedAt) || executedAt < boundAt) return false;
    if (!command.git_context || command.git_context.head_sha !== gitContext.head_sha) return false;
    return compareFingerprintContexts(command.git_context, gitContext).matches;
  });
}

async function repositoryIdentity(repoRoot) {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot, encoding: 'utf8' });
    const value = stdout.trim();
    const ssh = value.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/u);
    const https = value.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/u);
    const slug = ssh?.[1] || https?.[1];
    if (slug) return `github://${slug}`;
  } catch {
    // Fall through to a repository-local non-absolute identity.
  }
  return `repo://${path.basename(repoRoot)}`;
}

export async function createBrainbaseKnowledgeEvent(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = safeIdentifier(options.storyId, 'story_id');
  const summary = requiredString(options.summary, 'summary');
  if (summary.length > 2000) throw new Error('summary must be 2000 characters or fewer');
  if (isSensitive(summary)) throw new Error('summary contains sensitive content and cannot be emitted as a Knowledge Event');

  const context = await readJson(contextPath(root, storyId), 'Brainbase context');
  if (context.schema_version !== CONTEXT_SCHEMA || context.story_id !== storyId) {
    throw new Error('Brainbase context is invalid or belongs to another Story');
  }
  const stableProjection = { ...context };
  delete stableProjection.context_digest;
  delete stableProjection.bound_at;
  if (sha256(canonicalJson(stableProjection)) !== context.context_digest) {
    throw new Error('Brainbase context digest does not match its content');
  }

  const gitContext = await collectGitContext(root);
  if (!/^[a-f0-9]{40}$/u.test(String(gitContext.head_sha || ''))) {
    throw new Error('a committed Git HEAD is required to generate a Brainbase Knowledge Event');
  }
  const verificationPath = await resolvePrArtifactFile(root, storyId, 'verification-evidence.json');
  const verificationBytes = await readFile(verificationPath, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') throw new Error(`verification evidence not found for ${storyId}`);
    throw error;
  });
  let verification;
  try {
    verification = JSON.parse(verificationBytes);
  } catch {
    throw new Error(`verification evidence is invalid JSON: ${verificationPath}`);
  }
  if (verification.story_id !== storyId) throw new Error('verification evidence belongs to another Story');
  const passingCommands = passingVerificationCommands(verification, context, gitContext);
  if (passingCommands.length === 0) {
    throw new Error('Knowledge Event generation requires computed passing verification evidence recorded after the Brainbase context binding and matching the current git state');
  }

  const repositoryRef = options.repositoryRef ?? await repositoryIdentity(root);
  const sourceRef = `${repositoryRef}@${gitContext.head_sha}#${storyId}`;
  const verificationEvidence = {
    artifact_digest: sha256(verificationBytes),
    head_sha: gitContext.head_sha,
    passing_kinds: [...new Set(passingCommands.map((command) => requiredString(command.kind, 'verification.kind')))].sort(),
    evidence_sources: [...new Set(passingCommands.map((command) => command.evidence_source))].sort()
  };
  const payload = {
    schema_version: EVENT_PAYLOAD_SCHEMA,
    story_id: storyId,
    summary,
    context_digest: context.context_digest,
    verification_evidence: verificationEvidence,
    knowledge_reference_count: context.knowledge.reduce((count, entry) => count + entry.references.length, 0)
  };
  const bodyHash = sha256(canonicalJson(payload));
  const subjectId = `vibepro:${storyId}:${gitContext.head_sha}`;
  const parentEpisodeId = requiredString(context.judgment?.episode_id, 'context.judgment.episode_id');
  const eventId = `kev_${sha256(canonicalJson([
    EVENT_PAYLOAD_SCHEMA,
    sourceRef,
    subjectId,
    parentEpisodeId,
    bodyHash
  ]))}`;
  const occurredAt = passingCommands
    .map((command) => command.executed_at)
    .sort()
    .at(-1);
  const requestedCapturedAt = (options.now ?? (() => new Date()))();
  const capturedAt = requestedCapturedAt.valueOf() < Date.parse(occurredAt)
    ? occurredAt
    : requestedCapturedAt.toISOString();
  const event = {
    schema_version: EVENT_SCHEMA,
    event_id: eventId,
    occurred_at: occurredAt,
    captured_at: capturedAt,
    source: { type: 'vibepro', ref: sourceRef },
    subject: { type: 'development_learning', id: subjectId },
    decision_authority: {
      kind: 'development_learning_candidate',
      authorized: false,
      graph_promotion_allowed: false
    },
    applicability_scope: {
      scope: 'project',
      project_code: context.project_code
    },
    permission_snapshot: {
      knowledge_registration: true,
      external_action: false,
      graph_promotion: false,
      visibility: 'team',
      sensitivity: 'internal'
    },
    source_pointer: {
      uri: `vibepro://${repositoryRef.replace(/^[a-z]+:\/\//u, '')}/${encodeURIComponent(storyId)}?sha=${gitContext.head_sha}`
    },
    body_hash: bodyHash,
    parent_episode_id: parentEpisodeId,
    payload
  };
  const outputPath = eventPath(root, storyId);
  await writeJsonAtomic(outputPath, event);
  return {
    status: 'generated',
    story_id: storyId,
    project_code: context.project_code,
    event_id: event.event_id,
    body_hash: event.body_hash,
    artifact: toWorkspaceRelative(root, outputPath)
  };
}

export function renderBrainbaseContextBinding(result) {
  return `Brainbase context bound: ${result.story_id} (${result.knowledge_reference_count} knowledge references) -> ${result.artifact}\n`;
}

export function renderBrainbaseKnowledgeEvent(result) {
  return `Brainbase Knowledge Event generated: ${result.event_id} -> ${result.artifact}\n`;
}
