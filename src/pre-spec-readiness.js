import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveGraphifyArtifactFile } from './artifact-routing.js';
import { promisify } from 'node:util';

import { preparePullRequest } from './pr-manager.js';
import { readManifest, getWorkspaceDir, toWorkspaceRelative } from './workspace.js';
import { readPreSpecReadiness, writePreSpecReadiness } from './spec-store.js';

const execFileAsync = promisify(execFile);
const SCHEMA_VERSION = '0.1.0';

export async function recordPreSpecReadiness(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireStoryId(options.storyId);
  const prPrepare = await preparePullRequest(root, {
    storyId,
    baseRef: options.baseRef,
    headRef: options.headRef,
    branchName: options.branchName,
    evidenceDepth: 'summary',
    env: options.env
  });
  const readiness = await buildPreSpecReadiness(root, {
    storyId,
    prPrepare: prPrepare.preparation
  });
  const artifactPath = await writePreSpecReadiness(root, storyId, readiness);
  return {
    readiness: {
      ...readiness,
      artifact: toWorkspaceRelative(root, artifactPath)
    },
    artifact: artifactPath,
    pr_prepare_artifact: prPrepare.artifacts?.json ?? null
  };
}

export async function assertPreSpecReadinessForFinalSpec(repoRoot, storyId) {
  const root = path.resolve(repoRoot);
  const readiness = await readPreSpecReadiness(root, storyId);
  if (!readiness) {
    throw new Error(
      `spec write --final requires Pre-Spec Readiness evidence. ` +
      `Run \`vibepro spec readiness . --id ${storyId} --base <base-ref>\` first, ` +
      `or write a draft with \`vibepro spec write --draft\`.`
    );
  }
  const failures = collectReadinessFailures(readiness);
  const currentHead = await getCurrentHead(root);
  if (currentHead && readiness.git?.head_sha && currentHead !== readiness.git.head_sha) {
    failures.push({
      id: 'current_head',
      status: 'stale',
      reason: `Pre-Spec Readiness was recorded for ${readiness.git.head_sha}, current HEAD is ${currentHead}`
    });
  }
  if (failures.length > 0) {
    throw new Error(
      `spec write --final blocked by Pre-Spec Readiness: ` +
      failures.map((item) => `${item.id}=${item.status}`).join(', ') +
      `. Rerun \`vibepro spec readiness . --id ${storyId} --base <base-ref>\`, ` +
      `or write a draft with \`vibepro spec write --draft\`.`
    );
  }
  return readiness;
}

export function renderPreSpecReadinessSummary(result) {
  const readiness = result.readiness ?? result;
  const lines = [
    '# Pre-Spec Readiness',
    '',
    `- story: ${readiness.story_id}`,
    `- status: ${readiness.status}`,
    `- artifact: ${readiness.artifact ?? '.vibepro/spec/<story-id>/pre-spec-readiness.json'}`,
    ''
  ];
  for (const check of readiness.checks ?? []) {
    lines.push(`- ${check.id}: ${check.status} - ${check.reason}`);
  }
  if ((readiness.next_actions ?? []).length > 0) {
    lines.push('', '## Next Actions', '');
    for (const action of readiness.next_actions) lines.push(`- ${action}`);
  }
  return `${lines.join('\n')}\n`;
}

async function buildPreSpecReadiness(repoRoot, { storyId, prPrepare }) {
  const [manifest, graphify, currentHead] = await Promise.all([
    readManifest(repoRoot).catch(() => null),
    readGraphifySummary(repoRoot, storyId),
    getCurrentHead(repoRoot)
  ]);
  const latestRun = findLatestStoryRun(manifest, storyId);
  const architectureCheck = findLatestArchitectureCheck(manifest);
  const engineeringJudgment = prPrepare?.pr_context?.engineering_judgment ?? null;
  const gateDag = prPrepare?.pr_context?.gate_dag ?? null;
  const checks = [
    buildStoryCheck(manifest, storyId),
    buildGraphifyCheck(graphify),
    buildDiagnosisCheck(latestRun),
    buildArchitectureCheck(architectureCheck),
    buildEngineeringJudgmentCheck(engineeringJudgment, gateDag)
  ];
  const failures = collectReadinessFailures({ checks });
  return {
    schema_version: SCHEMA_VERSION,
    story_id: storyId,
    created_at: new Date().toISOString(),
    status: failures.length === 0 ? 'ready' : 'blocked',
    git: {
      head_sha: currentHead
    },
    checks,
    graphify,
    diagnosis: latestRun ? {
      run_id: latestRun.run_id,
      gate_status: latestRun.gate_status ?? null,
      evidence_artifact: latestRun.artifacts?.evidence ?? null
    } : null,
    architecture_check: architectureCheck,
    engineering_judgment: engineeringJudgment ? {
      route_type: engineeringJudgment.route_type,
      route_dag: engineeringJudgment.route_dag,
      active_axes: engineeringJudgment.active_axes ?? [],
      active_axis_count: engineeringJudgment.active_axis_count ?? 0
    } : null,
    pr_prepare: prPrepare ? {
      created_at: prPrepare.created_at ?? null,
      artifact: `.vibepro/pr/${storyId}/pr-prepare.json`,
      gate_dag_status: gateDag?.overall_status ?? null
    } : null,
    next_actions: buildNextActions(checks, storyId)
  };
}

function buildStoryCheck(manifest, storyId) {
  const found = Boolean(manifest?.stories?.[storyId] || findLatestStoryRun(manifest, storyId));
  return {
    id: 'story_selected',
    status: found ? 'pass' : 'blocked',
    reason: found ? 'Story exists in VibePro workspace artifacts' : 'Story was not found in VibePro workspace artifacts'
  };
}

function buildGraphifyCheck(graphify) {
  const passed = graphify.available && graphify.node_count > 0 && graphify.edge_count > 0;
  return {
    id: 'graphify_context',
    status: passed ? 'pass' : 'blocked',
    reason: passed
      ? `Graphify graph has ${graphify.node_count} nodes and ${graphify.edge_count} edges`
      : graphify.reason ?? 'Graphify graph is missing or empty'
  };
}

function buildDiagnosisCheck(latestRun) {
  return {
    id: 'story_diagnosis',
    status: latestRun ? 'pass' : 'blocked',
    reason: latestRun
      ? `Story diagnosis run exists: ${latestRun.run_id}`
      : 'No story diagnosis run exists for this Story'
  };
}

function buildArchitectureCheck(architectureCheck) {
  if (!architectureCheck) {
    return {
      id: 'architecture_check',
      status: 'blocked',
      reason: 'No architecture check run was found'
    };
  }
  const blocking = ['fail', 'failed', 'blocked', 'needs_setup'].includes(architectureCheck.status);
  return {
    id: 'architecture_check',
    status: blocking ? 'blocked' : 'pass',
    reason: `Architecture check ${architectureCheck.run_id} status=${architectureCheck.status}`
  };
}

function buildEngineeringJudgmentCheck(engineeringJudgment, gateDag) {
  const hasRoute = Boolean(engineeringJudgment?.route_type);
  const hasGate = (gateDag?.nodes ?? []).some((node) => node.id === 'gate:engineering_judgment_route');
  return {
    id: 'engineering_judgment',
    status: hasRoute && hasGate ? 'pass' : 'blocked',
    reason: hasRoute && hasGate
      ? `Engineering Judgment route=${engineeringJudgment.route_type}; dag=${engineeringJudgment.route_dag}`
      : 'Engineering Judgment route gate is missing; run pre-spec readiness again'
  };
}

function collectReadinessFailures(readiness) {
  const failures = (readiness.checks ?? []).filter((check) => check.status !== 'pass');
  if (readiness.status && readiness.status !== 'ready') {
    failures.unshift({
      id: 'readiness_status',
      status: readiness.status,
      reason: `Pre-Spec Readiness status is ${readiness.status}`
    });
  }
  return failures;
}

function buildNextActions(checks, storyId) {
  const actions = [];
  if (checks.some((check) => check.id === 'graphify_context' && check.status !== 'pass')) {
    actions.push('Run `vibepro graph . --run-graphify`.');
  }
  if (checks.some((check) => check.id === 'story_diagnosis' && check.status !== 'pass')) {
    actions.push(`Run \`vibepro story diagnose . --id ${storyId} --pre-architecture --run-graphify\`.`);
  }
  if (checks.some((check) => check.id === 'architecture_check' && check.status !== 'pass')) {
    actions.push(`Run \`vibepro check architecture . --story-id ${storyId} --base <base-ref>\`.`);
  }
  if (checks.some((check) => check.id === 'engineering_judgment' && check.status !== 'pass')) {
    actions.push(`Run \`vibepro spec readiness . --id ${storyId} --base <base-ref>\` to regenerate Engineering Judgment evidence.`);
  }
  return actions;
}

async function readGraphifySummary(repoRoot, storyId) {
  const graphPath = await resolveGraphifyArtifactFile(repoRoot, storyId);
  try {
    const graph = JSON.parse(await readFile(graphPath, 'utf8'));
    const edges = Array.isArray(graph.edges) ? graph.edges : Array.isArray(graph.links) ? graph.links : [];
    return {
      available: true,
      artifact: toWorkspaceRelative(repoRoot, graphPath),
      node_count: Array.isArray(graph.nodes) ? graph.nodes.length : 0,
      edge_count: edges.length,
      edge_source_key: Array.isArray(graph.edges) ? 'edges' : Array.isArray(graph.links) ? 'links' : null
    };
  } catch (error) {
    return {
      available: false,
      artifact: toWorkspaceRelative(repoRoot, graphPath),
      node_count: 0,
      edge_count: 0,
      edge_source_key: null,
      reason: error.code === 'ENOENT' ? 'Graphify artifact is missing' : error.message
    };
  }
}

function findLatestStoryRun(manifest, storyId) {
  if (!manifest || !storyId) return null;
  const runId = manifest.latest_run_by_story?.[storyId];
  if (runId && Array.isArray(manifest.runs)) {
    return manifest.runs.find((run) => run.run_id === runId && run.story_id === storyId) ?? null;
  }
  return (manifest.runs ?? []).find((run) => run.story_id === storyId) ?? null;
}

function findLatestArchitectureCheck(manifest) {
  if (!manifest) return null;
  const runId = manifest.latest_check_run_by_pack?.architecture;
  return (manifest.check_runs ?? []).find((run) => run.pack_id === 'architecture' && run.run_id === runId)
    ?? (manifest.check_runs ?? []).find((run) => run.pack_id === 'architecture')
    ?? null;
}

async function getCurrentHead(repoRoot) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8'
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

function requireStoryId(storyId) {
  if (!storyId) throw new Error('spec readiness requires --id <story-id>');
  return storyId;
}
