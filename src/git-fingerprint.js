import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const USER_FINGERPRINT_EXCLUDE_PATHS = [
  '.vibepro/',
  '.worktrees/vibepro/'
];

const USER_PATHSPEC = [
  '.',
  ':(exclude).vibepro',
  ':(exclude).worktrees/vibepro'
];

export async function collectGitContext(repoRoot) {
  const [headSha, currentBranch, fingerprints] = await Promise.all([
    gitOptional(repoRoot, ['rev-parse', 'HEAD']),
    gitOptional(repoRoot, ['branch', '--show-current']),
    collectGitStatusFingerprints(repoRoot)
  ]);
  return {
    head_sha: headSha || null,
    current_branch: currentBranch || null,
    dirty: fingerprints.user_dirty,
    raw_dirty: fingerprints.dirty,
    status_fingerprint_hash: fingerprints.status_fingerprint_hash,
    user_status_fingerprint_hash: fingerprints.user_status_fingerprint_hash,
    fingerprint_scope: fingerprints.fingerprint_scope,
    recorded_at: new Date().toISOString()
  };
}

export async function collectGitStatusFingerprints(repoRoot) {
  const [statusOutput, userStatusOutput] = await Promise.all([
    gitStatus(repoRoot),
    gitStatus(repoRoot, USER_PATHSPEC)
  ]);
  const [dirtyDiff, userDirtyDiff] = await Promise.all([
    collectDirtyDiff(repoRoot),
    collectDirtyDiff(repoRoot, USER_PATHSPEC)
  ]);
  const fingerprintScope = {
    user_excludes: USER_FINGERPRINT_EXCLUDE_PATHS
  };
  return {
    status_output: statusOutput,
    user_status_output: userStatusOutput,
    dirty: statusOutput.length > 0,
    user_dirty: userStatusOutput.length > 0,
    status_fingerprint_hash: hashFingerprint(fingerprintStatus(statusOutput, dirtyDiff)),
    user_status_fingerprint_hash: hashFingerprint(fingerprintStatus(userStatusOutput, userDirtyDiff)),
    fingerprint_scope: fingerprintScope
  };
}

export function fingerprintHashForContext(gitContext) {
  if (gitContext?.user_status_fingerprint_hash) return gitContext.user_status_fingerprint_hash;
  return fullFingerprintHashForContext(gitContext);
}

export function compareFingerprintContexts(recordedContext, currentContext) {
  const usingUserFingerprint = Boolean(
    recordedContext?.user_status_fingerprint_hash
    && currentContext?.user_status_fingerprint_hash
  );
  const recorded = usingUserFingerprint
    ? recordedContext.user_status_fingerprint_hash
    : fullFingerprintHashForContext(recordedContext);
  const current = usingUserFingerprint
    ? currentContext.user_status_fingerprint_hash
    : fullFingerprintHashForContext(currentContext);
  return {
    matches: recorded === current,
    usingUserFingerprint,
    recorded,
    current
  };
}

export function fullFingerprintHashForContext(gitContext) {
  if (gitContext?.status_fingerprint_hash) return gitContext.status_fingerprint_hash;
  return hashFingerprint(gitContext?.status_fingerprint ?? '');
}

export function hashFingerprint(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function fingerprintStatus(statusOutput, dirtyDiff = '') {
  return [
    'git-status --porcelain -uall',
    String(statusOutput ?? '').trimEnd(),
    'git-diff --binary',
    String(dirtyDiff ?? '').trimEnd()
  ].join('\n');
}

async function gitStatus(repoRoot, pathspec = []) {
  const args = ['status', '--porcelain', '-uall'];
  if (pathspec.length > 0) args.push('--', ...pathspec);
  return gitOptional(repoRoot, args);
}

async function collectDirtyDiff(repoRoot, pathspec = []) {
  const diffPathspec = pathspec.length > 0 ? ['--', ...pathspec] : [];
  const [unstaged, staged, untracked] = await Promise.all([
    gitOptional(repoRoot, ['diff', '--binary', ...diffPathspec]),
    gitOptional(repoRoot, ['diff', '--cached', '--binary', ...diffPathspec]),
    collectUntrackedFileFingerprint(repoRoot, pathspec)
  ]);
  return [staged, unstaged, untracked].filter(Boolean).join('\n');
}

async function collectUntrackedFileFingerprint(repoRoot, pathspec = []) {
  const args = ['ls-files', '--others', '--exclude-standard'];
  if (pathspec.length > 0) args.push('--', ...pathspec);
  const output = await gitOptional(repoRoot, args);
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

async function gitOptional(repoRoot, args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: repoRoot, encoding: 'utf8' });
    return stdout.trimEnd();
  } catch {
    return '';
  }
}
