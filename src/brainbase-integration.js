import { execFile } from 'node:child_process';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { resolvePrArtifactFile } from './artifact-routing.js';
import { collectGitContext, compareFingerprintContexts } from './git-fingerprint.js';
import { bindStoryTraceability } from './traceability.js';
import { getWorkspaceDir, initWorkspace, toWorkspaceRelative } from './workspace.js';

const execFileAsync = promisify(execFile);

const CONTEXT_SCHEMA = 'vibepro-brainbase-context.v1';
const CONTEXT_V2_SCHEMA = 'vibepro-brainbase-context.v2';
// Only the formal `story add` workflow may declare a previously absent Story
// as part of the managed v2 publication.  This unexported capability prevents
// the ordinary bind APIs from turning arbitrary caller options into a Story
// creation authority.
const STORY_ADD_DECLARATION_CAPABILITY = Symbol('story-add-declaration');
const HANDOFF_SCHEMA = 'brainbase-vibepro-context-handoff.v1';
const HANDOFF_V2_SCHEMA = 'brainbase-vibepro-context-handoff.v2';
const MANAGED_HANDOFF_SCHEMA = 'brainbase-vibepro-managed-handoff.v1';
const MANAGED_HANDOFF_V2_SCHEMA = 'brainbase-vibepro-managed-handoff.v2';
const EVENT_SCHEMA = 'knowledge_event.v1';
const EVENT_PAYLOAD_SCHEMA = 'vibepro-development-learning.v1';
const OUTBOX_SCHEMA = 'vibepro-brainbase-outbox.v1';
const BIND_RECEIPT_SCHEMA = 'vibepro-brainbase-bind-receipt.v1';
const HANDOFF_LEDGER_SCHEMA = 'vibepro-brainbase-handoff-consumption-ledger.v1';
const BIND_PUBLICATION_SCHEMA = 'vibepro-brainbase-bind-publication.v1';
const DEFAULT_HANDOFF_HMAC_KEY_ID = 'brainbase-vibepro-handoff-hmac-v1';
const MANAGED_HANDOFF_PAYLOAD_FIELDS = [
  'schema_version',
  'repository',
  'repository_root',
  'project_code',
  'base_sha',
  'issued_at',
  'expires_at',
  'turn_id',
  'resolution_id',
  'story_id',
  'authorized',
  'graph_promotion_allowed'
];
const MANAGED_HANDOFF_V2_PAYLOAD_FIELDS = [...MANAGED_HANDOFF_PAYLOAD_FIELDS, 'outcome_case'];
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

export const BRAINBASE_HANDOFF_INBOX_DIR = '.vibepro/integrations/brainbase/inbox';
export const BRAINBASE_OUTBOX_DIR = '.vibepro/integrations/brainbase/outbox';
export const BRAINBASE_HANDOFF_LEDGER_FILE = '.vibepro/integrations/brainbase/handoff-consumption-ledger.json';
export const BRAINBASE_HANDOFF_HMAC_SECRET_ENV = 'BRAINBASE_VIBEPRO_HANDOFF_HMAC_SECRET';
export const BRAINBASE_HANDOFF_HMAC_KEY_ID_ENV = 'BRAINBASE_VIBEPRO_HANDOFF_HMAC_KEY_ID';

/**
 * Brainbase signs exactly this payload. Integrity fields are deliberately not
 * included: receipt_digest and signature authenticate this canonical value.
 */
export function canonicalManagedHandoffPayload(receipt) {
  const schema = receipt?.schema_version;
  const fields = schema === MANAGED_HANDOFF_V2_SCHEMA
    ? MANAGED_HANDOFF_V2_PAYLOAD_FIELDS
    : MANAGED_HANDOFF_PAYLOAD_FIELDS;
  return canonicalJson([
    schema === MANAGED_HANDOFF_V2_SCHEMA ? MANAGED_HANDOFF_V2_SCHEMA : MANAGED_HANDOFF_SCHEMA,
    Object.fromEntries(fields.map((field) => [field, receipt?.[field]]))
  ]);
}

function isManagedHandoffSchema(value) {
  return value === MANAGED_HANDOFF_SCHEMA || value === MANAGED_HANDOFF_V2_SCHEMA;
}

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

function canonicalExternalReference(value, name) {
  const normalized = requiredString(value, name);
  if (!/^[a-z][a-z0-9+.-]*:\/\/[^\s]+$/iu.test(normalized)
      || /^file:\/\//iu.test(normalized)
      || /^(?:https?|ssh):\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?:[/:]|$)/iu.test(normalized)) {
    throw new Error(`${name} must be a non-local canonical URI`);
  }
  return normalized;
}

function brainbaseReference(value, name, expectedPath) {
  const normalized = canonicalExternalReference(value, name);
  const match = normalized.match(/^brainbase:\/\/([^/]+)\/([A-Za-z0-9][A-Za-z0-9._:-]{0,199})(?:\/receipt)?$/u);
  if (!match) throw new Error(`${name} must be a canonical Brainbase reference`);
  if (expectedPath && normalized !== expectedPath) throw new Error(`${name} does not identify the signed outcome case`);
  return normalized;
}

function validateOutcomeCase(raw, { name = 'handoff', expectedJudgmentReceiptId = null } = {}) {
  object(raw, name);
  const technicalAcceptance = raw.technical_acceptance;
  if (!Array.isArray(technicalAcceptance) || technicalAcceptance.length === 0) {
    throw new Error(`${name}.technical_acceptance must be a nonempty array`);
  }
  const acceptanceIds = new Set();
  const normalizedAcceptance = technicalAcceptance.map((entry, index) => {
    const acceptance = object(entry, `${name}.technical_acceptance[${index}]`);
    const id = safeIdentifier(acceptance.id, `${name}.technical_acceptance[${index}].id`);
    if (acceptanceIds.has(id)) throw new Error(`${name}.technical_acceptance must not contain duplicate ids`);
    acceptanceIds.add(id);
    return {
      id,
      criterion: requiredString(acceptance.criterion, `${name}.technical_acceptance[${index}].criterion`)
    };
  });
  const productionProbe = object(raw.production_probe, `${name}.production_probe`);
  const caseId = safeIdentifier(raw.case_id, `${name}.case_id`);
  const probeId = safeIdentifier(productionProbe.id, `${name}.production_probe.id`);
  return {
    case_id: caseId,
    outcome_case_ref: brainbaseReference(raw.outcome_case_ref, `${name}.outcome_case_ref`, `brainbase://outcome-cases/${caseId}`),
    judgment_receipt_ref: brainbaseReference(raw.judgment_receipt_ref, `${name}.judgment_receipt_ref`, expectedJudgmentReceiptId ? `brainbase://judgment-receipts/${expectedJudgmentReceiptId}` : null),
    decision_digest: sha256Field(raw.decision_digest, `${name}.decision_digest`),
    user_observable_outcome: requiredString(raw.user_observable_outcome, `${name}.user_observable_outcome`),
    technical_acceptance: normalizedAcceptance,
    production_probe: {
      id: probeId,
      procedure: requiredString(productionProbe.procedure, `${name}.production_probe.procedure`),
      terminal_receipt_target: brainbaseReference(
        productionProbe.terminal_receipt_target,
        `${name}.production_probe.terminal_receipt_target`,
        `brainbase://production-probes/${probeId}/receipt`
      )
    }
  };
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

function bindReceiptPath(repoRoot, storyId) {
  return path.join(getWorkspaceDir(repoRoot), 'integrations', 'brainbase', safeIdentifier(storyId, 'story_id'), 'bind-receipt.json');
}

function outboxPath(repoRoot, eventId) {
  return path.join(getWorkspaceDir(repoRoot), 'integrations', 'brainbase', 'outbox', `${safeIdentifier(eventId, 'event_id')}.json`);
}

function handoffLedgerPath(repoRoot) {
  return path.join(getWorkspaceDir(repoRoot), 'integrations', 'brainbase', 'handoff-consumption-ledger.json');
}

function bindPublicationJournalPath(repoRoot, storyId) {
  return path.join(getWorkspaceDir(repoRoot), 'integrations', 'brainbase', 'publications', `${safeIdentifier(storyId, 'story_id')}.json`);
}

function bindCommitMarkerPath(repoRoot, storyId) {
  return path.join(getWorkspaceDir(repoRoot), 'integrations', 'brainbase', safeIdentifier(storyId, 'story_id'), 'bind-commit.json');
}

function defaultInboxCandidates(repoRoot) {
  const workspace = getWorkspaceDir(repoRoot);
  return [
    path.join(workspace, 'integrations', 'brainbase', 'inbox'),
    path.join(workspace, 'integrations', 'brainbase', 'handoff-inbox'),
    path.join(workspace, 'brainbase', 'inbox'),
    path.join(workspace, 'brainbase', 'handoff-inbox'),
    path.join(workspace, 'integrations', 'brainbase', 'handoff.json'),
    path.join(workspace, 'brainbase', 'handoff.json')
  ];
}

function configuredInboxCandidates(repoRoot, config = {}) {
  const brainbase = config?.brainbase ?? {};
  const integration = brainbase.integration ?? {};
  const values = [
    brainbase.handoff_inbox,
    brainbase.managed_handoff_inbox,
    brainbase.inbox,
    integration.handoff_inbox,
    integration.managed_handoff_inbox,
    integration.inbox
  ].filter((value) => typeof value === 'string' && value.trim());
  return values.map((value) => path.isAbsolute(value)
    ? path.normalize(value)
    : path.resolve(repoRoot, value));
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function discoverJsonFiles(candidate, depth = 0) {
  if (!(await pathExists(candidate))) return [];
  const details = await stat(candidate);
  if (details.isFile()) return candidate.toLowerCase().endsWith('.json') ? [candidate] : [];
  if (!details.isDirectory() || depth > 2) return [];
  const entries = await readdir(candidate, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.join(candidate, entry.name);
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) files.push(child);
    else if (entry.isDirectory()) files.push(...await discoverJsonFiles(child, depth + 1));
  }
  return files;
}

async function discoverManagedHandoffFiles(repoRoot, config = {}) {
  const candidates = [...defaultInboxCandidates(repoRoot), ...configuredInboxCandidates(repoRoot, config)];
  const seen = new Set();
  const files = [];
  for (const candidate of candidates) {
    const normalized = path.normalize(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (!(await pathExists(normalized))) continue;
    const confined = await confinedRepositoryPath(repoRoot, normalized, 'managed Brainbase handoff inbox');
    files.push(...await discoverJsonFiles(confined));
  }
  return [...new Set(files)].sort();
}

function isManagedBrainbaseConfig(config = {}) {
  const brainbase = config?.brainbase ?? {};
  const integration = brainbase.integration ?? {};
  return brainbase.managed === true
    || brainbase.managed_integration === true
    || brainbase.management === 'managed'
    || brainbase.handoff_mode === 'managed'
    || brainbase.mode === 'managed'
    || integration.managed === true
    || integration.mode === 'managed';
}

function expectedBrainbaseProjectCode(config = {}) {
  const brainbase = config?.brainbase ?? {};
  const integration = brainbase.integration ?? {};
  return brainbase.project_code ?? brainbase.projectCode ?? integration.project_code ?? integration.projectCode ?? null;
}

function expectedBrainbaseRepository(config = {}) {
  const brainbase = config?.brainbase ?? {};
  const integration = brainbase.integration ?? {};
  return brainbase.repository ?? brainbase.repository_ref ?? integration.repository ?? integration.repository_ref ?? null;
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
  const autonomyPolicyIds = receipt.autonomy_policy_ids === undefined
    ? []
    : stringArray(receipt.autonomy_policy_ids, 'judgment.autonomy_policy_ids');
  const policies = Array.isArray(receipt.applicable_policies) ? receipt.applicable_policies : [];
  const requiredCapabilities = Array.isArray(receipt.required_capabilities) ? receipt.required_capabilities : [];
  return {
    selectedDagIds,
    activeNodes,
    autonomyPolicyIds,
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
  if (handoff.schema_version === HANDOFF_V2_SCHEMA) {
    throw new Error(`${HANDOFF_V2_SCHEMA} requires a signed ${MANAGED_HANDOFF_V2_SCHEMA} receipt`);
  }
  if (handoff.schema_version !== HANDOFF_SCHEMA) {
    throw new Error(`handoff.schema_version must be ${HANDOFF_SCHEMA}`);
  }
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
  return {
    handoff,
    projectCode,
    episodeId,
    receipt,
    receiptDigest,
    judgment,
    knowledge,
    contextSchema: CONTEXT_SCHEMA,
    outcomeCase: null
  };
}

function normalizeRepositoryRef(value, name = 'repository') {
  const normalized = requiredString(value, name).replace(/\/+$/u, '').replace(/\.git$/u, '');
  const ssh = normalized.match(/^git@github\.com:([^/]+\/[^/]+)$/u);
  const https = normalized.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)$/u);
  const github = normalized.match(/^github:\/\/([^/]+\/[^/]+)$/u);
  if (ssh?.[1]) return `github://${ssh[1]}`;
  if (https?.[1]) return `github://${https[1]}`;
  if (github?.[1]) return `github://${github[1]}`;
  if (/^(?:repo|https|brainbase|graph|drive):\/\//u.test(normalized)) return normalized;
  throw new Error(`${name} must be a canonical repository URI`);
}

function managedReceiptField(raw, metadata, name, aliases = []) {
  const keys = [name, ...aliases];
  for (const key of keys) {
    if (raw?.[key] !== undefined) return raw[key];
    if (metadata?.[key] !== undefined) return metadata[key];
  }
  return undefined;
}

const MANAGED_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const MANAGED_PROJECT_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/u;
const MANAGED_SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

function managedIdentifier(value, name) {
  const normalized = requiredString(value, name);
  if (!MANAGED_ID_PATTERN.test(normalized)) throw new Error(`${name} has an invalid format`);
  return normalized;
}

function managedProjectCode(value, name) {
  const normalized = requiredString(value, name);
  if (!MANAGED_PROJECT_CODE_PATTERN.test(normalized)) throw new Error(`${name} has an invalid format`);
  return normalized;
}

function normalizeRepositoryRoot(value) {
  const root = requiredString(value, 'managed handoff.repository_root');
  const normalized = path.posix.normalize(root.replaceAll('\\', '/'));
  if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('managed handoff.repository_root must be repository-relative');
  }
  return normalized || '.';
}

function handoffHmacKeyId(config = {}, env = process.env) {
  const brainbase = config?.brainbase ?? {};
  const integration = brainbase.integration ?? {};
  const value = brainbase.handoff_hmac_key_id
    ?? brainbase.hmac_key_id
    ?? integration.handoff_hmac_key_id
    ?? integration.hmac_key_id
    ?? env[BRAINBASE_HANDOFF_HMAC_KEY_ID_ENV]
    ?? DEFAULT_HANDOFF_HMAC_KEY_ID;
  return managedIdentifier(value, 'managed handoff signature.key_id');
}

function configuredHandoffHmacKeyFile(repoRoot, config = {}, env = process.env) {
  const brainbase = config?.brainbase ?? {};
  const integration = brainbase.integration ?? {};
  const configured = brainbase.handoff_hmac_key_file
    ?? brainbase.hmac_key_file
    ?? integration.handoff_hmac_key_file
    ?? integration.hmac_key_file
    ?? env.BRAINBASE_VIBEPRO_HANDOFF_HMAC_KEY_FILE;
  if (typeof configured !== 'string' || !configured.trim()) return null;
  return path.isAbsolute(configured) ? path.normalize(configured) : path.resolve(repoRoot, configured);
}

function envKeyNames(keyId, env = process.env) {
  // Keep the trust anchor identical to Brainbase. In particular, do not fall
  // back to receipt-provided `trusted` or to an unrelated generic secret.
  const names = [BRAINBASE_HANDOFF_HMAC_SECRET_ENV];
  return names.filter((name, index) => names.indexOf(name) === index && typeof env[name] === 'string' && env[name].trim());
}

async function resolveManagedHandoffHmacSecret(repoRoot, config = {}, keyId, env = process.env) {
  const keyFile = configuredHandoffHmacKeyFile(repoRoot, config, env);
  if (keyFile) {
    let contents;
    try {
      contents = await readFile(keyFile, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error(`managed Brainbase handoff HMAC trust key file not found: ${keyFile}`);
      throw error;
    }
    const secret = contents.trim();
    if (!secret) throw new Error(`managed Brainbase handoff HMAC trust key file is empty: ${keyFile}`);
    if (secret.length < 32) throw new Error('managed Brainbase handoff HMAC trust key must contain at least 32 characters');
    return { secret, source: 'key_file', key_id: keyId };
  }
  const envName = envKeyNames(keyId, env)[0];
  if (!envName) {
    throw new Error(
      `managed Brainbase handoff HMAC trust key is unavailable for key_id ${keyId}; `
      + `set ${envKeyNames(keyId).at(0) ?? 'BRAINBASE_HANDOFF_HMAC_SECRET'} or configure handoff_hmac_key_file`
    );
  }
  const secret = env[envName].trim();
  if (secret.length < 32) throw new Error('managed Brainbase handoff HMAC trust key must contain at least 32 characters');
  return { secret, source: 'environment', key_id: keyId, env_name: envName };
}

function hmacSha256(secret, value) {
  return createHmac('sha256', secret).update(value).digest('hex');
}

function constantTimeHexEqual(left, right) {
  const normalizedLeft = String(left ?? '').toLowerCase().replace(/^v1=/u, '');
  const normalizedRight = String(right ?? '').toLowerCase().replace(/^v1=/u, '');
  if (!/^[a-f0-9]{64}$/u.test(normalizedLeft) || !/^[a-f0-9]{64}$/u.test(normalizedRight)) return false;
  return timingSafeEqual(Buffer.from(normalizedLeft, 'hex'), Buffer.from(normalizedRight, 'hex'));
}

async function validateManagedSignature(receipt, payload, repoRoot, config = {}, env = process.env) {
  const signature = receipt?.signature;
  if (!signature || typeof signature !== 'object' || Array.isArray(signature)) {
    throw new Error('managed Brainbase handoff requires an HMAC signature; self-reported trusted is not accepted');
  }
  if (signature.algorithm !== 'hmac-sha256') {
    throw new Error('managed Brainbase handoff signature algorithm must be hmac-sha256');
  }
  const signatureValue = requiredString(signature.value, 'managed handoff.signature.value');
  if (!/^[a-f0-9]{64}$/u.test(signatureValue)) throw new Error('managed handoff.signature.value must be a lowercase HMAC-SHA-256 digest');
  const keyId = handoffHmacKeyId(config, env);
  if (signature.key_id !== keyId) throw new Error('managed Brainbase handoff signature key_id is not trusted');
  const trustKey = await resolveManagedHandoffHmacSecret(repoRoot, config, keyId, env);
  if (!constantTimeHexEqual(signatureValue, hmacSha256(trustKey.secret, payload))) {
    throw new Error('managed Brainbase handoff HMAC signature does not match the trusted receipt content');
  }
  return {
    trusted: true,
    algorithm: 'hmac-sha256',
    key_id: keyId,
    value: signatureValue.toLowerCase().replace(/^v1=/u, '')
  };
}

function dateFromOption(now) {
  const value = typeof now === 'function' ? now() : now;
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (!Number.isFinite(date.valueOf())) throw new Error('managed Brainbase handoff validation time is invalid');
  return date;
}

async function validateManagedHandoff(raw, storyId, repoRoot, config = {}, now = () => new Date(), env = process.env) {
  object(raw, 'managed Brainbase handoff');
  if (!isManagedHandoffSchema(raw.schema_version)) {
    throw new Error(`managed Brainbase handoff must use the canonical ${MANAGED_HANDOFF_SCHEMA} or ${MANAGED_HANDOFF_V2_SCHEMA} receipt`);
  }
  const v2 = raw.schema_version === MANAGED_HANDOFF_V2_SCHEMA;
  for (const field of (v2 ? MANAGED_HANDOFF_V2_PAYLOAD_FIELDS : MANAGED_HANDOFF_PAYLOAD_FIELDS)) {
    if (!Object.hasOwn(raw, field)) throw new Error(`managed handoff.${field} is required`);
  }
  // Brainbase emits the managed receipt before VibePro has created a Story,
  // so story_id:null is an intentional unbound value. A non-null value is
  // already bound and must match the Story being started.
  if (raw.story_id !== null && raw.story_id !== storyId) {
    throw new Error('managed Brainbase handoff story_id does not match --id');
  }
  if (raw.authorized !== false) throw new Error('managed Brainbase handoff authorized must be false');
  if (raw.graph_promotion_allowed !== false) throw new Error('managed Brainbase handoff graph_promotion_allowed must be false');
  const projectCode = managedProjectCode(raw.project_code, 'managed handoff.project_code');
  const expectedProject = expectedBrainbaseProjectCode(config);
  if (expectedProject !== null && managedProjectCode(expectedProject, 'config.brainbase.project_code') !== projectCode) {
    throw new Error('managed Brainbase handoff project_code mismatch with the configured project');
  }

  const repositoryValue = requiredString(raw.repository, 'managed handoff.repository');
  if (repositoryValue.includes('@') && /:\/\//u.test(repositoryValue)) {
    throw new Error('managed handoff.repository must not contain credentials');
  }
  const repository = normalizeRepositoryRef(repositoryValue, 'managed handoff.repository');
  const actualRepository = normalizeRepositoryRef(await repositoryIdentity(repoRoot), 'repository');
  if (repository !== actualRepository) throw new Error('managed Brainbase handoff repository does not match the current repository');
  const expectedRepository = expectedBrainbaseRepository(config);
  if (expectedRepository !== null && normalizeRepositoryRef(expectedRepository, 'config.brainbase.repository') !== repository) {
    throw new Error('managed Brainbase handoff repository does not match the configured repository');
  }

  const baseSha = requiredString(raw.base_sha, 'managed handoff.base_sha');
  if (!MANAGED_SHA_PATTERN.test(baseSha)) throw new Error('managed handoff.base_sha must be a lowercase 40 or 64 character Git SHA digest');
  const gitContext = await collectGitContext(repoRoot);
  if (gitContext.head_sha !== baseSha) throw new Error(`managed Brainbase handoff base_sha does not match current HEAD (${gitContext.head_sha ?? 'unknown'})`);

  const issuedAt = requiredString(raw.issued_at, 'managed handoff.issued_at');
  const issuedDate = new Date(issuedAt);
  if (!RFC3339_PATTERN.test(issuedAt) || !Number.isFinite(issuedDate.valueOf())) throw new Error('managed handoff.issued_at must be RFC 3339');
  const expiresAt = requiredString(raw.expires_at, 'managed handoff.expires_at');
  const expiresDate = new Date(expiresAt);
  if (!RFC3339_PATTERN.test(expiresAt) || !Number.isFinite(expiresDate.valueOf())) throw new Error('managed handoff.expires_at must be RFC 3339');
  if (expiresDate.valueOf() <= issuedDate.valueOf()) throw new Error('managed handoff.expires_at must be after issued_at');
  if (expiresDate.valueOf() <= dateFromOption(now).valueOf()) throw new Error('managed Brainbase handoff receipt is expired');

  const receiptDigest = requiredString(raw.receipt_digest, 'managed handoff.receipt_digest');
  if (!/^[a-f0-9]{64}$/u.test(receiptDigest)) throw new Error('managed handoff.receipt_digest must be a lowercase SHA-256 digest');
  const canonicalPayload = canonicalManagedHandoffPayload(raw);
  if (sha256(canonicalPayload) !== receiptDigest) throw new Error('managed Brainbase handoff receipt digest does not match the canonical payload');
  const signature = await validateManagedSignature(raw, canonicalPayload, repoRoot, config, env);
  const resolutionId = managedIdentifier(raw.resolution_id, 'managed handoff.resolution_id');
  const turnId = managedIdentifier(raw.turn_id, 'managed handoff.turn_id');
  const outcomeCase = v2
    ? validateOutcomeCase(raw.outcome_case, {
      name: 'managed handoff.outcome_case',
      expectedJudgmentReceiptId: resolutionId
    })
    : null;
  return {
    handoff: raw,
    projectCode,
    episodeId: resolutionId,
    receipt: raw,
    receiptDigest,
    judgment: {
      selectedDagIds: [],
      autonomyPolicyIds: [],
      policyIds: [],
      activeNodes: [],
      requiredCapabilities: []
    },
    knowledge: [],
    managed: {
      schemaVersion: raw.schema_version,
      receiptDigest,
      signature,
      repository,
      repositoryRoot: normalizeRepositoryRoot(raw.repository_root),
      baseSha,
      issuedAt,
      expiresAt,
      resolutionId,
      turnId
    },
    contextSchema: v2 ? CONTEXT_V2_SCHEMA : CONTEXT_SCHEMA,
    outcomeCase
  };
}

function pathRemainsWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function decodedPathVariants(value, name) {
  const variants = [value];
  let current = value;
  const maxDecodeDepth = 8;
  for (let attempt = 0; attempt < maxDecodeDepth; attempt += 1) {
    let decoded;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      throw new Error(`${name} contains invalid percent encoding`);
    }
    if (decoded === current) break;
    variants.push(decoded.replaceAll('\\', '/'));
    current = decoded;
  }
  let residual;
  try {
    residual = decodeURIComponent(current);
  } catch {
    throw new Error(`${name} contains invalid percent encoding`);
  }
  if (residual !== current) {
    throw new Error(`${name} exceeds the safe percent-encoding normalization depth`);
  }
  return variants;
}

function normalizeLedgerSourceArtifact(sourceArtifact, name = 'handoff ledger.source_artifact') {
  const relative = requiredString(sourceArtifact, name).replaceAll('\\', '/');
  for (const variant of decodedPathVariants(relative, name)) {
    const normalized = path.posix.normalize(variant);
    if (path.posix.isAbsolute(variant)
        || /^[a-z]:\//iu.test(variant)
        || normalized === '..'
        || normalized.startsWith('../')) {
      throw new Error(`${name} must be repository-relative and remain within the repository`);
    }
  }
  const normalized = path.posix.normalize(relative);
  if (normalized !== relative || normalized === '.' || relative.includes('//')) {
    throw new Error(`${name} must use a canonical repository-relative path`);
  }
  return normalized;
}

async function confinedRepositoryPath(root, candidate, name, { mustExist = true } = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (!pathRemainsWithin(resolvedRoot, resolvedCandidate)) {
    throw new Error(`${name} must remain within the repository`);
  }
  let canonicalCandidate;
  try {
    const [canonicalRoot, existingCandidate] = await Promise.all([
      realpath(resolvedRoot),
      realpath(resolvedCandidate)
    ]);
    canonicalCandidate = existingCandidate;
    if (!pathRemainsWithin(canonicalRoot, canonicalCandidate)) {
      throw new Error(`${name} must remain within the repository after resolving symbolic links`);
    }
  } catch (error) {
    if (!mustExist && error?.code === 'ENOENT') return resolvedCandidate;
    throw error;
  }
  return canonicalCandidate;
}

async function ledgerSourcePath(root, sourceArtifact, { mustExist = true } = {}) {
  const relative = normalizeLedgerSourceArtifact(sourceArtifact);
  return confinedRepositoryPath(root, path.resolve(root, relative), 'handoff ledger.source_artifact', { mustExist });
}

async function canonicalRepositoryRelative(root, candidate, name) {
  const [canonicalRoot, canonicalCandidate] = await Promise.all([
    realpath(path.resolve(root)),
    realpath(candidate)
  ]);
  if (!pathRemainsWithin(canonicalRoot, canonicalCandidate)) {
    throw new Error(`${name} must remain within the repository after resolving symbolic links`);
  }
  return normalizeLedgerSourceArtifact(
    path.relative(canonicalRoot, canonicalCandidate).split(path.sep).join('/'),
    name
  );
}

async function validateHandoffLedgerEntry(root, value, index, { verifySource = false } = {}) {
  const entry = object(value, `handoff ledger.entries[${index}]`);
  const receiptDigest = sha256Field(entry.receipt_digest, `handoff ledger.entries[${index}].receipt_digest`);
  const storyId = safeIdentifier(entry.story_id, `handoff ledger.entries[${index}].story_id`);
  const resolutionId = managedIdentifier(entry.resolution_id, `handoff ledger.entries[${index}].resolution_id`);
  const turnId = managedIdentifier(entry.turn_id, `handoff ledger.entries[${index}].turn_id`);
  const projectCode = managedProjectCode(entry.project_code, `handoff ledger.entries[${index}].project_code`);
  const repository = normalizeRepositoryRef(entry.repository, `handoff ledger.entries[${index}].repository`);
  const baseSha = requiredString(entry.base_sha, `handoff ledger.entries[${index}].base_sha`);
  if (!MANAGED_SHA_PATTERN.test(baseSha)) {
    throw new Error(`handoff ledger.entries[${index}].base_sha must be a lowercase 40 or 64 character Git SHA digest`);
  }
  const sourceArtifact = normalizeLedgerSourceArtifact(
    entry.source_artifact,
    `handoff ledger.entries[${index}].source_artifact`
  );
  if (verifySource) await ledgerSourcePath(root, sourceArtifact);
  const consumedAt = requiredString(entry.consumed_at, `handoff ledger.entries[${index}].consumed_at`);
  if (!RFC3339_PATTERN.test(consumedAt) || !Number.isFinite(new Date(consumedAt).valueOf())) {
    throw new Error(`handoff ledger.entries[${index}].consumed_at must be RFC 3339`);
  }
  return {
    receipt_digest: receiptDigest,
    story_id: storyId,
    resolution_id: resolutionId,
    turn_id: turnId,
    project_code: projectCode,
    repository,
    base_sha: baseSha,
    source_artifact: sourceArtifact,
    consumed_at: consumedAt
  };
}

async function validateHandoffConsumptionLedger(root, raw, { verifySources = false } = {}) {
  object(raw, 'handoff consumption ledger');
  if (raw.schema_version !== HANDOFF_LEDGER_SCHEMA) {
    throw new Error(`handoff consumption ledger must use ${HANDOFF_LEDGER_SCHEMA}`);
  }
  if (!Array.isArray(raw.entries)) throw new Error('handoff consumption ledger.entries must be an array');
  const entries = await Promise.all(raw.entries.map((entry, index) => (
    validateHandoffLedgerEntry(root, entry, index, { verifySource: verifySources })
  )));
  const seenDigests = new Set();
  const seenStories = new Set();
  for (const entry of entries) {
    if (seenDigests.has(entry.receipt_digest)) throw new Error('handoff consumption ledger contains a duplicate receipt_digest');
    if (seenStories.has(entry.story_id)) throw new Error('handoff consumption ledger contains multiple receipts for one Story');
    seenDigests.add(entry.receipt_digest);
    seenStories.add(entry.story_id);
  }
  return { schema_version: HANDOFF_LEDGER_SCHEMA, entries };
}

async function readHandoffConsumptionLedger(root, options = {}) {
  const filePath = handoffLedgerPath(root);
  const raw = await readJsonIfExists(filePath);
  if (raw === null) return { schema_version: HANDOFF_LEDGER_SCHEMA, entries: [] };
  return validateHandoffConsumptionLedger(root, raw, options);
}

async function nextHandoffConsumption(root, storyId, validated, sourceArtifact, now) {
  if (!validated.managed) return null;
  const relativeSource = normalizeLedgerSourceArtifact(sourceArtifact, 'handoff source_artifact');
  await ledgerSourcePath(root, relativeSource);
  const ledger = await readHandoffConsumptionLedger(root, { verifySources: true });
  const digestMatch = ledger.entries.find((entry) => entry.receipt_digest === validated.managed.receiptDigest);
  if (digestMatch && digestMatch.story_id !== storyId) {
    const error = new Error(`managed Brainbase handoff receipt is already consumed by Story ${digestMatch.story_id}`);
    error.code = 'BRAINBASE_HANDOFF_ALREADY_CONSUMED';
    throw error;
  }
  const storyMatch = ledger.entries.find((entry) => entry.story_id === storyId);
  if (storyMatch && storyMatch.receipt_digest !== validated.managed.receiptDigest) {
    const error = new Error(`Story ${storyId} is already bound to another managed Brainbase handoff receipt`);
    error.code = 'BRAINBASE_HANDOFF_ALREADY_BOUND';
    throw error;
  }
  if (digestMatch || storyMatch) return {
    entry: digestMatch ?? storyMatch,
    ledger
  };
  const entry = {
    receipt_digest: validated.managed.receiptDigest,
    story_id: storyId,
    resolution_id: validated.managed.resolutionId,
    turn_id: validated.managed.turnId,
    project_code: validated.projectCode,
    repository: validated.managed.repository,
    base_sha: validated.managed.baseSha,
    source_artifact: relativeSource,
    consumed_at: dateFromOption(now ?? (() => new Date())).toISOString()
  };
  return {
    entry,
    ledger: {
    schema_version: HANDOFF_LEDGER_SCHEMA,
    entries: [...ledger.entries, entry]
    }
  };
}

async function ledgerEntryForStory(root, storyId) {
  const ledger = await readHandoffConsumptionLedger(root);
  return ledger.entries.find((entry) => entry.story_id === storyId) ?? null;
}

async function preflightStoryProjection(root, storyId, validated, options = {}) {
  const configPath = path.join(getWorkspaceDir(root), 'config.json');
  const config = await readJsonIfExists(configPath);
  const stories = config?.brainbase?.stories;
  const outputPath = contextPath(root, storyId);
  const priorContext = await readJsonIfExists(outputPath);
  if (!validated.outcomeCase) {
    if (priorContext?.schema_version === CONTEXT_V2_SCHEMA || stories?.find((story) => story?.story_id === storyId)?.outcome_case) {
      const error = new Error('v2 Story outcome-case projection cannot be rebound to v1; create a new Story instead');
      error.code = 'BRAINBASE_HANDOFF_V2_REBIND_DOWNGRADE';
      throw error;
    }
    return { configPath, config, outputPath, priorContext, nextConfig: config, storyMetadataUpdated: false };
  }
  if (!validated.managed || validated.managed.schemaVersion !== MANAGED_HANDOFF_V2_SCHEMA) {
    throw new Error('outcome-case projection requires a signed managed Brainbase handoff v2');
  }
  if (options.storyDeclaration && options.storyAddDeclarationCapability !== STORY_ADD_DECLARATION_CAPABILITY) {
    const error = new Error('storyDeclaration is reserved for the formal Story add workflow');
    error.code = 'BRAINBASE_STORY_DECLARATION_FORBIDDEN';
    throw error;
  }
  const declaredStory = options.storyAddDeclarationCapability === STORY_ADD_DECLARATION_CAPABILITY
    ? options.storyDeclaration
    : null;
  if (declaredStory && declaredStory?.story_id !== storyId) {
    throw new Error('managed v2 Story declaration does not match the binding Story');
  }
  const currentStories = Array.isArray(stories) ? stories : [];
  const index = currentStories.findIndex((story) => story?.story_id === storyId);
  if (index < 0) {
    // `story add` is the only caller allowed to supply this declaration. It
    // is committed in the same journal as Context, receipt, ledger, and the
    // marker, so a v2 handoff cannot create an orphaned Story or projection.
    if (!declaredStory || typeof declaredStory !== 'object' || Array.isArray(declaredStory)) {
      const error = new Error(`v2 outcome-case binding requires existing Story ${storyId} before any write`);
      error.code = 'BRAINBASE_OUTCOME_CASE_STORY_MISSING';
      throw error;
    }
    const declared = { ...declaredStory, outcome_case: validated.outcomeCase };
    return {
      configPath,
      config,
      outputPath,
      priorContext,
      nextConfig: {
        ...config,
        brainbase: {
          ...(config?.brainbase ?? {}),
          stories: [...currentStories, declared]
        }
      },
      storyMetadataUpdated: true,
      storyDeclared: declared
    };
  }
  const current = currentStories[index];
  if (current?.outcome_case && canonicalJson(current.outcome_case) !== canonicalJson(validated.outcomeCase)) {
    const error = new Error('existing Story outcome_case does not match the signed managed handoff');
    error.code = 'BRAINBASE_OUTCOME_CASE_STORY_CONFLICT';
    throw error;
  }
  const nextStories = [...currentStories];
  nextStories[index] = { ...current, outcome_case: validated.outcomeCase };
  return {
    configPath,
    config,
    outputPath,
    priorContext,
    nextConfig: {
    ...config,
    brainbase: {
      ...(config.brainbase ?? {}),
      stories: nextStories
    }
    },
    storyMetadataUpdated: canonicalJson(current?.outcome_case ?? null) !== canonicalJson(validated.outcomeCase)
  };
}

async function writeBrainbaseBinding(root, storyId, validated, options = {}) {
  // A journal without its final commit marker is deliberately not trusted by
  // PR preparation. Replaying it before a new bind makes process interruption
  // recoverable without ever treating a partial projection as authoritative.
  await recoverManagedPublication(root, storyId, options);
  // Validate all cross-artifact invariants before creating context, receipts,
  // or ledger entries. A v2 result is never reported as bound without an
  // already-existing Story projection derived from the same signed payload.
  const projection = await preflightStoryProjection(root, storyId, validated, options);
  const transactionId = validated.managed ? randomUUID() : null;
  const stableProjection = {
    schema_version: validated.contextSchema ?? CONTEXT_SCHEMA,
    story_id: storyId,
    project_code: validated.projectCode,
    source: {
      handoff_digest: sha256(canonicalJson(validated.handoff)),
      ...(validated.managed ? { managed: true } : {}),
      ...(validated.managed ? { managed_receipt_digest: validated.managed.receiptDigest } : {})
    },
    judgment: {
      authority: 'brainbase',
      snapshot_not_authority: true,
      episode_id: validated.episodeId,
      resolution_id: validated.receipt.resolution_id,
      turn_id: validated.receipt.turn_id,
      receipt_digest: validated.receiptDigest,
      ...(validated.receipt.plan_digest ? { plan_digest: validated.receipt.plan_digest } : {}),
      ...(validated.receipt.runtime_version ? { runtime_version: validated.receipt.runtime_version } : {}),
      ...(validated.receipt.manifest_digest ? { manifest_digest: validated.receipt.manifest_digest } : {}),
      ...(validated.receipt.autonomy_decision ? { autonomy_decision: validated.receipt.autonomy_decision } : {}),
      autonomy_policy_ids: validated.judgment.autonomyPolicyIds,
      selected_dag_ids: validated.judgment.selectedDagIds,
      applicable_policy_ids: validated.judgment.policyIds,
      active_node_ids: validated.judgment.activeNodes
    },
    knowledge: validated.knowledge,
    ...(validated.outcomeCase ? { outcome_case: validated.outcomeCase } : {}),
    ...(validated.managed ? {
      repository: validated.managed.repository,
      repository_root: validated.managed.repositoryRoot,
      base_sha: validated.managed.baseSha,
      issued_at: validated.managed.issuedAt,
      expires_at: validated.managed.expiresAt,
      bind_receipt: {
        schema_version: BIND_RECEIPT_SCHEMA,
        receipt_digest: validated.managed.receiptDigest
      },
      publication: {
        schema_version: BIND_PUBLICATION_SCHEMA,
        transaction_id: transactionId
      }
    } : {})
  };
  const context = {
    ...stableProjection,
    context_digest: sha256(canonicalJson(stableProjection)),
    bound_at: (options.now ?? (() => new Date()))().toISOString()
  };
  const outputPath = projection.outputPath;
  const storyMetadataUpdated = projection.storyMetadataUpdated;
  let bindReceiptArtifact = null;
  let consumptionLedgerArtifact = null;
  if (validated.managed) {
    if (!options.handoffSource) throw new Error('managed Brainbase bind requires a repository-local handoff source');
    const receipt = {
      schema_version: BIND_RECEIPT_SCHEMA,
      story_id: storyId,
      project_code: context.project_code,
      repository: validated.managed.repository,
      repository_root: validated.managed.repositoryRoot,
      base_sha: validated.managed.baseSha,
      issued_at: validated.managed.issuedAt,
      expires_at: validated.managed.expiresAt,
      resolution_id: validated.managed.resolutionId,
      turn_id: validated.managed.turnId,
      receipt_digest: validated.managed.receiptDigest,
      context_digest: context.context_digest,
      bound_at: context.bound_at,
      // Preserve the signed envelope, rather than a boolean assertion about
      // it. Consumers must revalidate this payload against their local key.
      managed_handoff: validated.handoff,
      publication: {
        schema_version: BIND_PUBLICATION_SCHEMA,
        transaction_id: transactionId
      }
    };
    const receiptPath = bindReceiptPath(root, storyId);
    const nextLedger = await nextHandoffConsumption(root, storyId, validated, options.handoffSource, options.now);
    const journal = {
      schema_version: BIND_PUBLICATION_SCHEMA,
      transaction_id: transactionId,
      story_id: storyId,
      documents: {
        config: projection.nextConfig,
        context,
        receipt,
        ledger: nextLedger.ledger
      }
    };
    journal.publication_digest = publicationDigest(journal);
    journal.commit_marker = {
      schema_version: BIND_PUBLICATION_SCHEMA,
      transaction_id: transactionId,
      story_id: storyId,
      publication_digest: journal.publication_digest,
      context_digest: context.context_digest,
      receipt_digest: validated.managed.receiptDigest,
      committed_at: context.bound_at
    };
    await writeJsonAtomic(bindPublicationJournalPath(root, storyId), journal);
    await completeManagedPublication(root, storyId, journal, options);
    bindReceiptArtifact = toWorkspaceRelative(root, receiptPath);
    consumptionLedgerArtifact = toWorkspaceRelative(root, handoffLedgerPath(root));
  } else {
    await writeJsonAtomic(outputPath, context);
  }
  return {
    status: 'bound',
    story_id: storyId,
    project_code: context.project_code,
    context_digest: context.context_digest,
    knowledge_reference_count: context.knowledge.reduce((count, entry) => count + entry.references.length, 0),
    artifact: toWorkspaceRelative(root, outputPath),
    ...(context.outcome_case ? {
      outcome_case: context.outcome_case,
      story_metadata_updated: storyMetadataUpdated,
      ...(projection.storyDeclared ? { story_declared: projection.storyDeclared } : {})
    } : {}),
    ...(bindReceiptArtifact ? { bind_receipt_artifact: bindReceiptArtifact } : {}),
    ...(consumptionLedgerArtifact ? { consumption_ledger_artifact: consumptionLedgerArtifact } : {})
  };
}

export async function bindBrainbaseContext(repoRoot, options = {}) {
  if (Object.hasOwn(options, 'storyDeclaration') || Object.hasOwn(options, 'storyAddDeclarationCapability')) {
    const error = new Error('storyDeclaration is reserved for the formal Story add workflow');
    error.code = 'BRAINBASE_STORY_DECLARATION_FORBIDDEN';
    throw error;
  }
  const root = path.resolve(repoRoot);
  const storyId = safeIdentifier(options.storyId, 'story_id');
  const requestedInput = requiredString(options.input, 'input');
  const configuredManaged = isManagedBrainbaseConfig(options.config ?? {});
  if (configuredManaged) {
    normalizeLedgerSourceArtifact(requestedInput, 'managed Brainbase handoff source');
  }
  const requestedInputPath = path.resolve(root, requestedInput);
  const inputPath = await confinedRepositoryPath(root, requestedInputPath, 'managed Brainbase handoff source');
  const raw = await readJson(inputPath, 'Brainbase handoff');
  const managed = isManagedHandoffSchema(raw?.schema_version);
  if (managed && !configuredManaged) {
    normalizeLedgerSourceArtifact(requestedInput, 'managed Brainbase handoff source');
  }
  const handoffSource = await canonicalRepositoryRelative(root, inputPath, 'handoff source_artifact');
  await ledgerSourcePath(root, handoffSource);
  const validated = managed
    ? await validateManagedHandoff(raw, storyId, root, options.config ?? {}, options.now ?? (() => new Date()), options.env ?? process.env)
    : validateHandoff(raw, storyId);
  return writeBrainbaseBinding(root, storyId, validated, {
    ...options,
    handoffSource
  });
}

async function ensureBrainbaseStoryBindingInternal(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = safeIdentifier(options.storyId, 'story_id');
  const config = options.config ?? {};
  const files = await discoverManagedHandoffFiles(root, config);
  const managed = isManagedBrainbaseConfig(config) || files.length > 0;
  if (!managed) return { status: 'unmanaged', managed: false, story_id: storyId };
  const consumed = await ledgerEntryForStory(root, storyId);
  let inputPath;
  if (consumed) {
    try {
      inputPath = await ledgerSourcePath(root, consumed.source_artifact);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const missingError = new Error(`consumed managed Brainbase handoff receipt source is missing: ${consumed.source_artifact}`);
      missingError.code = 'BRAINBASE_HANDOFF_CONSUMED_SOURCE_MISSING';
      throw missingError;
    }
  } else {
    if (files.length === 0) {
      const error = new Error(`managed Brainbase handoff receipt is missing for Story ${storyId}`);
      error.code = 'BRAINBASE_HANDOFF_MISSING';
      throw error;
    }
    const parsed = [];
    const parseErrors = [];
    for (const candidate of files) {
      try {
        const candidateRaw = await readJson(candidate, 'managed Brainbase handoff');
        if (isManagedHandoffSchema(candidateRaw?.schema_version)) {
          parsed.push({ path: candidate, raw: candidateRaw });
        }
      } catch (error) {
        parseErrors.push({ path: candidate, error });
      }
    }
    const matching = parsed.filter(({ raw }) => raw.story_id === storyId);
    const unbound = parsed.filter(({ raw }) => raw.story_id === null);
    const eligible = [...matching, ...unbound];
    if (eligible.length > 1) {
      const error = new Error(`managed Brainbase handoff receipt is ambiguous for Story ${storyId}; exactly one matching or unbound receipt is required`);
      error.code = 'BRAINBASE_HANDOFF_AMBIGUOUS';
      throw error;
    }
    if (eligible.length === 1) {
      inputPath = eligible[0].path;
    } else if (matching.length === 0 && unbound.length === 0) {
      const mismatched = parsed.find(({ raw }) => raw.story_id !== null && raw.story_id !== storyId);
      if (mismatched) {
        const error = new Error(`managed Brainbase handoff story_id does not match --id ${storyId}`);
        error.code = 'BRAINBASE_HANDOFF_STORY_MISMATCH';
        throw error;
      }
      inputPath = parseErrors[0]?.path ?? files[0];
    }
  }
  const handoffSource = await canonicalRepositoryRelative(root, inputPath, 'handoff source_artifact');
  await ledgerSourcePath(root, handoffSource);
  const raw = await readJson(inputPath, 'managed Brainbase handoff');
  const validated = await validateManagedHandoff(raw, storyId, root, config, options.now ?? (() => new Date()), options.env ?? process.env);
  if (consumed && validated.managed.receiptDigest !== consumed.receipt_digest) {
    const error = new Error('managed Brainbase handoff receipt does not match the consumed binding ledger');
    error.code = 'BRAINBASE_HANDOFF_LEDGER_MISMATCH';
    throw error;
  }
  const ledger = await readHandoffConsumptionLedger(root);
  const receiptConsumedBy = ledger.entries.find((entry) => entry.receipt_digest === validated.managed.receiptDigest);
  if (receiptConsumedBy && receiptConsumedBy.story_id !== storyId) {
    const error = new Error(`managed Brainbase handoff receipt is already consumed by Story ${receiptConsumedBy.story_id}`);
    error.code = 'BRAINBASE_HANDOFF_ALREADY_CONSUMED';
    throw error;
  }
  return writeBrainbaseBinding(root, storyId, validated, {
    ...options,
    handoffSource
  });
}

// This is the normal public bind entrypoint.  It deliberately cannot create a
// missing Story: callers must use the Story CLI's formal declaration flow.
export async function ensureBrainbaseStoryBinding(repoRoot, options = {}) {
  if (Object.hasOwn(options, 'storyDeclaration') || Object.hasOwn(options, 'storyAddDeclarationCapability')) {
    const error = new Error('storyDeclaration is reserved for the formal Story add workflow');
    error.code = 'BRAINBASE_STORY_DECLARATION_FORBIDDEN';
    throw error;
  }
  return ensureBrainbaseStoryBindingInternal(repoRoot, options);
}

// This is deliberately not exported. The symbol must never cross this module
// boundary: an exported wrapper would let any importer obtain the authority to
// create an otherwise absent Story while binding a managed v2 handoff.
async function bindFormalStoryAddDeclaration(repoRoot, options = {}) {
  return ensureBrainbaseStoryBindingInternal(repoRoot, {
    ...options,
    storyAddDeclarationCapability: STORY_ADD_DECLARATION_CAPABILITY
  });
}

function buildFormalStoryDeclaration(options = {}) {
  if (Object.hasOwn(options, 'storyDeclaration') || Object.hasOwn(options, 'storyAddDeclarationCapability')) {
    const error = new Error('formal Story add accepts normalized CLI fields, not a Story declaration');
    error.code = 'BRAINBASE_STORY_DECLARATION_FORBIDDEN';
    throw error;
  }
  if (!options.story_id) throw new Error('--id is required');
  if (!options.title) throw new Error('--title is required');
  return {
    story_id: options.story_id,
    title: options.title,
    ssot: 'local',
    status: 'active',
    horizon: options.horizon ?? null,
    view: options.view ?? null,
    period: options.period ?? null,
    started_at: options.started_at ?? null,
    due_at: options.due_at ?? null,
    contract_type: options.contract_type ?? null
  };
}

function traceabilityFailure(options = {}) {
  if (options.traceabilityFailureAt === 'traceability') {
    const error = new Error('injected Brainbase Story traceability failure');
    error.code = 'BRAINBASE_STORY_TRACEABILITY_INJECTED_FAILURE';
    throw error;
  }
}

async function resumeManagedV2StoryAddTraceability(root, story, storedStory, options = {}) {
  // Publication has already committed, so a retry must not invoke bind again.
  // It may only finish the final local traceability projection when the exact
  // normalized declaration is still backed by a trusted managed-v2 receipt.
  const projection = await inspectManagedV2OutcomeCaseProjection(root, story.story_id, storedStory?.outcome_case, options);
  const expectedStory = { ...story, outcome_case: projection.outcome_case };
  const traceabilityPath = await resolvePrArtifactFile(root, story.story_id, 'traceability.json');
  const existingTraceability = await readJsonIfExists(traceabilityPath);
  if (projection.status !== 'trusted'
      || canonicalJson(storedStory) !== canonicalJson(expectedStory)
      || existingTraceability !== null) {
    const error = new Error(`Story already exists: ${story.story_id}`);
    error.code = 'BRAINBASE_STORY_ADD_RESUME_NOT_ELIGIBLE';
    throw error;
  }
  traceabilityFailure(options);
  await bindStoryTraceability(root, {
    storyId: story.story_id,
    source: 'story_add',
    lifecycle: 'declared_not_started'
  });
  return storedStory;
}

// The only public declaration operation is a complete Story-add transaction.
// It accepts raw CLI fields, performs required normalization and traceability,
// and keeps the internal declaration capability inside this module.
export async function addBrainbaseBoundStory(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  await initWorkspace(root);
  const configPath = path.join(getWorkspaceDir(root), 'config.json');
  const config = await readJson(configPath, 'VibePro config');
  let story = buildFormalStoryDeclaration(options);
  const stories = Array.isArray(config.brainbase?.stories) ? config.brainbase.stories : [];
  const storedStory = stories.find((item) => item?.story_id === story.story_id);
  if (storedStory) {
    return resumeManagedV2StoryAddTraceability(root, story, storedStory, options);
  }
  const binding = await bindFormalStoryAddDeclaration(root, {
    storyId: story.story_id,
    config,
    // A signed managed v2 handoff can arrive before a Story exists. This
    // private declaration is journaled with Context, receipt, ledger, and the
    // commit marker; callers can never pass an arbitrary declaration here.
    storyDeclaration: story,
    env: options.env,
    now: options.now
  });
  if (binding?.story_declared) {
    story = binding.story_declared;
  } else {
    if (binding?.outcome_case) story = { ...story, outcome_case: binding.outcome_case };
    config.brainbase = {
      ...(config.brainbase ?? {}),
      stories: [...stories, story]
    };
    await writeJsonAtomic(configPath, config);
  }
  traceabilityFailure(options);
  await bindStoryTraceability(root, {
    storyId: story.story_id,
    source: 'story_add',
    lifecycle: 'declared_not_started'
  });
  return story;
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

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function publicationFailure(options, point) {
  const failurePoints = Array.isArray(options?.publishFailureAt)
    ? options.publishFailureAt
    : [options?.publishFailureAt];
  if (failurePoints.includes(point)) {
    const error = new Error(`injected Brainbase bind publication failure at ${point}`);
    error.code = 'BRAINBASE_BIND_PUBLICATION_INJECTED_FAILURE';
    throw error;
  }
}

function publicationDocuments(root, storyId) {
  return {
    config: path.join(getWorkspaceDir(root), 'config.json'),
    context: contextPath(root, storyId),
    receipt: bindReceiptPath(root, storyId),
    ledger: handoffLedgerPath(root)
  };
}

function publicationDigest(journal) {
  return sha256(canonicalJson({
    schema_version: journal.schema_version,
    transaction_id: journal.transaction_id,
    story_id: journal.story_id,
    documents: journal.documents
  }));
}

async function validatePublicationJournal(root, storyId, journal) {
  object(journal, 'Brainbase bind publication journal');
  if (journal.schema_version !== BIND_PUBLICATION_SCHEMA) throw new Error('Brainbase bind publication journal has an unsupported schema');
  if (safeIdentifier(journal.story_id, 'Brainbase bind publication journal.story_id') !== storyId) {
    throw new Error('Brainbase bind publication journal story_id does not match');
  }
  managedIdentifier(journal.transaction_id, 'Brainbase bind publication journal.transaction_id');
  object(journal.documents, 'Brainbase bind publication journal.documents');
  for (const name of ['config', 'context', 'receipt', 'ledger']) object(journal.documents[name], `Brainbase bind publication journal.documents.${name}`);
  if (sha256Field(journal.publication_digest, 'Brainbase bind publication journal.publication_digest') !== publicationDigest(journal)) {
    throw new Error('Brainbase bind publication journal digest does not match');
  }
  object(journal.commit_marker, 'Brainbase bind publication journal.commit_marker');
  if (journal.commit_marker.publication_digest !== journal.publication_digest
      || journal.commit_marker.story_id !== storyId
      || journal.commit_marker.schema_version !== BIND_PUBLICATION_SCHEMA) {
    throw new Error('Brainbase bind publication commit marker does not match the journal');
  }
  await validateHandoffConsumptionLedger(root, journal.documents.ledger, { verifySources: true });
  return journal;
}

async function completeManagedPublication(root, storyId, journal, options = {}, { recovering = false } = {}) {
  await validatePublicationJournal(root, storyId, journal);
  const documents = publicationDocuments(root, storyId);
  try {
    for (const name of ['config', 'context', 'receipt', 'ledger']) {
      publicationFailure(options, recovering ? `recovery-${name}` : name);
      await writeJsonAtomic(documents[name], journal.documents[name]);
    }
    publicationFailure(options, recovering ? 'recovery-commit' : 'commit');
    await writeJsonAtomic(bindCommitMarkerPath(root, storyId), journal.commit_marker);
    publicationFailure(options, recovering ? 'recovery-cleanup' : 'cleanup');
    await unlink(bindPublicationJournalPath(root, storyId)).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  } catch (error) {
    // No compensating write can restore a crash-consistent multi-file state.
    // Keep the durable journal and leave the marker absent; recovery replays
    // the complete transaction. This checkpoint makes rollback-path failures
    // executable without allowing a partial projection to become trusted.
    publicationFailure(options, 'rollback');
    throw error;
  }
}

async function recoverManagedPublication(root, storyId, options = {}) {
  const journalPath = bindPublicationJournalPath(root, storyId);
  const journal = await readJsonIfExists(journalPath);
  if (journal === null) return false;
  await validatePublicationJournal(root, storyId, journal);
  const marker = await readJsonIfExists(bindCommitMarkerPath(root, storyId));
  if (marker?.publication_digest === journal.publication_digest
      && marker?.transaction_id === journal.transaction_id
      && marker?.story_id === storyId
      && marker?.schema_version === BIND_PUBLICATION_SCHEMA) {
    publicationFailure(options, 'recovery-cleanup');
    await unlink(journalPath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
    return true;
  }
  publicationFailure(options, 'recovery');
  await completeManagedPublication(root, storyId, journal, options, { recovering: true });
  return true;
}

async function listOutboxFiles(repoRoot) {
  const directory = path.join(getWorkspaceDir(repoRoot), 'integrations', 'brainbase', 'outbox');
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(directory, entry.name))
      .sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function readBrainbaseConfig(repoRoot) {
  return await readJsonIfExists(path.join(getWorkspaceDir(repoRoot), 'config.json')) ?? {};
}

function outcomeCaseProjectionStatus(status, reasonCode, storyId, outcomeCase = null) {
  const recovery = status === 'trusted' || status === 'none'
    ? null
    : {
      decision: status === 'partial' ? 'recover_or_rebind' : 'obtain_fresh_managed_handoff_and_rebind',
      reference: `vibepro integration brainbase bind . --id ${storyId} --input <managed-handoff.json>`
    };
  return {
    status,
    reason_code: reasonCode,
    ...(outcomeCase ? { outcome_case: outcomeCase } : {}),
    ...(recovery ? { recovery } : {})
  };
}

function outcomeCaseProjectionNotEvaluated(repoRoot, storyId) {
  return {
    status: 'not_evaluated',
    reason_code: 'pr_prepare_required',
    reference: storyId ? `vibepro pr prepare ${repoRoot} --story-id ${storyId}` : null
  };
}

function classifyOutcomeCaseVerificationError(error, storyId) {
  const message = String(error?.message ?? '');
  if (error?.code === 'ENOENT' || /consumed managed Brainbase handoff receipt not found/i.test(message)) {
    return outcomeCaseProjectionStatus('untrusted', 'consumption_source_missing', storyId);
  }
  if (/expired/i.test(message)) return outcomeCaseProjectionStatus('untrusted', 'managed_handoff_expired', storyId);
  if (/HMAC|signature|trusted receipt content|key_id/i.test(message)) {
    return outcomeCaseProjectionStatus('untrusted', 'managed_handoff_signature_invalid', storyId);
  }
  if (/outcome_case|technical_acceptance|production_probe|outcome case/i.test(message)) {
    return outcomeCaseProjectionStatus('partial', 'outcome_case_partial', storyId);
  }
  if (/repository|project_code|base_sha|HEAD|story_id|receipt digest/i.test(message)) {
    return outcomeCaseProjectionStatus('untrusted', 'managed_handoff_identity_mismatch', storyId);
  }
  return outcomeCaseProjectionStatus('unknown', 'projection_verification_unavailable', storyId);
}

// PR preparation is a second trust boundary. Local context and receipt files
// are mutable workspace artifacts, so never use their `signature_trusted`
// claims. The signed managed envelope is retained in the receipt and verified
// again with the configured local trust key. Failures deliberately retain a
// safe status/reason for the PR rather than silently looking "unlinked".
export async function inspectManagedV2OutcomeCaseProjection(repoRoot, storyId, rawOutcomeCase, options = {}) {
  const root = path.resolve(repoRoot);
  try {
    const [config, context, receipt, marker] = await Promise.all([
      readBrainbaseConfig(root),
      readJsonIfExists(contextPath(root, storyId)),
      readJsonIfExists(bindReceiptPath(root, storyId)),
      readJsonIfExists(bindCommitMarkerPath(root, storyId))
    ]);
    const hasRawOutcomeCase = Boolean(rawOutcomeCase && typeof rawOutcomeCase === 'object' && !Array.isArray(rawOutcomeCase));
    // Bind receipts and commit markers are shared by managed v1 and v2. Only
    // a verified managed handoff v1 may suppress the v2 outcome-case recovery
    // path; malformed or incomplete artifacts remain fail-closed below.
    const declaresV2Projection = context?.schema_version === CONTEXT_V2_SCHEMA
      || receipt?.managed_handoff?.schema_version === MANAGED_HANDOFF_V2_SCHEMA;
    if (!hasRawOutcomeCase && !declaresV2Projection) {
      if ((!context && !receipt && !marker)
          || (context?.schema_version === CONTEXT_SCHEMA && !receipt && !marker)) {
        return outcomeCaseProjectionStatus('none', 'not_linked', storyId);
      }
      if (context?.schema_version === CONTEXT_SCHEMA
          && receipt?.managed_handoff?.schema_version === MANAGED_HANDOFF_SCHEMA) {
        const validated = await validateManagedHandoff(
          receipt.managed_handoff,
          storyId,
          root,
          config,
          options.now ?? (() => new Date()),
          options.env ?? process.env
        );
        if (validated.managed?.schemaVersion === MANAGED_HANDOFF_SCHEMA) {
          return outcomeCaseProjectionStatus('none', 'not_linked', storyId);
        }
      }
    }
    if (!hasRawOutcomeCase) return outcomeCaseProjectionStatus('partial', 'outcome_case_missing', storyId);
    try {
      validateOutcomeCase(rawOutcomeCase, { name: 'Story outcome_case' });
    } catch {
      return outcomeCaseProjectionStatus('partial', 'outcome_case_partial', storyId);
    }
    if (!marker) return outcomeCaseProjectionStatus('partial', 'commit_marker_missing', storyId);
    if (!context || !receipt) return outcomeCaseProjectionStatus('partial', 'binding_artifact_missing', storyId);
    if (context?.schema_version !== CONTEXT_V2_SCHEMA
        || receipt?.schema_version !== BIND_RECEIPT_SCHEMA
        || marker?.schema_version !== BIND_PUBLICATION_SCHEMA
        || context?.story_id !== storyId
        || receipt?.story_id !== storyId
        || context?.publication?.schema_version !== BIND_PUBLICATION_SCHEMA
        || receipt?.publication?.schema_version !== BIND_PUBLICATION_SCHEMA
        || context.publication.transaction_id !== receipt.publication.transaction_id
        || marker.transaction_id !== context.publication.transaction_id
        || marker.story_id !== storyId
        || marker.context_digest !== context.context_digest
        || marker.receipt_digest !== receipt.receipt_digest
        || context?.bind_receipt?.receipt_digest !== receipt.receipt_digest
        || receipt.context_digest !== context.context_digest
        || receipt.bound_at !== context.bound_at
        || marker.committed_at !== context.bound_at) {
      return outcomeCaseProjectionStatus('untrusted', 'projection_integrity_mismatch', storyId);
    }
    const stableContext = { ...context };
    delete stableContext.context_digest;
    delete stableContext.bound_at;
    if (sha256(canonicalJson(stableContext)) !== context.context_digest) {
      return outcomeCaseProjectionStatus('untrusted', 'context_digest_mismatch', storyId);
    }

    const validated = await validateManagedHandoff(
      receipt.managed_handoff,
      storyId,
      root,
      config,
      options.now ?? (() => new Date()),
      options.env ?? process.env
    );
    if (validated.managed?.schemaVersion !== MANAGED_HANDOFF_V2_SCHEMA
        || marker.receipt_digest !== validated.managed.receiptDigest
        || context?.source?.handoff_digest !== sha256(canonicalJson(validated.handoff))
        || context?.source?.managed_receipt_digest !== validated.managed.receiptDigest
        || context.project_code !== validated.projectCode
        || receipt.project_code !== validated.projectCode
        || context.repository !== validated.managed.repository
        || receipt.repository !== validated.managed.repository
        || context.repository_root !== validated.managed.repositoryRoot
        || receipt.repository_root !== validated.managed.repositoryRoot
        || context.base_sha !== validated.managed.baseSha
        || receipt.base_sha !== validated.managed.baseSha
        || context.judgment?.resolution_id !== validated.managed.resolutionId
        || context.judgment?.receipt_digest !== validated.managed.receiptDigest
        || receipt.resolution_id !== validated.managed.resolutionId
        || context.judgment?.turn_id !== validated.managed.turnId
        || receipt.turn_id !== validated.managed.turnId
        || canonicalJson(context.outcome_case) !== canonicalJson(validated.outcomeCase)
        || canonicalJson(rawOutcomeCase) !== canonicalJson(validated.outcomeCase)) {
      return outcomeCaseProjectionStatus('untrusted', 'projection_identity_mismatch', storyId);
    }

    const ledger = await readHandoffConsumptionLedger(root, { verifySources: true });
    const entry = ledger.entries.find((candidate) => candidate.story_id === storyId);
    if (!entry || entry.receipt_digest !== validated.managed.receiptDigest
        || entry.project_code !== validated.projectCode
        || entry.repository !== validated.managed.repository
        || entry.base_sha !== validated.managed.baseSha) {
      return outcomeCaseProjectionStatus('untrusted', 'consumption_ledger_mismatch', storyId);
    }
    const sourcePath = await ledgerSourcePath(root, entry.source_artifact);
    const sourceReceipt = await readJson(sourcePath, 'consumed managed Brainbase handoff receipt');
    if (sourceReceipt?.receipt_digest !== entry.receipt_digest
        || sha256(canonicalManagedHandoffPayload(sourceReceipt)) !== entry.receipt_digest) {
      return outcomeCaseProjectionStatus('untrusted', 'consumption_ledger_mismatch', storyId);
    }
    const validatedSource = await validateManagedHandoff(
      sourceReceipt,
      storyId,
      root,
      config,
      options.now ?? (() => new Date()),
      options.env ?? process.env
    );
    if (validatedSource.managed?.schemaVersion !== MANAGED_HANDOFF_V2_SCHEMA
        || validatedSource.managed.receiptDigest !== entry.receipt_digest) {
      return outcomeCaseProjectionStatus('untrusted', 'consumption_ledger_mismatch', storyId);
    }
    return outcomeCaseProjectionStatus('trusted', 'verified_signed_managed_v2', storyId, validated.outcomeCase);
  } catch (error) {
    return classifyOutcomeCaseVerificationError(error, storyId);
  }
}

// Compatibility helper for callers that only need the safe projection. New
// PR surfaces must use the inspection result to disclose the suppression.
export async function verifyTrustedManagedV2OutcomeCase(repoRoot, storyId, rawOutcomeCase, options = {}) {
  const inspection = await inspectManagedV2OutcomeCaseProjection(repoRoot, storyId, rawOutcomeCase, options);
  return inspection.status === 'trusted' ? inspection.outcome_case : null;
}

function summarizeManagedReceipt(root, filePath, receipt, parseError = null) {
  const summary = {
    artifact: toWorkspaceRelative(root, filePath),
    status: parseError ? 'invalid' : 'discovered'
  };
  if (parseError) {
    summary.error = safeDeliveryError(parseError);
    return summary;
  }
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    summary.status = 'invalid';
    summary.error = 'receipt must be an object';
    return summary;
  }
  // A status/doctor surface may expose routing metadata, but never integrity
  // secrets or signature values.
  for (const field of [
    'schema_version',
    'story_id',
    'project_code',
    'repository',
    'repository_root',
    'base_sha',
    'issued_at',
    'expires_at',
    'turn_id',
    'resolution_id',
    'receipt_digest'
  ]) {
    if (receipt[field] !== undefined) summary[field] = receipt[field];
  }
  if (receipt.signature && typeof receipt.signature === 'object') {
    summary.signature = {
      algorithm: receipt.signature.algorithm,
      key_id: receipt.signature.key_id
    };
  }
  return summary;
}

/**
 * Read-only integration inventory for operators. This command deliberately
 * does not bind, repair, send, or rewrite any artifact.
 */
export async function getBrainbaseIntegrationStatus(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const config = options.config ?? await readBrainbaseConfig(root);
  const storyId = options.storyId ?? config?.brainbase?.current_story_id ?? null;
  const files = await discoverManagedHandoffFiles(root, config);
  const managed = isManagedBrainbaseConfig(config) || files.length > 0;
  const receipts = [];
  for (const filePath of files) {
    try {
      receipts.push(summarizeManagedReceipt(root, filePath, await readJson(filePath, 'managed Brainbase handoff')));
    } catch (error) {
      receipts.push(summarizeManagedReceipt(root, filePath, null, error));
    }
  }
  let gitContext = null;
  try {
    gitContext = await collectGitContext(root);
  } catch (error) {
    gitContext = { head_sha: null, error: safeDeliveryError(error) };
  }
  const binding = storyId
    ? {
        story_id: storyId,
        context: await readJsonIfExists(contextPath(root, storyId)),
        bind_receipt: await readJsonIfExists(bindReceiptPath(root, storyId)),
        // This inventory never revalidates the outcome-case transaction.
        // `pr prepare` is the sole surface that checks its signature, marker,
        // and ledger before projecting any outcome-case metadata.
        outcome_case_projection: outcomeCaseProjectionNotEvaluated(root, storyId)
      }
    : {
        story_id: null,
        context: null,
        bind_receipt: null,
        outcome_case_projection: outcomeCaseProjectionNotEvaluated(root, null)
      };
  const outboxFiles = await listOutboxFiles(root);
  const outbox = { total: outboxFiles.length, pending: 0, sent: 0, invalid: 0, entries: [] };
  for (const filePath of outboxFiles) {
    try {
      const item = await readJson(filePath, 'Brainbase outbox');
      const deliveryStatus = item?.delivery_status ?? item?.status;
      if (deliveryStatus === 'sent') outbox.sent += 1;
      else if (deliveryStatus === 'pending') outbox.pending += 1;
      else outbox.invalid += 1;
      outbox.entries.push({
        event_id: item?.event_id ?? null,
        status: deliveryStatus ?? 'invalid',
        attempts: Number(item?.attempts ?? item?.retry_count ?? 0),
        next_retry_at: item?.next_retry_at ?? null,
        artifact: toWorkspaceRelative(root, filePath)
      });
    } catch (error) {
      outbox.invalid += 1;
      outbox.entries.push({
        event_id: null,
        status: 'invalid',
        error: safeDeliveryError(error),
        artifact: toWorkspaceRelative(root, filePath)
      });
    }
  }
  return {
    schema_version: 'vibepro-brainbase-integration-status.v1',
    status: managed ? 'managed' : 'unmanaged',
    overall_status: managed
      ? (receipts.length > 0 || !isManagedBrainbaseConfig(config) ? 'attention' : 'missing_handoff')
      : 'unmanaged',
    managed,
    project_code: expectedBrainbaseProjectCode(config),
    repository: expectedBrainbaseRepository(config),
    current_head_sha: gitContext?.head_sha ?? null,
    handoff: {
      inbox_dir: BRAINBASE_HANDOFF_INBOX_DIR,
      count: receipts.length,
      receipts
    },
    binding,
    outbox
  };
}

/**
 * Validate the managed integration without mutating the repository. Doctor
 * reports a warning for pending delivery because verification remains valid;
 * malformed or missing trust/bind artifacts remain failures.
 */
export async function doctorBrainbaseIntegration(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const config = options.config ?? await readBrainbaseConfig(root);
  const storyId = options.storyId ?? config?.brainbase?.current_story_id ?? null;
  const status = await getBrainbaseIntegrationStatus(root, { ...options, config, storyId });
  const checks = [];
  const managed = status.managed;
  checks.push({
    id: 'management_mode',
    status: managed ? 'pass' : 'skip',
    detail: managed ? 'Brainbase managed integration is active' : 'repository is unmanaged'
  });
  if (!managed) {
    return {
      schema_version: 'vibepro-brainbase-doctor.v1',
      status: 'unmanaged',
      overall_status: 'unmanaged',
      story_id: storyId,
      checks,
      integration: status
    };
  }

  const files = await discoverManagedHandoffFiles(root, config);
  if (files.length === 0) {
    checks.push({ id: 'managed_handoff', status: 'fail', code: 'BRAINBASE_HANDOFF_MISSING', detail: 'managed handoff receipt is missing' });
  } else if (!storyId) {
    checks.push({ id: 'managed_handoff', status: 'unknown', detail: 'story_id is required to validate a receipt binding' });
  } else {
    let candidate = null;
    let candidatePath = null;
    let selectionError = null;
    try {
      const consumed = await ledgerEntryForStory(root, storyId);
      if (consumed) {
        candidatePath = await ledgerSourcePath(root, consumed.source_artifact);
        candidate = await readJson(candidatePath, 'managed Brainbase handoff');
        if (candidate?.receipt_digest !== consumed.receipt_digest) {
          selectionError = Object.assign(new Error('managed Brainbase handoff receipt does not match the consumed binding ledger'), { code: 'BRAINBASE_HANDOFF_LEDGER_MISMATCH' });
        }
      } else {
        const parsed = [];
        for (const filePath of files) {
          try {
            const raw = await readJson(filePath, 'managed Brainbase handoff');
            if (isManagedHandoffSchema(raw?.schema_version) && (raw.story_id === storyId || raw.story_id === null)) {
              parsed.push({ raw, filePath });
            }
          } catch {
            // Validation below reports the resulting missing/invalid state.
          }
        }
        if (parsed.length > 1) {
          selectionError = Object.assign(new Error(`managed Brainbase handoff receipt is ambiguous for Story ${storyId}`), { code: 'BRAINBASE_HANDOFF_AMBIGUOUS' });
        } else if (parsed.length === 1) {
          candidate = parsed[0].raw;
          candidatePath = parsed[0].filePath;
        }
      }
    } catch (error) {
      selectionError = error;
    }
    if (selectionError) {
      checks.push({ id: 'managed_handoff', status: 'fail', code: selectionError.code ?? 'BRAINBASE_HANDOFF_INVALID', detail: safeDeliveryError(selectionError), ...(candidatePath ? { artifact: toWorkspaceRelative(root, candidatePath) } : {}) });
    } else if (!candidate) {
      checks.push({ id: 'managed_handoff', status: 'fail', code: 'BRAINBASE_HANDOFF_STORY_MISMATCH', detail: `no handoff receipt matches Story ${storyId}` });
    } else {
      try {
        await validateManagedHandoff(candidate, storyId, root, config, options.now ?? (() => new Date()), options.env ?? process.env);
        checks.push({ id: 'managed_handoff', status: 'pass', artifact: toWorkspaceRelative(root, candidatePath) });
      } catch (error) {
        checks.push({ id: 'managed_handoff', status: 'fail', code: error.code ?? 'BRAINBASE_HANDOFF_INVALID', detail: safeDeliveryError(error), artifact: toWorkspaceRelative(root, candidatePath) });
      }
    }
  }

  if (storyId) {
    if (!status.binding.context) checks.push({ id: 'context', status: 'fail', detail: `Brainbase context is missing for Story ${storyId}` });
    else checks.push({ id: 'context', status: 'pass', artifact: toWorkspaceRelative(root, contextPath(root, storyId)) });
    if (!status.binding.bind_receipt) checks.push({ id: 'bind_receipt', status: 'fail', detail: `bind receipt is missing for Story ${storyId}` });
    else checks.push({ id: 'bind_receipt', status: 'pass', artifact: toWorkspaceRelative(root, bindReceiptPath(root, storyId)) });
    checks.push({
      id: 'outcome_case_projection',
      status: 'unknown',
      code: 'OUTCOME_CASE_PROJECTION_NOT_EVALUATED',
      detail: 'outcome-case trust and commit marker are evaluated only by pr prepare',
      reference: status.binding.outcome_case_projection.reference
    });
  } else {
    checks.push({ id: 'context', status: 'unknown', detail: 'story_id is required to inspect a binding' });
    checks.push({
      id: 'outcome_case_projection',
      status: 'unknown',
      code: 'OUTCOME_CASE_PROJECTION_NOT_EVALUATED',
      detail: 'story_id is required before pr prepare can evaluate outcome-case trust and commit marker',
      reference: null
    });
  }
  if (status.outbox.invalid > 0) checks.push({ id: 'outbox', status: 'fail', detail: `${status.outbox.invalid} invalid outbox entries` });
  else if (status.outbox.pending > 0) checks.push({ id: 'outbox', status: 'warn', detail: `${status.outbox.pending} learning candidate(s) pending delivery` });
  else checks.push({ id: 'outbox', status: 'pass', detail: 'outbox has no pending or invalid entries' });
  const hasFailure = checks.some((check) => check.status === 'fail');
  const hasWarning = checks.some((check) => check.status === 'warn' || check.status === 'unknown');
  return {
    schema_version: 'vibepro-brainbase-doctor.v1',
    status: hasFailure ? 'fail' : hasWarning ? 'warn' : 'pass',
    overall_status: hasFailure ? 'failed' : hasWarning ? 'attention' : 'healthy',
    story_id: storyId,
    checks,
    integration: status
  };
}

function outboxNow(now) {
  return dateFromOption(now).toISOString();
}

async function enqueueBrainbaseOutbox(repoRoot, event, options = {}) {
  const root = path.resolve(repoRoot);
  const outputPath = outboxPath(root, event.event_id);
  const existing = await readJsonIfExists(outputPath);
  if (existing) {
    if (existing.schema_version !== OUTBOX_SCHEMA || existing.event_id !== event.event_id) {
      throw new Error(`Brainbase outbox entry is invalid or collides with event ${event.event_id}`);
    }
    if (existing.candidate?.body_hash !== event.body_hash) {
      throw new Error(`Brainbase outbox event ${event.event_id} does not match the generated candidate`);
    }
    return {
      status: 'already_enqueued',
      event_id: event.event_id,
      delivery_status: existing.delivery_status ?? existing.status ?? 'pending',
      attempts: existing.attempts ?? existing.retry_count ?? 0,
      artifact: toWorkspaceRelative(root, outputPath)
    };
  }
  const createdAt = outboxNow(options.now ?? (() => new Date()));
  const outbox = {
    schema_version: OUTBOX_SCHEMA,
    outbox_id: `outbox_${event.event_id}`,
    event_id: event.event_id,
    kind: 'learning_candidate',
    status: 'pending',
    delivery_status: 'pending',
    attempts: 0,
    retry_count: 0,
    next_retry_at: null,
    last_error: null,
    created_at: createdAt,
    updated_at: createdAt,
    candidate: event
  };
  await writeJsonAtomic(outputPath, outbox);
  return {
    status: 'enqueued',
    event_id: event.event_id,
    delivery_status: outbox.delivery_status,
    attempts: outbox.attempts,
    artifact: toWorkspaceRelative(root, outputPath)
  };
}

function retryAt(now, attempts, delayMs) {
  const delay = Math.max(1, Number(delayMs) || 1000) * (2 ** Math.max(0, Math.min(attempts - 1, 8)));
  return new Date(dateFromOption(now).valueOf() + delay).toISOString();
}

function safeDeliveryError(error) {
  const message = String(error?.message ?? error ?? 'unknown delivery failure')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!message) return 'unknown delivery failure';
  if (isSensitive(message)) return 'delivery failed with a sensitive error that was redacted';
  return message.slice(0, 500);
}

function dueForRetry(item, now) {
  if (item.delivery_status === 'sent' || item.status === 'sent') return false;
  if (!item.next_retry_at) return true;
  const retryAtValue = Date.parse(item.next_retry_at);
  return Number.isFinite(retryAtValue) && retryAtValue <= dateFromOption(now).valueOf();
}

/**
 * Deliver durable Brainbase learning candidates. The transport is deliberately
 * injected by the host/CLI boundary; VibePro never treats a failed send as a
 * failed verification and leaves the candidate pending for a later retry.
 */
export async function reconcileBrainbaseOutbox(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const now = options.now ?? (() => new Date());
  const sender = options.send ?? options.sendCandidate ?? options.sender ?? null;
  const files = await listOutboxFiles(root);
  const result = {
    status: 'ok',
    attempted: 0,
    sent: 0,
    pending: 0,
    skipped: 0,
    failed: 0,
    entries: []
  };
  for (const filePath of files) {
    let item;
    try {
      item = JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
      result.failed += 1;
      result.entries.push({ artifact: toWorkspaceRelative(root, filePath), status: 'invalid', error: safeDeliveryError(error) });
      continue;
    }
    if (!item || item.schema_version !== OUTBOX_SCHEMA || !item.event_id || !item.candidate) {
      result.failed += 1;
      result.entries.push({ artifact: toWorkspaceRelative(root, filePath), status: 'invalid', error: 'outbox entry is invalid' });
      continue;
    }
    if (!dueForRetry(item, now)) {
      result.skipped += 1;
      result.entries.push({ event_id: item.event_id, status: item.delivery_status ?? item.status ?? 'pending' });
      continue;
    }
    if (typeof sender !== 'function') {
      result.pending += 1;
      result.entries.push({ event_id: item.event_id, status: 'pending', reason: 'sender_not_configured' });
      continue;
    }
    result.attempted += 1;
    const attempts = Number(item.attempts ?? item.retry_count ?? 0) + 1;
    try {
      await sender(item.candidate, item);
      const sentAt = outboxNow(now);
      const next = {
        ...item,
        status: 'sent',
        delivery_status: 'sent',
        attempts,
        retry_count: attempts,
        next_retry_at: null,
        last_error: null,
        sent_at: sentAt,
        updated_at: sentAt
      };
      await writeJsonAtomic(filePath, next);
      result.sent += 1;
      result.entries.push({ event_id: item.event_id, status: 'sent', attempts });
    } catch (error) {
      const failedAt = outboxNow(now);
      const next = {
        ...item,
        status: 'pending',
        delivery_status: 'pending',
        attempts,
        retry_count: attempts,
        next_retry_at: retryAt(now, attempts, options.retryDelayMs),
        last_error: safeDeliveryError(error),
        updated_at: failedAt
      };
      await writeJsonAtomic(filePath, next);
      result.pending += 1;
      result.failed += 1;
      result.entries.push({ event_id: item.event_id, status: 'pending', attempts, next_retry_at: next.next_retry_at, error: next.last_error });
    }
  }
  if (result.failed > 0) result.status = 'partial';
  return result;
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
  const requestedCapturedAt = dateFromOption(options.now ?? (() => new Date()));
  const capturedAt = requestedCapturedAt.valueOf() < Date.parse(occurredAt)
    ? occurredAt
    : requestedCapturedAt.toISOString();
  const trace = {
    turn_id: requiredString(context.judgment?.turn_id, 'context.judgment.turn_id'),
    resolution_id: requiredString(context.judgment?.resolution_id, 'context.judgment.resolution_id'),
    story_id: storyId,
    verified_head_sha: gitContext.head_sha,
    knowledge_event_id: eventId,
    reuse_receipt: {
      status: 'unknown',
      implementation: 'unimplemented',
      reason: 'reuse receipt contract is not implemented by VibePro'
    }
  };
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
    trace,
    body_hash: bodyHash,
    parent_episode_id: parentEpisodeId,
    payload
  };
  const outputPath = eventPath(root, storyId);
  const existingEvent = await readJsonIfExists(outputPath);
  const alreadyGenerated = existingEvent?.event_id === event.event_id
    && existingEvent?.body_hash === event.body_hash;
  if (!alreadyGenerated) await writeJsonAtomic(outputPath, event);
  const outbox = options.enqueue === false
    ? null
    : await enqueueBrainbaseOutbox(root, alreadyGenerated ? existingEvent : event, { now: options.now });
  return {
    status: alreadyGenerated ? 'already_generated' : 'generated',
    story_id: storyId,
    project_code: context.project_code,
    event_id: event.event_id,
    body_hash: event.body_hash,
    artifact: toWorkspaceRelative(root, outputPath),
    ...(outbox ? {
      outbox_status: outbox.status,
      delivery_status: outbox.delivery_status,
      outbox_artifact: outbox.artifact,
      outbox_attempts: outbox.attempts
    } : {})
  };
}

function computedPass(command) {
  return PASS_STATUSES.has(String(command?.status ?? '').toLowerCase())
    && COMPUTED_EVIDENCE_SOURCES.has(command?.evidence_source);
}

function isMeaningfulVerificationTransition(previousCommand, command, gitContext) {
  if (!computedPass(command)) return false;
  if (!previousCommand) return true;
  if (!COMPUTED_EVIDENCE_SOURCES.has(previousCommand.evidence_source)) return true;
  if (!PASS_STATUSES.has(String(previousCommand.status ?? '').toLowerCase())) return true;
  if (previousCommand.git_context?.head_sha !== gitContext.head_sha) return true;
  return !compareFingerprintContexts(previousCommand.git_context, gitContext).matches;
}

/**
 * Create exactly one learning candidate for a computed pass transition. A
 * self-reported pass, a repeated pass at the same verified HEAD, and a
 * non-passing command are intentionally no-ops.
 */
export async function enqueueBrainbaseLearningCandidate(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = safeIdentifier(options.storyId, 'story_id');
  const context = await readJsonIfExists(contextPath(root, storyId));
  if (!context) return { status: 'unmanaged', story_id: storyId };
  if (context.source?.managed_receipt_digest === undefined) {
    return { status: 'unmanaged', story_id: storyId };
  }
  const command = options.command ?? options.evidence?.commands?.[0];
  const gitContext = options.gitContext ?? await collectGitContext(root);
  if (!isMeaningfulVerificationTransition(options.previousCommand ?? null, command, gitContext)) {
    return {
      status: 'not_applicable',
      story_id: storyId,
      reason: computedPass(command) ? 'repeated_or_unchanged_verified_pass' : 'verification_is_not_a_computed_pass'
    };
  }
  const kind = requiredString(command.kind, 'verification.kind');
  const summary = requiredString(
    options.summary
      ?? command.summary
      ?? `Computed ${kind} verification passed at ${gitContext.head_sha}`,
    'summary'
  );
  let generated;
  try {
    generated = await createBrainbaseKnowledgeEvent(root, {
      storyId,
      summary,
      now: options.now,
      repositoryRef: options.repositoryRef
    });
  } catch (error) {
    return {
      status: 'pending',
      story_id: storyId,
      reason: 'candidate_generation_failed',
      error: safeDeliveryError(error)
    };
  }
  let delivery = null;
  if (typeof options.send === 'function' || typeof options.sendCandidate === 'function' || typeof options.sender === 'function') {
    delivery = await reconcileBrainbaseOutbox(root, {
      now: options.now,
      retryDelayMs: options.retryDelayMs,
      send: options.send ?? options.sendCandidate ?? options.sender
    });
  }
  return {
    ...generated,
    transition: 'computed_pass',
    ...(delivery ? { delivery } : {})
  };
}

export function renderBrainbaseContextBinding(result) {
  return `Brainbase context bound: ${result.story_id} (${result.knowledge_reference_count} knowledge references) -> ${result.artifact}\n`;
}

export function renderBrainbaseKnowledgeEvent(result) {
  const delivery = result.delivery_status ? ` (delivery: ${result.delivery_status})` : '';
  return `Brainbase Knowledge Event ${result.status ?? 'generated'}: ${result.event_id}${delivery} -> ${result.artifact}\n`;
}

export function renderBrainbaseIntegrationStatus(result) {
  const handoff = result.handoff?.count ?? 0;
  const pending = result.outbox?.pending ?? 0;
  const outcomeProjection = result.binding?.outcome_case_projection;
  const outcomeCaseStatus = outcomeProjection
    ? `\nOutcome case projection: ${outcomeProjection.status}${outcomeProjection.reference ? ` (run ${outcomeProjection.reference})` : ''}`
    : '';
  return `Brainbase integration ${result.status}: ${handoff} handoff receipt(s), ${pending} pending candidate(s)${outcomeCaseStatus}\n`;
}

export function renderBrainbaseDoctor(result) {
  const checks = (result.checks ?? []).map((check) => `${check.status}: ${check.id}${check.reference ? ` (run ${check.reference})` : ''}`).join(', ');
  return `Brainbase doctor ${result.status}: ${checks}\n`;
}
