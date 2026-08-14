import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { resolveArtifactRoute, resolvePrArtifactFile } from './artifact-routing.js';
import { extractMarkdownAcceptanceCriteria } from './markdown-acceptance-criteria.js';
import { globToRegExp } from './spec-validator.js';
import { toWorkspaceRelative } from './workspace.js';

const execFileAsync = promisify(execFile);

export const TRACEABILITY_SCHEMA_VERSION = '0.1.0';
export const TRACEABILITY_LIFECYCLES = [
  'declared_not_started',
  'in_progress',
  'merged',
  'evidence_in_other_worktree',
  'merged_without_vibepro_evidence',
  'unknown'
];
// Manual declarations may only state judgment calls; evidence-backed lifecycles must come from observation
export const DECLARABLE_LIFECYCLES = ['declared_not_started', 'unknown'];

const REAL_PR_ARTIFACT_FILES = ['pr-prepare.json', 'pr-create.json', 'gate-dag.json', 'pr-merge.json'];
const EXPLICIT_NOT_STARTED_DOC_STATUSES = ['backlog', 'draft', 'planned', 'idea', 'proposed'];
const MAX_GIT_EVIDENCE_COMMITS = 5;

export function buildTraceability(existing, {
  storyId,
  storyDocPath = null,
  source,
  lifecycle,
  evidence = [],
  acceptanceCriteria = null,
  scenarioClauses = null,
  scenarioLineage = null,
  acceptedSpecLineage = undefined,
  now = null
}) {
  const timestamp = now ?? new Date().toISOString();
  const baseEvidence = Array.isArray(existing?.evidence) ? existing.evidence : [];
  const replaceTypes = new Set(
    evidence
      .filter((item) => ['pr_artifact', 'verification_evidence'].includes(item?.type))
      .map((item) => item.type)
  );
  const mergedEvidence = baseEvidence.filter((item) => !replaceTypes.has(item?.type));
  for (const item of evidence) {
    const existingIndex = mergedEvidence.findIndex((entry) => entry.type === item.type && entry.ref === item.ref);
    if (existingIndex >= 0) {
      mergedEvidence[existingIndex] = item;
    } else {
      mergedEvidence.push(item);
    }
  }
  const acceptance_criteria = Array.isArray(acceptanceCriteria)
    ? acceptanceCriteria
    : Array.isArray(existing?.acceptance_criteria)
      ? existing.acceptance_criteria
      : [];
  const scenario_clauses = Array.isArray(scenarioClauses)
    ? scenarioClauses
    : Array.isArray(existing?.scenario_clauses)
      ? existing.scenario_clauses
      : [];
  const scenario_lineage = scenarioLineage && typeof scenarioLineage === 'object'
    ? scenarioLineage
    : existing?.scenario_lineage && typeof existing.scenario_lineage === 'object'
      ? existing.scenario_lineage
      : null;
  return {
    schema_version: TRACEABILITY_SCHEMA_VERSION,
    story_id: storyId,
    story_doc_path: storyDocPath ?? existing?.story_doc_path ?? null,
    source,
    lifecycle,
    evidence: mergedEvidence,
    acceptance_criteria,
    scenario_clauses,
    scenario_lineage,
    accepted_spec_lineage: acceptedSpecLineage === undefined
      ? existing?.accepted_spec_lineage ?? null
      : acceptedSpecLineage,
    coverage_summary: summarizeTraceabilityClauseMap({ acceptance_criteria, scenario_clauses, scenario_lineage }),
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp
  };
}

export function summarizeTraceabilityClauseMap({ acceptance_criteria = [], scenario_clauses = [], scenario_lineage = null } = {}) {
  const clauses = [...acceptance_criteria, ...scenario_clauses];
  const countByStatus = (status) => clauses.filter((item) => item.status === status).length;
  return {
    clause_count: clauses.length,
    acceptance_criteria_count: acceptance_criteria.length,
    scenario_clause_count: scenario_clauses.length,
    mapped_count: countByStatus('mapped'),
    weakly_mapped_count: countByStatus('weakly_mapped'),
    unmapped_count: countByStatus('unmapped'),
    scenario_lineage: scenario_lineage && typeof scenario_lineage === 'object'
      ? {
          status: scenario_lineage.status ?? 'mapped',
          story_scenario_ids: scenario_lineage.story_scenario_ids ?? [],
          mapped_story_scenario_ids: scenario_lineage.mapped_story_scenario_ids ?? [],
          missing_story_scenario_ids: scenario_lineage.missing_story_scenario_ids ?? [],
          unknown_story_scenario_ids: scenario_lineage.unknown_story_scenario_ids ?? []
        }
      : null,
    examples: clauses
      .filter((item) => item.status === 'unmapped' || item.status === 'weakly_mapped')
      .slice(0, 3)
      .map((item) => ({
        id: item.id,
        type: item.type,
        status: item.status,
        source_text: item.source_text,
        weak_mapping_reason: item.weak_mapping_reason ?? null
      }))
  };
}

export function buildTraceabilityClauseMap({
  storyId = '',
  storyText = '',
  acceptanceCriteria = null,
  changedFiles = [],
  tests = [],
  evidence = [],
  scenarioClauses = []
} = {}) {
  const storyScenarioIds = Array.isArray(acceptanceCriteria)
    ? []
    : extractStoryScenarioIds(storyText);
  const sourceCriteria = Array.isArray(acceptanceCriteria)
    ? acceptanceCriteria.map((criterion, index) => ({
        id: criterion?.id ?? `ac:${index + 1}`,
        text: typeof criterion === 'string'
          ? criterion
          : criterion?.text ?? criterion?.statement ?? criterion?.criterion ?? String(criterion),
        source_line: criterion?.source_line ?? null
      }))
    : extractAcceptanceCriteria(storyText);
  const criteria = sourceCriteria.map((criterion) => (
    buildClauseTraceabilityItem({
      ...criterion,
      type: 'acceptance_criterion',
      storyId,
      changedFiles,
      tests,
      evidence
    })
  ));
  const scenarios = scenarioClauses.map((scenario, index) => (
    buildClauseTraceabilityItem({
      id: scenario.id ?? `S-${index + 1}`,
      text: scenario.statement ?? scenario.text ?? String(scenario),
      source_line: scenario.source_line ?? null,
      type: 'scenario_clause',
      storyId,
      changedFiles,
      tests,
      evidence,
      storyScenarioIds: Array.isArray(scenario.story_scenario_ids) ? scenario.story_scenario_ids : [],
      knownStoryScenarioIds: storyScenarioIds
    })
  ));
  const mappedStoryScenarioIds = [...new Set(scenarios.flatMap((scenario) => scenario.story_scenario_ids ?? []))];
  return {
    acceptance_criteria: criteria,
    scenario_clauses: scenarios,
    scenario_lineage: {
      status: scenarios.some((scenario) => scenario.scenario_lineage_status === 'invalid')
        || storyScenarioIds.some((id) => !mappedStoryScenarioIds.includes(id))
        ? 'unmapped'
        : 'mapped',
      story_scenario_ids: storyScenarioIds,
      mapped_story_scenario_ids: mappedStoryScenarioIds,
      missing_story_scenario_ids: storyScenarioIds.filter((id) => !mappedStoryScenarioIds.includes(id)),
      unknown_story_scenario_ids: mappedStoryScenarioIds.filter((id) => !storyScenarioIds.includes(id))
    }
  };
}

/**
 * Resolve accepted-spec lineage against immutable blobs in the target HEAD.
 *
 * Returning null is intentionally different from an invalid result: null means
 * no accepted spec exists and lets callers retain the legacy heuristic map.
 * Once a canonical spec exists, broken lineage fails closed and must not fall
 * back to changed-file name matching.
 */
export async function buildAcceptedSpecClauseMap(repoRoot, {
  storyId,
  storyDocPath,
  verification = { recorded: false, commands: [] },
  verificationTrustStatus = 'trusted',
  headRef = 'HEAD'
} = {}) {
  const root = path.resolve(repoRoot);
  const [headSha, headConfigBlob] = await Promise.all([
    gitOutput(root, ['rev-parse', headRef]),
    gitBlob(root, headRef, '.vibepro/config.json')
  ]);
  let headConfig = {};
  try {
    headConfig = headConfigBlob ? JSON.parse(headConfigBlob.content) : {};
  } catch {
    return emptyAcceptedSpecMap({
      headSha,
      specPath: null,
      specBlobOid: null,
      reasonCodes: ['artifact_routing_config_invalid_at_head']
    });
  }
  const routeOptions = {
    storyId,
    configOverride: headConfig,
    validateStoryMirror: false
  };
  const [headSpecRoute, headStoryRoute] = await Promise.all([
    resolveArtifactRoute(root, 'accepted_spec', routeOptions),
    resolveArtifactRoute(root, 'story', routeOptions)
  ]);
  const absoluteSpecPath = headSpecRoute.canonical.absolute_path;
  const specPath = headSpecRoute.canonical.relative_path;
  const authoritativeStoryPath = headStoryRoute.canonical.relative_path;
  const [headSpec, worktreeSpec] = await Promise.all([
    gitBlob(root, headRef, specPath),
    readFile(absoluteSpecPath, 'utf8').catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  ]);
  if (!headSpec && worktreeSpec === null) return null;

  const globalReasons = [];
  const failures = [];
  if (!headSpec) globalReasons.push('accepted_spec_not_in_head');
  if (worktreeSpec === null) globalReasons.push('accepted_spec_missing_from_worktree');
  if (headSpec && worktreeSpec !== headSpec.content) globalReasons.push('accepted_spec_diverged_from_head');

  let spec = null;
  try {
    spec = headSpec ? JSON.parse(headSpec.content) : JSON.parse(worktreeSpec);
  } catch {
    globalReasons.push('accepted_spec_invalid_json');
  }
  if (!spec || typeof spec !== 'object') {
    return emptyAcceptedSpecMap({ headSha, specPath, specBlobOid: headSpec?.oid ?? null, reasonCodes: globalReasons });
  }
  if (spec.story_id !== storyId) globalReasons.push('accepted_spec_story_id_mismatch');

  const headStory = await gitBlob(root, headRef, authoritativeStoryPath);
  if (!headStory) globalReasons.push('story_not_in_head');
  const criteria = headStory ? extractMarkdownAcceptanceCriteria(headStory.content) : [];
  const criteriaById = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const items = criteria.map((criterion) => ({
    id: criterion.id,
    type: 'acceptance_criterion',
    source_text: criterion.text,
    text: criterion.text,
    source_line: criterion.source_line ?? null,
    status: 'unmapped',
    story_scenario_ids: [],
    scenario_lineage_status: 'valid',
    unknown_story_scenario_ids: [],
    mapped_files: [],
    mapped_tests: [],
    mapped_test_provenance: [],
    mapped_evidence: [],
    mapped_review_findings: [],
    spec_clause_ids: [],
    mapping_source: 'accepted_spec',
    lineage_status: 'unresolved',
    verification_status: verificationStatusFor([], verification, verificationTrustStatus),
    reason_codes: [],
    weak_mapping_reason: null
  }));
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const blobCache = new Map();

  for (const [clauseIndex, clause] of (spec.clauses ?? []).entries()) {
    const clauseId = typeof clause?.id === 'string' ? clause.id : `clause:${clauseIndex + 1}`;
    const clauseReasons = [];
    const refs = Array.isArray(clause?.origin?.story_refs) ? clause.origin.story_refs : [];
    const referencedAcIds = [];
    for (const ref of refs.filter((entry) => entry?.kind === 'acceptance_criteria')) {
      const resolvedId = stableStoryRefId(ref, criteriaById);
      if (!resolvedId) {
        clauseReasons.push(ref?.ac_id || ref?.text_snippet ? 'unknown_story_ac' : 'unstable_story_ref');
      } else {
        referencedAcIds.push(resolvedId);
      }
    }
    if (referencedAcIds.length === 0 && !clauseReasons.includes('unknown_story_ac')) {
      clauseReasons.push('story_ref_missing');
    }

    const testRefs = Array.isArray(clause?.origin?.test_refs) ? clause.origin.test_refs : [];
    const testProvenance = [];
    if (testRefs.length === 0) clauseReasons.push('test_ref_missing');
    for (const ref of testRefs) {
      const normalizedPath = normalizeGitPath(ref?.file);
      if (!normalizedPath) {
        clauseReasons.push('test_file_missing');
        continue;
      }
      const blob = await cachedGitBlob(blobCache, root, headRef, normalizedPath);
      if (!blob) {
        clauseReasons.push('test_file_missing');
        continue;
      }
      if (typeof ref.case !== 'string' || !nodeTestCaseExists(blob.content, ref.case)) {
        clauseReasons.push('test_case_missing');
        continue;
      }
      testProvenance.push({
        file: normalizedPath,
        case: ref.case,
        head_sha: headSha || null,
        blob_oid: blob.oid
      });
    }

    const patterns = Array.isArray(clause?.verifiable_by?.test_pattern)
      ? clause.verifiable_by.test_pattern
      : [];
    if (clause?.type === 'invariant' && patterns.length === 0) {
      clauseReasons.push('test_pattern_missing');
    }
    for (const pattern of patterns) {
      if (!await testPatternMatchesHead(root, headRef, pattern, blobCache)) {
        clauseReasons.push('test_pattern_failed');
      }
    }

    const uniqueReasons = [...new Set(clauseReasons)];
    if (uniqueReasons.length > 0) failures.push({ clause_id: clauseId, reason_codes: uniqueReasons });
    for (const acId of referencedAcIds) {
      const item = itemsById.get(acId);
      if (!item) continue;
      item.spec_clause_ids.push(clauseId);
      item.mapped_test_provenance.push(...testProvenance);
      item.mapped_tests.push(...testProvenance.map((entry) => entry.file));
      item.mapped_files.push(...testProvenance.map((entry) => entry.file));
      item.reason_codes.push(...uniqueReasons);
    }
  }

  for (const item of items) {
    item.spec_clause_ids = [...new Set(item.spec_clause_ids)];
    item.mapped_tests = [...new Set(item.mapped_tests)];
    item.mapped_files = [...new Set(item.mapped_files)];
    item.reason_codes = [...new Set([...globalReasons, ...item.reason_codes])];
    if (item.spec_clause_ids.length === 0) item.reason_codes.push('accepted_spec_clause_missing');
    const lineageReasons = item.reason_codes.filter((code) => code !== 'verification_evidence_untrusted');
    item.lineage_status = lineageReasons.length === 0 ? 'resolved' : 'invalid';
    item.status = item.lineage_status === 'resolved' ? 'mapped' : 'unmapped';
    item.verification_status = verificationStatusFor(item.mapped_test_provenance, verification, verificationTrustStatus);
    if (item.verification_status === 'untrusted') item.reason_codes.push('verification_evidence_untrusted');
    item.reason_codes = [...new Set(item.reason_codes)];
  }

  const reasonCodes = [...new Set([...globalReasons, ...failures.flatMap((failure) => failure.reason_codes)])];
  return {
    acceptance_criteria: items,
    scenario_clauses: [],
    scenario_lineage: null,
    accepted_spec_lineage: {
      status: reasonCodes.length === 0 && items.every((item) => item.lineage_status === 'resolved') ? 'resolved' : 'invalid',
      head_sha: headSha || null,
      spec_path: specPath,
      spec_blob_oid: headSpec?.oid ?? null,
      story_path: authoritativeStoryPath,
      story_blob_oid: headStory?.oid ?? null,
      mapping_source: 'accepted_spec',
      clause_count: Array.isArray(spec.clauses) ? spec.clauses.length : 0,
      resolved_clause_count: items.filter((item) => item.lineage_status === 'resolved').length,
      reason_codes: reasonCodes,
      failures
    }
  };
}

function emptyAcceptedSpecMap({ headSha, specPath, specBlobOid, reasonCodes }) {
  return {
    acceptance_criteria: [],
    scenario_clauses: [],
    scenario_lineage: null,
    accepted_spec_lineage: {
      status: 'invalid',
      head_sha: headSha || null,
      spec_path: specPath,
      spec_blob_oid: specBlobOid,
      story_path: null,
      story_blob_oid: null,
      mapping_source: 'accepted_spec',
      clause_count: 0,
      resolved_clause_count: 0,
      reason_codes: [...new Set(reasonCodes)],
      failures: []
    }
  };
}

function stableStoryRefId(ref, criteriaById) {
  if (typeof ref?.ac_id === 'string' && criteriaById.has(ref.ac_id)) return ref.ac_id;
  if (typeof ref?.text_snippet === 'string' && criteriaById.has(ref.text_snippet)) return ref.text_snippet;
  return null;
}

function normalizeGitPath(value) {
  if (typeof value !== 'string' || !value.trim() || path.isAbsolute(value)) return null;
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized.split('/').includes('..')) return null;
  return normalized;
}

function nodeTestCaseExists(content, caseName) {
  if (typeof caseName !== 'string' || !caseName) return false;
  const escaped = caseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactCase = `(['\"\\x60])${escaped}\\1\\s*[,)]`;
  const directCall = new RegExp(`\\b(?:test|it)\\s*\\(\\s*${exactCase}`);
  const parameterizedCall = new RegExp(
    `\\b(?:test|it)\\s*\\.\\s*each\\s*\\([^)]*\\)\\s*\\(\\s*${exactCase}`
  );
  return directCall.test(content) || parameterizedCall.test(content);
}

async function testPatternMatchesHead(root, headRef, pattern, blobCache) {
  if (!pattern || typeof pattern.file_glob !== 'string') return false;
  const files = await gitFilesMatching(root, headRef, pattern.file_glob);
  if (files.length === 0) return false;
  const blobs = (await Promise.all(
    files.map((file) => cachedGitBlob(blobCache, root, headRef, file))
  )).filter(Boolean);
  if (blobs.length === 0) return false;

  const contains = (needle) => blobs.some((blob) => blob.content.includes(needle));
  if (typeof pattern.must_contain === 'string' && !contains(pattern.must_contain)) return false;
  if (typeof pattern.must_not_contain === 'string' && contains(pattern.must_not_contain)) return false;
  if (typeof pattern.must_cover === 'string' && !contains(pattern.must_cover)) return false;
  return true;
}

async function gitFilesMatching(root, headRef, fileGlob) {
  const normalized = normalizeGitPath(fileGlob);
  if (!normalized) return [];
  if (!/[?*{}]/.test(normalized)) return [normalized];
  const output = await gitOutput(root, ['ls-tree', '-r', '--name-only', headRef]);
  const regex = globToRegExp(normalized);
  return output.split('\n').filter((file) => regex.test(file));
}

async function cachedGitBlob(cache, root, headRef, file) {
  if (!cache.has(file)) cache.set(file, await gitBlob(root, headRef, file));
  return cache.get(file);
}

async function gitBlob(root, headRef, file) {
  try {
    const [{ stdout: content }, { stdout: oid }] = await Promise.all([
      execFileAsync('git', ['show', `${headRef}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }),
      execFileAsync('git', ['rev-parse', `${headRef}:${file}`], { cwd: root, encoding: 'utf8' })
    ]);
    return { content, oid: oid.trim() };
  } catch {
    return null;
  }
}

async function gitOutput(root, args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    return stdout.trim();
  } catch {
    return '';
  }
}

function verificationStatusFor(testRefs, verification, trustStatus) {
  if (trustStatus !== 'trusted') return verification?.recorded ? 'untrusted' : 'unverified';
  if (!verification?.recorded) return 'unverified';
  const commands = verification.commands ?? [];
  const passed = commands.some((command) => {
    if (command.status !== 'pass' || command.trust_status !== 'trusted') return false;
    const targets = command.observation?.targets ?? [];
    const scenarios = command.observation?.scenarios ?? [];
    if (testRefs.length === 0) return false;
    return testRefs.some((ref) => targets.includes(ref.file) && (scenarios.length === 0 || scenarios.includes(ref.case)));
  });
  return passed ? 'verified' : 'unverified';
}

function extractStoryScenarioIds(storyText) {
  return [...new Set(String(storyText ?? '').match(/\b[A-Z0-9]+-STORY-[A-Z0-9-]+\b/g) ?? [])];
}

function buildClauseTraceabilityItem({
  id,
  text,
  source_line,
  type,
  storyId,
  changedFiles,
  tests,
  evidence,
  storyScenarioIds = [],
  knownStoryScenarioIds = []
}) {
  const matchedFiles = changedFiles.filter((file) => clauseMatchesPathOrText({ id, text, value: file.path ?? file }));
  const matchedTests = tests.filter((file) => (
    clauseMatchesPathOrText({ id, text, value: file.path ?? file })
    || testContentExplicitlyTargetsClause({ id, storyId, file })
    || testContentMentionsBacktickedIdentifier({ text, file })
  ));
  const matchedEvidence = evidence.filter((item) => isStrongClauseEvidence(item) && (
    evidenceTargetsClause({ id, text, item })
    || evidenceRefMatchesClauseId({ id, item })
  ));
  const matchedReviewFindings = evidence.filter((item) => item.type === 'review_finding' && (
    clauseMatchesPathOrText({ id, text, value: item.ref })
    || clauseMatchesPathOrText({ id, text, value: item.summary })
  ));
  const broadEvidence = evidence.some((item) => item.type === 'pr_artifact') && matchedEvidence.length === 0 && matchedTests.length === 0 && matchedReviewFindings.length === 0;
  const unknownStoryScenarioIds = storyScenarioIds.filter((scenarioId) => !knownStoryScenarioIds.includes(scenarioId));
  const scenarioLineageInvalid = type === 'scenario_clause' && unknownStoryScenarioIds.length > 0;
  const status = scenarioLineageInvalid
    ? 'unmapped'
    : matchedTests.length > 0 || matchedEvidence.length > 0 || matchedReviewFindings.length > 0
    ? 'mapped'
    : matchedFiles.length > 0 || broadEvidence
      ? 'weakly_mapped'
      : 'unmapped';
  const weakReason = status === 'weakly_mapped'
    ? matchedFiles.length > 0
      ? 'changed files mention this clause, but no clause-specific test, review finding, or current-bound evidence was found'
      : 'verification or PR evidence exists, but no AC/scenario-specific binding was found'
    : broadEvidence
      ? 'verification or PR evidence exists, but no AC/scenario-specific binding was found'
      : null;
  return {
    id,
    type,
    source_text: text,
    // Backwards-compatible alias retained for pr-prepare.json consumers.
    text,
    source_line,
    status,
    story_scenario_ids: storyScenarioIds,
    scenario_lineage_status: scenarioLineageInvalid ? 'invalid' : 'valid',
    unknown_story_scenario_ids: unknownStoryScenarioIds,
    mapped_files: matchedFiles.map((file) => file.path ?? file),
    mapped_tests: matchedTests.map((file) => file.path ?? file),
    mapped_evidence: matchedEvidence.map((item) => ({
      type: item.type ?? null,
      ref: item.ref ?? null,
      summary: item.summary ?? null,
      strength: item.strength ?? item.evidence_strength ?? null,
      binding_status: item.binding_status ?? item.binding?.status ?? null,
      current_head_sha: item.current_head_sha ?? item.git_context?.head_sha ?? null,
      artifact_quality: item.artifact_quality ?? item.artifact_check?.status ?? null,
      target_match: evidenceTargetsClause({ id, text, item })
    })),
    mapped_review_findings: matchedReviewFindings.map((item) => ({
      ref: item.ref ?? null,
      summary: item.summary ?? null,
      severity: item.severity ?? null,
      status: item.status ?? null
    })),
    weak_mapping_reason: weakReason
  };
}

function testContentExplicitlyTargetsClause({ id, storyId, file }) {
  if (!file || typeof file !== 'object' || typeof file.content !== 'string') return false;
  const normalizedId = String(id ?? '').trim();
  const normalizedStoryId = String(storyId ?? '').trim();
  if (!normalizedId || !normalizedStoryId) return false;
  const escapedId = normalizedId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedStoryId = normalizedStoryId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const qualifiedReference = new RegExp(
    `(^|[^a-z0-9])${escapedStoryId}[:#/]${escapedId}(?=$|[^a-z0-9])`,
    'i'
  );
  if (qualifiedReference.test(file.content)) return true;

  const normalizedPath = String(file.path ?? '').toLowerCase();
  const storyOwnedPath = normalizedPath.includes(normalizedStoryId.toLowerCase());
  return storyOwnedPath
    && new RegExp(`(^|[^a-z0-9])${escapedId}(?=$|[^a-z0-9])`, 'i').test(file.content);
}

// issue #436 item 5: AC↔test mapping was filename-heuristic-only
// (clauseMatchesPathOrText against the test's path) plus a story-qualified
// reference syntax (testContentExplicitlyTargetsClause). An AC phrased
// around a concrete identifier (e.g. "`fitSlackOverview` は...しない") that a
// test actually exercises by calling that identifier — without repeating the
// AC id/story id anywhere, and without the identifier appearing in the test
// file's own path — showed up as [未対応] even though a real test covered
// it. Extend matching (deliberately narrow: no design change to draft-spec
// handling) to also count a test as mapped when a backtick-quoted
// identifier from the AC/clause text literally appears in the test's
// content.
function extractBacktickedIdentifiers(text) {
  const matches = String(text ?? '').match(/`([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)`/g) ?? [];
  return [...new Set(matches.map((match) => match.slice(1, -1)))].filter((identifier) => identifier.length >= 3);
}

function testContentMentionsBacktickedIdentifier({ text, file }) {
  if (!file || typeof file !== 'object' || typeof file.content !== 'string') return false;
  const identifiers = extractBacktickedIdentifiers(text);
  if (identifiers.length === 0) return false;
  return identifiers.some((identifier) => {
    const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9_$])${escaped}(?=$|[^A-Za-z0-9_$])`).test(file.content);
  });
}

function isStrongClauseEvidence(item) {
  if (!item || item.type === 'pr_artifact') return false;
  const bindingStatus = item.binding_status ?? item.binding?.status ?? null;
  const artifactQuality = item.artifact_quality ?? item.artifact_check?.status ?? null;
  const strength = item.strength ?? item.evidence_strength ?? null;
  if (item.type === 'verification_evidence' && bindingStatus && bindingStatus !== 'current') return false;
  return bindingStatus === 'current'
    || artifactQuality === 'verified'
    || ['strong', 'supporting'].includes(strength)
    || item.type === 'verification_evidence';
}

function evidenceTargetsClause({ id, text, item }) {
  const targets = Array.isArray(item?.targets) ? item.targets : [];
  return targets.some((target) => {
    if (targetMatchesClauseId({ id, value: target })) return true;
    if (!isClauseBindingTarget(target)) return false;
    return clauseMatchesPathOrText({ id, text, value: target });
  });
}

function evidenceRefMatchesClauseId({ id, item }) {
  return targetMatchesClauseId({ id, value: item?.ref });
}

function targetMatchesClauseId({ id, value }) {
  const normalizedId = String(id ?? '').toLowerCase();
  if (!normalizedId) return false;
  return String(value ?? '').toLowerCase().includes(normalizedId);
}

function isClauseBindingTarget(value) {
  const target = String(value ?? '').trim();
  if (!target) return false;
  if (/^(node|npm|npx|pnpm|yarn|bun)\s+/.test(target)) return false;
  if (target.includes(' --')) return false;
  if (/\.vibepro\/manual-verification\//.test(target)) return false;
  if (/\.(tap|log|json)$/i.test(target) && /\.vibepro\//.test(target)) return false;
  return true;
}

export function extractAcceptanceCriteria(storyText) {
  return extractMarkdownAcceptanceCriteria(storyText);
}

function clauseMatchesPathOrText({ id, text, value }) {
  const target = String(value ?? '').toLowerCase();
  if (!target) return false;
  const normalizedId = String(id ?? '').toLowerCase();
  if (normalizedId && target.includes(normalizedId)) return true;
  const words = String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((word) => word.length >= 5)
    .slice(0, 8);
  return words.some((word) => target.includes(word));
}

export async function traceabilityArtifactPath(repoRoot, storyId) {
  return resolvePrArtifactFile(path.resolve(repoRoot), storyId, 'traceability.json');
}

export async function readTraceability(repoRoot, storyId) {
  return readJsonIfExists(await traceabilityArtifactPath(repoRoot, storyId));
}

export async function bindStoryTraceability(repoRoot, {
  storyId,
  storyDocPath = null,
  source,
  lifecycle,
  evidence = [],
  acceptanceCriteria = null,
  scenarioClauses = null,
  scenarioLineage = null,
  acceptedSpecLineage = undefined
}) {
  const artifactPath = await traceabilityArtifactPath(repoRoot, storyId);
  const existing = await readJsonIfExists(artifactPath);
  const traceability = buildTraceability(existing, {
    storyId,
    storyDocPath,
    source,
    lifecycle,
    evidence,
    acceptanceCriteria,
    scenarioClauses,
    scenarioLineage,
    acceptedSpecLineage
  });
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(traceability, null, 2)}\n`);
  return traceability;
}

export async function declareTraceability(repoRoot, { storyId, lifecycle, reason = null }) {
  if (!storyId) throw new Error('--story-id is required for trace declare');
  if (!DECLARABLE_LIFECYCLES.includes(lifecycle)) {
    throw new Error(`lifecycle must be one of ${DECLARABLE_LIFECYCLES.join(', ')}; evidence-backed lifecycles cannot be manually declared`);
  }
  return bindStoryTraceability(repoRoot, {
    storyId,
    source: 'manual_declaration',
    lifecycle,
    evidence: [{
      type: 'manual_declaration',
      ref: new Date().toISOString(),
      summary: reason ?? 'declared by operator without stated reason'
    }]
  });
}

export async function backfillTraceability(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const dryRun = options.dryRun === true;
  const storyDocs = await collectBackfillStoryDocs(root);
  const otherWorktrees = await listOtherWorktrees(root);
  const candidates = [];
  for (const doc of storyDocs) {
    if (options.storyId && doc.story_id !== options.storyId) continue;
    if (await hasRealPrArtifact(root, doc.story_id)) continue;
    const worktreeEvidence = await collectWorktreeEvidence(otherWorktrees, doc.story_id);
    const evidence = worktreeEvidence.length > 0
      ? worktreeEvidence
      : await collectGitLogEvidence(root, doc.story_id);
    const lifecycle = classifyLifecycle(doc, evidence);
    const candidate = {
      story_id: doc.story_id,
      story_doc_path: doc.path,
      story_status: doc.status,
      lifecycle,
      evidence,
      written: false
    };
    if (!dryRun) {
      await bindStoryTraceability(root, {
        storyId: doc.story_id,
        storyDocPath: doc.path,
        source: 'trace_backfill',
        lifecycle,
        evidence
      });
      candidate.written = true;
    }
    candidates.push(candidate);
  }
  return {
    schema_version: TRACEABILITY_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    candidates
  };
}

export function renderTraceabilityBackfill(result) {
  const header = result.dry_run
    ? '# Traceability Backfill (dry-run)'
    : '# Traceability Backfill';
  const rows = result.candidates.length
    ? result.candidates.map((candidate) => {
        const evidence = candidate.evidence.length
          ? ` evidence=${candidate.evidence.map((item) => item.ref?.slice(0, 12)).join(',')}`
          : '';
        return `- ${candidate.story_id}: lifecycle=${candidate.lifecycle} written=${candidate.written}${evidence}`;
      }).join('\n')
    : '- no backfill candidates';
  return `${header}\n\n${rows}\n`;
}

function classifyLifecycle(doc, evidence) {
  if (evidence.some((item) => item.type === 'worktree_artifact')) return 'evidence_in_other_worktree';
  if (evidence.some((item) => item.type === 'git_log')) return 'merged_without_vibepro_evidence';
  const status = String(doc.status ?? '').toLowerCase();
  // only explicit unstarted declarations qualify; active/null must not be guessed as "not started"
  if (EXPLICIT_NOT_STARTED_DOC_STATUSES.includes(status)) return 'declared_not_started';
  return 'unknown';
}

async function listOtherWorktrees(root) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' }));
  } catch {
    return [];
  }
  const currentReal = await realpathIfExists(root);
  const worktrees = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    if (!line.startsWith('worktree ')) continue;
    const worktreePath = line.slice('worktree '.length).trim();
    if (!worktreePath) continue;
    const real = await realpathIfExists(worktreePath);
    if (real && currentReal && real === currentReal) continue;
    worktrees.push(worktreePath);
  }
  return worktrees;
}

async function collectWorktreeEvidence(worktrees, storyId) {
  const evidence = [];
  for (const worktree of worktrees) {
    for (const file of REAL_PR_ARTIFACT_FILES) {
      const artifactPath = await resolvePrArtifactFile(worktree, storyId, file);
      if (await readJsonIfExists(artifactPath) === null) continue;
      evidence.push({
        type: 'worktree_artifact',
        ref: artifactPath,
        summary: `real PR artifact found in linked worktree ${worktree}`
      });
    }
    if (evidence.length > 0) break;
  }
  return evidence;
}

async function realpathIfExists(filePath) {
  try {
    return path.resolve(await realpath(filePath));
  } catch {
    return null;
  }
}

async function hasRealPrArtifact(root, storyId) {
  for (const file of REAL_PR_ARTIFACT_FILES) {
    if (await readJsonIfExists(await resolvePrArtifactFile(root, storyId, file))) return true;
  }
  return false;
}

async function collectGitLogEvidence(root, storyId) {
  try {
    const { stdout } = await execFileAsync('git', [
      'log',
      `--grep=${storyId}`,
      '--fixed-strings',
      `--max-count=${MAX_GIT_EVIDENCE_COMMITS}`,
      '--format=%H%x09%s'
    ], { cwd: root, encoding: 'utf8' });
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [ref, ...subject] = line.split('\t');
        return { type: 'git_log', ref, summary: subject.join('\t') };
      });
  } catch {
    return [];
  }
}

async function collectBackfillStoryDocs(root) {
  const storyRoot = path.join(root, 'docs', 'management', 'stories');
  const files = await listMarkdownFiles(storyRoot);
  const docs = [];
  for (const filePath of files) {
    const text = await readTextIfExists(filePath);
    if (text === null) continue;
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
    const source = frontmatter?.[1] ?? text.slice(0, 2000);
    const storyId = matchYamlString(source, 'story_id') ?? inferStoryId(path.basename(filePath));
    if (!storyId) continue;
    docs.push({
      story_id: storyId,
      status: matchYamlString(source, 'status'),
      path: toWorkspaceRelative(root, filePath)
    });
  }
  return docs;
}

async function listMarkdownFiles(dir) {
  const files = [];
  async function visit(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(full);
      }
    }
  }
  await visit(dir);
  return files.sort();
}

function inferStoryId(text) {
  const match = String(text ?? '').match(/story-[a-z0-9][a-z0-9-]+/i);
  return match ? match[0] : null;
}

function matchYamlString(text, key) {
  const match = String(text ?? '').match(new RegExp(`^${key}:\\s*['"]?([^'"\\n#]+)['"]?\\s*$`, 'm'));
  return match ? match[1].trim() : null;
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function readJsonIfExists(filePath) {
  const text = await readTextIfExists(filePath);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
