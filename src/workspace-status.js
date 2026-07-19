import { execFile } from 'node:child_process';
import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolvePrArtifactFile } from './artifact-routing.js';

const execFileAsync = promisify(execFile);

async function git(repoRoot, args, { trim = true } = {}) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
  return trim ? stdout.trim() : stdout;
}

export function parseWorktreePorcelain(output) {
  const records = [];
  let current = null;
  // `-z` prevents Git from C-style quoting paths that contain non-ASCII or
  // control characters. Keep newline parsing for direct callers and fixtures.
  const fields = output.includes('\0') ? output.split('\0') : output.split(/\r?\n/);
  for (const line of fields) {
    if (line.startsWith('worktree ')) {
      if (current) records.push(current);
      current = { path: line.slice('worktree '.length) };
    } else if (current && line.startsWith('HEAD ')) {
      current.head_sha = line.slice('HEAD '.length);
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (current && line === 'detached') {
      current.detached = true;
    } else if (current && line === 'bare') {
      current.bare = true;
    } else if (current && line.startsWith('prunable')) {
      current.prunable = true;
    }
  }
  if (current) records.push(current);
  return records;
}

function artifactHead(artifact) {
  return artifact?.artifact_freshness?.artifact_head_sha
    ?? artifact?.current_head_sha
    ?? artifact?.git?.head_sha
    ?? artifact?.toolchain?.source_git?.commit
    ?? null;
}

function classifyArtifact(artifact, headSha) {
  const recordedHead = artifactHead(artifact);
  if (!recordedHead || recordedHead !== headSha) return 'stale_artifact';
  if (artifact?.gate_status?.ready_for_pr_create === true
    && artifact?.gate_status?.overall_status === 'ready_for_review') {
    return 'active_ready';
  }
  return 'active_blocked';
}

async function readStoryStatuses(worktree) {
  try {
    const config = JSON.parse(await readFile(path.join(worktree.path, '.vibepro', 'config.json'), 'utf8'));
    const storyIds = [...new Set((config.brainbase?.stories ?? []).map((story) => story.story_id ?? story.id).filter(Boolean))];
    if (storyIds.length > 0) {
      const stories = [];
      for (const storyId of storyIds.sort()) {
        const artifactPath = await resolvePrArtifactFile(worktree.path, storyId, 'pr-prepare.json');
        try {
          const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
          const recordedHead = artifactHead(artifact);
          stories.push({
            story_id: artifact?.story?.story_id ?? storyId,
            title: artifact?.story?.title ?? null,
            status: classifyArtifact(artifact, worktree.head_sha),
            reason: !recordedHead ? 'artifact_head_missing' : recordedHead !== worktree.head_sha ? 'artifact_head_mismatch' : artifact?.gate_status?.ready_for_pr_create !== true ? 'gate_not_ready' : artifact?.gate_status?.overall_status !== 'ready_for_review' ? 'overall_status_not_ready' : null,
            artifact_head_sha: recordedHead,
            artifact_path: artifactPath
          });
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      return stories.length > 0 ? stories : [{ story_id: null, status: 'unknown', reason: 'no_pr_prepare_artifact' }];
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const prRoot = path.join(worktree.path, '.vibepro', 'pr');
  let entries;
  try {
    entries = await readdir(prRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [{ story_id: null, status: 'unknown', reason: 'no_pr_prepare_artifact' }];
    }
    throw error;
  }

  const stories = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const artifactPath = path.join(prRoot, entry.name, 'pr-prepare.json');
    try {
      const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
      const recordedHead = artifactHead(artifact);
      stories.push({
        story_id: artifact?.story?.story_id ?? entry.name,
        title: artifact?.story?.title ?? null,
        status: classifyArtifact(artifact, worktree.head_sha),
        reason: !recordedHead
          ? 'artifact_head_missing'
          : recordedHead !== worktree.head_sha
            ? 'artifact_head_mismatch'
            : artifact?.gate_status?.ready_for_pr_create !== true
              ? 'gate_not_ready'
              : artifact?.gate_status?.overall_status !== 'ready_for_review'
                ? 'overall_status_not_ready'
                : null,
        artifact_head_sha: recordedHead,
        artifact_path: artifactPath
      });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      stories.push({
        story_id: entry.name,
        status: 'unknown',
        reason: 'malformed_pr_prepare_artifact',
        artifact_path: artifactPath
      });
    }
  }
  return stories.length > 0
    ? stories
    : [{ story_id: null, status: 'unknown', reason: 'no_pr_prepare_artifact' }];
}

async function inspectWorktree(worktree, canonicalPath) {
  const isCanonical = path.resolve(worktree.path) === path.resolve(canonicalPath);
  if (worktree.available === false) {
    return {
      ...worktree,
      is_canonical: isCanonical,
      dirty: null,
      upstream: null,
      stories: [{
        story_id: null,
        status: 'unknown',
        reason: worktree.prunable ? 'prunable_worktree' : 'missing_worktree_path'
      }]
    };
  }
  let dirty = null;
  let upstream = null;
  try {
    dirty = (await git(worktree.path, ['status', '--porcelain'])).length > 0;
    try {
      const counts = (await git(worktree.path, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']))
        .split(/\s+/).map(Number);
      upstream = { ahead: counts[0], behind: counts[1] };
    } catch {
      upstream = null;
    }
  } catch {
    dirty = null;
  }
  return {
    ...worktree,
    is_canonical: isCanonical,
    dirty,
    upstream,
    // Canonical may retain historical artifacts after merge. Treat it as repo
    // health only so old evidence is not presented as active work.
    stories: isCanonical ? [] : await readStoryStatuses(worktree)
  };
}

export async function collectWorkspaceStatus(repoRoot = process.cwd()) {
  const root = await realpath(path.resolve(repoRoot));
  const parsed = parseWorktreePorcelain(await git(root, ['worktree', 'list', '--porcelain', '-z'], { trim: false }));
  if (parsed.length === 0) throw new Error(`No Git worktrees found for ${root}`);
  const normalized = await Promise.all(parsed.map(async (worktree) => {
    try {
      return { ...worktree, path: await realpath(worktree.path), available: true };
    } catch (error) {
      if (error.code === 'ENOENT') return { ...worktree, available: false };
      throw error;
    }
  }));
  const canonicalPath = normalized[0].path;
  const worktrees = await Promise.all(normalized.map((worktree) => inspectWorktree(worktree, canonicalPath)));
  const counts = { active_ready: 0, active_blocked: 0, stale_artifact: 0, unknown: 0 };
  for (const worktree of worktrees) {
    for (const story of worktree.stories) counts[story.status] += 1;
  }
  return {
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    repository: { requested_root: root, canonical_worktree: canonicalPath },
    summary: { worktree_count: worktrees.length, story_status_counts: counts },
    worktrees
  };
}

export function renderWorkspaceStatus(status) {
  const lines = [`Workspace: ${status.repository.canonical_worktree}`];
  for (const worktree of status.worktrees) {
    const branch = worktree.branch ?? (worktree.detached ? '(detached)' : '(unknown)');
    const health = worktree.dirty === null ? 'dirty=?' : `dirty=${worktree.dirty}`;
    const upstream = worktree.upstream ? ` ahead=${worktree.upstream.ahead} behind=${worktree.upstream.behind}` : '';
    lines.push(`- ${worktree.is_canonical ? 'canonical' : 'linked'} ${branch} ${health}${upstream}`);
    lines.push(`  ${worktree.path}`);
    for (const story of worktree.stories) {
      lines.push(`  ${story.status}: ${story.story_id ?? '(no story)'}${story.reason ? ` (${story.reason})` : ''}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
