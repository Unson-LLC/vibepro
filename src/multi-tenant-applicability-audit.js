import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir, toWorkspaceRelative, WORKSPACE_DIR } from './workspace.js';

const AUDIT_RELATIVE = path.join('multi-tenancy', 'applicability-declarations.jsonl');

export function getMultiTenantApplicabilityAuditPath(repoRoot) {
  return path.join(getWorkspaceDir(repoRoot), 'multi-tenancy', 'applicability-declarations.jsonl');
}

export function buildMultiTenantApplicabilityAuditDedupKey(record) {
  return JSON.stringify({
    spec_id: record.spec_id ?? record.story_id ?? null,
    head_commit: record.head_commit ?? null,
    declared_applicability: record.declared_applicability ?? null,
    reason: record.reason ?? null,
    evidence_ref: record.evidence_ref ?? null,
    accepted: record.accepted === true
  });
}

async function auditLogHasDedupKey(logPath, dedupKey) {
  try {
    const existing = await readFile(logPath, 'utf8');
    for (const line of existing.split('\n')) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line);
      if (buildMultiTenantApplicabilityAuditDedupKey(parsed) === dedupKey) return true;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return false;
}

/**
 * Append one auditable record for a reasoned multi_tenancy non-applicability declaration.
 * Skips draft mode, non-reasoned paths, and duplicate content.
 */
export async function recordMultiTenantApplicabilityDeclarationAudit(repoRoot, entry, options = {}) {
  if (options.mode !== 'final') return { skipped: 'draft_mode' };
  if (!entry?.reasoned_attempted) return { skipped: 'not_reasoned_declaration' };

  const root = path.resolve(repoRoot);
  const logPath = path.join(root, WORKSPACE_DIR, AUDIT_RELATIVE);
  const record = {
    recorded_at: new Date().toISOString(),
    story_id: entry.story_id ?? null,
    spec_id: entry.spec_id ?? entry.story_id ?? null,
    head_commit: entry.head_commit ?? null,
    declared_applicability: entry.declared_applicability ?? null,
    reason: entry.reason ?? null,
    evidence_ref: entry.evidence_ref ?? null,
    accepted: entry.accepted === true,
    refusal_reason: entry.refusal_reason ?? null,
    strong_signals: Array.isArray(entry.strong_signals) ? entry.strong_signals : []
  };
  const dedupKey = buildMultiTenantApplicabilityAuditDedupKey(record);
  if (await auditLogHasDedupKey(logPath, dedupKey)) {
    return { skipped: 'duplicate', artifact: toWorkspaceRelative(root, logPath), record };
  }

  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf8');
  return {
    artifact: toWorkspaceRelative(root, logPath),
    record
  };
}
