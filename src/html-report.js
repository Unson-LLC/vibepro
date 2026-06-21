import { localizedText } from './language.js';

export function renderPrPrepareHtml({ preparation, bodyPath, gateDagPath, splitPlanPath, language = 'ja' }) {
  const gateDag = preparation.pr_context.gate_dag;
  const requirement = preparation.pr_context.requirement_consistency;
  const splitPlan = preparation.split_plan;
  const executionGate = preparation.pr_context.execution_gate ?? preparation.gate_status?.execution_gate ?? null;
  const agentReviews = preparation.pr_context.agent_reviews ?? null;
  const labels = prPrepareLabels(language);
  const cards = [
    metricCard(labels.scope, preparation.scope.status, preparation.scope.recommended_strategy),
    metricCard('Gate DAG', gateDag.overall_status, localizedText(language, {
      ja: `${gateDag.summary.needs_evidence_count}件 未解決`,
      en: `${gateDag.summary.needs_evidence_count} unresolved`
    })),
    metricCard(labels.executionGate, executionGate?.status ?? 'unknown', executionGate?.pr_create_allowed ? labels.prCreateAllowed : labels.prCreateBlocked),
    metricCard(labels.agentReviews, agentReviews?.status ?? 'not_generated', localizedText(language, {
      ja: `${(agentReviews?.summary?.unmet_required_review_count ?? 0) + (agentReviews?.summary?.unmet_checkpoint_review_count ?? 0)}件 未充足`,
      en: `${(agentReviews?.summary?.unmet_required_review_count ?? 0) + (agentReviews?.summary?.unmet_checkpoint_review_count ?? 0)} unmet`
    })),
    metricCard(labels.requirement, requirement?.status ?? 'not_generated', localizedText(language, {
      ja: `${requirement?.summary?.contradiction_count ?? 0}件 矛盾`,
      en: `${requirement?.summary?.contradiction_count ?? 0} contradictions`
    })),
    metricCard(labels.splitPlan, splitPlan.status, localizedText(language, {
      ja: `${splitPlan.lanes.length}レーン`,
      en: `${splitPlan.lanes.length} lanes`
    }))
  ].join('');
  const flow = renderFlow([
    flowStep(labels.story, preparation.story.story_id, preparation.pr_context.story_source.path ? 'present' : 'transient'),
    flowStep(labels.architecture, preparation.pr_context.architecture_decision, gateStatus(gateDag, 'architecture')),
    flowStep(labels.spec, localizedText(language, {
      ja: `${preparation.file_groups.specifications.count}ファイル`,
      en: `${preparation.file_groups.specifications.count} files`
    }), gateStatus(gateDag, 'spec')),
    flowStep(labels.code, localizedText(language, {
      ja: `${preparation.file_groups.source.count}ファイル`,
      en: `${preparation.file_groups.source.count} files`
    }), gateStatus(gateDag, 'code')),
    flowStep(labels.gates, gateDag.overall_status, gateDag.overall_status)
  ]);
  const risks = renderCards(localizedText(language, { ja: '人間レビューの焦点', en: 'Human Review Focus' }), [
    ...preparation.pr_context.risks.map((risk) => ({ title: 'Risk', detail: risk, tone: 'danger' })),
    ...preparation.pr_context.review_points.map((point) => ({ title: 'Review', detail: point, tone: 'info' }))
  ]);
  const requirementSection = renderRequirementPanel(requirement, language);
  const networkSection = renderNetworkContractPanel(preparation.pr_context.network_contracts, language);
  const engineeringJudgmentSection = renderEngineeringJudgmentPanel(
    preparation.pr_context.engineering_judgment,
    gateDag,
    language
  );
  const fileGroups = renderFileGroups(preparation.file_groups, language);
  const graphSummary = renderGraphSummary(splitPlan.graph_context, language);
  const artifacts = renderKeyValueTable([
    ['PR body draft', bodyPath],
    ['Gate DAG HTML', gateDagPath],
    ['Split Plan HTML', splitPlanPath]
  ]);
  const nextCommands = renderCommandList(preparation.next_commands);
  const lifecycleArtifacts = renderPrLifecycleArtifactsPanel(preparation.lifecycle_artifacts, language);

  return renderDocument({
    title: 'VibePro PR Prepare',
    reportType: 'pr-prepare',
    generatedAt: preparation.created_at,
    language,
    body: `
      <section class="hero" data-overall-status="${escapeAttr(gateDag.overall_status)}">
        <div>
          <p class="eyebrow">${escapeHtml(labels.eyebrow)}</p>
          <h2>${escapeHtml(preparation.story.title)}</h2>
          <p class="muted">${escapeHtml(preparation.story.story_id)} / ${escapeHtml(preparation.git.base_ref)} -> ${escapeHtml(preparation.git.head_ref)}</p>
        </div>
        <span class="${statusClass(gateDag.overall_status)}">${escapeHtml(gateDag.overall_status)}</span>
      </section>
      <section class="metrics">${cards}</section>
      ${renderPrPrepareGuide({ preparation, bodyPath, gateDagPath, splitPlanPath, language })}
      <section>
        <h2>${labels.flowTitle}</h2>
        ${flow}
      </section>
      ${risks}
      ${engineeringJudgmentSection}
      ${renderExecutionGatePanel(executionGate, language)}
      ${renderAgentReviewPanel(agentReviews, language)}
      ${lifecycleArtifacts}
      ${requirementSection}
      ${networkSection}
      <section>
        <h2>${escapeHtml(labels.graphifyImpact)}</h2>
        ${graphSummary}
      </section>
      <section>
        <h2>${escapeHtml(labels.changedFileGroups)}</h2>
        ${fileGroups}
      </section>
      <section class="grid-2">
        <div>
          <h2>${escapeHtml(localizedText(language, { ja: '成果物', en: 'Artifacts' }))}</h2>
          ${artifacts}
        </div>
        <div>
          <h2>${escapeHtml(localizedText(language, { ja: '次のコマンド', en: 'Next Commands' }))}</h2>
          ${nextCommands}
        </div>
      </section>
    `
  });
}

export function renderGateDagHtml(gateDag, options = {}) {
  const requiredGates = gateDag.nodes.filter((node) => node.required);
  const unresolved = requiredGates.filter((node) => isUnresolvedStatus(node.status));
  const suppressedAxes = Array.isArray(gateDag.summary?.suppressed_judgment_axes)
    ? gateDag.summary.suppressed_judgment_axes
    : [];
  return renderDocument({
    title: 'VibePro Gate DAG',
    reportType: 'gate-dag',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    language: options.language ?? 'ja',
    body: `
      <section class="hero" data-overall-status="${escapeAttr(gateDag.overall_status)}">
        <div>
          <p class="eyebrow">Completion dependency map</p>
          <h2>${escapeHtml(gateDag.story_id)}</h2>
          <p class="muted">${escapeHtml(gateDag.model)}</p>
        </div>
        <span class="${statusClass(gateDag.overall_status)}">${escapeHtml(gateDag.overall_status)}</span>
      </section>
      <section class="metrics">
        ${metricCard('Acceptance', gateDag.summary.acceptance_criteria_count, 'criteria')}
        ${metricCard('Required Gates', gateDag.summary.required_gate_count, 'gates')}
        ${metricCard('Needs Evidence', gateDag.summary.needs_evidence_count, 'unresolved')}
        ${metricCard('Requirement', gateDag.summary.requirement_status, 'status')}
      </section>
      ${suppressedAxes.length > 0 ? renderCards('Suppressed Axis Candidates', suppressedAxes.map((axis) => ({
        title: `${axis.axis}[${axis.precision_status}]`,
        detail: axis.reason ?? '-',
        meta: (axis.candidates ?? []).length > 0 ? `candidates=${axis.candidates.join(', ')}` : null,
        tone: 'warn'
      }))) : ''}
      ${renderCards('Unresolved Gates', unresolved.map((node) => ({
        title: node.label ?? node.id,
        detail: node.reason ?? node.command ?? node.id,
        meta: `${node.id} / ${node.status}`,
        tone: toneForStatus(node.status)
      })))}
      <section>
        <h2>Visual DAG</h2>
        ${renderGateDagSvg(gateDag)}
      </section>
      <section>
        <h2>Gate Nodes</h2>
        ${renderNodeGrid(gateDag.nodes)}
      </section>
    `
  });
}

export function renderSplitPlanHtml(splitPlan, options = {}) {
  const lanePlans = new Map(splitPlan.stacked_gate_plan.lane_plans.map((lane) => [lane.lane_id, lane]));
  const laneBoard = splitPlan.lanes
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((lane) => renderLaneCard(lane, lanePlans.get(lane.id)))
    .join('');
  return renderDocument({
    title: 'VibePro PR Split Plan',
    reportType: 'split-plan',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    language: options.language ?? 'ja',
    body: `
      <section class="hero" data-split-status="${escapeAttr(splitPlan.status)}">
        <div>
          <p class="eyebrow">Review lane board</p>
          <h2>${escapeHtml(splitPlan.story_id)}</h2>
          <p class="muted">${escapeHtml(splitPlan.recommended_strategy)}</p>
        </div>
        <span class="${statusClass(splitPlan.status)}">${escapeHtml(splitPlan.status)}</span>
      </section>
      <section class="metrics">
        ${metricCard('Lanes', splitPlan.lanes.length, 'review lanes')}
        ${metricCard('Graphify', splitPlan.graph_context.available ? 'available' : 'missing', `${splitPlan.graph_context.related_file_count} related`)}
        ${metricCard('Cumulative Gates', splitPlan.stacked_gate_plan.summary.cumulative_gate_count, 'lanes')}
        ${metricCard('Final Validation', splitPlan.stacked_gate_plan.final_validation.required ? 'required' : 'not required', splitPlan.stacked_gate_plan.final_validation.trigger)}
      </section>
      <section>
        <h2>PR Lanes</h2>
        <div class="lane-board">${laneBoard}</div>
      </section>
      <section class="grid-2">
        <div>
          <h2>Merge Order</h2>
          ${renderOrderedList(splitPlan.merge_order)}
        </div>
        <div>
          <h2>Rationale</h2>
          ${renderList(splitPlan.rationale)}
        </div>
      </section>
      <section>
        <h2>Graphify Investigation Scope</h2>
        ${renderGraphImpactTable(splitPlan.graph_context.impact_by_file)}
      </section>
      <section>
        <h2>Next Actions</h2>
        ${renderCommandList(splitPlan.next_actions.map((action) => typeof action === 'string' ? action : action.command))}
      </section>
    `
  });
}

export function renderPrCreateHtml(execution, options = {}) {
  const results = execution.results.length === 0
    ? [{ command: 'dry-run', exit_code: 0, stdout: '', stderr: '' }]
    : execution.results;
  const language = options.language ?? execution.output?.language ?? 'ja';
  return renderDocument({
    title: 'VibePro PR Create',
    reportType: 'pr-create',
    generatedAt: execution.created_at,
    language,
    body: `
      <section class="hero" data-dry-run="${escapeAttr(String(execution.dry_run))}">
        <div>
          <p class="eyebrow">PR creation audit</p>
          <h2>${escapeHtml(execution.title)}</h2>
          <p class="muted">${escapeHtml(execution.base)} -> ${escapeHtml(execution.head)}</p>
        </div>
        <span class="${statusClass(execution.dry_run ? 'dry_run' : 'executed')}">${execution.dry_run ? 'dry-run' : 'executed'}</span>
      </section>
      <section class="metrics">
        ${metricCard('Story', execution.story.story_id, execution.task_context?.task?.id ?? 'no task')}
        ${metricCard('PR URL', execution.pr_url ?? '-', execution.dry_run ? 'not created' : 'created')}
        ${metricCard('Gate Override', execution.gate_override?.allowed ? 'allowed' : 'none', execution.gate_override?.reason ?? '-')}
        ${metricCard('Commands', execution.commands.length, 'planned')}
      </section>
      ${renderPrLifecycleFreshnessPanel(execution.artifact_freshness, language)}
      ${renderGateOverridePanel(execution.gate_override)}
      <section>
        <h2>Command Timeline</h2>
        <div class="timeline">
          ${results.map((item, index) => `
            <article class="timeline-item" data-command-index="${index}">
              <strong>${escapeHtml(item.command)}</strong>
              <span class="${statusClass(item.exit_code === 0 ? 'pass' : 'failed')}">exit=${escapeHtml(item.exit_code)}</span>
              ${item.stdout ? `<pre>${escapeHtml(item.stdout)}</pre>` : ''}
              ${item.stderr ? `<pre>${escapeHtml(item.stderr)}</pre>` : ''}
            </article>
          `).join('')}
        </div>
      </section>
      <section>
        <h2>Warnings</h2>
        ${renderList(execution.warnings.length > 0 ? execution.warnings : ['なし'])}
      </section>
    `
  });
}

export function renderPrMergeHtml(merge, options = {}) {
  const results = merge.results.length === 0
    ? [{ command: 'dry-run', exit_code: 0, stdout: '', stderr: '' }]
    : merge.results;
  const language = options.language ?? merge.output?.language ?? 'ja';
  return renderDocument({
    title: 'VibePro Execute Merge',
    reportType: 'pr-merge',
    generatedAt: merge.created_at,
    language,
    body: `
      <section class="hero" data-dry-run="${escapeAttr(String(merge.dry_run))}">
        <div>
          <p class="eyebrow">PR merge audit</p>
          <h2>${escapeHtml(merge.story?.story_id ?? '-')}</h2>
          <p class="muted">${escapeHtml(merge.pr?.url ?? merge.pr?.selector ?? '-')}</p>
        </div>
        <span class="${statusClass(merge.status)}">${escapeHtml(merge.status)}</span>
      </section>
      <section class="metrics">
        ${metricCard('Strategy', merge.strategy, merge.delete_branch ? 'delete branch' : 'keep branch')}
        ${metricCard('Base', merge.base ?? '-', merge.pr?.base_ref_name ?? '-')}
        ${metricCard('Merge commit', merge.merge_commit_sha ?? '-', merge.merged_at ?? 'not merged')}
        ${metricCard('Checks', merge.pr?.checks?.length ?? 0, merge.preconditions?.checks_ready?.status ?? '-')}
      </section>
      ${renderPrLifecycleFreshnessPanel(merge.artifact_freshness, language)}
      <section class="grid-2">
        <div>
          <h2>Preconditions</h2>
          ${renderList([
            `gate_ready: ${merge.preconditions?.gate_ready ? 'passed' : 'blocked'}`,
            `clean_worktree: ${merge.preconditions?.clean_worktree ? 'passed' : 'blocked'}`,
            `base_freshness: ${merge.preconditions?.base_freshness?.status ?? '-'}`,
            `remote_head_match: ${merge.preconditions?.remote_head_match?.status ?? '-'}`,
            `checks_ready: ${merge.preconditions?.checks_ready?.status ?? '-'}`,
            `review_policy: ${merge.preconditions?.review_policy?.status ?? '-'}`,
            `open_pull_request: ${merge.preconditions?.open_pull_request?.status ?? '-'}`
          ])}
        </div>
        <div>
          <h2>Warnings</h2>
          ${renderList(merge.warnings?.length ? merge.warnings : ['なし'])}
        </div>
      </section>
      <section>
        <h2>Check Rollup</h2>
        ${renderList((merge.pr?.checks ?? []).map((check) => `${check.name}: ${check.status}/${check.conclusion || '-'}`))}
      </section>
      <section>
        <h2>Command Timeline</h2>
        <div class="timeline">
          ${results.map((item, index) => `
            <article class="timeline-item" data-command-index="${index}">
              <strong>${escapeHtml(item.command)}</strong>
              <span class="${statusClass(item.exit_code === 0 ? 'pass' : 'failed')}">exit=${escapeHtml(item.exit_code)}</span>
              ${item.stdout ? `<pre>${escapeHtml(item.stdout)}</pre>` : ''}
              ${item.stderr ? `<pre>${escapeHtml(item.stderr)}</pre>` : ''}
            </article>
          `).join('')}
        </div>
      </section>
    `
  });
}

function renderPrLifecycleArtifactsPanel(lifecycleArtifacts, language) {
  if (!lifecycleArtifacts) return '';
  const artifacts = Array.isArray(lifecycleArtifacts.artifacts) ? lifecycleArtifacts.artifacts : [];
  const title = localizedText(language, { ja: 'PR lifecycle artifact の鮮度', en: 'PR Lifecycle Artifact Freshness' });
  const rows = artifacts.map((artifact) => [
    artifact.kind ?? '-',
    artifact.status ?? '-',
    artifact.artifact ?? '-',
    shortenSha(artifact.artifact_head_sha),
    shortenSha(artifact.current_head_sha ?? lifecycleArtifacts.current_head_sha),
    artifact.reason ?? '-'
  ]);
  return `
    <section>
      <h2>${escapeHtml(title)}</h2>
      <p class="muted">${escapeHtml(localizedText(language, {
        ja: `全体: ${lifecycleArtifacts.status ?? 'unknown'}。古い pr-create / pr-merge を最新の証跡として扱わないための HEAD 照合です。`,
        en: `Overall: ${lifecycleArtifacts.status ?? 'unknown'}. HEAD binding prevents stale pr-create / pr-merge artifacts from looking current.`
      }))}</p>
      ${renderTable([
        'Kind',
        'Status',
        'Artifact',
        'Artifact HEAD',
        'Current HEAD',
        'Reason'
      ], rows.length > 0 ? rows : [['-', 'missing', '-', '-', '-', 'No lifecycle artifacts found']])}
    </section>
  `;
}

function renderPrLifecycleFreshnessPanel(freshness, language) {
  if (!freshness) return '';
  return `
    <section>
      <h2>${escapeHtml(localizedText(language, { ja: 'Artifact Freshness', en: 'Artifact Freshness' }))}</h2>
      <div class="cards">
        <article class="card ${escapeAttr(toneForStatus(freshness.status))}">
          <h3>${escapeHtml(freshness.kind ?? 'lifecycle_artifact')}</h3>
          <p class="muted">${escapeHtml(freshness.status ?? 'unknown')}</p>
          <p>${escapeHtml(freshness.reason ?? '-')}</p>
        </article>
      </div>
      ${renderKeyValueTable([
        ['Artifact HEAD', shortenSha(freshness.artifact_head_sha)],
        ['Current HEAD', shortenSha(freshness.current_head_sha)],
        ['Checked At', freshness.checked_at ?? '-']
      ])}
    </section>
  `;
}

function shortenSha(value) {
  return typeof value === 'string' && value.length > 12 ? value.slice(0, 12) : (value ?? '-');
}

function renderPrPrepareGuide({ preparation, bodyPath, gateDagPath, splitPlanPath, language }) {
  const gateDag = preparation.pr_context.gate_dag;
  const requirement = preparation.pr_context.requirement_consistency;
  const requirementHint = buildRequirementGuide(requirement, language);
  const unresolved = gateDag.summary?.needs_evidence_count ?? 0;
  const agentHandoff = [
    bodyPath,
    gateDagPath,
    splitPlanPath
  ].filter(Boolean).join(' / ');
  return `
    <section>
      <h2>${escapeHtml(localizedText(language, { ja: 'まず見る場所', en: 'Where To Look First' }))}</h2>
      <div class="cards">
        <article class="card ${escapeAttr(unresolved > 0 ? 'warn' : 'good')}">
          <h3>${escapeHtml(localizedText(language, { ja: '1. Gateの未解決', en: '1. Gate blockers' }))}</h3>
          <p>${escapeHtml(localizedText(language, {
            ja: unresolved > 0
              ? `${unresolved}件の未解決Gateがあります。Execution GateとUnresolved Gatesから先に確認してください。`
              : '未解決Gateはありません。PR作成前にscopeとbranchだけ確認してください。',
            en: unresolved > 0
              ? `${unresolved} unresolved gate(s). Start from Execution Gate and Unresolved Gates.`
              : 'No unresolved gates. Check scope and branch before PR creation.'
          }))}</p>
        </article>
        <article class="card info">
          <h3>${escapeHtml(localizedText(language, { ja: '2. AIエージェントへの渡し方', en: '2. Agent handoff' }))}</h3>
          <p>${escapeHtml(localizedText(language, {
            ja: `実装エージェントには ${agentHandoff} を渡してください。pr-body.mdが要約、gate-dagが完了条件、split-planがPR分割方針です。`,
            en: `Hand ${agentHandoff} to the coding agent. pr-body.md is the summary, gate-dag is the completion contract, and split-plan is the PR split guide.`
          }))}</p>
        </article>
        <article class="card ${escapeAttr(requirementHint.tone)}">
          <h3>${escapeHtml(localizedText(language, { ja: '3. Requirement Consistency', en: '3. Requirement Consistency' }))}</h3>
          <p>${escapeHtml(requirementHint.text)}</p>
        </article>
      </div>
    </section>
  `;
}

function prPrepareLabels(language) {
  return {
    eyebrow: localizedText(language, {
      ja: 'StoryからPR前確認までのレビュー成果物',
      en: 'Story-driven review artifact'
    }),
    scope: localizedText(language, { ja: 'スコープ', en: 'Scope' }),
    executionGate: localizedText(language, { ja: '実行Gate', en: 'Execution Gate' }),
    agentReviews: localizedText(language, { ja: 'Agent Review', en: 'Agent Reviews' }),
    requirement: localizedText(language, { ja: '要件整合性', en: 'Requirement' }),
    splitPlan: localizedText(language, { ja: '分割計画', en: 'Split Plan' }),
    prCreateAllowed: localizedText(language, { ja: 'PR作成可能', en: 'pr create allowed' }),
    prCreateBlocked: localizedText(language, { ja: 'PR作成ブロック', en: 'pr create blocked' }),
    story: localizedText(language, { ja: 'Story', en: 'Story' }),
    architecture: localizedText(language, { ja: 'Architecture', en: 'Architecture' }),
    spec: localizedText(language, { ja: 'Spec', en: 'Spec' }),
    code: localizedText(language, { ja: 'Code', en: 'Code' }),
    gates: localizedText(language, { ja: 'Gate', en: 'Gates' }),
    flowTitle: localizedText(language, {
      ja: 'Story -> Architecture -> Spec -> Code -> Gate',
      en: 'Story -> Architecture -> Spec -> Code -> Gate'
    }),
    graphifyImpact: localizedText(language, { ja: 'Graphify影響範囲', en: 'Graphify Impact' }),
    changedFileGroups: localizedText(language, { ja: '変更ファイル分類', en: 'Changed File Groups' })
  };
}

function renderDocument({ title, reportType, generatedAt, body, language = 'ja' }) {
  return trimTrailingWhitespace(`<!doctype html>
<html lang="${escapeAttr(language)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${baseCss()}</style>
</head>
<body>
  <main data-vibepro-report="${escapeAttr(reportType)}">
    <header class="topbar">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p class="meta">Generated by VibePro at ${escapeHtml(generatedAt)}</p>
      </div>
      <span class="brand">VibePro</span>
    </header>
    ${body}
  </main>
</body>
</html>
`);
}

function trimTrailingWhitespace(html) {
  return html
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
}

function baseCss() {
  return `
    :root {
      color-scheme: light dark;
      --bg: #f6f7f9;
      --fg: #14171f;
      --muted: #667085;
      --panel: #ffffff;
      --panel-2: #f0f3f8;
      --border: #d7dee8;
      --good: #0f766e;
      --warn: #a16207;
      --danger: #b42318;
      --info: #1d4ed8;
      --neutral: #475467;
      --code: #eef2f7;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0b1220;
        --fg: #e8edf5;
        --muted: #9aa8bc;
        --panel: #101827;
        --panel-2: #172235;
        --border: #2d3a4f;
        --code: #1d2939;
      }
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(1220px, calc(100% - 24px)); margin: 16px auto 40px; }
    .topbar, section, article.card, .lane, .timeline-item {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    .topbar { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 18px 20px; margin-bottom: 12px; }
    .brand { font-weight: 700; color: var(--info); }
    section { padding: 18px; margin: 12px 0; }
    h1, h2, h3 { margin: 0 0 10px; line-height: 1.25; letter-spacing: 0; }
    h1 { font-size: 24px; }
    h2 { font-size: 18px; }
    h3 { font-size: 15px; }
    .meta, .muted, .eyebrow { color: var(--muted); }
    .meta, .eyebrow { margin: 0; font-size: 12px; }
    .eyebrow { text-transform: uppercase; letter-spacing: 0.08em; }
    .hero { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; }
    .hero h2 { font-size: 22px; margin: 4px 0; }
    .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; background: transparent; border: 0; padding: 0; }
    .metric { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px; min-height: 92px; }
    .metric span { display: block; color: var(--muted); font-size: 12px; }
    .metric strong { display: block; margin: 6px 0; font-size: 20px; overflow-wrap: anywhere; }
    .grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; background: transparent; border: 0; padding: 0; }
    .flow { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
    .flow-step { position: relative; padding: 14px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; min-height: 110px; overflow-wrap: anywhere; }
    .flow-step:not(:last-child)::after { content: "->"; position: absolute; right: -12px; top: 44px; color: var(--muted); }
    .cards, .node-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .card { padding: 14px; overflow-wrap: anywhere; }
    .card p { margin: 6px 0 0; }
    .lane-board { display: grid; grid-template-columns: repeat(4, minmax(240px, 1fr)); gap: 10px; overflow-x: auto; }
    .lane { padding: 14px; min-width: 240px; }
    .lane ul, .card ul { padding-left: 18px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; overflow-wrap: anywhere; }
    th, td { border: 1px solid var(--border); padding: 8px; text-align: left; vertical-align: top; }
    th { background: var(--panel-2); }
    code, pre { background: var(--code); border-radius: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    code { padding: 0.1rem 0.3rem; }
    pre { padding: 10px; overflow: auto; white-space: pre-wrap; }
    .timeline { display: grid; gap: 10px; }
    .timeline-item { padding: 12px; }
    .status { display: inline-block; border-radius: 999px; padding: 4px 10px; font-weight: 700; font-size: 12px; border: 1px solid currentColor; }
    .good { color: var(--good); }
    .warn { color: var(--warn); }
    .danger { color: var(--danger); }
    .info { color: var(--info); }
    .neutral { color: var(--neutral); }
    .dag-svg { width: 100%; height: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--panel-2); }
    .dag-node { fill: var(--panel); stroke: var(--border); }
    .dag-text { fill: var(--fg); font: 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .dag-edge { stroke: var(--muted); stroke-width: 1.5; marker-end: url(#arrow); }
    @media (max-width: 860px) {
      .metrics, .grid-2, .flow, .cards, .node-grid { grid-template-columns: 1fr; }
      .flow-step:not(:last-child)::after { display: none; }
      .hero, .topbar { flex-direction: column; }
    }
  `;
}

function metricCard(label, value, detail) {
  return `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><span>${escapeHtml(detail)}</span></article>`;
}

function renderFlow(steps) {
  return `<div class="flow">${steps.map((step) => `
    <article class="flow-step" data-flow-step="${escapeAttr(step.label)}">
      <h3>${escapeHtml(step.label)}</h3>
      <p>${escapeHtml(step.detail)}</p>
      <span class="${statusClass(step.status)}">${escapeHtml(step.status)}</span>
    </article>
  `).join('')}</div>`;
}

function flowStep(label, detail, status) {
  return { label, detail, status };
}

function renderCards(title, cards) {
  const visible = cards.length > 0 ? cards : [{ title: 'No items', detail: 'なし', tone: 'neutral' }];
  return `
    <section>
      <h2>${escapeHtml(title)}</h2>
      <div class="cards">
        ${visible.map((card) => `
          <article class="card ${escapeAttr(card.tone ?? 'neutral')}">
            <h3>${escapeHtml(card.title)}</h3>
            ${card.meta ? `<p class="muted">${escapeHtml(card.meta)}</p>` : ''}
            <p>${escapeHtml(card.detail)}</p>
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function renderEngineeringJudgmentPanel(engineeringJudgment, gateDag, language = 'ja') {
  if (!engineeringJudgment) {
    return renderCards('Engineering Judgment', [{
      title: localizedText(language, { ja: '未分類', en: 'Not classified' }),
      detail: localizedText(language, {
        ja: 'Engineering Judgmentは未生成です。Gate DAGとPR本文を再生成してください。',
        en: 'Engineering Judgment was not generated. Regenerate Gate DAG and PR body.'
      }),
      tone: 'warn'
    }]);
  }
  const axes = (engineeringJudgment.judgment_axes ?? []).filter((axis) => axis.status !== 'inactive');
  const suppressedAxes = (engineeringJudgment.judgment_axes ?? [])
    .filter((axis) => axis.status === 'inactive' && (axis.activation_candidates?.length ?? 0) > 0);
  const acceptedFollowups = axes.filter((axis) => axis.status === 'active_accepted_followup');
  const axisCards = axes.slice(0, 8).map((axis) => {
    const gate = gateDag?.nodes?.find((node) => node.id === `gate:judgment_axis_${axis.axis}`);
    const required = axis.required_evidence?.join(', ') || '-';
    const missing = axis.missing_evidence?.length > 0 ? ` missing=${axis.missing_evidence.join(', ')}` : '';
    const matched = axis.matched_evidence?.length > 0
      ? ` matched=${axis.matched_evidence.map(formatEvidenceReferenceForHuman).join(', ')}`
      : '';
    return {
      title: `${axis.axis}: ${axis.status}`,
      detail: `${axis.decision_question ?? localizedText(language, { ja: '判断質問なし', en: 'No decision question' })} / required=${required}${matched}${missing}`,
      meta: `gate=${gate?.status ?? '-'}; confidence=${Math.round((axis.confidence ?? 0) * 100)}%`,
      tone: toneForStatus(axis.status)
    };
  });
  const suppressedCards = suppressedAxes.slice(0, 8).map((axis) => ({
    title: `${axis.axis}: suppressed`,
    detail: `candidates=${(axis.activation_candidates ?? []).join(', ')} / precision=${axis.activation_precision?.status ?? 'inactive'}:${axis.activation_precision?.reason ?? '-'}`,
    meta: localizedText(language, { ja: 'precision filterでinactive', en: 'suppressed by precision filter' }),
    tone: 'warn'
  }));
  return `
    <section>
      <h2>Engineering Judgment</h2>
      <div class="metrics">
        ${metricCard('Route', engineeringJudgment.route_type ?? '-', engineeringJudgment.route_dag ?? '-')}
        ${metricCard(localizedText(language, { ja: 'Active Axes', en: 'Active Axes' }), axes.length, 'senior first scan')}
        ${metricCard(localizedText(language, { ja: 'Suppressed Axes', en: 'Suppressed Axes' }), suppressedAxes.length, localizedText(language, { ja: 'precision filtered', en: 'precision filtered' }))}
        ${metricCard('accepted_followup', acceptedFollowups.length, localizedText(language, { ja: 'passedではない後続許容', en: 'accepted but not passed' }))}
        ${metricCard('Confidence', typeof engineeringJudgment.confidence === 'number' ? `${Math.round(engineeringJudgment.confidence * 100)}%` : '-', 'classifier')}
      </div>
      <div class="cards">${([...(axisCards.length > 0 ? axisCards : [{
        title: localizedText(language, { ja: 'Active axisなし', en: 'No active axis' }),
        detail: localizedText(language, {
          ja: 'general engineeringとして既存Gateを確認します。',
          en: 'Existing gates are used as the general engineering contract.'
        }),
        tone: 'neutral'
      }]), ...suppressedCards]).map((card) => `
        <article class="card ${escapeAttr(card.tone)}">
          <h3>${escapeHtml(card.title)}</h3>
          ${card.meta ? `<p class="muted">${escapeHtml(card.meta)}</p>` : ''}
          <p>${escapeHtml(card.detail)}</p>
        </article>
      `).join('')}</div>
    </section>
  `;
}

function formatEvidenceReferenceForHuman(item) {
  const base = `${item.kind}:${item.ref}`;
  return item.artifact ? `${base} (artifact=${item.artifact})` : base;
}

function renderRequirementPanel(requirement, language = 'ja') {
  if (!requirement) {
    return renderCards('Requirement Consistency', [{
      title: localizedText(language, { ja: '未生成', en: 'Not generated' }),
      detail: buildRequirementGuide(requirement, language).text,
      tone: 'warn'
    }]);
  }
  const guide = buildRequirementGuide(requirement, language);
  const cards = [
    ...(requirement.contradictions ?? []).slice(0, 6).map((item) => ({
      title: item.title ?? 'Potential Contradiction',
      detail: item.detail,
      meta: item.id,
      tone: 'danger'
    })),
    ...(requirement.scenario_gaps ?? []).slice(0, 6).map((item) => ({
      title: item.title ?? 'Scenario Gap',
      detail: item.detail,
      meta: item.id,
      tone: 'warn'
    })),
    ...(requirement.invariants ?? []).slice(0, 4).map((item) => ({
      title: 'Invariant',
      detail: item.text,
      meta: item.source ? `${item.source.kind}:${item.source.path ?? '-'}` : item.id,
      tone: 'info'
    }))
  ];
  return `
    <section>
      <h2>Requirement Consistency</h2>
      <div class="metrics">
        ${metricCard('Status', requirement.status, 'requirement gate')}
        ${metricCard('Invariants', requirement.summary?.invariant_count ?? 0, 'extracted')}
        ${metricCard('Scenario Gaps', requirement.summary?.scenario_gap_count ?? 0, 'needs review')}
        ${metricCard('Contradictions', requirement.summary?.contradiction_count ?? 0, 'potential bugs')}
      </div>
      <article class="card ${escapeAttr(guide.tone)}">
        <h3>${escapeHtml(localizedText(language, { ja: '次に足すもの', en: 'What To Add Next' }))}</h3>
        <p>${escapeHtml(guide.text)}</p>
      </article>
      <div class="cards">${cards.map((card) => `
        <article class="card ${escapeAttr(card.tone)}">
          <h3>${escapeHtml(card.title)}</h3>
          <p class="muted">${escapeHtml(card.meta ?? '')}</p>
          <p>${escapeHtml(card.detail)}</p>
        </article>
      `).join('') || '<article class="card good"><h3>No findings</h3><p>Story / Architecture / Spec とコード差分の既知矛盾は検出されていません。</p></article>'}</div>
    </section>
  `;
}

function buildRequirementGuide(requirement, language = 'ja') {
  if (!requirement) {
    return {
      tone: 'warn',
      text: localizedText(language, {
        ja: 'Requirement Consistencyは未生成です。まずStoryに受け入れ基準を置き、必要に応じてSpec/Architectureを追加してから `vibepro pr prepare` を再実行してください。',
        en: 'Requirement Consistency was not generated. Add Story acceptance criteria, then add Spec/Architecture when needed, and rerun `vibepro pr prepare`.'
      })
    };
  }
  if (requirement.status === 'not_applicable') {
    return {
      tone: 'warn',
      text: localizedText(language, {
        ja: 'Story/Spec/Architectureから判定に使える不変条件が十分に取れていません。Storyに受け入れ基準、Specに守るべき挙動、Architectureに境界やADR要否を書くと、このGateが有効になります。',
        en: 'VibePro could not extract enough invariants from Story/Spec/Architecture. Add acceptance criteria to the Story, behavioral invariants to the Spec, and boundary/ADR notes to Architecture to activate this gate.'
      })
    };
  }
  if (requirement.status === 'needs_review') {
    return {
      tone: 'warn',
      text: localizedText(language, {
        ja: 'Storyに明示されていないシナリオがあります。意図した挙動ならStory/Specへ追記し、意図しないなら実装かテストを直してください。',
        en: 'Some scenarios are not explicit in the Story. If intended, add them to Story/Spec; otherwise fix the implementation or tests.'
      })
    };
  }
  if (requirement.status === 'contradicted') {
    return {
      tone: 'danger',
      text: localizedText(language, {
        ja: 'Story/Spec/Architectureと実装の矛盾候補があります。PR前に矛盾を解消し、必要ならSpecを更新してください。',
        en: 'Potential contradictions exist between Story/Spec/Architecture and implementation. Resolve them before PR and update Spec when needed.'
      })
    };
  }
  return {
    tone: 'good',
    text: localizedText(language, {
      ja: 'Story/Spec/Architectureと既知の実装分岐に明確な矛盾はありません。',
      en: 'No clear contradiction was found between Story/Spec/Architecture and known implementation branches.'
    })
  };
}

function renderExecutionGatePanel(executionGate, language = 'ja') {
  if (!executionGate) {
    return renderCards(localizedText(language, { ja: '実行Gate', en: 'Execution Gate' }), [{
      title: localizedText(language, { ja: '未生成', en: 'Unknown' }),
      detail: localizedText(language, { ja: 'Execution Gateは未生成です。', en: 'Execution Gate was not generated.' }),
      tone: 'warn'
    }]);
  }
  const cards = executionGate.blocking_gates?.length > 0
    ? executionGate.blocking_gates.map((gate) => ({
      title: `${gate.label ?? gate.id}: ${gate.status}`,
      detail: gate.reason ?? gate.command ?? gate.id,
      meta: gate.id,
      tone: 'danger'
    }))
    : [{
      title: localizedText(language, { ja: '準備完了', en: 'Ready' }),
      detail: localizedText(language, {
        ja: 'VibePro PR作成に対するCritical blockerは解消されています。',
        en: 'Critical blockers are resolved for VibePro PR creation.'
      }),
      tone: 'good'
    }];
  const actions = executionGate.required_actions?.length > 0
    ? renderList(executionGate.required_actions)
    : `<p class="muted">${escapeHtml(localizedText(language, { ja: 'ブロック中の対応はありません。', en: 'No blocking actions.' }))}</p>`;
  return `
    <section>
      <h2>${escapeHtml(localizedText(language, { ja: '実行Gate', en: 'Execution Gate' }))}</h2>
      <div class="metrics">
        ${metricCard(localizedText(language, { ja: '状態', en: 'Status' }), executionGate.status, executionGate.pr_create_allowed ? localizedText(language, { ja: 'PR作成可能', en: 'pr create allowed' }) : localizedText(language, { ja: 'PR作成ブロック', en: 'pr create blocked' }))}
        ${metricCard(localizedText(language, { ja: 'Blocking Gate', en: 'Blocking Gates' }), executionGate.blocking_gate_count ?? 0, 'critical')}
        ${metricCard(localizedText(language, { ja: 'PR作成', en: 'PR Create' }), executionGate.pr_create_allowed ? localizedText(language, { ja: 'allowed', en: 'allowed' }) : localizedText(language, { ja: 'blocked', en: 'blocked' }), 'VibePro gate')}
        ${metricCard('Schema', executionGate.schema_version ?? '-', 'execution gate')}
      </div>
      <div class="cards">${cards.map((card) => `
        <article class="card ${escapeAttr(card.tone)}">
          <h3>${escapeHtml(card.title)}</h3>
          ${card.meta ? `<p class="muted">${escapeHtml(card.meta)}</p>` : ''}
          <p>${escapeHtml(card.detail)}</p>
        </article>
      `).join('')}</div>
      <h3>${escapeHtml(localizedText(language, { ja: '必要な対応', en: 'Required Actions' }))}</h3>
      ${actions}
    </section>
  `;
}

function renderAgentReviewPanel(agentReviews, language = 'ja') {
  if (!agentReviews) {
    return renderCards(localizedText(language, { ja: 'Agent Review Gate', en: 'Agent Review Gate' }), [{
      title: localizedText(language, { ja: '未生成', en: 'Not generated' }),
      detail: localizedText(language, { ja: 'Agent Reviewは未生成です。', en: 'Agent Review was not generated.' }),
      tone: 'warn'
    }]);
  }
  const unmet = agentReviews.unmet_required_reviews ?? [];
  const checkpointUnmet = agentReviews.unmet_checkpoint_reviews ?? [];
  const stageCards = (agentReviews.stages ?? []).map((stage) => ({
    title: `${stage.stage}: ${stage.status}`,
    detail: `pass=${stage.pass_count}, missing=${stage.missing_count}, stale=${stage.stale_count}, block=${stage.block_count}`,
    meta: stage.stage,
    tone: toneForStatus(stage.status)
  }));
  const unmetCards = unmet.slice(0, 8).map((item) => ({
    title: `PR-final ${item.stage}:${item.role}`,
    detail: item.detail ?? item.reason,
    meta: `${item.status} / ${item.policy}`,
    tone: item.status === 'block' ? 'danger' : 'warn'
  }));
  const checkpointCards = checkpointUnmet.slice(0, 8).map((item) => ({
    title: `Checkpoint ${item.stage}:${item.role}`,
    detail: item.detail ?? item.reason,
    meta: `${item.status} / ${item.policy}`,
    tone: item.status === 'block' ? 'danger' : 'warn'
  }));
  const allUnmetCards = [...unmetCards, ...checkpointCards];
  return `
    <section>
      <h2>${escapeHtml(localizedText(language, { ja: 'Agent Review Gate', en: 'Agent Review Gate' }))}</h2>
      <div class="metrics">
        ${metricCard(localizedText(language, { ja: '状態', en: 'Status' }), agentReviews.status, agentReviews.required ? localizedText(language, { ja: 'required', en: 'required' }) : localizedText(language, { ja: 'not required', en: 'not required' }))}
        ${metricCard(localizedText(language, { ja: '必須ロール', en: 'Required Roles' }), agentReviews.summary?.required_review_count ?? 0, 'policy')}
        ${metricCard(localizedText(language, { ja: '未充足ロール', en: 'Unmet Roles' }), agentReviews.summary?.unmet_required_review_count ?? 0, 'missing/stale/block')}
        ${metricCard(localizedText(language, { ja: 'Checkpoint未充足', en: 'Checkpoint Unmet' }), agentReviews.summary?.unmet_checkpoint_review_count ?? 0, 'checkpoint')}
        ${metricCard(localizedText(language, { ja: '古い結果', en: 'Stale Results' }), agentReviews.summary?.stale_result_count ?? 0, 'current git binding')}
      </div>
      <h3>${escapeHtml(localizedText(language, { ja: '未充足の必須レビュー', en: 'Unmet Required Reviews' }))}</h3>
      <div class="cards">${(allUnmetCards.length > 0 ? allUnmetCards : [{
        title: localizedText(language, { ja: '未充足レビューなし', en: 'No unmet reviews' }),
        detail: localizedText(language, {
          ja: '現在のgit状態に対するPR-final/checkpoint agent review roleは通過しています。',
          en: 'PR-final and checkpoint agent review roles passed for the current git state.'
        }),
        tone: 'good'
      }]).map((card) => `
        <article class="card ${escapeAttr(card.tone)}">
          <h3>${escapeHtml(card.title)}</h3>
          ${card.meta ? `<p class="muted">${escapeHtml(card.meta)}</p>` : ''}
          <p>${escapeHtml(card.detail)}</p>
        </article>
      `).join('')}</div>
      <h3>${escapeHtml(localizedText(language, { ja: 'ステージ概要', en: 'Stage Summary' }))}</h3>
      <div class="cards">${(stageCards.length > 0 ? stageCards : [{
        title: localizedText(language, { ja: 'ステージなし', en: 'No stages' }),
        detail: localizedText(language, { ja: 'Agent review stageは記録されていません。', en: 'No agent review stages recorded.' }),
        tone: 'neutral'
      }]).map((card) => `
        <article class="card ${escapeAttr(card.tone)}">
          <h3>${escapeHtml(card.title)}</h3>
          ${card.meta ? `<p class="muted">${escapeHtml(card.meta)}</p>` : ''}
          <p>${escapeHtml(card.detail)}</p>
        </article>
      `).join('')}</div>
    </section>
  `;
}

function renderNetworkContractPanel(networkContracts, language = 'ja') {
  if (!networkContracts) {
    return renderCards(localizedText(language, { ja: 'Network Contract検出', en: 'Network Contract Findings' }), [{
      title: localizedText(language, { ja: '未生成', en: 'Not generated' }),
      detail: localizedText(language, { ja: 'Network Contractは未生成です。', en: 'Network Contract was not generated.' }),
      tone: 'warn'
    }]);
  }
  const missing = networkContracts.missing_routes ?? [];
  const dynamic = networkContracts.dynamic_calls ?? [];
  const replacements = networkContracts.high_risk_replacements ?? [];
  const cards = [
    ...missing.slice(0, 8).map((item) => ({
      title: `Missing route: ${item.api_path}`,
      detail: `${item.method ?? '-'} ${item.callee ?? '-'} in ${item.file}:${item.line ?? '-'}`,
      meta: item.cause_candidates?.map((candidate) => candidate.commit).join('; ') ?? '',
      tone: 'danger'
    })),
    ...replacements.slice(0, 6).map((item) => ({
      title: 'Server function replaced by API',
      detail: `${item.file}: ${item.removed_calls.join(', ')} -> ${item.introduced_api_calls.map((call) => call.api_path.value).join(', ')}`,
      meta: item.risk,
      tone: 'warn'
    })),
    ...dynamic.slice(0, 6).map((item) => ({
      title: `Dynamic API path: ${item.api_path}`,
      detail: `${item.callee ?? '-'} in ${item.file}:${item.line ?? '-'}`,
      meta: 'route cannot be proven statically',
      tone: 'warn'
    }))
  ];
  return `
    <section>
      <h2>${escapeHtml(localizedText(language, { ja: 'Network Contract検出', en: 'Network Contract Findings' }))}</h2>
      <div class="metrics">
        ${metricCard(localizedText(language, { ja: '状態', en: 'Status' }), networkContracts.status, 'route contract')}
        ${metricCard(localizedText(language, { ja: 'API呼び出し', en: 'API Calls' }), networkContracts.api_client_call_count ?? 0, 'detected')}
        ${metricCard(localizedText(language, { ja: 'Route不足', en: 'Missing Routes' }), missing.length, 'block')}
        ${metricCard(localizedText(language, { ja: '新規呼び出し', en: 'Introduced Calls' }), networkContracts.introduced_api_client_call_count ?? 0, 'diff')}
      </div>
      <div class="cards">${cards.map((card) => `
        <article class="card ${escapeAttr(card.tone)}">
          <h3>${escapeHtml(card.title)}</h3>
          <p class="muted">${escapeHtml(card.meta ?? '')}</p>
          <p>${escapeHtml(card.detail)}</p>
        </article>
      `).join('') || `<article class="card good"><h3>${escapeHtml(localizedText(language, { ja: '検出なし', en: 'No findings' }))}</h3><p>${escapeHtml(localizedText(language, { ja: 'API client callとroute fileは整合しています。', en: 'API client calls and route files are aligned.' }))}</p></article>`}</div>
    </section>
  `;
}

function renderFileGroups(fileGroups, language = 'ja') {
  const rows = Object.entries(fileGroups)
    .filter(([, group]) => group.count > 0)
    .map(([name, group]) => [name, group.count, group.files.slice(0, 10).join('<br>')]);
  return renderTable([
    localizedText(language, { ja: '分類', en: 'Group' }),
    localizedText(language, { ja: '件数', en: 'Count' }),
    localizedText(language, { ja: 'ファイル', en: 'Files' })
  ], rows.length > 0 ? rows : [['-', 0, '-']]);
}

function renderGraphSummary(graphContext, language = 'ja') {
  return `
    <div class="metrics">
      ${metricCard('Graph', graphContext.available ? 'available' : 'missing', graphContext.graph_path ?? '-')}
      ${metricCard(localizedText(language, { ja: '一致ファイル', en: 'Matched Files' }), graphContext.matched_file_count, localizedText(language, { ja: '変更ファイル', en: 'changed files' }))}
      ${metricCard(localizedText(language, { ja: '関連ファイル', en: 'Related Files' }), graphContext.related_file_count, localizedText(language, { ja: '確認候補', en: 'inspect candidates' }))}
      ${metricCard(localizedText(language, { ja: 'Graphサイズ', en: 'Graph Size' }), `${graphContext.node_count}/${graphContext.edge_count}`, 'nodes / edges')}
    </div>
    ${graphContext.available ? renderGraphImpactTable(graphContext.impact_by_file.slice(0, 8), language) : `<p class="muted">${escapeHtml(graphContext.reason)}</p>`}
  `;
}

function renderGraphImpactTable(items, language = 'ja') {
  const rows = items.map((item) => [
    item.file,
    item.matched_nodes.join('<br>') || '-',
    item.related_files.join('<br>') || '-'
  ]);
  return renderTable([
    localizedText(language, { ja: '変更ファイル', en: 'Changed file' }),
    localizedText(language, { ja: '一致したgraph node', en: 'Matched graph nodes' }),
    localizedText(language, { ja: '確認する関連ファイル', en: 'Related files to inspect' })
  ], rows.length > 0 ? rows : [['-', '-', '-']]);
}

function renderKeyValueTable(rows) {
  return renderTable(['Item', 'Value'], rows);
}

function renderTable(headers, rows) {
  return `
    <table>
      <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderCell(cell)}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>
  `;
}

function renderCell(value) {
  return escapeHtml(value).replace(/&lt;br&gt;/g, '<br>');
}

function renderList(items) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderOrderedList(items) {
  return `<ol>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>`;
}

function renderCommandList(commands) {
  return `<div>${commands.map((command) => `<p><code>${escapeHtml(command)}</code></p>`).join('')}</div>`;
}

function renderGateDagSvg(gateDag) {
  const nodes = gateDag.nodes;
  const positions = new Map();
  const layers = [
    nodes.filter((node) => node.id === 'story'),
    nodes.filter((node) => ['architecture', 'spec'].includes(node.id) || node.type === 'acceptance_criterion'),
    nodes.filter((node) => node.id === 'code'),
    nodes.filter((node) => node.id.startsWith('gate:') && node.id !== 'gate:agent_review'),
    nodes.filter((node) => node.type === 'agent_review_dispatch_batch_gate'),
    nodes.filter((node) => node.type === 'agent_review_dispatch_preflight_gate'),
    nodes.filter((node) => node.type === 'agent_review_prepare_gate'),
    nodes.filter((node) => node.type === 'agent_review_role_gate'),
    nodes.filter((node) => node.type === 'agent_review_record_gate'),
    nodes.filter((node) => node.type === 'agent_review_stage_join_gate'),
    nodes.filter((node) => node.id === 'gate:agent_review'),
    nodes.filter((node) => node.id === 'pr')
  ];
  const width = 1120;
  const columnWidth = width / layers.length;
  const maxRows = Math.max(...layers.map((layer) => layer.length), 1);
  const height = Math.max(300, maxRows * 82 + 40);
  layers.forEach((layer, column) => {
    const gap = height / (layer.length + 1);
    layer.forEach((node, row) => {
      positions.set(node.id, { x: 24 + column * columnWidth, y: Math.round(gap * (row + 1)) });
    });
  });
  const edges = gateDag.edges
    .filter((edge) => positions.has(edge.from) && positions.has(edge.to))
    .map((edge) => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      return `<line class="dag-edge" x1="${from.x + 170}" y1="${from.y + 24}" x2="${to.x}" y2="${to.y + 24}"></line>`;
    })
    .join('');
  const boxes = nodes.map((node) => {
    const pos = positions.get(node.id);
    if (!pos) return '';
    return `
      <g data-node-id="${escapeAttr(node.id)}">
        <rect class="dag-node" x="${pos.x}" y="${pos.y}" width="170" height="48" rx="6"></rect>
        <text class="dag-text" x="${pos.x + 10}" y="${pos.y + 20}">${escapeHtml(shorten(node.label ?? node.id, 22))}</text>
        <text class="dag-text" x="${pos.x + 10}" y="${pos.y + 38}">${escapeHtml(shorten(node.status ?? '-', 20))}</text>
      </g>
    `;
  }).join('');
  return `
    <svg class="dag-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Gate DAG">
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="currentColor"></path>
        </marker>
      </defs>
      ${edges}
      ${boxes}
    </svg>
  `;
}

function renderNodeGrid(nodes) {
  return `<div class="node-grid">${nodes.map((node) => `
    <article class="card ${escapeAttr(toneForStatus(node.status))}" data-node-id="${escapeAttr(node.id)}">
      <h3>${escapeHtml(node.label ?? node.id)}</h3>
      <p class="muted">${escapeHtml(node.id)} / ${escapeHtml(node.type)}</p>
      <p><span class="${statusClass(node.status ?? 'unknown')}">${escapeHtml(node.status ?? 'unknown')}</span></p>
      <p>${escapeHtml(node.reason ?? node.command ?? node.artifact ?? '-')}</p>
    </article>
  `).join('')}</div>`;
}

function renderLaneCard(lane, plan) {
  return `
    <article class="lane" data-lane-id="${escapeAttr(lane.id)}">
      <h3>${escapeHtml(lane.title)}</h3>
      <p><span class="${statusClass(lane.recommendation)}">${escapeHtml(lane.recommendation)}</span></p>
      <p class="muted">${escapeHtml(lane.category)} / ${escapeHtml(lane.file_count)} files</p>
      <h3>Review Focus</h3>
      ${renderList(lane.review_focus)}
      <h3>Files</h3>
      ${renderList(lane.files.slice(0, 8))}
      ${lane.graph_investigation_files.length > 0 ? `<h3>Graphify Related</h3>${renderList(lane.graph_investigation_files)}` : ''}
      ${plan ? `<h3>Gate Mode</h3><p><span class="${statusClass(plan.gate_mode)}">${escapeHtml(plan.gate_mode)}</span></p><p>${escapeHtml(plan.review_note)}</p>` : ''}
    </article>
  `;
}

function renderGateOverridePanel(gateOverride) {
  if (!gateOverride?.allowed) {
    return renderCards('Gate Override', [{ title: 'None', detail: 'Gate overrideは使われていません。', tone: 'good' }]);
  }
  const critical = gateOverride.critical_unresolved_gates ?? [];
  const evidence = gateOverride.required_evidence ?? [];
  const toolchain = gateOverride.toolchain;
  return `
    ${renderCards('Gate Override', [{
      title: `Override Allowed (${gateOverride.severity ?? 'warning'})`,
      detail: gateOverride.reason,
      meta: `policy=${gateOverride.waiver_policy ?? 'unknown'}; overall=${gateOverride.overall_status}; unresolved=${gateOverride.unresolved_gates?.length ?? 0}; critical=${critical.length}`,
      tone: gateOverride.severity === 'critical' ? 'danger' : 'warn'
    }])}
    <section>
      <h2>Critical Unresolved Gates</h2>
      ${renderList(critical.length > 0
        ? critical.map((gate) => `${gate.label ?? gate.id}: ${gate.status} - ${gate.reason ?? gate.command ?? '-'}`)
        : ['なし'])}
    </section>
    <section>
      <h2>Completion Quality Waiver Evidence</h2>
      <p><span class="${statusClass(gateOverride.completion_quality?.status ?? 'unknown')}">${escapeHtml(gateOverride.completion_quality?.status ?? 'unknown')}</span></p>
      ${renderList(evidence.length > 0 ? evidence : ['不足証跡なし'])}
    </section>
    <section>
      <h2>VibePro Runtime</h2>
      ${renderList([
        `package: ${toolchain?.package?.name ?? 'vibepro'}@${toolchain?.package?.version ?? 'unknown'}`,
        `root: ${toolchain?.package?.root ?? '-'}`,
        `commit: ${toolchain?.source_git?.commit ?? '-'}`,
        `branch: ${toolchain?.source_git?.branch ?? '-'}`,
        `dirty: ${toolchain?.source_git?.dirty == null ? '-' : String(toolchain.source_git.dirty)}`
      ])}
    </section>
  `;
}

function gateStatus(gateDag, id) {
  return gateDag.nodes.find((node) => node.id === id)?.status ?? 'unknown';
}

function isUnresolvedStatus(status) {
  return ['missing', 'needs_evidence', 'needs_setup', 'needs_review', 'contradicted', 'not_generated'].includes(status);
}

function statusClass(status) {
  return `status ${toneForStatus(status)}`;
}

function toneForStatus(status) {
  if (['pass', 'passed', 'present', 'satisfied', 'ready_for_review', 'single_pr_ok', 'primary_pr', 'same_pr_allowed', 'executed'].includes(status)) return 'good';
  if (['active_accepted_followup', 'accepted_followup', 'needs_evidence', 'needs_setup', 'needs_review', 'needs_verification', 'split_recommended', 'separate_pr', 'cumulative_after_dependencies', 'dry_run'].includes(status)) return 'warn';
  if (['missing', 'contradicted', 'failed', 'blocked', 'stale', 'stale_evidence', 'unbound'].includes(status)) return 'danger';
  if (['candidate', 'available'].includes(status)) return 'info';
  return 'neutral';
}

function shorten(value, maxLength) {
  const text = String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const __testing__ = {
  baseCss,
  renderDocument,
  metricCard,
  renderTable,
  escapeHtml,
  escapeAttr,
  statusClass,
  toneForStatus
};
