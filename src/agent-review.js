import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';

import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

const execFileAsync = promisify(execFile);

export const REVIEW_STAGE_ROLES = {
  requirement: ['product_requirement', 'scope_risk', 'acceptance_e2e'],
  architecture_spec: ['architecture_boundary', 'spec_consistency', 'regression_risk'],
  test_plan: ['unit_integration', 'e2e_ux', 'gate_coverage'],
  implementation: ['code_spec_alignment', 'runtime_contract', 'ux_completion'],
  gate: ['gate_evidence', 'pr_split_scope', 'release_risk'],
  preview: ['preview_smoke', 'network_runtime', 'human_usability']
};

export const REVIEW_STAGES = new Set(Object.keys(REVIEW_STAGE_ROLES));
const REVIEW_STATUSES = new Set(['pass', 'needs_changes', 'block']);
const PASSING_ROLE_STATUS = new Set(['pass']);
const REVIEW_PROVENANCE_SYSTEMS = new Set(['codex', 'claude_code', 'human', 'other', 'unknown']);
const AGENT_REVIEW_SYSTEMS = new Set(['codex', 'claude_code']);
const REVIEW_EXECUTION_MODES = new Set(['parallel_subagent', 'manual_review', 'unknown']);

export async function prepareAgentReview(repoRoot, options = {}) {
  const storyId = requireStoryId(options.storyId, 'review prepare');
  const stage = requireStage(options.stage, 'review prepare');
  const root = path.resolve(repoRoot);
  await assertInitializedWorkspace(root, 'review prepare');
  const reviewDir = getReviewStageDir(root, storyId, stage);
  await mkdir(reviewDir, { recursive: true });

  const gitContext = await collectReviewGitContext(root);
  const roles = normalizeRequestedRoles(stage, options.roles);
  const plan = {
    schema_version: '0.1.0',
    story_id: storyId,
    stage,
    roles,
    created_at: new Date().toISOString(),
    git_context: gitContext,
    source_fingerprint: buildSourceFingerprint({ storyId, stage, role: null, gitContext }),
    instructions: [
      'Dispatch the listed role reviews in parallel with separate AI subagents or human reviewers.',
      'VibePro records the review results, but does not execute subagents itself.',
      'When Agent Review Gate requires this stage, this prepare output is the coordinator instruction to launch the parallel reviews.',
      'Each reviewer should return status pass, needs_changes, or block with concrete findings.'
    ],
    parallel_dispatch: {
      required: true,
      mode: 'manual_parallel_subagents',
      subagent_count: roles.length,
      artifact: toWorkspaceRelative(root, getParallelDispatchPath(reviewDir)),
      record_commands: Object.fromEntries(roles.map((role) => [
        role,
        buildReviewRecordCommand({ storyId, stage, role })
      ]))
    },
    requests: roles.map((role) => ({
      role,
      artifact: toWorkspaceRelative(root, getReviewRequestPath(reviewDir, role)),
      prompt_summary: buildRolePromptSummary(stage, role)
    }))
  };

  await writeJson(path.join(reviewDir, 'review-plan.json'), plan);
  await writeFile(getParallelDispatchPath(reviewDir), renderParallelDispatchMarkdown({ storyId, stage, roles, plan }));
  for (const role of roles) {
    await writeFile(getReviewRequestPath(reviewDir, role), renderReviewRequestMarkdown({ storyId, stage, role, plan }));
  }
  const summary = await buildStageSummary(root, storyId, stage, { currentGitContext: gitContext });
  await writeReviewSummaryArtifacts(root, reviewDir, summary);
  return {
    plan,
    summary,
    artifacts: {
      plan: toWorkspaceRelative(root, path.join(reviewDir, 'review-plan.json')),
      parallel_dispatch: toWorkspaceRelative(root, getParallelDispatchPath(reviewDir)),
      summary_json: toWorkspaceRelative(root, path.join(reviewDir, 'review-summary.json')),
      summary_markdown: toWorkspaceRelative(root, path.join(reviewDir, 'review-summary.md')),
      requests: Object.fromEntries(roles.map((role) => [role, toWorkspaceRelative(root, getReviewRequestPath(reviewDir, role))]))
    }
  };
}

export async function recordAgentReview(repoRoot, options = {}) {
  const storyId = requireStoryId(options.storyId, 'review record');
  const stage = requireStage(options.stage, 'review record');
  const role = requireRole(stage, options.role, 'review record');
  const status = options.status;
  if (!REVIEW_STATUSES.has(status)) {
    throw new Error(`review record --status must be one of: ${[...REVIEW_STATUSES].join(', ')}`);
  }
  if (!options.summary && !options.stdinText) {
    throw new Error('review record requires --summary <text> or --from-stdin');
  }

  const root = path.resolve(repoRoot);
  await assertInitializedWorkspace(root, 'review record');
  const reviewDir = getReviewStageDir(root, storyId, stage);
  await mkdir(reviewDir, { recursive: true });
  const gitContext = await collectReviewGitContext(root);
  const sourceFingerprint = buildSourceFingerprint({ storyId, stage, role, gitContext });
  const result = {
    schema_version: '0.1.0',
    story_id: storyId,
    stage,
    role,
    status,
    summary: options.summary ?? options.stdinText.trim(),
    findings: parseFindings(options.findings ?? []),
    artifacts: (options.artifacts ?? []).map((artifact) => normalizeArtifact(root, artifact)),
    recorded_at: new Date().toISOString(),
    git_context: gitContext,
    source_fingerprint: sourceFingerprint,
    agent_provenance: buildAgentProvenance(root, {
      ...options,
      defaultRequestPath: getReviewRequestPath(reviewDir, role)
    })
  };
  const resultPath = getReviewResultPath(reviewDir, role);
  await writeJson(resultPath, result);
  const summary = await buildStageSummary(root, storyId, stage, { currentGitContext: gitContext });
  await writeReviewSummaryArtifacts(root, reviewDir, summary);
  return {
    review: result,
    summary,
    artifact: toWorkspaceRelative(root, resultPath)
  };
}

export async function getAgentReviewStatus(repoRoot, options = {}) {
  const storyId = requireStoryId(options.storyId, 'review status');
  const root = path.resolve(repoRoot);
  await assertInitializedWorkspace(root, 'review status');
  const currentGitContext = await collectReviewGitContext(root);
  const stages = options.stage ? [requireStage(options.stage, 'review status')] : [...REVIEW_STAGES];
  const stageSummaries = [];
  for (const stage of stages) {
    stageSummaries.push(await buildStageSummary(root, storyId, stage, { currentGitContext }));
  }
  return {
    schema_version: '0.1.0',
    story_id: storyId,
    status: resolveOverallStatus(stageSummaries),
    current_git_context: currentGitContext,
    stages: stageSummaries,
    summary: {
      stage_count: stageSummaries.length,
      pass: stageSummaries.filter((stage) => stage.status === 'pass').length,
      needs_review: stageSummaries.filter((stage) => stage.status === 'needs_review').length,
      block: stageSummaries.filter((stage) => stage.status === 'block').length,
      stale: stageSummaries.filter((stage) => stage.stale_count > 0).length
    }
  };
}

export async function summarizeAgentReviewsForPr(repoRoot, options = {}) {
  const storyId = options.storyId;
  if (!storyId) return null;
  const root = path.resolve(repoRoot);
  const currentGitContext = options.git
    ? normalizeGitContext(options.git)
    : await collectReviewGitContext(root);
  const requiredReviews = buildRequiredReviewPolicy(options);
  const stages = [...new Set([
    ...requiredReviews.map((item) => item.stage),
    ...await listExistingReviewStages(root, storyId)
  ])].filter((stage) => REVIEW_STAGES.has(stage));
  const stageSummaries = [];
  for (const stage of stages) {
    stageSummaries.push(await buildStageSummary(root, storyId, stage, { currentGitContext }));
  }
  const roleLookup = new Map();
  for (const stageSummary of stageSummaries) {
    for (const role of stageSummary.roles) {
      roleLookup.set(`${stageSummary.stage}:${role.role}`, role);
    }
  }
  const unmetRequiredReviews = requiredReviews.filter((requirement) => {
    const role = roleLookup.get(`${requirement.stage}:${requirement.role}`);
    return !role || role.effective_status !== 'pass';
  }).map((requirement) => {
    const role = roleLookup.get(`${requirement.stage}:${requirement.role}`);
    return {
      ...requirement,
      status: role?.effective_status ?? 'missing',
      detail: role?.stale ? role.stale_reason : role?.provenance_reason ?? role?.summary ?? null
    };
  });

  const status = requiredReviews.length === 0
    ? 'not_required'
    : unmetRequiredReviews.some((item) => item.status === 'block')
      ? 'block'
      : unmetRequiredReviews.length > 0
        ? 'needs_review'
        : 'pass';
  return {
    schema_version: '0.1.0',
    story_id: storyId,
    status,
    required: requiredReviews.length > 0,
    current_git_context: currentGitContext,
    required_reviews: requiredReviews,
    unmet_required_reviews: unmetRequiredReviews,
    stages: stageSummaries,
    parallel_dispatch: buildParallelDispatchSummary(root, storyId, stageSummaries, requiredReviews),
    summary: {
      required_review_count: requiredReviews.length,
      unmet_required_review_count: unmetRequiredReviews.length,
      stage_count: stageSummaries.length,
      stale_result_count: stageSummaries.reduce((sum, stage) => sum + stage.stale_count, 0),
      block_result_count: stageSummaries.reduce((sum, stage) => sum + stage.block_count, 0)
    }
  };
}

export function renderAgentReviewPrepareSummary(result) {
  return `# Agent Review Prepare

- story: ${result.plan.story_id}
- stage: ${result.plan.stage}
- roles: ${result.plan.roles.join(', ')}
- plan: ${result.artifacts.plan}
- parallel dispatch: ${result.artifacts.parallel_dispatch}
- summary: ${result.artifacts.summary_markdown}
`;
}

export function renderAgentReviewRecordSummary(result) {
  return `# Agent Review Record

- story: ${result.review.story_id}
- stage: ${result.review.stage}
- role: ${result.review.role}
- status: ${result.review.status}
- agent provenance: ${result.review.agent_provenance.system}/${result.review.agent_provenance.execution_mode}/${result.review.agent_provenance.evidence_strength}
- artifact: ${result.artifact}
`;
}

export function renderAgentReviewStatusSummary(status) {
  const rows = status.stages.map((stage) => (
    `- ${stage.stage}: ${stage.status} (${stage.roles.filter((role) => role.effective_status === 'pass').length}/${stage.roles.length} pass, stale=${stage.stale_count})`
  ));
  return `# Agent Review Status

- story: ${status.story_id}
- status: ${status.status}
- stages: ${status.summary.stage_count}

${rows.join('\n') || '- no stages'}
`;
}

export function renderAgentReviewPrSection(agentReviews) {
  if (!agentReviews) return '- Agent Review未生成';
  const unmet = agentReviews.unmet_required_reviews ?? [];
  const stages = agentReviews.stages ?? [];
  const unmetRows = unmet.slice(0, 12).map((item) => (
    `- missing: ${item.stage}:${item.role} (${item.status}) - ${item.reason}${item.detail ? ` / ${item.detail}` : ''}`
  ));
  const stageRows = stages.map((stage) => (
    `- ${stage.stage}: ${stage.status} / stale=${stage.stale_count} / block=${stage.block_count}`
  ));
  return [
    `- status: ${agentReviews.status}`,
    `- required reviews: ${agentReviews.summary?.required_review_count ?? 0}`,
    `- unmet required reviews: ${agentReviews.summary?.unmet_required_review_count ?? 0}`,
    renderParallelDispatchPrRows(agentReviews.parallel_dispatch),
    unmetRows.join('\n') || '- required roles passed or not required',
    '### Stage Summary',
    stageRows.join('\n') || '- no review stages recorded'
  ].join('\n');
}

function buildRequiredReviewPolicy({ fileGroups, networkContracts, performanceEvidence, story }) {
  const requirements = [];
  const addRequirement = (item) => {
    const key = `${item.stage}:${item.role}`;
    if (requirements.some((existing) => `${existing.stage}:${existing.role}` === key)) return;
    requirements.push(item);
  };

  const hasSourceChanges = (fileGroups?.source?.count ?? 0) > 0;
  if (hasSourceChanges) {
    addRequirement({ stage: 'requirement', role: 'scope_risk', reason: 'source changes require scope drift review before PR readiness', policy: 'source_change' });
    addRequirement({ stage: 'architecture_spec', role: 'architecture_boundary', reason: 'source changes require architecture boundary review before PR readiness', policy: 'source_change' });
    addRequirement({ stage: 'test_plan', role: 'unit_integration', reason: 'source changes require unit/integration coverage review before PR readiness', policy: 'source_change' });
    addRequirement({ stage: 'implementation', role: 'code_spec_alignment', reason: 'source changes require code/spec alignment review before PR readiness', policy: 'source_change' });
    addRequirement({ stage: 'gate', role: 'gate_evidence', reason: 'source changes require gate evidence review before PR readiness', policy: 'source_change' });
  }
  if ((fileGroups?.story_docs?.count ?? 0) > 0 || (fileGroups?.specifications?.count ?? 0) > 0) {
    addRequirement({
      stage: 'requirement',
      role: 'product_requirement',
      reason: 'Story/Spec changes require product requirement review',
      policy: 'requirement_change'
    });
    addRequirement({
      stage: 'architecture_spec',
      role: 'spec_consistency',
      reason: 'Story/Spec changes require consistency review',
      policy: 'requirement_change'
    });
  }
  if ((fileGroups?.source?.count ?? 0) > 20 || (fileGroups?.total ?? 0) > 30) {
    addRequirement({
      stage: 'gate',
      role: 'pr_split_scope',
      reason: 'large change sets require PR split/scope review',
      policy: 'large_change'
    });
    addRequirement({
      stage: 'architecture_spec',
      role: 'regression_risk',
      reason: 'large change sets require regression risk review',
      policy: 'large_change'
    });
  }
  if (hasUiExperienceSourceChange(fileGroups)) {
    addRequirement({
      stage: 'requirement',
      role: 'acceptance_e2e',
      reason: 'UI changes require acceptance criteria to be provable by user-level flows',
      policy: 'ui_change'
    });
    addRequirement({
      stage: 'test_plan',
      role: 'e2e_ux',
      reason: 'UI changes require E2E/UX review',
      policy: 'ui_change'
    });
    addRequirement({
      stage: 'implementation',
      role: 'ux_completion',
      reason: 'UI changes require final usability/completion review',
      policy: 'ui_change'
    });
  }
  if (hasNetworkContractRisk(networkContracts)) {
    addRequirement({
      stage: 'implementation',
      role: 'runtime_contract',
      reason: 'API/network contract changes require runtime contract review',
      policy: 'network_contract'
    });
    addRequirement({
      stage: 'gate',
      role: 'gate_evidence',
      reason: 'API/network contract changes require gate evidence review',
      policy: 'network_contract'
    });
  }
  if (isPerformanceStory({ story, performanceEvidence })) {
    addRequirement({
      stage: 'test_plan',
      role: 'gate_coverage',
      reason: 'performance stories require measurable gate coverage review',
      policy: 'performance_story'
    });
    addRequirement({
      stage: 'implementation',
      role: 'runtime_contract',
      reason: 'performance stories require runtime/internal-vs-user readiness review',
      policy: 'performance_story'
    });
  }
  return requirements;
}

function normalizeRequestedRoles(stage, requestedRoles) {
  const allowed = REVIEW_STAGE_ROLES[stage] ?? [];
  const roles = Array.isArray(requestedRoles) && requestedRoles.length > 0 ? requestedRoles : allowed;
  const invalid = roles.filter((role) => !allowed.includes(role));
  if (invalid.length > 0) {
    throw new Error(`review prepare --role is invalid for ${stage}: ${invalid.join(', ')}. Valid roles: ${allowed.join(', ')}`);
  }
  return [...new Set(roles)];
}

function buildRolePromptSummary(stage, role) {
  const labels = {
    product_requirement: 'Confirm the implementation preserves user value and explicit acceptance criteria.',
    scope_risk: 'Look for unrelated scope, hidden coupling, and Story boundary drift.',
    acceptance_e2e: 'Check that acceptance criteria can be proven by user-level flows.',
    architecture_boundary: 'Review boundaries, ownership, dependency direction, and ADR needs.',
    spec_consistency: 'Check Story, Spec, Architecture, and code invariants for contradictions.',
    regression_risk: 'Identify likely regressions around adjacent behavior and migration paths.',
    unit_integration: 'Review unit/integration test coverage and missing assertions.',
    e2e_ux: 'Review UI journeys, transitions, interaction readiness, and visible errors.',
    gate_coverage: 'Check whether gates measure the promised outcome and failure modes.',
    code_spec_alignment: 'Check implementation branches against Spec and acceptance criteria.',
    runtime_contract: 'Review API, DB, auth, environment, and external dependency contracts.',
    ux_completion: 'Review whether the user can understand and complete the intended flow.',
    gate_evidence: 'Check evidence freshness, command reliability, and gate binding.',
    pr_split_scope: 'Review PR size, split plan, and unrelated file risk.',
    release_risk: 'Review rollout, deployment, migration, and operational risks.',
    preview_smoke: 'Check preview smoke coverage and deploy/runtime readiness.',
    network_runtime: 'Review preview network failures, console errors, and server responses.',
    human_usability: 'Review human-touched completion quality and remaining rough edges.'
  };
  return labels[role] ?? `Review ${stage}:${role}.`;
}

function renderReviewRequestMarkdown({ storyId, stage, role, plan }) {
  const recordCommand = buildReviewRecordCommand({ storyId, stage, role });
  return `# VibePro Agent Review Request

- Story: ${storyId}
- Stage: ${stage}
- Role: ${role}
- Current head: ${plan.git_context.head_sha ?? '-'}
- Dirty: ${plan.git_context.dirty}

## Review Focus
${buildRolePromptSummary(stage, role)}

## Instructions
- Review only this role's concern; do not broaden into unrelated cleanup.
- Return concrete findings tied to files, behavior, gates, or missing evidence.
- Use \`block\` for release-blocking bugs, broken contracts, or unverified critical paths.
- Use \`needs_changes\` when the work may proceed after specific fixes/evidence.
- Use \`pass\` only when this role's concern is adequately covered for the current head.
- Return the result to the coordinator. The coordinator records it with:
  \`${recordCommand}\`
- Codex coordinators must include the spawned subagent id/thread/call id when recording the result.
- Claude Code coordinators must include the Task/subagent id or transcript/session artifact when recording the result.

## Result Shape
\`\`\`json
{
  "status": "pass | needs_changes | block",
  "summary": "short conclusion",
  "findings": [
    { "severity": "critical | high | medium | low", "id": "stable-id", "detail": "specific issue" }
  ]
}
\`\`\`
`;
}

function renderParallelDispatchMarkdown({ storyId, stage, roles, plan }) {
  const items = roles.map((role, index) => {
    const request = plan.requests.find((item) => item.role === role)?.artifact ?? `review-request-${role}.md`;
    const command = buildReviewRecordCommand({ storyId, stage, role });
    return `## Subagent ${index + 1}: ${stage}:${role}

Review request:
\`${request}\`

Prompt:
Read the review request above and perform only the \`${stage}:${role}\` review. Return JSON with \`status\`, \`summary\`, and \`findings\`. Do not edit files.

Record command after the subagent returns:
\`${command}\`

Required provenance:
- Codex: keep the spawned subagent id plus thread/call id when available and pass them with \`--agent-system codex --execution-mode parallel_subagent\`.
- Claude Code: keep the Task/subagent id, session id, or transcript artifact and pass them with \`--agent-system claude_code --execution-mode parallel_subagent\`.
`;
  }).join('\n');
  return `# VibePro Parallel Agent Review Dispatch

- Story: ${storyId}
- Stage: ${stage}
- Mode: manual parallel subagents
- Required subagents: ${roles.length}
- Current head: ${plan.git_context.head_sha ?? '-'}
- Dirty: ${plan.git_context.dirty}

## Coordinator Instructions

Agent Review Gate treats this file as required execution guidance. If you are coordinating Codex or Claude Code work, this is an explicit instruction to start the listed parallel review subagents before declaring the work complete.

1. Start all subagents below in parallel.
2. Give each subagent only its own review request.
3. Do not let subagents edit files during review.
4. Record each result with the listed \`vibepro review record\` command.
5. Run \`vibepro review status . --id ${storyId} --stage ${stage}\` and then \`vibepro pr prepare . --story-id ${storyId} --base <base-branch>\`.

${items}
`;
}

function buildReviewRecordCommand({ storyId, stage, role }) {
  return `vibepro review record . --id ${storyId} --stage ${stage} --role ${role} --status <pass|needs_changes|block> --summary "<summary>" --agent-system <codex|claude_code> --execution-mode parallel_subagent --agent-id "<subagent-id>" --agent-model "<model>" --agent-transcript <artifact>`;
}

function buildReviewPrepareCommand({ storyId, stage, roles = [] }) {
  const roleArgs = roles.length > 0 ? ` ${roles.map((role) => `--role ${role}`).join(' ')}` : '';
  return `vibepro review prepare . --id ${storyId} --stage ${stage}${roleArgs}`;
}

function buildParallelDispatchSummary(repoRoot, storyId, stageSummaries, requiredReviews) {
  const requiredStages = [...new Set(requiredReviews.map((item) => item.stage))];
  return {
    required: requiredStages.length > 0,
    mode: 'manual_parallel_subagents',
    required_stages: requiredStages.map((stage) => {
      const reviewDir = getReviewStageDir(repoRoot, storyId, stage);
      const summary = stageSummaries.find((item) => item.stage === stage) ?? null;
      const roles = requiredReviews.filter((item) => item.stage === stage).map((item) => item.role);
      return {
        stage,
        roles,
        role_count: roles.length,
        status: summary?.status ?? 'missing',
        prepared: summary?.parallel_dispatch?.prepared ?? false,
        prepare_command: buildReviewPrepareCommand({ storyId, stage, roles }),
        dispatch_artifact: toWorkspaceRelative(repoRoot, getParallelDispatchPath(reviewDir))
      };
    })
  };
}

function renderParallelDispatchPrRows(parallelDispatch) {
  if (!parallelDispatch?.required) return '- parallel dispatch: not required';
  const rows = parallelDispatch.required_stages.map((stage) => (
    `- parallel dispatch: ${stage.stage} (${stage.status}) - ${stage.prepare_command} -> ${stage.dispatch_artifact}`
  ));
  return rows.join('\n');
}

async function buildStageSummary(repoRoot, storyId, stage, { currentGitContext }) {
  const reviewDir = getReviewStageDir(repoRoot, storyId, stage);
  const parallelDispatchPath = getParallelDispatchPath(reviewDir);
  const parallelDispatchPrepared = await pathExists(parallelDispatchPath);
  const roles = [];
  for (const role of REVIEW_STAGE_ROLES[stage]) {
    const result = await readJsonIfExists(getReviewResultPath(reviewDir, role));
    const binding = result ? bindReviewResult(result, currentGitContext) : null;
    const provenance = result ? validateAgentProvenance(result) : null;
    const effectiveStatus = !result
      ? 'missing'
      : binding.status === 'current'
        ? result.status === 'pass' && provenance.status !== 'verified_agent'
          ? 'unverified_agent'
          : result.status
        : 'stale';
    roles.push({
      role,
      status: result?.status ?? 'missing',
      effective_status: effectiveStatus,
      stale: Boolean(result && binding.status !== 'current'),
      stale_reason: binding?.reason ?? null,
      provenance_status: provenance?.status ?? null,
      provenance_reason: provenance?.reason ?? null,
      agent_provenance: result?.agent_provenance ?? null,
      summary: result?.summary ?? null,
      finding_count: Array.isArray(result?.findings) ? result.findings.length : 0,
      recorded_at: result?.recorded_at ?? null,
      artifact: result ? toWorkspaceRelative(repoRoot, getReviewResultPath(reviewDir, role)) : null
    });
  }
  const status = resolveStageStatus(roles);
  return {
    schema_version: '0.1.0',
    story_id: storyId,
    stage,
    status,
    roles,
    pass_count: roles.filter((role) => role.effective_status === 'pass').length,
    stale_count: roles.filter((role) => role.effective_status === 'stale').length,
    missing_count: roles.filter((role) => role.effective_status === 'missing').length,
    unverified_agent_count: roles.filter((role) => role.effective_status === 'unverified_agent').length,
    block_count: roles.filter((role) => role.effective_status === 'block').length,
    needs_changes_count: roles.filter((role) => role.effective_status === 'needs_changes').length,
    updated_at: new Date().toISOString(),
    current_git_context: currentGitContext,
    parallel_dispatch: {
      mode: 'manual_parallel_subagents',
      prepared: parallelDispatchPrepared,
      artifact: toWorkspaceRelative(repoRoot, parallelDispatchPath),
      prepare_command: buildReviewPrepareCommand({ storyId, stage })
    }
  };
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function resolveStageStatus(roles) {
  if (roles.some((role) => role.effective_status === 'block')) return 'block';
  if (roles.every((role) => PASSING_ROLE_STATUS.has(role.effective_status))) return 'pass';
  return 'needs_review';
}

function resolveOverallStatus(stageSummaries) {
  if (stageSummaries.some((stage) => stage.status === 'block')) return 'block';
  if (stageSummaries.length > 0 && stageSummaries.every((stage) => stage.status === 'pass')) return 'pass';
  return 'needs_review';
}

function bindReviewResult(result, currentGitContext) {
  const recorded = result.git_context ?? {};
  if (!recorded.head_sha) {
    return { status: 'legacy', reason: 'review result is not bound to a git head' };
  }
  if (currentGitContext.head_sha && recorded.head_sha !== currentGitContext.head_sha) {
    return {
      status: 'stale',
      reason: `review was recorded for ${recorded.head_sha.slice(0, 12)}, current head is ${currentGitContext.head_sha.slice(0, 12)}`
    };
  }
  if ((recorded.status_fingerprint ?? '') !== (currentGitContext.status_fingerprint ?? '')) {
    return {
      status: 'stale',
      reason: 'review was recorded with a different dirty worktree fingerprint'
    };
  }
  const expectedFingerprint = buildSourceFingerprint({
    storyId: result.story_id,
    stage: result.stage,
    role: result.role,
    gitContext: currentGitContext
  });
  if (result.source_fingerprint && result.source_fingerprint !== expectedFingerprint) {
    return {
      status: 'stale',
      reason: 'review source fingerprint no longer matches current source artifacts'
    };
  }
  return { status: 'current', reason: 'review is bound to the current git state' };
}

async function writeReviewSummaryArtifacts(repoRoot, reviewDir, summary) {
  await writeJson(path.join(reviewDir, 'review-summary.json'), summary);
  await writeFile(path.join(reviewDir, 'review-summary.md'), renderReviewSummaryMarkdown(summary));
}

function renderReviewSummaryMarkdown(summary) {
  const rows = summary.roles.map((role) => (
    `- ${role.role}: ${role.effective_status}${role.summary ? ` - ${role.summary}` : ''}${role.stale_reason ? ` (${role.stale_reason})` : ''}${role.provenance_reason && role.effective_status === 'unverified_agent' ? ` (${role.provenance_reason})` : ''}`
  ));
  return `# Agent Review Summary

- story: ${summary.story_id}
- stage: ${summary.stage}
- status: ${summary.status}
- pass: ${summary.pass_count}
- stale: ${summary.stale_count}
- missing: ${summary.missing_count}
- unverified_agent: ${summary.unverified_agent_count}
- block: ${summary.block_count}

${rows.join('\n')}
`;
}

function buildAgentProvenance(repoRoot, options = {}) {
  const system = normalizeReviewSystem(options.agentSystem ?? options.reviewerSystem);
  const executionMode = normalizeExecutionMode(options.executionMode);
  const transcriptArtifact = options.agentTranscript
    ? normalizeArtifact(repoRoot, options.agentTranscript)
    : null;
  const requestArtifact = options.agentRequest
    ? normalizeArtifact(repoRoot, options.agentRequest)
    : options.defaultRequestPath
      ? toWorkspaceRelative(repoRoot, options.defaultRequestPath)
      : null;
  const provenance = {
    schema_version: '0.1.0',
    system,
    execution_mode: executionMode,
    agent_id: normalizeNullable(options.agentId),
    agent_role: normalizeNullable(options.agentRole),
    model: normalizeNullable(options.agentModel),
    thread_id: normalizeNullable(options.agentThreadId),
    session_id: normalizeNullable(options.agentSessionId),
    tool_call_id: normalizeNullable(options.agentCallId ?? options.agentToolCallId),
    transcript_artifact: transcriptArtifact,
    request_artifact: requestArtifact,
    recorded_by: normalizeNullable(options.recordedBy),
    evidence_strength: 'missing'
  };
  provenance.evidence_strength = classifyAgentProvenance(provenance);
  return provenance;
}

function normalizeReviewSystem(value) {
  const normalized = String(value ?? 'unknown').trim().toLowerCase().replace(/-/g, '_');
  return REVIEW_PROVENANCE_SYSTEMS.has(normalized) ? normalized : 'other';
}

function normalizeExecutionMode(value) {
  const normalized = String(value ?? 'unknown').trim().toLowerCase().replace(/-/g, '_');
  return REVIEW_EXECUTION_MODES.has(normalized) ? normalized : 'unknown';
}

function normalizeNullable(value) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
}

function classifyAgentProvenance(provenance) {
  if (AGENT_REVIEW_SYSTEMS.has(provenance.system) && provenance.execution_mode === 'parallel_subagent') {
    return hasAgentCorrelationEvidence(provenance) ? 'strong' : 'declared';
  }
  if (provenance.system === 'human' || provenance.execution_mode === 'manual_review') return 'manual';
  return 'missing';
}

function hasAgentCorrelationEvidence(provenance) {
  return Boolean(
    provenance.agent_id
    || provenance.thread_id
    || provenance.session_id
    || provenance.tool_call_id
    || provenance.transcript_artifact
  );
}

function validateAgentProvenance(result) {
  const provenance = result.agent_provenance;
  if (!provenance) {
    return {
      status: 'missing_agent_provenance',
      reason: 'review result does not include Codex/Claude Code subagent provenance'
    };
  }
  if (!AGENT_REVIEW_SYSTEMS.has(provenance.system)) {
    return {
      status: 'non_agent_reviewer',
      reason: `review was recorded by ${provenance.system}, not Codex/Claude Code subagent review`
    };
  }
  if (provenance.execution_mode !== 'parallel_subagent') {
    return {
      status: 'not_parallel_subagent',
      reason: `review execution mode is ${provenance.execution_mode}, not parallel_subagent`
    };
  }
  if (provenance.evidence_strength !== 'strong') {
    return {
      status: 'weak_agent_provenance',
      reason: 'review provenance lacks subagent id, thread/session/call id, or transcript artifact'
    };
  }
  return {
    status: 'verified_agent',
    reason: `${provenance.system} parallel subagent provenance is recorded`
  };
}

function parseFindings(values) {
  return values.map((value) => {
    const [severity, id, ...detailParts] = String(value).split(':');
    return {
      severity: severity || 'medium',
      id: id || 'finding',
      detail: detailParts.join(':') || value
    };
  });
}

function normalizeArtifact(repoRoot, artifact) {
  return toWorkspaceRelative(repoRoot, path.resolve(repoRoot, artifact));
}

function requireStoryId(storyId, commandName) {
  if (!storyId) throw new Error(`${commandName} requires --id <story-id>`);
  return storyId;
}

function requireStage(stage, commandName) {
  if (!stage || !REVIEW_STAGES.has(stage)) {
    throw new Error(`${commandName} --stage must be one of: ${[...REVIEW_STAGES].join(', ')}`);
  }
  return stage;
}

function requireRole(stage, role, commandName) {
  if (!role || !REVIEW_STAGE_ROLES[stage].includes(role)) {
    throw new Error(`${commandName} --role must be one of for ${stage}: ${REVIEW_STAGE_ROLES[stage].join(', ')}`);
  }
  return role;
}

async function assertInitializedWorkspace(repoRoot, commandName) {
  try {
    await readFile(path.join(getWorkspaceDir(repoRoot), 'vibepro-manifest.json'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`${commandName} requires an initialized VibePro workspace. Run \`vibepro init <repo>\` first.`);
    }
    throw error;
  }
}

function getReviewStageDir(repoRoot, storyId, stage) {
  return path.join(getWorkspaceDir(repoRoot), 'reviews', storyId, stage);
}

function getReviewRequestPath(reviewDir, role) {
  return path.join(reviewDir, `review-request-${role}.md`);
}

function getParallelDispatchPath(reviewDir) {
  return path.join(reviewDir, 'parallel-dispatch.md');
}

function getReviewResultPath(reviewDir, role) {
  return path.join(reviewDir, `review-result-${role}.json`);
}

async function listExistingReviewStages(repoRoot, storyId) {
  const dir = path.join(getWorkspaceDir(repoRoot), 'reviews', storyId);
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
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

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function collectReviewGitContext(repoRoot) {
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
    status_fingerprint: fingerprintStatus(statusOutput, dirtyDiff),
    recorded_at: new Date().toISOString()
  };
}

function normalizeGitContext(git) {
  return {
    head_sha: git.head_sha ?? null,
    current_branch: git.current_branch ?? null,
    dirty: git.dirty === true,
    status_fingerprint: git.status_fingerprint ?? '',
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
  return [String(statusOutput ?? ''), String(dirtyDiff ?? '')].join('\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .sort()
    .join('\n');
}

function buildSourceFingerprint({ storyId, stage, role, gitContext }) {
  return crypto.createHash('sha256').update(JSON.stringify({
    story_id: storyId,
    stage,
    role,
    head_sha: gitContext.head_sha ?? null,
    status_fingerprint: gitContext.status_fingerprint ?? ''
  })).digest('hex');
}

function hasNetworkContractRisk(networkContracts) {
  if (!networkContracts) return false;
  return (networkContracts.introduced_api_client_call_count ?? 0) > 0
    || (networkContracts.missing_routes?.length ?? 0) > 0
    || (networkContracts.dynamic_calls?.length ?? 0) > 0
    || (networkContracts.high_risk_replacements?.length ?? 0) > 0;
}

function hasUiExperienceSourceChange(fileGroups) {
  return (fileGroups?.source?.files ?? []).some((file) => {
    if (
      file.startsWith('app/')
      || file.startsWith('pages/')
      || file.startsWith('components/')
      || file.startsWith('public/')
      || file.startsWith('src/app/')
      || file.startsWith('src/pages/')
      || file.startsWith('src/components/')
      || file.startsWith('src/features/')
    ) {
      return true;
    }
    return /\.(css|scss|sass|less|html|vue|svelte|tsx)$/.test(file);
  });
}

function isPerformanceStory({ story, performanceEvidence }) {
  if (performanceEvidence?.metrics?.length > 0 || performanceEvidence?.runs?.length > 0) return true;
  const label = `${story?.story_id ?? ''} ${story?.title ?? ''}`.toLowerCase();
  return /performance|perf|latency|speed|p95|p90|p50|速度|高速|遅延|性能/.test(label);
}
