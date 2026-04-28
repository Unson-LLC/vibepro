import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(summaryPath, renderSummary({ runId, evidence, findings }));
  await writeFile(riskPath, renderRiskRegister({ runId, findings }));
  await writeFile(staticSitePath, renderStaticSiteCheck({ runId, staticSite: evidence.static_site }));

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
      static_site_check: toWorkspaceRelative(root, staticSitePath)
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
    static_site: await scanStaticSite(repoRoot),
    findings: [],
    gates: []
  };
}

function buildFindings(evidence) {
  const findings = [];
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
  if (!evidence.static_site.has_index_html) {
    findings.push({
      id: 'VP-STATIC-001',
      severity: 'High',
      category: '静的サイト',
      title: 'ルートの index.html が見つからない',
      detail: '静的サイトとして配信する入口ファイルが確認できない。',
      recommendation: '公開対象のルートに index.html を配置するか、配信設定の入口を明示する。'
    });
  }
  if (evidence.static_site.secret_hits.length > 0) {
    findings.push({
      id: 'VP-STATIC-002',
      severity: 'Critical',
      category: 'セキュリティ',
      title: '秘密情報の可能性がある値が含まれている',
      detail: `${evidence.static_site.secret_hits.length} 件の秘密情報候補を検出した。`,
      recommendation: '公開前に該当値を削除し、必要な値はサーバー側または安全な環境変数管理へ移す。'
    });
  }
  if (evidence.static_site.xss_risk_hits.length > 0) {
    findings.push({
      id: 'VP-STATIC-003',
      severity: 'High',
      category: 'セキュリティ',
      title: 'XSS につながり得る DOM 操作がある',
      detail: `${evidence.static_site.xss_risk_hits.length} 件の危険なDOM操作候補を検出した。`,
      recommendation: 'ユーザー入力をHTMLとして挿入しない。必要な場合はサニタイズし、textContentなど安全な代替を使う。'
    });
  }
  if (evidence.static_site.non_static_files.length > 0) {
    findings.push({
      id: 'VP-STATIC-004',
      severity: 'Medium',
      category: '配信設計',
      title: '静的配信対象外のファイルが混在している',
      detail: `${evidence.static_site.non_static_files.length} 件の非静的ファイル候補を検出した。`,
      recommendation: '公開ディレクトリにサーバーコード、設定ファイル、生成前ソースを含めない構成に分離する。'
    });
  }
  if (evidence.static_site.external_resources.length > 0) {
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
        ? '文脈品質または静的サイト構成に確認が必要な項目がある'
        : '重大な確認項目は検出されていない'
  }];
}

function renderSummary({ runId, evidence, findings }) {
  return `# VibePro 診断サマリー

| 項目 | 内容 |
|------|------|
| Run ID | ${runId} |
| Story | ${evidence.story.title} |
| Story ID | ${evidence.story_id} |
| graphify nodes | ${evidence.graphify.node_count} |
| graphify edges | ${evidence.graphify.edge_count} |
| 静的サイト scanned files | ${evidence.static_site.scanned_files} |
| 秘密情報候補 | ${evidence.static_site.secret_hits.length}件 |
| XSSリスク候補 | ${evidence.static_site.xss_risk_hits.length}件 |
| 検出事項 | ${findings.length}件 |

## ゲート状態

${evidence.gates.map((gate) => `- ${gate.id}: ${gate.status} - ${gate.reason}`).join('\n')}

## 主な検出事項

${findings.length === 0 ? '- なし' : findings.map((finding) => `- ${finding.id}: ${finding.title}（${finding.severity}）`).join('\n')}
`;
}

function renderStaticSiteCheck({ runId, staticSite }) {
  return `# 静的サイト診断結果

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
