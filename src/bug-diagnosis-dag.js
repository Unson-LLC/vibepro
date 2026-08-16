import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { getWorkspaceDir, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';
import { assertSafeStoryPathSegment } from './story-id.js';

const execFileAsync = promisify(execFile);

export const BUG_DIAGNOSIS_SCHEMA_VERSION = '0.1.0';

export const BUG_DIAGNOSIS_NODES = Object.freeze([
  { id: 'failure_reproduced', label: '再現と実測' },
  { id: 'failure_localized', label: '発生箇所の特定' },
  { id: 'relationship_analysis', label: '必要な関係分析', allows_not_applicable: true },
  { id: 'preconditions_confirmed', label: '前提条件の確認' },
  { id: 'root_cause_confirmed', label: '根本原因の確定' },
  { id: 'regression_test_failed_before_fix', label: '失敗する回帰テスト', allows_not_applicable: true },
  { id: 'root_fix_applied', label: '根本修正' },
  { id: 'same_path_reverified', label: '同じ経路で再検証' }
]);

const NODE_IDS = new Set(BUG_DIAGNOSIS_NODES.map((node) => node.id));
const RECORDABLE_STATUSES = new Set(['passed', 'failed', 'not_applicable']);
const BUG_STORY_TYPES = new Set(['bug_fix', 'regression_fix', 'bug']);
const RELATIONSHIP_ANALYSES = new Set(['data_flow', 'control_flow', 'async_flow', 'module_boundary', 'change_history']);

export function isBugStory(story) {
  return BUG_STORY_TYPES.has(String(story?.contract_type ?? story?.story_type ?? '').trim().toLowerCase());
}

export function createBugDiagnosisEvidence({ storyId, runId, targetHeadSha, createdAt = new Date().toISOString() }) {
  if (!storyId || !runId || !targetHeadSha) {
    throw new Error('bug diagnosis evidence requires storyId, runId, and targetHeadSha');
  }
  const evidence = {
    schema_version: BUG_DIAGNOSIS_SCHEMA_VERSION,
    kind: 'vibepro_bug_diagnosis_dag',
    story_id: storyId,
    run_id: runId,
    target_head_sha: targetHeadSha,
    created_at: createdAt,
    updated_at: createdAt,
    nodes: BUG_DIAGNOSIS_NODES.map((definition) => ({
      id: definition.id,
      label: definition.label,
      status: 'pending',
      head_sha: null,
      evidence_refs: [],
      reason: null,
      path_id: null,
      analyses: []
    }))
  };
  return applyEvaluation(evidence);
}

export function recordBugDiagnosisNodeResult(evidence, result) {
  validateEvidenceEnvelope(evidence);
  const nodeId = String(result?.nodeId ?? '');
  const status = String(result?.status ?? '');
  if (!NODE_IDS.has(nodeId)) throw new Error(`unknown bug diagnosis node: ${nodeId || '(empty)'}`);
  if (!RECORDABLE_STATUSES.has(status)) throw new Error(`invalid bug diagnosis status: ${status || '(empty)'}`);
  const definition = BUG_DIAGNOSIS_NODES.find((node) => node.id === nodeId);
  if (status === 'not_applicable' && !definition.allows_not_applicable) {
    throw new Error(`${nodeId} cannot be marked not_applicable`);
  }
  const reason = String(result.reason ?? '').trim() || null;
  const evidenceRefs = [...new Set((result.evidenceRefs ?? []).map((item) => String(item).trim()).filter(Boolean))];
  if (['passed', 'failed'].includes(status) && evidenceRefs.length === 0) {
    throw new Error(`${nodeId}=${status} requires at least one evidence reference`);
  }
  if (['failed', 'not_applicable'].includes(status) && !reason) {
    throw new Error(`${nodeId}=${status} requires a reason`);
  }
  const nodeIndex = BUG_DIAGNOSIS_NODES.findIndex((node) => node.id === nodeId);
  if (status === 'passed' || status === 'not_applicable') {
    const unmet = evidence.nodes.slice(0, nodeIndex).find((node) => !isAcceptedNode(node));
    if (unmet) throw new Error(`${nodeId} cannot pass before ${unmet.id}`);
  }
  const headSha = String(result.headSha ?? '').trim();
  if (!headSha) throw new Error(`${nodeId} requires target HEAD binding`);
  const pathId = String(result.pathId ?? '').trim() || null;
  if ((nodeId === 'failure_reproduced' && status === 'passed') || (nodeId === 'same_path_reverified' && ['passed', 'failed'].includes(status))) {
    if (!pathId) {
      throw new Error(`${nodeId} requires --path-id to bind the actual failure path`);
    }
  }
  const reproductionPath = evidence.nodes.find((node) => node.id === 'failure_reproduced')?.path_id;
  if (nodeId === 'same_path_reverified' && ['passed', 'failed'].includes(status) && pathId !== reproductionPath) {
    throw new Error(`same_path_reverified path_id ${pathId} does not match reproduced path_id ${reproductionPath ?? '(missing)'}`);
  }
  const analyses = [...new Set((result.analyses ?? []).map((item) => String(item).trim()).filter(Boolean))];
  const unknownAnalyses = analyses.filter((analysis) => !RELATIONSHIP_ANALYSES.has(analysis));
  if (unknownAnalyses.length > 0) {
    throw new Error(`unknown relationship analysis: ${unknownAnalyses.join(', ')}`);
  }
  if (nodeId === 'relationship_analysis' && status === 'passed' && analyses.length === 0) {
    throw new Error('relationship_analysis=passed requires at least one selected analysis');
  }
  const next = structuredClone(evidence);
  next.target_head_sha = headSha;
  next.updated_at = result.recordedAt ?? new Date().toISOString();
  next.nodes[nodeIndex] = {
    ...next.nodes[nodeIndex],
    status,
    head_sha: headSha,
    evidence_refs: evidenceRefs,
    reason,
    path_id: pathId,
    analyses
  };
  return applyEvaluation(next);
}

export function evaluateBugDiagnosisEvidence(evidence) {
  validateEvidenceEnvelope(evidence);
  const invalid = [];
  for (const definition of BUG_DIAGNOSIS_NODES) {
    const node = evidence.nodes.find((item) => item.id === definition.id);
    if (!node) {
      invalid.push({ id: definition.id, reason: 'node is missing' });
      continue;
    }
    if (!isAcceptedNode(node)) {
      invalid.push({ id: definition.id, reason: node.status === 'failed' ? node.reason ?? 'node failed' : 'evidence is incomplete' });
      continue;
    }
    if (node.head_sha !== evidence.target_head_sha) {
      invalid.push({
        id: definition.id,
        reason: `node evidence HEAD ${node.head_sha ?? '(missing)'} does not match diagnosis target HEAD ${evidence.target_head_sha}`
      });
      continue;
    }
    if (node.status === 'passed' && (!node.head_sha || !Array.isArray(node.evidence_refs) || node.evidence_refs.length === 0)) {
      invalid.push({ id: definition.id, reason: 'passed node is missing HEAD-bound evidence' });
    }
    if (node.status === 'not_applicable' && (!definition.allows_not_applicable || !node.reason)) {
      invalid.push({ id: definition.id, reason: 'not_applicable is not justified' });
    }
  }
  const reproductionPath = evidence.nodes.find((node) => node.id === 'failure_reproduced')?.path_id;
  const reverifiedPath = evidence.nodes.find((node) => node.id === 'same_path_reverified')?.path_id;
  if (reverifiedPath && reproductionPath !== reverifiedPath) {
    invalid.push({ id: 'same_path_reverified', reason: 'reverification does not use the reproduced failure path' });
  }
  const returnToNode = invalid[0]?.id ?? null;
  return {
    status: invalid.length === 0 ? 'ready' : 'blocked',
    failures: invalid,
    return_to_node: returnToNode,
    next_actions: returnToNode
      ? [`Record or rerun bug diagnosis node \`${returnToNode}\` for Story ${evidence.story_id} and run ${evidence.run_id}.`]
      : []
  };
}

export async function recordBugDiagnosisNode(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = String(options.storyId ?? '').trim();
  assertSafeStoryPathSegment(storyId, 'bug diagnose record requires a valid Story id');
  if (options.runId !== undefined) {
    assertSafeStoryPathSegment(String(options.runId), 'bug diagnose record requires a valid run id');
  }
  const manifest = await readManifest(root).catch(() => ({ runs: [], latest_run_by_story: {} }));
  const resolved = await resolveBugDiagnosisArtifact(root, {
    storyId,
    runId: options.runId,
    manifest
  });
  if (!resolved) throw new Error(`bug diagnosis run not found for Story ${storyId || '(empty)'}`);
  const { artifactPath, runId, run } = resolved;
  const evidence = JSON.parse(await readFile(artifactPath, 'utf8'));
  const headSha = await getCurrentHead(root);
  const updated = recordBugDiagnosisNodeResult(evidence, {
    nodeId: options.nodeId,
    status: options.status,
    reason: options.reason,
    evidenceRefs: options.evidenceRefs,
    analyses: options.analyses,
    pathId: options.pathId,
    headSha
  });
  await writeFile(artifactPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  if (run) {
    run.bug_diagnosis = summarizeBugDiagnosisEvidence(updated);
    await writeManifest(root, manifest);
  }
  return { evidence: updated, artifact: toWorkspaceRelative(root, artifactPath) };
}

export async function readLatestBugDiagnosis(repoRoot, story) {
  if (!isBugStory(story)) return null;
  const manifest = await readManifest(repoRoot).catch(() => null);
  const resolved = await resolveBugDiagnosisArtifact(repoRoot, {
    storyId: story.story_id,
    manifest
  });
  if (!resolved) {
    return {
      status: 'blocked',
      story_id: story.story_id,
      run_id: manifest?.latest_run_by_story?.[story.story_id] ?? null,
      return_to_node: 'failure_reproduced',
      next_actions: [`Run \`vibepro story diagnose . --id ${story.story_id} --pre-architecture --run-graphify\`.`],
      failures: [{ id: 'failure_reproduced', reason: 'bug diagnosis evidence is missing' }],
      artifact: null
    };
  }
  const { artifactPath, artifact, runId } = resolved;
  const evidence = JSON.parse(await readFile(artifactPath, 'utf8'));
  const summary = summarizeBugDiagnosisEvidence(evidence);
  const currentHeadSha = await getCurrentHead(repoRoot);
  if (summary.target_head_sha !== currentHeadSha) {
    return {
      ...summary,
      status: 'blocked',
      return_to_node: 'failure_reproduced',
      next_actions: [
        `Rerun bug diagnosis for Story ${story.story_id} at current HEAD ${currentHeadSha}; recorded target HEAD is ${summary.target_head_sha}.`
      ],
      failures: [{
        id: 'failure_reproduced',
        reason: `bug diagnosis evidence is stale: target HEAD ${summary.target_head_sha} does not match current HEAD ${currentHeadSha}`
      }],
      artifact
    };
  }
  return { ...summary, artifact };
}

async function resolveBugDiagnosisArtifact(repoRoot, { storyId, runId, manifest }) {
  const root = path.resolve(repoRoot);
  assertSafeStoryPathSegment(storyId, 'bug diagnosis requires a valid Story id');
  if (runId !== undefined) assertSafeStoryPathSegment(String(runId), 'bug diagnosis requires a valid run id');
  const manifestRunId = runId ?? manifest?.latest_run_by_story?.[storyId];
  const run = (manifest?.runs ?? []).find((item) => item.run_id === manifestRunId && item.story_id === storyId);
  const manifestArtifact = run?.artifacts?.bug_diagnosis;
  if (manifestArtifact) {
    const artifactPath = resolveContainedPath(getWorkspaceDir(root), path.resolve(root, manifestArtifact));
    try {
      await stat(artifactPath);
    } catch {
      // A regenerated worktree may have durable diagnosis records but a fresh
      // manifest. Fall through to the self-describing artifact directory.
      return await resolveArtifactDirectoryFallback(root, { storyId, runId, manifest });
    }
    await assertWorkspacePathContained(root, artifactPath);
    await assertArtifactIdentity(artifactPath, storyId, manifestRunId);
    return { artifactPath, artifact: toWorkspaceRelative(root, artifactPath), runId: manifestRunId, run };
  }

  return await resolveArtifactDirectoryFallback(root, { storyId, runId, manifest });
}

async function resolveArtifactDirectoryFallback(root, { storyId, runId, manifest }) {
  const diagnosisRoot = path.resolve(getWorkspaceDir(root), 'bug-diagnosis');
  const storyDir = resolveContainedPath(diagnosisRoot, storyId);
  try {
    await assertWorkspacePathContained(root, diagnosisRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  let candidateRunIds;
  if (runId) {
    candidateRunIds = [runId];
  } else {
    try {
      candidateRunIds = (await readdir(storyDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return null;
    }
  }
  const candidates = [];
  for (const candidateRunId of candidateRunIds) {
    if (!isSafeDiagnosisSegment(candidateRunId)) continue;
    const artifactPath = resolveContainedPath(storyDir, candidateRunId, 'bug-diagnosis.json');
    try {
      await stat(artifactPath);
    } catch {
      continue;
    }
    await assertRealPathContained(diagnosisRoot, artifactPath);
    try {
      const [raw, info] = await Promise.all([readFile(artifactPath, 'utf8'), stat(artifactPath)]);
      const evidence = JSON.parse(raw);
      if (evidence.story_id !== storyId || evidence.run_id !== candidateRunId) continue;
      candidates.push({
        artifactPath,
        artifact: toWorkspaceRelative(root, artifactPath),
        runId: candidateRunId,
        run: (manifest?.runs ?? []).find((item) => item.run_id === candidateRunId && item.story_id === storyId) ?? null,
        orderingTime: Date.parse(evidence.updated_at ?? evidence.created_at ?? '') || info.mtimeMs
      });
    } catch {
      // Ignore malformed or incomplete candidates; callers fail closed when
      // no valid self-describing diagnosis artifact remains.
    }
  }
  candidates.sort((left, right) => right.orderingTime - left.orderingTime || right.runId.localeCompare(left.runId));
  return candidates[0] ?? null;
}

export function summarizeBugDiagnosisEvidence(evidence) {
  const evaluation = evaluateBugDiagnosisEvidence(evidence);
  return {
    schema_version: evidence.schema_version,
    story_id: evidence.story_id,
    run_id: evidence.run_id,
    target_head_sha: evidence.target_head_sha,
    status: evaluation.status,
    return_to_node: evaluation.return_to_node,
    next_actions: evaluation.next_actions,
    failures: evaluation.failures,
    nodes: evidence.nodes.map(({ id, status, head_sha, evidence_refs, reason, path_id, analyses }) => ({
      id, status, head_sha, evidence_refs, reason, path_id, analyses
    }))
  };
}

export async function writeInitialBugDiagnosis(repoRoot, { story, runId }) {
  if (!isBugStory(story)) return null;
  assertSafeStoryPathSegment(story.story_id, 'bug diagnosis requires a valid Story id');
  assertSafeStoryPathSegment(runId, 'bug diagnosis requires a valid run id');
  const root = path.resolve(repoRoot);
  const targetHeadSha = await getCurrentHead(root);
  const evidence = createBugDiagnosisEvidence({ storyId: story.story_id, runId, targetHeadSha });
  const diagnosisRoot = path.join(getWorkspaceDir(root), 'bug-diagnosis');
  await mkdir(diagnosisRoot, { recursive: true });
  await assertWorkspacePathContained(root, diagnosisRoot);
  const storyDir = resolveContainedPath(diagnosisRoot, story.story_id);
  await mkdir(storyDir, { recursive: true });
  await assertRealPathContained(diagnosisRoot, storyDir);
  const artifactDir = resolveContainedPath(storyDir, runId);
  await mkdir(artifactDir, { recursive: true });
  await assertRealPathContained(storyDir, artifactDir);
  const artifactPath = resolveContainedPath(artifactDir, 'bug-diagnosis.json');
  try {
    const info = await lstat(artifactPath);
    if (info.isSymbolicLink()) throw new Error('bug diagnosis artifact path cannot be a symbolic link');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await writeFile(artifactPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return { evidence, artifactPath };
}

function isSafeDiagnosisSegment(value) {
  try {
    assertSafeStoryPathSegment(String(value), 'bug diagnosis path segment is invalid');
    return true;
  } catch {
    return false;
  }
}

function resolveContainedPath(parent, ...segments) {
  const resolvedParent = path.resolve(parent);
  const resolved = path.resolve(resolvedParent, ...segments);
  const relative = path.relative(resolvedParent, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('bug diagnosis artifact path escapes its configured directory');
  }
  return resolved;
}

async function assertRealPathContained(parent, candidate) {
  const [realParent, realCandidate] = await Promise.all([realpath(parent), realpath(candidate)]);
  resolveContainedPath(realParent, realCandidate);
}

async function assertWorkspacePathContained(root, candidate) {
  await assertRealPathContained(root, candidate);
  await assertRealPathContained(getWorkspaceDir(root), candidate);
}

async function assertArtifactIdentity(artifactPath, storyId, runId) {
  let evidence;
  try {
    evidence = JSON.parse(await readFile(artifactPath, 'utf8'));
  } catch (error) {
    throw new Error(`bug diagnosis artifact is unreadable: ${error.message}`);
  }
  if (evidence.story_id !== storyId || evidence.run_id !== runId) {
    throw new Error(`bug diagnosis artifact identity does not match Story ${storyId} and run ${runId}`);
  }
}

function applyEvaluation(evidence) {
  const evaluation = evaluateBugDiagnosisEvidence(evidence);
  return { ...evidence, ...evaluation };
}

function isAcceptedNode(node) {
  return node?.status === 'passed' || node?.status === 'not_applicable';
}

function validateEvidenceEnvelope(evidence) {
  if (!evidence || evidence.kind !== 'vibepro_bug_diagnosis_dag') throw new Error('invalid bug diagnosis evidence kind');
  if (evidence.schema_version !== BUG_DIAGNOSIS_SCHEMA_VERSION) throw new Error(`unsupported bug diagnosis schema: ${evidence.schema_version}`);
  if (!evidence.story_id || !evidence.run_id || !evidence.target_head_sha || !Array.isArray(evidence.nodes)) {
    throw new Error('bug diagnosis evidence is missing Story, run, HEAD, or nodes');
  }
}

async function getCurrentHead(repoRoot) {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  return stdout.trim();
}
