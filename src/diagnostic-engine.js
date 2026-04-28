import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir, initWorkspace, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';

export async function runDiagnosis(repoRoot, options = {}) {
  await initWorkspace(repoRoot);
  const root = path.resolve(repoRoot);
  const runId = options.runId ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '');
  const runDir = path.join(getWorkspaceDir(root), 'diagnostics', runId);
  await mkdir(runDir, { recursive: true });

  const graphPath = path.join(getWorkspaceDir(root), 'graphify', 'graph.json');
  const graph = JSON.parse(await readFile(graphPath, 'utf8'));
  const evidence = buildEvidence(graph, runId);
  const findings = buildFindings(evidence);
  evidence.findings = findings;
  evidence.gates = buildGates(findings);

  const evidencePath = path.join(runDir, 'evidence.json');
  const summaryPath = path.join(runDir, 'summary.md');
  const riskPath = path.join(runDir, 'risk-register.md');

  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(summaryPath, renderSummary({ runId, evidence, findings }));
  await writeFile(riskPath, renderRiskRegister({ runId, findings }));

  const manifest = await readManifest(root);
  const run = {
    run_id: runId,
    created_at: new Date().toISOString(),
    gate_status: evidence.gates[0]?.status ?? 'unknown',
    artifacts: {
      summary: toWorkspaceRelative(root, summaryPath),
      risk_register: toWorkspaceRelative(root, riskPath),
      evidence: toWorkspaceRelative(root, evidencePath)
    }
  };
  manifest.latest_run = runId;
  manifest.runs = [run, ...(manifest.runs ?? []).filter((item) => item.run_id !== runId)];
  await writeManifest(root, manifest);

  return { runDir, run };
}

function buildEvidence(graph, runId) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  return {
    schema_version: '0.1.0',
    run_id: runId,
    graphify: {
      node_count: nodes.length,
      edge_count: edges.length,
      extracted_edges: edges.filter((edge) => edge.confidence === 'EXTRACTED'),
      inferred_edges: edges.filter((edge) => edge.confidence === 'INFERRED'),
      ambiguous_edges: edges.filter((edge) => edge.confidence === 'AMBIGUOUS')
    },
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
  return findings;
}

function buildGates(findings) {
  const hasMediumOrHigher = findings.some((finding) => ['Critical', 'High', 'Medium'].includes(finding.severity));
  return [{
    id: 'production-readiness',
    status: hasMediumOrHigher ? 'needs_review' : 'pass',
    reason: hasMediumOrHigher
      ? '文脈品質に確認が必要な項目がある'
      : '文脈グラフ上の重大な確認項目は検出されていない'
  }];
}

function renderSummary({ runId, evidence, findings }) {
  return `# VibePro 診断サマリー

| 項目 | 内容 |
|------|------|
| Run ID | ${runId} |
| graphify nodes | ${evidence.graphify.node_count} |
| graphify edges | ${evidence.graphify.edge_count} |
| 検出事項 | ${findings.length}件 |

## ゲート状態

${evidence.gates.map((gate) => `- ${gate.id}: ${gate.status} - ${gate.reason}`).join('\n')}

## 主な検出事項

${findings.length === 0 ? '- なし' : findings.map((finding) => `- ${finding.id}: ${finding.title}（${finding.severity}）`).join('\n')}
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
