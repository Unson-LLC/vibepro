import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { parseWorktreePorcelain } from './workspace-status.js';

const execFileAsync = promisify(execFile);

async function git(repoRoot, args, { trim = true } = {}) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
  return trim ? stdout.trim() : stdout;
}

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function normalizeExisting(targetPath) {
  try {
    return await realpath(path.resolve(targetPath));
  } catch (error) {
    if (error.code === 'ENOENT') return path.resolve(targetPath);
    throw error;
  }
}

export async function inspectProcessesWithLsof(worktreePath, execute = execFileAsync) {
  try {
    const { stdout } = await execute('lsof', ['-n', '-a', '-d', 'cwd', '+D', worktreePath], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    return stdout.trim().split(/\r?\n/).slice(1).filter(Boolean);
  } catch (error) {
    if (error.code === 1
      && !String(error.stdout ?? '').trim()
      && !String(error.stderr ?? '').trim()) return [];
    throw error;
  }
}

export async function inspectWorktreeLifecycle(repoRoot = process.cwd(), options = {}) {
  if (!options.worktreePath) throw new Error('worktreePath is required');
  const root = await realpath(path.resolve(repoRoot));
  const targetPath = await normalizeExisting(options.worktreePath);
  const baseRef = options.baseRef ?? null;
  const currentCwd = await normalizeExisting(options.currentCwd ?? process.cwd());
  const processInspector = options.processInspector ?? inspectProcessesWithLsof;
  const records = parseWorktreePorcelain(await git(root, ['worktree', 'list', '--porcelain', '-z'], { trim: false }));
  const normalized = await Promise.all(records.map(async (record) => ({
    ...record,
    path: await normalizeExisting(record.path)
  })));
  const canonicalPath = normalized[0]?.path ?? root;
  const target = normalized.find((record) => record.path === targetPath);
  const checks = {
    registered: Boolean(target),
    canonical: targetPath === canonicalPath,
    clean: null,
    head_integrated: null,
    descendant_worktrees: normalized.filter((record) => record.path !== targetPath && isInside(record.path, targetPath)).map((record) => record.path),
    current_process_inside: isInside(currentCwd, targetPath),
    other_processes: null
  };
  const reasons = [];
  let status = 'safe_to_close';

  if (!target) {
    status = 'unknown';
    reasons.push('worktree_not_registered');
  }
  if (checks.canonical) {
    status = 'active';
    reasons.push('canonical_worktree');
  }
  if (checks.current_process_inside) {
    status = 'active';
    reasons.push('current_process_inside');
  }
  if (checks.descendant_worktrees.length > 0) {
    if (status === 'safe_to_close') status = 'needs_attention';
    reasons.push('descendant_worktrees_present');
  }

  if (target && !checks.canonical) {
    try {
      checks.clean = (await git(targetPath, ['status', '--porcelain'])).length === 0;
      if (!checks.clean) {
        if (status === 'safe_to_close') status = 'needs_attention';
        reasons.push('worktree_dirty');
      }
    } catch {
      status = 'unknown';
      reasons.push('worktree_state_unknown');
    }

    if (target.detached) {
      if (status === 'safe_to_close') status = 'needs_attention';
      reasons.push('detached_head');
    } else if (!baseRef) {
      status = 'unknown';
      reasons.push('base_ref_required');
    } else {
      try {
        await git(root, ['merge-base', '--is-ancestor', target.head_sha, baseRef]);
        checks.head_integrated = true;
      } catch (error) {
        if (error.code === 1) {
          try {
            const cherry = await git(root, ['cherry', baseRef, target.head_sha]);
            const commits = cherry.split(/\r?\n/).filter(Boolean);
            checks.head_integrated = commits.every((line) => line.startsWith('- '));
            if (!checks.head_integrated) {
              if (status === 'safe_to_close') status = 'needs_attention';
              reasons.push('head_not_integrated_into_base');
            }
          } catch {
            status = 'unknown';
            reasons.push('base_ref_unresolved');
          }
        } else {
          status = 'unknown';
          reasons.push('base_ref_unresolved');
        }
      }
    }

    try {
      checks.other_processes = await processInspector(targetPath);
      if (checks.other_processes.length > 0) {
        status = 'active';
        reasons.push('other_processes_inside');
      }
    } catch {
      status = 'unknown';
      reasons.push('process_state_unknown');
    }
  }

  return {
    schema_version: '0.1.0',
    status,
    path: targetPath,
    branch: target?.branch ?? null,
    head_sha: target?.head_sha ?? null,
    base_ref: baseRef,
    reasons: [...new Set(reasons)],
    checks
  };
}

export async function closeWorktree(repoRoot = process.cwd(), options = {}) {
  const initialInspection = await inspectWorktreeLifecycle(repoRoot, options);
  if (initialInspection.status !== 'safe_to_close') return initialInspection;

  // Re-read every mutable condition immediately before removal. Git performs a
  // final dirty check too because this command never uses --force.
  const inspection = await inspectWorktreeLifecycle(repoRoot, options);
  if (inspection.status !== 'safe_to_close') return inspection;

  const root = await realpath(path.resolve(repoRoot));
  await git(root, ['worktree', 'remove', inspection.path]);
  const remaining = parseWorktreePorcelain(await git(root, ['worktree', 'list', '--porcelain', '-z'], { trim: false }));
  const stillRegistered = remaining.some((record) => path.resolve(record.path) === inspection.path);
  if (stillRegistered) {
    return { ...inspection, status: 'unknown', reasons: ['close_readback_failed'] };
  }
  return { ...inspection, status: 'closed', closed: true };
}

export function renderWorktreeLifecycle(result) {
  const lines = [`Worktree: ${result.path}`, `Status: ${result.status}`];
  if (result.branch) lines.push(`Branch: ${result.branch}`);
  if (result.base_ref) lines.push(`Base: ${result.base_ref}`);
  for (const reason of result.reasons ?? []) lines.push(`- ${reason}`);
  return `${lines.join('\n')}\n`;
}
