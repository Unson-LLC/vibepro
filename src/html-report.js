export function renderPrPrepareHtml({ preparation, bodyPath, gateDagPath, splitPlanPath, language = 'ja' }) {
  const gateDag = preparation.pr_context.gate_dag;
  const requirement = preparation.pr_context.requirement_consistency;
  const splitPlan = preparation.split_plan;
  const cards = [
    metricCard('Scope', preparation.scope.status, preparation.scope.recommended_strategy),
    metricCard('Gate DAG', gateDag.overall_status, `${gateDag.summary.needs_evidence_count} unresolved`),
    metricCard('Requirement', requirement?.status ?? 'not_generated', `${requirement?.summary?.contradiction_count ?? 0} contradictions`),
    metricCard('Split Plan', splitPlan.status, `${splitPlan.lanes.length} lanes`)
  ].join('');
  const flow = renderFlow([
    flowStep('Story', preparation.story.story_id, preparation.pr_context.story_source.path ? 'present' : 'transient'),
    flowStep('Architecture', preparation.pr_context.architecture_decision, gateStatus(gateDag, 'architecture')),
    flowStep('Spec', `${preparation.file_groups.specifications.count} files`, gateStatus(gateDag, 'spec')),
    flowStep('Code', `${preparation.file_groups.source.count} files`, gateStatus(gateDag, 'code')),
    flowStep('Gates', gateDag.overall_status, gateDag.overall_status)
  ]);
  const risks = renderCards('Human Review Focus', [
    ...preparation.pr_context.risks.map((risk) => ({ title: 'Risk', detail: risk, tone: 'danger' })),
    ...preparation.pr_context.review_points.map((point) => ({ title: 'Review', detail: point, tone: 'info' }))
  ]);
  const requirementSection = renderRequirementPanel(requirement);
  const networkSection = renderNetworkContractPanel(preparation.pr_context.network_contracts);
  const fileGroups = renderFileGroups(preparation.file_groups);
  const graphSummary = renderGraphSummary(splitPlan.graph_context);
  const artifacts = renderKeyValueTable([
    ['PR body draft', bodyPath],
    ['Gate DAG HTML', gateDagPath],
    ['Split Plan HTML', splitPlanPath]
  ]);
  const nextCommands = renderCommandList(preparation.next_commands);

  return renderDocument({
    title: 'VibePro PR Prepare',
    reportType: 'pr-prepare',
    generatedAt: preparation.created_at,
    language,
    body: `
      <section class="hero" data-overall-status="${escapeAttr(gateDag.overall_status)}">
        <div>
          <p class="eyebrow">Story-driven review artifact</p>
          <h2>${escapeHtml(preparation.story.title)}</h2>
          <p class="muted">${escapeHtml(preparation.story.story_id)} / ${escapeHtml(preparation.git.base_ref)} -> ${escapeHtml(preparation.git.head_ref)}</p>
        </div>
        <span class="${statusClass(gateDag.overall_status)}">${escapeHtml(gateDag.overall_status)}</span>
      </section>
      <section class="metrics">${cards}</section>
      <section>
        <h2>Story -> Architecture -> Spec -> Code -> Gate</h2>
        ${flow}
      </section>
      ${risks}
      ${requirementSection}
      ${networkSection}
      <section>
        <h2>Graphify Impact</h2>
        ${graphSummary}
      </section>
      <section>
        <h2>Changed File Groups</h2>
        ${fileGroups}
      </section>
      <section class="grid-2">
        <div>
          <h2>Artifacts</h2>
          ${artifacts}
        </div>
        <div>
          <h2>Next Commands</h2>
          ${nextCommands}
        </div>
      </section>
    `
  });
}

export function renderGateDagHtml(gateDag, options = {}) {
  const requiredGates = gateDag.nodes.filter((node) => node.required);
  const unresolved = requiredGates.filter((node) => isUnresolvedStatus(node.status));
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
  return renderDocument({
    title: 'VibePro PR Create',
    reportType: 'pr-create',
    generatedAt: execution.created_at,
    language: options.language ?? execution.output?.language ?? 'ja',
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

function renderRequirementPanel(requirement) {
  if (!requirement) {
    return renderCards('Requirement Consistency', [{ title: 'Not generated', detail: 'Requirement Consistency未生成', tone: 'warn' }]);
  }
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

function renderNetworkContractPanel(networkContracts) {
  if (!networkContracts) {
    return renderCards('Network Contract Findings', [{ title: 'Not generated', detail: 'Network Contract未生成', tone: 'warn' }]);
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
      <h2>Network Contract Findings</h2>
      <div class="metrics">
        ${metricCard('Status', networkContracts.status, 'route contract')}
        ${metricCard('API Calls', networkContracts.api_client_call_count ?? 0, 'detected')}
        ${metricCard('Missing Routes', missing.length, 'block')}
        ${metricCard('Introduced Calls', networkContracts.introduced_api_client_call_count ?? 0, 'diff')}
      </div>
      <div class="cards">${cards.map((card) => `
        <article class="card ${escapeAttr(card.tone)}">
          <h3>${escapeHtml(card.title)}</h3>
          <p class="muted">${escapeHtml(card.meta ?? '')}</p>
          <p>${escapeHtml(card.detail)}</p>
        </article>
      `).join('') || '<article class="card good"><h3>No findings</h3><p>API client calls and route files are aligned.</p></article>'}</div>
    </section>
  `;
}

function renderFileGroups(fileGroups) {
  const rows = Object.entries(fileGroups)
    .filter(([, group]) => group.count > 0)
    .map(([name, group]) => [name, group.count, group.files.slice(0, 10).join('<br>')]);
  return renderTable(['Group', 'Count', 'Files'], rows.length > 0 ? rows : [['-', 0, '-']]);
}

function renderGraphSummary(graphContext) {
  return `
    <div class="metrics">
      ${metricCard('Graph', graphContext.available ? 'available' : 'missing', graphContext.graph_path ?? '-')}
      ${metricCard('Matched Files', graphContext.matched_file_count, 'changed files')}
      ${metricCard('Related Files', graphContext.related_file_count, 'inspect candidates')}
      ${metricCard('Graph Size', `${graphContext.node_count}/${graphContext.edge_count}`, 'nodes / edges')}
    </div>
    ${graphContext.available ? renderGraphImpactTable(graphContext.impact_by_file.slice(0, 8)) : `<p class="muted">${escapeHtml(graphContext.reason)}</p>`}
  `;
}

function renderGraphImpactTable(items) {
  const rows = items.map((item) => [
    item.file,
    item.matched_nodes.join('<br>') || '-',
    item.related_files.join('<br>') || '-'
  ]);
  return renderTable(['Changed file', 'Matched graph nodes', 'Related files to inspect'], rows.length > 0 ? rows : [['-', '-', '-']]);
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
    nodes.filter((node) => node.id.startsWith('gate:')),
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
  if (['needs_evidence', 'needs_setup', 'needs_review', 'needs_verification', 'split_recommended', 'separate_pr', 'cumulative_after_dependencies', 'dry_run'].includes(status)) return 'warn';
  if (['missing', 'contradicted', 'failed', 'blocked'].includes(status)) return 'danger';
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
