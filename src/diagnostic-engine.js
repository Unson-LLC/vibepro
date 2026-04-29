import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { scanApiBoundary } from './api-boundary-scanner.js';
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
  evidence.action_candidates = buildActionCandidates(evidence);
  evidence.gates = buildGates(findings);

  const evidencePath = path.join(runDir, 'evidence.json');
  const summaryPath = path.join(runDir, 'summary.md');
  const riskPath = path.join(runDir, 'risk-register.md');
  const staticSitePath = path.join(runDir, 'static-site-check-result.md');
  const architectureProfilePath = path.join(runDir, 'architecture-profile.md');

  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(summaryPath, renderSummary({ runId, evidence, findings }));
  await writeFile(riskPath, renderRiskRegister({
    runId,
    findings,
    apiBoundary: evidence.api_boundary,
    actionCandidates: evidence.action_candidates
  }));
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
  const checkCatalog = {
    selected_views: architectureProfile.selected_views,
    applicable_checks: architectureProfile.applicable_checks
  };
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
    check_catalog: checkCatalog,
    api_boundary: architectureProfile.applicable_checks.includes('api-boundary')
      ? await scanApiBoundary(repoRoot, architectureProfile)
      : null,
    static_site: await scanStaticSite(repoRoot),
    action_candidates: [],
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
  const gateSecretHits = filterGateRelevant(evidence.static_site.secret_hits);
  const gateXssHits = filterGateRelevant(evidence.static_site.xss_risk_hits);
  if (applicableChecks.has('secrets') && gateSecretHits.length > 0) {
    const secretSummary = summarizeGateEffects(evidence.static_site.secret_hits);
    findings.push({
      id: 'VP-STATIC-002',
      severity: secretSummary.block > 0 ? 'Critical' : 'High',
      category: 'セキュリティ',
      title: '秘密情報の可能性がある値が含まれている',
      detail: `${gateSecretHits.length} 件のgate対象の秘密情報候補を検出した。内訳: ${formatGateSummary(secretSummary)}。`,
      recommendation: '公開前に該当値を削除し、必要な値はサーバー側または安全な環境変数管理へ移す。'
    });
  }
  if (applicableChecks.has('xss') && gateXssHits.length > 0) {
    const xssSummary = summarizeGateEffects(evidence.static_site.xss_risk_hits);
    findings.push({
      id: 'VP-STATIC-003',
      severity: 'High',
      category: 'セキュリティ',
      title: 'XSS につながり得る DOM 操作がある',
      detail: `${gateXssHits.length} 件のgate対象の危険なDOM操作候補を検出した。内訳: ${formatGateSummary(xssSummary)}。`,
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
  if (applicableChecks.has('api-boundary') && evidence.api_boundary) {
    const privilegedUnprotected = evidence.api_boundary.routes
      .filter((route) => route.risk_hints.includes('privileged_route_unprotected'));
    if (privilegedUnprotected.length > 0) {
      const statusSummary = summarizeProtectionForRoutes(privilegedUnprotected);
      findings.push({
        id: 'VP-API-001',
        severity: 'High',
        category: 'API境界',
        title: '管理系または内部系APIの保護根拠が不足している',
        detail: `${privilegedUnprotected.length} 件の管理系または内部系API候補で保護根拠が不足している。状態別: ${formatInlineSummary(statusSummary)}。`,
        recommendation: 'APIを除外しているmiddleware matcher、route内の認証参照、署名検証のいずれで保護するかを明示する。'
      });
    }
    const debugExposed = evidence.api_boundary.routes
      .filter((route) => route.risk_hints.includes('debug_route_exposed'));
    if (debugExposed.length > 0) {
      findings.push({
        id: 'VP-API-002',
        severity: 'High',
        category: 'API境界',
        title: 'debug/test API候補が公開面に残っている',
        detail: `${debugExposed.length} 件のdebug/test API候補で保護根拠が確認できない。`,
        recommendation: '公開環境から削除するか、認証・環境制限・ルーティング制限を明示する。'
      });
    }
    const webhooksWithoutSignature = evidence.api_boundary.routes
      .filter((route) => route.risk_hints.includes('webhook_signature_not_detected'));
    if (webhooksWithoutSignature.length > 0) {
      findings.push({
        id: 'VP-API-003',
        severity: 'High',
        category: 'API境界',
        title: 'webhook APIの署名検証が確認できない',
        detail: `${webhooksWithoutSignature.length} 件のwebhook API候補で署名検証らしき実装が確認できない。`,
        recommendation: 'Webhook送信元の署名検証、リプレイ対策、許可イベントの検証を実装または明示する。'
      });
    }
  }
  return findings;
}

function buildActionCandidates(evidence) {
  const candidates = [];
  const apiBoundary = evidence.api_boundary;
  if (!apiBoundary) return candidates;

  const privilegedUnprotected = apiBoundary.routes
    .filter((route) => route.risk_hints.includes('privileged_route_unprotected'));
  if (privilegedUnprotected.length > 0) {
    candidates.push({
      id: 'VP-ACTION-API-001',
      finding_id: 'VP-API-001',
      scope: 'api_boundary',
      title: '管理系または内部系APIの保護方針を決める',
      target_count: privilegedUnprotected.length,
      execution_policy: 'proposal_only',
      mutates_repository: false,
      confidence: privilegedUnprotected.some((route) => route.protection?.status === 'unknown') ? 'medium' : 'high',
      recommendation: 'middlewareでAPIを保護するか、route内認証を追加するかを決め、対象routeごとに保護根拠を明示する。',
      route_examples: buildRouteExamples(privilegedUnprotected)
    });
  }

  const debugExposed = apiBoundary.routes
    .filter((route) => route.risk_hints.includes('debug_route_exposed'));
  if (debugExposed.length > 0) {
    candidates.push({
      id: 'VP-ACTION-API-002',
      finding_id: 'VP-API-002',
      scope: 'api_boundary',
      title: 'debug/test APIの公開可否を確認する',
      target_count: debugExposed.length,
      execution_policy: 'proposal_only',
      mutates_repository: false,
      confidence: 'high',
      recommendation: '本番公開が不要なdebug/test APIは削除し、必要な場合は認証または環境制限を明示する。',
      route_examples: buildRouteExamples(debugExposed)
    });
  }

  const webhooksWithoutSignature = apiBoundary.routes
    .filter((route) => route.risk_hints.includes('webhook_signature_not_detected'));
  if (webhooksWithoutSignature.length > 0) {
    candidates.push({
      id: 'VP-ACTION-API-003',
      finding_id: 'VP-API-003',
      scope: 'api_boundary',
      title: 'webhook APIの署名検証方針を確認する',
      target_count: webhooksWithoutSignature.length,
      execution_policy: 'proposal_only',
      mutates_repository: false,
      confidence: 'high',
      recommendation: 'Webhook送信元の署名検証、リプレイ対策、許可イベントの検証を実装または明示する。',
      route_examples: buildRouteExamples(webhooksWithoutSignature)
    });
  }

  return candidates;
}

function buildRouteExamples(routes) {
  return routes.slice(0, 10).map((route) => ({
    route_path: route.route_path,
    classification: route.classification,
    protection_status: route.protection?.status ?? 'unknown',
    risk_hints: route.risk_hints ?? []
  }));
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
| 秘密情報候補 | ${formatRiskCount(evidence.static_site.secret_hits, evidence.static_site.risk_summary?.secret_hits)} |
| XSSリスク候補 | ${formatRiskCount(evidence.static_site.xss_risk_hits, evidence.static_site.risk_summary?.xss_risk_hits)} |
| API route | ${evidence.api_boundary?.route_count ?? 0}件 |
| 検出事項 | ${findings.length}件 |

## アーキテクチャView

${renderArchitectureViewTable(profile)}

## API境界

${renderApiBoundarySummary(evidence.api_boundary)}

## ゲート状態

${evidence.gates.map((gate) => `- ${gate.id}: ${gate.status} - ${gate.reason}`).join('\n')}

## 主な検出事項

${findings.length === 0 ? '- なし' : findings.map((finding) => `- ${finding.id}: ${finding.title}（${finding.severity}）`).join('\n')}

## 次アクション候補

${renderActionCandidates(evidence.action_candidates)}
`;
}

function renderApiBoundarySummary(apiBoundary) {
  if (!apiBoundary) return '- api-boundary は適用されていない';
  const summary = apiBoundary.summary ?? {};
  const rows = Object.entries(summary)
    .map(([classification, count]) => `| ${classification} | ${count} |`)
    .join('\n');
  const protectionRows = Object.entries(apiBoundary.protection_summary ?? {})
    .map(([status, count]) => `| ${status} | ${count} |`)
    .join('\n');
  return `### 分類別

| 分類 | 件数 |
|------|------|
${rows || '| - | 0 |'}

### 保護状態別

| 保護状態 | 件数 |
|----------|------|
${protectionRows || '| - | 0 |'}`;
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
| 秘密情報候補 | ${formatRiskCount(staticSite.secret_hits, staticSite.risk_summary?.secret_hits)} |
| XSSリスク候補 | ${formatRiskCount(staticSite.xss_risk_hits, staticSite.risk_summary?.xss_risk_hits)} |
| 外部リソース | ${staticSite.external_resources.length}件 |
| 非静的ファイル候補 | ${staticSite.non_static_files.length}件 |

## 秘密情報候補

${staticSite.secret_hits.length === 0 ? '- なし' : staticSite.secret_hits.map((hit) => `- ${hit.file}:${hit.line} ${hit.kind} source_kind=${hit.source_kind ?? '-'} confidence=${hit.confidence ?? '-'} gate_effect=${hit.gate_effect ?? '-'} \`${hit.excerpt}\``).join('\n')}

## XSSリスク候補

${staticSite.xss_risk_hits.length === 0 ? '- なし' : staticSite.xss_risk_hits.map((hit) => `- ${hit.file}:${hit.line} ${hit.kind} source_kind=${hit.source_kind ?? '-'} confidence=${hit.confidence ?? '-'} gate_effect=${hit.gate_effect ?? '-'} \`${hit.excerpt}\``).join('\n')}

## 外部リソース

${staticSite.external_resources.length === 0 ? '- なし' : staticSite.external_resources.map((resource) => `- ${resource.file}:${resource.line} ${resource.tag} ${resource.url}`).join('\n')}

## 非静的ファイル候補

${staticSite.non_static_files.length === 0 ? '- なし' : staticSite.non_static_files.map((file) => `- ${file.file} (${file.extension})`).join('\n')}
`;
}

function renderRiskRegister({ runId, findings, apiBoundary, actionCandidates }) {
  return `# VibePro リスク台帳

| 項目 | 内容 |
|------|------|
| Run ID | ${runId} |
| 検出リスク | ${findings.length}件 |

| ID | カテゴリ | リスク概要 | 深刻度 | 推奨対応 |
|----|----------|------------|--------|----------|
${findings.length === 0 ? '| - | - | 検出なし | - | - |' : findings.map((finding) => `| ${finding.id} | ${finding.category} | ${finding.title} | ${finding.severity} | ${finding.recommendation} |`).join('\n')}

## API境界の保護状態

${renderApiProtectionStateTable(apiBoundary)}

## 次アクション候補

${renderActionCandidates(actionCandidates)}
`;
}

function renderActionCandidates(candidates) {
  const items = Array.isArray(candidates) ? candidates : [];
  if (items.length === 0) return '- なし';
  return `| ID | 対応する検出事項 | 候補 | 対象 | 方針 |
|----|------------------|------|------|------|
${items.map((candidate) => `| ${candidate.id} | ${candidate.finding_id} | ${candidate.title} | ${candidate.target_count}件 | ${candidate.execution_policy} / mutates_repository=${candidate.mutates_repository} |`).join('\n')}`;
}

function renderApiProtectionStateTable(apiBoundary) {
  if (!apiBoundary) return '- api-boundary は適用されていない';
  const rows = Object.entries(apiBoundary.protection_summary ?? {})
    .map(([status, count]) => `| ${status} | ${count} |`)
    .join('\n');
  return `| 保護状態 | 件数 |
|----------|------|
${rows || '| - | 0 |'}`;
}

function summarizeProtectionForRoutes(routes) {
  const summary = {};
  for (const route of routes) {
    const status = route.protection?.status ?? 'unknown';
    summary[status] = (summary[status] ?? 0) + 1;
  }
  return summary;
}

function formatInlineSummary(summary) {
  const entries = Object.entries(summary);
  if (entries.length === 0) return '-';
  return entries.map(([key, count]) => `${key}: ${count}件`).join(', ');
}

function filterGateRelevant(hits = []) {
  return hits.filter((hit) => hit.gate_effect === 'block' || hit.gate_effect === 'review');
}

function summarizeGateEffects(hits = []) {
  const summary = { block: 0, review: 0, info: 0 };
  for (const hit of hits) {
    if (hit.gate_effect === 'block') summary.block += 1;
    else if (hit.gate_effect === 'review') summary.review += 1;
    else summary.info += 1;
  }
  return summary;
}

function formatGateSummary(summary = {}) {
  return `block: ${summary.block ?? 0}件, review: ${summary.review ?? 0}件, info: ${summary.info ?? 0}件`;
}

function formatRiskCount(hits = [], summary = null) {
  const effectiveSummary = summary ?? summarizeGateEffects(hits);
  return `${hits.length}件 (${formatGateSummary(effectiveSummary)})`;
}
