import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

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
  const decisionDir = getDecisionDir(root, storyId);
  await mkdir(decisionDir, { recursive: true });
  const evidencePath = getDecisionRecordsPath(root, storyId);
  const existing = await readDecisionRecords(root, storyId);
  const gitContext = await collectGitContext(root);
  const rawText = options.stdinText?.trim() || options.summary;
  const summaryRedaction = redactSecrets(rawText);
  const reasonRedaction = redactSecrets(options.reason ?? '');
  const decision = {
    schema_version: '0.1.0',
    decision_id: options.decisionId ?? `decision-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    story_id: storyId,
    type,
    status: normalizeStatus(options.status),
    source: normalizeNullable(options.source),
    source_status: normalizeNullable(options.sourceStatus),
    summary: summaryRedaction.text,
    reason: reasonRedaction.text || null,
    reviewer: normalizeNullable(options.reviewer),
    artifact: options.artifact ? normalizeArtifact(root, options.artifact) : null,
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
    git_context: gitContext,
    recorded_at: new Date().toISOString()
  };
  const next = {
    schema_version: '0.1.0',
    model: 'vibepro-decision-records-v1',
    story_id: storyId,
    updated_at: new Date().toISOString(),
    decisions: [
      decision,
      ...existing.decisions.filter((item) => item.decision_id !== decision.decision_id)
    ]
  };
  await writeJsonAtomic(evidencePath, next);
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
  const records = await readDecisionRecords(root, storyId);
  return {
    story_id: storyId,
    artifact: toWorkspaceRelative(root, getDecisionRecordsPath(root, storyId)),
    records,
    summary: summarizeDecisionRecords(records)
  };
}

export async function readDecisionRecordsIfExists(repoRoot, storyId) {
  const root = path.resolve(repoRoot);
  try {
    const records = JSON.parse(await readFile(getDecisionRecordsPath(root, storyId), 'utf8'));
    return {
      ...records,
      decisions: Array.isArray(records.decisions) ? records.decisions : [],
      summary: summarizeDecisionRecords(records),
      artifact: toWorkspaceRelative(root, getDecisionRecordsPath(root, storyId))
    };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function renderDecisionRecordSummary(result) {
  return `# VibePro Decision Record

- story: ${result.decision.story_id}
- decision: ${result.decision.decision_id}
- type: ${result.decision.type}
- status: ${result.decision.status}
- source: ${result.decision.source ?? '-'}
- artifact: ${result.artifact}
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
    latest: decisions[0] ?? null
  };
}

async function readDecisionRecords(repoRoot, storyId) {
  try {
    const parsed = JSON.parse(await readFile(getDecisionRecordsPath(repoRoot, storyId), 'utf8'));
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
        decisions: []
      };
    }
    throw error;
  }
}

function getDecisionDir(repoRoot, storyId) {
  return path.join(getWorkspaceDir(repoRoot), 'pr', storyId);
}

function getDecisionRecordsPath(repoRoot, storyId) {
  return path.join(getDecisionDir(repoRoot, storyId), 'decision-records.json');
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
