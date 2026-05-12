import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

const ALLOWED_KINDS = new Set(['unit', 'integration', 'e2e', 'typecheck', 'build']);
const ALLOWED_STATUSES = new Set(['pass', 'passed', 'success', 'ok', 'fail', 'failed', 'error', 'needs_setup']);

export async function recordVerificationEvidence(repoRoot, options = {}) {
  const storyId = options.storyId;
  if (!storyId) throw new Error('verify record requires --id <story-id>');
  if (!ALLOWED_KINDS.has(options.kind)) {
    throw new Error(`verify record --kind must be one of: ${[...ALLOWED_KINDS].join(', ')}`);
  }
  if (!ALLOWED_STATUSES.has(options.status)) {
    throw new Error(`verify record --status must be one of: ${[...ALLOWED_STATUSES].join(', ')}`);
  }

  const root = path.resolve(repoRoot);
  await assertInitializedWorkspace(root);
  const prDir = path.join(getWorkspaceDir(root), 'pr', storyId);
  await mkdir(prDir, { recursive: true });
  const evidencePath = path.join(prDir, 'verification-evidence.json');
  const existing = await readEvidence(evidencePath, storyId);
  const command = {
    kind: normalizeKind(options.kind),
    status: options.status,
    command: options.command ?? null,
    summary: options.summary ?? options.status,
    artifact: options.artifact ? normalizeArtifact(root, options.artifact) : null,
    executed_at: options.executedAt ?? new Date().toISOString()
  };
  const commands = [
    command,
    ...existing.commands.filter((item) => normalizeKind(item.kind) !== command.kind)
  ];
  const evidence = {
    schema_version: '0.1.0',
    story_id: storyId,
    updated_at: new Date().toISOString(),
    commands
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  return {
    evidence,
    artifact: toWorkspaceRelative(root, evidencePath)
  };
}

export function renderVerificationEvidenceSummary(result) {
  const latest = result.evidence.commands[0];
  return `# VibePro Verification Evidence

- story: ${result.evidence.story_id}
- kind: ${latest.kind}
- status: ${latest.status}
- command: ${latest.command ?? '-'}
- artifact: ${result.artifact}
`;
}

async function readEvidence(evidencePath, storyId) {
  try {
    const parsed = JSON.parse(await readFile(evidencePath, 'utf8'));
    return {
      ...parsed,
      commands: Array.isArray(parsed.commands) ? parsed.commands : []
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {
      schema_version: '0.1.0',
      story_id: storyId,
      commands: []
    };
  }
}

async function assertInitializedWorkspace(repoRoot) {
  try {
    await readFile(path.join(getWorkspaceDir(repoRoot), 'vibepro-manifest.json'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('verify record requires an initialized VibePro workspace. Run `vibepro init <repo>` first.');
    }
    throw error;
  }
}

function normalizeKind(kind) {
  if (kind === 'typecheck' || kind === 'build') return 'integration';
  return kind;
}

function normalizeArtifact(repoRoot, artifact) {
  const resolved = path.resolve(repoRoot, artifact);
  return toWorkspaceRelative(repoRoot, resolved);
}
