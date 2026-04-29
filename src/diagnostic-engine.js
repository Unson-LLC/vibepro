import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { profileArchitecture } from './architecture-profiler.js';
import { scanStaticSite } from './static-site-scanner.js';
import { resolveStoryContext } from './story-manager.js';
import { getWorkspaceDir, initWorkspace, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';

export async function runDiagnosis(repoRoot, options = {}) {
  await initWorkspace(repoRoot);
  const root = path.resolve(repoRoot);
  const runId = options.runId ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '');
  const runDir = path.join(getWorkspaceDir(root), 'diagnostics', runId);
  await mkdir(runDir, { recursive: true });

  const graphPath = path.join(getWorkspaceDir(root), 'graphify', 'graph.json');
  const graph = JSON.parse(await readFile(graphPath, 'utf8'));
  const config = JSON.parse(await readFile(path.join(getWorkspaceDir(root), 'config.json'), 'utf8'));
  const { currentStory } = resolveStoryContext(config);
  const evidence = await buildEvidence(root, graph, runId, currentStory);
  const findings = buildFindings(evidence);
  evidence.findings = findings;
  evidence.gates = buildGates(findings);

  const evidencePath = path.join(runDir, 'evidence.json');
  const summaryPath = path.join(runDir, 'summary.md');
  const riskPath = path.join(runDir, 'risk-register.md');
  const staticSitePath = path.join(runDir, 'static-site-check-result.md');
  const architectureProfilePath = path.join(runDir, 'architecture-profile.md');

  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(summaryPath, renderSummary({ runId, evidence, findings }));
  await writeFile(riskPath, renderRiskRegister({ runId, findings }));
  await writeFile(staticSitePath, renderStaticSiteCheck({
    runId,
    staticSite: evidence.static_site,
    profile: evidence.architecture_profile
  }));
  await writeFile(architectureProfilePath, renderArchitectureProfile({
    runId,
    profile: evidence.architecture_profile,
    checkCatalog: evidence.check_catalog
  }));

  const manifest = await readManifest(root);
  const run = {
    run_id: runId,
    story_id: currentStory.story_id,
    story: currentStory,
    created_at: new Date().toISOString(),
    gate_status: evidence.gates[0]?.status ?? 'unknown',
    artifacts: {
      summary: toWorkspaceRelative(root, summaryPath),
      risk_register: toWorkspaceRelative(root, riskPath),
      evidence: toWorkspaceRelative(root, evidencePath),
      static_site_check: toWorkspaceRelative(root, staticSitePath),
      architecture_profile: toWorkspaceRelative(root, architectureProfilePath)
    }
  };
  manifest.latest_run = runId;
  manifest.latest_run_by_story = {
    ...(manifest.latest_run_by_story ?? {}),
    [currentStory.story_id]: runId
  };
  manifest.runs = [run, ...(manifest.runs ?? []).filter((item) => item.run_id !== runId)];
  await writeManifest(root, manifest);

  return { runDir, run };
}

async function buildEvidence(repoRoot, graph, runId, story) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const architectureProfile = await profileArchitecture(repoRoot);
  return {
    schema_version: '0.1.0',
    run_id: runId,
    story_id: story.story_id,
    story,
    graphify: {
      node_count: nodes.length,
      edge_count: edges.length,
      extracted_edges: edges.filter((edge) => edge.confidence === 'EXTRACTED'),
      inferred_edges: edges.filter((edge) => edge.confidence === 'INFERRED'),
      ambiguous_edges: edges.filter((edge) => edge.confidence === 'AMBIGUOUS')
    },
    architecture_profile: architectureProfile,
    check_catalog: {
      selected_views: architectureProfile.selected_views,
      applicable_checks: architectureProfile.applicable_checks
    },
    static_site: await scanStaticSite(repoRoot),
    findings: [],
    gates: []
  };
}

function buildFindings(evidence) {
  const findings = [];
  const applicableChecks = new Set(evidence.check_catalog?.applicable_checks ?? []);
  if (evidence.graphify.ambiguous_edges.length > 0) {
    findings.push({
      id: 'VP-GRAPH-001',
      severity: 'Medium',
      category: '文脈品質',
      title: '曖昧な依存関係が残っている',
      detail: `graphify が ${evidence.graphify.ambiguous_edges.length} 件の曖昧な関係を検出した。`,
      recommendation: '本番化判断に使う前に、対象の関係を人間または追加調査で確認する。'
    });
  }
  if (evidence.graphify.inferred_edges.length > 0) {
    findings.push({
      id: 'VP-GRAPH-002',
      severity: 'Low',
      category: '文脈品質',
      title: '推論された依存関係がある',
      detail: `graphify が ${evidence.graphify.inferred_edges.length} 件の推論関係を検出した。`,
      recommendation: '推論関係は診断質問として扱い、検証済み事実として扱わない。'
    });
  }
  if (applicableChecks.has('static-entry') && !evidence.static_site.has_index_html) {
    findings.push({
      id: 'VP-STATIC-001',
      severity: 'High',
      category: '静的サイト',
      title: 'ルートの index.html が見つからない',
      detail: '静的サイトとして配信する入口ファイルが確認できない。',
      recommendation: '公開対象のルートに index.html を配置するか、配信設定の入口を明示する。'
    });
  }
  if (applicableChecks.has('secrets') && evidence.static_site.secret_hits.length > 0) {
    findings.push({
      id: 'VP-STATIC-002',
      severity: 'Critical',
      category: 'セキュリティ',
      title: '秘密情報の可能性がある値が含まれている',
      detail: `${evidence.static_site.secret_hits.length} 件の秘密情報候補を検出した。`,
      recommendation: '公開前に該当値を削除し、必要な値はサーバー側または安全な環境変数管理へ移す。'
    });
  }
  if (applicableChecks.has('xss') && evidence.static_site.xss_risk_hits.length > 0) {
    findings.push({
      id: 'VP-STATIC-003',
      severity: 'High',
      category: 'セキュリティ',
      title: 'XSS につながり得る DOM 操作がある',
      detail: `${evidence.static_site.xss_risk_hits.length} 件の危険なDOM操作候補を検出した。`,
      recommendation: 'ユーザー入力をHTMLとして挿入しない。必要な場合はサニタイズし、textContentなど安全な代替を使う。'
    });
  }
  if (applicableChecks.has('static-publish-surface') && evidence.static_site.non_static_files.length > 0) {
    findings.push({
      id: 'VP-STATIC-004',
      severity: 'Medium',
      category: '配信設計',
      title: '静的配信対象外のファイルが混在している',
      detail: `${evidence.static_site.non_static_files.length} 件の非静的ファイル候補を検出した。`,
      recommendation: '公開ディレクトリにサーバーコード、設定ファイル、生成前ソースを含めない構成に分離する。'
    });
  }
  if (applicableChecks.has('external-resources') && evidence.static_site.external_resources.length > 0) {
    findings.push({
      id: 'VP-STATIC-005',
      severity: 'Low',
      category: '外部依存',
      title: '外部リソースを直接読み込んでいる',
      detail: `${evidence.static_site.external_resources.length} 件の外部リソース参照を検出した。`,
      recommendation: '可用性、改ざん、CSP、ライセンスの観点で読み込み元を確認する。'
    });
  }
  return findings;
}

function buildGates(findings) {
  const hasCritical = findings.some((finding) => finding.severity === 'Critical');
  const hasMediumOrHigher = findings.some((finding) => ['Critical', 'High', 'Medium'].includes(finding.severity));
  return [{
    id: 'production-readiness',
    status: hasCritical ? 'block' : hasMediumOrHigher ? 'needs_review' : 'pass',
    reason: hasCritical
      ? '公開前に必ず解消すべき項目がある'
      : hasMediumOrHigher
        ? '文脈品質または適用チェックに確認が必要な項目がある'
        : '重大な確認項目は検出されていない'
  }];
}

function renderSummary({ runId, evidence, findings }) {
  const profile = evidence.architecture_profile ?? {};
  const applicableChecks = evidence.check_catalog?.applicable_checks ?? [];
  return `# VibePro 診断サマリー

| 項目 | 内容 |
|------|------|
| Run ID | ${runId} |
| Story | ${evidence.story.title} |
| Story ID | ${evidence.story_id} |
| 種別 | ${profile.app_type ?? 'unknown'} |
| 描画方式 | ${profile.rendering ?? '-'} |
| 適用チェック | ${applicableChecks.join(', ') || '-'} |
| graphify nodes | ${evidence.graphify.node_count} |
| graphify edges | ${evidence.graphify.edge_count} |
| 共通スキャン対象 | ${evidence.static_site.scanned_files}件 |
| 秘密情報候補 | ${evidence.static_site.secret_hits.length}件 |
| XSSリスク候補 | ${evidence.static_site.xss_risk_hits.length}件 |
| 検出事項 | ${findings.length}件 |

## アーキテクチャView

${renderArchitectureViewTable(profile)}

## ゲート状態

${evidence.gates.map((gate) => `- ${gate.id}: ${gate.status} - ${gate.reason}`).join('\n')}

## 主な検出事項

${findings.length === 0 ? '- なし' : findings.map((finding) => `- ${finding.id}: ${finding.title}（${finding.severity}）`).join('\n')}
`;
}

function renderArchitectureViewTable(profile) {
  const views = profile.views ?? {};
  return `| View | 判定 |
|------|------|
| Structure | ${[
    ...(views.structure?.containers ?? []),
    ...(views.structure?.components ?? []),
    ...(views.structure?.frameworks ?? [])
  ].join(', ') || '-'} |
| Runtime | ${[
    `${views.runtime?.entrypoints?.length ?? 0} entrypoints`,
    ...(views.runtime?.server_boundaries ?? [])
  ].join(', ')} |
| Data | ${[
    ...(views.data?.stores ?? []),
    ...(views.data?.access_patterns ?? [])
  ].join(', ') || '-'} |
| Security | ${[
    `${views.security?.auth_boundaries?.length ?? 0} auth boundaries`,
    `${views.security?.secret_files?.length ?? 0} secret files`
  ].join(', ')} |
| Deployment | ${(views.deployment?.targets ?? []).join(', ') || '-'} |
| Quality | ${[
    ...(views.quality?.test_tools ?? []),
    ...(views.quality?.ci ?? [])
  ].join(', ') || '-'} |`;
}

function renderArchitectureProfile({ runId, profile, checkCatalog }) {
  return `# 構造プロファイル

| 項目 | 内容 |
|------|------|
| Run ID | ${runId} |
| 種別 | ${profile.app_type} |
| 描画方式 | ${profile.rendering ?? '-'} |
| パッケージ管理 | ${profile.package_manager ?? '-'} |
| 言語 | ${profile.languages.length === 0 ? '-' : profile.languages.join(', ')} |
| API route | ${profile.has_api_routes ? 'あり' : 'なし'} |
| DB | ${profile.has_database ? profile.database.join(', ') || 'あり' : 'なし'} |
| 認証 | ${profile.has_auth ? profile.auth.join(', ') || 'あり' : 'なし'} |
| 配信 | ${profile.deployment.length === 0 ? '-' : profile.deployment.join(', ')} |

## View

${renderArchitectureViewTable(profile)}

## 適用チェック

${checkCatalog.applicable_checks.map((check) => `- ${check}`).join('\n')}

## 根拠

${profile.evidence.length === 0 ? '- なし' : profile.evidence.map((item) => `- ${item.kind}: ${item.file ?? '-'} ${item.detail ?? ''}`.trim()).join('\n')}
`;
}

function renderStaticSiteCheck({ runId, staticSite, profile }) {
  const title = profile?.app_type === 'static_site' ? '静的サイト診断結果' : '共通スキャン結果';
  return `# ${title}

| 項目 | 内容 |
|------|------|
| Run ID | ${runId} |
| index.html | ${staticSite.has_index_html ? 'あり' : 'なし'} |
| 走査ファイル | ${staticSite.scanned_files}件 |
| 秘密情報候補 | ${staticSite.secret_hits.length}件 |
| XSSリスク候補 | ${staticSite.xss_risk_hits.length}件 |
| 外部リソース | ${staticSite.external_resources.length}件 |
| 非静的ファイル候補 | ${staticSite.non_static_files.length}件 |

## 秘密情報候補

${staticSite.secret_hits.length === 0 ? '- なし' : staticSite.secret_hits.map((hit) => `- ${hit.file}:${hit.line} ${hit.kind} \`${hit.excerpt}\``).join('\n')}

## XSSリスク候補

${staticSite.xss_risk_hits.length === 0 ? '- なし' : staticSite.xss_risk_hits.map((hit) => `- ${hit.file}:${hit.line} ${hit.kind} \`${hit.excerpt}\``).join('\n')}

## 外部リソース

${staticSite.external_resources.length === 0 ? '- なし' : staticSite.external_resources.map((resource) => `- ${resource.file}:${resource.line} ${resource.tag} ${resource.url}`).join('\n')}

## 非静的ファイル候補

${staticSite.non_static_files.length === 0 ? '- なし' : staticSite.non_static_files.map((file) => `- ${file.file} (${file.extension})`).join('\n')}
`;
}

function renderRiskRegister({ runId, findings }) {
  return `# VibePro リスク台帳

| 項目 | 内容 |
|------|------|
| Run ID | ${runId} |
| 検出リスク | ${findings.length}件 |

| ID | カテゴリ | リスク概要 | 深刻度 | 推奨対応 |
|----|----------|------------|--------|----------|
${findings.length === 0 ? '| - | - | 検出なし | - | - |' : findings.map((finding) => `| ${finding.id} | ${finding.category} | ${finding.title} | ${finding.severity} | ${finding.recommendation} |`).join('\n')}
`;
}
