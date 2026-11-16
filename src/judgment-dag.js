const SCHEMA_VERSION = '0.1.0';
const NODE_STATUSES = new Set(['proposed', 'accepted', 'rejected', 'superseded']);
const RUNNER_TYPES = new Set(['human', 'ai_agent', 'deterministic_rule', 'committee', 'external_system']);
const EDGE_RELATIONS = new Set([
  'depends_on',
  'supports',
  'contradicts',
  'supersedes',
  'implements',
  'produces',
  'evaluated_by'
]);
const EVALUATION_STATUSES = new Set(['confirmed', 'mixed', 'falsified', 'unknown']);

export function createJudgmentDag({ scope, storyId = null, eventId = null, createdAt = new Date().toISOString() } = {}) {
  if (!scope) throw new Error('judgment DAG requires scope');
  return {
    schema_version: SCHEMA_VERSION,
    kind: 'vibepro_development_judgment_dag',
    scope,
    story_id: storyId,
    event_id: eventId,
    created_at: createdAt,
    nodes: [],
    edges: []
  };
}

export function addJudgmentNode(dag, input) {
  validateEnvelope(dag);
  const id = requireText(input?.id, 'judgment node requires id');
  if (dag.nodes.some((node) => node.id === id)) throw new Error(`judgment node already exists: ${id}`);

  const status = input.status ?? 'proposed';
  if (!NODE_STATUSES.has(status)) throw new Error(`invalid judgment node status: ${status}`);
  const runnerType = input.runner_type ?? 'human';
  if (!RUNNER_TYPES.has(runnerType)) throw new Error(`invalid judgment runner_type: ${runnerType}`);

  const node = {
    id,
    story_id: input.story_id ?? dag.story_id ?? null,
    event_id: input.event_id ?? dag.event_id ?? null,
    question: requireText(input.question, `${id} requires question`),
    context_snapshot: normalizeContextSnapshot(input.context_snapshot),
    assumptions: uniqueStrings(input.assumptions),
    options: normalizeOptions(input.options),
    evidence_refs: uniqueStrings(input.evidence_refs),
    judgment: normalizeNullableText(input.judgment),
    decision: normalizeNullableText(input.decision),
    authority: normalizeAuthority(input.authority),
    runner_type: runnerType,
    confidence: normalizeConfidence(input.confidence),
    status,
    expected_outcomes: normalizeExpectedOutcomes(input.expected_outcomes),
    evaluations: [],
    recorded_at: input.recorded_at ?? new Date().toISOString()
  };

  return {
    ...structuredClone(dag),
    nodes: [...dag.nodes, node]
  };
}

export function addJudgmentEdge(dag, input) {
  validateEnvelope(dag);
  const from = requireText(input?.from, 'judgment edge requires from');
  const to = requireText(input?.to, 'judgment edge requires to');
  const relation = requireText(input?.relation, 'judgment edge requires relation');
  if (!EDGE_RELATIONS.has(relation)) throw new Error(`invalid judgment edge relation: ${relation}`);
  if (from === to) throw new Error('judgment edge cannot self-reference');
  if (!dag.nodes.some((node) => node.id === from)) throw new Error(`unknown judgment edge source: ${from}`);
  if (!dag.nodes.some((node) => node.id === to)) throw new Error(`unknown judgment edge target: ${to}`);

  const candidate = {
    ...structuredClone(dag),
    edges: [...dag.edges, {
      from,
      to,
      relation,
      reason: normalizeNullableText(input.reason),
      recorded_at: input.recorded_at ?? new Date().toISOString()
    }]
  };
  const validation = validateJudgmentDag(candidate);
  if (!validation.acyclic) throw new Error(`judgment edge creates a cycle: ${from} -> ${to}`);
  return candidate;
}

export function appendJudgmentEvaluation(dag, nodeId, input) {
  validateEnvelope(dag);
  const status = requireText(input?.status, 'judgment evaluation requires status');
  if (!EVALUATION_STATUSES.has(status)) throw new Error(`invalid judgment evaluation status: ${status}`);
  const index = dag.nodes.findIndex((node) => node.id === nodeId);
  if (index < 0) throw new Error(`unknown judgment node: ${nodeId}`);

  const next = structuredClone(dag);
  next.nodes[index].evaluations.push({
    evaluation_id: requireText(input.evaluation_id, 'judgment evaluation requires evaluation_id'),
    status,
    summary: requireText(input.summary, 'judgment evaluation requires summary'),
    evidence_refs: uniqueStrings(input.evidence_refs),
    observed_outcomes: normalizeObservedOutcomes(input.observed_outcomes),
    observed_at: input.observed_at ?? new Date().toISOString()
  });
  return next;
}

export function validateJudgmentDag(dag) {
  validateEnvelope(dag);
  const nodeIds = new Set(dag.nodes.map((node) => node.id));
  const errors = [];

  if (nodeIds.size !== dag.nodes.length) errors.push('duplicate_node_id');
  for (const edge of dag.edges) {
    if (!nodeIds.has(edge.from)) errors.push(`missing_source:${edge.from}`);
    if (!nodeIds.has(edge.to)) errors.push(`missing_target:${edge.to}`);
    if (!EDGE_RELATIONS.has(edge.relation)) errors.push(`invalid_relation:${edge.relation}`);
  }

  const acyclic = isAcyclic(dag.nodes, dag.edges);
  if (!acyclic) errors.push('cycle_detected');
  return {
    valid: errors.length === 0,
    acyclic,
    errors,
    node_count: dag.nodes.length,
    edge_count: dag.edges.length
  };
}

export function summarizeJudgmentDag(dag) {
  const validation = validateJudgmentDag(dag);
  const evaluations = dag.nodes.flatMap((node) => node.evaluations ?? []);
  return {
    scope: dag.scope,
    story_id: dag.story_id,
    event_id: dag.event_id,
    node_count: dag.nodes.length,
    edge_count: dag.edges.length,
    evaluation_count: evaluations.length,
    latest_evaluation_statuses: Object.fromEntries(
      dag.nodes
        .filter((node) => (node.evaluations ?? []).length > 0)
        .map((node) => [node.id, node.evaluations.at(-1).status])
    ),
    valid: validation.valid,
    acyclic: validation.acyclic,
    blocking: false
  };
}

function validateEnvelope(dag) {
  if (!dag || dag.kind !== 'vibepro_development_judgment_dag') {
    throw new Error('invalid development judgment DAG envelope');
  }
  if (!Array.isArray(dag.nodes) || !Array.isArray(dag.edges)) {
    throw new Error('development judgment DAG requires nodes and edges arrays');
  }
}

function isAcyclic(nodes, edges) {
  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
    adjacency.get(edge.from).push(edge.to);
    indegree.set(edge.to, indegree.get(edge.to) + 1);
  }
  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift();
    visited += 1;
    for (const target of adjacency.get(id) ?? []) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  return visited === nodes.length;
}

function normalizeContextSnapshot(value) {
  if (!value) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('context_snapshot must be an object');
  return structuredClone(value);
}

function normalizeOptions(value) {
  if (!value) return [];
  if (!Array.isArray(value)) throw new Error('options must be an array');
  return value.map((option, index) => ({
    id: requireText(option?.id, `option ${index + 1} requires id`),
    summary: requireText(option?.summary, `option ${index + 1} requires summary`),
    disposition: option?.disposition ?? 'considered',
    reason: normalizeNullableText(option?.reason)
  }));
}

function normalizeAuthority(value) {
  if (!value) return null;
  if (typeof value === 'string') return { kind: 'human', ref: value };
  return {
    kind: requireText(value.kind, 'authority requires kind'),
    ref: requireText(value.ref, 'authority requires ref')
  };
}

function normalizeConfidence(value) {
  if (value === undefined || value === null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) throw new Error('confidence must be between 0 and 1');
  return numeric;
}

function normalizeExpectedOutcomes(value) {
  if (!value) return [];
  if (!Array.isArray(value)) throw new Error('expected_outcomes must be an array');
  return value.map((item, index) => ({
    id: requireText(item?.id, `expected outcome ${index + 1} requires id`),
    statement: requireText(item?.statement, `expected outcome ${index + 1} requires statement`),
    metric: normalizeNullableText(item?.metric)
  }));
}

function normalizeObservedOutcomes(value) {
  if (!value) return [];
  if (!Array.isArray(value)) throw new Error('observed_outcomes must be an array');
  return value.map((item, index) => ({
    id: requireText(item?.id, `observed outcome ${index + 1} requires id`),
    observation: requireText(item?.observation, `observed outcome ${index + 1} requires observation`)
  }));
}

function uniqueStrings(value) {
  if (!value) return [];
  if (!Array.isArray(value)) throw new Error('expected an array');
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function requireText(value, message) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(message);
  return text;
}

function normalizeNullableText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}
