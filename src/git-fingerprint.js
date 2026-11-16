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

export async function collectGitContext(repoRoot, options = {}) {
  const [headSha, currentBranch, fingerprints] = await Promise.all([
    gitOptional(repoRoot, ['rev-parse', 'HEAD']),
    gitOptional(repoRoot, ['branch', '--show-current']),
    collectGitStatusFingerprints(repoRoot, options)
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

export async function collectGitStatusFingerprints(repoRoot, options = {}) {
  const additionalUserExcludePaths = normalizeUserExcludePaths(options.userExcludePaths);
  const userExcludePaths = [...USER_FINGERPRINT_EXCLUDE_PATHS, ...additionalUserExcludePaths];
  const userPathspec = [
    ...USER_PATHSPEC,
    ...additionalUserExcludePaths.map((filePath) => `:(exclude,literal)${filePath}`)
  ];
  // .vibepro/config.json used to be folded back into the user fingerprint so
  // that hand-edits to it (e.g. story registration) would count as a "user"
  // change. That re-inclusion meant recording a review, then merely
  // `git commit`-ing an already-present config.json edit (routine per
  // story add / select, which requires `git add -f .vibepro/config.json`)
  // flipped the tracked file from "dirty diff" to "clean, committed" even
  // though its bytes never changed relative to what the review inspected —
  // which changed the user status fingerprint hash and falsely staled every
  // content_surface review for that story (see issue #436 item 1). Content
  // freshness for content_surface reviews is already governed by
  // content-binding.js's per-file surface hash of the actually-inspected
  // files; the coarse repo-wide user fingerprint only needs to catch edits
  // to files outside that surface, so .vibepro/ (config.json included) stays
  // fully excluded like every other VibePro-managed path.
  const [statusOutput, userStatusOutput] = await Promise.all([
    gitStatus(repoRoot),
    gitStatus(repoRoot, userPathspec)
  ]);
  const [dirtyDiff, userDirtyDiff] = await Promise.all([
    collectDirtyDiff(repoRoot),
    collectDirtyDiff(repoRoot, userPathspec)
  ]);
  const fingerprintScope = {
    user_excludes: userExcludePaths
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

function normalizeUserExcludePaths(paths = []) {
  const normalized = [];
  for (const value of paths ?? []) {
    const filePath = String(value ?? '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
    if (!filePath || path.posix.isAbsolute(filePath) || filePath.includes('\0')) continue;
    if (filePath.split('/').includes('..')) continue;
    normalized.push(filePath);
  }
  return [...new Set(normalized)];
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
