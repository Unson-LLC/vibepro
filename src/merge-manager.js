import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { promoteCanonicalAuditArtifacts } from './canonical-audit.js';
import { parseNumstat } from './evidence-cost-budget.js';
import { renderPrMergeHtml } from './html-report.js';
import { collectSessionEfficiencyAudit } from './session-efficiency-audit.js';
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
  const costAccountingResult = await collectExecuteMergeCostAccounting(root, {
    storyId,
    options,
    baseBranch,
    currentHeadSha,
    collectedAt: createdAt
  });
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
    git: {
      base_branch: baseBranch,
      base_ref: `origin/${baseBranch}`,
      head_ref: currentHeadSha ?? null,
      head_ref_name: currentBranch ?? null,
      diff_stats: {
        status: 'not_run',
        source: null,
        refs: {
          base_ref: `origin/${baseBranch}`,
          head_ref: currentHeadSha ?? null,
          base_sha: null,
          head_sha: currentHeadSha ?? null,
          merge_commit_sha: null
        },
        collected_at: null,
        reason: 'diff statistics are collected after PR metadata is resolved'
      },
      diff_line_stats: null
    },
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
    merged_at: null,
    cost_accounting: costAccountingResult.cost_accounting,
    cost_accounting_collection: costAccountingResult.collection
  };
  merge.warnings.push(...costAccountingResult.warnings);

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
  const diffStatsResult = await collectMergeDiffLineStats(root, {
    baseBranch,
    currentHeadSha,
    pr: merge.pr
  });
  merge.git.diff_stats = diffStatsResult.diff_stats;
  merge.git.diff_line_stats = diffStatsResult.diff_line_stats;

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
  if (merge.git?.diff_stats?.refs) {
    merge.git.diff_stats.refs.merge_commit_sha = merge.merge_commit_sha ?? null;
  }

  merge.status = 'merged';
  merge.stop_reason = null;
  let artifacts = await writePrMergeArtifacts(root, storyId, merge);
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
  let canonicalAudit = await promoteCanonicalAuditArtifacts(root, {
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
  const canonicalPersistence = await persistCanonicalAuditToBase(root, {
    storyId,
    canonicalAudit,
    baseBranch,
    merge,
    options
  });
  merge.canonical_audit.persistence = canonicalPersistence.summary;
  if (canonicalPersistence.summary.status === 'failed') {
    merge.warnings.push(`Canonical audit persistence failed: ${canonicalPersistence.summary.reason}`);
    merge.status = 'failed';
    merge.stop_reason = 'canonical_audit_persistence_failed';
  }
  artifacts = {
    ...artifacts,
    ...(await writePrMergeArtifacts(root, storyId, merge))
  };
  canonicalAudit = await promoteCanonicalAuditArtifacts(root, {
    storyId,
    source: 'execute_merge',
    merge
  });
  if (canonicalPersistence.summary.status === 'pushed') {
    const finalCanonicalPersistence = await persistCanonicalAuditToBase(root, {
      storyId,
      canonicalAudit,
      baseBranch,
      merge,
      options
    });
    merge.canonical_audit.final_persistence = finalCanonicalPersistence.summary;
    if (finalCanonicalPersistence.summary.status === 'failed') {
      merge.warnings.push(`Canonical audit final artifact persistence failed: ${finalCanonicalPersistence.summary.reason}`);
      merge.status = 'failed';
      merge.stop_reason = 'canonical_audit_final_persistence_failed';
    }
  }
  merge.canonical_audit.bundle = toWorkspaceRelative(root, canonicalAudit.bundle_path);
  merge.canonical_audit.directory = toWorkspaceRelative(root, canonicalAudit.canonical_dir);
  merge.canonical_audit.artifact_count = canonicalAudit.bundle.artifacts.length;
  merge.canonical_audit.missing_artifact_count = canonicalAudit.bundle.missing_artifacts.length;
  if (merge.canonical_audit.final_persistence?.status === 'failed') {
    artifacts = {
      ...artifacts,
      ...(await writePrMergeArtifacts(root, storyId, merge))
    };
    canonicalAudit = await promoteCanonicalAuditArtifacts(root, {
      storyId,
      source: 'execute_merge',
      merge
    });
    merge.canonical_audit.bundle = toWorkspaceRelative(root, canonicalAudit.bundle_path);
    merge.canonical_audit.directory = toWorkspaceRelative(root, canonicalAudit.canonical_dir);
    merge.canonical_audit.artifact_count = canonicalAudit.bundle.artifacts.length;
    merge.canonical_audit.missing_artifact_count = canonicalAudit.bundle.missing_artifacts.length;
  }
  await writeCanonicalAuditManifest(root, storyId, canonicalAudit, merge);
  artifacts.canonical_audit_bundle = canonicalAudit.bundle_path;
  artifacts.canonical_audit_dir = canonicalAudit.canonical_dir;
  return { merge, artifacts };
}

async function collectExecuteMergeCostAccounting(root, { storyId, options = {}, baseBranch, currentHeadSha, collectedAt } = {}) {
  const warnings = [];
  if (options.costAccountingPath) {
    try {
      const filePath = path.isAbsolute(options.costAccountingPath)
        ? options.costAccountingPath
        : path.resolve(root, options.costAccountingPath);
      const payload = JSON.parse(await readFile(filePath, 'utf8'));
      return {
        cost_accounting: normalizeExecuteMergeCostAccounting(payload, {
          source: 'cost-accounting-file',
          sourcePath: toWorkspaceRelative(root, filePath),
          storyId,
          collectedAt
        }),
        collection: {
          status: 'available',
          source: 'cost-accounting-file',
          source_path: toWorkspaceRelative(root, filePath),
          collected_at: collectedAt
        },
        warnings
      };
    } catch (error) {
      warnings.push(`Cost accounting file could not be read: ${error.message}`);
      return {
        cost_accounting: unavailableExecuteMergeCostAccounting({
          source: 'cost-accounting-file',
          reason: error.message,
          storyId,
          collectedAt
        }),
        collection: {
          status: 'unavailable',
          source: 'cost-accounting-file',
          source_path: options.costAccountingPath,
          reason: error.message,
          collected_at: collectedAt
        },
        warnings
      };
    }
  }

  if (options.sessionId) {
    const sessionAudit = await collectSessionEfficiencyAudit(root, {
      storyId,
      sessionId: options.sessionId,
      codexHome: options.codexHome,
      windowStart: options.windowStart,
      windowEnd: options.windowEnd,
      baseRef: `origin/${baseBranch}`,
      headRef: currentHeadSha ?? 'HEAD',
      includeWorktreeDiff: false,
      now: collectedAt
    });
    return {
      cost_accounting: normalizeExecuteMergeCostAccounting(sessionAudit, {
        source: 'audit-session-cost',
        storyId,
        collectedAt
      }),
      collection: {
        status: sessionAudit.audit_readiness?.status ?? 'partial',
        source: 'audit-session-cost',
        session_id: options.sessionId,
        observed_worktree: sessionAudit.observed_worktree ?? null,
        observed_worktree_source: sessionAudit.observed_worktree_source ?? null,
        audit_readiness: sessionAudit.audit_readiness ?? null,
        collected_at: collectedAt
      },
      warnings
    };
  }

  return {
    cost_accounting: undefined,
    collection: {
      status: 'not_requested',
      source: null,
      reason: 'execute merge did not receive --cost-accounting or --session-id',
      collected_at: collectedAt
    },
    warnings
  };
}

function normalizeExecuteMergeCostAccounting(input, { source, sourcePath = null, storyId, collectedAt } = {}) {
  const cost = input?.cost_accounting ?? input;
  const session = input?.session ?? cost?.session ?? null;
  const token = cost?.token_accounting
    ?? cost?.tokens
    ?? session?.token_accounting
    ?? input?.token_accounting
    ?? null;
  const elapsed = cost?.elapsed_time_accounting
    ?? cost?.elapsed_time
    ?? session?.elapsed_time_accounting
    ?? input?.elapsed_time_accounting
    ?? null;
  const normalized = {
    schema_version: '0.1.0',
    status: hasUsableAccounting(token) || hasUsableAccounting(elapsed) ? 'available' : 'partial',
    source,
    source_path: sourcePath,
    story_id: input?.story_id ?? storyId ?? null,
    session_id: input?.session_id ?? session?.window?.session_id ?? token?.window?.session_id ?? elapsed?.window?.session_id ?? null,
    collected_at: collectedAt ?? null,
    token_accounting: token ?? unavailableTokenAccounting(source, storyId, 'token accounting was not present in execute merge cost input'),
    elapsed_time_accounting: elapsed ?? unavailableElapsedTimeAccounting(source, storyId, 'elapsed-time accounting was not present in execute merge cost input')
  };
  if (input?.artifact_kind === 'vibepro_session_efficiency_audit') {
    normalized.session_efficiency_audit = {
      artifact_kind: input.artifact_kind,
      audit_readiness: input.audit_readiness ?? null,
      observed_worktree: input.observed_worktree ?? null,
      observed_worktree_source: input.observed_worktree_source ?? null,
      cost_breakdown: input.cost_breakdown ?? null
    };
  }
  return normalized;
}

function unavailableExecuteMergeCostAccounting({ source, reason, storyId, collectedAt }) {
  return {
    schema_version: '0.1.0',
    status: 'unavailable',
    source,
    source_path: null,
    story_id: storyId ?? null,
    session_id: null,
    collected_at: collectedAt ?? null,
    token_accounting: unavailableTokenAccounting(source, storyId, reason),
    elapsed_time_accounting: unavailableElapsedTimeAccounting(source, storyId, reason)
  };
}

function unavailableTokenAccounting(source, storyId, reason) {
  return {
    status: 'unavailable',
    total_tokens: null,
    input_tokens: null,
    output_tokens: null,
    cached_input_tokens: null,
    source,
    window: storyId ? { story_id: storyId } : null,
    reason
  };
}

function unavailableElapsedTimeAccounting(source, storyId, reason) {
  return {
    status: 'unavailable',
    elapsed_ms: null,
    started_at: null,
    finished_at: null,
    source,
    window: storyId ? { story_id: storyId } : null,
    reason
  };
}

function hasUsableAccounting(input) {
  if (!input || input.status === 'unavailable') return false;
  return [
    input.total_tokens,
    input.input_tokens,
    input.output_tokens,
    input.elapsed_ms,
    input.started_at,
    input.finished_at
  ].some((value) => value !== null && value !== undefined && value !== '');
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

async function collectMergeDiffLineStats(repoRoot, { baseBranch, currentHeadSha, pr } = {}) {
  const collectedAt = new Date().toISOString();
  const baseRef = `origin/${stripRemote(pr?.base_ref_name ?? baseBranch ?? 'main')}`;
  const headRef = currentHeadSha ?? pr?.head_ref_oid ?? 'HEAD';
  const refs = {
    base_ref: baseRef,
    head_ref: headRef,
    base_sha: await gitOptional(repoRoot, ['rev-parse', baseRef]),
    head_sha: currentHeadSha ?? pr?.head_ref_oid ?? null,
    merge_commit_sha: null
  };
  const attempts = [
    ['git', ['diff', '--numstat', `${baseRef}...${headRef}`]],
    ['git', ['diff', '--numstat', baseRef, headRef]]
  ];

  let lastFailure = null;
  for (const command of attempts) {
    const result = await runGitForOutput(repoRoot, command);
    if (result.exit_code === 0) {
      return {
        diff_line_stats: parseNumstat(result.stdout),
        diff_stats: {
          status: 'available',
          source: formatCommand(command),
          refs,
          collected_at: collectedAt,
          reason: null
        }
      };
    }
    lastFailure = result;
  }

  return {
    diff_line_stats: null,
    diff_stats: {
      status: 'unavailable',
      source: lastFailure?.command ?? null,
      refs,
      collected_at: collectedAt,
      reason: lastFailure?.stderr || lastFailure?.stdout || 'git diff --numstat failed'
    }
  };
}

async function runGitForOutput(repoRoot, command) {
  const [bin, args] = command;
  try {
    const result = await execFileAsync(bin, args, { cwd: repoRoot, encoding: 'utf8' });
    return {
      command: formatCommand(command),
      exit_code: 0,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim()
    };
  } catch (error) {
    return {
      command: formatCommand(command),
      exit_code: Number.isInteger(error.code) ? error.code : 1,
      stdout: String(error.stdout ?? '').trim(),
      stderr: String(error.stderr ?? error.message ?? '').trim()
    };
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

async function persistCanonicalAuditToBase(repoRoot, { storyId, canonicalAudit, baseBranch, merge, options = {} } = {}) {
  const relativeDir = toWorkspaceRelative(repoRoot, canonicalAudit.canonical_dir);
  const tempWorktree = path.join(os.tmpdir(), `vibepro-canonical-audit-${storyId}-${Date.now()}`);
  const commands = [];
  const results = [];
  const summary = {
    schema_version: '0.1.0',
    status: 'not_run',
    base: baseBranch,
    directory: relativeDir,
    worktree_path: tempWorktree,
    base_head_sha: null,
    merge_commit_on_base: null,
    commit_sha: null,
    pushed: false,
    reason: null,
    cleanup: {
      attempted: false,
      removed: false,
      exit_code: null
    },
    commands,
    results
  };

  if (!merge?.merge_commit_sha) {
    summary.status = 'failed';
    summary.reason = 'canonical_audit_merge_commit_missing';
    return { summary, commands, results };
  }

  const run = async (command, execution = {}) => {
    commands.push(formatCommand(command));
    const result = await runCommand(repoRoot, command, options, execution);
    results.push(result);
    return result;
  };

  const refreshBase = await run(['git', ['fetch', 'origin', baseBranch]]);
  if (refreshBase.exit_code !== 0) {
    summary.status = 'failed';
    summary.reason = 'canonical_audit_post_merge_base_fetch_failed';
    return { summary, commands, results };
  }
  summary.base_head_sha = await gitOptional(repoRoot, ['rev-parse', `origin/${baseBranch}`]);
  summary.merge_commit_on_base = await gitIsAncestor(repoRoot, merge.merge_commit_sha, `origin/${baseBranch}`);
  if (!summary.merge_commit_on_base) {
    summary.status = 'failed';
    summary.reason = 'canonical_audit_post_merge_base_missing_merge_commit';
    return { summary, commands, results };
  }

  const addWorktree = await run(['git', ['worktree', 'add', '--detach', tempWorktree, `origin/${baseBranch}`]]);
  if (addWorktree.exit_code !== 0) {
    summary.status = 'failed';
    summary.reason = 'canonical_audit_worktree_add_failed';
    return { summary, commands, results };
  }

  try {
    const destination = path.join(tempWorktree, relativeDir);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(canonicalAudit.canonical_dir, destination, { recursive: true });

    const addResult = await run(['git', ['add', relativeDir]], { cwd: tempWorktree });
    if (addResult.exit_code !== 0) {
      summary.status = 'failed';
      summary.reason = 'canonical_audit_git_add_failed';
      return { summary, commands, results };
    }

    const diffResult = await run(['git', ['diff', '--cached', '--quiet', '--', relativeDir]], { cwd: tempWorktree });
    if (diffResult.exit_code === 0) {
      summary.status = 'already_present';
      summary.pushed = false;
      summary.reason = 'canonical_audit_already_present_on_base';
      return { summary, commands, results };
    }
    if (diffResult.exit_code !== 1) {
      summary.status = 'failed';
      summary.reason = 'canonical_audit_diff_check_failed';
      return { summary, commands, results };
    }

    const commitResult = await run([
      'git',
      ['commit', '-m', `docs: persist VibePro audit artifacts for ${storyId}`]
    ], { cwd: tempWorktree });
    if (commitResult.exit_code !== 0) {
      summary.status = 'failed';
      summary.reason = 'canonical_audit_commit_failed';
      return { summary, commands, results };
    }
    summary.commit_sha = await gitOptional(tempWorktree, ['rev-parse', 'HEAD']);

    const pushResult = await run(['git', ['push', 'origin', `HEAD:${baseBranch}`]], { cwd: tempWorktree });
    if (pushResult.exit_code !== 0) {
      summary.status = 'failed';
      summary.reason = 'canonical_audit_push_failed';
      return { summary, commands, results };
    }
    summary.status = 'pushed';
    summary.pushed = true;
    summary.reason = `canonical audit bundle persisted after merge ${merge.merge_commit_sha ?? 'unknown'}`;
    return { summary, commands, results };
  } finally {
    summary.cleanup.attempted = true;
    const removeResult = await run(['git', ['worktree', 'remove', '--force', tempWorktree]]);
    summary.cleanup.exit_code = removeResult.exit_code;
    summary.cleanup.removed = removeResult.exit_code === 0;
    if (removeResult.exit_code !== 0) {
      summary.reason = `${summary.reason ?? 'canonical_audit_persistence'}; cleanup_failed`;
      if (summary.status !== 'failed') summary.status = 'failed';
    }
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
