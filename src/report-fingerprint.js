import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvePrArtifactFile } from './artifact-routing.js';
import { readDrift, readInferredSpec } from './spec-store.js';
import { readNarrative, REPORT_KINDS } from './report-store.js';

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

// Fingerprint == the identity of the evidence state a pr-body.md was (or will
// be) generated from. It is a read of the persisted `pr prepare` output, not
// a recomputation — recomputing here would let the fingerprint silently
// diverge from the pr-body.md actually shipped in the PR. If `pr prepare`
// has never run for this story, that is an error, not an empty fingerprint.
async function buildPrBodyFingerprint(root, options) {
  const storyId = options.storyId;
  const jsonPath = await resolvePrArtifactFile(root, storyId, 'pr-prepare.json');
  const preparation = await readPrPrepare(jsonPath, storyId);

  const previousNarrative = await readNarrative(root, storyId, 'pr-body');
  const inferredSpec = await readInferredSpec(root, storyId);
  const drift = await readDrift(root, storyId);

  const fingerprint = {
    schema_version: '0.2.0',
    kind: 'pr-body',
    story_id: storyId,
    generated_at: new Date().toISOString(),
    source_artifact: toRelative(root, jsonPath),
    story: preparation.story ?? null,
    git: summarizeGit(preparation.git),
    spec: preparation.spec ?? null,
    spec_drift: preparation.spec_drift ?? null,
    story_source: preparation.story_source ?? null,
    traceability: summarizeTraceability(preparation.traceability),
    verification: summarizeVerification(preparation.verification),
    review: summarizeReview(preparation.review),
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
    // No story-diagnose findings pipeline exists in the minimal core; kept as
    // an empty, typed array (not silently omitted) so narrative citations to
    // finding_ids fail validation instead of matching nothing.
    findings: [],
    numerical_truth: buildNumericalTruth({ preparation, drift }),
    previous_narrative: previousNarrative,
    schema_for_your_output: await readJson(path.join(__dirname, 'report-pr-body-schema.json')),
    instructions: options.includeInstructions
      ? await readFile(path.join(__dirname, 'report-pr-body-prompt-template.md'), 'utf8')
      : null
  };
  fingerprint.inputs_digest = buildInputsDigest(fingerprint);
  return fingerprint;
}

async function readPrPrepare(jsonPath, storyId) {
  let raw;
  try {
    raw = await readFile(jsonPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `report fingerprint --kind pr-body: no pr-prepare.json found for story "${storyId}" at ${jsonPath}. `
        + 'Run `pr prepare` for this story before requesting a fingerprint.'
      );
    }
    throw new Error(`report fingerprint --kind pr-body: failed to read ${jsonPath}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`report fingerprint --kind pr-body: ${jsonPath} is not valid JSON: ${error.message}`);
  }
}

function summarizeGit(git) {
  if (!git) return null;
  return {
    current_branch: git.current_branch ?? null,
    head_sha: git.head_sha ?? null,
    base_ref: git.base_ref ?? null,
    changed_files_count: git.changed_files?.length ?? 0,
    changed_files: (git.changed_files ?? []).slice(0, 100).map((entry) => ({ status: entry.status, path: entry.path }))
  };
}

function summarizeTraceability(traceability) {
  if (!traceability) return null;
  return {
    acceptance_criteria: (traceability.acceptance_criteria ?? []).map((clause) => ({
      id: clause.id,
      status: clause.status,
      text: clause.text
    })),
    summary: traceability.summary ?? null
  };
}

function summarizeVerification(verification) {
  if (!verification) return { recorded: false, commands: [] };
  return {
    recorded: verification.recorded ?? false,
    updated_at: verification.updated_at ?? null,
    commands: (verification.commands ?? []).map((command) => ({
      kind: command.kind,
      status: command.status,
      command: command.command ?? null
    }))
  };
}

function summarizeReview(review) {
  if (!review) return { recorded: false, status: null };
  return {
    recorded: review.recorded ?? false,
    status: review.status ?? null,
    summary: review.summary ?? null
  };
}

function buildNumericalTruth({ preparation, drift }) {
  const driftItems = drift?.items ?? [];
  return {
    changed_files_count: preparation?.git?.changed_files?.length ?? 0,
    drift_total_count: driftItems.length,
    drift_high_count: driftItems.filter((item) => item.severity === 'high').length,
    // The requirement-consistency gate is removed from the minimal core
    // (docs/management/REBUILD.md); these are structurally 0 rather than
    // silently omitted, since narrative citations against them still exist
    // in the schema.
    requirement_invariant_count: 0,
    requirement_contradiction_count: 0,
    acceptance_criteria_count:
      preparation?.story_source?.acceptance_criteria_count
      ?? preparation?.traceability?.summary?.acceptance_criteria_count
      ?? 0
  };
}

function buildInputsDigest(fingerprint) {
  return {
    story_sha: sha256(fingerprint.story),
    git_sha: sha256(fingerprint.git),
    traceability_sha: sha256(fingerprint.traceability),
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

function toRelative(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  return relative.startsWith('..') ? absolutePath : relative;
}
