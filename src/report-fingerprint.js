import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { preparePullRequest } from './pr-manager.js';
import { readDrift, readInferredSpec } from './spec-store.js';
import { readNarrative, REPORT_KINDS } from './report-store.js';
import { getWorkspaceDir } from './workspace.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildReportFingerprint(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const kind = options.kind;
  if (!REPORT_KINDS.has(kind)) {
    throw new Error(`Unsupported report kind: ${kind}`);
  }
  const storyId = options.storyId ?? null;
  if (!storyId) {
    throw new Error('storyId is required');
  }
  if (kind === 'pr-body') {
    return buildPrBodyFingerprint(root, { ...options, storyId });
  }
  throw new Error(`Unsupported report kind: ${kind}`);
}

async function buildPrBodyFingerprint(root, options) {
  const storyId = options.storyId;
  const prepare = await preparePullRequest(root, {
    storyId,
    baseRef: options.baseRef ?? null,
    taskId: options.taskId ?? null,
    groupId: options.groupId ?? null,
    branchName: options.branchName ?? null,
    allowExtraFiles: true
  });

  const preparation = prepare?.preparation ?? null;
  const previousNarrative = await readNarrative(root, storyId, 'pr-body');
  const inferredSpec = await readInferredSpec(root, storyId);
  const drift = await readDrift(root, storyId);
  const findings = await readLatestFindings(root, preparation?.latest_story_run);

  const fingerprint = {
    schema_version: '0.1.0',
    kind: 'pr-body',
    story_id: storyId,
    generated_at: new Date().toISOString(),
    story: preparation?.story ?? null,
    pr_context: extractPrContextSummary(preparation),
    file_groups: summarizeFileGroups(preparation?.file_groups),
    gate_dag: summarizeGateDag(preparation?.pr_context?.gate_dag),
    requirement_consistency: summarizeRequirement(preparation?.pr_context?.requirement_consistency),
    inferred_spec: inferredSpec ? {
      story_id: inferredSpec.story_id,
      clauses: (inferredSpec.clauses ?? []).map((clause) => ({
        id: clause.id,
        type: clause.type,
        statement: clause.statement
      }))
    } : null,
    drift: drift ? {
      status: drift.status,
      summary: drift.summary,
      items: (drift.items ?? []).map((item) => ({
        id: item.id,
        axis: item.axis,
        clause_id: item.clause_id ?? null,
        severity: item.severity,
        title: item.title
      }))
    } : null,
    findings: findings.map((finding) => ({
      id: finding.id,
      title: finding.title,
      severity: finding.severity ?? null,
      type: finding.type ?? null
    })),
    numerical_truth: buildNumericalTruth({ preparation, drift, requirementConsistency: preparation?.pr_context?.requirement_consistency }),
    previous_narrative: previousNarrative,
    schema_for_your_output: await readJson(path.join(__dirname, 'report-pr-body-schema.json')),
    instructions: options.includeInstructions
      ? await readFile(path.join(__dirname, 'report-pr-body-prompt-template.md'), 'utf8')
      : null
  };
  fingerprint.inputs_digest = buildInputsDigest(fingerprint);
  return fingerprint;
}

function extractPrContextSummary(preparation) {
  if (!preparation) return null;
  const ctx = preparation.pr_context ?? {};
  return {
    story_source_path: ctx.story_source?.path ?? null,
    architecture_decision: ctx.architecture_decision ?? null,
    change_summary: ctx.change_summary ?? [],
    review_points: ctx.review_points ?? [],
    risks: ctx.risks ?? [],
    verification_commands: (ctx.verification_commands ?? []).map((entry) => ({
      command: entry.command,
      reason: entry.reason
    }))
  };
}

function summarizeFileGroups(fileGroups) {
  if (!fileGroups) return null;
  const summary = {};
  for (const [key, value] of Object.entries(fileGroups)) {
    summary[key] = {
      count: value.count,
      files: (value.files ?? []).slice(0, 12)
    };
  }
  return summary;
}

function summarizeGateDag(gateDag) {
  if (!gateDag) return null;
  return {
    overall_status: gateDag.overall_status ?? null,
    nodes: (gateDag.nodes ?? []).map((node) => ({
      id: node.id,
      type: node.type,
      status: node.status,
      required: node.required ?? null,
      reason: node.reason ?? null
    }))
  };
}

function summarizeRequirement(requirement) {
  if (!requirement) return null;
  return {
    status: requirement.status,
    summary: requirement.summary,
    invariants: (requirement.invariants ?? []).map((entry) => ({ id: entry.id, text: entry.text })),
    contradictions: (requirement.contradictions ?? []).map((entry) => ({ id: entry.id, title: entry.title })),
    scenario_gaps: (requirement.scenario_gaps ?? []).map((entry) => ({ id: entry.id, title: entry.title }))
  };
}

async function readLatestFindings(root, latestStoryRun) {
  const evidencePath = latestStoryRun?.artifacts?.evidence;
  if (!evidencePath) return [];
  try {
    const evidence = JSON.parse(await readFile(path.resolve(root, evidencePath), 'utf8'));
    return Array.isArray(evidence.findings) ? evidence.findings.slice(0, 40) : [];
  } catch {
    return [];
  }
}

function buildNumericalTruth({ preparation, drift, requirementConsistency }) {
  const driftItems = drift?.items ?? [];
  return {
    changed_files_count: preparation?.git?.changed_files?.length ?? 0,
    drift_total_count: driftItems.length,
    drift_high_count: driftItems.filter((item) => item.severity === 'high').length,
    requirement_invariant_count: requirementConsistency?.summary?.invariant_count ?? 0,
    requirement_contradiction_count: requirementConsistency?.summary?.contradiction_count ?? 0,
    acceptance_criteria_count: preparation?.pr_context?.story_source?.acceptance_criteria?.length ?? 0
  };
}

function buildInputsDigest(fingerprint) {
  return {
    story_sha: sha256(fingerprint.story),
    pr_context_sha: sha256(fingerprint.pr_context),
    drift_sha: sha256(fingerprint.drift),
    spec_sha: sha256(fingerprint.inferred_spec)
  };
}

function sha256(value) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(value ?? null));
  return `sha256:${hash.digest('hex')}`;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

// re-export utility for tests
export { getWorkspaceDir };
