import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

const execFileAsync = promisify(execFile);
const ALLOWED_KINDS = new Set(['unit', 'integration', 'e2e', 'typecheck', 'build']);
const ALLOWED_STATUSES = new Set(['pass', 'passed', 'success', 'ok', 'fail', 'failed', 'error', 'needs_setup']);
const EVIDENCE_LOCK_TIMEOUT_MS = 10000;
const EVIDENCE_LOCK_STALE_MS = 60000;

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
  const gitContext = await collectEvidenceGitContext(root);
  const evidence = await withEvidenceLock(evidencePath, async () => {
    const existing = await readEvidence(root, evidencePath, storyId);
    const command = {
      kind: options.kind,
      status: options.status,
      command: options.command ?? null,
      summary: options.summary ?? options.status,
      artifact: options.artifact ? normalizeArtifact(root, options.artifact) : null,
      executed_at: options.executedAt ?? new Date().toISOString(),
      git_context: gitContext
    };
    const commands = [
      command,
      ...existing.commands.filter((item) => item.kind !== command.kind)
    ];
    const nextEvidence = {
      schema_version: '0.1.0',
      story_id: storyId,
      updated_at: new Date().toISOString(),
      commands
    };
    await writeJsonAtomic(evidencePath, nextEvidence);
    return nextEvidence;
  });
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

async function readEvidence(repoRoot, evidencePath, storyId) {
  try {
    const parsed = JSON.parse(await readFile(evidencePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new SyntaxError('verification evidence root must be a JSON object');
    }
    return {
      ...parsed,
      commands: Array.isArray(parsed.commands) ? parsed.commands : []
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        schema_version: '0.1.0',
        story_id: storyId,
        commands: []
      };
    }
    if (error instanceof SyntaxError) {
      const backupPath = await quarantineCorruptEvidence(repoRoot, evidencePath);
      throw new Error(
        `verification evidence JSON is corrupt: ${toWorkspaceRelative(repoRoot, evidencePath)}. ` +
        `Moved the corrupt file to ${toWorkspaceRelative(repoRoot, backupPath)}; inspect it before recording new evidence.`
      );
    }
    throw error;
  }
}

async function quarantineCorruptEvidence(repoRoot, evidencePath) {
  const backupPath = `${evidencePath}.corrupt-${Date.now()}-${process.pid}.bak`;
  await rename(evidencePath, backupPath);
  return backupPath;
}

async function withEvidenceLock(evidencePath, action) {
  const lockPath = `${evidencePath}.lock`;
  await acquireLock(lockPath);
  try {
    return await action();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

async function acquireLock(lockPath) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < EVIDENCE_LOCK_TIMEOUT_MS) {
    try {
      await mkdir(lockPath);
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await removeStaleLock(lockPath);
      await sleep(25 + Math.floor(Math.random() * 25));
    }
  }
  throw new Error(`Timed out waiting for verification evidence lock: ${lockPath}`);
}

async function removeStaleLock(lockPath) {
  try {
    const info = await stat(lockPath);
    if (Date.now() - info.mtimeMs > EVIDENCE_LOCK_STALE_MS) {
      await rm(lockPath, { recursive: true, force: true });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(
    dir,
    `.${base}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
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

function normalizeArtifact(repoRoot, artifact) {
  const resolved = path.resolve(repoRoot, artifact);
  return toWorkspaceRelative(repoRoot, resolved);
}

async function collectEvidenceGitContext(repoRoot) {
  const [headSha, currentBranch, statusOutput] = await Promise.all([
    gitOptional(repoRoot, ['rev-parse', 'HEAD']),
    gitOptional(repoRoot, ['branch', '--show-current']),
    gitStatus(repoRoot)
  ]);
  const dirtyDiff = await collectDirtyDiff(repoRoot);
  return {
    head_sha: headSha || null,
    current_branch: currentBranch || null,
    dirty: statusOutput.length > 0,
    status_fingerprint_hash: hashFingerprint(fingerprintStatus(statusOutput, dirtyDiff)),
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

async function gitStatus(repoRoot) {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-uall'], { cwd: repoRoot, encoding: 'utf8' });
    return stdout.trimEnd();
  } catch {
    return '';
  }
}

async function collectDirtyDiff(repoRoot) {
  const [unstaged, staged, untracked] = await Promise.all([
    gitOptional(repoRoot, ['diff', '--binary']),
    gitOptional(repoRoot, ['diff', '--cached', '--binary']),
    collectUntrackedFileFingerprint(repoRoot)
  ]);
  return [staged, unstaged, untracked].filter(Boolean).join('\n');
}

async function collectUntrackedFileFingerprint(repoRoot) {
  const output = await gitOptional(repoRoot, ['ls-files', '--others', '--exclude-standard']);
  const files = output.split('\n').filter(Boolean).sort().slice(0, 200);
  const chunks = [];
  for (const file of files) {
    try {
      const content = await readFile(path.join(repoRoot, file), 'utf8');
      chunks.push(`untracked:${file}\n${content}`);
    } catch {
      chunks.push(`untracked:${file}\n<unreadable>`);
    }
  }
  return chunks.join('\n');
}

function fingerprintStatus(statusOutput, dirtyDiff = '') {
  return [
    'git-status --porcelain -uall',
    String(statusOutput ?? '').trimEnd(),
    'git-diff --binary',
    String(dirtyDiff ?? '').trimEnd()
  ].join('\n');
}

function hashFingerprint(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}
