import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';

import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_REVIEW_STAGE_ROLES = {
  planning_spec: ['product_requirement', 'architecture_boundary', 'spec_consistency'],
  requirement: ['product_requirement', 'scope_risk', 'acceptance_e2e'],
  architecture_spec: ['architecture_boundary', 'spec_consistency', 'regression_risk'],
  test_plan: ['unit_integration', 'e2e_ux', 'gate_coverage'],
  implementation: ['code_spec_alignment', 'runtime_contract', 'ux_completion'],
  gate: ['gate_evidence', 'pr_split_scope', 'release_risk'],
  preview: ['preview_smoke', 'network_runtime', 'human_usability']
};

export const REVIEW_STAGE_ROLES = DEFAULT_REVIEW_STAGE_ROLES;
export const REVIEW_STAGES = new Set(Object.keys(REVIEW_STAGE_ROLES));
const REVIEW_STATUSES = new Set(['pass', 'needs_changes', 'block']);
const PASSING_ROLE_STATUS = new Set(['pass']);
const VERIFIED_REVIEW_PROVENANCE_STATUSES = new Set(['verified_agent']);
const REVIEW_PROVENANCE_SYSTEMS = new Set(['codex', 'claude_code', 'human', 'other', 'unknown']);
const AGENT_REVIEW_SYSTEMS = new Set(['codex', 'claude_code']);
const REVIEW_EXECUTION_MODES = new Set(['parallel_subagent', 'manual_review', 'unknown']);
const DEFAULT_REVIEW_TIMEOUT_MS = 10 * 60 * 1000;
const LIFECYCLE_STATUSES = new Set(['running', 'closed', 'replaced']);
const MANDATORY_REVIEW_LENSES = [
  {
    id: 'regression_guard',
    title: 'Regression / デグレ確認',
    prompt: 'この変更で、今回のStory対象外を含む既存のユーザー導線・API契約・データ状態・運用手順・性能・アクセシビリティ・セキュリティ境界が壊れていないか確認する。',
    pass_condition: '既存挙動への影響範囲が説明され、必要な自動テスト・E2E・手動確認・証跡、または非該当理由がある。',
    block_condition: '既存挙動の破壊、互換性のないAPI/DB/UI変更、主要導線の未検証、または「通った」根拠がStory対象の新規導線だけに偏っている。'
  },
  {
    id: 'path_surface_coverage',
    title: 'Path & Surface Coverage / 経路と出力面の網羅',
    prompt: '変更対象の全入力経路、派生経路、出力面を列挙し、主要経路だけでなくlegacy/fallback/document/config/API/UI/report/gate artifactなどの別経路に同じ契約が効いているか確認する。抑止・除外・候補化する挙動はsilentにせず、ユーザーが判断できるwarning/candidate/finding/evidenceとして残るか確認する。',
    pass_condition: '影響する入力経路と出力面が説明され、各経路に対する実装・証跡・非該当理由がある。テストはpre-fix実装なら失敗する具体的なfixture/assertionを含み、source artifactだけでなくsummary/report/gate/internal synthesisなど利用者が読む面も検証している。',
    block_condition: '主要経路だけを直して別経路が未確認、suppressionがsilent、出力artifact間で矛盾、または追加テストがpre-fixを落とせない形になっている。'
  }
];

export async function prepareAgentReview(repoRoot, options = {}) {
  const storyId = requireStoryId(options.storyId, 'review prepare');
  const stage = requireStage(options.stage, 'review prepare');
  const root = path.resolve(repoRoot);
  await assertInitializedWorkspace(root, 'review prepare');
  const reviewPolicy = await readAgentReviewPolicy(root);
  const roles = getStageRoles(reviewPolicy, stage);
  const reviewDir = getReviewStageDir(root, storyId, stage);
  await mkdir(reviewDir, { recursive: true });

  const gitContext = await collectReviewGitContext(root);
  const plan = {
    schema_version: '0.1.0',
    story_id: storyId,
    stage,
    roles,
    created_at: new Date().toISOString(),
    git_context: gitContext,
    review_policy: summarizeReviewPolicyForStage(reviewPolicy, stage),
    source_fingerprint: buildSourceFingerprint({ storyId, stage, role: null, gitContext }),
    instructions: [
      'Dispatch the listed role reviews with separate Codex/Claude Code subagents when the coordinator runtime provides subagent capability.',
      'VibePro records the review results, but does not execute subagents itself.',
      'When Agent Review Gate requires this stage, this prepare output is the coordinator instruction to obtain the listed reviews; if the runtime cannot spawn subagents, block or record a human waiver decision instead of silently skipping the gate.',
      'Every role review must include all mandatory review lenses; passing a role only means the role concern, regression_guard, and path_surface_coverage are adequately covered.',
      'If the coordinator has subagent capability, dispatch the listed reviewers directly and record parallel_subagent provenance.',
      'After receiving a subagent result, close or shut down that subagent thread/session before recording the review, then record the lifecycle closure with --agent-closed.',
      'Each reviewer should return status pass, needs_changes, or block with concrete findings.'
    ],
    mandatory_review_lenses: MANDATORY_REVIEW_LENSES,
    parallel_dispatch: {
      required: true,
      mode: 'policy_aware_parallel_reviews',
      subagent_count: roles.length,
      artifact: toWorkspaceRelative(root, getParallelDispatchPath(reviewDir)),
      coordinator_behavior: {
        expected: 'dispatch_parallel_subagents',
        user_confirmation_required_by_vibepro: false,
        runner_policy_may_require_user_delegation: false,
        subagent_lifecycle: 'close_before_record',
        closure_required_for_pass: true,
        fallback: 'If the runtime cannot spawn subagents, block or record a human waiver decision; manual_review does not satisfy Agent Review Gate.'
      },
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
  const summary = await buildStageSummary(root, storyId, stage, { currentGitContext: gitContext, reviewPolicy });
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
  const root = path.resolve(repoRoot);
  await assertInitializedWorkspace(root, 'review record');
  const reviewPolicy = await readAgentReviewPolicy(root);
  const role = requireRole(reviewPolicy, stage, options.role, 'review record');
  const status = options.status;
  if (!REVIEW_STATUSES.has(status)) {
    throw new Error(`review record --status must be one of: ${[...REVIEW_STATUSES].join(', ')}`);
  }
  if (!options.summary && !options.stdinText) {
    throw new Error('review record requires --summary <text> or --from-stdin');
  }

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
  if (result.agent_provenance.lifecycle?.agent_closed) {
    await closeMatchingLifecycleEntry(root, {
      storyId,
      stage,
      role,
      agentSystem: result.agent_provenance.system,
      agentId: result.agent_provenance.agent_id,
      closeReason: 'completed',
      closeEvidence: result.agent_provenance.lifecycle.close_evidence ?? toWorkspaceRelative(root, resultPath),
      resultArtifact: toWorkspaceRelative(root, resultPath)
    });
  }
  const summary = await buildStageSummary(root, storyId, stage, { currentGitContext: gitContext, reviewPolicy });
  await writeReviewSummaryArtifacts(root, reviewDir, summary);
  return {
    review: result,
    summary,
    artifact: toWorkspaceRelative(root, resultPath)
  };
}

export async function startAgentReviewLifecycle(repoRoot, options = {}) {
  const storyId = requireStoryId(options.storyId, 'review start');
  const stage = requireStage(options.stage, 'review start');
  const root = path.resolve(repoRoot);
  await assertInitializedWorkspace(root, 'review start');
  const reviewPolicy = await readAgentReviewPolicy(root);
  const role = requireRole(reviewPolicy, stage, options.role, 'review start');
  const rolePolicy = getRolePolicy(reviewPolicy, role);
  const reviewDir = getReviewStageDir(root, storyId, stage);
  await mkdir(reviewDir, { recursive: true });
  const lifecycle = await readLifecycle(root, storyId, stage);
  const now = new Date().toISOString();
  const entry = {
    schema_version: '0.1.0',
    lifecycle_id: options.lifecycleId ?? crypto.randomUUID(),
    story_id: storyId,
    stage,
    role,
    status: 'running',
    agent_system: normalizeReviewSystem(options.agentSystem ?? options.reviewerSystem),
    agent_id: normalizeNullable(options.agentId),
    agent_model: normalizeNullable(options.agentModel),
    thread_id: normalizeNullable(options.agentThreadId),
    session_id: normalizeNullable(options.agentSessionId),
    tool_call_id: normalizeNullable(options.agentCallId ?? options.agentToolCallId),
    started_at: now,
    timeout_ms: normalizeTimeoutMs(options.timeoutMs ?? rolePolicy.timeout_ms ?? reviewPolicy.defaults.timeout_ms),
    replacement_for: normalizeNullable(options.replacementFor),
    close_reason: null,
    close_evidence: null,
    closed_at: null,
    result_artifact: null
  };
  lifecycle.entries.push(entry);
  await writeLifecycle(root, storyId, stage, lifecycle);
  const summary = await buildStageSummary(root, storyId, stage, { currentGitContext: await collectReviewGitContext(root), reviewPolicy });
  await writeReviewSummaryArtifacts(root, reviewDir, summary);
  return {
    lifecycle: entry,
    summary,
    artifact: toWorkspaceRelative(root, getLifecyclePath(reviewDir))
  };
}

export async function closeAgentReviewLifecycle(repoRoot, options = {}) {
  const storyId = requireStoryId(options.storyId, 'review close');
  const stage = requireStage(options.stage, 'review close');
  const root = path.resolve(repoRoot);
  await assertInitializedWorkspace(root, 'review close');
  const reviewPolicy = await readAgentReviewPolicy(root);
  const role = requireRole(reviewPolicy, stage, options.role, 'review close');
  const reviewDir = getReviewStageDir(root, storyId, stage);
  const lifecycle = await readLifecycle(root, storyId, stage);
  const match = findLifecycleEntry(lifecycle.entries, {
    lifecycleId: options.lifecycleId,
    role,
    agentId: options.agentId,
    agentSystem: options.agentSystem
  });
  if (!match) {
    throw new Error('review close could not find a matching lifecycle entry; pass --lifecycle-id or matching --role/--agent-id');
  }
  const closeReason = normalizeCloseReason(options.closeReason);
  match.status = closeReason === 'replaced' ? 'replaced' : 'closed';
  match.closed_at = new Date().toISOString();
  match.close_reason = closeReason;
  match.close_evidence = normalizeNullable(options.closeEvidence);
  await writeLifecycle(root, storyId, stage, lifecycle);
  const summary = await buildStageSummary(root, storyId, stage, { currentGitContext: await collectReviewGitContext(root), reviewPolicy });
  await writeReviewSummaryArtifacts(root, reviewDir, summary);
  return {
    lifecycle: decorateLifecycleEntry(match),
    summary,
    artifact: toWorkspaceRelative(root, getLifecyclePath(reviewDir))
  };
}

export async function getAgentReviewStatus(repoRoot, options = {}) {
  const storyId = requireStoryId(options.storyId, 'review status');
  const root = path.resolve(repoRoot);
  await assertInitializedWorkspace(root, 'review status');
  const reviewPolicy = await readAgentReviewPolicy(root);
  const currentGitContext = await collectReviewGitContext(root);
  const stages = options.stage ? [requireStage(options.stage, 'review status')] : getConfiguredStages(reviewPolicy);
  const stageSummaries = [];
  for (const stage of stages) {
    stageSummaries.push(await buildStageSummary(root, storyId, stage, { currentGitContext, reviewPolicy }));
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
  const reviewPolicy = await readAgentReviewPolicy(root);
  const requiredReviews = buildRequiredReviewPolicy({ ...options, reviewPolicy });
  const stages = [...new Set([
    ...requiredReviews.map((item) => item.stage),
    ...await listExistingReviewStages(root, storyId)
  ])].filter((stage) => REVIEW_STAGES.has(stage));
  const stageSummaries = [];
  for (const stage of stages) {
    stageSummaries.push(await buildStageSummary(root, storyId, stage, { currentGitContext, reviewPolicy }));
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
  const lifecycleRequiredReviews = requiredReviews.flatMap((requirement) => {
    const role = roleLookup.get(`${requirement.stage}:${requirement.role}`);
    const lifecycle = role?.lifecycle;
    const latest = lifecycle?.latest;
    if (!lifecycle || !['running', 'timed_out'].includes(lifecycle.effective_status)) return [];
    return [{
      ...requirement,
      status: lifecycle.effective_status,
      detail: lifecycle.effective_status === 'timed_out'
        ? `subagent ${latest?.agent_id ?? latest?.lifecycle_id ?? 'unknown'} timed out; close and replace it before PR readiness`
        : `subagent ${latest?.agent_id ?? latest?.lifecycle_id ?? 'unknown'} is still running; close it before PR readiness`
    }];
  });
  const allUnmetRequiredReviews = [
    ...unmetRequiredReviews,
    ...lifecycleRequiredReviews
  ];

  const status = requiredReviews.length === 0
    ? 'not_required'
    : allUnmetRequiredReviews.some((item) => item.status === 'block')
      ? 'block'
      : allUnmetRequiredReviews.length > 0
        ? 'needs_review'
        : 'pass';
  return {
    schema_version: '0.1.0',
    story_id: storyId,
    status,
    required: requiredReviews.length > 0,
    current_git_context: currentGitContext,
    required_reviews: requiredReviews,
    unmet_required_reviews: allUnmetRequiredReviews,
    stages: stageSummaries,
    parallel_dispatch: buildParallelDispatchSummary(root, storyId, stageSummaries, requiredReviews),
    summary: {
      required_review_count: requiredReviews.length,
      unmet_required_review_count: allUnmetRequiredReviews.length,
      stage_count: stageSummaries.length,
      stale_result_count: stageSummaries.reduce((sum, stage) => sum + stage.stale_count, 0),
      block_result_count: stageSummaries.reduce((sum, stage) => sum + stage.block_count, 0),
      lifecycle_running_count: stageSummaries.reduce((sum, stage) => sum + (stage.lifecycle?.running_count ?? 0), 0),
      lifecycle_timed_out_count: stageSummaries.reduce((sum, stage) => sum + (stage.lifecycle?.timed_out_count ?? 0), 0)
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

export function renderAgentReviewLifecycleStartSummary(result) {
  return `# Agent Review Lifecycle Start

- story: ${result.lifecycle.story_id}
- stage: ${result.lifecycle.stage}
- role: ${result.lifecycle.role}
- status: ${result.lifecycle.status}
- agent: ${result.lifecycle.agent_system}/${result.lifecycle.agent_id ?? '-'}
- timeout_ms: ${result.lifecycle.timeout_ms}
- artifact: ${result.artifact}
`;
}

export function renderAgentReviewLifecycleCloseSummary(result) {
  return `# Agent Review Lifecycle Close

- story: ${result.lifecycle.story_id}
- stage: ${result.lifecycle.stage}
- role: ${result.lifecycle.role}
- status: ${result.lifecycle.effective_status ?? result.lifecycle.status}
- agent: ${result.lifecycle.agent_system}/${result.lifecycle.agent_id ?? '-'}
- close_reason: ${result.lifecycle.close_reason ?? '-'}
- artifact: ${result.artifact}
`;
}

export function renderAgentReviewStatusSummary(status) {
  const rows = status.stages.map((stage) => (
    `- ${stage.stage}: ${stage.status} (${stage.roles.filter((role) => role.effective_status === 'pass').length}/${stage.roles.length} pass, stale=${stage.stale_count}, running=${stage.lifecycle?.running_count ?? 0}, timed_out=${stage.lifecycle?.timed_out_count ?? 0})`
  ));
  const nextActions = status.stages.flatMap((stage) => stage.next_actions ?? []);
  const nextRows = nextActions.length ? nextActions.map((action) => `- ${action}`).join('\n') : '- none';
  return `# Agent Review Status

- story: ${status.story_id}
- status: ${status.status}
- stages: ${status.summary.stage_count}

${rows.join('\n') || '- no stages'}

## Lifecycle Next Actions

${nextRows}
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

async function readAgentReviewPolicy(repoRoot) {
  const config = await readJsonIfExists(path.join(getWorkspaceDir(repoRoot), 'config.json'));
  return normalizeAgentReviewPolicy(config?.agent_reviews);
}

function normalizeAgentReviewPolicy(raw = {}) {
  const stages = {};
  const rawStages = isPlainObject(raw?.stages) ? raw.stages : {};
  for (const stage of Object.keys(DEFAULT_REVIEW_STAGE_ROLES)) {
    const configured = rawStages[stage];
    stages[stage] = {
      roles: normalizeStageRoles(configured, DEFAULT_REVIEW_STAGE_ROLES[stage])
    };
  }
  const roles = {};
  const rawRoles = isPlainObject(raw?.roles) ? raw.roles : {};
  for (const [role, policy] of Object.entries(rawRoles)) {
    roles[role] = isPlainObject(policy) ? {
      mode: normalizeRoleMode(policy.mode),
      timeout_ms: policy.timeout_ms,
      when_changed: normalizeStringList(policy.when_changed),
      allowed_systems: normalizeStringList(policy.allowed_systems)
    } : { mode: normalizeRoleMode(policy) };
  }
  return {
    defaults: {
      timeout_ms: raw?.defaults?.timeout_ms
    },
    stages,
    roles
  };
}

function normalizeStageRoles(configured, defaults) {
  if (!configured) return [...defaults];
  const rawRoles = Array.isArray(configured) ? configured : configured.roles;
  if (!Array.isArray(rawRoles)) return [...defaults];
  return rawRoles.flatMap((item) => {
    if (typeof item === 'string') return item.trim() ? [item.trim()] : [];
    if (!isPlainObject(item) || !item.role) return [];
    return normalizeRoleMode(item.mode) === 'disabled' ? [] : [String(item.role).trim()];
  }).filter(Boolean);
}

function summarizeReviewPolicyForStage(policy, stage) {
  return {
    stage,
    roles: getStageRoles(policy, stage),
    defaults: {
      timeout_ms: normalizeTimeoutMs(policy?.defaults?.timeout_ms)
    },
    role_policies: Object.fromEntries(getStageRoles(policy, stage).map((role) => [role, getRolePolicy(policy, role)]))
  };
}

function getConfiguredStages(policy) {
  return Object.keys(DEFAULT_REVIEW_STAGE_ROLES).filter((stage) => getStageRoles(policy, stage).length > 0);
}

function getStageRoles(policy, stage) {
  const roles = policy?.stages?.[stage]?.roles ?? DEFAULT_REVIEW_STAGE_ROLES[stage] ?? [];
  return roles.filter((role, index) => roles.indexOf(role) === index && getRolePolicy(policy, role).mode !== 'disabled');
}

function getRolePolicy(policy, role) {
  return {
    mode: 'required',
    ...(policy?.roles?.[role] ?? {})
  };
}

function isRequiredRoleActive(policy, role, fileGroups) {
  const rolePolicy = getRolePolicy(policy, role);
  if (rolePolicy.mode === 'disabled' || rolePolicy.mode === 'optional') return false;
  if (!rolePolicy.when_changed || rolePolicy.when_changed.length === 0) return true;
  const changedFiles = collectChangedFiles(fileGroups);
  return changedFiles.some((filePath) => rolePolicy.when_changed.some((pattern) => matchPathPattern(filePath, pattern)));
}

function collectChangedFiles(fileGroups) {
  const groups = Object.values(fileGroups ?? {});
  return groups.flatMap((group) => Array.isArray(group?.files) ? group.files : []);
}

function matchPathPattern(filePath, pattern) {
  const normalizedFile = String(filePath).replace(/\\/g, '/');
  const normalizedPattern = String(pattern).replace(/\\/g, '/');
  const escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__VIBEPRO_GLOBSTAR__')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped.replace(/__VIBEPRO_GLOBSTAR__/g, '.*')}$`).test(normalizedFile);
}

function normalizeRoleMode(value) {
  const normalized = String(value ?? 'required').trim().toLowerCase().replace(/-/g, '_');
  return ['required', 'optional', 'disabled'].includes(normalized) ? normalized : 'required';
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function buildRequiredReviewPolicy({ fileGroups, networkContracts, performanceEvidence, story, reviewPolicy }) {
  const requirements = [];
  const addStage = (stage, reason, policy) => {
    for (const role of getStageRoles(reviewPolicy, stage)) {
      addRequirement({ stage, role, reason, policy });
    }
  };
  const addRequirement = (item) => {
    if (!isRequiredRoleActive(reviewPolicy, item.role, fileGroups)) return;
    const key = `${item.stage}:${item.role}`;
    if (requirements.some((existing) => `${existing.stage}:${existing.role}` === key)) return;
    requirements.push(item);
  };

  const hasSourceChanges = (fileGroups?.source?.count ?? 0) > 0;
  if (hasSourceChanges) {
    addStage('gate', 'source changes require final gate/release review before PR readiness', 'source_change_pr_final');
  }
  if (hasUiExperienceSourceChange(fileGroups)) {
    addStage('preview', 'UI changes require preview/runtime/human-usability review before PR readiness', 'ui_preview');
  }
  if (hasNetworkContractRisk(networkContracts)) {
    addRequirement({
      stage: 'preview',
      role: 'network_runtime',
      reason: 'API/network contract changes require preview/runtime network review before PR readiness',
      policy: 'network_contract_pr_final'
    });
  }
  if (isPerformanceStory({ story, performanceEvidence })) {
    addRequirement({
      stage: 'gate',
      role: 'gate_evidence',
      reason: 'performance stories require measurable gate coverage review before PR readiness',
      policy: 'performance_story_pr_final'
    });
  }
  return requirements;
}

function buildRolePromptSummary(stage, role) {
  const labels = {
    product_requirement: 'Confirm the implementation preserves user value and explicit acceptance criteria.',
    scope_risk: 'Look for unrelated scope, hidden coupling, and Story boundary drift.',
    acceptance_e2e: 'Check that acceptance criteria can be proven by user-level flows.',
    architecture_boundary: 'Review boundaries, ownership, dependency direction, and ADR needs.',
    spec_consistency: 'Check Story, Spec, Architecture, and code invariants for contradictions.',
    regression_risk: 'Identify likely regressions around adjacent behavior, compatibility, and migration paths; do not limit the review to the new happy path.',
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
  const rolePolicy = plan.review_policy?.role_policies?.[role] ?? {};
  const startCommand = buildReviewStartCommand({ storyId, stage, role, timeoutMs: rolePolicy.timeout_ms ?? plan.review_policy?.defaults?.timeout_ms });
  const closeCommand = buildReviewCloseCommand({ storyId, stage, role });
  const mandatoryLenses = renderMandatoryReviewLenses(plan.mandatory_review_lenses ?? MANDATORY_REVIEW_LENSES);
  return `# VibePro Agent Review Request

- Story: ${storyId}
- Stage: ${stage}
- Role: ${role}
- Current head: ${plan.git_context.head_sha ?? '-'}
- Dirty: ${plan.git_context.dirty}

## Review Focus
${buildRolePromptSummary(stage, role)}

## Mandatory Review Lenses
${mandatoryLenses}

## Instructions
- Review only this role's concern; do not broaden into unrelated cleanup.
- A \`pass\` must cover both the role focus and every mandatory review lens above.
- If regression coverage is missing, only proves the new happy path, omits affected input/output paths, hides suppression silently, or relies on a test that would pass before the fix, return \`needs_changes\` or \`block\` with a concrete finding.
- Return concrete findings tied to files, behavior, gates, or missing evidence.
- Use \`block\` for release-blocking bugs, broken contracts, or unverified critical paths.
- Use \`needs_changes\` when the work may proceed after specific fixes/evidence.
- Use \`pass\` only when this role's concern is adequately covered for the current head.
- Return the result to the coordinator. The coordinator records it with:
  \`${recordCommand}\`
- Codex coordinators must include the spawned subagent id/thread/call id when recording the result.
- Claude Code coordinators must include the Task/subagent id or transcript/session artifact when recording the result.
- Before or immediately after dispatch, the coordinator should record lifecycle start:
  \`${startCommand}\`
- If the subagent does not return by the timeout, close/shutdown it and start a replacement; do not wait indefinitely.
- After receiving the result, the coordinator must close/shutdown the subagent thread or session before recording the review. Required Agent Review Gate pass requires \`--agent-closed\` evidence.
- To record closure without a result yet:
  \`${closeCommand}\`

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
  const mandatoryLenses = renderMandatoryReviewLenses(plan.mandatory_review_lenses ?? MANDATORY_REVIEW_LENSES);
  const items = roles.map((role, index) => {
    const request = plan.requests.find((item) => item.role === role)?.artifact ?? `review-request-${role}.md`;
    const command = buildReviewRecordCommand({ storyId, stage, role });
    const rolePolicy = plan.review_policy?.role_policies?.[role] ?? {};
    return `## Subagent ${index + 1}: ${stage}:${role}

Review request:
\`${request}\`

Prompt:
Read the review request above and perform only the \`${stage}:${role}\` review, including every mandatory review lens. Return JSON with \`status\`, \`summary\`, and \`findings\`. Do not edit files.

Record command after the subagent returns:
\`${command}\`

Lifecycle start command:
\`${buildReviewStartCommand({ storyId, stage, role, timeoutMs: rolePolicy.timeout_ms ?? plan.review_policy?.defaults?.timeout_ms })}\`

Lifecycle close command for timeout/replacement/manual shutdown:
\`${buildReviewCloseCommand({ storyId, stage, role })}\`

Required provenance:
- Codex: keep the spawned subagent id plus thread/call id when available and pass them with \`--agent-system codex --execution-mode parallel_subagent\`.
- Claude Code: keep the Task/subagent id, session id, or transcript artifact and pass them with \`--agent-system claude_code --execution-mode parallel_subagent\`.
- Lifecycle: after receiving the result, close/shutdown the subagent thread/session before running the record command. Required Agent Review Gate pass requires \`--agent-closed\`; if a runtime cannot close agents, return \`needs_changes\` or record a waiver outside the required Agent Review Gate.
- Human waiver: if subagents are unavailable, report the blocker or record a human waiver decision outside Agent Review Gate. Do not record manual_review as a passing substitute for required subagent review.
`;
  }).join('\n');
  return `# VibePro Parallel Agent Review Dispatch

- Story: ${storyId}
- Stage: ${stage}
- Mode: policy-aware parallel review dispatch
- Required subagents: ${roles.length}
- Current head: ${plan.git_context.head_sha ?? '-'}
- Dirty: ${plan.git_context.dirty}

## Coordinator Instructions

Agent Review Gate treats this file as required execution guidance. VibePro requires the listed reviews before completion, but it does not execute the subagents itself.

If your coordinator runtime supports subagents, start them as part of this gate workflow. If subagents are unavailable, block or record a human waiver decision; do not silently skip the gate and do not treat manual_review as satisfying required subagent review.

1. Start all subagents below in parallel when the runtime provides subagent capability.
2. Record \`vibepro review start\` for each subagent with its agent id and timeout.
3. Give each subagent only its own review request.
4. Do not let subagents edit files during review.
5. If a subagent times out, close/shutdown it, record \`vibepro review close --close-reason timeout\`, then Start replacement with \`vibepro review start --replacement-for <lifecycle-id>\`.
6. After each subagent returns its result, close/shutdown that subagent thread/session. Do not leave review subagents running.
7. Record each result with the listed \`vibepro review record\` command and include \`--agent-closed\`.
8. Run \`vibepro review status . --id ${storyId} --stage ${stage}\` and then \`vibepro pr prepare . --story-id ${storyId} --base <base-branch>\`.

## Mandatory Review Lenses
${mandatoryLenses}

${items}
`;
}

function renderMandatoryReviewLenses(lenses) {
  return lenses.map((lens) => [
    `### ${lens.id}: ${lens.title}`,
    lens.prompt,
    '',
    `- Pass condition: ${lens.pass_condition}`,
    `- Block condition: ${lens.block_condition}`
  ].join('\n')).join('\n\n');
}

function buildReviewRecordCommand({ storyId, stage, role }) {
  return `vibepro review record . --id ${storyId} --stage ${stage} --role ${role} --status <pass|needs_changes|block> --summary "<summary>" --agent-system <codex|claude_code> --execution-mode parallel_subagent --agent-id "<subagent-id>" --agent-model "<model>" --agent-transcript <artifact> --agent-closed`;
}

function buildReviewStartCommand({ storyId, stage, role, timeoutMs }) {
  return `vibepro review start . --id ${storyId} --stage ${stage} --role ${role} --agent-system <codex|claude_code> --agent-id "<subagent-id>" --timeout-ms ${normalizeTimeoutMs(timeoutMs)}`;
}

function buildReviewCloseCommand({ storyId, stage, role }) {
  return `vibepro review close . --id ${storyId} --stage ${stage} --role ${role} --agent-id "<subagent-id>" --close-reason <completed|timeout|replaced|manual_shutdown>`;
}

function buildReviewPrepareCommand({ storyId, stage }) {
  return `vibepro review prepare . --id ${storyId} --stage ${stage}`;
}

function buildParallelDispatchSummary(repoRoot, storyId, stageSummaries, requiredReviews) {
  const requiredStages = [...new Set(requiredReviews.map((item) => item.stage))];
  return {
    required: requiredStages.length > 0,
    mode: 'policy_aware_parallel_reviews',
    required_stages: requiredStages.map((stage) => {
      const reviewDir = getReviewStageDir(repoRoot, storyId, stage);
      const summary = stageSummaries.find((item) => item.stage === stage) ?? null;
      return {
        stage,
        role_count: summary?.roles?.length ?? 0,
        status: summary?.status ?? 'missing',
        prepared: summary?.parallel_dispatch?.prepared ?? false,
        prepare_command: buildReviewPrepareCommand({ storyId, stage }),
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

async function buildStageSummary(repoRoot, storyId, stage, { currentGitContext, reviewPolicy }) {
  const reviewDir = getReviewStageDir(repoRoot, storyId, stage);
  const parallelDispatchPath = getParallelDispatchPath(reviewDir);
  const parallelDispatchPrepared = await pathExists(parallelDispatchPath);
  const roles = [];
  const stageRoles = getStageRoles(reviewPolicy, stage);
  const lifecycle = await readLifecycle(repoRoot, storyId, stage);
  const lifecycleEntries = lifecycle.entries.map(decorateLifecycleEntry);
  for (const role of stageRoles) {
    const result = await readJsonIfExists(getReviewResultPath(reviewDir, role));
    const binding = result ? bindReviewResult(result, currentGitContext) : null;
    const provenance = result ? validateAgentProvenance(result) : null;
    const effectiveStatus = !result
      ? 'missing'
      : binding.status === 'current'
        ? result.status === 'pass' && !VERIFIED_REVIEW_PROVENANCE_STATUSES.has(provenance.status)
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
      lifecycle: summarizeRoleLifecycle(lifecycleEntries, role),
      artifact: result ? toWorkspaceRelative(repoRoot, getReviewResultPath(reviewDir, role)) : null
    });
  }
  const status = resolveStageStatus(roles);
  const lifecycleSummary = summarizeLifecycle(lifecycleEntries);
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
    lifecycle: lifecycleSummary,
    next_actions: buildLifecycleNextActions({ storyId, stage, lifecycleSummary }),
    updated_at: new Date().toISOString(),
    current_git_context: currentGitContext,
    parallel_dispatch: {
      mode: 'policy_aware_parallel_reviews',
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
    `- ${role.role}: ${role.effective_status}${role.summary ? ` - ${role.summary}` : ''}${role.stale_reason ? ` (${role.stale_reason})` : ''}${role.provenance_reason && role.effective_status === 'unverified_agent' ? ` (${role.provenance_reason})` : ''}${role.lifecycle?.effective_status ? ` / lifecycle=${role.lifecycle.effective_status}` : ''}`
  ));
  const lifecycle = summary.lifecycle ?? {};
  const nextActions = summary.next_actions?.length
    ? summary.next_actions.map((action) => `- ${action}`).join('\n')
    : '- none';
  return `# Agent Review Summary

- story: ${summary.story_id}
- stage: ${summary.stage}
- status: ${summary.status}
- pass: ${summary.pass_count}
- stale: ${summary.stale_count}
- missing: ${summary.missing_count}
- unverified_agent: ${summary.unverified_agent_count}
- block: ${summary.block_count}
- lifecycle_running: ${lifecycle.running_count ?? 0}
- lifecycle_timed_out: ${lifecycle.timed_out_count ?? 0}
- lifecycle_closed: ${lifecycle.closed_count ?? 0}
- lifecycle_replaced: ${lifecycle.replaced_count ?? 0}

## Next Actions

${nextActions}

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
    lifecycle: {
      agent_closed: Boolean(options.agentClosed),
      close_evidence: normalizeNullable(options.agentCloseEvidence),
      close_note: normalizeNullable(options.agentCloseNote)
    },
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
  if (provenance.execution_mode === 'manual_review') {
    if (provenance.system === 'unknown' || !provenance.recorded_by) {
      return {
        status: 'missing_manual_reviewer',
        reason: 'manual review requires --agent-system human|codex|claude_code|other and --recorded-by reviewer provenance'
      };
    }
    return {
      status: 'verified_manual',
      reason: `${provenance.system} manual review provenance is recorded`
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
  if (!provenance.lifecycle?.agent_closed) {
    return {
      status: 'agent_not_closed',
      reason: 'parallel subagent review was recorded without --agent-closed lifecycle evidence'
    };
  }
  return {
    status: 'verified_agent',
    reason: `${provenance.system} parallel subagent provenance is recorded and the subagent lifecycle is closed`
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

function requireRole(reviewPolicy, stage, role, commandName) {
  const roles = getStageRoles(reviewPolicy, stage);
  if (!role || !roles.includes(role)) {
    throw new Error(`${commandName} --role must be one of for ${stage}: ${roles.join(', ')}`);
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

function getLifecyclePath(reviewDir) {
  return path.join(reviewDir, 'lifecycle.json');
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
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function readLifecycle(repoRoot, storyId, stage) {
  const reviewDir = getReviewStageDir(repoRoot, storyId, stage);
  const existing = await readJsonIfExists(getLifecyclePath(reviewDir));
  if (existing?.entries && Array.isArray(existing.entries)) return existing;
  return {
    schema_version: '0.1.0',
    story_id: storyId,
    stage,
    entries: []
  };
}

async function writeLifecycle(repoRoot, storyId, stage, lifecycle) {
  const reviewDir = getReviewStageDir(repoRoot, storyId, stage);
  await writeJson(getLifecyclePath(reviewDir), {
    schema_version: '0.1.0',
    story_id: storyId,
    stage,
    updated_at: new Date().toISOString(),
    entries: lifecycle.entries ?? []
  });
}

async function closeMatchingLifecycleEntry(repoRoot, options = {}) {
  if (!options.agentId) return null;
  const lifecycle = await readLifecycle(repoRoot, options.storyId, options.stage);
  const entry = findLifecycleEntry(lifecycle.entries, {
    role: options.role,
    agentId: options.agentId,
    agentSystem: options.agentSystem
  });
  if (!entry || entry.closed_at) return null;
  entry.status = 'closed';
  entry.closed_at = new Date().toISOString();
  entry.close_reason = options.closeReason ?? 'completed';
  entry.close_evidence = options.closeEvidence ?? null;
  entry.result_artifact = options.resultArtifact ?? null;
  await writeLifecycle(repoRoot, options.storyId, options.stage, lifecycle);
  return entry;
}

function findLifecycleEntry(entries, options = {}) {
  const candidates = entries.filter((entry) => {
    if (options.lifecycleId && entry.lifecycle_id !== options.lifecycleId) return false;
    if (options.role && entry.role !== options.role) return false;
    if (options.agentId && entry.agent_id !== options.agentId) return false;
    if (options.agentSystem && entry.agent_system !== normalizeReviewSystem(options.agentSystem)) return false;
    return true;
  });
  return candidates.at(-1) ?? null;
}

function decorateLifecycleEntry(entry) {
  const effectiveStatus = resolveLifecycleEffectiveStatus(entry);
  return {
    ...entry,
    effective_status: effectiveStatus,
    timed_out: effectiveStatus === 'timed_out',
    elapsed_ms: calculateElapsedMs(entry)
  };
}

function resolveLifecycleEffectiveStatus(entry) {
  if (entry.status === 'closed' || entry.status === 'replaced') return entry.status;
  if (entry.status !== 'running') return entry.status;
  const elapsedMs = calculateElapsedMs(entry);
  if (Number.isFinite(elapsedMs) && elapsedMs > normalizeTimeoutMs(entry.timeout_ms)) return 'timed_out';
  return 'running';
}

function calculateElapsedMs(entry) {
  const started = Date.parse(entry.started_at);
  if (!Number.isFinite(started)) return null;
  const end = entry.closed_at ? Date.parse(entry.closed_at) : Date.now();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, end - started);
}

function summarizeRoleLifecycle(entries, role) {
  const roleEntries = entries.filter((entry) => entry.role === role);
  if (roleEntries.length === 0) return {
    effective_status: 'not_started',
    running_count: 0,
    timed_out_count: 0,
    closed_count: 0,
    replaced_count: 0,
    latest: null
  };
  const latest = roleEntries.at(-1);
  return {
    effective_status: latest.effective_status,
    running_count: roleEntries.filter((entry) => entry.effective_status === 'running').length,
    timed_out_count: roleEntries.filter((entry) => entry.effective_status === 'timed_out').length,
    closed_count: roleEntries.filter((entry) => entry.effective_status === 'closed').length,
    replaced_count: roleEntries.filter((entry) => entry.effective_status === 'replaced').length,
    latest
  };
}

function summarizeLifecycle(entries) {
  return {
    entry_count: entries.length,
    running_count: entries.filter((entry) => entry.effective_status === 'running').length,
    timed_out_count: entries.filter((entry) => entry.effective_status === 'timed_out').length,
    closed_count: entries.filter((entry) => entry.effective_status === 'closed').length,
    replaced_count: entries.filter((entry) => entry.effective_status === 'replaced').length,
    entries
  };
}

function buildLifecycleNextActions({ storyId, stage, lifecycleSummary }) {
  const actions = [];
  for (const entry of lifecycleSummary.entries ?? []) {
    if (entry.effective_status !== 'timed_out') continue;
    const closeSelector = entry.agent_id
      ? `--agent-id "${entry.agent_id}"`
      : `--lifecycle-id ${entry.lifecycle_id}`;
    actions.push(`Close timed-out ${stage}:${entry.role} subagent ${entry.agent_id ?? entry.lifecycle_id}: vibepro review close . --id ${storyId} --stage ${stage} --role ${entry.role} ${closeSelector} --close-reason timeout`);
    actions.push(`Start replacement for ${stage}:${entry.role}: vibepro review start . --id ${storyId} --stage ${stage} --role ${entry.role} --agent-system ${entry.agent_system} --agent-id "<replacement-subagent-id>" --replacement-for ${entry.lifecycle_id}`);
  }
  return actions;
}

function normalizeTimeoutMs(value) {
  const number = Number(value ?? DEFAULT_REVIEW_TIMEOUT_MS);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_REVIEW_TIMEOUT_MS;
  return Math.floor(number);
}

function normalizeCloseReason(value) {
  const normalized = String(value ?? 'completed').trim().toLowerCase().replace(/-/g, '_');
  return ['completed', 'timeout', 'replaced', 'manual_shutdown'].includes(normalized) ? normalized : 'completed';
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
