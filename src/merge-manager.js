import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { promoteCanonicalAuditArtifacts } from './canonical-audit.js';
import { parseNumstat } from './evidence-cost-budget.js';
import {
  CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH,
  computeCentralLedgerPromotion,
  readPromotableGateOutcomeEntries
} from './gate-outcome-ledger.js';
import { renderPrMergeHtml } from './html-report.js';
import { resolveReconciliationAction } from './reconciliation-action.js';
import {
  buildMergeGateAuthorization,
  resolveCurrentMergeGateStatus
} from './merge-gate-authorization.js';
import { collectSessionEfficiencyAudit } from './session-efficiency-audit.js';
import { withStoryTransactionLocks } from './story-transaction-lock.js';
import { bindStoryTraceability } from './traceability.js';
import { resolveGateArtifactFile, resolvePrArtifactFile } from './artifact-routing.js';
import { getWorkspaceDir, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';

const execFileAsync = promisify(execFile);
const SUCCESSFUL_CHECK_CONCLUSIONS = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);
const VALID_MERGE_STRATEGIES = new Set(['merge', 'squash', 'rebase']);

export async function executeMerge(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = options.storyId;
  if (!storyId) throw new Error('execute merge requires --story-id <id>');

  return withStoryTransactionLocks(
    [root],
    storyId,
    () => executeMergeLocked(root, options),
    options.storyTransactionLock
  );
}

async function executeMergeLocked(root, options = {}) {
  const storyId = options.storyId;

  const prPreparePath = await resolvePrArtifactFile(root, storyId);
  const gateDagPath = await resolveGateArtifactFile(root, storyId);
  const prCreatePath = await resolvePrArtifactFile(root, storyId, 'pr-create.json');
  const prMergePath = await resolvePrArtifactFile(root, storyId, 'pr-merge.json');
  const [prPrepare, prCreate, executionState, gateDagArtifact, localPrMerge, canonicalPrMerge] = await Promise.all([
    readJsonIfExists(prPreparePath),
    readJsonIfExists(prCreatePath),
    readJsonIfExists(path.join(getWorkspaceDir(root), 'executions', storyId, 'state.json')),
    readJsonIfExists(gateDagPath),
    readJsonIfExists(prMergePath),
    readJsonIfExists(path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'pr', 'pr-merge.json'))
  ]);
  const strategy = normalizeMergeStrategy(options.strategy);
  const deleteBranch = options.deleteBranch === true;
  const dryRun = options.dryRun === true;
  const currentHeadSha = await gitOptional(root, ['rev-parse', 'HEAD']);
  const currentPrPrepare = isCurrentPrLifecycleArtifact(prPrepare, currentHeadSha) ? prPrepare : null;
  const currentPrCreate = isCurrentPrLifecycleArtifact(prCreate, currentHeadSha) ? prCreate : null;
  const story = currentPrCreate?.story ?? prPrepare?.story ?? executionState?.story ?? { story_id: storyId };
  const currentBranch = await gitOptional(root, ['branch', '--show-current']);
  const nonWorkspaceDirtyFiles = await collectNonWorkspaceDirtyFiles(root, { storyId });
  // A standalone gate DAG has no authority unless it is explicitly bound to
  // the current HEAD. Prefer the current pr-prepare embedded DAG because that
  // artifact carries the source git commit. This prevents an older
  // ready_for_review DAG from reconciling a delivery whose current evidence is
  // blocked or missing.
  const currentGateDagArtifact = isCurrentPrLifecycleArtifact(gateDagArtifact, currentHeadSha)
    ? gateDagArtifact
    : null;
  const gateDag = currentPrPrepare?.pr_context?.gate_dag
    ?? currentPrCreate?.gate_dag
    ?? currentGateDagArtifact
    ?? null;
  // A separately routed DAG cannot grant authority without current-head
  // binding, but it can reveal that the embedded PR status no longer
  // represents the routed gate surface. Reconcile against it conservatively
  // so a critical routed gate cannot be hidden by a ready embedded snapshot.
  const currentGateStatus = resolveCurrentMergeGateStatus(
    currentPrPrepare,
    currentHeadSha,
    gateDagArtifact ?? gateDag
  );
  const gateAuthorization = buildMergeGateAuthorization(gateDag, currentPrCreate, currentGateStatus);
  const baseBranch = stripRemote(options.baseRef ?? currentPrCreate?.base ?? prPrepare?.git?.base_ref ?? 'main');
  const prSelector = options.pr ?? currentPrCreate?.pr_url ?? null;
  const priorObservedMerge = resolvePriorObservedMerge([localPrMerge, canonicalPrMerge], {
    baseBranch,
    prSelector
  });
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
    gate_authorization: gateAuthorization,
    preconditions: {
      pr_selector_resolved: Boolean(prSelector),
      gate_ready: gateAuthorization.allowed,
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
    delivery: {
      status: 'unknown',
      source: null,
      pr_url: null,
      merge_commit_sha: null,
      merged_at: null,
      observed_at: null
    },
    reconciliation: {
      status: 'pending',
      reasons: [],
      evaluated_at: null,
      head_sha: currentHeadSha ?? null
    },
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
  if (!gateAuthorization.allowed) {
    merge.warnings.push(
      `Merge gate authorization rejected (${gateAuthorization.reason}). Run \`vibepro pr prepare\` and \`vibepro pr create\` again for the current HEAD, then retry the merge after resolving critical gates or supplying a complete noncritical waiver.`
    );
  }

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
    return attachExecutionStateSyncBaseline(merge, artifacts);
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
    return attachExecutionStateSyncBaseline(merge, artifacts);
  }

  const originUrl = await gitOptional(root, ['remote', 'get-url', 'origin']);
  if (merge.preconditions.gate_ready !== true && !originUrl) {
    merge.status = 'blocked';
    merge.stop_reason = 'gate_not_ready';
    merge.preconditions.base_freshness.status = 'not_run';
    merge.preconditions.remote_head_match.status = 'not_run';
    merge.preconditions.checks_ready.status = 'not_run';
    merge.preconditions.review_policy.status = 'not_run';
    merge.preconditions.open_pull_request.status = 'not_run';
    const artifacts = await writePrMergeArtifacts(root, storyId, merge);
    return attachExecutionStateSyncBaseline(merge, artifacts);
  }

  // Refresh the read-only base observation before deciding whether a stale
  // local gate may be bypassed for external-delivery reconciliation. Checking
  // origin/<base> first can return gate_not_ready from a stale clone even when
  // another clone has already merged the selected PR.
  const fetchResult = await runCommand(root, fetchCommand, options);
  merge.results.push(fetchResult);
  if (fetchResult.exit_code !== 0) {
    merge.stop_reason = 'base_fetch_failed';
    merge.preconditions.base_freshness.status = 'blocked';
    merge.error = `Command failed: ${fetchResult.command}`;
    applyProviderObservationFailure(merge, priorObservedMerge, 'base_fetch_failed');
    const artifacts = await writePrMergeArtifacts(root, storyId, merge);
    return attachExecutionStateSyncBaseline(merge, artifacts);
  }

  // Reject an unauthorized managed merge before provider mutation, while still
  // allowing reconciliation when the freshly observed base proves that the
  // story HEAD was delivered externally. Provider observation remains required
  // to bind that delivery to the selected PR.
  const locallyDeliveredHead = await gitIsAncestor(root, currentHeadSha, `origin/${baseBranch}`);
  const locallyDeliveredTree = await gitTreesEqual(root, currentHeadSha, `origin/${baseBranch}`);
  if (merge.preconditions.gate_ready !== true && !locallyDeliveredHead && !locallyDeliveredTree) {
    merge.status = 'blocked';
    merge.stop_reason = 'gate_not_ready';
    merge.preconditions.base_freshness.status = 'not_run';
    merge.preconditions.remote_head_match.status = 'not_run';
    merge.preconditions.checks_ready.status = 'not_run';
    merge.preconditions.review_policy.status = 'not_run';
    merge.preconditions.open_pull_request.status = 'not_run';
    const artifacts = await writePrMergeArtifacts(root, storyId, merge);
    return attachExecutionStateSyncBaseline(merge, artifacts);
  }

  const containsBase = await gitIsAncestor(root, `origin/${baseBranch}`, currentHeadSha);
  merge.preconditions.base_freshness.status = containsBase ? 'passed' : 'blocked';
  merge.preconditions.base_freshness.merge_base_contains_base = containsBase;

  const prViewResult = await runCommand(root, prViewCommand, options);
  merge.results.push(prViewResult);
  if (prViewResult.exit_code !== 0) {
    merge.stop_reason = 'pr_view_failed';
    merge.error = `Command failed: ${prViewResult.command}`;
    applyProviderObservationFailure(merge, priorObservedMerge, 'provider_command_failed');
    const artifacts = await writePrMergeArtifacts(root, storyId, merge);
    return attachExecutionStateSyncBaseline(merge, artifacts);
  }

  const prViewParse = parseProviderJson(prViewResult, 'pr_view_response_parse_failed');
  if (!prViewParse.ok) {
    merge.stop_reason = prViewParse.reason;
    merge.error = prViewParse.error;
    applyProviderObservationFailure(merge, priorObservedMerge, 'provider_response_parse_failed');
    merge.warnings.push(prViewParse.error);
    const artifacts = await writePrMergeArtifacts(root, storyId, merge);
    return attachExecutionStateSyncBaseline(merge, artifacts);
  }
  const prView = prViewParse.value;
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

  // A PR that is already MERGED can never satisfy the OPEN-PR preconditions
  // again (squash merge makes origin/<base> a non-ancestor of the branch head
  // and the PR is no longer OPEN). Blocking here would misreport a completed
  // merge as blocked forever, so reconcile the external merge instead.
  const externallyMerged = prView.state === 'MERGED';

  if (!externallyMerged) {
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
      return attachExecutionStateSyncBaseline(merge, artifacts);
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
      return attachExecutionStateSyncBaseline(merge, artifacts);
    }

    // `gh pr merge` updates the remote base after the precondition fetch. Refresh
    // it again before using origin/<base> as delivery authority; otherwise a
    // successful managed merge is compared with the stale pre-merge ref.
    const postMergeFetchResult = await runCommand(root, fetchCommand, options);
    merge.results.push(postMergeFetchResult);
    if (postMergeFetchResult.exit_code !== 0) {
      merge.stop_reason = 'post_merge_base_fetch_failed';
      merge.error = `Post-merge base fetch failed: ${postMergeFetchResult.command}`;
      applyPostMergeObservationFailure(merge, priorObservedMerge, 'base_fetch_failed', {
        managedMergeCompleted: true
      });
      merge.warnings.push(merge.error);
      const artifacts = await writePrMergeArtifacts(root, storyId, merge);
      return attachExecutionStateSyncBaseline(merge, artifacts);
    }
  }

  const mergedViewResult = await runCommand(
    root,
    ['gh', buildPrViewArgs(prSelector, repositorySlug, 'url,state,mergedAt,mergeCommit')],
    options,
    { cwd: os.tmpdir() }
  );
  merge.results.push(mergedViewResult);
  if (mergedViewResult.exit_code !== 0) {
    merge.stop_reason = 'post_merge_pr_view_failed';
    merge.error = `Post-merge PR view failed: ${mergedViewResult.command}`;
    applyPostMergeObservationFailure(merge, priorObservedMerge, 'provider_command_failed', {
      managedMergeCompleted: !externallyMerged
    });
    merge.warnings.push(merge.error);
    const artifacts = await writePrMergeArtifacts(root, storyId, merge);
    return attachExecutionStateSyncBaseline(merge, artifacts);
  }
  const mergedViewParse = parseProviderJson(mergedViewResult, 'post_merge_response_parse_failed');
  if (!mergedViewParse.ok) {
    merge.stop_reason = mergedViewParse.reason;
    merge.error = mergedViewParse.error;
    applyPostMergeObservationFailure(merge, priorObservedMerge, 'provider_response_parse_failed', {
      managedMergeCompleted: !externallyMerged
    });
    merge.warnings.push(mergedViewParse.error);
    const artifacts = await writePrMergeArtifacts(root, storyId, merge);
    return attachExecutionStateSyncBaseline(merge, artifacts);
  }
  const mergedView = mergedViewParse.value;
  merge.pr.url = mergedView.url ?? merge.pr.url;
  merge.pr.state = mergedView.state ?? merge.pr.state;
  merge.merge_commit_sha = mergedView.mergeCommit?.oid ?? null;
  merge.merged_at = mergedView.mergedAt ?? null;
  if (merge.git?.diff_stats?.refs) {
    merge.git.diff_stats.refs.merge_commit_sha = merge.merge_commit_sha ?? null;
  }

  const mergeCommitOnBase = mergedViewParse?.ok === true && merge.pr.state === 'MERGED' && merge.merge_commit_sha
    ? await gitIsAncestor(root, merge.merge_commit_sha, `origin/${baseBranch}`)
    : false;
  if (!mergeCommitOnBase) {
    merge.delivery.status = 'unverified';
    merge.delivery.source = 'github_pr';
    merge.delivery.pr_url = merge.pr.url ?? null;
    merge.delivery.merge_commit_sha = merge.merge_commit_sha ?? null;
    merge.delivery.merged_at = merge.merged_at ?? null;
    merge.reconciliation.status = 'blocked';
    merge.reconciliation.reasons = [
      'delivery_not_verified',
      ...(mergedViewParse && !mergedViewParse.ok ? ['provider_response_parse_failed'] : [])
    ];
    merge.reconciliation.evaluated_at = new Date().toISOString();
    merge.status = 'blocked';
    merge.stop_reason = externallyMerged ? 'pr_merged_externally_unverified' : 'pr_delivery_unverified';
    merge.warnings.push(
      `Delivery could not be confirmed: merge commit ${merge.merge_commit_sha ?? '(unknown)'} is not verified on origin/${baseBranch}; run \`git fetch origin ${baseBranch}\` and retry, or verify the PR manually.`
    );
    const artifacts = await writePrMergeArtifacts(root, storyId, merge);
    return attachExecutionStateSyncBaseline(merge, artifacts);
  }

  // Branch cleanup is irreversible and must follow authoritative delivery
  // verification. A successful `gh pr merge` response alone is insufficient:
  // if the merged view or base ancestry cannot be verified, retain the branch
  // so an operator can inspect and recover the delivery.
  if (!externallyMerged && deleteBranch && merge.pr.head_ref_name) {
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

  if (externallyMerged) {
    merge.warnings.push(
      `PR was already merged externally at ${merge.merged_at ?? 'unknown time'} (commit ${merge.merge_commit_sha}); reconciled as merged_externally instead of blocking.`
    );
  }

  const deliveryStatus = externallyMerged ? 'merged_externally' : 'merged';
  merge.delivery = {
    status: deliveryStatus,
    source: 'github_pr',
    pr_url: merge.pr.url ?? null,
    merge_commit_sha: merge.merge_commit_sha ?? null,
    merged_at: merge.merged_at ?? null,
    observed_at: new Date().toISOString()
  };
  const reconciliationReasons = collectDeliveryReconciliationReasons(merge);
  merge.reconciliation = {
    status: reconciliationReasons.length > 0 ? 'reconciliation_required' : 'reconciled',
    reasons: reconciliationReasons,
    evaluated_at: new Date().toISOString(),
    head_sha: currentHeadSha ?? null
  };
  if (reconciliationReasons.length > 0) {
    merge.warnings.push(
      `Delivery is verified, but local reconciliation is required: ${reconciliationReasons.join(', ')}`
    );
  }
  merge.status = externallyMerged ? 'merged_externally' : 'merged';
  merge.stop_reason = reconciliationReasons.length > 0 ? 'delivery_reconciliation_required' : null;
  const roiLedgerSource = await readPromotableGateOutcomeEntries(root, storyId);
  const roiLedgerLocalEntries = roiLedgerSource.entries;
  const centralLedgerAtMerge = await gitOptional(root, [
    'show',
    `${merge.merge_commit_sha}:${CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH}`
  ]);
  const anticipatedRoiPromotion = roiLedgerSource.status === 'failed'
    ? {
        status: 'failed',
        reason: roiLedgerSource.reason,
        promoted_count: 0,
        duplicate_count: 0,
        source_ledger: roiLedgerSource.source_ledger,
        central_ledger_path: CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH
      }
    : computeCentralLedgerPromotion({
        localEntries: roiLedgerLocalEntries,
        centralText: centralLedgerAtMerge
      });
  applyDecisionOutcomeBinding(merge, {
    localEntries: roiLedgerLocalEntries,
    promotion: anticipatedRoiPromotion,
    localLedgerSource: roiLedgerSource
  });
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
    options,
    roiLedgerPromotion: roiLedgerSource.status === 'failed'
      ? null
      : { localEntries: roiLedgerLocalEntries }
  });
  merge.canonical_audit.persistence = canonicalPersistence.summary;
  merge.roi_ledger_promotion = roiLedgerSource.status === 'failed'
    ? {
        status: 'failed',
        reason: roiLedgerSource.reason,
        promoted_count: 0,
        duplicate_count: 0,
        source_ledger: roiLedgerSource.source_ledger,
        central_ledger_path: CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH
      }
    : canonicalPersistence.roi_ledger_promotion ?? null;
  applyDecisionOutcomeBinding(merge, {
    localEntries: roiLedgerLocalEntries,
    promotion: merge.roi_ledger_promotion,
    localLedgerSource: roiLedgerSource,
    persistence: canonicalPersistence.summary
  });
  if (merge.decision_outcome_binding.status === 'failed') {
    merge.warnings.push(
      `Decision outcome binding failed: ${merge.decision_outcome_binding.reason ?? 'unknown'} (delivery remains immutable; reconciliation required)`
    );
  }
  if (merge.roi_ledger_promotion?.status === 'failed') {
    merge.warnings.push(
      `ROI ledger promotion failed: ${merge.roi_ledger_promotion.reason ?? 'unknown'} (central ledger left untouched)`
    );
  }
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
  // Capture the persisted merge artifact before releasing the story lock.
  // The CLI must use this exact snapshot as its follow-up CAS baseline; reading
  // it after executeMerge returns would accept an intervening operator write.
  return attachExecutionStateSyncBaseline(merge, artifacts);
}

async function attachExecutionStateSyncBaseline(merge, artifacts) {
  const executionStateSyncBaseline = await readJsonIfExists(artifacts?.pr_merge_json);
  return { merge, artifacts, execution_state_sync_baseline: executionStateSyncBaseline };
}

function resolvePriorObservedMerge(candidates, { baseBranch, prSelector } = {}) {
  if (!baseBranch || !prSelector) return null;
  const candidate = candidates.find((candidate) => {
    const deliveryStatus = candidate?.delivery?.status ?? candidate?.status;
    if (!['merged', 'merged_externally'].includes(deliveryStatus)) return false;
    const candidateBase = candidate.base ?? candidate.git?.base_branch ?? candidate.git?.base_ref ?? null;
    if (!candidateBase || stripRemote(candidateBase) !== stripRemote(baseBranch)) return false;
    const candidateSelector = candidate.pr?.selector ?? candidate.pr?.url ?? candidate.delivery?.pr_url ?? null;
    return candidateSelector === prSelector;
  }) ?? null;
  if (!candidate) return null;
  const deliveryStatus = candidate.delivery?.status ?? candidate.status;
  return {
    ...candidate,
    delivery: {
      ...(candidate.delivery ?? {}),
      status: deliveryStatus,
      observed: candidate.delivery?.observed ?? true,
      source: candidate.delivery?.source ?? 'legacy_pr_merge',
      pr_url: candidate.delivery?.pr_url ?? candidate.pr?.url ?? candidate.pr?.selector ?? null,
      merge_commit_sha: candidate.delivery?.merge_commit_sha ?? candidate.merge_commit_sha ?? null,
      merged_at: candidate.delivery?.merged_at ?? candidate.merged_at ?? null
    }
  };
}

function applyProviderObservationFailure(merge, priorObservedMerge, reason) {
  const evaluatedAt = new Date().toISOString();
  if (priorObservedMerge) {
    merge.delivery = { ...priorObservedMerge.delivery };
    merge.merge_commit_sha = priorObservedMerge.merge_commit_sha
      ?? priorObservedMerge.delivery?.merge_commit_sha
      ?? null;
    merge.merged_at = priorObservedMerge.merged_at
      ?? priorObservedMerge.delivery?.merged_at
      ?? null;
    merge.reconciliation = {
      status: 'reconciliation_required',
      reasons: [reason],
      evaluated_at: evaluatedAt,
      head_sha: merge.current_head_sha ?? null
    };
    merge.warnings.push('Preserved previously observed delivery while the current provider observation failed.');
    return;
  }
  merge.delivery.status = 'unverified';
  merge.delivery.source = 'github_pr';
  merge.reconciliation.status = 'blocked';
  merge.reconciliation.reasons = [reason];
  merge.reconciliation.evaluated_at = evaluatedAt;
}

function applyPostMergeObservationFailure(merge, priorObservedMerge, reason, {
  managedMergeCompleted = false
} = {}) {
  applyProviderObservationFailure(merge, priorObservedMerge, reason);
  // A command that has just completed the provider merge but cannot finish
  // provider/base post-processing is an initial processing failure (exit 1).
  // A retry with an identity-bound prior delivery remains an unresolved
  // reconciliation (exit 2) and must not erase that immutable delivery fact.
  merge.status = managedMergeCompleted && !priorObservedMerge ? 'failed' : 'blocked';
}

function collectDeliveryReconciliationReasons(merge) {
  const reasons = [];
  if (merge.preconditions.gate_ready !== true) reasons.push('gate_not_ready');
  if (!merge.preconditions.clean_worktree) reasons.push('dirty_worktree');
  if (merge.preconditions.remote_head_match.status !== 'passed') reasons.push('remote_head_mismatch');
  if (merge.preconditions.checks_ready.status !== 'passed') reasons.push('checks_not_ready');
  if (merge.preconditions.review_policy.status !== 'passed') reasons.push('review_policy_not_satisfied');
  return reasons;
}

export function buildDecisionOutcomeBinding({
  localEntries = [],
  promotion = null,
  merge = null,
  localLedgerSource = null,
  persistence = null
} = {}) {
  const sourceFailed = localLedgerSource?.status === 'failed';
  const expectedEntryCount = sourceFailed
    ? null
    : Array.isArray(localEntries) ? localEntries.length : 0;
  const promotedCount = Number.isFinite(promotion?.promoted_count) ? promotion.promoted_count : 0;
  const duplicateCount = Number.isFinite(promotion?.duplicate_count) ? promotion.duplicate_count : 0;
  const accountedEntryCount = promotedCount + duplicateCount;
  const required = sourceFailed || expectedEntryCount > 0;
  const persistenceStatus = persistence?.status ?? null;
  const persistenceConfirmed = persistenceStatus == null
    || ['pushed', 'already_present'].includes(persistenceStatus);
  // A successful persistence result is recorded in canonical_audit.persistence.
  // Re-projecting it into the content being persisted would make the first
  // canonical commit (null) differ from the post-push state (pushed), forcing a
  // second push. Keep the binding stable across confirmed success while still
  // retaining an actionable failed status.
  const bindingPersistenceStatus = persistenceConfirmed ? null : persistenceStatus;
  const delivery = {
    status: merge?.delivery?.status ?? null,
    pr_url: merge?.delivery?.pr_url ?? merge?.pr?.url ?? null,
    merge_commit_sha: merge?.delivery?.merge_commit_sha ?? merge?.merge_commit_sha ?? null,
    base: merge?.base ?? null
  };

  if (sourceFailed) {
    return {
      schema_version: '0.1.0',
      status: 'failed',
      required: true,
      reason: localLedgerSource.reason ?? 'local_gate_outcome_ledger_invalid',
      source_ledger: localLedgerSource.source_ledger ?? '.vibepro/gate-outcomes/ledger.json',
      source_ledger_status: localLedgerSource.status,
      canonical_ledger: CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH,
      expected_entry_count: null,
      promoted_count: promotedCount,
      duplicate_count: duplicateCount,
      persistence_status: bindingPersistenceStatus,
      delivery
    };
  }

  if (!required) {
    return {
      schema_version: '0.1.0',
      status: 'not_applicable',
      required: false,
      reason: 'no_local_decision_outcomes',
      source_ledger: '.vibepro/gate-outcomes/ledger.json',
      canonical_ledger: CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH,
      expected_entry_count: 0,
      promoted_count: promotedCount,
      duplicate_count: duplicateCount,
      persistence_status: bindingPersistenceStatus,
      delivery
    };
  }

  const bound = promotion?.status === 'promoted'
    && accountedEntryCount === expectedEntryCount
    && persistenceConfirmed;
  return {
    schema_version: '0.1.0',
    status: bound ? 'bound' : 'failed',
    required: true,
    reason: bound
      ? 'all_local_decision_outcomes_bound_to_canonical_ledger'
      : !persistenceConfirmed
        ? persistence?.reason ?? `canonical_persistence_${persistenceStatus ?? 'unconfirmed'}`
      : promotion?.status === 'promoted'
        ? 'decision_outcome_binding_count_mismatch'
        : promotion?.reason ?? `decision_outcome_promotion_${promotion?.status ?? 'missing'}`,
    source_ledger: '.vibepro/gate-outcomes/ledger.json',
    canonical_ledger: CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH,
    expected_entry_count: expectedEntryCount,
    promoted_count: promotedCount,
    duplicate_count: duplicateCount,
    persistence_status: bindingPersistenceStatus,
    delivery
  };
}

export function applyDecisionOutcomeBinding(merge, {
  localEntries = [],
  promotion = null,
  localLedgerSource = null,
  persistence = null
} = {}) {
  const binding = buildDecisionOutcomeBinding({ localEntries, promotion, merge, localLedgerSource, persistence });
  merge.decision_outcome_binding = binding;
  if (binding.status !== 'failed') return binding;

  merge.reconciliation = {
    ...merge.reconciliation,
    status: 'reconciliation_required',
    reasons: [...new Set([
      ...(merge.reconciliation?.reasons ?? []),
      'decision_outcome_binding_failed'
    ])],
    evaluated_at: new Date().toISOString()
  };
  merge.stop_reason = 'decision_outcome_binding_failed';
  return binding;
}

function parseProviderJson(result, reason) {
  try {
    return { ok: true, value: JSON.parse(result.stdout || '{}') };
  } catch (error) {
    return {
      ok: false,
      reason,
      error: `Provider JSON response could not be parsed for ${result.command}: ${error.message}`
    };
  }
}

export async function persistMergeFollowupState(
  repoRoot,
  { storyId, merge, expectedMerge = null },
  dependencies = {}
) {
  if (!storyId || !merge) throw new Error('persistMergeFollowupState requires storyId and merge');
  const root = path.resolve(repoRoot);
  return withStoryTransactionLocks([root], storyId, async () => {
    const mergeArtifactPath = await resolvePrArtifactFile(root, storyId, 'pr-merge.json');
    if (expectedMerge) {
      const currentMerge = await readJsonIfExists(mergeArtifactPath);
      if (!jsonValuesEqual(currentMerge, expectedMerge)) {
        const conflict = new Error('merge follow-up changed concurrently; refusing to overwrite newer operator guidance');
        conflict.code = 'merge_followup_transaction_conflict';
        conflict.artifact_path = mergeArtifactPath;
        conflict.restore_errors = [{ artifact_path: conflict.artifact_path, message: conflict.message }];
        throw conflict;
      }
    }
  const originalMerge = structuredClone(merge);
  try {
    return await withMergeFollowupPersistenceTransaction(root, storyId, async (runTransactionStep) => {
      const artifacts = await runTransactionStep((onArtifactWritten) => writePrMergeArtifacts(root, storyId, merge, {
        onArtifactWritten
      }));
      const canonicalAudit = await runTransactionStep((onArtifactWritten) => (
        dependencies.promoteCanonicalAuditArtifacts ?? promoteCanonicalAuditArtifacts
      )(root, {
          storyId,
          source: 'execute_merge_followup',
          merge,
          onArtifactWritten
        }));
      merge.canonical_audit = {
        ...(merge.canonical_audit ?? {}),
        bundle: toWorkspaceRelative(root, canonicalAudit.bundle_path),
        directory: toWorkspaceRelative(root, canonicalAudit.canonical_dir),
        artifact_count: canonicalAudit.bundle.artifacts.length,
        missing_artifact_count: canonicalAudit.bundle.missing_artifacts.length
      };
      await runTransactionStep((onArtifactWritten) => writeCanonicalAuditManifest(
        root,
        storyId,
        canonicalAudit,
        merge,
        { onArtifactWritten }
      ));
      await runTransactionStep((onArtifactWritten) => writePrMergeArtifacts(root, storyId, merge, {
        onArtifactWritten
      }));
      const canonicalPrDir = path.join(canonicalAudit.canonical_dir, 'pr');
      await runTransactionStep(async (onArtifactWritten) => {
        await mkdir(canonicalPrDir, { recursive: true });
        const canonicalJsonPath = path.join(canonicalPrDir, 'pr-merge.json');
        const canonicalReportPath = path.join(canonicalPrDir, 'pr-merge.html');
        await writeFile(canonicalJsonPath, `${JSON.stringify(merge, null, 2)}\n`);
        await onArtifactWritten(canonicalJsonPath);
        await writeFile(canonicalReportPath, renderPrMergeHtml(merge, {
          language: merge.output?.language ?? 'ja'
        }));
        await onArtifactWritten(canonicalReportPath);
      });
      return { artifacts, canonical_audit: canonicalAudit };
    });
  } catch (error) {
    for (const key of Object.keys(merge)) delete merge[key];
    Object.assign(merge, originalMerge);
    throw error;
  }
  });
}

export async function persistMergeRecoveryState(
  repoRoot,
  { storyId, merge, expectedMerge = null }
) {
  if (!storyId || !merge) throw new Error('persistMergeRecoveryState requires storyId and merge');
  const root = path.resolve(repoRoot);
  return withStoryTransactionLocks([root], storyId, async () => {
    const mergeArtifactPath = await resolvePrArtifactFile(root, storyId, 'pr-merge.json');
    if (expectedMerge) {
      const currentMerge = await readJsonIfExists(mergeArtifactPath);
      if (!jsonValuesEqual(currentMerge, expectedMerge)) {
        const conflict = new Error('merge recovery state changed concurrently; refusing to overwrite newer operator guidance');
        conflict.code = 'merge_recovery_state_conflict';
        conflict.artifact_path = mergeArtifactPath;
        throw conflict;
      }
    }
    return writePrMergeArtifacts(root, storyId, merge);
  });
}

async function withMergeFollowupPersistenceTransaction(repoRoot, storyId, persist) {
  const root = path.resolve(repoRoot);
  const transactionRoot = await mkdtemp(path.join(os.tmpdir(), `vibepro-merge-followup-${storyId}-`));
  const routedPrDir = path.dirname(await resolvePrArtifactFile(root, storyId, 'pr-merge.json'));
  const targets = collapseMergeFollowupTransactionTargets([
    routedPrDir,
    path.join(root, 'docs', 'management', 'audit-artifacts', storyId),
    path.join(getWorkspaceDir(root), 'vibepro-manifest.json')
  ]);
  const snapshots = [];
  const ownedArtifacts = new Map();
  try {
    for (const [index, target] of targets.entries()) {
      const backup = path.join(transactionRoot, String(index));
      try {
        await cp(target, backup, { recursive: true, force: true });
        snapshots.push({
          target,
          backup,
          existed: true,
          original_fingerprint: await fingerprintMergeFollowupPath(target),
          expected_fingerprint: await fingerprintMergeFollowupPath(target),
          written_fingerprint: null
        });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        snapshots.push({
          target,
          backup,
          existed: false,
          original_fingerprint: 'missing',
          expected_fingerprint: 'missing',
          written_fingerprint: null
        });
      }
    }
    const markWrites = async (paths) => {
      for (const artifactPath of [...new Set(paths.map((item) => path.resolve(item)))]) {
        const snapshot = findMergeFollowupSnapshot(snapshots, artifactPath);
        if (!snapshot) {
          throw new Error(`merge follow-up transaction did not snapshot owned artifact: ${artifactPath}`);
        }
        const existing = ownedArtifacts.get(artifactPath);
        ownedArtifacts.set(artifactPath, {
          artifact_path: artifactPath,
          original_fingerprint: existing?.original_fingerprint
            ?? await fingerprintMergeFollowupBackup(snapshot, artifactPath),
          written_fingerprint: await fingerprintMergeFollowupPath(artifactPath),
          snapshot
        });
        snapshot.expected_fingerprint = await fingerprintMergeFollowupPath(snapshot.target);
      }
    };
    const assertObservedAuthoritiesUnchanged = async () => {
      for (const snapshot of snapshots) {
        const observed = await fingerprintMergeFollowupPath(snapshot.target);
        if (observed === snapshot.expected_fingerprint) continue;
        const conflict = new Error(
          `merge follow-up authority changed concurrently; refusing to overwrite newer operator guidance: ${snapshot.target}`
        );
        conflict.code = 'merge_followup_transaction_conflict';
        conflict.artifact_path = snapshot.target;
        conflict.restore_errors = [{ artifact_path: snapshot.target, message: conflict.message }];
        throw conflict;
      }
    };
    const runTransactionStep = async (step) => {
      await assertObservedAuthoritiesUnchanged();
      return step(async (artifactPath) => {
        await markWrites([artifactPath]);
        await assertObservedAuthoritiesUnchanged();
      });
    };
    const result = await persist(runTransactionStep);
    await assertObservedAuthoritiesUnchanged();
    return result;
  } catch (error) {
    const rollbackErrors = [];
    for (const owned of [...ownedArtifacts.values()].reverse()) {
      try {
        const currentFingerprint = await fingerprintMergeFollowupPath(owned.artifact_path);
        if (currentFingerprint === owned.original_fingerprint) continue;
        if (!owned.written_fingerprint || currentFingerprint !== owned.written_fingerprint) {
          const conflict = new Error(`merge follow-up changed concurrently; refusing rollback overwrite: ${owned.artifact_path}`);
          conflict.code = 'merge_followup_transaction_conflict';
          throw conflict;
        }
        await restoreMergeFollowupArtifact(owned);
      } catch (rollbackError) {
        rollbackErrors.push({ artifact_path: owned.artifact_path, message: rollbackError.message });
      }
    }
    if (rollbackErrors.length > 0) {
      const transactionError = new Error(
        `${error.message}; merge follow-up rollback failed: ${rollbackErrors.map((item) => `${item.artifact_path}: ${item.message}`).join('; ')}`,
        { cause: error }
      );
      transactionError.code = 'merge_followup_transaction_restore_failed';
      transactionError.restore_errors = rollbackErrors;
      throw transactionError;
    }
    throw error;
  } finally {
    await rm(transactionRoot, { recursive: true, force: true }).catch(() => null);
  }
}

function collapseMergeFollowupTransactionTargets(targets) {
  const resolved = [...new Set(targets.map((target) => path.resolve(target)))];
  return resolved.filter((candidate) => !resolved.some((other) => (
    other !== candidate && candidate.startsWith(`${other}${path.sep}`)
  )));
}

function findMergeFollowupSnapshot(snapshots, artifactPath) {
  return snapshots.find((snapshot) => (
    artifactPath === snapshot.target
    || artifactPath.startsWith(`${snapshot.target}${path.sep}`)
  ));
}

function mergeFollowupBackupPath(snapshot, artifactPath) {
  if (artifactPath === snapshot.target) return snapshot.backup;
  return path.join(snapshot.backup, path.relative(snapshot.target, artifactPath));
}

async function fingerprintMergeFollowupBackup(snapshot, artifactPath) {
  if (!snapshot.existed) return 'missing';
  return fingerprintMergeFollowupPath(mergeFollowupBackupPath(snapshot, artifactPath));
}

async function restoreMergeFollowupArtifact(owned) {
  const backupPath = mergeFollowupBackupPath(owned.snapshot, owned.artifact_path);
  await rm(owned.artifact_path, { recursive: true, force: true });
  if (owned.original_fingerprint === 'missing') return;
  await mkdir(path.dirname(owned.artifact_path), { recursive: true });
  await cp(backupPath, owned.artifact_path, { recursive: true, force: true });
}

async function fingerprintMergeFollowupPath(targetPath) {
  try {
    const metadata = await lstat(targetPath);
    if (!metadata.isDirectory()) {
      return `file:${createHash('sha256').update(await readFile(targetPath)).digest('hex')}`;
    }
    const hash = createHash('sha256');
    for (const entry of (await readdir(targetPath)).sort()) {
      hash.update(entry);
      hash.update('\0');
      hash.update(await fingerprintMergeFollowupPath(path.join(targetPath, entry)));
      hash.update('\0');
    }
    return `dir:${hash.digest('hex')}`;
  } catch (error) {
    if (error.code === 'ENOENT') return 'missing';
    throw error;
  }
}

function jsonValuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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

  if (options.sessionId || options.inferSession) {
    try {
      const sessionAudit = await collectSessionEfficiencyAudit(root, {
        storyId,
        sessionId: options.sessionId,
        inferSession: options.inferSession === true || options.sessionId === 'auto',
        codexHome: options.codexHome,
        automationMemoryPath: options.automationMemoryPath,
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
          session_id: sessionAudit.session_id ?? options.sessionId ?? null,
          session_selection: sessionAudit.session_selection ?? null,
          automation_memory: sessionAudit.automation_memory ?? null,
          observed_worktree: sessionAudit.observed_worktree ?? null,
          observed_worktree_source: sessionAudit.observed_worktree_source ?? null,
          audit_readiness: sessionAudit.audit_readiness ?? null,
          collected_at: collectedAt
        },
        warnings
      };
    } catch (error) {
      warnings.push(`Session cost accounting could not be collected: ${error.message}`);
      return {
        cost_accounting: unavailableExecuteMergeCostAccounting({
          source: 'audit-session-cost',
          reason: error.message,
          storyId,
          collectedAt
        }),
        collection: {
          status: 'unavailable',
          source: 'audit-session-cost',
          session_id: options.sessionId ?? null,
          session_selection: {
            status: 'unavailable',
            reason: error.message
          },
          automation_memory_path: options.automationMemoryPath ?? null,
          reason: error.message,
          collected_at: collectedAt
        },
        warnings
      };
    }
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
  const sessionAudit = [input, cost, input?.session_efficiency_audit, cost?.session_efficiency_audit]
    .find((candidate) => candidate?.artifact_kind === 'vibepro_session_efficiency_audit') ?? null;
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
  const artifactToken = cost?.artifact_token_accounting
    ?? session?.artifact_token_accounting
    ?? input?.artifact_token_accounting
    ?? null;
  const normalizedArtifactToken = artifactToken
    ?? unavailableArtifactTokenAccounting(source, storyId, 'artifact-token accounting was not present in execute merge cost input');
  const normalized = {
    schema_version: '0.1.0',
    status: hasUsableAccounting(token) || hasUsableAccounting(elapsed) ? 'available' : 'partial',
    source,
    source_path: sourcePath,
    story_id: input?.story_id ?? storyId ?? null,
    session_id: input?.session_id ?? session?.window?.session_id ?? token?.window?.session_id ?? elapsed?.window?.session_id ?? null,
    collected_at: collectedAt ?? null,
    token_accounting: token ?? unavailableTokenAccounting(source, storyId, 'token accounting was not present in execute merge cost input'),
    elapsed_time_accounting: elapsed ?? unavailableElapsedTimeAccounting(source, storyId, 'elapsed-time accounting was not present in execute merge cost input'),
    artifact_token_accounting: normalizedArtifactToken
  };
  if (sessionAudit) {
    normalized.session_efficiency_audit = {
      artifact_kind: sessionAudit.artifact_kind,
      audit_readiness: sessionAudit.audit_readiness ?? null,
      observed_worktree: sessionAudit.observed_worktree ?? null,
      observed_worktree_source: sessionAudit.observed_worktree_source ?? null,
      cost_breakdown: sessionAudit.cost_breakdown ?? null,
      attribution: sessionAudit.attribution ?? null,
      primary: sessionAudit.primary ?? sessionAudit.attribution?.primary ?? null,
      upper_bound: sessionAudit.upper_bound ?? sessionAudit.attribution?.upper_bound ?? null,
      mixed_parent: sessionAudit.mixed_parent ?? sessionAudit.attribution?.mixed_parent ?? null,
      strict_over_associated: sessionAudit.strict_over_associated ?? sessionAudit.attribution?.strict_over_associated ?? null,
      artifact_token_accounting: normalizedArtifactToken
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
    elapsed_time_accounting: unavailableElapsedTimeAccounting(source, storyId, reason),
    artifact_token_accounting: unavailableArtifactTokenAccounting(source, storyId, reason)
  };
}

function unavailableArtifactTokenAccounting(source, storyId, reason) {
  const bucketLabels = {
    audit_evidence: '監査証跡 / canonical audit artifacts / gate-review-verification evidence',
    story_spec_architecture_docs: 'story/spec/architecture docs',
    src_code: 'src/ コード本体',
    test: 'test/',
    replayed_context: '再送された文脈（compaction後のgoal/permissions等の再掲）/ replayed carryover context after compaction',
    unattributed: 'unattributed Codex development in daily window'
  };
  const bucket = (id) => ({
    id,
    label: bucketLabels[id],
    estimated_tokens: null,
    event_count: null,
    ratio_of_classified_exposure: null,
    ratio_of_session_tokens: null,
    matched_signals: []
  });
  const provenanceBucket = (id) => ({
    id,
    estimated_tokens: null,
    unique_estimated_tokens: null,
    duplicate_estimated_tokens: null,
    event_count: null,
    unique_digest_count: null
  });
  return {
    status: 'unavailable',
    estimated_total_tokens: null,
    classified_estimated_tokens: null,
    total_session_tokens: null,
    source,
    estimate_method: 'ceil(text.length / 4) for in-window transcript entries with artifact/code/doc path signals',
    coverage: 'signal-matched transcript entries only',
    buckets: Object.fromEntries([
      'audit_evidence',
      'story_spec_architecture_docs',
      'src_code',
      'test',
      'replayed_context',
      'unattributed'
    ].map((id) => [id, bucket(id)])),
    provenance_buckets: Object.fromEntries([
      'fresh_read',
      'generated_output',
      'replayed_context',
      'world_state',
      'mixed_tool_output'
    ].map((id) => [id, provenanceBucket(id)])),
    unique_estimated_tokens: null,
    duplicate_estimated_tokens: null,
    carryover_control: {
      status: 'unavailable',
      replayed_context_estimated_tokens: null,
      duplicate_estimated_tokens: null,
      duplicate_over_unique: null,
      duplicate_over_unique_threshold: 1
    },
    top_exposures: [],
    unmatched_event_count: null,
    unmatched_estimated_tokens: null,
    window: storyId ? { story_id: storyId } : null,
    reason
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
  const reconciliationAction = resolveReconciliationAction(merge);
  const persistenceDetails = merge.execution_state_sync?.persistence_error_details ?? null;
  const restoreErrors = Array.isArray(persistenceDetails?.restore_errors)
    ? persistenceDetails.restore_errors
    : [];
  const synchronizationDiagnostics = merge.execution_state_sync?.status === 'failed'
    ? [
        '- execution_state_sync: failed',
        `- execution_state_sync_reason: ${merge.execution_state_sync.reason}`,
        `- followup_persistence: ${merge.execution_state_sync.followup_persistence ?? 'unknown'}`,
        ...(persistenceDetails?.code ? [`- followup_persistence_code: ${persistenceDetails.code}`] : []),
        ...(persistenceDetails?.cause ? [`- followup_persistence_original_error: ${persistenceDetails.cause}`] : []),
        `- followup_rollback: ${restoreErrors.length > 0 ? 'incomplete' : 'complete_or_not_required'}`,
        ...restoreErrors.map((item, index) => `- followup_restore_error_${index + 1}: ${item.artifact_path ?? '-'}: ${item.message ?? 'unknown restore error'}`)
      ].join('\n')
    : '';
  return `# Execute Merge

- story: ${merge.story?.story_id ?? '-'}
- status: ${merge.status}
- strategy: ${merge.strategy}
- pr: ${merge.pr?.url ?? merge.pr?.selector ?? '-'}
- stop_reason: ${merge.stop_reason ?? 'none'}
- merge_commit: ${merge.merge_commit_sha ?? '-'}
- merged_at: ${merge.merged_at ?? '-'}
- delivery: ${merge.delivery?.status ?? 'unknown'}
- reconciliation: ${merge.reconciliation?.status ?? 'unknown'}
- reconciliation_reasons: ${(merge.reconciliation?.reasons ?? []).join('|') || 'none'}
${reconciliationAction ? reconciliationAction.commands.map((command, index) => `- reconciliation_action_${index + 1}: ${command}`).join('\n') : ''}
${synchronizationDiagnostics}

## Preconditions

- gate_ready: ${merge.preconditions.gate_ready ? 'passed' : 'blocked'}
- gate_authorization_source: ${merge.gate_authorization?.source ?? 'none'}
- gate_authorization_reason: ${merge.gate_authorization?.reason ?? '-'}
- gate_override_policy: ${merge.gate_authorization?.gate_override?.waiver_policy ?? '-'}
- gate_override_critical_unresolved: ${merge.gate_authorization?.gate_override?.critical_unresolved_gates?.length ?? '-'}
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

## Warnings / Next Actions

${(merge.warnings ?? []).map((warning) => `- ${warning}`).join('\n') || '- none'}
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

async function collectNonWorkspaceDirtyFiles(repoRoot, { storyId } = {}) {
  const canonicalAuditPrefix = storyId
    ? `docs/management/audit-artifacts/${storyId}/`
    : null;
  const routedPrDir = storyId
    ? toPosixPath(path.relative(repoRoot, path.dirname(await resolvePrArtifactFile(repoRoot, storyId))))
    : null;
  const routedGateArtifact = storyId
    ? toPosixPath(path.relative(repoRoot, await resolveGateArtifactFile(repoRoot, storyId)))
    : null;
  const output = await gitOptional(repoRoot, ['status', '--porcelain', '-uall']);
  const files = String(output ?? '')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .filter((file) => !file.startsWith('.vibepro/'))
    .filter((file) => canonicalAuditPrefix === null || !file.startsWith(canonicalAuditPrefix))
    .filter((file) => file !== routedGateArtifact)
    .filter((file) => !isRoutedPrLifecycleArtifact(file, routedPrDir));
  return [...new Set(files)];
}

function isRoutedPrLifecycleArtifact(file, routedPrDir) {
  if (!routedPrDir) return false;
  const relative = path.posix.relative(routedPrDir, toPosixPath(file));
  if (!relative || relative.startsWith('../') || relative.includes('/')) return false;
  return relative.startsWith('pr-') || relative === 'verification-evidence.json';
}

function toPosixPath(value) {
  return String(value).split(path.sep).join('/');
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

async function gitTreesEqual(repoRoot, left, right) {
  if (!left || !right || left === right) return false;
  try {
    await execFileAsync('git', ['diff', '--quiet', left, right, '--'], { cwd: repoRoot, encoding: 'utf8' });
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
    ?? artifact.git?.head_sha
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

async function writePrMergeArtifacts(repoRoot, storyId, merge, options = {}) {
  const jsonPath = await resolvePrArtifactFile(repoRoot, storyId, 'pr-merge.json');
  const reportPath = await resolvePrArtifactFile(repoRoot, storyId, 'pr-merge.html');
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(merge, null, 2)}\n`);
  await options.onArtifactWritten?.(jsonPath);
  await writeFile(reportPath, renderPrMergeHtml(merge, {
    language: merge.output?.language ?? 'ja'
  }));
  await options.onArtifactWritten?.(reportPath);

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
        latest_dry_run: merge.dry_run,
        latest_status: merge.status ?? null,
        latest_delivery: merge.delivery ?? null,
        latest_reconciliation: merge.reconciliation ?? null,
        latest_base: merge.base ?? merge.git?.base_branch ?? null
      }
    };
    await writeManifest(repoRoot, manifest);
    await options.onArtifactWritten?.(path.join(getWorkspaceDir(repoRoot), 'vibepro-manifest.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return {
    pr_merge_json: jsonPath,
    pr_merge_report: reportPath
  };
}

async function writeCanonicalAuditManifest(repoRoot, storyId, canonicalAudit, merge, options = {}) {
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
    await options.onArtifactWritten?.(path.join(getWorkspaceDir(repoRoot), 'vibepro-manifest.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function persistCanonicalAuditToBase(repoRoot, { storyId, canonicalAudit, baseBranch, merge, options = {}, roiLedgerPromotion = null } = {}) {
  const relativeDir = toWorkspaceRelative(repoRoot, canonicalAudit.canonical_dir);
  const roiPromotionResult = roiLedgerPromotion
    ? {
        status: 'not_run',
        reason: 'roi_promotion_not_reached',
        promoted_count: 0,
        duplicate_count: 0,
        central_ledger_path: CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH
      }
    : null;
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
    return { summary, commands, results, roi_ledger_promotion: roiPromotionResult };
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
    return { summary, commands, results, roi_ledger_promotion: roiPromotionResult };
  }
  summary.base_head_sha = await gitOptional(repoRoot, ['rev-parse', `origin/${baseBranch}`]);
  summary.merge_commit_on_base = await gitIsAncestor(repoRoot, merge.merge_commit_sha, `origin/${baseBranch}`);
  if (!summary.merge_commit_on_base) {
    summary.status = 'failed';
    summary.reason = 'canonical_audit_post_merge_base_missing_merge_commit';
    return { summary, commands, results, roi_ledger_promotion: roiPromotionResult };
  }

  const addWorktree = await run(['git', ['worktree', 'add', '--detach', tempWorktree, `origin/${baseBranch}`]]);
  if (addWorktree.exit_code !== 0) {
    summary.status = 'failed';
    summary.reason = 'canonical_audit_worktree_add_failed';
    return { summary, commands, results, roi_ledger_promotion: roiPromotionResult };
  }

  try {
    const destination = path.join(tempWorktree, relativeDir);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(canonicalAudit.canonical_dir, destination, { recursive: true });

    const stagePaths = [relativeDir];
    if (roiLedgerPromotion) {
      const centralPath = path.join(tempWorktree, CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH);
      const centralText = await readFile(centralPath, 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      const promotion = computeCentralLedgerPromotion({
        localEntries: roiLedgerPromotion.localEntries,
        centralText
      });
      roiPromotionResult.status = promotion.status;
      roiPromotionResult.reason = promotion.reason;
      roiPromotionResult.promoted_count = promotion.promoted_count;
      roiPromotionResult.duplicate_count = promotion.duplicate_count;
      roiPromotionResult.central_ledger_path = promotion.central_ledger_path;
      if (promotion.status === 'promoted' && promotion.serialized !== null) {
        await mkdir(path.dirname(centralPath), { recursive: true });
        await writeFile(centralPath, promotion.serialized);
        stagePaths.push(CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH);
      }
      // status === 'failed' never rewrites the central ledger (RML-CONTRACT-004);
      // status === 'no_entries' has nothing to stage.
    }

    const addResult = await run(['git', ['add', '--', ...stagePaths]], { cwd: tempWorktree });
    if (addResult.exit_code !== 0) {
      summary.status = 'failed';
      summary.reason = 'canonical_audit_git_add_failed';
      return { summary, commands, results, roi_ledger_promotion: roiPromotionResult };
    }

    const diffResult = await run(['git', ['diff', '--cached', '--quiet', '--', ...stagePaths]], { cwd: tempWorktree });
    if (diffResult.exit_code === 0) {
      summary.status = 'already_present';
      summary.pushed = false;
      summary.reason = 'canonical_audit_already_present_on_base';
      return { summary, commands, results, roi_ledger_promotion: roiPromotionResult };
    }
    if (diffResult.exit_code !== 1) {
      summary.status = 'failed';
      summary.reason = 'canonical_audit_diff_check_failed';
      return { summary, commands, results, roi_ledger_promotion: roiPromotionResult };
    }

    const commitResult = await run([
      'git',
      ['commit', '-m', `docs: persist VibePro audit artifacts for ${storyId}`]
    ], { cwd: tempWorktree });
    if (commitResult.exit_code !== 0) {
      summary.status = 'failed';
      summary.reason = 'canonical_audit_commit_failed';
      return { summary, commands, results, roi_ledger_promotion: roiPromotionResult };
    }
    summary.commit_sha = await gitOptional(tempWorktree, ['rev-parse', 'HEAD']);

    const pushResult = await run(['git', ['push', 'origin', `HEAD:${baseBranch}`]], { cwd: tempWorktree });
    if (pushResult.exit_code !== 0) {
      summary.status = 'failed';
      summary.reason = 'canonical_audit_push_failed';
      return { summary, commands, results, roi_ledger_promotion: roiPromotionResult };
    }
    summary.status = 'pushed';
    summary.pushed = true;
    summary.reason = `canonical audit bundle persisted after merge ${merge.merge_commit_sha ?? 'unknown'}`;
    return { summary, commands, results, roi_ledger_promotion: roiPromotionResult };
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
    await gitOptional(repoRoot, ['config', '--get', 'remote.origin.url']),
    context.prCreate?.pr_url,
    context.executionState?.pr_url,
    context.prCreate?.toolchain?.source_git?.origin_url,
    context.prPrepare?.toolchain?.source_git?.origin_url
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
