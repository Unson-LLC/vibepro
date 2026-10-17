import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir, toWorkspaceRelative, WORKSPACE_DIR } from './workspace.js';

const AUDIT_RELATIVE = path.join('multi-tenancy', 'applicability-declarations.jsonl');

export function getMultiTenantApplicabilityAuditPath(repoRoot) {
  return path.join(getWorkspaceDir(repoRoot), 'multi-tenancy', 'applicability-declarations.jsonl');
}

/**
 * Append one auditable record for a multi_tenancy non-applicability declaration.
 */
export async function recordMultiTenantApplicabilityDeclarationAudit(repoRoot, entry) {
  const root = path.resolve(repoRoot);
  const logPath = path.join(root, WORKSPACE_DIR, AUDIT_RELATIVE);
  await mkdir(path.dirname(logPath), { recursive: true });
  const record = {
    recorded_at: new Date().toISOString(),
    story_id: entry.story_id ?? null,
    spec_id: entry.spec_id ?? entry.story_id ?? null,
    declared_applicability: entry.declared_applicability ?? null,
    reason: entry.reason ?? null,
    evidence_ref: entry.evidence_ref ?? null,
    accepted: entry.accepted === true,
    refusal_reason: entry.refusal_reason ?? null,
    strong_signals: Array.isArray(entry.strong_signals) ? entry.strong_signals : []
  };
  await appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf8');
  return {
    artifact: toWorkspaceRelative(root, logPath),
    record
  };
}
