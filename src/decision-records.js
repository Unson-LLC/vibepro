import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';
import { refreshActiveRunContextCapsule } from './run-context-capsule.js';
import { resolvePrArtifactFile } from './artifact-routing.js';

const execFileAsync = promisify(execFile);

const DECISION_TYPES = new Set(['needs_review', 'noise', 'waiver', 'secret_exposure']);
const DECISION_STATUSES = new Set(['open', 'accepted', 'rejected', 'superseded']);
const SECRET_ACTIONS = new Set(['redacted', 'rotated', 'revoked', 'false_positive']);
const SECRET_PATTERNS = [
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\bsk-[0-9A-Za-z_-]{20,}\b/g,
  /\b(?:ghp|github_pat)_[0-9A-Za-z_]{20,}\b/g,
  /\b[A-Za-z0-9+/]{32,}={0,2}\b/g
];

export async function recordDecision(repoRoot, options = {}) {
  const storyId = requireValue(options.storyId, 'decision record requires --id <story-id>');
  const type = requireValue(options.type, 'decision record requires --type <needs_review|noise|waiver|secret_exposure>');
  if (!DECISION_TYPES.has(type)) {
    throw new Error(`decision record --type must be one of: ${[...DECISION_TYPES].join(', ')}`);
  }
  if (!options.summary && !options.stdinText) {
    throw new Error('decision record requires --summary <text> or --from-stdin');
  }
  if (type === 'waiver' && !options.reason) {
    throw new Error('decision record --type waiver requires --reason <text>');
  }
  if (type === 'noise' && !options.reason) {
    throw new Error('decision record --type noise requires --reason <text>');
  }
  if (type === 'secret_exposure') {
    if (!SECRET_ACTIONS.has(options.secretAction)) {
      throw new Error(`decision record --type secret_exposure requires --secret-action ${[...SECRET_ACTIONS].join('|')}`);
    }
    if (!options.secretLocation) {
      throw new Error('decision record --type secret_exposure requires --secret-location <ref>');
    }
  }

  const root = path.resolve(repoRoot);
  await assertInitializedWorkspace(root);
  const evidencePath = await resolvePrArtifactFile(root, storyId, 'decision-records.json');
  await mkdir(path.dirname(evidencePath), { recursive: true });
  const existing = await readDecisionRecords(root, storyId);
  const gitContext = await collectGitContext(root);
  const rawText = options.stdinText?.trim() || options.summary;
  const summaryRedaction = redactSecrets(rawText);
  const reasonRedaction = redactSecrets(options.reason ?? '');
  const managedWorktreeWarning = normalizeWarning(options.managedWorktreeWarning);
  const decisionStatus = normalizeStatus(options.status);
  const verificationEvidenceSummary = decisionStatus === 'accepted'
    ? await buildVerificationEvidenceSummary(root, storyId)
    : null;
  const decision = {
    schema_version: '0.1.0',
    decision_id: options.decisionId ?? `decision-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    story_id: storyId,
    type,
    status: decisionStatus,
    source: normalizeNullable(options.source),
    source_status: normalizeNullable(options.sourceStatus),
    summary: summaryRedaction.text,
    reason: reasonRedaction.text || null,
    reviewer: normalizeNullable(options.reviewer),
    artifact: options.artifact ? normalizeArtifact(root, options.artifact) : null,
    verification_evidence_summary: verificationEvidenceSummary,
    secret_exposure: type === 'secret_exposure' ? {
      location: options.secretLocation,
      action: options.secretAction,
      value_recorded: false,
      redaction_applied: summaryRedaction.redacted || reasonRedaction.redacted,
      note: 'Secret values are intentionally not stored in VibePro artifacts.'
    } : null,
    redaction: {
      applied: summaryRedaction.redacted || reasonRedaction.redacted,
      hit_count: summaryRedaction.hitCount + reasonRedaction.hitCount
    },
    warnings: managedWorktreeWarning ? [managedWorktreeWarning] : [],
    git_context: gitContext,
    recorded_at: new Date().toISOString()
  };
  const next = {
    schema_version: '0.1.0',
    model: 'vibepro-decision-records-v1',
    story_id: storyId,
    updated_at: new Date().toISOString(),
    warnings: mergeWarnings(existing.warnings, decision.warnings),
    decisions: [
      decision,
      ...existing.decisions.filter((item) => item.decision_id !== decision.decision_id)
    ]
  };
  await writeJsonAtomic(evidencePath, next);
  await refreshActiveRunContextCapsule(root, {
    storyId,
    reason: 'decision_recorded'
  });
  return {
    decision,
    records: next,
    artifact: toWorkspaceRelative(root, evidencePath)
  };
}

export async function getDecisionStatus(repoRoot, options = {}) {
  const storyId = requireValue(options.storyId, 'decision status requires --id <story-id>');
  const root = path.resolve(repoRoot);
  await assertInitializedWorkspace(root);
  const evidencePath = await resolvePrArtifactFile(root, storyId, 'decision-records.json');
  const records = await readDecisionRecords(root, storyId);
  return {
    story_id: storyId,
    artifact: toWorkspaceRelative(root, evidencePath),
    records,
    summary: summarizeDecisionRecords(records)
  };
}

export async function readDecisionRecordsIfExists(repoRoot, storyId) {
  const root = path.resolve(repoRoot);
  try {
    const evidencePath = await resolvePrArtifactFile(root, storyId, 'decision-records.json');
    const records = JSON.parse(await readFile(evidencePath, 'utf8'));
    return {
      ...records,
      decisions: Array.isArray(records.decisions) ? records.decisions : [],
      summary: summarizeDecisionRecords(records),
      artifact: toWorkspaceRelative(root, evidencePath)
    };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function renderDecisionRecordSummary(result) {
  const warnings = result.decision.warnings?.length
    ? result.decision.warnings.map((warning) => `- ${warning.id}: ${warning.reason}`).join('\n')
    : '- none';
  return `# VibePro Decision Record

- story: ${result.decision.story_id}
- decision: ${result.decision.decision_id}
- type: ${result.decision.type}
- status: ${result.decision.status}
- source: ${result.decision.source ?? '-'}
- artifact: ${result.artifact}

## Warnings

${warnings}
`;
}

export function renderDecisionStatusSummary(result) {
  const summary = result.summary;
  return `# VibePro Decision Records

- story: ${result.story_id}
- artifact: ${result.artifact}
- total: ${summary.total}
- open: ${summary.open}
- needs_review: ${summary.by_type.needs_review ?? 0}
- noise: ${summary.by_type.noise ?? 0}
- waiver: ${summary.by_type.waiver ?? 0}
- secret_exposure: ${summary.by_type.secret_exposure ?? 0}
`;
}

export function summarizeDecisionRecords(records) {
  const decisions = Array.isArray(records?.decisions) ? records.decisions : [];
  const byType = {};
  const byStatus = {};
  for (const decision of decisions) {
    byType[decision.type] = (byType[decision.type] ?? 0) + 1;
    byStatus[decision.status] = (byStatus[decision.status] ?? 0) + 1;
  }
  return {
    total: decisions.length,
    open: decisions.filter((decision) => decision.status === 'open').length,
    by_type: byType,
    by_status: byStatus,
    warnings: Array.isArray(records?.warnings) ? records.warnings : [],
    latest: decisions[0] ?? null
  };
}

// Retrieves a 1-hop summary of the verification artifacts (from
// `verify record` / verification-evidence.json) that backed an `accepted`
// decision, so downstream consumers (pr-manager.js, cross-repo handoff flows)
// do not have to separately open and cross-reference verification-evidence.json.
async function buildVerificationEvidenceSummary(repoRoot, storyId) {
  const evidencePath = await resolvePrArtifactFile(repoRoot, storyId, 'verification-evidence.json');
  let parsed;
  try {
    parsed = JSON.parse(await readFile(evidencePath, 'utf8'));
  } catch {
    return { count: 0, entries: [] };
  }
  const commands = Array.isArray(parsed?.commands) ? parsed.commands : [];
  const fallbackPath = toWorkspaceRelative(repoRoot, evidencePath);
  const entries = commands.map((command) => ({
    path: command?.artifact ?? fallbackPath,
    type: command?.kind ?? null,
    result: command?.status ?? null
  }));
  return { count: entries.length, entries };
}

async function readDecisionRecords(repoRoot, storyId) {
  try {
    const recordsPath = await resolvePrArtifactFile(repoRoot, storyId, 'decision-records.json');
    const parsed = JSON.parse(await readFile(recordsPath, 'utf8'));
    return {
      ...parsed,
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : []
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        schema_version: '0.1.0',
        model: 'vibepro-decision-records-v1',
        story_id: storyId,
        warnings: [],
        decisions: []
      };
    }
    throw error;
  }
}

async function assertInitializedWorkspace(repoRoot) {
  try {
    await readFile(path.join(getWorkspaceDir(repoRoot), 'vibepro-manifest.json'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('decision record requires an initialized VibePro workspace. Run `vibepro init <repo>` first.');
    }
    throw error;
  }
}

function requireValue(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function normalizeStatus(status) {
  const value = status ?? 'accepted';
  if (!DECISION_STATUSES.has(value)) {
    throw new Error(`decision record --status must be one of: ${[...DECISION_STATUSES].join(', ')}`);
  }
  return value;
}

function normalizeNullable(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeArtifact(repoRoot, artifact) {
  return toWorkspaceRelative(repoRoot, path.resolve(repoRoot, artifact));
}

function normalizeWarning(warning) {
  return warning && typeof warning === 'object' ? warning : null;
}

function mergeWarnings(existing = [], next = []) {
  const warnings = [];
  const seen = new Set();
  for (const warning of [...next, ...existing]) {
    if (!warning?.id) continue;
    const key = `${warning.id}:${warning.command_name ?? ''}:${warning.reason ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    warnings.push(warning);
  }
  return warnings;
}

function redactSecrets(value) {
  let text = String(value ?? '');
  let hitCount = 0;
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (match) => {
      hitCount += 1;
      return `[REDACTED:${hashSecret(match)}]`;
    });
  }
  return {
    text,
    redacted: hitCount > 0,
    hitCount
  };
}

function hashSecret(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

async function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function collectGitContext(repoRoot) {
  const [headSha, currentBranch, statusOutput] = await Promise.all([
    gitOptional(repoRoot, ['rev-parse', 'HEAD']),
    gitOptional(repoRoot, ['branch', '--show-current']),
    gitOptional(repoRoot, ['status', '--porcelain', '-uall'])
  ]);
  return {
    head_sha: headSha || null,
    current_branch: currentBranch || null,
    dirty: statusOutput.length > 0,
    status_fingerprint: statusOutput.split('\n').map((line) => line.trimEnd()).filter(Boolean).sort().join('\n'),
    recorded_at: new Date().toISOString()
  };
}

async function gitOptional(repoRoot, args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: repoRoot, encoding: 'utf8' });
    return stdout.trim();
  } catch {
    return '';
  }
}
