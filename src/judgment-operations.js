import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { assertArtifactWritePath, resolveArtifactRoute } from './artifact-routing.js';
import {
  evaluateJudgmentWorkflow,
  prepareJudgmentInput,
  readDevelopmentJudgmentProjection,
  recordJudgmentOutcome
} from './judgment-workflow.js';
import { validateSeniorJudgmentInput } from './senior-judgment-dag.js';
import { getWorkspaceDir, normalizeActiveStories, toWorkspaceRelative } from './workspace.js';

const execFileAsync = promisify(execFile);
const HUMAN_DECISIONS = new Set(['accepted', 'modified', 'rejected']);
const JUDGMENT_EFFECTS = new Set(['changed_plan', 'changed_review_focus', 'escalated_to_human', 'no_effect']);
const OUTCOME_STATUSES = new Set(['confirmed', 'mixed', 'falsified', 'unknown']);
const ACTIONABLE_RECOMMENDATIONS = new Set([
  'proceed',
  'investigate',
  'proceed_with_investigation',
  'choose_viable_option',
  'reduce_scope',
  'measure_first'
]);

export async function recordJudgmentApplicability(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireText(options.storyId, 'judgment applicability record requires --id <story-id>');
  const applicable = parseApplicable(options.applicable);
  const reason = requireText(options.reason, 'judgment applicability record requires --reason <text>');
  const developmentRoot = await resolveDevelopmentRoot(root, storyId);
  const recordedAt = options.recordedAt ?? new Date().toISOString();
  const recordId = options.recordId ?? `applicability-${timestampId(recordedAt)}-${randomUUID().slice(0, 8)}`;
  const historyPath = await safePath(root, path.join(developmentRoot, 'applicability', 'history', `${recordId}.json`));
  const currentPath = await safePath(root, path.join(developmentRoot, 'applicability', 'current.json'));
  const record = {
    schema_version: '0.1.0',
    record_id: recordId,
    story_id: storyId,
    applicable,
    reason,
    recorded_by: normalizeText(options.recordedBy) ?? 'unknown',
    recorded_at: recordedAt,
    artifact: toWorkspaceRelative(root, historyPath),
    advisory: true,
    blocking: false
  };
  await mkdir(path.dirname(historyPath), { recursive: true });
  await writeFile(historyPath, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  await mkdir(path.dirname(currentPath), { recursive: true });
  await writeFile(currentPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return {
    record,
    status: await getJudgmentOperationalStatus(root, storyId)
  };
}

export async function prepareOperationalJudgmentInput(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireText(options.storyId, 'judgment prepare requires --id <story-id>');
  const applicability = await readApplicability(root, storyId);
  if (!applicability) {
    throw new Error(
      `Judgment applicability is not recorded for Story ${storyId}. `
      + `Run \`vibepro judgment applicability record . --id ${storyId} --applicable yes|no --reason <text>\` first.`
    );
  }
  if (!applicability.applicable) {
    throw new Error(`Development Judgment is recorded as not applicable for Story ${storyId}: ${applicability.reason}`);
  }

  const prepared = await prepareJudgmentInput(root, options);
  const feedback = await readFeedbackPointer(root, storyId);
  const input = structuredClone(prepared.input);
  if (feedback) applyFeedbackToInput(input, feedback);

  const absoluteArtifact = path.resolve(root, prepared.artifact);
  await writeFile(absoluteArtifact, `${JSON.stringify(input, null, 2)}\n`, 'utf8');
  const draftReceiptPath = await writeDraftReceipt(root, storyId, {
    runId: prepared.run_id,
    artifact: prepared.artifact,
    sourceHeadSha: prepared.source_head_sha,
    feedback
  });

  return {
    ...prepared,
    input,
    feedback: feedback ? summarizeFeedback(feedback) : null,
    lifecycle: 'draft_prepared',
    draft_receipt: toWorkspaceRelative(root, draftReceiptPath)
  };
}

export async function adoptJudgmentInput(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireText(options.storyId, 'judgment input adopt requires --id <story-id>');
  const inputPath = requireText(options.inputPath, 'judgment input adopt requires --input <input.json>');
  const reviewedBy = requireText(options.reviewedBy, 'judgment input adopt requires --reviewed-by <actor>');
  const authority = requireText(options.authority, 'judgment input adopt requires --authority <source>');
  const summary = requireText(options.summary, 'judgment input adopt requires --summary <text>');
  const resolvedInputPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(root, inputPath);
  const bytes = await readFile(resolvedInputPath, 'utf8');
  const input = parseJson(bytes, `Invalid judgment input JSON at ${inputPath}`);
  if (input.story_id !== storyId) {
    throw new Error(`judgment input adopt --id ${storyId} does not match input story_id ${String(input.story_id)}`);
  }
  validateSeniorJudgmentInput(input);
  const runId = requireText(input.run_id, 'judgment input requires run_id');
  const digest = sha256(bytes);
  const developmentRoot = await resolveDevelopmentRoot(root, storyId);
  const adoptedInputPath = await safePath(root, path.join(developmentRoot, 'inputs', `${runId}.json`));
  const adoptionPath = await safePath(root, path.join(developmentRoot, 'adoptions', `${runId}.json`));
  const currentPath = await safePath(root, path.join(developmentRoot, 'adoptions', 'current.json'));
  const existing = await readJsonIfExists(adoptionPath);
  if (existing) {
    if (existing.input_sha256 !== digest) {
      throw new Error(`Judgment input ${runId} was already adopted with a different SHA-256 digest`);
    }
    return {
      adoption: existing,
      status: await getJudgmentOperationalStatus(root, storyId),
      idempotent: true
    };
  }

  await mkdir(path.dirname(adoptedInputPath), { recursive: true });
  await writeFile(adoptedInputPath, bytes, { flag: 'wx' });
  const adoptedAt = options.adoptedAt ?? new Date().toISOString();
  const record = {
    schema_version: '0.1.0',
    story_id: storyId,
    run_id: runId,
    source_input: toWorkspaceRelative(root, resolvedInputPath),
    adopted_input: toWorkspaceRelative(root, adoptedInputPath),
    input_sha256: digest,
    reviewed_by: reviewedBy,
    authority,
    review_summary: summary,
    source_head_sha: await gitOptional(root, ['rev-parse', 'HEAD']) || null,
    problem_frame_status: input.problem_frame?.status ?? null,
    active_axes: (input.axes ?? []).filter((axis) => axis.activation === 'active').map((axis) => axis.id),
    option_count: input.options?.length ?? 0,
    adopted_at: adoptedAt,
    artifact: toWorkspaceRelative(root, adoptionPath),
    advisory: true,
    blocking: false
  };
  await mkdir(path.dirname(adoptionPath), { recursive: true });
  await writeFile(adoptionPath, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  await writeFile(currentPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return {
    adoption: record,
    status: await getJudgmentOperationalStatus(root, storyId),
    idempotent: false
  };
}

export async function evaluateOperationalJudgmentWorkflow(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireText(options.storyId, 'judgment evaluate requires --id <story-id>');
  const inputPath = requireText(options.inputPath, 'judgment evaluate requires --input <input.json>');
  const resolvedInputPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(root, inputPath);
  const bytes = await readFile(resolvedInputPath, 'utf8');
  const input = parseJson(bytes, `Invalid judgment input JSON at ${inputPath}`);
  if (input.story_id !== storyId) {
    throw new Error(`judgment evaluate --id ${storyId} does not match input story_id ${String(input.story_id)}`);
  }
  const runId = requireText(input.run_id, 'judgment input requires run_id');
  const developmentRoot = await resolveDevelopmentRoot(root, storyId);
  const adoption = await readJsonIfExists(path.join(developmentRoot, 'adoptions', `${runId}.json`));
  if (!adoption) {
    throw new Error(
      `Judgment input ${runId} has not been adopted. `
      + `Run \`vibepro judgment input adopt . --id ${storyId} --input ${inputPath} --reviewed-by <actor> --authority <source> --summary <text>\` first.`
    );
  }
  const digest = sha256(bytes);
  if (adoption.input_sha256 !== digest) {
    throw new Error(`Judgment input ${runId} changed after adoption; prepare and adopt a new run instead`);
  }

  const result = await evaluateJudgmentWorkflow(root, {
    storyId,
    inputPath: resolvedInputPath
  });
  const actionable = isActionableEvaluation(result.senior);
  const evaluatedAt = new Date().toISOString();
  const evaluationPath = await safePath(root, path.join(developmentRoot, 'evaluations', `${runId}.json`));
  const currentPath = await safePath(root, path.join(developmentRoot, 'evaluations', 'current.json'));
  const receipt = {
    schema_version: '0.1.0',
    story_id: storyId,
    run_id: runId,
    input_sha256: digest,
    adoption_artifact: adoption.artifact,
    source_head_sha: await gitOptional(root, ['rev-parse', 'HEAD']) || null,
    actionable,
    reason_codes: evaluationReasonCodes(result.senior),
    development_mode: result.senior.development_mode ?? null,
    recommendation: result.senior.recommendation ?? null,
    unknown_count: result.senior.unknowns?.length ?? 0,
    viable_options: result.senior.viable_options ?? [],
    pruned_options: result.senior.pruned_options ?? [],
    next_actions: result.senior.next_actions ?? [],
    evaluated_at: evaluatedAt,
    artifact: toWorkspaceRelative(root, evaluationPath),
    advisory: true,
    blocking: false
  };
  await mkdir(path.dirname(evaluationPath), { recursive: true });
  await writeFile(evaluationPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  await writeFile(currentPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return {
    ...result,
    operational: receipt,
    operational_status: await getJudgmentOperationalStatus(root, storyId)
  };
}

export async function recordJudgmentDisposition(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireText(options.storyId, 'judgment disposition record requires --id <story-id>');
  const runId = requireText(options.runId, 'judgment disposition record requires --run <run-id>');
  const humanDecision = requireAllowed(options.humanDecision, HUMAN_DECISIONS, '--human-decision');
  const effect = requireAllowed(options.effect, JUDGMENT_EFFECTS, '--effect');
  const summary = requireText(options.summary, 'judgment disposition record requires --summary <text>');
  const developmentRoot = await resolveDevelopmentRoot(root, storyId);
  const evaluation = await readJsonIfExists(path.join(developmentRoot, 'evaluations', `${runId}.json`));
  if (!evaluation) throw new Error(`Judgment evaluation ${runId} is missing for Story ${storyId}`);
  const recordedAt = options.recordedAt ?? new Date().toISOString();
  const dispositionId = options.dispositionId ?? `disposition-${timestampId(recordedAt)}-${randomUUID().slice(0, 8)}`;
  const historyPath = await safePath(root, path.join(developmentRoot, 'dispositions', runId, 'history', `${dispositionId}.json`));
  const currentPath = await safePath(root, path.join(developmentRoot, 'dispositions', runId, 'current.json'));
  const record = {
    schema_version: '0.1.0',
    disposition_id: dispositionId,
    story_id: storyId,
    run_id: runId,
    human_decision: humanDecision,
    effect,
    summary,
    evidence_refs: uniqueStrings(options.evidenceRefs),
    recorded_by: normalizeText(options.recordedBy) ?? 'unknown',
    recorded_at: recordedAt,
    artifact: toWorkspaceRelative(root, historyPath),
    advisory: true,
    blocking: false
  };
  await mkdir(path.dirname(historyPath), { recursive: true });
  await writeFile(historyPath, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  await mkdir(path.dirname(currentPath), { recursive: true });
  await writeFile(currentPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await writeFeedbackPointer(root, storyId, {
    story_id: storyId,
    run_id: runId,
    development_mode: evaluation.development_mode,
    judgment_artifact: evaluation.artifact,
    disposition: record,
    outcome: null,
    updated_at: recordedAt
  });
  return {
    disposition: record,
    status: await getJudgmentOperationalStatus(root, storyId)
  };
}

export async function recordOperationalJudgmentOutcome(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireText(options.storyId, 'judgment outcome record requires --id <story-id>');
  const runId = requireText(options.runId, 'judgment outcome record requires --run <run-id>');
  const status = requireAllowed(options.status, OUTCOME_STATUSES, '--status');
  const summary = requireText(options.summary, 'judgment outcome record requires --summary <text>');
  const developmentRoot = await resolveDevelopmentRoot(root, storyId);
  const disposition = await readJsonIfExists(path.join(developmentRoot, 'dispositions', runId, 'current.json'));
  if (!disposition) {
    throw new Error(
      `Judgment disposition ${runId} is missing. `
      + `Record accepted/modified/rejected and its delivery effect before recording an outcome.`
    );
  }
  const evaluation = await readJsonIfExists(path.join(developmentRoot, 'evaluations', `${runId}.json`));
  if (!evaluation) throw new Error(`Judgment evaluation ${runId} is missing for Story ${storyId}`);
  const observedAt = options.observedAt ?? new Date().toISOString();
  const outcomeId = options.evaluationId ?? `outcome-${timestampId(observedAt)}-${randomUUID().slice(0, 8)}`;
  let legacy = null;
  const currentDag = await readJsonIfExists(path.join(developmentRoot, 'current.json'));
  if (currentDag?.run_id === runId) {
    legacy = await recordJudgmentOutcome(root, {
      storyId,
      runId,
      evaluationId: outcomeId,
      humanDecision: disposition.human_decision,
      effect: disposition.effect,
      status,
      summary,
      evidenceRefs: options.evidenceRefs,
      observedOutcomes: options.observedOutcomes,
      observedAt
    });
  }

  const historyPath = await safePath(root, path.join(developmentRoot, 'outcome-receipts', runId, 'history', `${outcomeId}.json`));
  const currentPath = await safePath(root, path.join(developmentRoot, 'outcome-receipts', runId, 'current.json'));
  const record = {
    schema_version: '0.1.0',
    evaluation_id: outcomeId,
    story_id: storyId,
    run_id: runId,
    status,
    summary,
    evidence_refs: uniqueStrings(options.evidenceRefs),
    observed_outcomes: normalizeObservedOutcomes(options.observedOutcomes),
    observed_at: observedAt,
    disposition_artifact: disposition.artifact,
    legacy_artifact: legacy?.artifact ?? null,
    artifact: toWorkspaceRelative(root, historyPath),
    advisory: true,
    blocking: false
  };
  await mkdir(path.dirname(historyPath), { recursive: true });
  await writeFile(historyPath, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  await mkdir(path.dirname(currentPath), { recursive: true });
  await writeFile(currentPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await writeFeedbackPointer(root, storyId, {
    story_id: storyId,
    run_id: runId,
    development_mode: evaluation.development_mode,
    judgment_artifact: evaluation.artifact,
    disposition,
    outcome: record,
    updated_at: observedAt
  });
  return {
    outcome: record,
    legacy,
    status: await getJudgmentOperationalStatus(root, storyId)
  };
}

export async function getJudgmentOperationalStatus(repoRoot, storyId) {
  const root = path.resolve(repoRoot);
  const id = requireText(storyId, 'judgment status requires --id <story-id>');
  const developmentRoot = await resolveDevelopmentRoot(root, id);
  const applicability = await readJsonIfExists(path.join(developmentRoot, 'applicability', 'current.json'));
  const draft = await readJsonIfExists(path.join(developmentRoot, 'drafts', 'current.json'));
  const adoption = await readJsonIfExists(path.join(developmentRoot, 'adoptions', 'current.json'));
  const evaluation = await readJsonIfExists(path.join(developmentRoot, 'evaluations', 'current.json'));
  const planBinding = await readJsonIfExists(path.join(developmentRoot, 'plan-bindings', 'current.json'));
  const runId = evaluation?.run_id ?? adoption?.run_id ?? draft?.run_id ?? null;
  const disposition = runId
    ? await readJsonIfExists(path.join(developmentRoot, 'dispositions', runId, 'current.json'))
    : null;
  const outcome = runId
    ? await readJsonIfExists(path.join(developmentRoot, 'outcome-receipts', runId, 'current.json'))
    : null;

  const lifecycle = resolveLifecycle({ applicability, draft, adoption, evaluation, planBinding, disposition, outcome });
  const nextActions = buildLifecycleNextActions(id, lifecycle, { draft, adoption, evaluation, planBinding, disposition, outcome });
  return {
    schema_version: '0.1.0',
    story_id: id,
    lifecycle,
    applicable: applicability?.applicable ?? null,
    applicability,
    run_id: runId,
    draft,
    adoption,
    evaluation,
    actionable: evaluation?.actionable ?? false,
    plan_binding: planBinding?.run_id === runId ? planBinding : null,
    disposition,
    outcome,
    pending_disposition: Boolean(evaluation?.actionable && (!planBinding || planBinding.run_id === runId) && !disposition),
    pending_outcome: Boolean(disposition && (!outcome || outcome.status === 'unknown')),
    next_actions: nextActions,
    advisory: true,
    blocking: false
  };
}

export async function listPendingJudgmentWork(repoRoot) {
  const root = path.resolve(repoRoot);
  const config = await readJsonIfExists(path.join(getWorkspaceDir(root), 'config.json')) ?? {};
  const stories = normalizeActiveStories(config?.brainbase?.stories);
  const pending = [];
  for (const story of stories) {
    const status = await getJudgmentOperationalStatus(root, story.story_id);
    if (status.pending_disposition || status.pending_outcome) {
      pending.push({
        story_id: story.story_id,
        title: story.title ?? story.story_id,
        lifecycle: status.lifecycle,
        run_id: status.run_id,
        pending_disposition: status.pending_disposition,
        pending_outcome: status.pending_outcome,
        next_actions: status.next_actions
      });
    }
  }
  return {
    schema_version: '0.1.0',
    pending_count: pending.length,
    pending,
    advisory: true,
    blocking: false
  };
}

export async function readOperationalJudgmentProjection(repoRoot, storyId) {
  const root = path.resolve(repoRoot);
  try {
    const [base, status] = await Promise.all([
      readDevelopmentJudgmentProjection(root, storyId),
      getJudgmentOperationalStatus(root, storyId)
    ]);
    return {
      ...base,
      lifecycle: status.lifecycle,
      applicable: status.applicable,
      input_adopted: Boolean(status.adoption),
      actionable: status.actionable,
      plan_binding: status.plan_binding,
      disposition: status.disposition,
      pending_disposition: status.pending_disposition,
      pending_outcome: status.pending_outcome,
      outcome: status.outcome,
      next_actions: status.next_actions,
      operational_status: status
    };
  } catch (error) {
    return {
      available: false,
      status: 'unavailable',
      lifecycle: 'unavailable',
      applicable: null,
      input_adopted: false,
      actionable: false,
      plan_binding: null,
      disposition: null,
      pending_disposition: false,
      pending_outcome: false,
      outcome: null,
      next_actions: [],
      artifact: null,
      advisory: true,
      blocking: false,
      error: sanitizeError(error)
    };
  }
}

export function applyDevelopmentJudgmentToPlan(plan, projection, options = {}) {
  const storyId = options.storyId ?? projection?.story_id ?? null;
  const next = structuredClone(plan);
  const binding = {
    schema_version: '0.1.0',
    story_id: storyId,
    status: projection?.applicable === false
      ? 'not_applicable'
      : projection?.actionable
        ? 'applied'
        : projection?.lifecycle ?? 'not_started',
    lifecycle_before_plan: projection?.lifecycle ?? 'not_started',
    run_id: projection?.run_id ?? null,
    development_mode: projection?.development_mode ?? null,
    recommendation: projection?.recommendation ?? null,
    actionable: Boolean(projection?.actionable),
    unknown_count: projection?.unknown_count ?? 0,
    judgment_artifact: projection?.artifact ?? null,
    evaluation_artifact: projection?.operational_status?.evaluation?.artifact ?? null,
    input_sha256: projection?.operational_status?.evaluation?.input_sha256 ?? null,
    source_head_sha: projection?.operational_status?.evaluation?.source_head_sha ?? null,
    effect: 'no_effect',
    advisory: true,
    blocking: false
  };

  if (binding.actionable && storyId) {
    const guidance = buildJudgmentGuidanceTask(storyId, projection);
    const existingTasks = Array.isArray(next.task_candidates) ? next.task_candidates : [];
    if (!existingTasks.some((task) => task.id === guidance.id)) {
      next.task_candidates = [guidance, ...existingTasks];
      binding.effect = 'changed_plan';
    }
    next.priority_stories = (next.priority_stories ?? []).map((story) => story.story_id === storyId
      ? { ...story, development_judgment: binding }
      : story);
    if ((projection.unknown_count ?? 0) > 0) {
      next.questions = [{
        story_id: storyId,
        field: 'development_judgment_unknowns',
        question: `Development Judgment ${projection.run_id} has ${projection.unknown_count} unresolved item(s); close or explicitly defer them before claiming the recommendation was followed.`,
        priority: 'high'
      }, ...(next.questions ?? [])].slice(0, 20);
    }
    next.next_commands = uniqueStrings([
      `vibepro judgment status . --id ${storyId}`,
      ...(next.next_commands ?? [])
    ]);
  }
  next.development_judgment = binding;
  return { plan: next, binding };
}

export async function recordDevelopmentJudgmentPlanConsumption(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireText(options.storyId, 'plan consumption requires storyId');
  const binding = options.binding ?? {};
  if (!binding.run_id || !binding.actionable) return null;
  const developmentRoot = await resolveDevelopmentRoot(root, storyId);
  const consumedAt = options.consumedAt ?? new Date().toISOString();
  const bindingId = options.bindingId ?? `plan-${timestampId(consumedAt)}-${randomUUID().slice(0, 8)}`;
  const historyPath = await safePath(root, path.join(developmentRoot, 'plan-bindings', 'history', `${bindingId}.json`));
  const currentPath = await safePath(root, path.join(developmentRoot, 'plan-bindings', 'current.json'));
  const record = {
    ...binding,
    binding_id: bindingId,
    plan_artifact: options.planArtifact ?? null,
    plan_markdown: options.planMarkdown ?? null,
    consumed_at: consumedAt,
    artifact: toWorkspaceRelative(root, historyPath),
    advisory: true,
    blocking: false
  };
  await mkdir(path.dirname(historyPath), { recursive: true });
  await writeFile(historyPath, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  await mkdir(path.dirname(currentPath), { recursive: true });
  await writeFile(currentPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

export function renderDevelopmentJudgmentPlanMarkdown(binding) {
  if (!binding) return '';
  return [
    '',
    '## Development Judgment',
    '',
    `- Lifecycle before plan: ${binding.lifecycle_before_plan ?? 'not_started'}`,
    `- Plan application: ${binding.status ?? 'not_started'}`,
    `- Run: ${binding.run_id ? `\`${binding.run_id}\`` : '-'}`,
    `- Development mode: ${binding.development_mode ?? 'not_selected'}`,
    `- Recommendation: ${binding.recommendation ?? 'none'}`,
    `- Plan effect: ${binding.effect ?? 'no_effect'}`,
    `- Actionable: ${Boolean(binding.actionable)}`,
    `- Advisory: true`,
    `- Blocking: false`,
    ''
  ].join('\n');
}

export function renderJudgmentApplicabilitySummary(result) {
  return [
    `Judgment applicability: ${result.record.applicable ? 'applicable' : 'not_applicable'}`,
    `Story: ${result.record.story_id}`,
    `Reason: ${result.record.reason}`,
    `Lifecycle: ${result.status.lifecycle}`,
    'Judgment applicability is advisory and non-blocking.',
    ''
  ].join('\n');
}

export function renderJudgmentAdoptionSummary(result) {
  return [
    `Judgment input adopted: ${result.adoption.run_id}`,
    `Input SHA-256: ${result.adoption.input_sha256}`,
    `Reviewed by: ${result.adoption.reviewed_by}`,
    `Authority: ${result.adoption.authority}`,
    `Lifecycle: ${result.status.lifecycle}`,
    ''
  ].join('\n');
}

export function renderJudgmentOperationalEvaluationSummary(result) {
  return [
    `Development Judgment evaluation: ${result.operational.run_id}`,
    `Actionable: ${result.operational.actionable}`,
    `Development mode: ${result.operational.development_mode ?? 'not_selected'}`,
    `Recommendation: ${result.operational.recommendation ?? 'none'}`,
    `Lifecycle: ${result.operational_status.lifecycle}`,
    'The evaluation is advisory and cannot change PR readiness or merge authority.',
    ''
  ].join('\n');
}

export function renderJudgmentDispositionSummary(result) {
  return [
    `Judgment disposition: ${result.disposition.disposition_id}`,
    `Run: ${result.disposition.run_id}`,
    `Human decision: ${result.disposition.human_decision}`,
    `Effect: ${result.disposition.effect}`,
    `Lifecycle: ${result.status.lifecycle}`,
    ''
  ].join('\n');
}

export function renderOperationalJudgmentOutcomeSummary(result) {
  return [
    `Judgment outcome: ${result.outcome.evaluation_id}`,
    `Run: ${result.outcome.run_id}`,
    `Outcome status: ${result.outcome.status}`,
    `Lifecycle: ${result.status.lifecycle}`,
    `Artifact: ${result.outcome.artifact}`,
    ''
  ].join('\n');
}

export function renderJudgmentOperationalStatus(result) {
  return [
    `Judgment lifecycle: ${result.lifecycle}`,
    `Story: ${result.story_id}`,
    `Applicable: ${result.applicable === null ? 'not_recorded' : result.applicable}`,
    `Run: ${result.run_id ?? '-'}`,
    `Input adopted: ${Boolean(result.adoption)}`,
    `Actionable: ${result.actionable}`,
    `Consumed by plan: ${Boolean(result.plan_binding)}`,
    `Pending disposition: ${result.pending_disposition}`,
    `Pending outcome: ${result.pending_outcome}`,
    'Next actions:',
    ...(result.next_actions.length ? result.next_actions.map((action) => `- ${action}`) : ['- none']),
    'Judgment remains advisory and non-blocking.',
    ''
  ].join('\n');
}

export function renderPendingJudgmentWork(result) {
  if (result.pending.length === 0) return 'No pending judgment disposition or outcome work.\n';
  return [
    `Pending judgment work: ${result.pending_count}`,
    ...result.pending.flatMap((item) => [
      `- ${item.story_id}: ${item.lifecycle} (run=${item.run_id ?? '-'})`,
      ...item.next_actions.map((action) => `  - ${action}`)
    ]),
    ''
  ].join('\n');
}

function resolveLifecycle({ applicability, draft, adoption, evaluation, planBinding, disposition, outcome }) {
  if (!applicability) return 'not_started';
  if (!applicability.applicable) return 'not_applicable';
  if (!draft) return 'applicable_not_prepared';
  const currentRunId = evaluation?.run_id ?? adoption?.run_id ?? draft?.run_id;
  if (!adoption || adoption.run_id !== draft.run_id) return 'draft_prepared';
  if (!evaluation || evaluation.run_id !== adoption.run_id) return 'input_reviewed';
  if (!evaluation.actionable) return 'evaluated_unactionable';
  if (!planBinding || planBinding.run_id !== currentRunId) return 'evaluated_actionable';
  if (!disposition) return 'consumed_by_plan';
  if (!outcome || outcome.status === 'unknown') return 'outcome_pending';
  return 'closed';
}

function buildLifecycleNextActions(storyId, lifecycle, state) {
  const draftArtifact = state.draft?.artifact ?? '<input-draft.json>';
  const adoptedInput = state.adoption?.adopted_input ?? '<adopted-input.json>';
  const runId = state.evaluation?.run_id ?? state.adoption?.run_id ?? state.draft?.run_id ?? '<run-id>';
  const commands = {
    not_started: [`vibepro judgment applicability record . --id ${storyId} --applicable yes|no --reason <text>`],
    not_applicable: [],
    applicable_not_prepared: [`vibepro judgment prepare . --id ${storyId}`],
    draft_prepared: [
      `Review and edit ${draftArtifact}`,
      `vibepro judgment input adopt . --id ${storyId} --input ${draftArtifact} --reviewed-by <actor> --authority <source> --summary <text>`
    ],
    input_reviewed: [`vibepro judgment evaluate . --id ${storyId} --input ${adoptedInput}`],
    evaluated_unactionable: [`Resolve the recorded problem-frame or evidence gaps, then prepare a new judgment run for ${storyId}`],
    evaluated_actionable: ['vibepro story plan .'],
    consumed_by_plan: [
      `vibepro judgment disposition record . --id ${storyId} --run ${runId} --human-decision accepted|modified|rejected --effect changed_plan|changed_review_focus|escalated_to_human|no_effect --summary <text>`
    ],
    outcome_pending: [
      `vibepro judgment outcome record . --id ${storyId} --run ${runId} --status confirmed|mixed|falsified|unknown --summary <text> --evidence <ref>`
    ],
    closed: []
  };
  return commands[lifecycle] ?? [];
}

function buildJudgmentGuidanceTask(storyId, projection) {
  const mode = projection.development_mode ?? 'VALIDATE';
  const modeText = {
    VALUE: '価値制約を直接解く最小の選択肢を実行する',
    SIMPLIFY: '追加実装より削除・統合・再設計を優先し、構造面を増やさない',
    VALIDATE: '本実装より先に識別的な証拠を得る検証を実行する'
  }[mode] ?? '判断で示された次アクションを明示的に計画へ反映する';
  const nextActions = projection.operational_status?.evaluation?.next_actions ?? [];
  return {
    id: `${storyId}-development-judgment-${mode.toLowerCase()}`,
    story_id: storyId,
    title: `Development Judgment ${mode}を計画へ反映する`,
    purpose: `${modeText}。Recommendation: ${projection.recommendation ?? 'none'}`,
    acceptance: [
      `Judgment run ${projection.run_id}を計画根拠として保持する`,
      modeText,
      ...(nextActions.length ? nextActions.map((action) => `次アクション: ${formatNextAction(action)}`) : ['未解決事項を明示的に閉じるかdeferする'])
    ],
    priority: 'high',
    source_type: 'development_judgment',
    source_file: projection.artifact,
    target_files: [],
    read_first_files: projection.artifact ? [{ file: projection.artifact, reason: 'Development Judgmentの判断正本' }] : [],
    graph_context: null,
    recommended_strategy: {
      id: `judgment-${mode.toLowerCase()}`,
      reason: projection.recommendation ?? modeText
    },
    implementation_steps: [
      { id: 'review-judgment', title: '判断正本を確認する', detail: `Run ${projection.run_id}の根拠・unknown・pruned optionsを確認する` },
      { id: 'apply-mode', title: `${mode}モードを適用する`, detail: modeText },
      { id: 'record-disposition', title: '採択と影響を記録する', detail: '実装またはレビューへ与えた影響をjudgment dispositionとして記録する' }
    ],
    suggested_command: `vibepro judgment status . --id ${storyId}`,
    execution_policy: 'proposal_only',
    mutates_repository: false,
    judgment_binding: {
      run_id: projection.run_id,
      development_mode: mode,
      recommendation: projection.recommendation,
      advisory: true,
      blocking: false
    }
  };
}

function applyFeedbackToInput(input, feedback) {
  const sourceRefs = uniqueStrings([
    feedback.judgment_artifact,
    feedback.disposition?.artifact,
    feedback.outcome?.artifact
  ]);
  const outcomeStatus = feedback.outcome?.status ?? 'unknown';
  const mode = feedback.development_mode ?? null;
  input.observations = [
    ...(input.observations ?? []),
    {
      id: `previous-judgment-${feedback.run_id}`,
      statement: feedback.outcome
        ? `Previous judgment ${feedback.run_id} produced outcome ${outcomeStatus}`
        : `Previous judgment ${feedback.run_id} was adopted but its external outcome is still unknown`,
      source_ref: feedback.outcome?.artifact ?? feedback.disposition?.artifact ?? feedback.judgment_artifact,
      freshness: 'current'
    }
  ];
  if (feedback.outcome?.status === 'confirmed') {
    input.development_cycle.history_boundary = {
      kind: mode === 'SIMPLIFY' ? 'simplification_baseline' : 'verified_external_outcome',
      source_ref: feedback.outcome.artifact
    };
    input.development_cycle.adopted_batches = [];
  } else {
    input.development_cycle.adopted_batches = [{
      id: `batch-${feedback.run_id}`,
      story_ids: [feedback.story_id],
      change_kind: modeToChangeKind(mode),
      structural_effect: modeToStructuralEffect(mode),
      external_outcome: outcomeToExternalOutcome(outcomeStatus),
      source_refs: sourceRefs.length ? sourceRefs : ['previous-judgment-outcome-unavailable']
    }];
  }
}

function summarizeFeedback(feedback) {
  return {
    run_id: feedback.run_id,
    development_mode: feedback.development_mode,
    disposition: feedback.disposition?.human_decision ?? null,
    effect: feedback.disposition?.effect ?? null,
    outcome: feedback.outcome?.status ?? null,
    source: feedback.outcome?.artifact ?? feedback.disposition?.artifact ?? feedback.judgment_artifact
  };
}

async function writeDraftReceipt(root, storyId, { runId, artifact, sourceHeadSha, feedback }) {
  const developmentRoot = await resolveDevelopmentRoot(root, storyId);
  const receiptPath = await safePath(root, path.join(developmentRoot, 'drafts', `${runId}.json`));
  const currentPath = await safePath(root, path.join(developmentRoot, 'drafts', 'current.json'));
  const record = {
    schema_version: '0.1.0',
    story_id: storyId,
    run_id: runId,
    artifact,
    source_head_sha: sourceHeadSha,
    feedback: feedback ? summarizeFeedback(feedback) : null,
    prepared_at: new Date().toISOString(),
    advisory: true,
    blocking: false
  };
  await mkdir(path.dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  await writeFile(currentPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return receiptPath;
}

async function writeFeedbackPointer(root, storyId, feedback) {
  const developmentRoot = await resolveDevelopmentRoot(root, storyId);
  const target = await safePath(root, path.join(developmentRoot, 'feedback', 'current.json'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(feedback, null, 2)}\n`, 'utf8');
}

async function readFeedbackPointer(root, storyId) {
  const developmentRoot = await resolveDevelopmentRoot(root, storyId);
  return readJsonIfExists(path.join(developmentRoot, 'feedback', 'current.json'));
}

async function readApplicability(root, storyId) {
  const developmentRoot = await resolveDevelopmentRoot(root, storyId);
  return readJsonIfExists(path.join(developmentRoot, 'applicability', 'current.json'));
}

async function resolveDevelopmentRoot(root, storyId) {
  const route = await resolveArtifactRoute(root, 'review', { storyId });
  const reviewRoot = await assertArtifactWritePath(root, route.canonical.relative_path);
  return path.join(reviewRoot, 'development-judgment');
}

async function safePath(root, absolutePath) {
  return assertArtifactWritePath(root, path.relative(root, absolutePath));
}

function isActionableEvaluation(senior) {
  const frameValid = senior?.decision_context?.problem_frame?.status === 'valid';
  if (!frameValid || !senior?.development_mode) return false;
  if (senior.recommendation === 'revise_problem' || senior.recommendation === 'human_decision_required') return false;
  if (ACTIONABLE_RECOMMENDATIONS.has(senior.recommendation)) return true;
  return Array.isArray(senior.next_actions) && senior.next_actions.length > 0;
}

function evaluationReasonCodes(senior) {
  const reasons = [];
  const frame = senior?.decision_context?.problem_frame?.status;
  if (frame !== 'valid') reasons.push(`problem_frame_${frame ?? 'missing'}`);
  if (!senior?.development_mode) reasons.push('development_mode_not_selected');
  if (senior?.unknowns?.length) reasons.push('unknowns_present');
  if (senior?.recommendation) reasons.push(`recommendation_${senior.recommendation}`);
  return reasons;
}

function modeToChangeKind(mode) {
  return { VALUE: 'addition', SIMPLIFY: 'simplification', VALIDATE: 'validation' }[mode] ?? 'validation';
}

function modeToStructuralEffect(mode) {
  return { VALUE: 'increase', SIMPLIFY: 'decrease', VALIDATE: 'neutral' }[mode] ?? 'unknown';
}

function outcomeToExternalOutcome(status) {
  return { confirmed: 'improved', mixed: 'unchanged', falsified: 'regressed', unknown: 'unknown' }[status] ?? 'unknown';
}

function parseApplicable(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['yes', 'true', 'applicable', '1'].includes(normalized)) return true;
  if (['no', 'false', 'not_applicable', 'not-applicable', '0'].includes(normalized)) return false;
  throw new Error('--applicable must be yes|no');
}

function parseJson(bytes, prefix) {
  try {
    return JSON.parse(bytes);
  } catch (error) {
    throw new Error(`${prefix}: ${error.message}`);
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function gitOptional(root, args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: root, encoding: 'utf8' });
    return stdout.trim();
  } catch {
    return '';
  }
}

function normalizeObservedOutcomes(values) {
  return (values ?? []).map((value) => {
    if (value && typeof value === 'object') return value;
    const [id, ...rest] = String(value).split(':');
    return {
      id: normalizeText(id) ?? `observation-${randomUUID().slice(0, 8)}`,
      observation: normalizeText(rest.join(':')) ?? String(value)
    };
  });
}

function formatNextAction(action) {
  if (typeof action === 'string') return action;
  if (!action || typeof action !== 'object') return String(action);
  return [action.type, action.hypothesis_id, action.detail, action.summary].filter(Boolean).join(' / ') || JSON.stringify(action);
}

function requireAllowed(value, allowed, flag) {
  const normalized = requireText(value, `${flag} is required`);
  if (!allowed.has(normalized)) throw new Error(`${flag} must be one of: ${[...allowed].join(', ')}`);
  return normalized;
}

function requireText(value, message) {
  const normalized = normalizeText(value);
  if (!normalized) throw new Error(message);
  return normalized;
}

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function uniqueStrings(values = []) {
  return [...new Set((values ?? []).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function timestampId(value) {
  return String(value).replace(/[^0-9A-Za-z]+/g, '-').replace(/^-+|-+$/g, '');
}

function sanitizeError(error) {
  return String(error?.message ?? error)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}
