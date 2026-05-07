import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { scanApiBoundary } from './api-boundary-scanner.js';
import { profileArchitecture } from './architecture-profiler.js';
import { scanCodeQuality } from './code-quality-scanner.js';
import { scanComponentStyle } from './component-style-scanner.js';
import { scanDatabaseAccess } from './database-access-scanner.js';
import {
  buildRefactoringActionCandidates,
  buildRefactoringCampaigns,
  buildRefactoringOpportunities
} from './refactoring-opportunity-generator.js';
import {
  buildRefactoringDelta,
  renderRefactoringDelta,
  renderRefactoringDeltaCompact
} from './refactoring-delta-reporter.js';
import {
  buildGraphContextForFiles,
  buildGraphContextForRoutes,
  buildGraphIndex,
  emptyGraphContext,
  normalizeGraphEdges,
  normalizeGraphPath
} from './graph-context.js';
import { buildRequirementConsistency, renderRequirementConsistencyReport } from './requirement-consistency.js';
import { scanStaticSite } from './static-site-scanner.js';
import { resolveStoryContext } from './story-manager.js';
import { createStoryTasks } from './story-task-generator.js';
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
  const manifest = await readManifest(root);
  const { evidence, graphIndex } = await buildEvidence(root, graph, runId, currentStory);
  evidence.requirement_consistency = await buildRequirementConsistency(root, {
    story: currentStory
  });
  const findings = buildFindings(evidence);
  evidence.findings = findings;
  evidence.action_candidates = await buildActionCandidates(root, evidence, graphIndex);
  attachFindingGraphContexts(evidence.findings, evidence.action_candidates);
  evidence.finding_review = buildFindingReview({ findings, actionCandidates: evidence.action_candidates });
  evidence.gates = buildGates(findings);
  const previousRun = findPreviousStoryRun(manifest, currentStory.story_id, runId);
  evidence.refactoring_delta = buildRefactoringDelta({
    beforeEvidence: await readRunEvidenceIfExists(root, previousRun),
    afterEvidence: evidence,
    beforeRun: previousRun
  });
  const gateStatus = evidence.gates[0]?.status ?? 'unknown';
  const storyTasks = await createStoryTasks(root, {
    story: currentStory,
    evidence,
    runId,
    gateStatus
  });

  const evidencePath = path.join(runDir, 'evidence.json');
  const summaryPath = path.join(runDir, 'summary.md');
  const riskPath = path.join(runDir, 'risk-register.md');
  const staticSitePath = path.join(runDir, 'static-site-check-result.md');
  const componentStylePath = path.join(runDir, 'component-style-check-result.md');
  const architectureProfilePath = path.join(runDir, 'architecture-profile.md');
  const findingReviewPath = path.join(runDir, 'finding-review.md');
  const refactoringDeltaPath = path.join(runDir, 'refactoring-delta.md');
  const requirementConsistencyPath = path.join(runDir, 'requirement-consistency.md');

  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(summaryPath, renderSummary({ runId, evidence, findings }));
  await writeFile(riskPath, renderRiskRegister({
    runId,
    findings,
    apiBoundary: evidence.api_boundary,
    actionCandidates: evidence.action_candidates,
    findingReview: evidence.finding_review
  }));
  await writeFile(staticSitePath, renderStaticSiteCheck({
    runId,
    staticSite: evidence.static_site,
    profile: evidence.architecture_profile
  }));
  await writeFile(componentStylePath, renderComponentStyleCheck({
    runId,
    componentStyle: evidence.component_style
  }));
  await writeFile(architectureProfilePath, renderArchitectureProfile({
    runId,
    profile: evidence.architecture_profile,
    checkCatalog: evidence.check_catalog
  }));
  await writeFile(findingReviewPath, renderFindingReview({
    runId,
    findingReview: evidence.finding_review
  }));
  await writeFile(refactoringDeltaPath, renderRefactoringDelta(evidence.refactoring_delta));
  await writeFile(requirementConsistencyPath, renderRequirementConsistencyReport(evidence.requirement_consistency));

  const run = {
    run_id: runId,
    story_id: currentStory.story_id,
    story: currentStory,
    created_at: new Date().toISOString(),
    gate_status: gateStatus,
    artifacts: {
      summary: toWorkspaceRelative(root, summaryPath),
      risk_register: toWorkspaceRelative(root, riskPath),
      evidence: toWorkspaceRelative(root, evidencePath),
      static_site_check: toWorkspaceRelative(root, staticSitePath),
      component_style_check: toWorkspaceRelative(root, componentStylePath),
      architecture_profile: toWorkspaceRelative(root, architectureProfilePath),
      finding_review: toWorkspaceRelative(root, findingReviewPath),
      refactoring_delta: toWorkspaceRelative(root, refactoringDeltaPath),
      requirement_consistency: toWorkspaceRelative(root, requirementConsistencyPath),
      ...storyTasks.artifacts
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

function findPreviousStoryRun(manifest, storyId, currentRunId) {
  const runs = (manifest?.runs ?? []).filter((run) => run?.run_id && run.run_id !== currentRunId);
  const latestRunIdForStory = manifest?.latest_run_by_story?.[storyId];
  return runs.find((run) => run.run_id === latestRunIdForStory)
    ?? runs.find((run) => run.story_id === storyId)
    ?? runs.find((run) => run.run_id === manifest?.latest_run)
    ?? runs[0]
    ?? null;
}

async function readRunEvidenceIfExists(repoRoot, run) {
  const evidencePath = run?.artifacts?.evidence;
  if (!evidencePath) return null;
  try {
    return JSON.parse(await readFile(path.resolve(repoRoot, evidencePath), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function buildEvidence(repoRoot, graph, runId, story) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const { edges, sourceKey: edgeSourceKey } = normalizeGraphEdges(graph);
  const extractedEdges = edges.filter((edge) => edge.confidence === 'EXTRACTED');
  const inferredEdges = edges.filter((edge) => edge.confidence === 'INFERRED');
  const ambiguousEdges = edges.filter((edge) => edge.confidence === 'AMBIGUOUS');
  const graphIndex = buildGraphIndex({ nodes, edges });
  const architectureProfile = await profileArchitecture(repoRoot);
  const checkCatalog = {
    selected_views: architectureProfile.selected_views,
    applicable_checks: architectureProfile.applicable_checks
  };
  const evidence = {
    schema_version: '0.1.0',
    run_id: runId,
    story_id: story.story_id,
    story,
    graphify: {
      node_count: nodes.length,
      edge_count: edges.length,
      edge_source_key: edgeSourceKey,
      extracted_edges: extractedEdges,
      inferred_edges: inferredEdges,
      ambiguous_edges: ambiguousEdges,
      quality_notices: buildGraphQualityNotices({ inferredEdges })
    },
    architecture_profile: architectureProfile,
    check_catalog: checkCatalog,
    api_boundary: architectureProfile.applicable_checks.includes('api-boundary')
      ? await scanApiBoundary(repoRoot, architectureProfile)
      : null,
    database_access: architectureProfile.applicable_checks.includes('database-access')
      ? await scanDatabaseAccess(repoRoot)
      : null,
    code_quality: architectureProfile.applicable_checks.includes('code-quality')
      ? await scanCodeQuality(repoRoot)
      : null,
    static_site: await scanStaticSite(repoRoot),
    component_style: architectureProfile.applicable_checks.includes('component-style')
      ? await scanComponentStyle(repoRoot)
      : null,
    refactoring_opportunities: [],
    refactoring_campaigns: [],
    action_candidates: [],
    findings: [],
    finding_review: {
      schema_version: '0.1.0',
      status: 'not_generated',
      items: [],
      summary: {}
    },
    requirement_consistency: {
      schema_version: '0.1.0',
      status: 'not_generated',
      summary: {},
      invariants: [],
      scenario_gaps: [],
      contradictions: [],
      policy_refs: [],
      code_scenarios: []
    },
    gates: []
  };
  evidence.refactoring_opportunities = attachRefactoringGraphContexts(
    buildRefactoringOpportunities(evidence),
    graphIndex
  );
  evidence.refactoring_campaigns = buildRefactoringCampaigns(evidence);

  return { graphIndex, evidence };
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
  if (applicableChecks.has('database-access') && evidence.database_access) {
    const unboundedQueries = filterGateRelevant(evidence.database_access.unbounded_find_many);
    if (unboundedQueries.length > 0) {
      const querySummary = summarizeGateEffects(evidence.database_access.unbounded_find_many);
      findings.push({
        id: 'VP-DB-001',
        severity: 'Medium',
        category: 'パフォーマンス',
        title: '未ページングのDB一覧取得候補がある',
        detail: `${unboundedQueries.length} 件のruntime queryで件数上限のない Prisma findMany 候補を検出した。内訳: ${formatGateSummary(querySummary)}。`,
        recommendation: '公開APIやユーザー操作に紐づく一覧取得には take/skip/cursor 等の上限を設け、必要ならページング仕様をStoryに落とす。'
      });
    }
  }
  if (applicableChecks.has('code-quality') && evidence.code_quality) {
    const authorizationOrderRisks = filterGateRelevant(evidence.code_quality.authorization_order_risks);
    if (authorizationOrderRisks.length > 0) {
      const authzSummary = summarizeGateEffects(evidence.code_quality.authorization_order_risks);
      findings.push({
        id: 'VP-SEC-004',
        severity: 'High',
        category: 'セキュリティ',
        title: '認可判定前に一覧・集計DB取得候補がある',
        detail: `${authorizationOrderRisks.length} 件のruntime codeで403/Access denied判定より前にbulk DB read候補を検出した。内訳: ${formatGateSummary(authzSummary)}。`,
        recommendation: '所有者確認や権限判定を先に行い、一覧・集計・外部I/Oは認可後に移動する。'
      });
    }
    const duplicateQueryShapes = filterGateRelevant(evidence.code_quality.duplicate_query_shapes);
    if (duplicateQueryShapes.length > 0) {
      const duplicateSummary = summarizeGateEffects(evidence.code_quality.duplicate_query_shapes);
      findings.push({
        id: 'VP-DRY-001',
        severity: 'Medium',
        category: 'リファクタリング',
        title: '重複したDB query形状の候補がある',
        detail: `${duplicateQueryShapes.length} 種類のPrisma query形状が複数箇所に出現している。内訳: ${formatGateSummary(duplicateSummary)}。`,
        recommendation: '同じwhere/select/orderByを繰り返す箇所は、用途が同じならservice/helperへ集約し、違う用途なら責務境界をStoryで明示する。'
      });
    }
    const responsibilityHotspots = filterGateRelevant(evidence.code_quality.responsibility_hotspots);
    if (responsibilityHotspots.length > 0) {
      const hotspotSummary = summarizeGateEffects(evidence.code_quality.responsibility_hotspots);
      findings.push({
        id: 'VP-ARCH-001',
        severity: 'Medium',
        category: '責務分離',
        title: '責務が混在している大きなruntime file候補がある',
        detail: `${responsibilityHotspots.length} 件のruntime fileで、DB・認証・検証・外部I/Oなど複数責務の集中を検出した。内訳: ${formatGateSummary(hotspotSummary)}。`,
        recommendation: 'route/action/serviceの境界を見直し、DB取得、認可、入力検証、通知・外部I/O、レスポンス整形を分離するStoryに落とす。'
      });
    }
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
  if (applicableChecks.has('component-style') && evidence.component_style) {
    const legacyStyleHits = filterGateRelevant(evidence.component_style.legacy_style_hits);
    if (legacyStyleHits.length > 0) {
      const legacySummary = summarizeGateEffects(evidence.component_style.legacy_style_hits);
      findings.push({
        id: 'VP-UI-001',
        severity: 'Medium',
        category: 'UI品質',
        title: '旧デザインコンポーネントのトークン候補が残っている',
        detail: `${legacyStyleHits.length} 件のUI sourceで旧デザイン由来の色・角丸・影トークン候補を検出した。内訳: ${formatGateSummary(legacySummary)}。`,
        recommendation: '対象コンポーネントをdesign tokenまたは新しいcomponent styleへ置き換え、スクリーンショット証跡で確認する。'
      });
    }
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
  if (evidence.requirement_consistency?.status === 'contradicted') {
    findings.push({
      id: 'VP-REQ-001',
      severity: 'High',
      category: '要件整合性',
      title: 'Story要件とコード上の状態遷移が矛盾している可能性がある',
      detail: `${evidence.requirement_consistency.summary?.contradiction_count ?? 0} 件の要件矛盾候補を検出した。`,
      recommendation: 'Story不変条件、実装分岐、テスト期待値を突き合わせ、業務ルールとして正しい状態遷移を明示する。'
    });
  } else if (evidence.requirement_consistency?.status === 'needs_review') {
    findings.push({
      id: 'VP-REQ-002',
      severity: 'Medium',
      category: '要件整合性',
      title: 'Storyに明示されていない重要シナリオ分岐がある',
      detail: `${evidence.requirement_consistency.summary?.scenario_gap_count ?? 0} 件のシナリオ確認候補を検出した。`,
      recommendation: '受け入れ基準に重要分岐を追加するか、既存ポリシーへの参照をStoryに残す。'
    });
  }
  return findings;
}

function buildGraphQualityNotices({ inferredEdges }) {
  const notices = [];
  if (inferredEdges.length > 0) {
    notices.push({
      id: 'VP-GRAPH-002',
      level: 'info',
      category: '文脈品質',
      title: '推論された依存関係がある',
      detail: `graphify が ${inferredEdges.length} 件の推論関係を検出した。`,
      recommendation: '推論関係は診断質問として扱い、検証済み事実として扱わない。'
    });
  }
  return notices;
}

async function buildActionCandidates(repoRoot, evidence, graphIndex) {
  const candidates = [];
  const apiBoundary = evidence.api_boundary;

  if (apiBoundary) {
    const privilegedUnprotected = apiBoundary.routes
      .filter((route) => route.risk_hints.includes('privileged_route_unprotected'));
    if (privilegedUnprotected.length > 0) {
      const graphContext = buildGraphContextForRoutes(privilegedUnprotected, graphIndex);
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
        route_examples: buildRouteExamples(privilegedUnprotected),
        graph_context: graphContext,
        implementation_plan: await buildImplementationPlanForAction({
          repoRoot,
          actionId: 'VP-ACTION-API-001',
          routes: privilegedUnprotected,
          apiBoundary,
          graphContext
        })
      });
    }

    const debugExposed = apiBoundary.routes
      .filter((route) => route.risk_hints.includes('debug_route_exposed'));
    if (debugExposed.length > 0) {
      const graphContext = buildGraphContextForRoutes(debugExposed, graphIndex);
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
        route_examples: buildRouteExamples(debugExposed),
        graph_context: graphContext,
        implementation_plan: await buildImplementationPlanForAction({
          repoRoot,
          actionId: 'VP-ACTION-API-002',
          routes: debugExposed,
          apiBoundary,
          graphContext
        })
      });
    }

    const webhooksWithoutSignature = apiBoundary.routes
      .filter((route) => route.risk_hints.includes('webhook_signature_not_detected'));
    if (webhooksWithoutSignature.length > 0) {
      const graphContext = buildGraphContextForRoutes(webhooksWithoutSignature, graphIndex);
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
        route_examples: buildRouteExamples(webhooksWithoutSignature),
        graph_context: graphContext,
        implementation_plan: await buildImplementationPlanForAction({
          repoRoot,
          actionId: 'VP-ACTION-API-003',
          routes: webhooksWithoutSignature,
          apiBoundary,
          graphContext
        })
      });
    }
  }

  candidates.push(...buildRefactoringActionCandidates(evidence));
  return candidates;
}

async function buildImplementationPlanForAction({ repoRoot, actionId, routes, apiBoundary, graphContext }) {
  const readFirstFiles = buildReadFirstFiles({ routes, apiBoundary, graphContext });
  const preFixBriefing = await buildPreFixBriefingForAction({
    repoRoot,
    actionId,
    routes,
    apiBoundary,
    graphContext,
    readFirstFiles
  });
  return {
    priority: resolveImplementationPriority({ actionId, routes, graphContext }),
    rationale: buildImplementationRationale({ routes, graphContext }),
    read_first_files: readFirstFiles,
    steps: buildImplementationSteps(actionId),
    acceptance_criteria: buildAcceptanceCriteria(actionId),
    pre_fix_briefing: preFixBriefing
  };
}

async function buildPreFixBriefingForAction({ repoRoot, actionId, routes, apiBoundary, graphContext, readFirstFiles }) {
  const codeSignals = await buildCodeSignalsForFiles(repoRoot, readFirstFiles.map((item) => item.file));
  const authHelpers = buildAuthHelpers({ actionId, routes, codeSignals });
  return {
    current_boundary: buildCurrentBoundary({ apiBoundary, routes }),
    auth_helpers: authHelpers,
    target_routes: routes.map((route) => ({
      file: route.file,
      route_path: route.route_path,
      methods: route.methods ?? [],
      classification: route.classification,
      protection_status: route.protection?.status ?? 'unknown',
      protection_evidence: route.protection?.evidence ?? [],
      risk_hints: route.risk_hints ?? []
    })),
    code_signals: codeSignals,
    strategy_options: buildStrategyOptions({ actionId, routes, graphContext, codeSignals, authHelpers }),
    recommended_strategy: buildRecommendedStrategy({ actionId, routes, apiBoundary, codeSignals })
  };
}

function buildCurrentBoundary({ apiBoundary, routes }) {
  return {
    middleware: {
      matchers: apiBoundary.middleware?.matchers ?? [],
      excludes_api: (apiBoundary.middleware?.matchers ?? []).some((matcher) => matcher.includes('(?!api') || matcher.includes('(?!/api')),
      files: apiBoundary.middleware?.evidence ?? []
    },
    route_protection: summarizeProtectionForRoutes(routes)
  };
}

async function buildCodeSignalsForFiles(repoRoot, files) {
  const signals = [];
  for (const file of files) {
    const content = await readTextIfExists(path.join(repoRoot, file));
    if (!content) continue;
    signals.push(extractCodeSignals(file, content));
  }
  return signals;
}

function extractCodeSignals(file, content) {
  const code = stripCodeComments(content);
  const functionNames = [
    ...code.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g),
    ...code.matchAll(/function\s+([A-Za-z0-9_$]+)/g),
    ...code.matchAll(/export\s+const\s+([A-Za-z0-9_$]+)\s*=/g)
  ].map((match) => match[1]);
  const imports = [...code.matchAll(/import\s+[^'"]*['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .slice(0, 20);
  return {
    file,
    functions: [...new Set(functionNames)],
    imports: [...new Set(imports)],
    auth_references: extractMatches(code, [
      /\b(auth\.api\.getSession|getServerSession|requireAuth|currentUser|getSession|validateSession|authenticateApiKey)\b/g,
      /\b(session|token|authorization|Bearer)\b/gi
    ]),
    signature_references: extractMatches(code, [
      /\b(signature|stripe-signature|verifyWebhook|verifySignature|constructEvent|webhooks\.verify|verify)\b/gi
    ]),
    env_guard_references: extractMatches(code, [
      /\b(process\.env\.[A-Z0-9_]+|NODE_ENV)\b/g
    ])
  };
}

function stripCodeComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function extractMatches(content, patterns) {
  const values = [];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      values.push(match[1] ?? match[0]);
    }
  }
  return [...new Set(values)].slice(0, 20);
}

const AUTH_HELPER_PATTERN = /auth|session|user|token/i;
const SIGNATURE_HELPER_PATTERN = /verify|signature|webhook|constructEvent/i;
const ENV_GUARD_PATTERN = /env|environment|nodeEnv|production/i;

function buildAuthHelpers({ actionId, routes, codeSignals }) {
  return codeSignals
    .map((signal) => buildHelperForAction({ actionId, routes, signal }))
    .filter(Boolean);
}

function buildHelperForAction({ actionId, routes, signal }) {
  if (actionId === 'VP-ACTION-API-003') {
    return buildSignatureHelper({ routes, signal });
  }
  if (actionId === 'VP-ACTION-API-002') {
    return buildDebugGuardHelper(signal);
  }
  return buildRouteAuthHelper(signal);
}

function buildRouteAuthHelper(signal) {
  const functions = signal.functions.filter((name) => AUTH_HELPER_PATTERN.test(name)).slice(0, 10);
  if (functions.length === 0 && signal.auth_references.length === 0) return null;
  return {
    category: 'auth',
    file: signal.file,
    functions,
    imports: signal.imports,
    auth_references: signal.auth_references,
    signature_references: [],
    env_guard_references: []
  };
}

function buildDebugGuardHelper(signal) {
  const authFunctions = signal.functions.filter((name) => AUTH_HELPER_PATTERN.test(name));
  const envFunctions = signal.functions.filter((name) => ENV_GUARD_PATTERN.test(name));
  const hasAuthSignal = authFunctions.length > 0 || signal.auth_references.length > 0;
  const hasEnvSignal = envFunctions.length > 0 || signal.env_guard_references.length > 0;
  if (!hasAuthSignal && !hasEnvSignal) return null;
  return {
    category: hasAuthSignal ? 'auth' : 'environment',
    file: signal.file,
    functions: uniqueFiles([...authFunctions, ...envFunctions]).slice(0, 10),
    imports: signal.imports,
    auth_references: hasAuthSignal ? signal.auth_references : [],
    signature_references: [],
    env_guard_references: hasEnvSignal ? signal.env_guard_references : []
  };
}

function buildSignatureHelper({ routes, signal }) {
  const providers = getWebhookProviders(routes);
  const targetRouteFiles = new Set(routes.map((route) => route.file));
  const hasSignatureSignal = signal.functions.some((name) => SIGNATURE_HELPER_PATTERN.test(name))
    || signal.signature_references.length > 0;
  if (!hasSignatureSignal) return null;
  if (providers.length > 0 && !matchesAnyProvider(signal, providers)) return null;
  const functions = signal.functions.filter((name) => SIGNATURE_HELPER_PATTERN.test(name)).slice(0, 10);
  if (targetRouteFiles.has(signal.file) && functions.length === 0) return null;
  if (functions.length === 0 && signal.signature_references.length === 0) return null;
  return {
    category: 'signature',
    file: signal.file,
    functions,
    imports: signal.imports,
    auth_references: [],
    signature_references: signal.signature_references,
    env_guard_references: []
  };
}

function buildStrategyOptions({ actionId, routes, graphContext, codeSignals, authHelpers }) {
  const routeFiles = routes.map((route) => route.file);
  const helperFiles = (authHelpers ?? buildAuthHelpers({ actionId, routes, codeSignals })).map((helper) => helper.file);
  if (actionId === 'VP-ACTION-API-001') {
    return [
      {
        id: 'middleware-matcher',
        label: '方針A: middleware matcherで対象APIを保護する',
        target_count: routes.length,
        candidate_files: uniqueFiles(['src/middleware.ts', ...routeFiles]),
        benefits: ['保護境界を一箇所で管理できる', '対象routeが多い場合に変更点を集約できる'],
        cautions: ['public APIやwebhookを巻き込まないmatcher設計が必要', '現在API全体を除外している場合は設計変更の影響が大きい']
      },
      {
        id: 'route-level-auth',
        label: '方針B: route-level authを各APIに追加する',
        target_count: routes.length,
        candidate_files: uniqueFiles([...routeFiles, ...helperFiles]),
        benefits: ['routeごとに保護根拠が明確になる', 'webhook/public APIを巻き込みにくい'],
        cautions: ['対象route数が多い場合は重複実装を避けるhelper化が必要']
      }
    ];
  }
  if (actionId === 'VP-ACTION-API-002') {
    return [
      {
        id: 'delete-debug-routes',
        label: '方針A: 本番不要なdebug/test APIを削除する',
        target_count: routes.length,
        candidate_files: uniqueFiles(routeFiles),
        benefits: ['公開面を最小化できる', '保護漏れの再発リスクを減らせる'],
        cautions: ['開発・検証運用で使っていないか確認が必要']
      },
      {
        id: 'restrict-debug-routes',
        label: '方針B: 残すrouteへ認証または環境制限を追加する',
        target_count: routes.length,
        candidate_files: uniqueFiles([...routeFiles, ...helperFiles]),
        benefits: ['必要な運用APIを残せる', '段階的に公開面を狭められる'],
        cautions: ['本番環境で無効化されることを診断で確認する必要がある']
      }
    ];
  }
  return [
    {
      id: 'provider-signature-verification',
      label: '方針A: providerごとの署名検証をroute内に追加する',
      target_count: routes.length,
      candidate_files: uniqueFiles(routeFiles),
      benefits: ['送信元仕様に沿った検証をrouteで明示できる', 'VibeProの署名検証検出に乗りやすい'],
      cautions: ['providerごとの署名ヘッダーと再送仕様の確認が必要']
    },
    {
      id: 'connect-existing-helper',
      label: '方針B: 既存helperへ接続する',
      target_count: routes.length,
      candidate_files: uniqueFiles([...routeFiles, ...helperFiles]),
      benefits: ['既存の検証ロジックを再利用できる', '重複実装を避けられる'],
      cautions: ['helperが署名検証、リプレイ対策、許可イベント検証を満たすか確認が必要']
    }
  ];
}

function uniqueFiles(files) {
  return [...new Set(files.filter(Boolean))];
}

function buildRecommendedStrategy({ actionId, routes, apiBoundary, codeSignals }) {
  const excludesApi = (apiBoundary.middleware?.matchers ?? []).some((matcher) => matcher.includes('(?!api') || matcher.includes('(?!/api'));
  const hasSignatureHelper = hasProviderSignatureHelper(routes, codeSignals);
  if (actionId === 'VP-ACTION-API-001') {
    return excludesApi
      ? { id: 'route-level-auth', reason: '現在middlewareがAPI全体を除外しているため、webhook/public APIを巻き込まないroute-level authを優先する。' }
      : { id: 'middleware-matcher', reason: 'middlewareでAPI保護境界を管理できる状態なので、対象routeが多い場合はmatcher集約を優先する。' };
  }
  if (actionId === 'VP-ACTION-API-002') {
    return { id: 'delete-debug-routes', reason: 'debug/test APIは本番公開面から消すのが最も単純で再発しにくい。' };
  }
  return hasSignatureHelper
    ? { id: 'connect-existing-helper', reason: 'graphify hubまたは読取対象に署名検証候補があるため、既存helper接続を優先する。' }
    : { id: 'provider-signature-verification', reason: '既存の署名検証helperが確認できないため、providerごとの検証をrouteに明示する。' };
}

function hasProviderSignatureHelper(routes, codeSignals) {
  const providers = getWebhookProviders(routes);
  if (providers.length === 0) {
    return codeSignals.some((signal) => signal.signature_references.length > 0);
  }
  return codeSignals.some((signal) => (
    (signal.signature_references.length > 0 || signal.functions.some((name) => SIGNATURE_HELPER_PATTERN.test(name)))
    && matchesAnyProvider(signal, providers)
  ));
}

function getWebhookProviders(routes) {
  return routes
    .map((route) => {
      return /\/api\/webhooks\/([^/]+)/.exec(route.route_path)?.[1]
        ?? /\/api\/([^/]+)\/webhook(?:s)?(?:\/|$)/.exec(route.route_path)?.[1]
        ?? /\/webhook(?:s)?\/([^/]+)/.exec(route.route_path)?.[1];
    })
    .filter(Boolean);
}

function matchesAnyProvider(signal, providers) {
  const haystack = [
    signal.file,
    ...signal.functions,
    ...signal.signature_references
  ].join(' ').toLowerCase();
  return providers.some((provider) => haystack.includes(provider.toLowerCase()));
}

function resolveImplementationPriority({ routes, graphContext }) {
  if (routes.length > 0) return 'high';
  if ((graphContext?.related_edge_count ?? 0) > 0) return 'medium';
  return 'low';
}

function buildImplementationRationale({ routes, graphContext }) {
  const context = graphContext ?? emptyGraphContext();
  const topCommunity = context.affected_communities[0];
  const communityText = topCommunity
    ? `最大community ${topCommunity.id} は ${topCommunity.route_count} route / ${topCommunity.node_count} node / ${topCommunity.edge_count} edge。`
    : '対応するgraph communityは未特定。';
  return `${routes.length}件のrouteが対象。graphifyでは ${context.matched_node_count} node / ${context.related_edge_count} edge に接続し、impactは ${context.impact_score}。${communityText}`;
}

function buildReadFirstFiles({ routes, apiBoundary, graphContext }) {
  const files = [];
  const seen = new Set();
  const add = (file, reason) => {
    const normalized = normalizeGraphPath(file ?? '');
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    files.push({ file: normalized, reason });
  };

  for (const route of routes.slice(0, 10)) {
    add(route.file, `対象API route: ${route.route_path}`);
  }
  for (const evidence of apiBoundary.middleware?.evidence ?? []) {
    add(evidence.file, 'API保護方針を確認するmiddleware');
  }
  for (const node of graphContext?.hub_nodes ?? []) {
    add(node.source_file, `graphify hub: ${node.label} (degree ${node.degree})`);
  }

  return files.slice(0, 12);
}

function buildImplementationSteps(actionId) {
  if (actionId === 'VP-ACTION-API-001') {
    return [
      {
        id: 'confirm-protection-boundary',
        title: '保護境界を決める',
        detail: '対象routeをmiddleware matcherで守るか、route内認証で守るかを決める。middleware matcherを使う場合はAPI除外条件との整合を確認する。'
      },
      {
        id: 'add-protection-evidence',
        title: '保護根拠を追加する',
        detail: '選んだ方式に沿って、対象routeごとに認証参照またはmatcher対象であることをコード上に明示する。'
      },
      {
        id: 'rerun-diagnosis',
        title: '診断を再実行する',
        detail: 'VibePro診断を再実行し、対象routeの保護状態とrisk hintが改善したことを確認する。'
      }
    ];
  }
  if (actionId === 'VP-ACTION-API-002') {
    return [
      {
        id: 'classify-debug-route',
        title: '公開要否を判定する',
        detail: 'debug/test APIが本番で不要なら削除する。必要な場合は用途、利用者、公開環境を限定する。'
      },
      {
        id: 'restrict-debug-route',
        title: '公開面を制限する',
        detail: '削除しないrouteには認証、環境変数による本番停止、または内部経路限定を追加する。'
      },
      {
        id: 'rerun-diagnosis',
        title: '診断を再実行する',
        detail: 'VibePro診断を再実行し、debug_route_exposedが残っていないことを確認する。'
      }
    ];
  }
  return [
    {
      id: 'confirm-webhook-provider',
      title: 'Webhook送信元を確認する',
      detail: '送信元ごとの署名ヘッダー、署名方式、許可イベント、再送仕様を確認する。'
    },
    {
      id: 'add-signature-verification',
      title: '署名検証を追加する',
      detail: 'route内で署名検証、リプレイ対策、許可イベント検証を実装または既存実装へ接続する。'
    },
    {
      id: 'rerun-diagnosis',
      title: '診断を再実行する',
      detail: 'VibePro診断を再実行し、webhook_signature_checkが保護根拠として検出されることを確認する。'
    }
  ];
}

function buildAcceptanceCriteria(actionId) {
  if (actionId === 'VP-ACTION-API-001') {
    return [
      '対象routeごとにmiddleware matcherまたはroute内認証の保護根拠が確認できる。',
      'VibePro診断でprivileged_route_unprotectedが対象routeから消える。'
    ];
  }
  if (actionId === 'VP-ACTION-API-002') {
    return [
      '本番不要なdebug/test APIは削除されている。',
      '残すdebug/test APIは認証または環境制限で公開面が限定されている。',
      'VibePro診断でdebug_route_exposedが対象routeから消える。'
    ];
  }
  return [
    'Webhook routeで送信元の署名検証が実行される。',
    'リプレイ対策と許可イベント検証の方針がコード上で確認できる。',
    'VibePro診断でwebhook_signature_checkが保護根拠として検出される。'
  ];
}

function attachFindingGraphContexts(findings, candidates) {
  const contextByFindingId = new Map(
    candidates
      .filter((candidate) => candidate.finding_id && candidate.graph_context)
      .map((candidate) => [candidate.finding_id, candidate.graph_context])
  );
  for (const finding of findings) {
    if (contextByFindingId.has(finding.id)) {
      finding.graph_context = contextByFindingId.get(finding.id);
    }
  }
}

function buildFindingReview({ findings, actionCandidates }) {
  const candidatesByFindingId = new Map(
    actionCandidates
      .filter((candidate) => candidate.finding_id)
      .map((candidate) => [candidate.finding_id, candidate])
  );
  const items = findings.map((finding) => {
    const suggestedClassification = suggestFindingReviewClassification(finding);
    const candidate = candidatesByFindingId.get(finding.id);
    return {
      finding_id: finding.id,
      review_status: 'unreviewed',
      suggested_classification: suggestedClassification,
      allowed_classifications: [
        'true_positive',
        'false_positive',
        'false_negative',
        'detector_gap',
        'implementation_gap'
      ],
      rationale: buildFindingReviewRationale(finding, suggestedClassification),
      review_questions: buildFindingReviewQuestions(finding, suggestedClassification),
      evidence_refs: buildFindingEvidenceRefs(finding, candidate),
      action_candidate_id: candidate?.id ?? null,
      reviewer_notes: ''
    };
  });

  return {
    schema_version: '0.1.0',
    status: findings.length === 0 ? 'no_findings' : 'needs_review',
    policy: 'この分類は初期レビュー票であり、true_positive/false_positive は人間の確認後に確定する。',
    summary: summarizeFindingReview(items),
    items
  };
}

function suggestFindingReviewClassification(finding) {
  if (finding.id?.startsWith('VP-GRAPH-')) return 'detector_gap';
  return 'implementation_gap';
}

function buildFindingReviewRationale(finding, classification) {
  if (classification === 'detector_gap') {
    return `${finding.id} は診断に使う依存関係や文脈の確度に関する検出であり、実装修正より先に検出根拠の確認が必要。`;
  }
  return `${finding.id} は対象リポジトリ内の公開面、API境界、または配信設計に対する実装不足候補として検出された。`;
}

function buildFindingReviewQuestions(finding, classification) {
  const common = [
    '検出根拠は対象リポジトリの現在のコードと一致しているか。',
    '同種の未検出リスクが周辺ファイルに残っていないか。',
    '再診断でこのfindingが消える完了条件を具体化できるか。'
  ];
  if (classification === 'detector_gap') {
    return [
      'graphifyまたはVibePro検出器の根拠は実際の依存関係を表しているか。',
      '検出器のfalse positiveまたはfalse negativeとして修正すべきか。',
      ...common
    ];
  }
  return [
    '実装不足として修正すべきtrue positiveか、既存実装を検出できていないdetector gapか。',
    '本番運用上の例外として受け入れるなら、その根拠をコードまたは設定に残せるか。',
    ...common
  ];
}

function buildFindingEvidenceRefs(finding, candidate) {
  return {
    finding_detail: finding.detail,
    recommendation: finding.recommendation,
    graph_context: finding.graph_context ?? null,
    target_files: candidate?.target_files ?? [],
    route_examples: candidate?.route_examples ?? [],
    implementation_plan: candidate?.implementation_plan ?? null
  };
}

function summarizeFindingReview(items) {
  const summary = {
    total: items.length,
    unreviewed: 0,
    true_positive: 0,
    false_positive: 0,
    false_negative: 0,
    detector_gap: 0,
    implementation_gap: 0
  };
  for (const item of items) {
    summary[item.review_status] = (summary[item.review_status] ?? 0) + 1;
    summary[item.suggested_classification] = (summary[item.suggested_classification] ?? 0) + 1;
  }
  return summary;
}

function attachRefactoringGraphContexts(opportunities, graphIndex) {
  return opportunities.map((opportunity) => ({
    ...opportunity,
    graph_context: buildGraphContextForFiles(opportunity.target_files ?? [], graphIndex)
  }));
}

function buildRouteExamples(routes) {
  return routes.slice(0, 10).map((route) => ({
    file: route.file,
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
| UI旧トークン候補 | ${formatRiskCount(evidence.component_style?.legacy_style_hits ?? [], evidence.component_style?.risk_summary?.legacy_style_hits)} |
| UIコンポーネント種別 | ${(evidence.component_style?.component_kinds ?? []).join(', ') || '-'} |
| DB未ページング候補 | ${formatRiskCount(evidence.database_access?.unbounded_find_many ?? [], evidence.database_access?.risk_summary?.unbounded_find_many)} |
| 認可前bulk DB候補 | ${formatRiskCount(evidence.code_quality?.authorization_order_risks ?? [], evidence.code_quality?.risk_summary?.authorization_order_risks)} |
| 重複query形状候補 | ${formatRiskCount(evidence.code_quality?.duplicate_query_shapes ?? [], evidence.code_quality?.risk_summary?.duplicate_query_shapes)} |
| 責務混在候補 | ${formatRiskCount(evidence.code_quality?.responsibility_hotspots ?? [], evidence.code_quality?.risk_summary?.responsibility_hotspots)} |
| リファクタリング機会 | ${evidence.refactoring_opportunities?.length ?? 0}件 |
| リファクタリングcampaign | ${evidence.refactoring_campaigns?.length ?? 0}件 |
| API route | ${evidence.api_boundary?.route_count ?? 0}件 |
| Requirement Gate | ${evidence.requirement_consistency?.status ?? 'not_generated'} |
| 要件不変条件 | ${evidence.requirement_consistency?.summary?.invariant_count ?? 0}件 |
| シナリオ確認候補 | ${evidence.requirement_consistency?.summary?.scenario_gap_count ?? 0}件 |
| 要件矛盾候補 | ${evidence.requirement_consistency?.summary?.contradiction_count ?? 0}件 |
| 検出事項 | ${findings.length}件 |

## アーキテクチャView

${renderArchitectureViewTable(profile)}

## API境界

${renderApiBoundarySummary(evidence.api_boundary)}

## ゲート状態

${evidence.gates.map((gate) => `- ${gate.id}: ${gate.status} - ${gate.reason}`).join('\n')}

## Requirement Consistency

${renderRequirementConsistencySummary(evidence.requirement_consistency)}

## 主な検出事項

${findings.length === 0 ? '- なし' : findings.map((finding) => `- ${finding.id}: ${finding.title}（${finding.severity}）`).join('\n')}

## 文脈品質ノート

${renderGraphQualityNotices(evidence.graphify?.quality_notices)}

## 診断レビュー

${renderFindingReviewSummary(evidence.finding_review)}

## リファクタリング差分

${renderRefactoringDeltaCompact(evidence.refactoring_delta)}

## 次アクション候補

${renderActionCandidates(evidence.action_candidates)}
`;
}

function renderRequirementConsistencySummary(requirement) {
  if (!requirement) return '- 未生成';
  const gaps = (requirement.scenario_gaps ?? []).slice(0, 5)
    .map((item) => `- Scenario Gap: ${item.detail}`)
    .join('\n');
  const contradictions = (requirement.contradictions ?? []).slice(0, 5)
    .map((item) => `- Potential Contradiction: ${item.detail}`)
    .join('\n');
  return [
    `- Status: ${requirement.status}`,
    `- Invariants: ${requirement.summary?.invariant_count ?? 0}`,
    `- Scenario Gaps: ${requirement.summary?.scenario_gap_count ?? 0}`,
    `- Contradictions: ${requirement.summary?.contradiction_count ?? 0}`,
    gaps,
    contradictions
  ].filter(Boolean).join('\n');
}

function renderGraphQualityNotices(notices) {
  if (!Array.isArray(notices) || notices.length === 0) return '- なし';
  return notices.map((notice) => `- ${notice.id}: ${notice.title}（${notice.level}）`).join('\n');
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

function renderComponentStyleCheck({ runId, componentStyle }) {
  if (!componentStyle) {
    return `# コンポーネントスタイル診断結果

| 項目 | 内容 |
|------|------|
| Run ID | ${runId} |
| 状態 | component-style は適用されていない |
`;
  }
  return `# コンポーネントスタイル診断結果

| 項目 | 内容 |
|------|------|
| Run ID | ${runId} |
| 走査ファイル | ${componentStyle.scanned_files}件 |
| 検出コンポーネント種別 | ${componentStyle.component_kinds.join(', ') || '-'} |
| 旧トークン候補 | ${formatRiskCount(componentStyle.legacy_style_hits, componentStyle.risk_summary?.legacy_style_hits)} |
| design-system marker | ${componentStyle.design_system_markers.length}件 |
| 置換確認可能 | ${componentStyle.coverage?.replacement_observable ? 'yes' : 'no'} |

## コンポーネントInventory

${componentStyle.component_inventory.length === 0 ? '- なし' : componentStyle.component_inventory.slice(0, 80).map((item) => `- ${item.file}:${item.line} ${item.kind} \`${item.excerpt}\``).join('\n')}

## 旧トークン候補

${componentStyle.legacy_style_hits.length === 0 ? '- なし' : componentStyle.legacy_style_hits.map((hit) => `- ${hit.file}:${hit.line} ${hit.kind} token=${hit.token} confidence=${hit.confidence} gate_effect=${hit.gate_effect} \`${hit.excerpt}\``).join('\n')}

## design-system marker

${componentStyle.design_system_markers.length === 0 ? '- なし' : componentStyle.design_system_markers.slice(0, 80).map((marker) => `- ${marker.file}:${marker.line} ${marker.marker} \`${marker.excerpt}\``).join('\n')}
`;
}

function renderRiskRegister({ runId, findings, apiBoundary, actionCandidates, findingReview }) {
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

## 診断レビュー分類

${renderFindingReviewTable(findingReview)}

## 次アクション候補

${renderActionCandidates(actionCandidates)}
`;
}

function renderFindingReview({ runId, findingReview }) {
  return `# VibePro 診断レビュー

| 項目 | 内容 |
|------|------|
| Run ID | ${runId} |
| Status | ${findingReview?.status ?? 'unknown'} |
| Total | ${findingReview?.summary?.total ?? 0}件 |
| Unreviewed | ${findingReview?.summary?.unreviewed ?? 0}件 |
| Suggested implementation_gap | ${findingReview?.summary?.implementation_gap ?? 0}件 |
| Suggested detector_gap | ${findingReview?.summary?.detector_gap ?? 0}件 |

${findingReview?.policy ?? ''}

Allowed classifications: true_positive, false_positive, false_negative, detector_gap, implementation_gap

## 分類表

${renderFindingReviewTable(findingReview)}

## 確認観点

${renderFindingReviewQuestions(findingReview)}
`;
}

function renderFindingReviewSummary(findingReview) {
  const summary = findingReview?.summary ?? {};
  return `- Status: ${findingReview?.status ?? 'unknown'}
- 未レビュー: ${summary.unreviewed ?? 0}件
- suggested implementation_gap: ${summary.implementation_gap ?? 0}件
- suggested detector_gap: ${summary.detector_gap ?? 0}件
- 正本: finding-review.md と evidence.json の finding_review`;
}

function renderFindingReviewTable(findingReview) {
  const items = Array.isArray(findingReview?.items) ? findingReview.items : [];
  if (items.length === 0) return '| Finding | Status | Suggested | Action | Rationale |\n|---------|--------|-----------|--------|-----------|\n| - | - | - | - | - |';
  return `| Finding | Status | Suggested | Action | Rationale |
|---------|--------|-----------|--------|-----------|
${items.map((item) => `| ${item.finding_id} | ${item.review_status} | ${item.suggested_classification} | ${item.action_candidate_id ?? '-'} | ${item.rationale} |`).join('\n')}`;
}

function renderFindingReviewQuestions(findingReview) {
  const items = Array.isArray(findingReview?.items) ? findingReview.items : [];
  if (items.length === 0) return '- なし';
  return items.map((item) => `### ${item.finding_id}

${item.review_questions.map((question) => `- ${question}`).join('\n')}`).join('\n\n');
}

function renderActionCandidates(candidates) {
  const items = Array.isArray(candidates) ? candidates : [];
  if (items.length === 0) return '- なし';
  return `| ID | 対応する検出事項 | 候補 | 対象 | Impact | Community | 読むファイル | 方針 |
|----|------------------|------|------|--------|-----------|------------|------|
${items.map((candidate) => `| ${candidate.id} | ${candidate.finding_id} | ${candidate.title} | ${candidate.target_count}件 | ${formatGraphImpact(candidate.graph_context)} | ${formatGraphCommunities(candidate.graph_context)} | ${formatReadFirstFiles(candidate.implementation_plan)} | ${candidate.execution_policy} / mutates_repository=${candidate.mutates_repository} |`).join('\n')}

${renderImplementationPlans(items)}`;
}

function formatGraphImpact(graphContext) {
  if (!graphContext) return '-';
  return `${graphContext.impact_score ?? 0} (${graphContext.related_edge_count ?? 0} edges)`;
}

function formatGraphCommunities(graphContext) {
  const communities = graphContext?.affected_communities ?? [];
  if (communities.length === 0) return '-';
  return communities
    .slice(0, 3)
    .map((community) => {
      const scope = (community.route_count ?? 0) > 0
        ? `route: ${community.route_count}`
        : `file: ${community.file_count ?? 0}`;
      return `${community.id}(${scope}, node: ${community.node_count}, edge: ${community.edge_count})`;
    })
    .join(', ');
}

function formatReadFirstFiles(implementationPlan) {
  const files = implementationPlan?.read_first_files ?? [];
  if (files.length === 0) return '-';
  return selectRepresentativeReadFirstFiles(files, implementationPlan?.pre_fix_briefing).map((item) => item.file).join('<br>');
}

function selectRepresentativeReadFirstFiles(files, briefing) {
  const selected = [];
  const seen = new Set();
  const add = (item) => {
    if (!item || seen.has(item.file)) return;
    seen.add(item.file);
    selected.push(item);
  };
  const helpers = briefing?.auth_helpers ?? [];
  const helperFiles = new Set(helpers.map((helper) => helper.file));
  const hasSignatureHelper = helpers.some((helper) => helper.category === 'signature');
  add(files[0]);
  add(files.find((item) => helperFiles.has(item.file)));
  add(files.find((item) => item.reason.includes('graphify hub') && helperFiles.has(item.file)));
  if (!hasSignatureHelper) add(files.find((item) => item.reason.includes('middleware')));
  for (const item of files) add(item);
  return selected.slice(0, 3);
}

function renderImplementationPlans(candidates) {
  const items = candidates.filter((candidate) => candidate.implementation_plan);
  if (items.length === 0) return '';
  return `### 実装手順

${items.map((candidate) => renderImplementationPlan(candidate)).join('\n\n')}`;
}

function renderImplementationPlan(candidate) {
  const plan = candidate.implementation_plan;
  return `#### ${candidate.id}: ${candidate.title}

- 優先度: ${plan.priority}
- 理由: ${plan.rationale}
- 読むファイル: ${plan.read_first_files.length === 0 ? '-' : plan.read_first_files.map((item) => `${item.file}（${item.reason}）`).join(', ')}

${renderPreFixBriefing(plan.pre_fix_briefing)}

${plan.steps.map((step, index) => `${index + 1}. ${step.title}: ${step.detail}`).join('\n')}

完了条件:
${plan.acceptance_criteria.map((item) => `- ${item}`).join('\n')}`;
}

function renderPreFixBriefing(briefing) {
  if (!briefing) return '';
  if (briefing.opportunity) {
    return `修正前ブリーフィング:
- リファクタリング機会: ${briefing.opportunity.id} / ${briefing.opportunity.refactoring_intent}
- Campaign: ${briefing.campaign?.id ?? '-'} / rank=${briefing.campaign?.rank ?? '-'}
- 推奨抽象化: ${briefing.opportunity.suggested_abstraction?.label ?? '-'}
- 対象ファイル: ${briefing.target_files?.slice(0, 5).join(', ') || '-'}
- 推奨方針: ${briefing.recommended_strategy?.id ?? '-'} - ${briefing.recommended_strategy?.reason ?? '-'}
- 方針: ${briefing.strategy_options?.map((option) => option.label).join(' / ') || '-'}`;
  }
  return `修正前ブリーフィング:
- 現在の境界: middleware excludes_api=${briefing.current_boundary?.middleware?.excludes_api ?? false}, route protection=${formatInlineSummary(briefing.current_boundary?.route_protection ?? {})}
- 認証/署名候補: ${formatAuthHelpers(briefing.auth_helpers)}
- 対象route: ${briefing.target_routes?.slice(0, 5).map((route) => `${route.route_path} (${route.methods.join(', ') || '-'})`).join(', ') || '-'}
- 推奨方針: ${briefing.recommended_strategy?.id ?? '-'} - ${briefing.recommended_strategy?.reason ?? '-'}
- 方針: ${briefing.strategy_options?.map((option) => option.label).join(' / ') || '-'}`;
}

function formatAuthHelpers(helpers = []) {
  if (helpers.length === 0) return '-';
  return helpers
    .slice(0, 5)
    .map((helper) => `${formatHelperCategory(helper.category)}${helper.file}${helper.functions.length > 0 ? `:${helper.functions.slice(0, 3).join(',')}` : ''}`)
    .join(', ');
}

function formatHelperCategory(category) {
  const labels = {
    auth: '認証:',
    signature: '署名:',
    environment: '環境:'
  };
  return labels[category] ?? '';
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

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}
