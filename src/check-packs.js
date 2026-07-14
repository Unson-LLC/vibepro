import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { scanAgentHarness } from './agent-harness-scanner.js';
import { scanApiBoundary } from './api-boundary-scanner.js';
import { profileArchitecture } from './architecture-profiler.js';
import { scanCodeQuality } from './code-quality-scanner.js';
import { scanComponentStyle } from './component-style-scanner.js';
import { scanDatabaseAccess } from './database-access-scanner.js';
import { scanFlowDesign } from './flow-design-scanner.js';
import { scanGestureInteraction } from './gesture-interaction-scanner.js';
import { scanLocalDev } from './local-dev-scanner.js';
import { scanNetworkContracts } from './network-contract-scanner.js';
import { scanOssReadiness } from './oss-readiness-scanner.js';
import { runPerformanceMeasurement } from './performance-measurer.js';
import { preparePullRequest } from './pr-manager.js';
import { scanPublicDiscovery } from './public-discovery-scanner.js';
import { scanRegressionRisk } from './regression-risk-scanner.js';
import { scanSelfDogfood } from './self-dogfood-scanner.js';
import { scanStaticSite } from './static-site-scanner.js';
import { scanTerminalLinkContracts } from './terminal-link-scanner.js';
import { getWorkspaceDir, initWorkspace, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';
import { localizedText, resolveHumanOutputLanguage } from './language.js';
import { describeScanStatus } from './scan-status.js';

export const CHECK_PACKS = {
  ui: {
    title: 'UI experience check',
    checks: ['component_style', 'flow_design', 'gesture_interaction', 'network_contracts', 'terminal_link_contracts']
  },
  security: {
    title: 'Security boundary check',
    checks: ['static_site', 'api_boundary', 'network_contracts', 'code_quality']
  },
  performance: {
    title: 'Performance readiness check',
    checks: ['database_access', 'local_dev', 'code_quality']
  },
  architecture: {
    title: 'Architecture boundary check',
    checks: ['architecture_profile', 'code_quality', 'api_boundary', 'database_access']
  },
  'pr-readiness': {
    title: 'PR readiness check',
    checks: ['pr_prepare']
  },
  'launch-readiness': {
    title: 'Launch readiness check',
    checks: ['static_site', 'api_boundary', 'network_contracts', 'component_style', 'flow_design', 'gesture_interaction', 'database_access', 'local_dev', 'code_quality']
  },
  'agent-harness': {
    title: 'AI agent harness readiness check',
    checks: ['agent_harness']
  },
  'public-discovery': {
    title: 'Public discovery / AI search readiness check',
    checks: ['public_discovery']
  },
  'self-dogfood': {
    title: 'VibePro self-dogfood gate readiness check',
    checks: ['self_dogfood']
  },
  'oss-readiness': {
    title: 'OSS publication readiness check',
    checks: ['oss_readiness']
  },
  'regression-risk': {
    title: 'Regression-risk (blast-radius) check',
    checks: ['regression_risk']
  },
  all: {
    title: 'All check packs',
    checks: ['static_site', 'api_boundary', 'network_contracts', 'component_style', 'flow_design', 'gesture_interaction', 'terminal_link_contracts', 'database_access', 'local_dev', 'code_quality', 'architecture_profile']
  }
};

export function listCheckPacks() {
  return Object.entries(CHECK_PACKS).map(([id, pack]) => ({
    id,
    title: pack.title,
    checks: pack.checks
  }));
}

export async function runCheckPack(repoRoot, options = {}) {
  await initWorkspace(repoRoot);
  const root = path.resolve(repoRoot);
  const language = await resolveHumanOutputLanguage(root, options);
  const packId = options.packId ?? 'all';
  const pack = CHECK_PACKS[packId];
  if (!pack) {
    throw new Error(`Unknown check pack: ${packId}. Available packs: ${Object.keys(CHECK_PACKS).join(', ')}`);
  }

  const runId = options.runId ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '');
  const runDir = path.join(getWorkspaceDir(root), 'checks', packId, runId);
  await mkdir(runDir, { recursive: true });

  const architectureProfile = await profileArchitecture(root);
  const optionalChecks = packId === 'all'
    ? [
        ...(options.includeHarness === true ? ['agent_harness'] : []),
        ...(options.includePublicDiscovery === true ? ['public_discovery'] : [])
      ]
    : [];
  const checksToRun = [...pack.checks, ...optionalChecks];
  const context = { root, pack: { ...pack, checks: checksToRun }, options, architectureProfile };
  const evidence = {};
  for (const check of checksToRun) {
    evidence[check] = await runNamedCheck(check, context);
  }
  if (packId === 'performance' && options.measure === true) {
    evidence.performance_measurement = (await runPerformanceMeasurement(root, {
      runId: `${runId}-measure`,
      baseUrl: options.baseUrl,
      pages: options.pages ?? [],
      apis: options.apis ?? [],
      samples: options.samples ?? 5,
      build: options.build === true,
      typecheck: options.typecheck !== false,
      commands: options.commands ?? [],
      startups: options.startups ?? [],
      prismaLog: options.prismaLog
    })).measurement;
  }

  const checks = summarizeChecks({ packId, evidence, architectureProfile });
  const status = aggregateStatus(checks);
  // Machine consumers of the aggregate must be able to distinguish "pass
  // after examining targets" from "pass with unexamined scanners": the
  // aggregate stays non-blocking, but the inconclusive count travels with it.
  const inconclusiveCount = checks.filter((check) => check.status === 'inconclusive').length;
  const jsonPath = path.join(runDir, 'check.json');
  const markdownPath = path.join(runDir, 'check.md');
  const result = {
    schema_version: '0.1.0',
    run_id: runId,
    created_at: new Date().toISOString(),
    pack_id: packId,
    title: pack.title,
    status,
    inconclusive_count: inconclusiveCount,
    output: { language },
    repo: { root: '.' },
    checks,
    artifacts: {
      check_json: toWorkspaceRelative(root, jsonPath),
      check_report: toWorkspaceRelative(root, markdownPath)
    },
    evidence
  };

  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(markdownPath, renderCheckPack(result));

  const manifest = await readManifest(root);
  manifest.latest_check_run = runId;
  manifest.latest_check_run_by_pack = {
    ...(manifest.latest_check_run_by_pack ?? {}),
    [packId]: runId
  };
  manifest.check_runs = [
    {
      run_id: runId,
      pack_id: packId,
      created_at: result.created_at,
      status,
      artifacts: {
        check_json: result.artifacts.check_json,
        check_report: result.artifacts.check_report
      }
    },
    ...(manifest.check_runs ?? []).filter((item) => item.run_id !== runId)
  ];
  await writeManifest(root, manifest);

  return {
    runDir,
    artifacts: {
      json: toWorkspaceRelative(root, jsonPath),
      markdown: toWorkspaceRelative(root, markdownPath)
    },
    check: result
  };
}

async function runNamedCheck(check, context) {
  const { root, architectureProfile, options } = context;
  if (check === 'architecture_profile') return architectureProfile;
  if (check === 'agent_harness') return scanAgentHarness(root);
  if (check === 'public_discovery') return scanPublicDiscovery(root);
  if (check === 'self_dogfood') return scanSelfDogfood(root, { storyId: options.storyId, env: options.env });
  if (check === 'oss_readiness') return scanOssReadiness(root, { env: options.env });
  if (check === 'regression_risk') return scanRegressionRisk(root, { top: options.top, coverageFile: options.coverageFile });
  if (check === 'static_site') return scanStaticSite(root);
  if (check === 'component_style') return scanComponentStyle(root);
  if (check === 'flow_design') return scanFlowDesign(root, { story: { story_id: options.storyId ?? null, title: options.storyTitle ?? null } });
  if (check === 'gesture_interaction') return scanGestureInteraction(root);
  if (check === 'network_contracts') return scanNetworkContracts(root);
  if (check === 'terminal_link_contracts') return scanTerminalLinkContracts(root);
  if (check === 'database_access') return scanDatabaseAccess(root);
  if (check === 'local_dev') return scanLocalDev(root);
  if (check === 'code_quality') return scanCodeQuality(root);
  if (check === 'api_boundary') {
    return architectureProfile.applicable_checks.includes('api-boundary')
      ? scanApiBoundary(root, architectureProfile)
      : { route_count: 0, routes: [], summary: {}, protection_summary: {}, skipped: true, reason: 'api-boundary is not applicable to this repository' };
  }
  if (check === 'pr_prepare') {
    if (!options.baseRef && !options.headRef) {
      return {
        status: 'needs_setup',
        reason: 'pr-readiness requires --base <ref> or --head <ref> to prepare PR evidence'
      };
    }
    const preparation = await preparePullRequest(root, {
      storyId: options.storyId,
      baseRef: options.baseRef,
      headRef: options.headRef,
      strict: options.strict === true
    });
    return preparation.preparation;
  }
  return { status: 'skipped', reason: `unknown check ${check}` };
}

function summarizeChecks({ packId, evidence, architectureProfile }) {
  const checks = [];
  if (evidence.architecture_profile) {
    checks.push({
      id: 'architecture_profile',
      label: 'Architecture Profile',
      status: 'pass',
      summary: `${architectureProfile.app_type ?? 'unknown'} / checks: ${(architectureProfile.applicable_checks ?? []).join(', ') || '-'}`
    });
  }
  if (evidence.agent_harness) {
    checks.push(summarizeAgentHarness(evidence.agent_harness));
  }
  if (evidence.public_discovery) {
    checks.push(...summarizeRiskGroups('public_discovery', 'Public discovery', evidence.public_discovery, [
      ['structured_data_findings', 'Structured data'],
      ['metadata_findings', 'Metadata'],
      ['eeat_findings', 'E-E-A-T'],
      ['image_findings', 'Images'],
      ['content_findings', 'Content quality'],
      ['ai_bot_findings', 'AI bot access'],
      ['response_header_findings', 'Response headers']
    ]));
    if (evidence.public_discovery.suppressions) {
      checks.push({
        id: 'public_discovery.suppressions',
        label: 'Public discovery: Suppressions',
        status: evidence.public_discovery.suppressions.warnings.length > 0 ? 'needs_review' : 'pass',
        summary: `${evidence.public_discovery.suppressions.suppressed_findings.length} suppressed; warnings=${evidence.public_discovery.suppressions.warnings.length}`
      });
    }
  }
  if (evidence.self_dogfood) {
    const summary = evidence.self_dogfood.risk_summary?.findings ?? { block: 0, review: 0, info: 0 };
    checks.push({
      id: 'self_dogfood',
      label: 'VibePro Self-Dogfood Gate Readiness',
      status: statusFromRiskSummary(summary),
      summary: `${evidence.self_dogfood.summary?.findings ?? 0} findings; block=${summary.block ?? 0}, review=${summary.review ?? 0}, info=${summary.info ?? 0}`
    });
  }
  if (evidence.oss_readiness) {
    const summary = evidence.oss_readiness.risk_summary?.findings ?? { block: 0, review: 0, info: 0 };
    checks.push({
      id: 'oss_readiness',
      label: 'OSS Publication Readiness',
      status: normalizeCheckStatus(evidence.oss_readiness.status),
      summary: `${evidence.oss_readiness.summary?.tool_count ?? 0} tools; pass=${evidence.oss_readiness.summary?.pass ?? 0}, needs_setup=${evidence.oss_readiness.summary?.needs_setup ?? 0}, findings=${evidence.oss_readiness.summary?.findings ?? 0}; block=${summary.block ?? 0}, review=${summary.review ?? 0}, info=${summary.info ?? 0}`
    });
  }
  if (evidence.static_site) {
    checks.push(...summarizeRiskGroups('static_site', 'Static/Security', evidence.static_site, [
      ['secret_hits', 'Secret candidates'],
      ['xss_risk_hits', 'XSS candidates']
    ]));
  }
  if (evidence.api_boundary) {
    checks.push(summarizeApiBoundary(evidence.api_boundary));
  }
  if (evidence.network_contracts) {
    checks.push(summarizeNetworkContracts(evidence.network_contracts));
  }
  if (evidence.component_style) {
    checks.push(...summarizeRiskGroups('component_style', 'UI Style', evidence.component_style, [
      ['legacy_style_hits', 'Legacy style tokens'],
      ['interaction_reliability_hits', 'Interaction reliability']
    ]));
  }
  if (evidence.flow_design) {
    checks.push(summarizeFlowDesign(evidence.flow_design));
  }
  if (evidence.gesture_interaction) {
    checks.push(...summarizeRiskGroups('gesture_interaction', 'Gesture Interaction', evidence.gesture_interaction, [
      ['touch_action_hits', 'Touch action'],
      ['overlay_pointer_hits', 'Overlay pointer'],
      ['drag_tap_hits', 'Drag/tap suppression'],
      ['carousel_hits', 'Carousel and hit area'],
      ['map_marker_hits', 'Map marker layering']
    ]));
  }
  if (evidence.terminal_link_contracts) {
    checks.push(...summarizeRiskGroups('terminal_link_contracts', 'Terminal/File viewer', evidence.terminal_link_contracts, [
      ['dot_directory_link_hits', 'Dot directory links'],
      ['wrapped_terminal_link_hits', 'Wrapped terminal links'],
      ['dot_directory_tree_hits', 'Dot directory tree'],
      ['image_preview_extension_hits', 'Image preview extensions']
    ]));
  }
  if (evidence.database_access) {
    checks.push(...summarizeRiskGroups('database_access', 'Database access', evidence.database_access, [
      ['unbounded_find_many', 'Unbounded findMany']
    ]));
  }
  if (evidence.local_dev) {
    checks.push(...summarizeRiskGroups('local_dev', 'Local development', evidence.local_dev, [
      ['heavy_dev_scripts', 'Heavy dev scripts']
    ]));
  }
  if (evidence.code_quality) {
    checks.push(...summarizeRiskGroups('code_quality', 'Code quality', evidence.code_quality, [
      ['authorization_order_risks', 'Authorization order'],
      ['duplicate_query_shapes', 'Duplicate query shapes'],
      ['responsibility_hotspots', 'Responsibility hotspots']
    ]));
  }
  if (evidence.performance_measurement) {
    checks.push({
      id: 'performance_measurement',
      label: 'Performance Measurement',
      status: evidence.performance_measurement.summary?.items?.some((item) => /fail/i.test(String(item.value))) ? 'fail' : 'pass',
      summary: `${evidence.performance_measurement.summary?.items?.length ?? 0} measurement summaries`
    });
  }
  if (evidence.regression_risk) {
    const regression = evidence.regression_risk;
    const top = regression.hotspots?.[0];
    checks.push({
      id: 'regression_risk',
      label: 'Regression Risk (blast radius)',
      status: normalizeCheckStatus(regression.status),
      summary: regression.status === 'skipped'
        ? regression.reason
        : regression.status === 'inconclusive'
          ? `${describeScanStatus(regression.status)}${regression.reason ? `: ${regression.reason}` : ''}`
          : `${regression.summary?.scored_modules ?? 0} modules; critical=${regression.summary?.critical ?? 0}, high=${regression.summary?.high ?? 0}, moderate=${regression.summary?.moderate ?? 0}${regression.summary?.coverage_source ? ` (coverage: ${regression.summary.coverage_source})` : ' (no coverage)'}${top ? `; top=${top.file} (fan-in ${top.fan_in}${top.coverage_pct !== null && top.coverage_pct !== undefined ? `, cov ${top.coverage_pct}%` : ''})` : ''}`
    });
  }
  if (evidence.pr_prepare) {
    checks.push({
      id: 'pr_prepare',
      label: 'PR Readiness',
      status: normalizeCheckStatus(evidence.pr_prepare.gate_status?.overall_status ?? evidence.pr_prepare.status),
      summary: evidence.pr_prepare.gate_status
        ? `${evidence.pr_prepare.gate_status.overall_status}; ready=${evidence.pr_prepare.gate_status.ready_for_pr_create}`
        : evidence.pr_prepare.reason
    });
  }
  if (checks.length === 0) {
    checks.push({ id: packId, label: 'Check Pack', status: 'skipped', summary: 'No checks were applicable.' });
  }
  return checks;
}

function summarizeRiskGroups(prefix, labelPrefix, evidence, groups) {
  return groups.map(([key, label]) => {
    const hits = Array.isArray(evidence[key]) ? evidence[key] : [];
    const summary = evidence.risk_summary?.[key] ?? summarizeGateEffects(hits);
    return {
      id: `${prefix}.${key}`,
      label: `${labelPrefix}: ${label}`,
      status: statusFromRiskSummary(summary),
      summary: formatRiskSummary(summary, hits.length)
    };
  });
}

function summarizeApiBoundary(apiBoundary) {
  if (apiBoundary.skipped) {
    return { id: 'api_boundary', label: 'API Boundary', status: 'skipped', summary: apiBoundary.reason };
  }
  const riskCount = (apiBoundary.routes ?? []).reduce((count, route) => count + (route.risk_hints?.length ?? 0), 0);
  return {
    id: 'api_boundary',
    label: 'API Boundary',
    status: riskCount > 0 ? 'needs_review' : 'pass',
    summary: `${apiBoundary.route_count ?? 0} routes; ${riskCount} risk hints`
  };
}

function summarizeNetworkContracts(networkContracts) {
  if (networkContracts.status === 'inconclusive') {
    return {
      id: 'network_contracts',
      label: 'Network Contracts',
      status: 'inconclusive',
      summary: `${describeScanStatus(networkContracts.status)}${networkContracts.reason ? `: ${networkContracts.reason}` : ''}`
    };
  }
  const missing = networkContracts.missing_routes?.length ?? 0;
  const dynamic = networkContracts.dynamic_calls?.length ?? 0;
  const replacements = networkContracts.high_risk_replacements?.length ?? 0;
  return {
    id: 'network_contracts',
    label: 'Network Contracts',
    status: missing > 0 ? 'fail' : dynamic > 0 || replacements > 0 ? 'needs_review' : 'pass',
    summary: `${networkContracts.api_client_call_count ?? 0} API client calls; missing=${missing}, dynamic=${dynamic}, server-function-replacements=${replacements}`
  };
}

function summarizeAgentHarness(agentHarness) {
  const summary = agentHarness.risk_summary?.findings ?? { block: 0, review: 0, info: 0 };
  return {
    id: 'agent_harness',
    label: 'AI Agent Harness Readiness',
    status: statusFromRiskSummary(summary),
    summary: `${agentHarness.summary?.findings ?? 0} findings; codex=${agentHarness.summary?.codex_status ?? '-'}, claude=${agentHarness.summary?.claude_status ?? '-'}, skills=${agentHarness.summary?.skills_status ?? '-'}`
  };
}

function summarizeFlowDesign(flowDesign) {
  const count = [
    flowDesign.silent_noop_hits,
    flowDesign.ambiguous_primary_action_hits,
    flowDesign.selection_side_effect_hits,
    flowDesign.question_dead_end_hits,
    flowDesign.dead_ui_state_hits,
    flowDesign.interactive_contract_hits,
    flowDesign.value_alignment_hits
  ].reduce((total, items) => total + (Array.isArray(items) ? items.length : 0), 0);
  const isVacuous = flowDesign.status === 'inconclusive' || flowDesign.status === 'not_applicable';
  return {
    id: 'flow_design',
    label: 'Flow Design',
    status: normalizeCheckStatus(flowDesign.status),
    summary: isVacuous
      ? `${describeScanStatus(flowDesign.status)}${flowDesign.reason ? `: ${flowDesign.reason}` : ''}`
      : `${flowDesign.summary?.scanned_ui_files ?? 0} UI files; ${count} flow findings`
  };
}

function summarizeGateEffects(hits) {
  const summary = { block: 0, review: 0, info: 0 };
  for (const hit of hits) {
    const effect = ['block', 'review', 'info'].includes(hit.gate_effect) ? hit.gate_effect : 'info';
    summary[effect] += 1;
  }
  return summary;
}

function statusFromRiskSummary(summary) {
  if ((summary.block ?? 0) > 0) return 'fail';
  if ((summary.review ?? 0) > 0) return 'needs_review';
  return 'pass';
}

function formatRiskSummary(summary, total) {
  return `${total} hits; block=${summary.block ?? 0}, review=${summary.review ?? 0}, info=${summary.info ?? 0}`;
}

function normalizeCheckStatus(status) {
  if (['pass', 'passed', 'ready_for_review', 'ready'].includes(status)) return 'pass';
  if (['fail', 'failed', 'blocked'].includes(status)) return 'fail';
  if (['needs_setup', 'missing', 'skipped', 'not_required'].includes(status)) return status;
  if (['needs_verification', 'needs_review', 'needs_quality_closure'].includes(status)) return 'needs_review';
  return status ?? 'unknown';
}

function aggregateStatus(checks) {
  const statuses = checks.map((check) => check.status);
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('needs_setup')) return 'needs_setup';
  if (statuses.includes('needs_review') || statuses.includes('needs_verification')) return 'needs_review';
  // inconclusive/not_applicable are non-blocking by design (AC-8): a scanner
  // that found nothing to scan must not read as a failure, only as "not a
  // pass either". They are excluded from the aggregate pass/fail decision.
  if (statuses.every((status) => ['pass', 'skipped', 'not_required', 'inconclusive', 'not_applicable'].includes(status))) return 'pass';
  return 'unknown';
}

export function renderCheckPack(result) {
  const language = result.output?.language ?? 'ja';
  const reviewItems = checksNeedingAttention(result.checks);
  const lines = [
    localizedText(language, { ja: '# VibeProチェックパック', en: '# VibePro Check Pack' }),
    '',
    `${localizedText(language, { ja: 'Run ID', en: 'Run ID' })}: ${result.run_id}`,
    `${localizedText(language, { ja: 'Pack', en: 'Pack' })}: ${result.pack_id} - ${result.title}`,
    `${localizedText(language, { ja: '状態', en: 'Status' })}: ${result.status}`,
    '',
    localizedText(language, { ja: '## チェック', en: '## Checks' }),
    '',
    localizedText(language, { ja: '| Check | 状態 | Summary |', en: '| Check | Status | Summary |' }),
    '| ----- | ------ | ------- |'
  ];
  for (const check of result.checks) {
    lines.push(`| ${check.label} | ${check.status} | ${escapeTable(check.summary ?? '')} |`);
  }
  lines.push(...renderCheckPackFindings(result));
  lines.push(...renderCheckPackOnboarding({
    result,
    reviewItems
  }));
  return `${lines.join('\n')}\n`;
}

export function renderCheckPackSummary(result) {
  const language = result.check.output?.language ?? 'ja';
  const reviewItems = checksNeedingAttention(result.check.checks);
  const lines = [
    localizedText(language, {
      ja: `check packを作成しました: ${result.artifacts.markdown}`,
      en: `check pack created: ${result.artifacts.markdown}`
    }),
    `${localizedText(language, { ja: 'status', en: 'status' })}: ${result.check.status}`,
    '',
    localizedText(language, { ja: '| Check | 状態 | Summary |', en: '| Check | Status | Summary |' }),
    '| ----- | ------ | ------- |'
  ];
  for (const check of result.check.checks) {
    lines.push(`| ${check.label} | ${check.status} | ${escapeTable(check.summary ?? '')} |`);
  }
  lines.push(...renderCheckPackFindings(result.check));
  lines.push(...renderCheckPackOnboarding({
    result: result.check,
    reviewItems,
    artifacts: result.artifacts
  }));
  return `${lines.join('\n')}\n`;
}

function checksNeedingAttention(checks) {
  return checks.filter((check) => !['pass', 'skipped', 'not_required'].includes(check.status));
}

function renderCheckPackFindings(result) {
  const language = result.output?.language ?? 'ja';
  const findings = collectCheckPackFindings(result);
  if (findings.length === 0) return [];
  const lines = [
    '',
    localizedText(language, { ja: '## 検出事項', en: '## Findings' }),
    '',
    localizedText(language, { ja: '| Severity | Finding | Path | Action |', en: '| Severity | Finding | Path | Action |' }),
    '| -------- | ------- | ---- | ------ |'
  ];
  for (const finding of findings.slice(0, 50)) {
    const label = [
      finding.id,
      finding.detail
    ].filter(Boolean).join(' - ');
    lines.push(`| ${finding.severity ?? 'info'} | ${escapeTable(label)} | ${escapeTable(finding.path ?? finding.story_id ?? '')} | ${escapeTable(finding.required_action ?? '')} |`);
  }
  if (findings.length > 50) {
    lines.push(`| info | ${localizedText(language, {
      ja: `${findings.length - 50}件の追加findingはMarkdownから省略しました。JSON evidenceを確認してください。`,
      en: `${findings.length - 50} additional findings omitted from markdown; see JSON evidence.`
    })} |  | ${localizedText(language, { ja: 'machine-readable evidenceを確認する。', en: 'See machine-readable evidence.' })} |`);
  }
  return lines;
}

function collectCheckPackFindings(result) {
  const evidence = result.evidence ?? {};
  const findings = [];
  for (const value of Object.values(evidence)) {
    if (Array.isArray(value?.findings)) findings.push(...value.findings);
    if (value && typeof value === 'object') {
      for (const nested of Object.values(value)) {
        if (Array.isArray(nested?.findings)) findings.push(...nested.findings);
      }
    }
  }
  return findings;
}

function renderCheckPackOnboarding({ result, reviewItems, artifacts = null }) {
  const language = result.output?.language ?? 'ja';
  const markdownPath = artifacts?.markdown ?? result.artifacts?.check_report ?? '.vibepro/checks/<pack>/<run-id>/check.md';
  const jsonPath = artifacts?.json ?? result.artifacts?.check_json ?? '.vibepro/checks/<pack>/<run-id>/check.json';
  const attentionSummary = reviewItems.length === 0
    ? ['- none']
    : reviewItems.map((check) => `- ${check.label}: ${check.status} - ${check.summary ?? ''}`);
  const optionalAgentHarness = result.pack_id === 'all' && !result.evidence?.agent_harness
    ? [localizedText(language, {
        ja: '- このrepoでAI駆動開発の標準化も見る場合は `vibepro check agent-harness <repo>` または `vibepro check all <repo> --include-harness` を実行してください。',
        en: '- If you also want to standardize AI-driven development in this repo, run `vibepro check agent-harness <repo>` or `vibepro check all <repo> --include-harness`.'
      })]
    : [];
  const optionalPublicDiscovery = result.pack_id === 'all' && !result.evidence?.public_discovery
    ? [localizedText(language, {
        ja: '- public page / AI-search readiness診断も見る場合は `vibepro check public-discovery <repo>` または `vibepro check all <repo> --include-public-discovery` を実行してください。',
        en: '- If you also want public page / AI-search readiness diagnostics, run `vibepro check public-discovery <repo>` or `vibepro check all <repo> --include-public-discovery`.'
      })]
    : [];
  return [
    '',
    localizedText(language, { ja: '## 次に見る場所', en: '## Next Steps' }),
    '',
    localizedText(language, { ja: `- 人間向けreport: ${markdownPath}`, en: `- Human-readable report: ${markdownPath}` }),
    localizedText(language, { ja: `- 機械可読evidence: ${jsonPath}`, en: `- Machine-readable evidence: ${jsonPath}` }),
    localizedText(language, { ja: '- 初回診断だけの場合は、Statusと needs_review / fail のcheckを共有してください。', en: '- If this is only a first diagnosis, share the Status and the checks listed under needs_review / fail.' }),
    localizedText(language, { ja: '- PR作業の場合はfindingを対応または分類した後、`vibepro pr prepare <repo> --story-id <story-id> --base <base-branch>` を実行してください。', en: '- If this is PR work, run `vibepro pr prepare <repo> --story-id <story-id> --base <base-branch>` after addressing or classifying findings.' }),
    ...optionalAgentHarness,
    ...optionalPublicDiscovery,
    '',
    localizedText(language, { ja: '## 共有テンプレート', en: '## Share Template' }),
    '',
    '```text',
    localizedText(language, { ja: `VibePro check ${result.pack_id} が完了しました。`, en: `VibePro check ${result.pack_id} completed.` }),
    `Run ID: ${result.run_id}`,
    `Status: ${result.status}`,
    `Report: ${markdownPath}`,
    localizedText(language, { ja: 'Needs review / fail:', en: 'Needs review / fail:' }),
    ...attentionSummary,
    '```'
  ];
}

function escapeTable(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}
