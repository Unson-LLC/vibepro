import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { listCheckpointStages } from './checkpoint-manager.js';
import { getStoryStatus } from './story-manager.js';
import { readStoryTasks, renderStoryTasks } from './story-task-generator.js';
import { getWorkspaceDir, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';
import { localizedText } from './language.js';
import { assertArtifactWritePath, preflightArtifactProjectionWrites, preflightArtifactWrites, resolveArtifactRoute, writeArtifactProjections } from './artifact-routing.js';

export async function listTasks(repoRoot, options = {}) {
  const context = await loadTaskContext(repoRoot, options.storyId);
  return {
    story: context.story,
    source_run: context.taskState.source_run,
    tasks: context.tasks
  };
}

export async function showTask(repoRoot, options = {}) {
  const context = await loadTaskContext(repoRoot, options.storyId);
  const task = findTask(context.tasks, options.taskId);
  return {
    story: context.story,
    source_run: context.taskState.source_run,
    task
  };
}

export async function createTasksFromPlan(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const manifest = await readManifest(root);
  const plan = await readStoryPlan(root);
  const selectedCandidates = selectPlanTaskCandidates(plan, options);
  if (selectedCandidates.length === 0) {
    throw new Error('No task candidates found in story plan. Run `vibepro story plan` first.');
  }
  const byStory = groupBy(selectedCandidates, (candidate) => candidate.story_id);
  const results = [];
  for (const [storyId, candidates] of Object.entries(byStory)) {
    const story = resolvePlanStory(plan, storyId);
    const taskState = buildPlanTaskState({ story, plan, candidates, allowedPaths: options.allowedPaths });
    const route = await resolveArtifactRoute(root, 'task_plan', { storyId });
    const tasksDir = path.join(getWorkspaceDir(root), 'stories', storyId, 'tasks');
    const jsonPath = route.canonical.relative_path.endsWith('.json') ? route.canonical.absolute_path : path.join(tasksDir, 'tasks.json');
    await preflightArtifactWrites(root, route, {
      additionalPaths: route.canonical.relative_path.endsWith('.json') ? [] : [toWorkspaceRelative(root, jsonPath)]
    });
    await mkdir(path.dirname(jsonPath), { recursive: true });
    const markdownPath = await assertArtifactWritePath(root, route.canonical.relative_path.endsWith('.json')
      ? (route.projections[0]?.relative_path ?? route.canonical.relative_path.replace(/\.json$/, '.md'))
      : route.canonical.relative_path);
    await mkdir(path.dirname(markdownPath), { recursive: true });
    const taskStateJson = `${JSON.stringify(taskState, null, 2)}\n`;
    const markdown = renderStoryTasks(taskState);
    await preflightArtifactProjectionWrites(root, route, route.canonical.relative_path.endsWith('.json') ? taskStateJson : markdown);
    await writeFile(jsonPath, taskStateJson);
    if (!route.canonical.relative_path.endsWith('.json')) await writeFile(markdownPath, markdown);
    await writeArtifactProjections(root, route, route.canonical.relative_path.endsWith('.json') ? taskStateJson : markdown);
    manifest.stories = {
      ...(manifest.stories ?? {}),
      [storyId]: {
        ...(manifest.stories?.[storyId] ?? {}),
        plan_tasks_json: toWorkspaceRelative(root, jsonPath),
        plan_tasks_markdown: toWorkspaceRelative(root, markdownPath),
        plan_tasks_generated_at: taskState.generated_at,
        plan_tasks_source: '.vibepro/stories/story-plan.json'
      }
    };
    results.push({
      story,
      taskState,
      artifacts: {
        json: toWorkspaceRelative(root, jsonPath),
        markdown: toWorkspaceRelative(root, markdownPath)
      }
    });
  }
  await writeManifest(root, manifest);
  return {
    source_plan: '.vibepro/stories/story-plan.json',
    created_story_count: results.length,
    created_task_count: results.reduce((sum, result) => sum + result.taskState.tasks.length, 0),
    results
  };
}

export async function createTaskBrief(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const { context, task, group } = await resolveTaskSelection(root, options);
  const briefing = buildTaskBriefing({
    story: context.story,
    sourceRun: context.taskState.source_run,
    task,
    group
  });
  const briefDir = getTaskArtifactDir(root, context.story.story_id, task.id, group?.id);
  await mkdir(briefDir, { recursive: true });
  const jsonPath = path.join(briefDir, 'briefing.json');
  const markdownPath = path.join(briefDir, 'briefing.md');
  await writeFile(jsonPath, `${JSON.stringify(briefing, null, 2)}\n`);
  await writeFile(markdownPath, renderTaskBriefing(briefing, options.language ?? 'ja'));
  return {
    story: context.story,
    task,
    group,
    briefing,
    artifacts: {
      json: toWorkspaceRelative(root, jsonPath),
      markdown: toWorkspaceRelative(root, markdownPath)
    }
  };
}

export async function createTaskPlan(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const { context, task, group } = await resolveTaskSelection(root, options);
  const briefing = buildTaskBriefing({
    story: context.story,
    sourceRun: context.taskState.source_run,
    task,
    group
  });
  const plan = buildTaskPlan({ briefing });
  const planDir = getTaskArtifactDir(root, context.story.story_id, task.id, group?.id);
  await mkdir(planDir, { recursive: true });
  const jsonPath = path.join(planDir, 'plan.json');
  const markdownPath = path.join(planDir, 'plan.md');
  await writeFile(jsonPath, `${JSON.stringify(plan, null, 2)}\n`);
  await writeFile(markdownPath, renderTaskPlan(plan, options.language ?? 'ja'));
  return {
    story: context.story,
    task,
    group,
    plan,
    artifacts: {
      json: toWorkspaceRelative(root, jsonPath),
      markdown: toWorkspaceRelative(root, markdownPath)
    }
  };
}

export async function createTaskHandoff(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const briefingResult = await createTaskBrief(root, options);
  const planResult = await createTaskPlan(root, options);
  const handoff = buildTaskHandoff({
    briefing: briefingResult.briefing,
    plan: planResult.plan,
    briefingArtifacts: briefingResult.artifacts,
    planArtifacts: planResult.artifacts
  });
  const handoffDir = getTaskArtifactDir(root, handoff.story.story_id, handoff.task.id, handoff.group?.id);
  await mkdir(handoffDir, { recursive: true });
  const jsonPath = path.join(handoffDir, 'handoff.json');
  const markdownPath = path.join(handoffDir, 'handoff.md');
  await writeFile(jsonPath, `${JSON.stringify(handoff, null, 2)}\n`);
  await writeFile(markdownPath, renderTaskHandoff(handoff, options.language ?? 'ja'));
  return {
    story: briefingResult.story,
    task: briefingResult.task,
    group: briefingResult.group,
    handoff,
    artifacts: {
      json: toWorkspaceRelative(root, jsonPath),
      markdown: toWorkspaceRelative(root, markdownPath)
    }
  };
}

export async function createTaskExecution(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const handoffResult = await createTaskHandoff(root, options);
  const task = handoffResult.task;
  const group = handoffResult.group;
  const story = handoffResult.story;
  const suffix = group?.id ? `${task.id}-${group.id}` : task.id;
  const prPrepareCommand = buildPrPrepareCommand({ story, task, group, baseRef: options.baseRef });
  const prCreateCommand = buildPrCreateCommand({ story, task, group, baseRef: options.baseRef, dryRun: options.dryRunPrCreate });
  const checkpointPlan = buildProgressiveGatePlan({ story, task, group, baseRef: options.baseRef });
  const execution = {
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    mode: 'task_execution_session',
    story,
    source_run: handoffResult.handoff.source_run,
    task,
    group,
    warnings: normalizeWarnings([options.managedWorktreeWarning]),
    execution: {
      vibepro_mutates_repository: false,
      implementation_agent_may_mutate_repository: true,
      note: 'VibeProは実装の入口と証跡を管理する。対象コードの修正は人間またはAIエージェントが行う。'
    },
    checkpoint_plan: checkpointPlan,
    references: {
      handoff_json: handoffResult.artifacts.json,
      handoff_markdown: handoffResult.artifacts.markdown,
      plan_json: handoffResult.handoff.references.plan_json,
      plan_markdown: handoffResult.handoff.references.plan_markdown,
      briefing_json: handoffResult.handoff.references.briefing_json,
      briefing_markdown: handoffResult.handoff.references.briefing_markdown
    },
    phases: [
      {
        id: 'read_context',
        title: 'Handoffを読む',
        required: true,
        artifacts: [
          handoffResult.artifacts.markdown,
          handoffResult.handoff.references.plan_markdown,
          handoffResult.handoff.references.briefing_markdown
        ]
      },
      {
        id: 'story_checkpoint',
        title: 'Story / Architecture / Spec checkpointを通す',
        required: true,
        command: checkpointPlan.commands.story
      },
      {
        id: 'implementation_start_checkpoint',
        title: '実装開始前checkpointを通す',
        required: true,
        command: checkpointPlan.commands.implementation_start,
        review_prepare_commands: findCheckpointStage(checkpointPlan, 'implementation-start')?.review_prepare_commands ?? []
      },
      {
        id: 'test_plan_checkpoint',
        title: 'Test Plan checkpointを通す',
        required: true,
        command: checkpointPlan.commands.test_plan,
        review_prepare_commands: findCheckpointStage(checkpointPlan, 'test-plan')?.review_prepare_commands ?? []
      },
      {
        id: 'implement',
        title: '対象範囲を実装する',
        required: true,
        target_files: handoffResult.handoff.target_files,
        instructions: handoffResult.handoff.implementation_instructions,
        prohibited_actions: handoffResult.handoff.prohibited_actions
      },
      {
        id: 'verify',
        title: '検証する',
        required: true,
        commands: handoffResult.handoff.verification_commands
      },
      {
        id: 'implementation_complete_checkpoint',
        title: '実装完了checkpointを通す',
        required: true,
        command: checkpointPlan.commands.implementation_complete,
        review_prepare_commands: findCheckpointStage(checkpointPlan, 'implementation-complete')?.review_prepare_commands ?? []
      },
      {
        id: 'verification_checkpoint',
        title: '検証checkpointを通す',
        required: true,
        command: checkpointPlan.commands.verification,
        review_prepare_commands: findCheckpointStage(checkpointPlan, 'verification')?.review_prepare_commands ?? []
      },
      {
        id: 'prepare_pr',
        title: 'PR準備物を生成する',
        required: true,
        command: prPrepareCommand,
        role: 'final_consistency_gate'
      },
      {
        id: 'pr_checkpoint',
        title: 'PR作成前checkpointを通す',
        required: true,
        command: checkpointPlan.commands.pr
      },
      {
        id: 'create_pr',
        title: 'PRを作成する',
        required: false,
        command: prCreateCommand
      }
    ],
    commands: {
      pr_prepare: prPrepareCommand,
      pr_create: prCreateCommand,
      verify_diagnosis: `npx vibepro diagnose . --run-id verify-${suffix}`,
      checkpoints: checkpointPlan.commands,
      review_prepare: checkpointPlan.review_prepare_commands
    },
    completion_report_template: [
      '変更したファイル',
      '実行した検証コマンドと結果',
      'vibepro pr prepare の成果物',
      '作成したPR URL',
      '未解決リスク'
    ]
  };
  const executionDir = getTaskArtifactDir(root, story.story_id, task.id, group?.id);
  await mkdir(executionDir, { recursive: true });
  const jsonPath = path.join(executionDir, 'execution.json');
  const markdownPath = path.join(executionDir, 'execution.md');
  await writeFile(jsonPath, `${JSON.stringify(execution, null, 2)}\n`);
  await writeFile(markdownPath, renderTaskExecution(execution, options.language ?? 'ja'));
  return {
    story,
    task,
    group,
    handoff: handoffResult.handoff,
    execution,
    artifacts: {
      json: toWorkspaceRelative(root, jsonPath),
      markdown: toWorkspaceRelative(root, markdownPath),
      handoff_json: handoffResult.artifacts.json,
      handoff_markdown: handoffResult.artifacts.markdown
    }
  };
}

export function renderTaskList(result, language = 'ja') {
  const tasks = Array.isArray(result.tasks) ? result.tasks : [];
  const title = localizedText(language, { ja: '# Storyタスク', en: '# Story Tasks' });
  const headers = localizedText(language, {
    ja: '| ID | 優先度 | 対象 | グループ | 状態 | タイトル |',
    en: '| ID | Priority | Targets | Groups | Status | Title |'
  });
  return `${title}

| 項目 | 内容 |
|------|------|
| Story ID | ${result.story?.story_id ?? '-'} |
| Story | ${result.story?.title ?? '-'} |
| Run ID | ${result.source_run?.run_id ?? '-'} |
| Gate | ${result.source_run?.gate_status ?? '-'} |
| タスク数 | ${tasks.length} |

${headers}
|----|--------|------|----------|------|----------|
${tasks.length === 0 ? '| - | - | - | - | - | - |' : tasks.map((task) => `| ${task.id} | ${task.priority} | ${task.target_count ?? task.target_files?.length ?? 0}件 | ${formatTargetGroups(task.target_groups)} | ${task.status} | ${task.title} |`).join('\n')}
`;
}

export function renderTaskCreateSummary(result, language = 'ja') {
  const rows = result.results.flatMap((item) => item.taskState.tasks.map((task) => `| ${item.story.story_id} | ${task.id} | ${task.priority} | ${task.title} | ${item.artifacts.markdown} |`));
  return `${localizedText(language, { ja: '# Task作成', en: '# Task Create' })}

| 項目 | 内容 |
|------|------|
| Source plan | ${result.source_plan} |
| Story数 | ${result.created_story_count} |
| Task数 | ${result.created_task_count} |

| Story | Task | Priority | Title | Artifact |
|-------|------|----------|-------|----------|
${rows.length === 0 ? '| - | - | - | - | - |' : rows.join('\n')}
`;
}

export function renderTaskShow(result, language = 'ja') {
  const task = result.task;
  return `${localizedText(language, { ja: '# Storyタスク', en: '# Story Task' })}

| 項目 | 内容 |
|------|------|
| Story ID | ${result.story?.story_id ?? '-'} |
| Story | ${result.story?.title ?? '-'} |
| Run ID | ${result.source_run?.run_id ?? '-'} |
| Task ID | ${task.id} |
| ${localizedText(language, { ja: 'Title', en: 'Title' })} | ${task.title} |
| ${localizedText(language, { ja: 'Priority', en: 'Priority' })} | ${task.priority} |
| ${localizedText(language, { ja: 'Status', en: 'Status' })} | ${task.status} |
| Execution | ${task.execution_policy} / mutates_repository=${task.mutates_repository} |
| Strategy | ${task.recommended_strategy?.id ?? '-'} |

## ${localizedText(language, { ja: '対象ファイル', en: 'Target Files' })}

${formatList(task.target_files)}

## ${localizedText(language, { ja: '対象route', en: 'Target Routes' })}

${formatRoutes(task.target_routes)}

## ${localizedText(language, { ja: '対象グループ', en: 'Target Groups' })}

${formatGroups(task.target_groups)}

## ${localizedText(language, { ja: '先に読むもの', en: 'Read First' })}

${formatReadFirst(task.read_first_files)}

## ${localizedText(language, { ja: '完了条件', en: 'Acceptance Criteria' })}

${formatList(task.acceptance_criteria)}
`;
}

export function renderTaskBriefing(briefing, language = 'ja') {
  return `# 修正前ブリーフィング

## 前提

- Story: ${briefing.story.title} (${briefing.story.story_id})
- Run ID: ${briefing.source_run?.run_id ?? '-'}
- Task: ${briefing.task.id} - ${briefing.task.title}
- Group: ${briefing.group?.id ?? '-'}
- Execution: ${briefing.execution_policy} / mutates_repository=${briefing.mutates_repository}

## ガードレール

${briefing.guardrails.map((item) => `- ${item}`).join('\n')}

## 対象route

${formatRoutes(briefing.target_routes)}

## 対象ファイル

${formatList(briefing.target_files)}

## 先に読むファイル

${formatReadFirst(briefing.read_first_files)}

## graphify文脈

- impact_score: ${briefing.graph_context?.impact_score ?? '-'}
- matched_route_count: ${briefing.graph_context?.matched_route_count ?? '-'}
- matched_node_count: ${briefing.graph_context?.matched_node_count ?? '-'}
- related_edge_count: ${briefing.graph_context?.related_edge_count ?? '-'}
- affected_communities: ${formatCommunities(briefing.graph_context?.affected_communities)}
- hub_nodes: ${formatHubNodes(briefing.graph_context?.hub_nodes)}

## 推奨方針

- ${briefing.recommended_strategy?.id ?? '-'}: ${briefing.recommended_strategy?.reason ?? '-'}

## ${localizedText(language, { ja: 'Source復旧', en: 'Source Recovery' })}

${renderSourceRecovery(briefing.source_recovery, briefing.recovery_drafts)}

## ${localizedText(language, { ja: 'Source整合性の検出事項', en: 'Source Alignment Findings' })}

${renderSourceAlignmentFindings(briefing.source_alignment_findings)}

## 実装手順候補

${briefing.implementation_steps.length === 0 ? '- なし' : briefing.implementation_steps.map((step, index) => `${index + 1}. ${step.title}: ${step.detail}`).join('\n')}

## 完了条件

${formatList(briefing.acceptance_criteria)}
`;
}

export function renderTaskPlan(plan, language = 'ja') {
  return `# 実装修正計画

## 前提

- Story: ${plan.story.title} (${plan.story.story_id})
- Run ID: ${plan.source_run?.run_id ?? '-'}
- Task: ${plan.task.id} - ${plan.task.title}
- Group: ${plan.group?.id ?? '-'}
- このplanは修正可能な作業計画
- CLI自身は対象リポジトリのコードを変更しない

## 実行境界

- plan_allows_repository_changes: ${plan.execution.plan_allows_repository_changes}
- cli_mutates_repository: ${plan.execution.cli_mutates_repository}

## 変更対象ファイル

${formatList(plan.target_files)}

## 先に読むファイル

${formatReadFirst(plan.read_first_files)}

## 推奨修正方針

- ${plan.recommended_strategy?.id ?? '-'}: ${plan.recommended_strategy?.reason ?? '-'}

## 実装ステップ

${plan.implementation_steps.length === 0 ? '- なし' : plan.implementation_steps.map((step, index) => `${index + 1}. ${step.title}: ${step.detail}`).join('\n')}

## 検証コマンド候補

${plan.verification_commands.map((item) => `- \`${item.command}\`: ${item.reason}`).join('\n')}

## 完了条件

${formatList(plan.acceptance_criteria)}

## ロールバック観点

${formatList(plan.rollback_considerations)}

## ガードレール

${formatList(plan.guardrails)}
`;
}

function renderSourceRecovery(sourceRecovery, drafts = []) {
  if (!sourceRecovery) return '- なし';
  const draftLines = drafts.length === 0
    ? '- Draft: なし'
    : drafts.map((draft) => [
      `- Draft: ${draft.kind} / ${draft.status}`,
      `  - suggested_path: ${draft.suggested_path ?? '-'}`,
      `  - title: ${draft.title ?? '-'}`,
      `  - evidence: ${(draft.evidence_files ?? []).slice(0, 5).join(', ') || '-'}`,
      `  - graph: ${formatSourceRecoveryGraphEvidence(draft.graph_evidence)}`,
      `  - unresolved: ${(draft.unresolved_questions ?? []).slice(0, 3).join(' / ') || '-'}`
    ].join('\n')).join('\n');
  return [
    `- status: ${sourceRecovery.status}`,
    `- story: ${sourceRecovery.sources?.story?.status ?? '-'}`,
    `- spec: ${sourceRecovery.sources?.spec?.status ?? '-'}`,
    `- architecture: ${sourceRecovery.sources?.architecture?.status ?? '-'}`,
    draftLines
  ].join('\n');
}

function formatSourceRecoveryGraphEvidence(graphEvidence) {
  if (!graphEvidence) return '-';
  const communities = (graphEvidence.affected_communities ?? []).map((community) => `${community.id}:${community.node_count ?? 0}`).slice(0, 3).join(', ') || '-';
  const hubs = (graphEvidence.hub_nodes ?? []).map((node) => `${node.source_file ?? node.id}(${node.degree ?? 0})`).slice(0, 3).join(', ') || '-';
  return `matched=${(graphEvidence.matched_files ?? []).length}, related=${(graphEvidence.related_files ?? []).length}, edges=${graphEvidence.related_edge_count ?? 0}, communities=${communities}, hubs=${hubs}`;
}

function renderSourceAlignmentFindings(findings = []) {
  if (!Array.isArray(findings) || findings.length === 0) return '- なし';
  return findings.slice(0, 8).map((finding) => [
    `- ${finding.severity}: ${finding.type}`,
    `  - potential_bug: ${finding.potential_bug}`,
    `  - review: ${finding.recommended_review}`,
    `  - evidence_files: ${(finding.evidence?.files ?? []).slice(0, 5).join(', ') || '-'}`
  ].join('\n')).join('\n');
}

export function renderTaskHandoff(handoff, language = 'ja') {
  return `# 実装依頼パッケージ

## 前提

- Story: ${handoff.story.title} (${handoff.story.story_id})
- Run ID: ${handoff.source_run?.run_id ?? '-'}
- Task: ${handoff.task.id} - ${handoff.task.title}
- Group: ${handoff.group?.id ?? '-'}
- VibeProは実装を実行しない
- 修正はhandoffを受けた人間/AIが行う

## 参照成果物

- briefing.json: ${handoff.references.briefing_json}
- briefing.md: ${handoff.references.briefing_markdown}
- plan.json: ${handoff.references.plan_json}
- plan.md: ${handoff.references.plan_markdown}

## plan要約

- 方針: ${handoff.plan_summary.recommended_strategy?.id ?? '-'} - ${handoff.plan_summary.recommended_strategy?.reason ?? '-'}
- 変更対象: ${handoff.plan_summary.target_file_count}ファイル
- 検証コマンド: ${handoff.plan_summary.verification_command_count}件

## 変更対象ファイル

${formatList(handoff.target_files)}

## 対象route

${formatRoutesWithProtection(handoff.target_routes)}

## 現在の保護判定

- route_statuses: ${formatObjectSummary(handoff.current_protection.route_statuses)}
- risk_hints: ${formatObjectSummary(handoff.current_protection.risk_hints)}

## 期待する修正後シグナル

${formatList(handoff.expected_fix_signals)}

## 実行環境前提

${formatList(handoff.environment_assumptions)}

## 先に読むファイル

${formatReadFirst(handoff.read_first_files)}

## 実装者への指示

${formatList(handoff.implementation_instructions)}

## 禁止事項

${formatList(handoff.prohibited_actions)}

## 検証コマンド

${handoff.verification_commands.map((item) => `- \`${item.command}\`: ${item.reason}`).join('\n')}

## 完了報告テンプレート

${handoff.completion_report_template.map((item) => `- ${item}`).join('\n')}
`;
}

export function renderTaskExecution(execution, language = 'ja') {
  const warnings = execution.warnings?.length
    ? execution.warnings.map((warning) => `- ${warning.id}: ${warning.reason}`).join('\n')
    : '- none';
  const checkpointPlan = renderProgressiveGatePlan(execution.checkpoint_plan);
  return `# 実行セッション

## 前提

- Story: ${execution.story.title} (${execution.story.story_id})
- Task: ${execution.task.id} - ${execution.task.title}
- Group: ${execution.group?.id ?? '-'}
- VibeProは実装の入口と証跡を管理する
- 対象コードの修正は人間またはAIエージェントが行う

## Warnings

${warnings}

## 参照成果物

- handoff.md: ${execution.references.handoff_markdown}
- plan.md: ${execution.references.plan_markdown}
- briefing.md: ${execution.references.briefing_markdown}

## 実行フェーズ

${execution.phases.map((phase, index) => `${index + 1}. ${phase.title}${phase.required ? ' (required)' : ' (optional)'}`).join('\n')}

## Progressive Gate Plan

${checkpointPlan}

## 実装対象

${formatList(execution.phases.find((phase) => phase.id === 'implement')?.target_files)}

## 検証コマンド

${execution.phases.find((phase) => phase.id === 'verify')?.commands.map((item) => `- \`${item.command}\`: ${item.reason}`).join('\n') ?? '- なし'}

## PR接続

- prepare: \`${execution.commands.pr_prepare}\`
- create: \`${execution.commands.pr_create}\`

## 完了報告テンプレート

${formatList(execution.completion_report_template)}
`;
}

function renderProgressiveGatePlan(checkpointPlan) {
  if (!checkpointPlan) return '- なし';
  const stageRows = checkpointPlan.stages.map((stage) => [
    `- ${stage.stage}: ${stage.label}`,
    `  - timing: ${stage.timing}`,
    `  - checkpoint: \`${stage.command}\``,
    stage.review_prepare_commands.length > 0
      ? `  - review prepare: ${stage.review_prepare_commands.map((command) => `\`${command}\``).join(' / ')}`
      : '  - review prepare: -'
  ].join('\n')).join('\n');
  return [
    `- principle: ${checkpointPlan.principle}`,
    stageRows
  ].join('\n');
}

async function loadTaskContext(repoRoot, storyId = null) {
  const root = path.resolve(repoRoot);
  const status = await getStoryStatus(root, storyId);
  const manifest = await readManifest(root);
  const taskArtifact = status.artifacts?.story_tasks_json
    ?? manifest.stories?.[status.story.story_id]?.plan_tasks_json
    ?? toWorkspaceRelative(root, path.join(getWorkspaceDir(root), 'stories', status.story.story_id, 'tasks', 'tasks.json'));
  const taskState = await readStoryTasks(root, taskArtifact);
  const tasks = Array.isArray(taskState.tasks) ? taskState.tasks : [];
  return {
    story: status.story,
    latestRun: status.latestRun,
    taskState,
    tasks
  };
}

async function readStoryPlan(repoRoot) {
  const planPath = path.join(getWorkspaceDir(repoRoot), 'stories', 'story-plan.json');
  try {
    return JSON.parse(await readFile(planPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Story plan not found. Run `vibepro story plan` first.');
    }
    throw error;
  }
}

function selectPlanTaskCandidates(plan, options = {}) {
  const storyId = options.storyId ?? null;
  const taskId = options.taskId ?? null;
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : null;
  let candidates = Array.isArray(plan.task_candidates) ? plan.task_candidates : [];
  if (storyId) candidates = candidates.filter((candidate) => candidate.story_id === storyId);
  if (taskId) candidates = candidates.filter((candidate) => candidate.id === taskId);
  return limit ? candidates.slice(0, limit) : candidates;
}

function resolvePlanStory(plan, storyId) {
  const story = (plan.priority_stories ?? []).find((item) => item.story_id === storyId);
  return {
    story_id: storyId,
    title: story?.title ?? storyId,
    ssot: 'local',
    status: 'active',
    horizon: story?.horizon ?? null,
    view: story?.view ?? null,
    period: story?.period ?? null,
    category: story?.category ?? null
  };
}

function buildScopeBoundary({ candidates, allowedPaths }) {
  const normalizedAllowedPaths = Array.isArray(allowedPaths)
    ? [...new Set(allowedPaths.map((item) => String(item).trim()).filter(Boolean))]
    : [];
  if (normalizedAllowedPaths.length > 0) {
    return {
      schema_version: '0.1.0',
      declared: true,
      allowed_paths: normalizedAllowedPaths,
      source: 'cli_declared',
      recorded_at: new Date().toISOString()
    };
  }
  const derived = [...new Set(
    candidates.flatMap((candidate) => Array.isArray(candidate.target_files) ? candidate.target_files : [])
  )];
  return {
    schema_version: '0.1.0',
    declared: false,
    allowed_paths: derived,
    source: derived.length > 0 ? 'derived_from_target_files' : 'none',
    recorded_at: new Date().toISOString()
  };
}

export function resolveCandidateTargetFiles(candidate, allowedPaths) {
  const declared = Array.isArray(candidate.target_files) ? candidate.target_files : [];
  if (declared.length > 0) return declared;
  const searchable = flattenTargetInferenceText({
    title: candidate.title,
    purpose: candidate.purpose,
    acceptance: candidate.acceptance,
    implementation_steps: candidate.implementation_steps
  });
  return (Array.isArray(allowedPaths) ? allowedPaths : [])
    .map((item) => String(item).trim())
    .filter((item) => item && !/[*?[\]{}]/.test(item) && hasMutationTargetMention(searchable, item));
}

function flattenTargetInferenceText(value) {
  if (Array.isArray(value)) return value.map((item) => flattenTargetInferenceText(item)).join('\n');
  if (value && typeof value === 'object') {
    return Object.values(value).map((item) => flattenTargetInferenceText(item)).join('\n');
  }
  return value == null ? '' : String(value);
}

function hasMutationTargetMention(searchable, targetPath) {
  const escapedPath = targetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactPath = new RegExp(`(^|[\\s"'\\x60([{,:、])${escapedPath}(?=$|[\\s"'\\x60\\])},:;。、「」]|を|へ|に|が|は|の|と|で)`, 'g');
  for (const match of searchable.matchAll(exactPath)) {
    const pathStart = match.index + match[1].length;
    if (!isReferenceOnlyPathMention(searchable, targetPath, pathStart)) return true;
  }
  return false;
}

function isReferenceOnlyPathMention(searchable, targetPath, pathStart) {
  const lineStart = searchable.lastIndexOf('\n', pathStart) + 1;
  const nextLineBreak = searchable.indexOf('\n', pathStart);
  const lineEnd = nextLineBreak >= 0 ? nextLineBreak : searchable.length;
  const before = searchable.slice(lineStart, pathStart);
  const after = searchable.slice(pathStart + targetPath.length, lineEnd);
  const englishPredicateBefore = /(?:\bmust\s+not|\bdo\s+not|\bdon't|\bnever|\bwithout)\s+(?:modify(?:ing)?|edit(?:ing)?|chang(?:e|ing)|import(?:ing)?|call(?:ing)?|depend(?:ing)?\s+on)\s*$/i;
  const englishReferenceBefore = /(?:\brefer\s+to|\bsee|\bread)\s*$/i;
  const englishNegativeAfter = /^\s+(?:must|should)\s+not\s+be\s+(?:modified|edited|changed|imported|called)/i;
  const japanesePredicateAfter = /^(?:を|へ|への|に|には|と|との)?[^、。;\n]{0,24}(?:変更|編集|修正|追加|import|インポート|依存|逆呼び出し)[^、。;\n]{0,12}(?:しない|せず|禁止|不可)/;
  const japaneseReferenceAfter = /^(?:を|へ|への|に)?(?:参照(?:する|のみ)?|読むだけ|読み取り専用|参考のみ)/;
  return englishPredicateBefore.test(before)
    || englishReferenceBefore.test(before)
    || englishNegativeAfter.test(after)
    || japanesePredicateAfter.test(after)
    || japaneseReferenceAfter.test(after);
}

function buildPlanTaskState({ story, plan, candidates, allowedPaths }) {
  const tasks = candidates.map((candidate, index) => {
    const targetFiles = resolveCandidateTargetFiles(candidate, allowedPaths);
    return {
      id: candidate.id,
      source_type: candidate.source_type ?? 'story_plan_candidate',
      source_id: candidate.id,
      finding_id: null,
      title: candidate.title,
      priority: candidate.priority ?? 'medium',
      status: 'todo',
      order: (index + 1) * 10,
      execution_policy: 'proposal_only',
      mutates_repository: false,
      target_count: targetFiles.length,
      target_files: targetFiles,
      target_routes: [],
      target_groups: [],
      read_first_files: candidate.read_first_files ?? [],
      recommended_strategy: candidate.recommended_strategy ?? {
        id: 'story-plan',
        reason: candidate.purpose
      },
      implementation_steps: candidate.implementation_steps ?? [],
      acceptance_criteria: candidate.acceptance ?? [],
      source_recovery: candidate.source_recovery ?? null,
      recovery_drafts: candidate.recovery_drafts ?? [],
      source_alignment_findings: candidate.source_alignment_findings ?? [],
      graph_context: candidate.graph_context ?? candidate.source_recovery?.graph_context ?? null,
      pre_fix_briefing: null
    };
  });
  return {
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    story,
    source_run: {
      run_id: plan.source?.run_id ?? 'story-plan',
      gate_status: plan.summary?.coverage_status ?? 'unknown',
      source_plan_generated_at: plan.generated_at
    },
    scope_boundary: buildScopeBoundary({ candidates, allowedPaths }),
    tasks
  };
}

async function resolveTaskSelection(repoRoot, options = {}) {
  const context = await loadTaskContext(repoRoot, options.storyId);
  const task = findTask(context.tasks, options.taskId);
  const group = options.groupId ? findTargetGroup(task, options.groupId) : null;
  return { context, task, group };
}

function buildTaskBriefing({ story, sourceRun, task, group }) {
  const targetRoutes = group ? group.routes ?? [] : task.target_routes ?? [];
  const targetFiles = group ? group.target_files ?? [] : task.target_files ?? [];
  const readFirstFiles = resolveBriefReadFirstFiles({ targetFiles, group, task });
  return {
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    mode: 'pre_fix_briefing',
    story,
    source_run: sourceRun,
    task: {
      id: task.id,
      title: task.title,
      priority: task.priority,
      finding_id: task.finding_id,
      source_type: task.source_type,
      source_id: task.source_id
    },
    group: group ? {
      id: group.id,
      title: group.title,
      route_count: group.route_count,
      classification: group.classification
    } : null,
    execution_policy: task.execution_policy,
    mutates_repository: false,
    guardrails: [
      'このCLIは対象リポジトリのコードを修正しない',
      '修正に入る前の作業指示と確認対象だけを生成する',
      '実装時は対象route、対象ファイル、完了条件を再確認する'
    ],
    target_routes: targetRoutes,
    target_files: targetFiles,
    read_first_files: readFirstFiles,
    graph_context: task.graph_context ?? null,
    pre_fix_briefing: task.pre_fix_briefing ?? null,
    source_recovery: task.source_recovery ?? null,
    recovery_drafts: task.recovery_drafts ?? [],
    source_alignment_findings: task.source_alignment_findings ?? [],
    recommended_strategy: group?.recommended_strategy ?? task.recommended_strategy ?? null,
    implementation_steps: task.implementation_steps ?? [],
    acceptance_criteria: group?.acceptance_criteria ?? task.acceptance_criteria ?? []
  };
}

function buildTaskPlan({ briefing }) {
  const suffix = briefing.group?.id ? `${briefing.task.id}-${briefing.group.id}` : briefing.task.id;
  return {
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    mode: 'implementation_plan',
    story: briefing.story,
    source_run: briefing.source_run,
    task: briefing.task,
    group: briefing.group,
    execution: {
      plan_allows_repository_changes: true,
      cli_mutates_repository: false,
      note: 'このplanは修正可能な作業計画。ただしCLI自身は対象リポジトリのコードを変更しない。'
    },
    target_routes: briefing.target_routes,
    target_files: briefing.target_files,
    read_first_files: briefing.read_first_files,
    recommended_strategy: briefing.recommended_strategy,
    implementation_steps: briefing.implementation_steps,
    verification_commands: buildVerificationCommands(suffix),
    acceptance_criteria: briefing.acceptance_criteria,
    rollback_considerations: [
      '対象ファイル単位で差分を確認し、対象グループ外の変更が混ざっていないか確認する',
      '認証境界を変更する場合は、public API と webhook API を巻き込んでいないか確認する',
      '診断再実行後に新しいCritical/Highが増えた場合は、変更を戻せる粒度でコミットを分ける'
    ],
    guardrails: [
      'このplanは修正可能な作業計画',
      'CLI自身は対象リポジトリのコードを変更しない',
      '実装修正は人間またはAIエージェントが別操作として行う',
      '修正後はVibePro診断を再実行して完了条件を確認する'
    ],
    source_briefing: {
      mode: briefing.mode,
      generated_at: briefing.generated_at
    }
  };
}

function buildTaskHandoff({ briefing, plan, briefingArtifacts, planArtifacts }) {
  return {
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    mode: 'implementation_handoff',
    story: plan.story,
    source_run: plan.source_run,
    task: plan.task,
    group: plan.group,
    execution: {
      vibepro_mutates_repository: false,
      recipient_may_mutate_repository: true,
      note: 'VibeProは実装を実行しない。修正はhandoffを受けた人間/AIが行う。'
    },
    references: {
      briefing_json: briefingArtifacts.json,
      briefing_markdown: briefingArtifacts.markdown,
      plan_json: planArtifacts.json,
      plan_markdown: planArtifacts.markdown
    },
    plan_summary: {
      recommended_strategy: plan.recommended_strategy,
      target_file_count: plan.target_files.length,
      verification_command_count: plan.verification_commands.length,
      acceptance_criteria_count: plan.acceptance_criteria.length
    },
    target_routes: plan.target_routes,
    target_files: plan.target_files,
    read_first_files: plan.read_first_files,
    current_protection: summarizeCurrentProtection(plan.target_routes),
    expected_fix_signals: [
      '対象routeのprotection_statusがprotected_by_routeまたはprotected_by_middlewareになる',
      '対象routeからprivileged_route_unprotectedが消える',
      'VibePro診断で対象タスクの完了条件を満たす'
    ],
    environment_assumptions: [
      '対象リポジトリのルートで実行する',
      'VibePro CLIがPATHにない場合は npx vibepro を使う',
      'npm test と npm run lint は対象リポジトリのpackage.jsonに定義されている場合に実行する'
    ],
    implementation_instructions: buildImplementationInstructions({ briefing, plan, planArtifacts }),
    prohibited_actions: [
      '対象グループ外のファイルを同じ作業で変更しない',
      'VibeProの生成物を根拠なく手編集しない',
      'public API と webhook API を巻き込む認証境界変更を行わない',
      '検証コマンドを省略したまま完了扱いにしない'
    ],
    verification_commands: plan.verification_commands,
    completion_report_template: [
      '変更したファイル',
      '採用した修正方針',
      '実行した検証コマンドと結果',
      '未解決のリスクまたは次に見るべき点'
    ],
    guardrails: [
      'VibeProは実装を実行しない',
      '修正はhandoffを受けた人間/AIが行う',
      'handoffは実装前の依頼パッケージであり、対象コードの変更結果ではない'
    ]
  };
}

function buildProgressiveGatePlan({ story, task, group, baseRef }) {
  const stages = listCheckpointStages().map((checkpoint) => {
    const command = buildCheckpointCommand({
      checkpointStage: checkpoint.stage,
      story,
      task,
      group,
      baseRef
    });
    const reviewPrepareCommands = checkpoint.review_stages.map((reviewStage) => buildReviewPrepareCommand({
      story,
      reviewStage
    }));
    return {
      stage: checkpoint.stage,
      label: checkpoint.label,
      timing: resolveCheckpointTiming(checkpoint.stage),
      required: true,
      command,
      review_stages: checkpoint.review_stages,
      review_prepare_commands: reviewPrepareCommands,
      gate_ids: checkpoint.gate_ids,
      purpose: checkpoint.stage === 'pr'
        ? 'PR作成直前の最終整合性確認。ここで初めてdevelopment-phase reviewを発見する前提にしない。'
        : 'このフェーズで次へ進めるかを確認し、必要なAgent Reviewはこの時点でdispatchする。'
    };
  });
  return {
    schema_version: '0.1.0',
    model: 'progressive_gate_plan',
    story_id: story.story_id,
    task_id: task.id,
    group_id: group?.id ?? null,
    principle: 'pr prepare/pr checkpointは最終整合性確認であり、Story/Spec/実装/検証のGate発見とAgent Review dispatchは各checkpointで前倒しする。',
    stages,
    commands: Object.fromEntries(stages.map((stage) => [checkpointCommandKey(stage.stage), stage.command])),
    review_prepare_commands: Object.fromEntries(
      stages
        .filter((stage) => stage.review_prepare_commands.length > 0)
        .map((stage) => [checkpointCommandKey(stage.stage), stage.review_prepare_commands])
    )
  };
}

function findCheckpointStage(checkpointPlan, stageId) {
  return checkpointPlan.stages.find((stage) => stage.stage === stageId);
}

function resolveCheckpointTiming(stage) {
  if (stage === 'story') return 'before_implementation';
  if (stage === 'implementation-start') return 'before_code_changes';
  if (stage === 'test-plan') return 'before_or_early_implementation';
  if (stage === 'implementation-complete') return 'after_code_changes_before_pr_handoff';
  if (stage === 'verification') return 'after_verification_before_pr_prepare';
  if (stage === 'pr') return 'after_pr_prepare_before_pr_create';
  return 'during_execution';
}

function checkpointCommandKey(stage) {
  return stage.replaceAll('-', '_');
}

function buildCheckpointCommand({ checkpointStage, story, task, group, baseRef }) {
  return [
    'npx vibepro checkpoint',
    checkpointStage,
    '.',
    `--story-id ${shellQuote(story.story_id)}`,
    `--task ${shellQuote(task.id)}`,
    group?.id ? `--group ${shellQuote(group.id)}` : null,
    baseRef ? `--base ${shellQuote(baseRef)}` : null
  ].filter(Boolean).join(' ');
}

function buildReviewPrepareCommand({ story, reviewStage }) {
  return [
    'npx vibepro review prepare .',
    `--id ${shellQuote(story.story_id)}`,
    `--stage ${shellQuote(reviewStage)}`
  ].join(' ');
}

function buildImplementationInstructions({ briefing, plan, planArtifacts }) {
  return [
    `${planArtifacts.markdown} を読み、対象ファイルと完了条件を確認する`,
    '先に読むファイルを確認し、既存の認証境界とgraphify文脈を把握する',
    `${plan.recommended_strategy?.id ?? 'recommended strategy'} 方針に沿って対象ファイルを修正する`,
    '修正後に検証コマンドを実行し、完了条件を満たすことを確認する',
    `${briefing.task.id}${briefing.group?.id ? ` / ${briefing.group.id}` : ''} の範囲だけを完了報告する`
  ];
}

function buildVerificationCommands(suffix) {
  return [
    {
      command: 'npm test',
      reason: '対象リポジトリの既存テストを確認する'
    },
    {
      command: 'npm run lint',
      reason: 'lintが定義されている場合に静的チェックを確認する'
    },
    {
      command: `npx vibepro diagnose . --run-id verify-${suffix}`,
      reason: 'VibePro診断で対象タスクの検出事項が改善したか確認する'
    }
  ];
}

function buildPrPrepareCommand({ story, task, group, baseRef }) {
  return [
    'npx vibepro pr prepare .',
    `--story-id ${shellQuote(story.story_id)}`,
    `--task ${shellQuote(task.id)}`,
    group?.id ? `--group ${shellQuote(group.id)}` : null,
    baseRef ? `--base ${shellQuote(baseRef)}` : null
  ].filter(Boolean).join(' ');
}

function buildPrCreateCommand({ story, task, group, baseRef, dryRun }) {
  return [
    'npx vibepro pr create .',
    `--story-id ${shellQuote(story.story_id)}`,
    `--task ${shellQuote(task.id)}`,
    group?.id ? `--group ${shellQuote(group.id)}` : null,
    baseRef ? `--base ${shellQuote(baseRef)}` : null,
    dryRun ? '--dry-run' : null
  ].filter(Boolean).join(' ');
}

function shellQuote(value) {
  if (/^[a-zA-Z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function summarizeCurrentProtection(routes = []) {
  const routeStatuses = {};
  const riskHints = {};
  for (const route of routes) {
    const status = route.protection_status ?? 'unknown';
    routeStatuses[status] = (routeStatuses[status] ?? 0) + 1;
    for (const hint of route.risk_hints ?? []) {
      riskHints[hint] = (riskHints[hint] ?? 0) + 1;
    }
  }
  return {
    route_statuses: routeStatuses,
    risk_hints: riskHints,
    routes: routes.map((route) => ({
      route_path: route.route_path,
      file: route.file,
      methods: route.methods ?? [],
      protection_status: route.protection_status ?? 'unknown',
      protection_evidence: route.protection_evidence ?? [],
      risk_hints: route.risk_hints ?? []
    }))
  };
}

function resolveBriefReadFirstFiles({ targetFiles, group, task }) {
  const selected = [];
  const seen = new Set();
  const add = (item) => {
    if (!item?.file || seen.has(item.file)) return;
    seen.add(item.file);
    selected.push(item);
  };
  for (const item of group?.read_first_files ?? []) add(item);
  for (const file of targetFiles) {
    add({ file, reason: group ? `対象グループ ${group.id} の修正候補` : `対象タスク ${task.id} の修正候補` });
  }
  for (const item of task.read_first_files ?? []) {
    if (group && item.reason?.startsWith('対象API route:')) continue;
    add(item);
  }
  return selected;
}

function getTaskArtifactDir(repoRoot, storyId, taskId, groupId = null) {
  const baseDir = path.join(getWorkspaceDir(repoRoot), 'stories', safeSegment(storyId), 'tasks', safeSegment(taskId));
  return groupId ? path.join(baseDir, 'groups', safeSegment(groupId)) : baseDir;
}

function findTask(tasks, taskId) {
  if (!taskId) throw new Error('--task is required');
  const task = tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return task;
}

function findTargetGroup(task, groupId) {
  const group = (task.target_groups ?? []).find((item) => item.id === groupId);
  if (!group) throw new Error(`Target group not found: ${groupId}`);
  return group;
}

function formatTargetGroups(groups = []) {
  if (!Array.isArray(groups) || groups.length === 0) return '-';
  return groups.map((group) => `${group.id}(${group.route_count})`).join(', ');
}

function formatGroups(groups = []) {
  if (!Array.isArray(groups) || groups.length === 0) return '- なし';
  return groups.map((group) => `- ${group.id}: ${group.title ?? group.id} (${group.route_count}件)`).join('\n');
}

function formatRoutes(routes = []) {
  if (!Array.isArray(routes) || routes.length === 0) return '- なし';
  return routes.map((route) => `- ${route.route_path} (${route.methods?.join(', ') || '-'}) - ${route.file}`).join('\n');
}

function formatRoutesWithProtection(routes = []) {
  if (!Array.isArray(routes) || routes.length === 0) return '- なし';
  return routes.map((route) => [
    `- ${route.route_path} (${route.methods?.join(', ') || '-'}) - ${route.file}`,
    `  - protection=${route.protection_status ?? 'unknown'}, evidence=${route.protection_evidence?.join(', ') || '-'}, risk=${route.risk_hints?.join(', ') || '-'}`
  ].join('\n')).join('\n');
}

function formatReadFirst(files = []) {
  if (!Array.isArray(files) || files.length === 0) return '- なし';
  return files.map((item) => `- ${item.file}${item.reason ? `: ${item.reason}` : ''}`).join('\n');
}

function formatList(items = []) {
  if (!Array.isArray(items) || items.length === 0) return '- なし';
  return items.map((item) => `- ${item}`).join('\n');
}

function normalizeWarnings(warnings) {
  return warnings.filter((warning) => warning && typeof warning === 'object');
}

function formatCommunities(communities = []) {
  if (!Array.isArray(communities) || communities.length === 0) return '-';
  return communities.map((community) => `${community.id}(route:${community.route_count}, node:${community.node_count}, edge:${community.edge_count})`).join(', ');
}

function formatHubNodes(nodes = []) {
  if (!Array.isArray(nodes) || nodes.length === 0) return '-';
  return nodes.map((node) => node.id ?? node.label ?? '-').join(', ');
}

function formatObjectSummary(value = {}) {
  const entries = Object.entries(value);
  if (entries.length === 0) return '-';
  return entries.map(([key, count]) => `${key}:${count}`).join(', ');
}

function groupBy(items, getKey) {
  return items.reduce((groups, item) => {
    const key = getKey(item);
    groups[key] = [...(groups[key] ?? []), item];
    return groups;
  }, {});
}

function safeSegment(value) {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error(`Invalid path segment: ${value}`);
  }
  return value;
}
