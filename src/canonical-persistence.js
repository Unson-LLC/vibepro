import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeManagedCommand, sanitizeDiagnostic } from './managed-command-executor.js';
import { isSafeStoryId } from './story-id.js';

/**
 * Persist a prepared canonical artifact set onto the verified post-merge base.
 * Callers own artifact generation; this service owns base verification,
 * detached-worktree staging, idempotent commit/push, and cleanup.
 */
export async function persistCanonicalArtifactsToBase({
  repoRoot,
  storyId,
  relativeDir,
  allowedRoots = [relativeDir],
  baseBranch,
  mergeCommitSha,
  commitMessage = `docs: persist VibePro audit artifacts for ${storyId}`,
  options = {},
  prepare = null
} = {}) {
  const root = path.resolve(repoRoot);
  const validStoryId = isSafeStoryId(storyId);
  const tempWorktree = validStoryId
    ? path.join(os.tmpdir(), `vibepro-canonical-audit-${storyId}-${Date.now()}`)
    : null;
  const commands = [];
  const results = [];
  const summary = {
    schema_version: '0.1.0', status: 'not_run', base: baseBranch,
    directory: relativeDir, worktree_path: tempWorktree, base_head_sha: null,
    merge_commit_on_base: null, commit_sha: null, pushed: false, reason: null,
    failure: null,
    primary: { status: 'not_run', reason: null, failure: null },
    resource: { acquisition: 'not_attempted' },
    push_postcondition: { status: 'not_checked', remote_sha: null },
    cleanup: {
      attempted: false, removed: false, exit_code: null,
      status: 'not_required', failure: null
    },
    commands, results
  };
  if (!validStoryId) return failed('canonical_audit_story_id_invalid');
  if (!mergeCommitSha) return failed('canonical_audit_merge_commit_missing');

  const run = async (command, execution = {}) => {
    const result = await executeManagedCommand({
      command,
      stage: execution.stage ?? 'canonical.command',
      cwd: execution.cwd ?? root,
      env: options.env,
      timeoutMs: execution.timeoutMs ?? options.commandTimeoutMs,
      terminationGraceMs: options.terminationGraceMs,
      closeTimeoutMs: options.closeTimeoutMs,
      maxOutputBytes: options.maxDiagnosticBytes,
      redactValues: options.redactValues,
      runner: typeof options.commandRunner === 'function'
        ? ({ runDefault, signal, deadlineAt, timeoutMs }) => options.commandRunner({
          repoRoot: root, command, execution, runDefault, signal, deadlineAt, timeoutMs
        })
        : null
    });
    commands.push(result.command);
    results.push(result);
    return result;
  };
  const gitRequiredIdentity = async (cwd, args, stage) => {
    const result = await run(['git', args], { cwd, stage });
    const value = result.exit_code === 0 ? result.stdout.trim() : '';
    return {
      value: /^[0-9a-f]{40,64}$/i.test(value) ? value : null,
      result
    };
  };
  const gitIsAncestor = async (cwd, ancestor, descendant, stage) => {
    if (!ancestor || !descendant) return false;
    if (ancestor === descendant) return true;
    return (await run(['git', ['merge-base', '--is-ancestor', ancestor, descendant]], { cwd, stage })).exit_code === 0;
  };

  const fetchResult = await run(['git', ['fetch', 'origin', baseBranch]], { stage: 'canonical.post_merge_fetch' });
  if (fetchResult.exit_code !== 0) return failed('canonical_audit_post_merge_base_fetch_failed', null, fetchResult);
  const baseIdentity = await gitRequiredIdentity(root, ['rev-parse', `origin/${baseBranch}`], 'canonical.base_head');
  if (!baseIdentity.value) {
    return failed('canonical_audit_base_head_identity_unavailable', null, baseIdentity.result);
  }
  summary.base_head_sha = baseIdentity.value;
  summary.merge_commit_on_base = await gitIsAncestor(root, mergeCommitSha, `origin/${baseBranch}`, 'canonical.merge_on_base');
  if (!summary.merge_commit_on_base) return failed('canonical_audit_post_merge_base_missing_merge_commit');

  let ownsPossibleWorktree = false;
  try {
    const addWorktree = await run(
      ['git', ['worktree', 'add', '--detach', tempWorktree, `origin/${baseBranch}`]],
      { stage: 'canonical.worktree_add' }
    );
    if (addWorktree.exit_code !== 0) {
      const worktreeList = await run(
        ['git', ['worktree', 'list', '--porcelain']],
        { stage: 'canonical.worktree_acquisition_probe', timeoutMs: options.cleanupTimeoutMs }
      );
      const registeredAfterFailure = worktreeList.exit_code === 0
        && worktreeList.stdout.split(/\r?\n/).some((line) => {
          if (!line.startsWith('worktree ')) return false;
          return comparablePath(line.slice('worktree '.length)) === comparablePath(tempWorktree);
        });
      const acquisitionUncertain = worktreeList.exit_code !== 0
        || ['timed_out', 'indeterminate'].includes(addWorktree.status);
      summary.resource.acquisition = registeredAfterFailure
        ? 'partially_acquired'
        : acquisitionUncertain ? 'indeterminate' : 'not_acquired';
      ownsPossibleWorktree = registeredAfterFailure || acquisitionUncertain;
      return failed('canonical_audit_worktree_add_failed', null, addWorktree);
    }
    summary.resource.acquisition = 'acquired';
    ownsPossibleWorktree = true;

    let prepared;
    try {
      prepared = await prepare?.({ worktreeRoot: tempWorktree }) ?? { files: new Map(), metadata: null };
      if (!(prepared.files instanceof Map)) return failed('canonical_audit_prepare_files_invalid', prepared?.metadata ?? null);
    } catch (error) {
      return failed(error.code === 'canonical_path_not_allowed' ? error.code : 'canonical_audit_prepare_failed', {
        error: sanitizeDiagnostic(error.message, { maxBytes: options.maxDiagnosticBytes, redactValues: options.redactValues })
      });
    }
    try {
      const preparedTargets = [];
      for (const [relativePath, bytes] of prepared.files) {
        assertAllowedPath(relativePath, allowedRoots);
        preparedTargets.push({ relativePath, bytes, target: path.resolve(tempWorktree, relativePath) });
      }
      for (const { bytes, target } of preparedTargets) {
        await (options.mkdir ?? mkdir)(path.dirname(target), { recursive: true });
        await (options.writeFile ?? writeFile)(target, bytes);
      }
    } catch (error) {
      return failed(error.code === 'canonical_path_not_allowed' ? error.code : 'canonical_audit_write_failed', {
        ...prepared.metadata,
        error: sanitizeDiagnostic(error.message, { maxBytes: options.maxDiagnosticBytes, redactValues: options.redactValues })
      });
    }
    const stagePaths = [...new Set([...prepared.files.keys()])].sort();
    if (stagePaths.length === 0) return failed('canonical_audit_prepare_empty', prepared.metadata);
    const addResult = await run(['git', ['add', '--', ...stagePaths]], { cwd: tempWorktree, stage: 'canonical.git_add' });
    if (addResult.exit_code !== 0) return failed('canonical_audit_git_add_failed', prepared.metadata, addResult);
    const diffResult = await run(['git', ['diff', '--cached', '--quiet', '--', ...stagePaths]], { cwd: tempWorktree, stage: 'canonical.diff_check' });
    if (diffResult.exit_code === 0) {
      succeed('already_present', 'canonical_audit_already_present_on_base');
      return { summary, prepared: prepared.metadata };
    }
    if (diffResult.exit_code !== 1) return failed('canonical_audit_diff_check_failed', prepared.metadata, diffResult);
    const commitResult = await run(['git', ['commit', '-m', commitMessage]], { cwd: tempWorktree, stage: 'canonical.commit' });
    if (commitResult.exit_code !== 0) return failed('canonical_audit_commit_failed', prepared.metadata, commitResult);
    const commitIdentity = await gitRequiredIdentity(tempWorktree, ['rev-parse', 'HEAD'], 'canonical.commit_head');
    if (!commitIdentity.value) {
      return failed('canonical_audit_commit_identity_unavailable', prepared.metadata, commitIdentity.result);
    }
    summary.commit_sha = commitIdentity.value;
    await options.beforePush?.({ repoRoot: root, worktreeRoot: tempWorktree, summary });
    const refetchResult = await run(['git', ['fetch', 'origin', baseBranch]], { stage: 'canonical.pre_push_fetch' });
    if (refetchResult.exit_code !== 0) return failed('canonical_audit_pre_push_base_fetch_failed', prepared.metadata, refetchResult);
    const latestBaseIdentity = await gitRequiredIdentity(root, ['rev-parse', `origin/${baseBranch}`], 'canonical.latest_base_head');
    if (!latestBaseIdentity.value) {
      return failed('canonical_audit_latest_base_head_identity_unavailable', prepared.metadata, latestBaseIdentity.result);
    }
    const latestBaseHead = latestBaseIdentity.value;
    if (latestBaseHead !== summary.base_head_sha) {
      return failed('canonical_audit_concurrent_base_update', { ...prepared.metadata, latest_base_head_sha: latestBaseHead });
    }
    if (!await gitIsAncestor(root, mergeCommitSha, `origin/${baseBranch}`, 'canonical.pre_push_merge_on_base')) {
      return failed('canonical_audit_pre_push_base_missing_merge_commit', prepared.metadata);
    }
    const pushResult = await run(
      ['git', ['push', 'origin', `HEAD:${baseBranch}`]],
      { cwd: tempWorktree, stage: 'canonical.push', timeoutMs: options.pushTimeoutMs }
    );
    if (pushResult.exit_code !== 0) {
      if (['timed_out', 'indeterminate'].includes(pushResult.status)) {
        const postcondition = await run(
          ['git', ['ls-remote', 'origin', `refs/heads/${baseBranch}`]],
          { stage: 'canonical.push_postcondition', timeoutMs: options.postconditionTimeoutMs }
        );
        const remoteSha = postcondition.exit_code === 0 ? postcondition.stdout.trim().split(/\s+/)[0] ?? null : null;
        summary.push_postcondition.remote_sha = remoteSha;
        summary.push_postcondition.status = postcondition.exit_code !== 0
          ? 'indeterminate'
          : remoteSha === summary.commit_sha ? 'applied' : 'not_applied';
        if (summary.push_postcondition.status === 'applied') {
          summary.pushed = true;
          succeed('pushed', `canonical audit bundle persisted after merge ${mergeCommitSha}`);
          return { summary, prepared: prepared.metadata };
        }
        return failed(
          summary.push_postcondition.status === 'not_applied'
            ? 'canonical_audit_push_failed'
            : 'canonical_audit_push_indeterminate',
          prepared.metadata,
          pushResult
        );
      }
      return failed('canonical_audit_push_failed', prepared.metadata, pushResult);
    }
    summary.pushed = true;
    succeed('pushed', `canonical audit bundle persisted after merge ${mergeCommitSha}`);
    return { summary, prepared: prepared.metadata };
  } finally {
    if (ownsPossibleWorktree) {
      summary.cleanup.attempted = true;
      const removeResult = await run(
        ['git', ['worktree', 'remove', '--force', tempWorktree]],
        { stage: 'canonical.worktree_cleanup', timeoutMs: options.cleanupTimeoutMs }
      );
      summary.cleanup.exit_code = removeResult.exit_code;
      summary.cleanup.removed = removeResult.exit_code === 0;
      summary.cleanup.status = removeResult.exit_code === 0
        ? 'removed'
        : removeResult.status === 'timed_out' ? 'timed_out' : 'failed';
      summary.cleanup.failure = removeResult.exit_code === 0 ? null : failureFrom(removeResult);
      if (removeResult.exit_code !== 0) {
        summary.reason = `${summary.reason ?? 'canonical_audit_persistence'}; cleanup_failed`;
        summary.status = 'failed';
        // Cleanup is a secondary resource-lifecycle result. Preserve an
        // existing primary failure at the public summary boundary; callers
        // can inspect cleanup.failure independently.
        if (!summary.failure) summary.failure = summary.cleanup.failure;
      }
    }
  }

  function failed(reason, prepared = null, result = null) {
    summary.status = 'failed';
    summary.reason = reason;
    summary.failure = result ? failureFrom(result) : null;
    summary.primary = { status: 'failed', reason, failure: summary.failure };
    return { summary, prepared };
  }

  function succeed(status, reason) {
    summary.status = status;
    summary.reason = reason;
    summary.failure = null;
    summary.primary = { status, reason, failure: null };
  }
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'darwin' ? resolved.replace(/^\/private(?=\/)/, '') : resolved;
}

export async function collectCanonicalDirectoryFiles(sourceDir, relativeDir) {
  const files = new Map();
  async function visit(current, suffix = '') {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const nextSuffix = suffix ? path.join(suffix, entry.name) : entry.name;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute, nextSuffix);
      else if (entry.isFile()) files.set(path.join(relativeDir, nextSuffix), await readFile(absolute));
    }
  }
  await visit(sourceDir);
  return files;
}

function assertAllowedPath(relativePath, allowedRoots) {
  const normalized = String(relativePath).replaceAll('\\', '/').replace(/^\.\//, '');
  const valid = normalized && !path.isAbsolute(normalized) && !normalized.split('/').includes('..')
    && allowedRoots.some((root) => normalized === root.replaceAll('\\', '/') || normalized.startsWith(`${root.replaceAll('\\', '/')}/`));
  if (!valid) {
    const error = new Error(`canonical path is outside allowed roots: ${relativePath}`);
    error.code = 'canonical_path_not_allowed';
    throw error;
  }
}

function failureFrom(result) {
  return {
    stage: result.stage,
    status: result.status,
    failure_kind: result.failure_kind,
    timeout_ms: result.timeout_ms,
    termination: result.termination
  };
}
