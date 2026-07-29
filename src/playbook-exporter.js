import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultArchitectureFinalPath } from './architecture-store.js';
import { resolveArtifactRoute, resolveGateArtifactFile, resolvePrArtifactFile } from './artifact-routing.js';
import { readInferredSpec } from './spec-store.js';
import { getWorkspaceDir, initWorkspace, toWorkspaceRelative } from './workspace.js';
import { resolveStoryContext } from './story-manager.js';

export const PLAYBOOK_SCHEMA_VERSION = '0.1.0';
export const PLAYBOOK_CATALOG_ID = 'story-engineering-playbook-v1';
export const PLAYBOOK_CATALOG_REPO_PATH = 'docs/playbooks/story-engineering-playbook/catalog.json';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CORE_TEMPLATES = [
  {
    id: 'story.intent',
    title: 'Story intent',
    title_ja: 'Storyの意図',
    reason_ja: 'Story単位の実装判断で常に必要な価値・背景・受け入れ条件。',
    reason_en: 'Every story-scoped implementation needs value, background, and acceptance criteria.'
  },
  {
    id: 'story.scope',
    title: 'Scope and non-goals',
    title_ja: 'Scope / Non-goals',
    reason_ja: 'Storyから外れる変更をPRに混ぜないための範囲境界。',
    reason_en: 'Scope boundaries keep unrelated changes out of the PR.'
  },
  {
    id: 'architecture.delta',
    title: 'Architecture delta',
    title_ja: 'Architecture delta',
    reason_ja: 'Story実装が既存境界・責務・依存方向に与える差分。',
    reason_en: 'The implementation delta against existing boundaries, responsibilities, and dependencies.'
  },
  {
    id: 'quality.gates',
    title: 'Quality gates',
    title_ja: 'Quality gates',
    reason_ja: '実装完了ではなく、PR作成・レビュー・マージに必要な証跡を明示するため。',
    reason_en: 'Evidence required for PR creation, review, and merge.'
  },
  {
    id: 'open.questions',
    title: 'Open questions',
    title_ja: 'Open questions',
    reason_ja: '曖昧さを暗黙の実装判断に落とさず、未確認として残すため。',
    reason_en: 'Unresolved ambiguity stays explicit instead of becoming implicit implementation judgment.'
  }
];

const OPTIONAL_TEMPLATES = [
  {
    id: 'contract.surface',
    title: 'Public contract / command surface',
    title_ja: '公開契約 / コマンド面',
    axes: ['public_contract'],
    gates: ['gate:judgment_axis_public_contract', 'gate:pr_body_contract'],
    routeTypes: ['agent_workflow', 'release_engineering'],
    patterns: [
      /\b(api|cli|command|output|json|schema|contract|format|interface|public)\b/i,
      /(コマンド|出力|形式|公開契約|契約|API|スキーマ|インターフェース)/
    ],
    reason_ja: '外部またはエージェントが依存する入出力契約に触れるため。',
    reason_en: 'The story touches input/output contracts depended on by users or agents.'
  },
  {
    id: 'data.state',
    title: 'Data and state',
    title_ja: 'Data / State',
    axes: ['data_state'],
    gates: ['gate:judgment_axis_data_state'],
    patterns: [
      /\b(database|db|migration|persisted|persistence|cache|data model|stored record|record retention)\b/i,
      /(DB|データモデル|永続化|マイグレーション|キャッシュ|保存済みレコード|レコード保持)/
    ],
    reason_ja: '保存状態・派生状態・データ移行がStoryの成否に影響するため。',
    reason_en: 'Persisted or derived state affects story correctness.'
  },
  {
    id: 'security.trust',
    title: 'Security and trust boundary',
    title_ja: 'Security / Trust boundary',
    axes: ['security_boundary'],
    gates: ['gate:judgment_axis_security_boundary'],
    patterns: [
      /\b(auth|token|secret|permission|policy|risk|trust|security)\b/i,
      /(認証|認可|権限|秘密|トークン|セキュリティ|信頼境界)/
    ],
    reason_ja: '信頼境界・権限・秘密情報の扱いが変わる可能性があるため。',
    reason_en: 'Trust boundaries, authorization, or secret handling may change.'
  },
  {
    id: 'ux.workflow',
    title: 'UX / workflow',
    title_ja: 'UX / Workflow',
    axes: ['ux_surface', 'workflow'],
    gates: ['gate:judgment_axis_ux_surface', 'gate:workflow_flow_replay'],
    routeTypes: ['workflow_heavy'],
    patterns: [
      /\b(ui|ux|screen|user journey|user flow|interaction|component|frontend route)\b/i,
      /(UI|画面|ユーザー導線|ユーザーフロー|ジャーニー|操作画面|コンポーネント)/
    ],
    reason_ja: 'ユーザーまたはエージェントの実行フローに影響するため。',
    reason_en: 'The change affects a user or agent workflow.'
  },
  {
    id: 'release.ops',
    title: 'Release / operations',
    title_ja: 'Release / Operations',
    axes: ['release_ops'],
    gates: ['gate:ci', 'gate:release_source_traceability'],
    routeTypes: ['release_engineering'],
    patterns: [
      /\b(ci|deployment|deploy|release|versioning|package publish|distribution)\b/i,
      /(CI|デプロイ|リリース|バージョニング|パッケージ公開|配布経路)/
    ],
    reason_ja: 'CI、リリース、マージ、配布経路の判断が必要になるため。',
    reason_en: 'CI, release, merge, or distribution decisions are involved.'
  },
  {
    id: 'external.integration',
    title: 'External integration',
    title_ja: 'External integration',
    axes: ['external_integration'],
    gates: ['gate:judgment_axis_external_integration'],
    patterns: [
      /\b(webhook|slack|github|gmail|calendar|drive|mcp|external|integration|network)\b/i,
      /(Webhook|Slack|GitHub|Gmail|Calendar|Drive|MCP|外部連携|ネットワーク)/
    ],
    reason_ja: '外部サービス・外部APIとの接続や失敗境界がStoryに含まれるため。',
    reason_en: 'The story includes external services, APIs, or failure boundaries.'
  }
];

export async function exportStoryEngineeringPlaybook(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  await initWorkspace(root);

  const config = await readJson(path.join(getWorkspaceDir(root), 'config.json'));
  const { stories, currentStory } = resolveStoryContext(config);
  const storyId = options.storyId ?? currentStory?.story_id;
  const story = stories.find((item) => item.story_id === storyId);
  if (!story) throw new Error(`Story not found: ${storyId ?? '<none>'}`);

  const language = normalizeLanguage(options.language ?? config.output?.language);
  const storyDocs = await readStoryDocuments(root, story.story_id);
  const spec = await readInferredSpec(root, story.story_id);
  const architectureDocs = await readArchitectureDocuments(root, story.story_id, storyDocs);
  const prArtifacts = await readPrArtifacts(root, story.story_id);
  const source = buildSourceSummary({ root, story, storyDocs, spec, architectureDocs, prArtifacts });
  const catalog = await readBundledPlaybookCatalog();
  const decisions = buildTemplateDecisions(source, language, catalog);
  const playbook = buildPlaybook({ story, source, decisions, language, catalog });

  const artifacts = await writePlaybookArtifacts(root, playbook, {
    format: normalizeFormat(options.format),
    outputPath: options.outputPath
  });

  return {
    playbook,
    artifacts,
    selected_templates: decisions.filter((item) => item.decision === 'selected').map((item) => item.template_id),
    omitted_templates: decisions.filter((item) => item.decision === 'omitted').map((item) => item.template_id)
  };
}

export function renderPlaybookExportSummary(result) {
  const { playbook, artifacts } = result;
  const selected = result.selected_templates.join(', ') || '-';
  const omitted = result.omitted_templates.join(', ') || '-';
  return `# Playbook Export

| 項目 | 内容 |
|------|------|
| Story | ${playbook.story.story_id} |
| Catalog | ${playbook.catalog.id} |
| Markdown | ${artifacts.markdown ?? '-'} |
| JSON | ${artifacts.json ?? '-'} |
| Selected templates | ${selected} |
| Omitted templates | ${omitted} |

Engineering Judgment / Gate DAG が存在する場合はそれを優先し、存在しない場合は Story/Spec/Architecture の表面を fallback signal として明示しています。
`;
}

function buildPlaybook({ story, source, decisions, language, catalog }) {
  const generatedAt = new Date().toISOString();
  const content = {
    intent: {
      story_title: story.title,
      background: extractSectionText(source.story_docs, ['背景', 'Background']),
      acceptance_criteria: extractAcceptanceCriteria(source.story_docs),
      source_status: source.story_docs.length > 0 ? 'present' : 'missing'
    },
    scope: {
      included: extractSectionBullets(source.story_docs, ['Scope', '対象', '対象範囲', '実装範囲']),
      excluded: extractSectionBullets(source.story_docs, ['Non-goals', '対象外', 'やらないこと']),
      changed_files: source.changed_files
    },
    architecture_delta: {
      docs: source.architecture_docs.map((doc) => doc.path),
      summary: summarizeArchitecture(source.architecture_docs),
      source_status: source.architecture_docs.length > 0 ? 'present' : 'missing'
    },
    spec: summarizeSpec(source.spec),
    quality_gates: summarizeGates(source.gate_dag),
    open_questions: collectOpenQuestions(source.story_docs, source.spec)
  };

  return {
    schema_version: PLAYBOOK_SCHEMA_VERSION,
    artifact_kind: 'story_engineering_playbook',
    generated_at: generatedAt,
    output: { language },
    catalog: {
      id: catalog.id,
      path: PLAYBOOK_CATALOG_REPO_PATH,
      template_root: catalog.template_root,
      source: catalog.source ?? 'bundled',
      description: language === 'en'
        ? (catalog.description_en ?? 'Story-scoped engineering playbook selected from VibePro Engineering Judgment and Gate DAG evidence.')
        : (catalog.description_ja ?? 'VibePro Engineering Judgment / Gate DAG の判断をもとにStory単位で選択される開発ブリーフ。')
    },
    story: {
      story_id: story.story_id,
      title: story.title,
      status: story.status ?? 'active',
      horizon: story.horizon ?? null,
      view: story.view ?? null,
      period: story.period ?? null
    },
    sources: {
      story_docs: source.story_docs.map((doc) => doc.path),
      architecture_docs: source.architecture_docs.map((doc) => doc.path),
      spec: source.spec ? `.vibepro/spec/${story.story_id}/spec.json` : null,
      pr_prepare: source.pr_prepare ? `.vibepro/pr/${story.story_id}/pr-prepare.json` : null,
      gate_dag: source.gate_dag ? `.vibepro/pr/${story.story_id}/gate-dag.json` : null,
      playbook_catalog: PLAYBOOK_CATALOG_REPO_PATH,
      evidence_status: source.evidence_status
    },
    engineering_judgment: {
      route_type: source.engineering_judgment?.route_type ?? null,
      active_axes: source.active_axes,
      source: source.engineering_judgment ? 'pr_prepare' : source.gate_dag ? 'gate_dag' : 'fallback_signals'
    },
    template_decisions: decisions,
    content,
    markdown: renderPlaybookMarkdown({
      story,
      source,
      decisions,
      content,
      generatedAt,
      language,
      catalog
    })
  };
}

function buildSourceSummary({ root, story, storyDocs, spec, architectureDocs, prArtifacts }) {
  const prPrepare = prArtifacts.prPrepare;
  const gateDag = prArtifacts.gateDag ?? prPrepare?.pr_context?.gate_dag ?? null;
  const engineeringJudgment = prPrepare?.pr_context?.engineering_judgment
    ?? prPrepare?.decision_index?.engineering_judgment
    ?? null;
  const changedFiles = normalizeChangedFiles(prPrepare);
  const corpusParts = [
    story.title,
    ...storyDocs.map((doc) => doc.content),
    ...architectureDocs.map((doc) => doc.content),
    ...(spec?.clauses ?? []).map((clause) => clause.statement),
    ...changedFiles,
    engineeringJudgment?.route_type ?? '',
    ...(gateDag?.nodes ?? []).map((node) => `${node.id} ${node.status ?? ''} ${node.summary ?? ''}`)
  ];
  const activeAxes = normalizeActiveAxes(engineeringJudgment, gateDag);
  const evidenceStatus = {
    story_doc: storyDocs.length > 0 ? 'present' : 'missing',
    spec: spec ? 'present' : 'missing',
    architecture: architectureDocs.length > 0 ? 'present' : 'missing',
    pr_prepare: prPrepare ? 'present' : 'missing',
    gate_dag: gateDag ? 'present' : 'missing'
  };

  return {
    root,
    story,
    story_docs: storyDocs,
    spec,
    architecture_docs: architectureDocs,
    pr_prepare: prPrepare,
    gate_dag: gateDag,
    engineering_judgment: engineeringJudgment,
    active_axes: activeAxes,
    changed_files: changedFiles,
    corpus: corpusParts.filter(Boolean).join('\n'),
    evidence_status: evidenceStatus
  };
}

function buildTemplateDecisions(source, language, catalog) {
  const core = CORE_TEMPLATES.map((template) => {
    const hydrated = hydrateTemplateFromCatalog(template, catalog);
    return {
      template_id: template.id,
      title: language === 'en' ? template.title : template.title_ja,
      decision: 'selected',
      source: 'core_story_contract',
      active_axes: [],
      template_paths: hydrated.template_paths,
      evidence: [{
        source: 'story_contract',
        detail: language === 'en' ? template.reason_en : template.reason_ja
      }],
      reason: language === 'en' ? template.reason_en : template.reason_ja
    };
  });

  const optional = OPTIONAL_TEMPLATES.map((template) => {
    const hydrated = hydrateTemplateFromCatalog(template, catalog);
    const evidence = collectTemplateEvidence(template, source, language);
    const selected = evidence.some((item) => [
      'engineering_judgment_axis',
      'gate_dag',
      'engineering_judgment_route',
      'fallback_surface_signal'
    ].includes(item.source));
    return {
      template_id: template.id,
      title: language === 'en' ? template.title : template.title_ja,
      decision: selected ? 'selected' : 'omitted',
      source: selected ? evidence[0].source : 'engineering_judgment_absence',
      active_axes: source.active_axes.filter((axis) => template.axes?.includes(axis)),
      template_paths: hydrated.template_paths,
      evidence,
      reason: selected
        ? (language === 'en' ? template.reason_en : template.reason_ja)
        : buildOmittedTemplateReason(evidence, language)
    };
  });

  return [...core, ...optional];
}

async function readBundledPlaybookCatalog() {
  const catalog = await readJson(path.join(PACKAGE_ROOT, PLAYBOOK_CATALOG_REPO_PATH));
  if (catalog.id !== PLAYBOOK_CATALOG_ID) {
    throw new Error(`Unexpected playbook catalog id: ${catalog.id ?? '<missing>'}`);
  }
  await validateBundledCatalogTemplatePaths(catalog);
  return catalog;
}

async function validateBundledCatalogTemplatePaths(catalog) {
  const templateEntries = Object.entries(catalog.templates ?? {});
  if (templateEntries.length === 0) throw new Error('Bundled playbook catalog has no templates');
  for (const [templateId, template] of templateEntries) {
    for (const templatePath of template.template_paths ?? []) {
      const normalized = normalizeRepoPath(templatePath);
      if (!normalized.startsWith(`${catalog.template_root}/`) && normalized !== catalog.template_root) {
        throw new Error(`Playbook template ${templateId} points outside template root: ${templatePath}`);
      }
      const fullPath = path.resolve(PACKAGE_ROOT, normalized);
      const relative = path.relative(PACKAGE_ROOT, fullPath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Playbook template ${templateId} points outside package root: ${templatePath}`);
      }
      await readFile(fullPath, 'utf8');
    }
  }
}

function hydrateTemplateFromCatalog(template, catalog) {
  const entry = catalog.templates?.[template.id] ?? {};
  if (!Array.isArray(entry.template_paths) || entry.template_paths.length === 0) {
    throw new Error(`Bundled playbook catalog missing template paths for ${template.id}`);
  }
  return {
    ...template,
    template_paths: entry.template_paths.map(normalizeRepoPath)
  };
}

function buildOmittedTemplateReason(evidence, language) {
  const hasSupportingSurface = evidence.some((item) => item.source === 'surface_supporting_signal');
  if (hasSupportingSurface) {
    return language === 'en'
      ? 'Surface terms were observed, but the generated Engineering Judgment / Gate DAG did not select this template.'
      : '本文上のsurface signalはあるが、生成済みEngineering Judgment / Gate DAGでこのテンプレは選択されていない。';
  }
  return language === 'en'
    ? 'No active Engineering Judgment axis, Gate DAG node, route type, or fallback surface signal selected this template.'
    : 'Engineering Judgmentのactive axis、Gate DAG node、route type、fallback surface signalのいずれからも選択根拠が出ていない。';
}

function collectTemplateEvidence(template, source, language) {
  const evidence = [];
  const routeType = source.engineering_judgment?.route_type ?? null;
  const gateNodes = source.gate_dag?.nodes ?? [];

  for (const axis of template.axes ?? []) {
    if (source.active_axes.includes(axis)) {
      evidence.push({
        source: 'engineering_judgment_axis',
        detail: language === 'en' ? `active axis: ${axis}` : `active axis: ${axis}`
      });
    }
  }
  for (const gateId of template.gates ?? []) {
    const gate = gateNodes.find((node) => node.id === gateId);
    if (gate) {
      evidence.push({
        source: 'gate_dag',
        detail: `${gate.id}: ${gate.status ?? 'unknown'}`
      });
    }
  }
  if (routeType && template.routeTypes?.includes(routeType)) {
    evidence.push({
      source: 'engineering_judgment_route',
      detail: `route_type: ${routeType}`
    });
  }
  if (template.patterns?.some((pattern) => pattern.test(source.corpus))) {
    evidence.push({
      source: source.engineering_judgment || source.gate_dag ? 'surface_supporting_signal' : 'fallback_surface_signal',
      detail: language === 'en'
        ? 'Story/Spec/Architecture text contains matching surface terms.'
        : 'Story/Spec/Architecture本文に該当surfaceのsignalがある。'
    });
  }
  if (evidence.length === 0) {
    evidence.push({
      source: 'surface_absence',
      detail: language === 'en' ? 'No signal observed.' : '該当signalなし。'
    });
  }
  return dedupeEvidence(evidence);
}

async function writePlaybookArtifacts(root, playbook, options = {}) {
  const outDir = path.join(getWorkspaceDir(root), 'playbook', playbook.story.story_id);
  await mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'playbook.json');
  const markdownPath = path.join(outDir, 'story-engineering-playbook.md');
  const persisted = { ...playbook };
  delete persisted.markdown;
  await writeFile(jsonPath, `${JSON.stringify(persisted, null, 2)}\n`);
  await writeFile(markdownPath, ensureTrailingNewline(playbook.markdown));

  const artifacts = {
    json: toWorkspaceRelative(root, jsonPath),
    markdown: toWorkspaceRelative(root, markdownPath)
  };

  if (options.outputPath) {
    const outputPath = resolveRepoRelativeOutputPath(root, options.outputPath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    if (options.format === 'json') {
      await writeFile(outputPath, `${JSON.stringify(persisted, null, 2)}\n`);
      artifacts.output = toWorkspaceRelative(root, outputPath);
    } else {
      await writeFile(outputPath, ensureTrailingNewline(playbook.markdown));
      artifacts.output = toWorkspaceRelative(root, outputPath);
    }
  }

  return artifacts;
}

function renderPlaybookMarkdown({ story, source, decisions, content, generatedAt, language, catalog }) {
  if (language === 'en') return renderPlaybookMarkdownEn({ story, source, decisions, content, generatedAt, catalog });
  const selectedRows = decisions.map((decision) => (
    `| ${decision.template_id} | ${decision.decision} | ${decision.source} | ${formatTemplatePaths(decision.template_paths)} | ${escapeTable(decision.reason)} |`
  )).join('\n');
  const acceptance = content.intent.acceptance_criteria.length > 0
    ? content.intent.acceptance_criteria.map((item) => `- ${item}`).join('\n')
    : '- 未確認';
  const gates = content.quality_gates.items.length > 0
    ? content.quality_gates.items.map((gate) => `- ${gate.id}: ${gate.status}${gate.required ? ' (required)' : ''}`).join('\n')
    : '- Gate DAG未生成';
  const questions = content.open_questions.length > 0
    ? content.open_questions.map((item) => `- ${item}`).join('\n')
    : '- なし';
  return `# Story Engineering Playbook

| 項目 | 内容 |
|------|------|
| Story | ${story.story_id} |
| Title | ${story.title} |
| Catalog | ${catalog.id} |
| Catalog path | ${PLAYBOOK_CATALOG_REPO_PATH} |
| Generated at | ${generatedAt} |

## 1. Intent

- Story doc: ${source.evidence_status.story_doc}
- Spec: ${source.evidence_status.spec}
- Architecture: ${source.evidence_status.architecture}
- PR prepare / Gate DAG: ${source.evidence_status.pr_prepare} / ${source.evidence_status.gate_dag}
- Engineering route: ${source.engineering_judgment?.route_type ?? '未生成'}
- Active axes: ${source.active_axes.join(', ') || '未生成'}

### 受け入れ基準

${acceptance}

## 2. Scope

- Changed files: ${content.scope.changed_files.length > 0 ? content.scope.changed_files.join(', ') : '未取得'}
- Included: ${content.scope.included.length > 0 ? content.scope.included.join(' / ') : 'Story本文からは未抽出'}
- Excluded: ${content.scope.excluded.length > 0 ? content.scope.excluded.join(' / ') : 'Story本文からは未抽出'}

## 3. Architecture Delta

- Architecture docs: ${content.architecture_delta.docs.length > 0 ? content.architecture_delta.docs.join(', ') : '未確認'}
- Summary: ${content.architecture_delta.summary}

## 4. Template Decisions

| Template | Decision | Source | Files | Reason |
|----------|----------|--------|-------|--------|
${selectedRows}

## 5. Quality Gates

${gates}

## 6. Open Questions

${questions}
`;
}

function renderPlaybookMarkdownEn({ story, source, decisions, content, generatedAt, catalog }) {
  const rows = decisions.map((decision) => (
    `| ${decision.template_id} | ${decision.decision} | ${decision.source} | ${formatTemplatePaths(decision.template_paths)} | ${escapeTable(decision.reason)} |`
  )).join('\n');
  const acceptance = content.intent.acceptance_criteria.length > 0
    ? content.intent.acceptance_criteria.map((item) => `- ${item}`).join('\n')
    : '- Not confirmed';
  const gates = content.quality_gates.items.length > 0
    ? content.quality_gates.items.map((gate) => `- ${gate.id}: ${gate.status}${gate.required ? ' (required)' : ''}`).join('\n')
    : '- Gate DAG not generated';
  const questions = content.open_questions.length > 0
    ? content.open_questions.map((item) => `- ${item}`).join('\n')
    : '- None';
  return `# Story Engineering Playbook

| Field | Value |
|-------|-------|
| Story | ${story.story_id} |
| Title | ${story.title} |
| Catalog | ${catalog.id} |
| Catalog path | ${PLAYBOOK_CATALOG_REPO_PATH} |
| Generated at | ${generatedAt} |

## 1. Intent

- Story doc: ${source.evidence_status.story_doc}
- Spec: ${source.evidence_status.spec}
- Architecture: ${source.evidence_status.architecture}
- PR prepare / Gate DAG: ${source.evidence_status.pr_prepare} / ${source.evidence_status.gate_dag}
- Engineering route: ${source.engineering_judgment?.route_type ?? 'not generated'}
- Active axes: ${source.active_axes.join(', ') || 'not generated'}

### Acceptance Criteria

${acceptance}

## 2. Scope

- Changed files: ${content.scope.changed_files.length > 0 ? content.scope.changed_files.join(', ') : 'not collected'}
- Included: ${content.scope.included.length > 0 ? content.scope.included.join(' / ') : 'not extracted from Story'}
- Excluded: ${content.scope.excluded.length > 0 ? content.scope.excluded.join(' / ') : 'not extracted from Story'}

## 3. Architecture Delta

- Architecture docs: ${content.architecture_delta.docs.length > 0 ? content.architecture_delta.docs.join(', ') : 'not confirmed'}
- Summary: ${content.architecture_delta.summary}

## 4. Template Decisions

| Template | Decision | Source | Files | Reason |
|----------|----------|--------|-------|--------|
${rows}

## 5. Quality Gates

${gates}

## 6. Open Questions

${questions}
`;
}

async function readStoryDocuments(root, storyId) {
  const configured = (await resolveArtifactRoute(root, 'story', { storyId })).canonical.relative_path;
  const candidates = [
    configured,
    path.join('docs', 'management', 'stories', 'active', `${storyId}.md`),
    path.join('docs', 'management', 'stories', 'backlog', `${storyId}.md`),
    path.join('docs', 'management', 'stories', 'done', `${storyId}.md`),
    path.join('docs', 'management', 'stories', 'archived', `${storyId}.md`)
  ];
  return readExistingTextFiles(root, candidates);
}

async function readArchitectureDocuments(root, storyId, storyDocs) {
  const fromFrontmatter = storyDocs.flatMap((doc) => parseFrontmatter(doc.content).architecture_docs ?? []);
  const slug = slugifyStoryId(storyId);
  const storylessSlug = slugifyStoryId(String(storyId).replace(/^story-/, ''));
  const candidates = [
    ...fromFrontmatter,
    (await resolveArtifactRoute(root, 'architecture', { storyId })).canonical.relative_path,
    defaultArchitectureFinalPath(storyId),
    path.join('docs', 'architecture', `${storylessSlug}.md`),
    path.join('docs', 'architecture', `${slug}.md`)
  ];
  return readExistingTextFiles(root, dedupe(candidates));
}

async function readPrArtifacts(root, storyId) {
  const [prPrepare, gateDag] = await Promise.all([
    resolvePrArtifactFile(root, storyId).then(readJsonIfExists),
    resolveGateArtifactFile(root, storyId).then(readJsonIfExists)
  ]);
  return { prPrepare, gateDag };
}

async function readExistingTextFiles(root, relativePaths) {
  const docs = [];
  for (const relativePath of relativePaths) {
    if (!relativePath) continue;
    const normalized = normalizeRepoPath(relativePath);
    const fullPath = path.join(root, normalized);
    try {
      docs.push({
        path: normalized,
        content: await readFile(fullPath, 'utf8')
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return docs;
}

function normalizeActiveAxes(engineeringJudgment, gateDag) {
  const axes = new Set();
  for (const axis of engineeringJudgment?.active_axes ?? []) {
    const id = typeof axis === 'string' ? axis : axis.axis ?? axis.id ?? axis.name;
    if (id) axes.add(id);
  }
  for (const axis of engineeringJudgment?.judgment_axes ?? []) {
    const id = axis.axis ?? axis.id ?? axis.name;
    const status = axis.status ?? axis.decision ?? null;
    const active = axis.active === true
      || ['active', 'needs_evidence', 'accepted_followup', 'passed', 'selected'].includes(status);
    if (id && active) axes.add(id);
  }
  for (const node of gateDag?.nodes ?? []) {
    const match = String(node.id ?? '').match(/^gate:judgment_axis_(.+)$/);
    if (match && node.status !== 'not_applicable') axes.add(match[1]);
  }
  return [...axes].sort();
}

function normalizeChangedFiles(prPrepare) {
  const files = prPrepare?.git?.changed_files ?? [];
  if (!Array.isArray(files)) return [];
  return files.map((item) => typeof item === 'string' ? item : item.path ?? item.file).filter(Boolean);
}

function summarizeSpec(spec) {
  if (!spec) return { status: 'missing', clause_count: 0, clause_types: {} };
  const clauseTypes = {};
  for (const clause of spec.clauses ?? []) {
    clauseTypes[clause.type ?? 'unknown'] = (clauseTypes[clause.type ?? 'unknown'] ?? 0) + 1;
  }
  return {
    status: 'present',
    clause_count: spec.clauses?.length ?? 0,
    clause_types: clauseTypes,
    open_question_count: spec.open_questions?.length ?? 0
  };
}

function summarizeArchitecture(docs) {
  if (docs.length === 0) return 'Architecture doc未確認';
  const first = docs[0].content
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'));
  return first ?? `${docs.length}件のArchitecture docを参照`;
}

function summarizeGates(gateDag) {
  if (!gateDag) return { status: 'missing', overall_status: null, items: [] };
  const nodes = Array.isArray(gateDag.nodes) ? gateDag.nodes : [];
  return {
    status: 'present',
    overall_status: gateDag.overall_status ?? null,
    items: nodes
      .filter((node) => node.required || ['needs_evidence', 'needs_review', 'failed', 'block'].includes(node.status))
      .slice(0, 20)
      .map((node) => ({
        id: node.id,
        status: node.status ?? 'unknown',
        required: Boolean(node.required)
      }))
  };
}

function extractAcceptanceCriteria(docs) {
  return extractSectionBullets(docs, ['受け入れ基準', 'Acceptance Criteria', 'Acceptance']);
}

function collectOpenQuestions(storyDocs, spec) {
  const storyQuestions = extractSectionBullets(storyDocs, ['Open Questions', '確認事項', '未解決', '未確認']);
  const specQuestions = (spec?.open_questions ?? []).map((item) => item.question).filter(Boolean);
  return dedupe([...storyQuestions, ...specQuestions]);
}

function extractSectionBullets(docs, headings) {
  return dedupe(docs.flatMap((doc) => {
    const section = extractSection(doc.content, headings);
    if (!section) return [];
    return section
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+/.test(line))
      .map((line) => cleanMarkdownInline(line.replace(/^[-*]\s+/, '')))
      .filter(Boolean);
  }));
}

function extractSectionText(docs, headings) {
  const text = docs.map((doc) => extractSection(doc.content, headings)).find(Boolean);
  return text ? text.trim() : null;
}

function extractSection(content, headings) {
  const body = String(content ?? '').replace(/^---\n[\s\S]*?\n---\n?/, '');
  const escaped = headings.map(escapeRegExp).join('|');
  const match = body.match(new RegExp(`^#{2,4}\\s+(?:${escaped})\\s*\\n([\\s\\S]*?)(?=^#{2,4}\\s+|(?![\\s\\S]))`, 'im'));
  return match?.[1]?.trim() ?? null;
}

function parseFrontmatter(content) {
  const match = String(content ?? '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result = {};
  let activeListKey = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    const listItem = rawLine.match(/^\s*-\s+(.+?)\s*$/);
    if (listItem && activeListKey) {
      result[activeListKey].push(unquote(listItem[1].trim()));
      continue;
    }
    const keyValue = rawLine.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (!keyValue) continue;
    const [, key, value] = keyValue;
    if (!value) {
      result[key] = [];
      activeListKey = key;
    } else {
      result[key] = unquote(value);
      activeListKey = null;
    }
  }
  return result;
}

function normalizeFormat(format = null) {
  const value = format ?? 'markdown';
  if (value !== 'markdown' && value !== 'json') {
    throw new Error('--format must be markdown or json');
  }
  return value;
}

function normalizeLanguage(language = null) {
  return language === 'en' ? 'en' : 'ja';
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function resolveRepoRelativeOutputPath(root, outputPath) {
  if (path.isAbsolute(outputPath)) {
    throw new Error('playbook export --output must be repository-relative');
  }
  const resolved = path.resolve(root, outputPath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('playbook export --output must stay inside the repository');
  }
  return resolved;
}

function normalizeRepoPath(filePath) {
  return String(filePath).replace(/\\/g, '/').replace(/^\.\//, '');
}

function slugifyStoryId(storyId) {
  return String(storyId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'story';
}

function cleanMarkdownInline(value) {
  return String(value ?? '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .trim();
}

function escapeTable(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function formatTemplatePaths(paths = []) {
  if (!paths.length) return '-';
  return escapeTable(paths.join('<br>'));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unquote(value) {
  return String(value ?? '').replace(/^['"]|['"]$/g, '');
}

function dedupe(items) {
  return [...new Set(items.filter(Boolean))];
}

function dedupeEvidence(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = `${item.source}:${item.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function ensureTrailingNewline(text) {
  return text.endsWith('\n') ? text : `${text}\n`;
}
