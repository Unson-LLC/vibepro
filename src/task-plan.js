import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { assertArtifactWritePath } from './artifact-routing.js';

const execFileAsync = promisify(execFile);

export const TASK_PLAN_SCHEMA_VERSION = '0.2.0';

const PLAN_FIELDS = new Set([
  'schema_version',
  'repository',
  'story_id',
  'plan_version',
  'intent',
  'tasks'
]);
const INTENT_FIELDS = new Set(['purpose', 'priority', 'delegated_scope', 'acceptance_criteria']);
const TASK_FIELDS = new Set([
  'task_id',
  'story_id',
  'title',
  'allowed_paths',
  'acceptance_criteria',
  'depends_on',
  'status',
  'purpose',
  'out_of_scope',
  'dependencies',
  'contracts',
  'assignment',
  'integration'
]);
const DEPENDENCY_FIELDS = new Set(['kind', 'target', 'milestone', 'blocks', 'contract_ref']);
const TARGET_FIELDS = new Set(['repository', 'story_id', 'task_id', 'plan_version']);
const CONTRACT_FIELDS = new Set(['id', 'version', 'description']);
const ASSIGNMENT_FIELDS = new Set(['capabilities', 'parallel_group', 'adjustable_scope']);
const INTEGRATION_FIELDS = new Set(['order', 'conflict_owner']);
const DEPENDENCY_KINDS = new Set(['prerequisite', 'interface', 'overlap']);
const MILESTONES = new Set(['returned', 'verified', 'integrated']);
const BLOCK_STAGES = new Set(['start', 'verify', 'integrate']);
const OBSERVATION_FIELDS = new Set([
  'kind',
  'target',
  'repository',
  'story_id',
  'task_id',
  'plan_version',
  'milestone',
  'contract_ref',
  'artifact_revision',
  'evidence_ref'
]);
const OBSERVATION_KINDS = new Set(['milestone', 'contract_agreement']);

/**
 * Validate and normalize a 0.2.0 parallel Task plan without performing I/O.
 * The returned object is suitable for the accepted Task authority payload.
 */
export function validateTaskPlan(document, { storyId = null, repository = null } = {}) {
  if (!document || Array.isArray(document) || typeof document !== 'object') {
    throw new Error('task plan input must be an object');
  }
  const unknownFields = Object.keys(document).filter((key) => !PLAN_FIELDS.has(key));
  if (unknownFields.length > 0) throw new Error(`unknown task plan field: ${unknownFields.join(', ')}`);
  if (document.schema_version !== TASK_PLAN_SCHEMA_VERSION) {
    throw new Error(`task plan schema_version must be ${TASK_PLAN_SCHEMA_VERSION}`);
  }

  const normalizedRepository = requiredString(document.repository, 'task plan repository');
  if (repository != null && normalizedRepository !== requiredString(repository, 'repository')) {
    throw new Error(`task plan repository must exactly match ${repository}`);
  }
  const normalizedStoryId = requiredString(document.story_id, 'task plan story_id');
  if (storyId != null && normalizedStoryId !== requiredString(storyId, 'story_id')) {
    throw new Error(`task plan story_id must exactly match ${storyId}`);
  }

  const plan = {
    schema_version: TASK_PLAN_SCHEMA_VERSION,
    repository: normalizedRepository,
    story_id: normalizedStoryId,
    plan_version: requiredString(document.plan_version, 'task plan plan_version'),
    intent: normalizeIntent(document.intent),
    tasks: normalizeTasks(document.tasks, normalizedStoryId, normalizedRepository, document.plan_version)
  };
  if (plan.tasks.length === 0) throw new Error('task plan requires a nonempty tasks array');
  return plan;
}

/**
 * Classify dependency issues while preserving unaffected startable Tasks.
 * This is deliberately a read-only analysis; it never changes plan state.
 */
export function analyzeTaskPlan(plan, { observations = [] } = {}) {
  const validated = validateTaskPlan(plan);
  const observed = normalizeObservations(observations);
  const taskByKey = new Map(validated.tasks.map((task) => [taskKey(validated.repository, validated.story_id, task.task_id), task]));
  const diagnostics = [];
  const blockingTaskIds = new Set();
  const startEdges = new Map(validated.tasks.map((task) => [task.task_id, new Set()]));
  const blockedStages = new Map(validated.tasks.map((task) => [task.task_id, new Set()]));
  const blockStage = (taskId, stage) => {
    blockedStages.get(taskId)?.add(stage);
    if (stage === 'start') blockingTaskIds.add(taskId);
  };
  const blockDependencyStages = (taskId, dependency) => {
    for (const stage of dependency.blocks) {
      // The plan deliberately treats interface and overlap dependencies as
      // integration conditions. Their `start` entry is retained for
      // compatibility and reported below, but it never blocks dispatch.
      if (stage === 'start' && dependency.kind !== 'prerequisite') continue;
      blockStage(taskId, stage);
    }
  };

  for (const task of validated.tasks) {
    const explicitDependencies = task.dependencies.map((dependency) => ({ dependency, legacy: false }));
    for (const legacyTaskId of task.depends_on) {
      const hasEquivalentPrerequisite = explicitDependencies.some(({ dependency }) => (
        dependency.kind === 'prerequisite'
        && dependency.target.repository === validated.repository
        && dependency.target.story_id === validated.story_id
        && dependency.target.task_id === legacyTaskId
        && dependency.milestone === 'returned'
        && dependency.blocks.length === 1
        && dependency.blocks[0] === 'start'
      ));
      if (!hasEquivalentPrerequisite) {
        explicitDependencies.push({
          legacy: true,
          dependency: {
            kind: 'prerequisite',
            target: { repository: validated.repository, story_id: validated.story_id, task_id: legacyTaskId },
            milestone: 'returned',
            blocks: ['start']
          }
        });
      }
    }

    for (const { dependency, legacy } of explicitDependencies) {
      const target = dependency.target;
      const local = target.repository === validated.repository && target.story_id === validated.story_id;
      const targetTask = local ? taskByKey.get(taskKey(target.repository, target.story_id, target.task_id)) : null;
      const expectedPlanVersion = target.plan_version ?? (local ? validated.plan_version : null);
      const startBlock = dependency.kind === 'prerequisite' && dependency.blocks.includes('start');
      const contractRef = dependency.kind === 'interface' && dependency.contract_ref
        ? parseContractRef(dependency.contract_ref)
        : null;
      const consumerContract = contractRef
        ? task.contracts.find((contract) => contract.id === contractRef.id)
        : null;
      const consumerContractMatches = Boolean(contractRef
        && consumerContract
        && consumerContract.version === contractRef.version);
      const targetContract = contractRef && targetTask
        ? targetTask.contracts.find((contract) => contract.id === contractRef.id)
        : null;
      const targetContractMatches = Boolean(contractRef
        && targetContract
        && targetContract.version === contractRef.version);
      const externalContractAgreed = dependency.kind === 'interface'
        && !local
        && consumerContractMatches
        && Boolean(dependency.contract_ref)
        && observed.some((observation) => contractAgreementMatches(
          observation,
          dependency,
          target,
          expectedPlanVersion
        ));

      if (dependency.kind === 'interface') {
        const contractResolved = contractRef
          && consumerContractMatches
          && (targetTask ? targetContractMatches : externalContractAgreed);
        if (!contractResolved) {
          const external = !local && Boolean(dependency.contract_ref);
          const versionDetail = contractRef
            ? ` (expected ${contractRef.id}@${contractRef.version}; consumer declares ${consumerContract?.id ? `${consumerContract.id}@${consumerContract.version}` : 'none'}${targetContract?.id ? `; target declares ${targetContract.id}@${targetContract.version}` : ''}${expectedPlanVersion ? `; expected plan ${expectedPlanVersion}` : ''})`
            : '';
          diagnostics.push({
            code: !dependency.contract_ref
              ? 'missing_interface_contract'
              : !contractRef
                ? 'invalid_interface_contract_ref'
                : (external ? 'unresolved_external_interface_contract' : 'unresolved_interface_contract'),
            severity: 'error',
            task_ids: [task.task_id],
            dependency: dependencyRef(dependency),
            message: dependency.contract_ref
              ? (external
                ? `external interface contract ${dependency.contract_ref} has no matching consumer declaration and plan-version-bound agreement observation${versionDetail}`
                : `interface contract ${dependency.contract_ref} does not match both consumer and target declarations${versionDetail}`)
              : `interface dependency ${target.task_id} must declare contract_ref before parallel start`
          });
          blockStage(task.task_id, 'start');
          blockStage(task.task_id, 'verify');
          blockStage(task.task_id, 'integrate');
        }
      }

      if (dependency.blocks.includes('start') && dependency.kind !== 'prerequisite') {
        diagnostics.push({
          code: 'start_block_ignored',
          severity: 'warning',
          task_ids: [task.task_id],
          dependency: dependencyRef(dependency),
          message: `${dependency.kind} dependency ${target.task_id} is an integration condition and does not block start`
        });
      }

      if (!targetTask) {
        // An external interface target is resolved by the contract agreement
        // observation above. Its implementation milestone is intentionally
        // still allowed to be pending because interface dependencies do not
        // block start; they block the stages listed by the plan.
        const matchingObservations = observed.filter((observation) => observationMatches(
          observation,
          target,
          validated.plan_version,
          local
        ));
        const observedMilestone = matchingObservations.some((observation) => milestoneReached(observation.milestone, dependency.milestone));
        if (!(dependency.kind === 'interface' && externalContractAgreed) && !observedMilestone) {
          const code = startBlock ? 'unresolved_prerequisite' : 'unresolved_reference';
          const severity = startBlock ? 'error' : 'warning';
          diagnostics.push({
            code,
            severity,
            task_ids: [task.task_id],
            dependency: dependencyRef(dependency),
            message: `${legacy ? 'legacy depends_on' : `${dependency.kind} dependency`} target ${target.repository}/${target.story_id}/${target.task_id} is not present in this plan`
          });
          // A plan-version-bound external milestone is sufficient evidence for
          // an external prerequisite even when its source Task is not copied
          // into this plan. Without that evidence, the task remains blocked.
          if (startBlock && !observedMilestone) blockDependencyStages(task.task_id, dependency);
        }
        if (!observedMilestone && (dependency.kind !== 'interface' || externalContractAgreed)) {
          const code = startBlock ? 'missing_prerequisite_observation' : 'missing_integration_observation';
          const severity = startBlock ? 'error' : 'warning';
          diagnostics.push({
            code,
            severity,
            task_ids: [task.task_id],
            dependency: dependencyRef(dependency),
            message: `${dependency.kind} dependency ${target.repository}/${target.story_id}/${target.task_id} has no observed ${dependency.milestone} result`
          });
          blockDependencyStages(task.task_id, dependency);
        }
        // There is no local edge to add when the target is external. A
        // contract agreement resolves the interface shape only; its returned,
        // verified, or integrated milestone remains a separate observation.
        if (!targetTask) continue;
      }

      if (startBlock) startEdges.get(task.task_id).add(targetTask.task_id);
      const matchingObservations = observed.filter((observation) => observationMatches(
        observation,
        target,
        validated.plan_version,
        local
      ));
      const observedMilestone = matchingObservations.some((observation) => milestoneReached(observation.milestone, dependency.milestone));
      if (!observedMilestone) {
        const code = startBlock ? 'missing_prerequisite_observation' : 'missing_integration_observation';
        const severity = startBlock ? 'error' : 'warning';
        diagnostics.push({
          code,
          severity,
          task_ids: [task.task_id],
          dependency: dependencyRef(dependency),
          message: `${dependency.kind} dependency ${target.repository}/${target.story_id}/${target.task_id} has no observed ${dependency.milestone} result for plan ${validated.plan_version}`
        });
        blockDependencyStages(task.task_id, dependency);
      }
    }
  }

  const cycles = findCycles(startEdges);
  for (const cycle of cycles) {
    for (const taskId of cycle) blockingTaskIds.add(taskId);
    diagnostics.push({
      code: 'dependency_cycle',
      severity: 'error',
      task_ids: cycle,
      message: `prerequisite dependency cycle: ${cycle.join(' -> ')}`
    });
  }

  diagnostics.sort(compareDiagnostics);
  const terminal = new Set(['returned', 'verified', 'integrated', 'completed', 'complete', 'done']);
  const readyTaskIds = validated.tasks
    .filter((task) => !terminal.has(String(task.status ?? '').toLowerCase()))
    .filter((task) => !blockingTaskIds.has(task.task_id))
    .map((task) => task.task_id)
    .sort();
  const readyStages = Object.fromEntries([...BLOCK_STAGES].map((stage) => [
    stage,
    validated.tasks
      .filter((task) => !terminal.has(String(task.status ?? '').toLowerCase()))
      .filter((task) => !blockingTaskIds.has(task.task_id))
      .filter((task) => !blockedStages.get(task.task_id)?.has(stage))
      .map((task) => task.task_id)
      .sort()
  ]));
  const blockedStageOutput = Object.fromEntries([...blockedStages.entries()]
    .filter(([, stages]) => stages.size > 0)
    .map(([taskId, stages]) => [taskId, [...stages].sort()]));
  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  return {
    status: hasErrors ? 'partial' : 'ready',
    dispatch_ready: !hasErrors,
    diagnostics,
    ready_task_ids: readyTaskIds,
    ready_stages: readyStages,
    blocked_task_ids: [...blockingTaskIds].sort(),
    blocked_stages: blockedStageOutput,
    cycles,
    observation_count: observed.length,
    observation_mode: 'external-evidence-only'
  };
}

/** Read a tracked plan input for the validation CLI. This helper has no write side effects. */
export async function readTrackedTaskPlan(repoRoot, inputPath) {
  const root = path.resolve(repoRoot);
  const absolutePath = path.resolve(root, inputPath ?? '');
  const relativePath = path.relative(root, absolutePath).replaceAll(path.sep, '/');
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('task plan input must be inside the repository');
  }
  if (!relativePath.toLowerCase().endsWith('.json')) throw new Error('task plan input must be a tracked JSON file');
  const safeAbsolutePath = await assertArtifactWritePath(root, relativePath);
  try {
    await execFileAsync('git', ['ls-files', '--error-unmatch', '--', relativePath], { cwd: root });
  } catch {
    throw new Error(`task plan input must be tracked by git: ${relativePath}`);
  }
  let content;
  try {
    content = await readFile(safeAbsolutePath, 'utf8');
  } catch (error) {
    throw new Error(`task plan input cannot be read: ${error.message}`);
  }
  let document;
  try {
    document = JSON.parse(content);
  } catch (error) {
    throw new Error(`task plan input must be valid JSON: ${error.message}`);
  }
  return { document, path: relativePath };
}

/** Read a tracked observation bundle for dependency analysis without writing state. */
export async function readTrackedTaskObservations(repoRoot, inputPath) {
  const input = await readTrackedTaskPlan(repoRoot, inputPath);
  const observations = Array.isArray(input.document)
    ? input.document
    : input.document?.observations;
  if (!Array.isArray(observations)) {
    throw new Error('task plan observations input must be an array or an object with an observations array');
  }
  return { observations, path: input.path };
}

function normalizeIntent(intent) {
  if (!intent || Array.isArray(intent) || typeof intent !== 'object') throw new Error('task plan intent must be an object');
  const unknown = Object.keys(intent).filter((key) => !INTENT_FIELDS.has(key));
  if (unknown.length > 0) throw new Error(`unknown task plan intent field: ${unknown.join(', ')}`);
  return {
    purpose: requiredString(intent.purpose, 'task plan intent purpose'),
    priority: normalizePriority(intent.priority),
    delegated_scope: normalizeStringList(intent.delegated_scope, 'task plan intent delegated_scope'),
    acceptance_criteria: normalizeStringList(intent.acceptance_criteria, 'task plan intent acceptance_criteria')
  };
}

function normalizeTasks(tasks, storyId, repository, planVersion) {
  if (!Array.isArray(tasks)) throw new Error('task plan tasks must be an array');
  const ids = new Set();
  const normalized = tasks.map((task, index) => {
    if (!task || Array.isArray(task) || typeof task !== 'object') throw new Error(`task at index ${index} must be an object`);
    const unknown = Object.keys(task).filter((key) => !TASK_FIELDS.has(key));
    if (unknown.length > 0) throw new Error(`unknown task field: ${unknown.join(', ')}`);
    const taskId = requiredString(task.task_id, `task at index ${index} task_id`);
    if (ids.has(taskId)) throw new Error(`duplicate task_id: ${taskId}`);
    ids.add(taskId);
    if (task.story_id !== storyId) throw new Error(`task ${taskId} story_id must exactly match ${storyId}`);
    if (!Array.isArray(task.allowed_paths) || task.allowed_paths.length === 0) throw new Error(`task ${taskId} allowed_paths must be nonempty`);
    const allowedPaths = [...new Set(task.allowed_paths.map((value) => validateAllowedPath(value, taskId)))].sort();
    const dependsOn = task.depends_on == null ? [] : normalizeStringList(task.depends_on, `${taskId} depends_on`);
    const acceptanceCriteria = task.acceptance_criteria == null ? [] : normalizeStringList(task.acceptance_criteria, `${taskId} acceptance_criteria`);
    return {
      task_id: taskId,
      story_id: storyId,
      ...(task.title == null ? {} : { title: String(task.title).trim() }),
      allowed_paths: allowedPaths,
      acceptance_criteria: acceptanceCriteria,
      depends_on: dependsOn,
      ...(task.status == null ? {} : { status: requiredString(task.status, `${taskId} status`) }),
      purpose: requiredString(task.purpose, `${taskId} purpose`),
      out_of_scope: normalizeStringList(task.out_of_scope, `${taskId} out_of_scope`),
      dependencies: normalizeDependencies(task.dependencies, taskId, repository, storyId, planVersion),
      contracts: normalizeContracts(task.contracts, taskId),
      assignment: normalizeAssignment(task.assignment, taskId),
      integration: normalizeIntegration(task.integration, taskId)
    };
  });
  return normalized.sort((a, b) => a.task_id.localeCompare(b.task_id));
}

function normalizeDependencies(value, taskId, repository, storyId, planVersion) {
  if (!Array.isArray(value)) throw new Error(`${taskId} dependencies must be an array`);
  const seen = new Set();
  return value.map((dependency, index) => {
    if (!dependency || Array.isArray(dependency) || typeof dependency !== 'object') throw new Error(`${taskId} dependency at index ${index} must be an object`);
    const unknown = Object.keys(dependency).filter((key) => !DEPENDENCY_FIELDS.has(key));
    if (unknown.length > 0) throw new Error(`unknown ${taskId} dependency field: ${unknown.join(', ')}`);
    if (!DEPENDENCY_KINDS.has(dependency.kind)) throw new Error(`${taskId} dependency kind must be prerequisite, interface, or overlap`);
    const target = normalizeTarget(dependency.target, `${taskId} dependency ${index}`);
    const milestone = requiredString(dependency.milestone, `${taskId} dependency ${index} milestone`);
    if (!MILESTONES.has(milestone)) throw new Error(`${taskId} dependency milestone must be returned, verified, or integrated`);
    const blocks = normalizeStringList(dependency.blocks, `${taskId} dependency ${index} blocks`);
    if (blocks.length === 0) throw new Error(`${taskId} dependency ${index} blocks must be nonempty`);
    if (blocks.some((block) => !BLOCK_STAGES.has(block))) throw new Error(`${taskId} dependency blocks must contain start, verify, or integrate`);
    if ((target.repository !== repository || target.story_id !== storyId) && target.plan_version == null) {
      throw new Error(`${taskId} dependency ${index} external target plan_version must be declared`);
    }
    if (target.repository === repository && target.story_id === storyId && target.plan_version != null && target.plan_version !== planVersion) {
      throw new Error(`${taskId} dependency ${index} target plan_version must match ${planVersion}`);
    }
    const identity = `${dependency.kind}|${target.repository}|${target.story_id}|${target.task_id}|${milestone}|${blocks.join(',')}|${dependency.contract_ref ?? ''}`;
    if (seen.has(identity)) throw new Error(`duplicate ${taskId} dependency: ${identity}`);
    seen.add(identity);
    return {
      kind: dependency.kind,
      target,
      milestone,
      blocks,
      ...(dependency.contract_ref == null ? {} : { contract_ref: requiredString(dependency.contract_ref, `${taskId} dependency ${index} contract_ref`) })
    };
  });
}

function normalizeTarget(target, label) {
  if (!target || Array.isArray(target) || typeof target !== 'object') throw new Error(`${label} target must be an object`);
  const unknown = Object.keys(target).filter((key) => !TARGET_FIELDS.has(key));
  if (unknown.length > 0) throw new Error(`unknown ${label} target field: ${unknown.join(', ')}`);
  const planVersion = target.plan_version == null ? null : requiredString(target.plan_version, `${label} target plan_version`);
  return {
    repository: requiredString(target.repository, `${label} target repository`),
    story_id: requiredString(target.story_id, `${label} target story_id`),
    task_id: requiredString(target.task_id, `${label} target task_id`),
    ...(planVersion == null ? {} : { plan_version: planVersion })
  };
}

function normalizeContracts(value, taskId) {
  if (!Array.isArray(value)) throw new Error(`${taskId} contracts must be an array`);
  const ids = new Set();
  return value.map((contract, index) => {
    if (!contract || Array.isArray(contract) || typeof contract !== 'object') throw new Error(`${taskId} contract at index ${index} must be an object`);
    const unknown = Object.keys(contract).filter((key) => !CONTRACT_FIELDS.has(key));
    if (unknown.length > 0) throw new Error(`unknown ${taskId} contract field: ${unknown.join(', ')}`);
    const id = requiredString(contract.id, `${taskId} contract ${index} id`);
    if (ids.has(id)) throw new Error(`duplicate ${taskId} contract id: ${id}`);
    ids.add(id);
    return {
      id,
      version: requiredString(contract.version, `${taskId} contract ${id} version`),
      description: requiredString(contract.description, `${taskId} contract ${id} description`)
    };
  });
}

function normalizeAssignment(value, taskId) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`${taskId} assignment must be an object`);
  const unknown = Object.keys(value).filter((key) => !ASSIGNMENT_FIELDS.has(key));
  if (unknown.length > 0) throw new Error(`unknown ${taskId} assignment field: ${unknown.join(', ')}`);
  return {
    capabilities: normalizeStringList(value.capabilities, `${taskId} assignment capabilities`),
    parallel_group: value.parallel_group == null ? null : requiredString(value.parallel_group, `${taskId} assignment parallel_group`),
    adjustable_scope: normalizeStringList(value.adjustable_scope, `${taskId} assignment adjustable_scope`)
  };
}

function normalizeIntegration(value, taskId) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`${taskId} integration must be an object`);
  const unknown = Object.keys(value).filter((key) => !INTEGRATION_FIELDS.has(key));
  if (unknown.length > 0) throw new Error(`unknown ${taskId} integration field: ${unknown.join(', ')}`);
  const order = Number(value.order);
  if (!Number.isInteger(order) || order < 1) throw new Error(`${taskId} integration order must be a positive integer`);
  return { order, conflict_owner: requiredString(value.conflict_owner, `${taskId} integration conflict_owner`) };
}

function normalizePriority(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return requiredString(value, 'task plan intent priority');
}

function normalizeStringList(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label} must be an array of nonempty strings`);
  }
  return value.map((item) => item.trim());
}

function normalizeObservations(observations) {
  if (!Array.isArray(observations)) throw new Error('task plan observations must be an array');
  return observations.map((observation, index) => {
    if (!observation || Array.isArray(observation) || typeof observation !== 'object') {
      throw new Error(`task plan observation at index ${index} must be an object`);
    }
    const unknown = Object.keys(observation).filter((key) => !OBSERVATION_FIELDS.has(key));
    if (unknown.length > 0) throw new Error(`unknown task plan observation field: ${unknown.join(', ')}`);
    const target = observation.target
      ? normalizeTarget(observation.target, `task plan observation ${index}`)
      : normalizeTarget({
          repository: observation.repository,
          story_id: observation.story_id,
          task_id: observation.task_id
        }, `task plan observation ${index}`);
    const kind = observation.kind == null ? 'milestone' : requiredString(observation.kind, `task plan observation ${index} kind`);
    if (!OBSERVATION_KINDS.has(kind)) throw new Error(`task plan observation kind must be milestone or contract_agreement`);
    const milestone = observation.milestone == null ? null : requiredString(observation.milestone, `task plan observation ${index} milestone`);
    if (kind === 'milestone' && (!milestone || !MILESTONES.has(milestone))) {
      throw new Error('task plan milestone observation must declare returned, verified, or integrated');
    }
    if (kind === 'contract_agreement' && observation.contract_ref == null) {
      throw new Error(`task plan contract agreement observation ${index} requires contract_ref`);
    }
    const contractRef = observation.contract_ref == null
      ? null
      : requiredString(observation.contract_ref, `task plan observation ${index} contract_ref`);
    if (kind === 'contract_agreement' && !parseContractRef(contractRef)) {
      throw new Error(`task plan contract agreement observation ${index} contract_ref must pin id@version`);
    }
    const artifactRevision = requiredString(observation.artifact_revision, `task plan observation ${index} artifact_revision`);
    const evidenceRef = requiredString(observation.evidence_ref, `task plan observation ${index} evidence_ref`);
    return {
      kind,
      target,
      plan_version: requiredString(observation.plan_version, `task plan observation ${index} plan_version`),
      ...(milestone == null ? {} : { milestone }),
      ...(contractRef == null ? {} : { contract_ref: contractRef }),
      artifact_revision: artifactRevision,
      evidence_ref: evidenceRef
    };
  });
}

function contractAgreementMatches(observation, dependency, target, expectedPlanVersion) {
  return observation.kind === 'contract_agreement'
    && observation.contract_ref === dependency.contract_ref
    && observation.target.repository === target.repository
    && observation.target.story_id === target.story_id
    && observation.target.task_id === target.task_id
    && observation.plan_version === expectedPlanVersion
    && Boolean(observation.artifact_revision)
    && Boolean(observation.evidence_ref);
}

function observationMatches(observation, target, planVersion, local) {
  if (observation.target.repository !== target.repository
    || observation.target.story_id !== target.story_id
    || observation.target.task_id !== target.task_id) return false;
  const expectedPlanVersion = target.plan_version ?? (local ? planVersion : null);
  return expectedPlanVersion != null && observation.plan_version === expectedPlanVersion;
}

/**
 * Interface references are pinned to the declared contract version. A bare
 * contract id is ambiguous when a provider has published more than one
 * version, so it cannot resolve an interface dependency.
 */
function parseContractRef(value) {
  if (typeof value !== 'string') return null;
  const separator = value.lastIndexOf('@');
  if (separator <= 0 || separator === value.length - 1) return null;
  const id = value.slice(0, separator).trim();
  const version = value.slice(separator + 1).trim();
  if (!id || !version) return null;
  return { id, version };
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a nonempty string`);
  return value.trim();
}

function validateAllowedPath(value, taskId) {
  const candidate = String(value ?? '').trim().replaceAll('\\', '/');
  const normalized = path.posix.normalize(candidate);
  if (!candidate || path.posix.isAbsolute(candidate) || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`task ${taskId} allowed_paths must stay inside the repository`);
  }
  return normalized;
}

function taskKey(repository, storyId, taskId) {
  return `${repository}\u0000${storyId}\u0000${taskId}`;
}

function dependencyRef(dependency) {
  return {
    kind: dependency.kind,
    target: dependency.target,
    milestone: dependency.milestone,
    blocks: dependency.blocks,
    ...(dependency.contract_ref == null ? {} : { contract_ref: dependency.contract_ref })
  };
}

function milestoneReached(status, milestone) {
  const value = String(status ?? '').toLowerCase();
  if (milestone === 'returned') return new Set(['returned', 'verified', 'integrated', 'completed', 'complete', 'done']).has(value);
  if (milestone === 'verified') return new Set(['verified', 'integrated', 'completed', 'complete', 'done']).has(value);
  return new Set(['integrated', 'completed', 'complete', 'done']).has(value);
}

function findCycles(edges) {
  const cycles = [];
  const seen = new Set();
  const stack = [];
  const active = new Set();
  const visited = new Set();

  function visit(taskId) {
    if (active.has(taskId)) {
      const start = stack.indexOf(taskId);
      const cycle = stack.slice(start);
      const canonical = [...new Set(cycle)].sort();
      const key = canonical.join('|');
      if (!seen.has(key)) {
        seen.add(key);
        cycles.push(canonical);
      }
      return;
    }
    if (visited.has(taskId)) return;
    active.add(taskId);
    stack.push(taskId);
    for (const target of [...(edges.get(taskId) ?? [])].sort()) visit(target);
    stack.pop();
    active.delete(taskId);
    visited.add(taskId);
  }

  for (const taskId of [...edges.keys()].sort()) visit(taskId);
  return cycles.sort((a, b) => a.join('|').localeCompare(b.join('|')));
}

function compareDiagnostics(left, right) {
  return `${left.code}|${left.task_ids.join(',')}|${left.message}`.localeCompare(`${right.code}|${right.task_ids.join(',')}|${right.message}`);
}
