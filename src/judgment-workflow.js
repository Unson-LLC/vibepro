import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { assertArtifactWritePath, resolveArtifactRoute } from './artifact-routing.js';
import {
  addJudgmentEdge,
  addJudgmentNode,
  appendJudgmentEvaluation,
  createJudgmentDag,
  summarizeJudgmentDag
} from './judgment-dag.js';
import { extractMarkdownAcceptanceCriteria } from './markdown-acceptance-criteria.js';
import {
  STANDARD_JUDGMENT_AXES,
  evaluateSeniorJudgmentRun,
  renderSeniorJudgmentSummary
} from './senior-judgment-dag.js';
import { getWorkspaceDir, normalizeActiveStories, toWorkspaceRelative } from './workspace.js';

const execFileAsync = promisify(execFile);
const HUMAN_DECISIONS = new Set(['accepted', 'modified', 'rejected']);
const JUDGMENT_EFFECTS = new Set(['changed_plan', 'changed_review_focus', 'escalated_to_human', 'no_effect']);
const OUTCOME_STATUSES = new Set(['confirmed', 'mixed', 'falsified', 'unknown']);

export async function prepareJudgmentInput(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireText(options.storyId, 'judgment prepare requires --id <story-id>');
  await assertInitializedWorkspace(root);

  const config = await readJsonIfExists(path.join(getWorkspaceDir(root), 'config.json')) ?? {};
  const stories = normalizeActiveStories(config?.brainbase?.stories);
  const story = stories.find((item) => item.story_id === storyId) ?? {
    story_id: storyId,
    title: storyId,
    ssot: null
  };
  const reviewRoot = await resolveReviewRoot(root, storyId);
  const currentSenior = await readJsonIfExists(path.join(reviewRoot, 'senior-judgment.json'));
  const storySource = await readStorySource(root, storyId, story);
  const criteria = storySource.content
    ? extractMarkdownAcceptanceCriteria(storySource.content).map((item) => item.text)
    : [];
  const git = await collectGitContext(root);
  const runId = options.runId ?? buildRunId();
  const sourceRefs = uniqueStrings([
    storySource.path ?? '.vibepro/config.json',
    ...git.changed_files
  ]);
  const observations = git.changed_files.length > 0
    ? git.changed_files.slice(0, 50).map((file, index) => ({
        id: `repo-change-${index + 1}`,
        statement: `Repository change is present at ${file}`,
        source_ref: file,
        freshness: 'current'
      }))
    : [{
        id: 'story-context',
        statement: `Story ${storyId} is selected for development judgment preparation`,
        source_ref: storySource.path ?? '.vibepro/config.json',
        freshness: 'current'
      }];
  const decisionProfile = deriveDecisionProfile(git.changed_files);
  const input = {
    schema_version: '0.3.0',
    story_id: storyId,
    run_id: runId,
    parent_run_id: currentSenior?.run_id ?? null,
    goal: {
      statement: story.title ?? storyId,
      success_criteria: criteria.length > 0
        ? criteria
        : [`The intended outcome for ${storyId} is delivered and verified`]
    },
    observations,
    contradictions: [],
    problem_frame: {
      status: 'uncertain',
      statement: `Clarify the actual engineering problem for ${story.title ?? storyId}`,
      reason: 'Generated from repository facts only; VibePro intentionally does not infer or adopt semantic framing.'
    },
    development_cycle: {
      history_boundary: {
        kind: 'initial',
        source_ref: storySource.path ?? '.vibepro/config.json'
      },
      adopted_batches: [],
      current_constraint: {
        kind: 'value_constraint',
        status: 'unknown',
        statement: 'The current constraint has not yet been framed by a responsible human or judgment agent.',
        source_refs: sourceRefs,
        decision_evidence: {
          status: 'unknown',
          reason: 'The prepared draft does not infer an intervention direction from repository facts.',
          source_refs: sourceRefs
        }
      },
      proposed_batch: {
        id: `batch-${runId}`,
        story_ids: [storyId],
        source_refs: sourceRefs
      }
    },
    decision_profile: decisionProfile,
    axes: STANDARD_JUDGMENT_AXES.map((axis) => ({
      id: axis,
      activation: 'inactive',
      activation_reason: 'Prepared as inactive until the problem frame and relevant risk surface are explicitly reviewed.',
      hypotheses: []
    })),
    constraints: [],
    options: []
  };

  const defaultPath = path.join(reviewRoot, 'senior-judgment', 'input-draft.json');
  const outputPath = await resolveOutputPath(root, options.outputPath ?? defaultPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(input, null, 2)}\n`, 'utf8');

  return {
    schema_version: '0.1.0',
    story_id: storyId,
    run_id: runId,
    input,
    source_head_sha: git.head_sha,
    changed_files: git.changed_files,
    artifact: toWorkspaceRelative(root, outputPath),
    advisory: true,
    blocking: false
  };
}

export async function evaluateJudgmentWorkflow(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireText(options.storyId, 'judgment evaluate requires --id <story-id>');
  const inputPath = requireText(options.inputPath, 'judgment evaluate requires --input <input.json>');
  const resolvedInputPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(root, inputPath);
  const senior = await evaluateSeniorJudgmentRun(root, {
    storyId,
    inputPath: resolvedInputPath
  });
  const developmentDag = compileSeniorJudgmentToDevelopmentDag(senior);
  const artifacts = await writeDevelopmentJudgmentArtifacts(root, storyId, developmentDag, senior);
  const projection = buildProjection(developmentDag, artifacts.current_json);
  return {
    ...senior,
    senior,
    development_judgment: {
      dag: developmentDag,
      summary: summarizeJudgmentDag(developmentDag),
      projection,
      artifacts
    }
  };
}

export function compileSeniorJudgmentToDevelopmentDag(senior) {
  const storyId = requireText(senior?.story_id, 'senior judgment requires story_id');
  const runId = requireText(senior?.run_id, 'senior judgment requires run_id');
  const context = senior.decision_context ?? {};
  let dag = createJudgmentDag({
    scope: `vibepro:${storyId}`,
    storyId,
    eventId: `judgment-run:${runId}`,
    createdAt: senior.recorded_at ?? new Date().toISOString()
  });
  dag = {
    ...dag,
    run_id: runId,
    parent_run_id: senior.parent_run_id ?? null,
    source_model: senior.model,
    development_mode: senior.development_mode ?? null,
    recommendation: senior.recommendation ?? null,
    unknown_count: senior.unknowns?.length ?? 0,
    advisory: true,
    blocking: false,
    source_artifacts: senior.artifacts ?? null
  };

  dag = addJudgmentNode(dag, {
    id: 'goal_contract',
    question: 'What outcome is this Story trying to achieve?',
    context_snapshot: context.goal ?? null,
    evidence_refs: collectSourceRefs(context.observations),
    judgment: context.goal?.statement ?? storyId,
    decision: null,
    authority: { kind: 'human_context', ref: 'story_goal' },
    runner_type: 'human',
    status: 'accepted',
    expected_outcomes: (context.goal?.success_criteria ?? []).map((statement, index) => ({
      id: `goal-${index + 1}`,
      statement,
      metric: null
    }))
  });
  dag = addJudgmentNode(dag, {
    id: 'problem_frame',
    question: 'Is the problem framed correctly enough to choose an intervention?',
    context_snapshot: context.problem_frame ?? null,
    evidence_refs: collectSourceRefs(context.observations),
    assumptions: (context.contradictions ?? []).map((item) => item.statement ?? String(item)),
    judgment: [context.problem_frame?.statement, context.problem_frame?.reason].filter(Boolean).join(' — '),
    decision: context.problem_frame?.status ?? 'uncertain',
    authority: { kind: 'advisory', ref: 'vibepro-senior-judgment' },
    runner_type: 'deterministic_rule',
    status: 'accepted'
  });
  dag = addJudgmentNode(dag, {
    id: 'development_mode',
    question: 'Should the next development batch create value, simplify structure, or validate uncertainty?',
    context_snapshot: context.development_cycle ?? null,
    evidence_refs: collectDevelopmentCycleRefs(context.development_cycle),
    judgment: (senior.development_mode_reasons ?? []).join(' ') || 'No development mode was selected.',
    decision: senior.development_mode ?? null,
    authority: { kind: 'advisory', ref: 'vibepro-senior-judgment' },
    runner_type: 'deterministic_rule',
    status: senior.development_mode ? 'accepted' : 'proposed'
  });
  dag = addJudgmentNode(dag, {
    id: 'option_pruning',
    question: 'Which options remain viable after mode and constraint pruning?',
    context_snapshot: {
      viable_options: senior.viable_options ?? [],
      pruned_options: senior.pruned_options ?? [],
      active_axes: senior.active_axes ?? [],
      hypothesis_outcomes: senior.hypothesis_outcomes ?? []
    },
    evidence_refs: uniqueStrings((senior.hypothesis_outcomes ?? []).flatMap((item) => item.evidence_refs ?? [])),
    judgment: `${senior.viable_options?.length ?? 0} viable option(s); ${senior.pruned_options?.length ?? 0} pruned option(s).`,
    decision: (senior.viable_options ?? []).map((item) => item.id).join(', ') || null,
    authority: { kind: 'advisory', ref: 'vibepro-senior-judgment' },
    runner_type: 'deterministic_rule',
    status: 'accepted'
  });
  dag = addJudgmentNode(dag, {
    id: 'recommendation',
    question: 'What should the responsible human and delivery system do next?',
    context_snapshot: {
      reasons: senior.reasons ?? [],
      unknowns: senior.unknowns ?? [],
      next_actions: senior.next_actions ?? []
    },
    evidence_refs: uniqueStrings([
      senior.artifacts?.current_json,
      senior.artifacts?.run_json
    ]),
    judgment: (senior.reasons ?? []).join(' ') || senior.recommendation,
    decision: senior.recommendation ?? null,
    authority: { kind: 'advisory', ref: 'human_ci_repository_rules' },
    runner_type: 'deterministic_rule',
    status: 'proposed',
    expected_outcomes: (context.goal?.success_criteria ?? []).map((statement, index) => ({
      id: `goal-${index + 1}`,
      statement,
      metric: null
    }))
  });

  for (const [from, to] of [
    ['goal_contract', 'problem_frame'],
    ['problem_frame', 'development_mode'],
    ['development_mode', 'option_pruning'],
    ['option_pruning', 'recommendation']
  ]) {
    dag = addJudgmentEdge(dag, {
      from,
      to,
      relation: 'depends_on',
      reason: `${to} is evaluated after ${from}`
    });
  }
  return dag;
}

export async function recordJudgmentOutcome(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireText(options.storyId, 'judgment outcome record requires --id <story-id>');
  const runId = requireText(options.runId, 'judgment outcome record requires --run <run-id>');
  const humanDecision = requireAllowed(options.humanDecision, HUMAN_DECISIONS, '--human-decision');
  const effect = requireAllowed(options.effect, JUDGMENT_EFFECTS, '--effect');
  const status = requireAllowed(options.status, OUTCOME_STATUSES, '--status');
  const summary = requireText(options.summary, 'judgment outcome record requires --summary <text>');
  const reviewRoot = await resolveReviewRoot(root, storyId);
  const developmentRoot = path.join(reviewRoot, 'development-judgment');
  const currentPath = path.join(developmentRoot, 'current.json');
  const current = await readJsonIfExists(currentPath);
  if (!current) throw new Error(`development judgment is missing for Story ${storyId}`);
  if (current.run_id !== runId) {
    throw new Error(`judgment outcome --run ${runId} does not match current run ${current.run_id}`);
  }
  const evaluationId = options.evaluationId ?? `outcome-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const observedOutcomes = [
    { id: 'human_decision', observation: humanDecision },
    { id: 'judgment_effect', observation: effect },
    ...normalizeObservedOutcomes(options.observedOutcomes)
  ];
  const next = appendJudgmentEvaluation(current, 'recommendation', {
    evaluation_id: evaluationId,
    status,
    summary: `${summary} [human_decision=${humanDecision}; effect=${effect}]`,
    evidence_refs: uniqueStrings(options.evidenceRefs),
    observed_outcomes: observedOutcomes,
    observed_at: options.observedAt
  });
  const outcomeRoot = path.join(developmentRoot, 'outcomes');
  const outcomePath = await assertArtifactWritePath(root, path.relative(root, path.join(outcomeRoot, `${evaluationId}.json`)));
  const currentMarkdownPath = path.join(developmentRoot, 'current.md');
  const outcome = {
    schema_version: '0.1.0',
    evaluation_id: evaluationId,
    story_id: storyId,
    run_id: runId,
    human_decision: humanDecision,
    effect,
    status,
    summary,
    evidence_refs: uniqueStrings(options.evidenceRefs),
    observed_outcomes: observedOutcomes,
    observed_at: options.observedAt ?? new Date().toISOString(),
    advisory: true,
    blocking: false
  };
  await mkdir(outcomeRoot, { recursive: true });
  await writeFile(outcomePath, `${JSON.stringify(outcome, null, 2)}\n`, { flag: 'wx' });
  await writeFile(currentPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await writeFile(currentMarkdownPath, renderDevelopmentJudgmentMarkdown(next), 'utf8');
  return {
    outcome,
    projection: buildProjection(next, toWorkspaceRelative(root, currentPath)),
    artifact: toWorkspaceRelative(root, outcomePath)
  };
}

export async function readDevelopmentJudgmentProjection(repoRoot, storyId) {
  const root = path.resolve(repoRoot);
  try {
    const reviewRoot = await resolveReviewRoot(root, storyId);
    const currentPath = path.join(reviewRoot, 'development-judgment', 'current.json');
    const current = await readJsonIfExists(currentPath);
    if (!current) return emptyProjection();
    return buildProjection(current, toWorkspaceRelative(root, currentPath));
  } catch (error) {
    return {
      ...emptyProjection(),
      status: 'unavailable',
      error: sanitizeError(error)
    };
  }
}

export function renderJudgmentPrepareSummary(result) {
  return [
    `Judgment input draft: ${result.artifact}`,
    `Story: ${result.story_id}`,
    `Run: ${result.run_id}`,
    `Changed files observed: ${result.changed_files.length}`,
    'Problem framing remains uncertain until explicitly adopted.',
    'Judgment remains advisory and non-blocking.',
    ''
  ].join('\n');
}

export function renderJudgmentEvaluationSummary(result) {
  return [
    renderSeniorJudgmentSummary(result.senior).trimEnd(),
    `Development Judgment DAG: ${result.development_judgment.artifacts.current_json}`,
    `Nodes: ${result.development_judgment.summary.node_count}`,
    `Edges: ${result.development_judgment.summary.edge_count}`,
    'The DAG is advisory and cannot change PR readiness or merge authority.',
    ''
  ].join('\n');
}

export function renderJudgmentOutcomeSummary(result) {
  return [
    `Judgment outcome: ${result.outcome.evaluation_id}`,
    `Run: ${result.outcome.run_id}`,
    `Human decision: ${result.outcome.human_decision}`,
    `Effect: ${result.outcome.effect}`,
    `Outcome status: ${result.outcome.status}`,
    `Artifact: ${result.artifact}`,
    ''
  ].join('\n');
}

async function writeDevelopmentJudgmentArtifacts(root, storyId, dag, senior) {
  const reviewRoot = await resolveReviewRoot(root, storyId);
  const developmentRoot = path.join(reviewRoot, 'development-judgment');
  const runsRoot = path.join(developmentRoot, 'runs');
  const runJsonPath = await assertArtifactWritePath(root, path.relative(root, path.join(runsRoot, `${dag.run_id}.json`)));
  const runMarkdownPath = await assertArtifactWritePath(root, path.relative(root, path.join(runsRoot, `${dag.run_id}.md`)));
  const currentJsonPath = await assertArtifactWritePath(root, path.relative(root, path.join(developmentRoot, 'current.json')));
  const currentMarkdownPath = await assertArtifactWritePath(root, path.relative(root, path.join(developmentRoot, 'current.md')));
  await mkdir(runsRoot, { recursive: true });
  await writeFile(runJsonPath, `${JSON.stringify(dag, null, 2)}\n`, { flag: 'wx' });
  await writeFile(runMarkdownPath, renderDevelopmentJudgmentMarkdown(dag), { flag: 'wx' });
  await writeFile(currentJsonPath, `${JSON.stringify(dag, null, 2)}\n`, 'utf8');
  await writeFile(currentMarkdownPath, renderDevelopmentJudgmentMarkdown(dag), 'utf8');
  return {
    run_json: toWorkspaceRelative(root, runJsonPath),
    run_markdown: toWorkspaceRelative(root, runMarkdownPath),
    current_json: toWorkspaceRelative(root, currentJsonPath),
    current_markdown: toWorkspaceRelative(root, currentMarkdownPath),
    senior_json: senior.artifacts?.current_json ?? null,
    senior_markdown: senior.artifacts?.current_markdown ?? null
  };
}

function renderDevelopmentJudgmentMarkdown(dag) {
  const recommendation = dag.nodes.find((node) => node.id === 'recommendation');
  const evaluations = recommendation?.evaluations ?? [];
  return [
    '# Development Judgment DAG',
    '',
    `- Story: \`${dag.story_id}\``,
    `- Run: \`${dag.run_id}\``,
    `- Development mode: **${dag.development_mode ?? 'not_selected'}**`,
    `- Advisory recommendation: **${dag.recommendation ?? 'none'}**`,
    `- Unknowns: ${dag.unknown_count ?? 0}`,
    `- Outcome evaluations: ${evaluations.length}`,
    '- Blocking authority: **none**',
    '',
    '> This graph preserves judgment lineage. It does not control PR readiness, merge, or release.',
    '',
    '## Nodes',
    '',
    ...dag.nodes.map((node) => `- \`${node.id}\`: ${node.decision ?? node.judgment ?? 'no decision'}`),
    '',
    '## Outcome evaluations',
    '',
    ...(evaluations.length > 0
      ? evaluations.map((evaluation) => `- \`${evaluation.evaluation_id}\`: ${evaluation.status} — ${evaluation.summary}`)
      : ['- None']),
    ''
  ].join('\n');
}

function buildProjection(dag, artifact) {
  const recommendation = dag.nodes.find((node) => node.id === 'recommendation');
  const evaluations = recommendation?.evaluations ?? [];
  return {
    available: true,
    status: 'available',
    story_id: dag.story_id,
    run_id: dag.run_id,
    development_mode: dag.development_mode ?? null,
    recommendation: dag.recommendation ?? recommendation?.decision ?? null,
    unknown_count: dag.unknown_count ?? 0,
    outcome_count: evaluations.length,
    latest_outcome_status: evaluations.at(-1)?.status ?? null,
    artifact,
    advisory: true,
    blocking: false
  };
}

function emptyProjection() {
  return {
    available: false,
    status: 'not_recorded',
    story_id: null,
    run_id: null,
    development_mode: null,
    recommendation: null,
    unknown_count: 0,
    outcome_count: 0,
    latest_outcome_status: null,
    artifact: null,
    advisory: true,
    blocking: false,
    error: null
  };
}

async function resolveReviewRoot(root, storyId) {
  const route = await resolveArtifactRoute(root, 'review', { storyId });
  return assertArtifactWritePath(root, route.canonical.relative_path);
}

async function resolveOutputPath(root, outputPath) {
  const absolute = path.isAbsolute(outputPath) ? outputPath : path.resolve(root, outputPath);
  return assertArtifactWritePath(root, path.relative(root, absolute));
}

async function readStorySource(root, storyId, story) {
  const candidatePaths = uniqueStrings([story?.ssot]);
  try {
    const route = await resolveArtifactRoute(root, 'story', { storyId });
    candidatePaths.push(route.canonical.relative_path);
  } catch {
    // Story context may exist only in config during early preparation.
  }
  for (const candidate of candidatePaths) {
    const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(root, candidate);
    try {
      return { path: toWorkspaceRelative(root, absolute), content: await readFile(absolute, 'utf8') };
    } catch {
      // Try the next source.
    }
  }
  return { path: null, content: '' };
}

async function collectGitContext(root) {
  const [headSha, changed, staged, untracked] = await Promise.all([
    gitOptional(root, ['rev-parse', 'HEAD']),
    gitOptional(root, ['diff', '--name-only', 'HEAD']),
    gitOptional(root, ['diff', '--cached', '--name-only', 'HEAD']),
    gitOptional(root, ['ls-files', '--others', '--exclude-standard'])
  ]);
  return {
    head_sha: headSha || null,
    changed_files: uniqueStrings([
      ...splitLines(changed),
      ...splitLines(staged),
      ...splitLines(untracked)
    ])
  };
}

function deriveDecisionProfile(changedFiles) {
  const topLevel = new Set(changedFiles.map((file) => file.split('/')[0]).filter(Boolean));
  const sensitive = changedFiles.some((file) => /(migration|schema|auth|security|secret|workflow|runtime)/i.test(file));
  return {
    materiality: changedFiles.length > 12 ? 'high' : changedFiles.length > 0 ? 'medium' : 'low',
    reversibility: sensitive ? 'costly' : 'easy',
    blast_radius: topLevel.size > 2 ? 'multi_component' : 'local'
  };
}

function collectSourceRefs(observations = []) {
  return uniqueStrings(observations.map((item) => item?.source_ref));
}

function collectDevelopmentCycleRefs(cycle = {}) {
  return uniqueStrings([
    cycle.history_boundary?.source_ref,
    ...(cycle.adopted_batches ?? []).flatMap((batch) => batch.source_refs ?? []),
    ...(cycle.current_constraint?.source_refs ?? []),
    ...(cycle.current_constraint?.decision_evidence?.source_refs ?? []),
    ...(cycle.proposed_batch?.source_refs ?? [])
  ]);
}

function normalizeObservedOutcomes(value) {
  if (!value) return [];
  if (!Array.isArray(value)) throw new Error('--observed-outcome must be repeatable');
  return value.map((item, index) => {
    if (typeof item === 'object' && item) {
      return {
        id: requireText(item.id, `observed outcome ${index + 1} requires id`),
        observation: requireText(item.observation, `observed outcome ${index + 1} requires observation`)
      };
    }
    const text = String(item);
    const separator = text.indexOf(':');
    if (separator <= 0 || !text.slice(separator + 1).trim()) {
      throw new Error('--observed-outcome must use <id>:<observation>');
    }
    return { id: text.slice(0, separator).trim(), observation: text.slice(separator + 1).trim() };
  });
}

async function assertInitializedWorkspace(root) {
  try {
    await readFile(path.join(getWorkspaceDir(root), 'vibepro-manifest.json'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('judgment workflow requires an initialized VibePro workspace');
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

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function buildRunId() {
  return `judgment-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

function splitLines(value) {
  return String(value ?? '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function uniqueStrings(value) {
  return [...new Set((value ?? []).map((item) => String(item ?? '').trim()).filter(Boolean))];
}

function requireAllowed(value, allowed, flag) {
  const text = requireText(value, `judgment outcome record requires ${flag}`);
  if (!allowed.has(text)) throw new Error(`${flag} must be one of: ${[...allowed].join(', ')}`);
  return text;
}

function requireText(value, message) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(message);
  return text;
}

function sanitizeError(error) {
  return String(error?.message ?? error).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
}
