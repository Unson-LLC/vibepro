import path from 'node:path';

import { __testing__ as htmlHelpers } from './html-report.js';

const { renderDocument, metricCard, renderTable, escapeHtml, escapeAttr, statusClass } = htmlHelpers;

const ARTIFACT_LABELS = {
  summary: 'summary.md',
  risk_register: 'risk-register.md',
  evidence: 'evidence.json',
  static_site_check: 'static-site-check-result.md',
  component_style_check: 'component-style-check-result.md',
  flow_design_check: 'flow-design-check-result.md',
  terminal_link_check: 'terminal-link-check-result.md',
  architecture_profile: 'architecture-profile.md',
  finding_review: 'finding-review.md',
  refactoring_delta: 'refactoring-delta.md',
  requirement_consistency: 'requirement-consistency.md',
  story_tasks_markdown: 'tasks.md',
  story_tasks_json: 'tasks.json'
};

const PRIMARY_ARTIFACT_KEYS = [
  'summary',
  'risk_register',
  'evidence',
  'finding_review',
  'architecture_profile'
];

export function renderStoryReportHtml({ story, latestRun, runs, storyDir, repoRoot, graphHtmlPath, storyReportMdPath, storyTasksMdPath, evidence = null, journeyContext = null }) {
  const generatedAt = new Date().toISOString();
  const artifactRows = buildArtifactRows({ latestRun, repoRoot, storyDir });
  const localLinks = buildLocalLinkRows({ storyDir, storyReportMdPath, storyTasksMdPath, repoRoot });
  const graphLink = buildGraphLink({ storyDir, repoRoot, graphHtmlPath });
  const findings = Array.isArray(evidence?.findings) ? evidence.findings : [];
  const journeyTable = renderJourneyContextTable(journeyContext);
  const journeyActions = renderJourneyActions(journeyContext);
  const findingTable = findings.length === 0
    ? '<p class="muted">検出事項なし</p>'
    : renderTable(['ID', 'Title', 'Severity'], findings.slice(0, 20).map((finding) => [
      finding.id ?? '-',
      finding.title ?? '-',
      finding.severity ?? '-'
    ]));
  const graphLinkHtml = graphLink ? renderLink(graphLink, graphLink) : '-';

  const cards = [
    metricCard('Story', story.story_id, story.title ?? ''),
    metricCard('Latest Run', latestRun?.run_id ?? '-', latestRun?.gate_status ?? '-'),
    metricCard('Runs', String(runs?.length ?? 0), 'historical'),
    metricCard('Journey', journeyContext?.status ?? 'unknown', journeyContext?.curated ? 'curated' : (journeyContext?.curation_status ?? '-')),
    metricCard('Findings', String(findings.length), evidence ? 'in latest evidence' : 'evidence missing')
  ].join('');

  const localLinksTable = localLinks.length === 0
    ? '<p class="muted">なし</p>'
    : renderLinkTable(localLinks);

  const artifactTable = artifactRows.length === 0
    ? '<p class="muted">最新runのartifactが見つかりません。</p>'
    : renderLinkTable(artifactRows);

  return renderDocument({
    title: 'VibePro Story Report',
    reportType: 'story-report',
    generatedAt,
    body: `
      <section class="hero" data-overall-status="${escapeAttr(latestRun?.gate_status ?? 'unknown')}">
        <div>
          <p class="eyebrow">Story diagnostics dashboard</p>
          <h2>${escapeHtml(story.title ?? story.story_id)}</h2>
          <p class="muted">${escapeHtml(story.story_id)} / view:${escapeHtml(story.view ?? '-')} / period:${escapeHtml(story.period ?? '-')}</p>
        </div>
        <span class="${statusClass(latestRun?.gate_status ?? 'unknown')}">${escapeHtml(latestRun?.gate_status ?? 'unknown')}</span>
      </section>
      <section class="metrics">${cards}</section>
      <section>
        <h2>Story Artifacts</h2>
        ${localLinksTable}
        ${graphLink ? `<p>Graph: ${graphLinkHtml}</p>` : ''}
      </section>
      <section>
        <h2>Journey Context</h2>
        ${journeyTable}
        ${journeyActions}
      </section>
      <section>
        <h2>Latest Run Artifacts (${escapeHtml(latestRun?.run_id ?? '-')})</h2>
        ${artifactTable}
      </section>
      <section>
        <h2>Findings (latest run)</h2>
        ${findingTable}
      </section>
    `
  });
}

function renderJourneyContextTable(journeyContext) {
  if (!journeyContext) return '<p class="muted">未評価</p>';
  const detection = journeyContext.detection ?? {};
  const sourcePaths = Array.isArray(detection.source_paths) ? detection.source_paths : [];
  const matchedTerms = Array.isArray(detection.matched_terms) ? detection.matched_terms : [];
  return renderTable(['Field', 'Value'], [
    ['Required', formatYesNo(journeyContext.required)],
    ['Status', formatNullable(journeyContext.status)],
    ['Artifact kind', formatNullable(journeyContext.artifact_kind)],
    ['Curated', formatYesNo(journeyContext.curated)],
    ['Curation status', formatNullable(journeyContext.curation_status)],
    ['Handoff', formatYesNo(journeyContext.handoff_available)],
    ['Journey ID', formatNullable(journeyContext.journey_id)],
    ['Detection', matchedTerms.join(', ') || '-'],
    ['Source docs', sourcePaths.join(', ') || '-'],
    ['Reason', formatNullable(journeyContext.reason ?? detection.reason)]
  ]);
}

function renderJourneyActions(journeyContext) {
  const actions = Array.isArray(journeyContext?.next_actions) ? journeyContext.next_actions : [];
  if (actions.length === 0) return '<p class="muted">Next actions: なし</p>';
  return `<ul>${actions.map((action) => `<li><code>${escapeHtml(action)}</code></li>`).join('')}</ul>`;
}

function formatYesNo(value) {
  return value ? 'yes' : 'no';
}

function formatNullable(value) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

function buildArtifactRows({ latestRun, repoRoot, storyDir }) {
  if (!latestRun?.artifacts) return [];
  const artifacts = latestRun.artifacts;
  const ordered = [
    ...PRIMARY_ARTIFACT_KEYS.filter((key) => artifacts[key]),
    ...Object.keys(artifacts).filter((key) => artifacts[key] && !PRIMARY_ARTIFACT_KEYS.includes(key))
  ];
  return ordered.map((key) => ({
    label: ARTIFACT_LABELS[key] ?? key,
    href: toRelativeFromStoryDir({ repoRoot, storyDir, repoRelativePath: artifacts[key] })
  }));
}

function buildLocalLinkRows({ storyDir, storyReportMdPath, storyTasksMdPath, repoRoot }) {
  const rows = [];
  if (storyReportMdPath) {
    rows.push({
      label: 'story-report.md',
      href: toRelativeFromAbsolute(storyDir, storyReportMdPath)
    });
  }
  if (storyTasksMdPath) {
    rows.push({
      label: 'tasks.md',
      href: typeof storyTasksMdPath === 'string' && path.isAbsolute(storyTasksMdPath)
        ? toRelativeFromAbsolute(storyDir, storyTasksMdPath)
        : toRelativeFromStoryDir({ repoRoot, storyDir, repoRelativePath: storyTasksMdPath })
    });
  }
  return rows;
}

function buildGraphLink({ storyDir, repoRoot, graphHtmlPath }) {
  if (!graphHtmlPath) return null;
  if (path.isAbsolute(graphHtmlPath)) return toRelativeFromAbsolute(storyDir, graphHtmlPath);
  return toRelativeFromStoryDir({ repoRoot, storyDir, repoRelativePath: graphHtmlPath });
}

function toRelativeFromAbsolute(fromDir, toPath) {
  return path.relative(fromDir, toPath).split(path.sep).join('/');
}

function toRelativeFromStoryDir({ repoRoot, storyDir, repoRelativePath }) {
  if (!repoRelativePath) return '';
  const absolute = path.isAbsolute(repoRelativePath)
    ? repoRelativePath
    : path.resolve(repoRoot, repoRelativePath);
  return toRelativeFromAbsolute(storyDir, absolute);
}

function renderLink(href, label) {
  if (!href) return '-';
  return `<a href="${escapeAttr(href)}">${escapeHtml(label)}</a>`;
}

function renderLinkTable(rows) {
  return `
    <table>
      <thead><tr><th>Artifact</th><th>Path</th></tr></thead>
      <tbody>
        ${rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${renderLink(row.href, row.href)}</td></tr>`).join('')}
      </tbody>
    </table>
  `;
}
