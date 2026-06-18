import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { promoteCanonicalAuditArtifacts } from './canonical-audit.js';
import { renderPrMergeHtml } from './html-report.js';
import { bindStoryTraceability } from './traceability.js';
import { getWorkspaceDir, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';

const execFileAsync = promisify(execFile);
const SUCCESSFUL_CHECK_CONCLUSIONS = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);
const VALID_MERGE_STRATEGIES = new Set(['merge', 'squash', 'rebase']);

export async function executeMerge(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = options.storyId;
  if (!storyId) throw new Error('execute merge requires --story-id <id>');

  const prDir = path.join(getWorkspaceDir(root), 'pr', storyId);
  const [prPrepare, prCreate, executionState, gateDagArtifact] = await Promise.all([
    readJsonIfExists(path.join(prDir, 'pr-prepare.json')),
    readJsonIfExists(path.join(prDir, 'pr-create.json')),
    readJsonIfExists(path.join(getWorkspaceDir(root), 'executions', storyId, 'state.json')),
    readJsonIfExists(path.join(prDir, 'gate-dag.json'))
  ]);
  const strategy = normalizeMergeStrategy(options.strategy);
  const deleteBranch = options.deleteBranch === true;
  const dryRun = options.dryRun === true;
  const currentHeadSha = await gitOptional(root, ['rev-parse', 'HEAD']);
  const currentPrCreate = isCurrentPrLifecycleArtifact(prCreate, currentHeadSha) ? prCreate : null;
  const story = currentPrCreate?.story ?? prPrepare?.story ?? executionState?.story ?? { story_id: storyId };
  const currentBranch = await gitOptional(root, ['branch', '--show-current']);
  const nonWorkspaceDirtyFiles = await collectNonWorkspaceDirtyFiles(root);
  const gateDag = gateDagArtifact ?? prPrepare?.pr_context?.gate_dag ?? currentPrCreate?.gate_dag ?? null;
  const baseBranch = stripRemote(options.baseRef ?? currentPrCreate?.base ?? prPrepare?.git?.base_ref ?? 'main');
  const prSelector = options.pr ?? currentPrCreate?.pr_url ?? null;
  const repositorySlug = await resolveGitHubRepositorySlug(root, { prCreate: currentPrCreate, prPrepare, executionState });
  const createdAt = new Date().toISOString();
  const merge = {
    schema_version: '0.1.0',
    created_at: createdAt,
    mode: 'execute_merge',
    dry_run: dryRun,
    workspace_initialized: true,
    story,
    output: currentPrCreate?.output ?? prPrepare?.output ?? { language: 'ja' },
    strategy,
    delete_branch: deleteBranch,
    base: baseBranch,
    current_branch: currentBranch,
    current_head_sha: currentHeadSha,
    artifact_freshness: buildCurrentPrLifecycleArtifactFreshness('pr_merge', currentHeadSha, createdAt),
    repository_slug: repositorySlug,
    pr: {
      selector: prSelector,
      url: null,
      state: null,
      is_draft: null,
      merge_state_status: null,
      review_decision: null,
      head_ref_name: null,
      head_ref_oid: null,
      base_ref_name: null,
      checks: []
    },
    gate_dag: gateDag,
    preconditions: {
      pr_selector_resolved: Boolean(prSelector),
      gate_ready: gateDag?.overall_status === 'ready_for_review',
      clean_worktree: nonWorkspaceDirtyFiles.length === 0,
      base_freshness: {
        status: 'unknown',
        required: true,
        base_ref: baseBranch,
        merge_base_contains_base: null,
        fetched_ref: `origin/${baseBranch}`
      },
      remote_head_match: {
        status: 'unknown',
        required: true,
        local_head_sha: currentHeadSha,
        remote_head_sha: null
      },
      checks_ready: {
        status: 'unknown',
        required: true,
        pending_count: 0,
        failing_count: 0
      },
      review_policy: {
        status: 'unknown',
        required: true
      },
      open_pull_request: {
        status: 'unknown',
        required: true
      }
    },
    warnings: [],
    commands: [],
    results: [],
    branch_cleanup: {
      requested: deleteBranch,
      remote: {
        attempted: false,
        deleted: false,
        command: null
      },
      local: {
        attempted: false,
        deleted: false,
        command: null
      }
    },
    status: 'blocked',
    stop_reason: null,
    merge_commit_sha: null,
    merged_at: null
  };

  if (!prSelector) {
    merge.stop_reason = 'pr_selector_missing';
    merge.preconditions.base_freshness.status = 'not_run';
    merge.preconditions.remote_head_match.status = 'not_run';
    merge.preconditions.checks_ready.status = 'not_run';
    merge.preconditions.review_policy.status = 'not_run';
    merge.preconditions.open_pull_request.status = 'not_run';
    merge.warnings.push('PR selector could not be resolved from --pr or a current pr-create artifact.');
    if (prCreate?.pr_url && !currentPrCreate) {
      merge.warnings.push('Ignored stale pr-create artifact PR URL because it is not bound to the current HEAD; pass --pr explicitly after confirming the target PR.');
    }
    const artifacts = await writePrMergeArtifacts(root, storyId, merge);
    return { merge, artifacts };
  }
  if (!options.pr && prCreate?.pr_url && !currentPrCreate) {
    merge.warnings.push('Ignored stale pr-create artifact PR URL because it is not bound to the current HEAD; pass --pr explicitly after confirming the target PR.');
  }

  const fetchCommand = ['git', ['fetch', 'origin', baseBranch]];
  const prViewCommand = ['gh', buildPrViewArgs(prSelector, repositorySlug, PR_VIEW_FIELDS)];
  const prMergeCommand = ['gh', buildMergeArgs(prSelector, strategy, repositorySlug, currentHeadSha)];
  merge.commands.push(formatCommand(fetchCommand));
  merge.commands.push(formatCommand(prViewCommand));

  if (nonWorkspaceDirtyFiles.length > 0) {
    merge.warnings.push(`Non-workspace dirty files: ${nonWorkspaceDirtyFiles.join(', ')}`);
  }

  if (dryRun) {
    merge.commands.push(formatCommand(prMergeCommand));
    if (deleteBranch) {
      merge.commands.push(formatCommand(['git', ['push', 'origin', '--delete', currentBranch || '<pr-head-branch>']]));
    }
    merge.preconditions.base_freshness.status = 'not_run';
    merge.preconditions.remote_head_match.status = 'not_run';
    merge.preconditions.checks_ready.status = 'not_run';
    merge.preconditions.review_policy.status = 'not_run';
    merge.preconditions.open_pull_request.status = 'not_run';
    merge.warnings.push('Dry-run skipped external commands; git fetch, gh pr view, and gh pr merge were not executed.');

    const localBlockingReasons = [];
    if (merge.preconditions.gate_ready !== true) localBlockingReasons.push('gate_not_ready');
    if (!merge.preconditions.clean_worktree) localBlockingReasons.push('dirty_worktree');
    if (localBlockingReasons.length > 0) {
      merge.status = 'blocked';
      merge.stop_reason = localBlockingReasons.join(',');
    } else {
      merge.status = 'dry_run_planned';
      merge.stop_reason = 'external_checks_skipped_dry_run';
    }
    const artifacts = await writePrMergeArtifacts(root, storyId, merge);
    return { merge, artifacts };
  }

  const fetchResult = await runCommand(root, fetchCommand, options);
  merge.results.push(fetchResult);
  if (fetchResult.exit_code !== 0) {
    merge.stop_reason = 'base_fetch_failed';
    merge.preconditions.base_freshness.status = 'blocked';
    merge.error = `Command failed: ${fetchResult.command}`;
    const artifacts = await writePrMergeArtifacts(root, storyId, merge);
    return { merge, artifacts };
  }

  const containsBase = await gitIsAncestor(root, `origin/${baseBranch}`, currentHeadSha);
  merge.preconditions.base_freshness.status = containsBase ? 'passed' : 'blocked';
  merge.preconditions.base_freshness.merge_base_contains_base = containsBase;

  const prViewResult = await runCommand(root, prViewCommand, options);
  merge.results.push(prViewResult);
  if (prViewResult.exit_code !== 0) {
    merge.stop_reason = 'pr_view_failed';
    merge.error = `Command failed: ${prViewResult.command}`;
    const artifacts = await writePrMergeArtifacts(root, storyId, merge);
    return { merge, artifacts };
  }

  const prView = JSON.parse(prViewResult.stdout || '{}');
  const checks = normalizeChecks(prView.statusCheckRollup);
  const checkSummary = summarizeChecks(checks);
  merge.pr = {
    selector: prSelector,
    url: prView.url ?? ((typeof prSelector === 'string' && /^https?:\/\//.test(prSelector)) ? prSelector : null),
    state: prView.state ?? null,
    is_draft: prView.isDraft ?? null,
    merge_state_status: prView.mergeStateStatus ?? null,
    review_decision: prView.reviewDecision ?? null,
    head_ref_name: prView.headRefName ?? null,
    head_ref_oid: prView.headRefOid ?? null,
    base_ref_name: prView.baseRefName ?? null,
    checks
  };
  merge.preconditions.remote_head_match.remote_head_sha = prView.headRefOid ?? null;
  merge.preconditions.remote_head_match.status = currentHeadSha && prView.headRefOid && currentHeadSha === prView.headRefOid
    ? 'passed'
    : 'blocked';
  merge.preconditions.checks_ready.status = checkSummary.pending_count === 0 && checkSummary.failing_count === 0
    ? 'passed'
    : 'blocked';
  merge.preconditions.checks_ready.pending_count = checkSummary.pending_count;
  merge.preconditions.checks_ready.failing_count = checkSummary.failing_count;
  merge.preconditions.review_policy.status = (
    prView.reviewDecision === 'CHANGES_REQUESTED' || prView.reviewDecision === 'REVIEW_REQUIRED'
  ) ? 'blocked' : 'passed';
  merge.preconditions.open_pull_request.status = (
    prView.state === 'OPEN' && prView.isDraft !== true && prView.mergeStateStatus === 'CLEAN'
  ) ? 'passed' : 'blocked';

  const blockingReasons = [];
  if (merge.preconditions.gate_ready !== true) blockingReasons.push('gate_not_ready');
  if (!merge.preconditions.clean_worktree) blockingReasons.push('dirty_worktree');
  if (merge.preconditions.base_freshness.status !== 'passed') blockingReasons.push('base_not_fresh');
  if (merge.preconditions.remote_head_match.status !== 'passed') blockingReasons.push('remote_head_mismatch');
  if (merge.preconditions.checks_ready.status !== 'passed') blockingReasons.push('checks_not_ready');
  if (merge.preconditions.review_policy.status !== 'passed') blockingReasons.push('review_policy_not_satisfied');
  if (merge.preconditions.open_pull_request.status !== 'passed') blockingReasons.push('pr_not_mergeable');
  if (blockingReasons.length > 0) {
    merge.status = 'blocked';
    merge.stop_reason = blockingReasons.join(',');
    const artifacts = await writePrMergeArtifacts(root, storyId, merge);
    return { merge, artifacts };
  }

  merge.commands.push(formatCommand(prMergeCommand));
  if (deleteBranch) {
    merge.commands.push(formatCommand(['git', ['push', 'origin', '--delete', currentBranch || 'HEAD']]));
  }

  const mergeResult = await runCommand(
    root,
    prMergeCommand,
    options,
    { cwd: os.tmpdir() }
  );
  merge.results.push(mergeResult);
  if (mergeResult.exit_code !== 0) {
    merge.status = 'failed';
    merge.stop_reason = 'gh_merge_failed';
    merge.error = `Command failed: ${mergeResult.command}`;
    const artifacts = await writePrMergeArtifacts(root, storyId, merge);
    return { merge, artifacts };
  }

  if (deleteBranch && merge.pr.head_ref_name) {
    const remoteDeleteArgs = ['git', ['push', 'origin', '--delete', merge.pr.head_ref_name]];
    merge.branch_cleanup.remote.attempted = true;
    merge.branch_cleanup.remote.command = formatCommand(remoteDeleteArgs);
    const remoteDeleteResult = await runCommand(root, remoteDeleteArgs, options);
    merge.results.push(remoteDeleteResult);
    merge.branch_cleanup.remote.deleted = remoteDeleteResult.exit_code === 0;
    if (!merge.branch_cleanup.remote.deleted) {
      merge.warnings.push(`Remote branch deletion failed: ${remoteDeleteResult.command}`);
    }

    if (currentBranch && currentBranch !== merge.pr.head_ref_name) {
      const localDeleteArgs = ['git', ['branch', '-d', merge.pr.head_ref_name]];
      merge.branch_cleanup.local.attempted = true;
      merge.branch_cleanup.local.command = formatCommand(localDeleteArgs);
      const localDeleteResult = await runCommand(root, localDeleteArgs, options);
      merge.results.push(localDeleteResult);
      merge.branch_cleanup.local.deleted = localDeleteResult.exit_code === 0;
      if (!merge.branch_cleanup.local.deleted) {
        merge.warnings.push(`Local branch deletion failed: ${localDeleteResult.command}`);
      }
    } else {
      merge.warnings.push('Local branch deletion skipped because the merged branch is checked out in the current worktree.');
    }
  }

  const mergedViewResult = await runCommand(
    root,
    ['gh', buildPrViewArgs(prSelector, repositorySlug, 'url,state,mergedAt,mergeCommit')],
    options,
    { cwd: os.tmpdir() }
  );
  merge.results.push(mergedViewResult);
  if (mergedViewResult.exit_code === 0) {
    const mergedView = JSON.parse(mergedViewResult.stdout || '{}');
    merge.pr.url = mergedView.url ?? merge.pr.url;
    merge.merge_commit_sha = mergedView.mergeCommit?.oid ?? null;
    merge.merged_at = mergedView.mergedAt ?? null;
  } else {
    merge.warnings.push(`Post-merge PR view failed: ${mergedViewResult.command}`);
  }

  merge.status = 'merged';
  merge.stop_reason = null;
  const artifacts = await writePrMergeArtifacts(root, storyId, merge);
  await bindStoryTraceability(root, {
    storyId,
    source: 'execute_merge',
    lifecycle: 'merged',
    evidence: [{
      type: 'pr_merge',
      ref: toWorkspaceRelative(root, artifacts.pr_merge_json),
      summary: `merged ${merge.pr?.url ?? 'PR'} at ${merge.merged_at ?? 'unknown time'} (commit ${merge.merge_commit_sha ?? 'unknown'})`
    }]
  });
  const canonicalAudit = await promoteCanonicalAuditArtifacts(root, {
    storyId,
    source: 'execute_merge',
    merge
  });
  merge.canonical_audit = {
    bundle: toWorkspaceRelative(root, canonicalAudit.bundle_path),
    directory: toWorkspaceRelative(root, canonicalAudit.canonical_dir),
    artifact_count: canonicalAudit.bundle.artifacts.length,
    missing_artifact_count: canonicalAudit.bundle.missing_artifacts.length
  };
  await writeCanonicalAuditManifest(root, storyId, canonicalAudit, merge);
  artifacts.canonical_audit_bundle = canonicalAudit.bundle_path;
  artifacts.canonical_audit_dir = canonicalAudit.canonical_dir;
  return { merge, artifacts };
}

export function renderPrMergeSummary(result) {
  const merge = result.merge ?? result;
  const checks = merge.pr?.checks ?? [];
  const failures = checks.filter((check) => check.status !== 'COMPLETED' || !SUCCESSFUL_CHECK_CONCLUSIONS.has(check.conclusion));
  return `# Execute Merge

- story: ${merge.story?.story_id ?? '-'}
- status: ${merge.status}
- strategy: ${merge.strategy}
- pr: ${merge.pr?.url ?? merge.pr?.selector ?? '-'}
- stop_reason: ${merge.stop_reason ?? 'none'}
- merge_commit: ${merge.merge_commit_sha ?? '-'}
- merged_at: ${merge.merged_at ?? '-'}

## Preconditions

- gate_ready: ${merge.preconditions.gate_ready ? 'passed' : 'blocked'}
- clean_worktree: ${merge.preconditions.clean_worktree ? 'passed' : 'blocked'}
- base_freshness: ${merge.preconditions.base_freshness.status}
- remote_head_match: ${merge.preconditions.remote_head_match.status}
- checks_ready: ${merge.preconditions.checks_ready.status}
- review_policy: ${merge.preconditions.review_policy.status}
- open_pull_request: ${merge.preconditions.open_pull_request.status}

## Commands

${merge.commands.map((command) => `- ${command}`).join('\n')}

## Check Summary

- checks: ${checks.length}
- failing_or_pending: ${failures.length}
`;
}

function normalizeMergeStrategy(strategy) {
  const normalized = strategy ?? 'merge';
  if (!VALID_MERGE_STRATEGIES.has(normalized)) {
    throw new Error(`Unsupported merge strategy: ${normalized}. Use merge, squash, or rebase.`);
  }
  return normalized;
}

function buildMergeArgs(prSelector, strategy, repositorySlug, matchHeadCommit) {
  const args = ['pr', 'merge', String(prSelector), `--${strategy}`];
  if (repositorySlug) args.push('--repo', repositorySlug);
  if (matchHeadCommit) args.push('--match-head-commit', matchHeadCommit);
  return args;
}

function buildPrViewArgs(prSelector, repositorySlug, fields) {
  const args = ['pr', 'view', String(prSelector), '--json', fields];
  if (repositorySlug) args.push('--repo', repositorySlug);
  return args;
}

function normalizeChecks(checks) {
  if (!Array.isArray(checks)) return [];
  return checks.map((check) => ({
    name: check.name ?? check.context ?? 'unknown',
    status: check.status ?? 'UNKNOWN',
    conclusion: check.conclusion ?? '',
    workflow_name: check.workflowName ?? '',
    details_url: check.detailsUrl ?? null
  }));
}

function summarizeChecks(checks) {
  return checks.reduce((summary, check) => {
    if (check.status !== 'COMPLETED') summary.pending_count += 1;
    else if (!SUCCESSFUL_CHECK_CONCLUSIONS.has(check.conclusion)) summary.failing_count += 1;
    return summary;
  }, { pending_count: 0, failing_count: 0 });
}

async function collectNonWorkspaceDirtyFiles(repoRoot) {
  const output = await gitOptional(repoRoot, ['status', '--porcelain']);
  const files = String(output ?? '')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .filter((file) => !file.startsWith('.vibepro/'));
  return [...new Set(files)];
}

function stripRemote(ref) {
  return typeof ref === 'string' ? ref.replace(/^origin\//, '') : ref;
}

function formatCommand(command) {
  const [bin, args] = command;
  return [bin, ...args.map(shellQuote)].join(' ');
}

function shellQuote(value) {
  if (/^[a-zA-Z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function runCommand(repoRoot, command, options = {}, execution = {}) {
  const [bin, args] = command;
  const startedAt = new Date().toISOString();
  try {
    const result = await execFileAsync(bin, args, {
      cwd: execution.cwd ?? repoRoot,
      encoding: 'utf8',
      env: options.env
    });
    return {
      command: formatCommand(command),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      exit_code: 0,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim()
    };
  } catch (error) {
    return {
      command: formatCommand(command),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      exit_code: Number.isInteger(error.code) ? error.code : 1,
      stdout: String(error.stdout ?? '').trim(),
      stderr: String(error.stderr ?? error.message ?? '').trim()
    };
  }
}

async function gitOptional(repoRoot, args) {
  try {
    const result = await execFileAsync('git', args, { cwd: repoRoot, encoding: 'utf8' });
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

async function gitIsAncestor(repoRoot, ancestor, descendant) {
  if (!ancestor || !descendant) return false;
  if (ancestor === descendant) return true;
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: repoRoot, encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function isCurrentPrLifecycleArtifact(artifact, currentHeadSha) {
  if (!artifact || !currentHeadSha) return false;
  const artifactHeadSha = artifact.artifact_freshness?.artifact_head_sha
    ?? artifact.current_head_sha
    ?? artifact.toolchain?.source_git?.commit
    ?? artifact.git_context?.head_sha
    ?? null;
  if (artifact.artifact_freshness) {
    return artifact.artifact_freshness.status === 'current' && artifactHeadSha === currentHeadSha;
  }
  return artifactHeadSha === currentHeadSha;
}

function buildCurrentPrLifecycleArtifactFreshness(kind, headSha, checkedAt) {
  return {
    kind,
    status: headSha ? 'current' : 'unknown',
    exists: true,
    artifact: null,
    report: null,
    artifact_head_sha: headSha ?? null,
    current_head_sha: headSha ?? null,
    checked_at: checkedAt,
    reason: headSha
      ? `pr-merge artifact is bound to the current HEAD ${headSha.slice(0, 12)}`
      : 'pr-merge artifact freshness could not be checked because current HEAD is unknown'
  };
}

async function writePrMergeArtifacts(repoRoot, storyId, merge) {
  const prDir = path.join(getWorkspaceDir(repoRoot), 'pr', storyId);
  await mkdir(prDir, { recursive: true });
  const jsonPath = path.join(prDir, 'pr-merge.json');
  const reportPath = path.join(prDir, 'pr-merge.html');
  await writeFile(jsonPath, `${JSON.stringify(merge, null, 2)}\n`);
  await writeFile(reportPath, renderPrMergeHtml(merge, {
    language: merge.output?.language ?? 'ja'
  }));

  try {
    const manifest = await readManifest(repoRoot);
    manifest.pr_merges = {
      ...(manifest.pr_merges ?? {}),
      [storyId]: {
        latest_merge: toWorkspaceRelative(repoRoot, jsonPath),
        latest_report: toWorkspaceRelative(repoRoot, reportPath),
        latest_pr_url: merge.pr?.url ?? null,
        latest_merge_commit: merge.merge_commit_sha ?? null,
        latest_merged_at: merge.merged_at ?? null,
        latest_dry_run: merge.dry_run
      }
    };
    await writeManifest(repoRoot, manifest);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return {
    pr_merge_json: jsonPath,
    pr_merge_report: reportPath
  };
}

async function writeCanonicalAuditManifest(repoRoot, storyId, canonicalAudit, merge) {
  try {
    const manifest = await readManifest(repoRoot);
    manifest.canonical_audit_artifacts = {
      ...(manifest.canonical_audit_artifacts ?? {}),
      [storyId]: {
        latest_bundle: toWorkspaceRelative(repoRoot, canonicalAudit.bundle_path),
        latest_directory: toWorkspaceRelative(repoRoot, canonicalAudit.canonical_dir),
        latest_source: canonicalAudit.bundle.source,
        latest_promoted_at: canonicalAudit.bundle.promoted_at,
        latest_pr_url: merge.pr?.url ?? null,
        latest_merge_commit: merge.merge_commit_sha ?? null
      }
    };
    await writeManifest(repoRoot, manifest);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

const PR_VIEW_FIELDS = [
  'url',
  'state',
  'isDraft',
  'mergeStateStatus',
  'reviewDecision',
  'headRefName',
  'headRefOid',
  'baseRefName',
  'statusCheckRollup'
].join(',');

async function resolveGitHubRepositorySlug(repoRoot, context = {}) {
  const candidates = [
    context.prCreate?.toolchain?.source_git?.origin_url,
    context.prPrepare?.toolchain?.source_git?.origin_url,
    await gitOptional(repoRoot, ['config', '--get', 'remote.origin.url']),
    context.prCreate?.pr_url,
    context.executionState?.pr_url
  ];
  for (const candidate of candidates) {
    const slug = githubRepositorySlug(candidate);
    if (slug) return slug;
  }
  return null;
}

function githubRepositorySlug(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const sshMatch = value.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/i);
  if (sshMatch) return sshMatch[1];
  const httpMatch = value.match(/^https?:\/\/github\.com\/([^/]+\/[^/.]+?)(?:\.git)?(?:\/pull\/\d+)?\/?$/i);
  if (httpMatch) return httpMatch[1];
  return null;
}
