import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { findStorySource } from './requirement-consistency.js';

const execFileAsync = promisify(execFile);

export const DEVELOPMENT_MODES = Object.freeze(['VALUE', 'VALIDATE', 'SIMPLIFY']);
export const DEVELOPMENT_INTENTS = Object.freeze(['value', 'validation', 'simplification']);

export const DEFAULT_DEVELOPMENT_CONTROL = Object.freeze({
  enforcement: 'shadow',
  shadow_batches: 1,
  structural: {
    loc_warning_ratio: 0.05,
    loc_simplify_ratio: 0.10,
    import_edge_warning_ratio: 0.05,
    import_edge_simplify_ratio: 0.10,
    file_warning_ratio: 0.03,
    file_simplify_ratio: 0.05,
    reject_new_dependency_cycle: true,
    reject_workflow_control_surface_increase: true
  },
  consumption: {
    rolling_median_window: 5,
    rolling_p95_window: 20,
    bootstrap: {
      fresh_input_tokens: 8_000_000,
      agent_executions: 6,
      repair_batches: 3,
      expensive_verifications: 1,
      verification_duration_ms: 2_700_000
    }
  }
});

const SOURCE_FILE = /\.(?:c|cc|cpp|cjs|go|java|js|jsx|mjs|py|rb|rs|ts|tsx)$/;
const CODE_ROOT = /^(?:bin|packages|scripts|src|test)\//;
const CONTROL_SURFACE = /(?:^|\/)(?:\.github\/workflows(?:\/|$)|src\/.*(?:gate|guard|review|evidence|workflow|judgment|decision|control)[^/]*(?:\/|$)|skills\/.*(?:gate|workflow|review)[^/]*(?:\/|$))/i;
const EXPENSIVE_VERIFICATION = /(?:e2e|browser|performance|security|full_suite|integration)/i;

export function normalizeDevelopmentControl(config = {}) {
  const input = config.development_control ?? config;
  if (input.enforcement !== undefined && !['shadow', 'enforced'].includes(input.enforcement)) {
    throw new Error('development_control.enforcement must be shadow or enforced');
  }
  const normalized = {
    ...DEFAULT_DEVELOPMENT_CONTROL,
    ...input,
    structural: {
      ...DEFAULT_DEVELOPMENT_CONTROL.structural,
      ...(input.structural ?? {})
    },
    consumption: {
      ...DEFAULT_DEVELOPMENT_CONTROL.consumption,
      ...(input.consumption ?? {}),
      bootstrap: {
        ...DEFAULT_DEVELOPMENT_CONTROL.consumption.bootstrap,
        ...(input.consumption?.bootstrap ?? {})
      }
    }
  };
  validateDevelopmentControlPolicy(normalized);
  return normalized;
}

export function evaluateStructuralBudget(baseline, observed, policyInput = {}) {
  const policy = normalizeDevelopmentControl(policyInput).structural;
  const findings = [];
  compareRatio('loc', baseline?.loc, observed?.loc, policy.loc_warning_ratio, policy.loc_simplify_ratio, findings);
  compareRatio('import_edges', baseline?.import_edges, observed?.import_edges, policy.import_edge_warning_ratio, policy.import_edge_simplify_ratio, findings);
  compareRatio('file_count', baseline?.file_count, observed?.file_count, policy.file_warning_ratio, policy.file_simplify_ratio, findings);
  compareDelta('dependency_cycles', baseline?.dependency_cycles, observed?.dependency_cycles, policy.reject_new_dependency_cycle, findings);
  compareDelta('workflow_control_surfaces', baseline?.workflow_control_surfaces, observed?.workflow_control_surfaces, policy.reject_workflow_control_surface_increase, findings);
  const unknown = findings.filter((item) => item.status === 'unknown').map((item) => item.metric);
  const mode = findings.some((item) => item.status === 'simplify')
    ? 'SIMPLIFY'
    : unknown.length > 0
      ? 'VALIDATE'
      : 'VALUE';
  return { mode, findings, unknown_metrics: unknown };
}

export function deriveConsumptionCaps(history = [], policyInput = {}) {
  const policy = normalizeDevelopmentControl(policyInput).consumption;
  const caps = {};
  for (const [metric, bootstrap] of Object.entries(policy.bootstrap)) {
    const values = history
      .map((item) => item?.consumption?.[metric] ?? item?.[metric])
      .filter(Number.isFinite);
    if (values.length === 0) {
      caps[metric] = { value: bootstrap, source: 'bootstrap', sample_count: 0 };
      continue;
    }
    const medianValues = values.slice(-policy.rolling_median_window);
    const p95Values = values.slice(-policy.rolling_p95_window);
    const medianCap = median(medianValues) * 2;
    const p95Cap = percentile(p95Values, 0.95);
    caps[metric] = {
      value: Math.max(medianCap, p95Cap),
      source: 'rolling',
      sample_count: values.length,
      median_5: median(medianValues),
      p95_20: p95Cap
    };
  }
  return caps;
}

export function evaluateConsumptionBudget(observed = {}, history = [], policyInput = {}) {
  const caps = deriveConsumptionCaps(history, policyInput);
  const findings = Object.entries(caps).map(([metric, cap]) => {
    const value = observed[metric];
    if (!Number.isFinite(value)) return { metric, status: 'unknown', observed: null, cap: cap.value, cap_source: cap.source };
    return {
      metric,
      status: value > cap.value ? 'simplify' : 'within_budget',
      observed: value,
      cap: cap.value,
      cap_source: cap.source
    };
  });
  const unknown = findings.filter((item) => item.status === 'unknown').map((item) => item.metric);
  const mode = findings.some((item) => item.status === 'simplify')
    ? 'SIMPLIFY'
    : unknown.length > 0
      ? 'VALIDATE'
      : 'VALUE';
  return { mode, caps, findings, unknown_metrics: unknown };
}

export function deriveDevelopmentControlDecision({ structural, consumption }) {
  const modes = [structural?.mode, consumption?.mode];
  const mode = modes.includes('SIMPLIFY') ? 'SIMPLIFY' : modes.includes('VALIDATE') ? 'VALIDATE' : 'VALUE';
  return {
    mode,
    reasons: [
      ...(structural?.findings ?? []).filter((item) => item.status !== 'within_budget'),
      ...(consumption?.findings ?? []).filter((item) => item.status !== 'within_budget')
    ]
  };
}

export function evaluateDevelopmentAdmission({ mode = 'VALUE', intent, enforcement = 'shadow' }) {
  if (!DEVELOPMENT_MODES.includes(mode)) throw new Error('development control mode must be VALUE, VALIDATE, or SIMPLIFY');
  if (!['shadow', 'enforced'].includes(enforcement)) throw new Error('development control enforcement must be shadow or enforced');
  const normalizedIntent = String(intent ?? '').trim().toLowerCase();
  if (!DEVELOPMENT_INTENTS.includes(normalizedIntent)) {
    return {
      status: enforcement === 'enforced' ? 'blocked' : 'shadow_blocked',
      allowed: enforcement !== 'enforced',
      reason: 'development_intent must be value, validation, or simplification'
    };
  }
  const allowedIntents = mode === 'SIMPLIFY'
    ? ['simplification']
    : mode === 'VALIDATE'
      ? ['validation', 'simplification']
      : DEVELOPMENT_INTENTS;
  const matches = allowedIntents.includes(normalizedIntent);
  return {
    status: matches ? 'allowed' : enforcement === 'enforced' ? 'blocked' : 'shadow_blocked',
    allowed: matches || enforcement !== 'enforced',
    reason: matches ? null : `${mode} permits only: ${allowedIntents.join(', ')}`,
    allowed_intents: allowedIntents,
    requested_intent: normalizedIntent || null
  };
}

export async function collectStructuralMetrics(repoRoot, ref = 'HEAD', options = {}) {
  const runGit = options.runGit ?? git;
  const filesOutput = await runGit(repoRoot, ['ls-tree', '-r', '--name-only', ref]);
  const repositoryFiles = filesOutput.split('\n').filter(Boolean);
  const sourceFiles = repositoryFiles.filter((file) => CODE_ROOT.test(file) && SOURCE_FILE.test(file));
  const sourceSet = new Set(sourceFiles);
  const grepOutput = await runGit(repoRoot, ['grep', '-I', '-n', '-e', '.', ref, '--', ...sourceRoots(sourceFiles)], { allowNoMatch: true });
  const lines = grepOutput.split('\n').filter(Boolean);
  const importLines = lines.filter((line) => /\b(?:import|export)\b.*?from\s*['"]\.|\brequire\(\s*['"]\./.test(line));
  const dependencyGraph = buildDependencyGraph(importLines, sourceSet);
  return {
    ref,
    commit: (await runGit(repoRoot, ['rev-parse', ref])).trim(),
    loc: lines.length,
    file_count: sourceFiles.length,
    import_edges: [...dependencyGraph.values()].reduce((sum, targets) => sum + targets.size, 0),
    dependency_cycles: countDependencyCycles(dependencyGraph),
    workflow_control_surfaces: repositoryFiles.filter((file) => CONTROL_SURFACE.test(file)).length
  };
}

export async function collectConsumptionMetrics(repoRoot, storyId) {
  validateStoryId(storyId);
  const workspace = path.join(path.resolve(repoRoot), '.vibepro');
  const files = await listJsonFiles(workspace);
  const relevant = files.filter((file) => belongsToStory(file, storyId));
  const documents = [];
  let incomplete = false;
  for (const file of relevant) {
    try {
      documents.push(JSON.parse(await readFile(file, 'utf8')));
    } catch {
      incomplete = true;
    }
  }
  return incomplete ? unknownConsumptionMetrics() : extractConsumptionMetrics(documents);
}

export function extractConsumptionMetrics(documents = []) {
  const usageObjects = new Map();
  const verifications = new Map();
  const repairIds = new Set();
  let anonymousUsageCount = 0;
  walk(documents, (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const provenance = value.agent_provenance && typeof value.agent_provenance === 'object'
      ? value.agent_provenance
      : null;
    const usage = value.agent_usage && typeof value.agent_usage === 'object'
      ? value.agent_usage
      : null;
    if (provenance || usage) {
      const identity = provenance
        ? `provenance:${stableObjectKey(provenance)}`
        : usage?.agent_id
        ?? usage?.session_id
        ?? usage?.call_id
        ?? `anonymous:${anonymousUsageCount++}`;
      usageObjects.set(identity, usage ?? {});
    }
    const verification = normalizeVerification(value);
    if (verification) verifications.set(verification.identity, verification);
    if (['needs_changes', 'repaired', 'repair_required'].includes(value.status) && (value.id || value.review_id || value.run_id)) {
      repairIds.add(value.id ?? value.review_id ?? value.run_id);
    }
  });
  const usages = [...usageObjects.values()];
  const verificationRuns = [...verifications.values()];
  const tokenCandidates = usages.map((usage) => usage.fresh_input_tokens ?? usage.input_tokens ?? usage.total_tokens);
  const tokenValues = tokenCandidates.filter(Number.isFinite);
  return {
    fresh_input_tokens: tokenCandidates.length > 0 && tokenValues.length === tokenCandidates.length
      ? tokenValues.reduce((sum, value) => sum + value, 0)
      : null,
    agent_executions: usages.length > 0 ? usages.length : null,
    repair_batches: usages.length > 0 ? repairIds.size : null,
    expensive_verifications: verificationRuns.length > 0
      ? verificationRuns.filter((item) => EXPENSIVE_VERIFICATION.test(item.kind)).length
      : null,
    verification_duration_ms: verificationRuns.length > 0
      ? verificationRuns.reduce((sum, item) => sum + item.duration_ms, 0)
      : null
  };
}

export async function createDevelopmentSnapshot(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = validateStoryId(requireValue(options.storyId, 'storyId'));
  const config = normalizeDevelopmentControl(await readRepositoryControlConfig(root));
  const adopted = await collectStructuralMetrics(root, options.commit ?? 'HEAD', options);
  validateCommitSha(adopted.commit);
  const controlState = await readDevelopmentControlState(root);
  const history = controlState?.history ?? [];
  const improvedOutcome = options.baseline ? null : controlState?.latest_improved_outcome ?? null;
  const baselineRef = options.baseline ?? improvedOutcome?.adopted_commit ?? config.baseline_commit;
  if (!baselineRef) throw new Error('development_control.baseline_commit or --baseline is required');
  const baseline = await collectStructuralMetrics(root, baselineRef, options);
  const consumptionMetrics = options.consumption ?? await collectConsumptionMetrics(root, storyId);
  const structural = evaluateStructuralBudget(baseline, adopted, config);
  const consumption = evaluateConsumptionBudget(consumptionMetrics, history, config);
  const decision = deriveDevelopmentControlDecision({ structural, consumption });
  const snapshot = {
    schema_version: '0.1.0',
    story_id: storyId,
    adopted_commit: adopted.commit,
    baseline_commit: baseline.commit,
    baseline_source: options.baseline ? 'explicit' : improvedOutcome ? 'improved_outcome' : 'config',
    recorded_at: new Date().toISOString(),
    enforcement: effectiveEnforcement(config, history.length),
    structural: { baseline, observed: adopted, evaluation: structural },
    consumption: consumptionMetrics,
    consumption_evaluation: consumption,
    decision,
    immutable: true
  };
  const paths = developmentControlPaths(root, storyId, adopted.commit);
  await mkdir(path.dirname(paths.snapshot), { recursive: true });
  await writeFile(paths.snapshot, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' }).catch((error) => {
    if (error.code === 'EEXIST') throw new Error(`development snapshot already exists for ${storyId}@${adopted.commit}`);
    throw error;
  });
  const projection = buildDevelopmentProjection(snapshot);
  await mkdir(path.dirname(paths.current), { recursive: true });
  await writeFile(paths.current, `${JSON.stringify(projection, null, 2)}\n`);
  const state = {
    schema_version: '0.1.0',
    updated_at: snapshot.recorded_at,
    projection,
    next_enforcement: snapshot.enforcement,
    completed_batches: history.length + 1,
    history: [...history, compactSnapshot(snapshot)].slice(-config.consumption.rolling_p95_window),
    latest_improved_outcome: controlState?.latest_improved_outcome ?? improvedOutcome ?? null
  };
  await writeDevelopmentControlState(root, state);
  return { snapshot, projection, state, snapshotPath: paths.snapshot, projectionPath: paths.current };
}

export async function getDevelopmentControlStatus(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = options.storyId ? validateStoryId(options.storyId) : null;
  const config = normalizeDevelopmentControl(await readRepositoryControlConfig(root));
  const controlState = await readDevelopmentControlState(root, { allowMalformed: config.enforcement === 'shadow' });
  const currentPath = path.join(root, '.vibepro', 'development-control', 'current.json');
  let projection = controlState?.projection ?? null;
  try {
    if (!projection) {
      projection = JSON.parse(await readFile(currentPath, 'utf8'));
      validateDevelopmentControlProjection(projection);
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && config.enforcement !== 'shadow') throw error;
    projection = null;
  }
  const enforcement = config.enforcement === 'shadow'
    ? 'shadow'
    : controlState?.next_enforcement ?? projection?.enforcement ?? effectiveEnforcement(config, 0);
  const intent = options.intent ?? (storyId ? await readDevelopmentIntent(root, storyId) : null);
  // An enforced repository without a portable or local projection has no
  // evidence that VALUE work is safe. Route it to validation instead of
  // silently failing open; explicit shadow remains the rollback switch.
  const mode = projection?.mode ?? (config.enforcement === 'enforced' ? 'VALIDATE' : 'VALUE');
  return {
    schema_version: '0.1.0',
    mode,
    enforcement,
    projection,
    intent,
    admission: evaluateDevelopmentAdmission({ mode, intent, enforcement })
  };
}

export async function assertDevelopmentAdmission(repoRoot, options = {}) {
  const status = await getDevelopmentControlStatus(repoRoot, options);
  if (!status.admission.allowed) {
    const error = new Error(`development control blocked ${options.commandName ?? 'command'}: ${status.admission.reason}`);
    error.code = 'DEVELOPMENT_CONTROL_ADMISSION_BLOCKED';
    error.development_control = status;
    throw error;
  }
  return status;
}

export async function recordDevelopmentOutcome(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = validateStoryId(requireValue(options.storyId, 'storyId'));
  const adoptedCommit = validateCommitSha(requireValue(options.adoptedCommit, 'adoptedCommit'));
  const result = requireValue(options.result, 'result');
  if (!['improved', 'unchanged', 'regressed'].includes(result)) throw new Error('outcome result must be improved, unchanged, or regressed');
  const snapshotPath = developmentControlPaths(root, storyId, adoptedCommit).snapshot;
  const controlState = await readDevelopmentControlState(root);
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    snapshot = controlState?.history?.find((item) => item.story_id === storyId && item.adopted_commit === adoptedCommit);
    if (!snapshot) throw new Error(`development snapshot not found for ${storyId}@${adoptedCommit}`);
  }
  const receipt = {
    schema_version: '0.1.0',
    receipt_id: `${storyId}:${snapshot.adopted_commit}:${Date.now()}`,
    story_id: storyId,
    adopted_commit: snapshot.adopted_commit,
    result,
    summary: options.summary ?? null,
    recorded_at: new Date().toISOString(),
    baseline_eligible: result === 'improved'
  };
  const outcomeDir = path.join(root, '.vibepro', 'development-control', 'outcomes');
  await mkdir(outcomeDir, { recursive: true });
  const outcomePath = path.join(outcomeDir, `${safeName(receipt.receipt_id)}.json`);
  await writeFile(outcomePath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  const config = normalizeDevelopmentControl(await readRepositoryControlConfig(root));
  const completedBatches = controlState?.completed_batches ?? 0;
  const state = {
    ...(controlState ?? { schema_version: '0.1.0', projection: null, history: [], completed_batches: completedBatches }),
    updated_at: receipt.recorded_at,
    next_enforcement: effectiveEnforcement(config, completedBatches),
    latest_improved_outcome: receipt.baseline_eligible ? receipt : controlState?.latest_improved_outcome ?? null
  };
  await writeDevelopmentControlState(root, state);
  return { receipt, state, outcomePath };
}

export function buildDevelopmentProjection(snapshot) {
  return {
    schema_version: snapshot.schema_version,
    story_id: snapshot.story_id,
    adopted_commit: snapshot.adopted_commit,
    baseline_commit: snapshot.baseline_commit,
    baseline_source: snapshot.baseline_source,
    recorded_at: snapshot.recorded_at,
    mode: snapshot.decision.mode,
    reasons: snapshot.decision.reasons,
    enforcement: snapshot.enforcement,
    snapshot_ref: `.vibepro/development-control/snapshots/${snapshot.story_id}/${snapshot.adopted_commit}.json`
  };
}

export function renderDevelopmentControlSummary(status) {
  const reasons = status.projection?.reasons ?? [];
  return `# Development Control\n\n| Item | Value |\n|------|-------|\n| Mode | ${status.mode} |\n| Enforcement | ${status.enforcement} |\n| Intent | ${status.intent ?? '-'} |\n| Admission | ${status.admission?.status ?? '-'} |\n| Snapshot | ${status.projection?.snapshot_ref ?? '-'} |\n\n${reasons.length > 0 ? `Reasons:\n${reasons.map((item) => `- ${item.metric}: ${item.status}`).join('\n')}\n` : 'Reasons: none\n'}`;
}

function compareRatio(metric, baseline, observed, warningRatio, simplifyRatio, findings) {
  if (!Number.isFinite(baseline) || !Number.isFinite(observed)) {
    findings.push({ metric, status: 'unknown', baseline: null, observed: null });
    return;
  }
  const ratio = baseline === 0 ? (observed === 0 ? 0 : Infinity) : (observed - baseline) / baseline;
  findings.push({
    metric,
    status: ratio >= simplifyRatio ? 'simplify' : ratio >= warningRatio ? 'warning' : 'within_budget',
    baseline,
    observed,
    increase_ratio: ratio
  });
}

function compareDelta(metric, baseline, observed, rejectIncrease, findings) {
  if (!Number.isFinite(baseline) || !Number.isFinite(observed)) {
    findings.push({ metric, status: 'unknown', baseline: null, observed: null });
    return;
  }
  findings.push({ metric, status: rejectIncrease && observed > baseline ? 'simplify' : 'within_budget', baseline, observed, delta: observed - baseline });
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, quantile) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

function sourceRoots(files) {
  const roots = [...new Set(files.map((file) => file.split('/')[0]))];
  return roots.length > 0 ? roots : ['src', 'test', 'bin'];
}

function normalizeVerification(value) {
  const kind = value.kind ?? value.verification_kind ?? null;
  const duration = value.run?.duration_ms ?? value.duration_ms;
  if (!kind || !Number.isFinite(duration)) return null;
  return {
    identity: value.run_artifact
      ?? value.observed?.run_artifact
      ?? value.id
      ?? `${kind}:${value.head_sha ?? value.run?.head_sha_before ?? ''}:${duration}`,
    kind,
    duration_ms: duration
  };
}

function stableObjectKey(value) {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

function unknownConsumptionMetrics() {
  return {
    fresh_input_tokens: null,
    agent_executions: null,
    repair_batches: null,
    expensive_verifications: null,
    verification_duration_ms: null
  };
}

function buildDependencyGraph(lines, sourceSet) {
  const graph = new Map([...sourceSet].map((file) => [file, new Set()]));
  for (const line of lines) {
    const match = line.match(/^[^:]+:(.*?):\d+:(.*)$/);
    if (!match) continue;
    const [, source, code] = match;
    const specifier = code.match(/(?:from\s*|require\(\s*)['"](\.[^'"]+)['"]/)?.[1];
    if (!specifier) continue;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(source), specifier));
    const target = [base, ...['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'].map((ext) => `${base}${ext}`), ...['js', 'ts'].map((ext) => `${base}/index.${ext}`)]
      .find((candidate) => sourceSet.has(candidate));
    if (target) graph.get(source)?.add(target);
  }
  return graph;
}

function countDependencyCycles(graph) {
  let index = 0;
  let cycles = 0;
  const stack = [];
  const indexes = new Map();
  const lowlinks = new Map();
  const onStack = new Set();
  const visit = (node) => {
    indexes.set(node, index);
    lowlinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    for (const target of graph.get(node) ?? []) {
      if (!indexes.has(target)) {
        visit(target);
        lowlinks.set(node, Math.min(lowlinks.get(node), lowlinks.get(target)));
      } else if (onStack.has(target)) {
        lowlinks.set(node, Math.min(lowlinks.get(node), indexes.get(target)));
      }
    }
    if (lowlinks.get(node) !== indexes.get(node)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    if (component.length > 1 || (graph.get(node) ?? new Set()).has(node)) cycles += 1;
  };
  for (const node of graph.keys()) if (!indexes.has(node)) visit(node);
  return cycles;
}

async function readRepositoryControlConfig(root) {
  try {
    const config = JSON.parse(await readFile(path.join(root, '.vibepro', 'config.json'), 'utf8'));
    return config.development_control ?? {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function readDevelopmentIntent(root, storyId) {
  const story = await findStorySource(root, { story_id: storyId });
  return story.content.match(/^development_intent:\s*([^\s#]+)/m)?.[1]?.toLowerCase() ?? null;
}

async function readDevelopmentControlState(root, options = {}) {
  try {
    const state = JSON.parse(await readFile(developmentControlStatePath(root), 'utf8'));
    validateDevelopmentControlState(state);
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (options.allowMalformed) return null;
    throw error;
  }
}

async function writeDevelopmentControlState(root, state) {
  const statePath = developmentControlStatePath(root);
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function compactSnapshot(snapshot) {
  return {
    story_id: snapshot.story_id,
    adopted_commit: snapshot.adopted_commit,
    baseline_commit: snapshot.baseline_commit,
    recorded_at: snapshot.recorded_at,
    enforcement: snapshot.enforcement,
    decision: snapshot.decision,
    consumption: snapshot.consumption
  };
}

function effectiveEnforcement(config, completedBatches) {
  const shadowBatches = Number.isInteger(config.shadow_batches) && config.shadow_batches >= 0
    ? config.shadow_batches
    : DEFAULT_DEVELOPMENT_CONTROL.shadow_batches;
  return completedBatches < shadowBatches ? 'shadow' : config.enforcement;
}

function validateDevelopmentControlPolicy(config) {
  for (const key of ['loc_warning_ratio', 'loc_simplify_ratio', 'import_edge_warning_ratio', 'import_edge_simplify_ratio', 'file_warning_ratio', 'file_simplify_ratio']) {
    if (!Number.isFinite(config.structural[key]) || config.structural[key] < 0) {
      throw new Error(`development_control.structural.${key} must be a finite non-negative number`);
    }
  }
  for (const key of ['reject_new_dependency_cycle', 'reject_workflow_control_surface_increase']) {
    if (typeof config.structural[key] !== 'boolean') throw new Error(`development_control.structural.${key} must be boolean`);
  }
  if (!Number.isInteger(config.shadow_batches) || config.shadow_batches < 0) {
    throw new Error('development_control.shadow_batches must be a non-negative integer');
  }
  for (const key of ['rolling_median_window', 'rolling_p95_window']) {
    if (!Number.isInteger(config.consumption[key]) || config.consumption[key] <= 0) {
      throw new Error(`development_control.consumption.${key} must be a positive integer`);
    }
  }
  for (const [key, value] of Object.entries(config.consumption.bootstrap)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`development_control.consumption.bootstrap.${key} must be a finite non-negative number`);
  }
}

function validateDevelopmentControlState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('development control state must be an object');
  if (!['shadow', 'enforced'].includes(state.next_enforcement)) throw new Error('development control state next_enforcement must be shadow or enforced');
  if (!Number.isInteger(state.completed_batches) || state.completed_batches < 0) throw new Error('development control state completed_batches must be a non-negative integer');
  if (!Array.isArray(state.history)) throw new Error('development control state history must be an array');
  if (state.projection !== null && state.projection !== undefined) {
    validateDevelopmentControlProjection(state.projection, 'development control state projection');
  }
}

function validateDevelopmentControlProjection(projection, label = 'development control projection') {
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) throw new Error(`${label} must be an object`);
  if (!DEVELOPMENT_MODES.includes(projection.mode)) throw new Error(`${label}.mode must be VALUE, VALIDATE, or SIMPLIFY`);
  if (projection.enforcement !== undefined && !['shadow', 'enforced'].includes(projection.enforcement)) {
    throw new Error(`${label}.enforcement must be shadow or enforced`);
  }
}

function belongsToStory(file, storyId) {
  const relative = path.relative(path.parse(file).root, file);
  return relative.split(path.sep).some((segment) => segment === storyId || path.parse(segment).name === storyId);
}

async function listJsonFiles(root) {
  const result = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return result;
    throw error;
  }
  for (const entry of entries) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await listJsonFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.json')) result.push(file);
  }
  return result;
}

function walk(value, visit) {
  visit(value);
  if (Array.isArray(value)) for (const item of value) walk(item, visit);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) walk(item, visit);
}

async function git(root, args, options = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    if (options.allowNoMatch && error.code === 1) return error.stdout ?? '';
    throw error;
  }
}

function developmentControlPaths(root, storyId, commit) {
  return {
    snapshot: path.join(root, '.vibepro', 'development-control', 'snapshots', storyId, `${commit}.json`),
    current: path.join(root, '.vibepro', 'development-control', 'current.json')
  };
}

function developmentControlStatePath(root) {
  return path.join(root, 'docs', 'management', 'development-control-state.json');
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function requireValue(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function validateStoryId(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
    throw new Error('storyId must contain only letters, numbers, dot, underscore, or hyphen');
  }
  return value;
}

function validateCommitSha(value) {
  if (!/^[a-f0-9]{40,64}$/i.test(value)) throw new Error('adoptedCommit must be a full commit SHA');
  return value;
}
