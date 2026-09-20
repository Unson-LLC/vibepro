import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  advanceJudgmentInvestigation,
  buildJudgmentInvestigationContext
} from '../src/judgment-investigation.js';
import { collectJudgmentEvidence } from '../src/judgment-investigation-evidence.js';

const ROOT_PREFIX = path.join(os.tmpdir(), 'vibepro-judgment-investigation-');

function initialInput(goal = 'Decide whether the requested capability needs a new path.') {
  return {
    schema_version: '0.1.0',
    case_id: 'case-investigation-test',
    goal,
    scope: { files: ['src/feature.js'] },
    constraints: ['read-only investigation', 'preserve existing contracts']
  };
}

async function makeFixture(t, { graph = defaultGraph(), source = defaultSource() } = {}) {
  const root = await mkdtemp(ROOT_PREFIX);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src/feature.js'), source, 'utf8');
  await writeFile(path.join(root, 'graph.json'), JSON.stringify(graph, null, 2), 'utf8');
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function defaultSource() {
  return [
    'export function feature(input) {',
    '  return input?.existingPath ?? null;',
    '}',
    ''
  ].join('\n');
}

function defaultGraph() {
  return {
    nodes: [
      { id: 'feature', label: 'feature', source_file: 'src/feature.js', community: 'feature' },
      { id: 'orphan', label: 'orphan', source_file: 'src/orphan.js', community: 'legacy' }
    ],
    edges: []
  };
}

function evidenceCollector(log, overrides = {}) {
  return async (repoRoot, request) => {
    log.push(structuredClone(request));
    const override = overrides[request.provider];
    if (typeof override === 'function') return override(repoRoot, request);
    if (override) return structuredClone(override);
    return collectJudgmentEvidence(repoRoot, request, { graphPath: 'graph.json' });
  };
}

function unavailable(provider, limitation = `${provider} unavailable in this test`) {
  return {
    provider,
    status: 'unavailable',
    content: '',
    source_refs: [],
    limitation
  };
}

function partial(provider, sourceRef = 'graph.json') {
  return {
    provider,
    status: 'partial',
    content: `${provider} partial evidence`,
    source_refs: [sourceRef],
    limitation: `${provider} evidence is partial`
  };
}

function available(provider, sourceRef, content = `${provider} evidence`) {
  return {
    provider,
    status: 'available',
    content,
    source_refs: [sourceRef],
    limitation: null
  };
}

function evidenceIds(result, provider) {
  return (result.evidence ?? [])
    .filter((entry) => !provider || entry.provider === provider)
    .map((entry) => entry.id)
    .filter(Boolean);
}

function questionTexts(value) {
  const candidates = [
    ...(value?.model_request?.previous_questions ?? []),
    ...(value?.model_request?.pending_questions ?? []),
    ...(value?.analysis?.questions ?? [])
  ];
  return candidates.map((question) => question.text).filter((text) => typeof text === 'string');
}

function responseFor(result, {
  questionId = 'q-semantic',
  questionText = 'What semantic behavior must be verified before choosing a path?',
  pathId = null,
  status = 'open',
  finding = '',
  questionEvidenceIds = evidenceIds(result),
  observations = [],
  options = [],
  recommendation = null,
  unknowns = [],
  requests = []
} = {}) {
  return {
    context_id: result.context_id,
    questions: [{
      id: questionId,
      text: questionText,
      path_id: pathId,
      status,
      finding,
      evidence_ids: [...questionEvidenceIds]
    }],
    observations,
    options,
    recommendation,
    unknowns: [...unknowns],
    requests: requests.map((request) => ({ ...request, query: { ...(request.query ?? {}) } }))
  };
}

function sourceRequest(questionId = 'q-semantic', id = 'req-source') {
  return {
    id,
    question_id: questionId,
    provider: 'source',
    purpose: 'Read the bounded source excerpt needed to answer the semantic question.',
    query: { path: 'src/feature.js', start_line: 1, end_line: 3 }
  };
}

function graphRequest(questionId = 'q-semantic', id = 'req-graph-recheck') {
  return {
    id,
    question_id: questionId,
    provider: 'graphify',
    purpose: 'Recheck the selected path against the current Graphify artifact.',
    query: { files: ['src/feature.js'] }
  };
}

function groundedOption(evidence, questionId = 'q-semantic') {
  return {
    id: 'reuse-existing-path',
    description: 'Reuse the existing path after confirming its contract.',
    tradeoffs: ['lower independent state', 'requires preserving the existing boundary'],
    question_ids: [questionId],
    evidence_ids: [...evidence]
  };
}

function groundedRecommendation(evidence) {
  return {
    option_id: 'reuse-existing-path',
    rationale: 'The bounded source evidence supports reuse while retaining the contract tradeoff.',
    evidence_ids: [...evidence]
  };
}

function assertAcyclic(dag) {
  assert.ok(dag && typeof dag === 'object', 'result must expose a DAG object');
  assert.ok(Array.isArray(dag.nodes), 'DAG nodes must be an array');
  assert.ok(Array.isArray(dag.edges), 'DAG edges must be an array');
  const nodes = dag.nodes;
  const edges = dag.edges;
  assert.ok(nodes.length > 0, 'DAG must contain at least one node');
  const ids = new Set();
  for (const node of nodes) {
    assert.ok(node && typeof node === 'object', 'DAG node must be an object');
    assert.equal(typeof node.id, 'string', 'DAG node id must be a string');
    assert.ok(node.id.length > 0, 'DAG node id must be non-empty');
    assert.equal(ids.has(node.id), false, `duplicate DAG node id: ${node.id}`);
    ids.add(node.id);
  }
  const outgoing = new Map([...ids].map((id) => [id, []]));
  for (const edge of edges) {
    assert.ok(edge && typeof edge === 'object', 'DAG edge must be an object');
    const from = edge.from ?? edge.source;
    const to = edge.to ?? edge.target;
    assert.equal(typeof from, 'string', 'DAG edge source must be a string');
    assert.equal(typeof to, 'string', 'DAG edge target must be a string');
    assert.ok(from.length > 0, 'DAG edge source must be non-empty');
    assert.ok(to.length > 0, 'DAG edge target must be non-empty');
    assert.ok(ids.has(from), `DAG edge source is unknown: ${from}`);
    assert.ok(ids.has(to), `DAG edge target is unknown: ${to}`);
    outgoing.get(from).push(to);
  }
  const active = new Set();
  const visited = new Set();
  function visit(id) {
    if (active.has(id)) return false;
    if (visited.has(id)) return true;
    active.add(id);
    for (const next of outgoing.get(id) ?? []) {
      if (!visit(next)) return false;
    }
    active.delete(id);
    visited.add(id);
    return true;
  }
  for (const id of ids) assert.equal(visit(id), true, `DAG cycle found at ${id}`);
}

test('initial raw goal performs Graphify reconnaissance before returning the host model request', async (t) => {
  const root = await makeFixture(t);
  const calls = [];
  const input = initialInput();
  const before = structuredClone(input);

  const result = await advanceJudgmentInvestigation(root, input, {
    graphPath: 'graph.json',
    collectEvidence: evidenceCollector(calls)
  });

  assert.equal(result.status, 'awaiting_interpretation');
  assert.ok(result.model_request);
  assert.equal(calls[0]?.provider, 'graphify');
  assert.deepEqual(calls[0]?.query?.files, ['src/feature.js']);
  assert.ok(evidenceIds(result, 'graphify').length > 0);
  assert.deepEqual(input, before, 'the initial input remains immutable');
});

test('Graphify unavailability is explicit evidence and never becomes an absence claim', async (t) => {
  const root = await makeFixture(t);
  const calls = [];
  const result = await advanceJudgmentInvestigation(root, initialInput(), {
    graphPath: 'missing-graph.json',
    collectEvidence: evidenceCollector(calls, {
      graphify: unavailable('graphify', 'Graphify artifact was not available for this scope.')
    })
  });

  const graphEvidence = result.evidence.filter((entry) => entry.provider === 'graphify');
  assert.equal(graphEvidence.length, 1);
  assert.equal(graphEvidence[0].status, 'unavailable');
  assert.match(graphEvidence[0].limitation, /not available/);
  assert.notEqual(result.status, 'candidate_ready');
  assert.equal(result.analysis, null, 'an unavailable Graphify receipt does not create a semantic absence finding');
  assert.equal(result.model_request?.evidence?.find((entry) => entry.provider === 'graphify')?.status, 'unavailable');
});

test('an injected interpreter supplies semantic questions without regex or catalog routing', async (t) => {
  const root = await makeFixture(t);
  const calls = [];
  let interpretedRequest;
  const initial = await advanceJudgmentInvestigation(root, initialInput('Fix the existing feature path safely.'), {
    collectEvidence: evidenceCollector(calls)
  });
  const response = responseFor(initial, {
    questionText: 'Which boundary does the current feature path actually own?',
    requests: []
  });
  const next = await advanceJudgmentInvestigation(root, initial, {
    interpret: async (modelRequest) => {
      interpretedRequest = structuredClone(modelRequest);
      return response;
    },
    collectEvidence: evidenceCollector(calls)
  });

  assert.ok(interpretedRequest);
  assert.ok(questionTexts(next).includes(response.questions[0].text));
  assert.equal(response.questions[0].path_id, null);
  assert.equal(next.analysis?.questions?.[0]?.path_id ?? null, null);
  assert.deepEqual(next.expert_input?.observations ?? [], [], 'expert input only carries boolean observations');
  assert.equal(Object.hasOwn(next.expert_input ?? {}, 'options'), false, 'expert input does not carry option tradeoffs');
  assert.equal(calls[0]?.provider, 'graphify');
});

test('the same goal yields different semantic questions when Graphify evidence changes', async (t) => {
  const root = await makeFixture(t);
  const goal = 'Decide whether the requested capability needs a new path.';
  const noMatch = available('graphify', 'graph-no-match.json', JSON.stringify({ matched_files: [], unmatched_files: ['src/feature.js'] }));
  const disconnected = available('graphify', 'graph-disconnected.json', JSON.stringify({
    matched_files: ['src/feature.js'],
    related_files: [],
    edges: []
  }));

  const first = await advanceJudgmentInvestigation(root, initialInput(goal), {
    collectEvidence: evidenceCollector([], { graphify: noMatch })
  });
  const firstNext = await advanceJudgmentInvestigation(root, first, {
    response: responseFor(first, {
      questionText: 'Is this a new capability because no existing path is in scope?',
      requests: []
    }),
    collectEvidence: evidenceCollector([])
  });

  const second = await advanceJudgmentInvestigation(root, initialInput(goal), {
    collectEvidence: evidenceCollector([], { graphify: disconnected })
  });
  const secondNext = await advanceJudgmentInvestigation(root, second, {
    response: responseFor(second, {
      questionText: 'Which existing path is disconnected from the requested capability?',
      requests: []
    }),
    collectEvidence: evidenceCollector([])
  });

  assert.ok(questionTexts(firstNext).includes('Is this a new capability because no existing path is in scope?'));
  assert.ok(questionTexts(secondNext).includes('Which existing path is disconnected from the requested capability?'));
  assert.notDeepEqual(questionTexts(firstNext), questionTexts(secondNext));
});

test('custom questions remain first-class and survive a pending round', async (t) => {
  const root = await makeFixture(t);
  const initial = await advanceJudgmentInvestigation(root, initialInput(), {
    collectEvidence: evidenceCollector([])
  });
  const custom = responseFor(initial, {
    questionId: 'q-custom-boundary',
    questionText: 'What would break if this capability moved behind the existing boundary?',
    pathId: null,
    unknowns: ['runtime impact is not yet measured'],
    requests: [sourceRequest('q-custom-boundary')]
  });
  const responseBefore = structuredClone(custom);
  const pending = await advanceJudgmentInvestigation(root, initial, {
    response: custom,
    collectEvidence: evidenceCollector([])
  });

  assert.equal(custom.context_id, responseBefore.context_id);
  assert.deepEqual(custom, responseBefore, 'the response object is not mutated');
  assert.ok(questionTexts(pending).includes(custom.questions[0].text));
  assert.match(JSON.stringify(pending), /runtime impact is not yet measured/);
});

test('Graphify is requested both before and after interpretation when the host asks for a recheck', async (t) => {
  const root = await makeFixture(t);
  const calls = [];
  const initial = await advanceJudgmentInvestigation(root, initialInput(), {
    collectEvidence: evidenceCollector(calls)
  });
  const response = responseFor(initial, {
    requests: [graphRequest()]
  });
  await advanceJudgmentInvestigation(root, initial, {
    response,
    collectEvidence: evidenceCollector(calls)
  });

  const graphifyCalls = calls.filter((request) => request.provider === 'graphify');
  assert.ok(graphifyCalls.length >= 2, `expected pre/post interpretation Graphify calls, got ${graphifyCalls.length}`);
  assert.deepEqual(graphifyCalls[0].query.files, ['src/feature.js']);
  assert.deepEqual(graphifyCalls.at(-1).query.files, ['src/feature.js']);
});

test('new evidence binds the next context and invalidates the previous analysis and recommendation', async (t) => {
  const root = await makeFixture(t);
  const calls = [];
  const initial = await advanceJudgmentInvestigation(root, initialInput(), {
    collectEvidence: evidenceCollector(calls)
  });
  const graphIds = evidenceIds(initial, 'graphify');
  const withSource = await advanceJudgmentInvestigation(root, initial, {
    response: responseFor(initial, {
      questionEvidenceIds: graphIds,
      requests: [sourceRequest()]
    }),
    collectEvidence: evidenceCollector(calls)
  });
  const sourceIds = evidenceIds(withSource, 'source');
  const interpreted = await advanceJudgmentInvestigation(root, withSource, {
    response: responseFor(withSource, {
      status: 'answered',
      finding: 'The source excerpt supports the current contract.',
      questionEvidenceIds: sourceIds,
      observations: [{
        id: 'obs-implementation',
        kind: 'implementation_present',
        value: true,
        rationale: 'The bounded source excerpt contains the existing implementation.',
        evidence_ids: sourceIds
      }],
      options: [groundedOption(sourceIds)],
      recommendation: groundedRecommendation(sourceIds)
    }),
    collectEvidence: evidenceCollector(calls)
  });

  assert.equal(interpreted.status, 'candidate_ready');
  const previousRecommendation = structuredClone(interpreted.recommendation);
  const before = await advanceJudgmentInvestigation(root, interpreted, {
    response: responseFor(interpreted, {
      status: 'answered',
      finding: 'The prior interpretation is being rechecked after new source evidence.',
      questionEvidenceIds: sourceIds,
      observations: [{
        id: 'obs-implementation-recheck',
        kind: 'implementation_present',
        value: true,
        rationale: 'The follow-up source excerpt is requested before retaining the recommendation.',
        evidence_ids: sourceIds
      }],
      options: [groundedOption(sourceIds)],
      recommendation: groundedRecommendation(sourceIds),
      requests: [sourceRequest('q-semantic', 'req-source-followup')]
    }),
    collectEvidence: evidenceCollector(calls)
  });

  assert.notEqual(before.context_id, interpreted.context_id);
  assert.equal(before.status, 'awaiting_interpretation');
  assert.equal(before.analysis, null);
  assert.equal(before.expert_input, null);
  assert.equal(before.expert_judgment, null);
  assert.equal(before.recommendation, null);
  assert.notDeepEqual(before.recommendation, previousRecommendation);
  assert.ok(evidenceIds(before, 'source').length > sourceIds.length);
});

test('stale response context references are rejected after evidence changes', async (t) => {
  const root = await makeFixture(t);
  const initial = await advanceJudgmentInvestigation(root, initialInput(), {
    collectEvidence: evidenceCollector([])
  });
  const staleResponse = responseFor(initial, { requests: [sourceRequest()] });
  const current = await advanceJudgmentInvestigation(root, initial, {
    response: staleResponse,
    collectEvidence: evidenceCollector([])
  });
  assert.notEqual(current.context_id, initial.context_id);

  await assert.rejects(
    () => advanceJudgmentInvestigation(root, current, {
      response: { ...staleResponse, context_id: initial.context_id },
      collectEvidence: evidenceCollector([])
    }),
    /context|stale|current/i
  );
});

test('different semantic observations produce different contexts and reject cross-stale responses', async (t) => {
  const root = await makeFixture(t);
  const initial = await advanceJudgmentInvestigation(root, initialInput(), {
    collectEvidence: evidenceCollector([])
  });
  const withSource = await advanceJudgmentInvestigation(root, initial, {
    response: responseFor(initial, { requests: [sourceRequest()] }),
    collectEvidence: evidenceCollector([])
  });
  const sourceIds = evidenceIds(withSource, 'source');
  const supportedResponse = responseFor(withSource, {
    status: 'answered',
    finding: 'The current implementation is being compared against the same source receipt.',
    questionEvidenceIds: sourceIds,
    observations: [{
      id: 'obs-context-diff',
      kind: 'implementation_present',
      value: true,
      rationale: 'The source excerpt supports the implementation-present observation.',
      evidence_ids: sourceIds
    }]
  });
  const unsupportedResponse = responseFor(withSource, {
    status: 'answered',
    finding: 'The current implementation is being compared against the same source receipt.',
    questionEvidenceIds: sourceIds,
    observations: [{
      id: 'obs-context-diff',
      kind: 'implementation_present',
      value: false,
      rationale: 'The same bounded source receipt does not support the implementation-present observation.',
      evidence_ids: sourceIds
    }]
  });

  const supported = await advanceJudgmentInvestigation(root, withSource, {
    response: supportedResponse,
    collectEvidence: evidenceCollector([])
  });
  const unsupported = await advanceJudgmentInvestigation(root, withSource, {
    response: unsupportedResponse,
    collectEvidence: evidenceCollector([])
  });

  assert.notEqual(supported.context_id, unsupported.context_id, 'observation values are part of the current context');
  await assert.rejects(
    () => advanceJudgmentInvestigation(root, supported, {
      response: unsupportedResponse,
      collectEvidence: evidenceCollector([])
    }),
    /context|stale|current/i,
    'a response interpreted under the sibling observation context is stale'
  );
});

test('invented evidence identifiers and catalog paths are rejected', async (t) => {
  const root = await makeFixture(t);
  const initial = await advanceJudgmentInvestigation(root, initialInput(), {
    collectEvidence: evidenceCollector([])
  });

  await assert.rejects(
    () => advanceJudgmentInvestigation(root, initial, {
      response: responseFor(initial, {
        pathId: 'invented-catalog-path',
        questionEvidenceIds: ['evidence-invented']
      }),
      collectEvidence: evidenceCollector([])
    }),
    /evidence|path|catalog|unknown/i
  );
});

test('Graphify-only, partial, or unavailable evidence cannot confirm semantic observations', async (t) => {
  const cases = [
    ['graph-only', available('graphify', 'graph.json')],
    ['partial', partial('graphify')],
    ['unavailable', unavailable('graphify')]
  ];
  for (const [label, graphEvidence] of cases) {
    await t.test(label, async (subtest) => {
      const root = await makeFixture(subtest);
      const initial = await advanceJudgmentInvestigation(root, initialInput(), {
        collectEvidence: evidenceCollector([], { graphify: graphEvidence })
      });
      const graphIds = evidenceIds(initial, 'graphify');
      await assert.rejects(
        () => advanceJudgmentInvestigation(root, initial, {
          response: responseFor(initial, {
            status: 'answered',
            finding: 'The semantic behavior is confirmed.',
            questionEvidenceIds: graphIds,
            observations: [{
              id: 'obs-unsupported',
              kind: 'implementation_present',
              value: true,
              rationale: 'This claim has only Graphify evidence.',
              evidence_ids: graphIds
            }]
          }),
          collectEvidence: evidenceCollector([])
        }),
        /observations|non-Graphify|available evidence/i,
        `${label} evidence must not confirm a semantic observation`
      );
    });
  }
});

test('every semantic observation needs its own available non-Graphify evidence', async (t) => {
  const root = await makeFixture(t);
  const initial = await advanceJudgmentInvestigation(root, initialInput(), {
    collectEvidence: evidenceCollector([])
  });
  const withSource = await advanceJudgmentInvestigation(root, initial, {
    response: responseFor(initial, { requests: [sourceRequest()] }),
    collectEvidence: evidenceCollector([])
  });
  const graphIds = evidenceIds(withSource, 'graphify');
  const sourceIds = evidenceIds(withSource, 'source');

  await assert.rejects(
    () => advanceJudgmentInvestigation(root, withSource, {
      response: responseFor(withSource, {
        status: 'answered',
        finding: 'One observation has source evidence, while another has only Graphify evidence.',
        questionEvidenceIds: sourceIds,
        observations: [
          {
            id: 'obs-source-backed',
            kind: 'implementation_present',
            value: true,
            rationale: 'The source receipt contains the implementation excerpt.',
            evidence_ids: sourceIds
          },
          {
            id: 'obs-graph-only',
            kind: 'intended_path_observed',
            value: true,
            rationale: 'Graphify only suggests a static path candidate.',
            evidence_ids: graphIds
          }
        ]
      }),
      collectEvidence: evidenceCollector([])
    }),
    /observations|non-Graphify|available evidence/i,
    'a source-backed observation must not launder a Graphify-only observation'
  );
});

test('unknowns remain unknown and are never normalized into false observations', async (t) => {
  const root = await makeFixture(t);
  const initial = await advanceJudgmentInvestigation(root, initialInput(), {
    collectEvidence: evidenceCollector([])
  });
  const result = await advanceJudgmentInvestigation(root, initial, {
    response: responseFor(initial, {
      unknowns: ['whether runtime behavior reaches the existing path'],
      observations: [],
      options: [],
      recommendation: null
    }),
    collectEvidence: evidenceCollector([])
  });

  assert.notEqual(result.status, 'candidate_ready');
  assert.ok((result.unknowns ?? []).includes('whether runtime behavior reaches the existing path'));
  const observations = result.analysis?.observations ?? [];
  assert.equal(observations.some((observation) => observation?.value === false), false);
});

test('a selected detailed path that is still pending cannot become candidate_ready', async (t) => {
  const root = await makeFixture(t);
  const initial = await advanceJudgmentInvestigation(root, initialInput(), {
    collectEvidence: evidenceCollector([])
  });
  const withSource = await advanceJudgmentInvestigation(root, initial, {
    response: responseFor(initial, {
      requests: [sourceRequest()]
    }),
    collectEvidence: evidenceCollector([])
  });

  const sourceIds = evidenceIds(withSource, 'source');
  const result = await advanceJudgmentInvestigation(root, withSource, {
    response: responseFor(withSource, {
      pathId: 'existing-mechanism',
      status: 'answered',
      questionText: 'Is the existing mechanism contract compatible with this capability?',
      questionEvidenceIds: sourceIds,
      observations: [],
      options: [groundedOption(sourceIds)],
      recommendation: groundedRecommendation(sourceIds),
      unknowns: []
    }),
    collectEvidence: evidenceCollector([])
  });

  assert.equal(result.status, 'needs_evidence', 'a selected path with no detail observations remains unresolved');
  assert.ok(result.expert_judgment?.decision_paths?.includes('existing-mechanism'));
  assert.ok(JSON.stringify(result.expert_judgment).includes('existing-mechanism'));
});

test('answered custom questions with source evidence may become an advisory candidate and retain tradeoffs', async (t) => {
  const root = await makeFixture(t);
  const calls = [];
  const initial = await advanceJudgmentInvestigation(root, initialInput(), {
    collectEvidence: evidenceCollector(calls)
  });
  const graphIds = evidenceIds(initial, 'graphify');
  const withSource = await advanceJudgmentInvestigation(root, initial, {
    response: responseFor(initial, {
      questionId: 'q-custom-boundary',
      questionText: 'What boundary must remain stable when reusing the existing path?',
      questionEvidenceIds: graphIds,
      requests: [sourceRequest('q-custom-boundary')]
    }),
    collectEvidence: evidenceCollector(calls)
  });
  const sourceIds = evidenceIds(withSource, 'source');
  assert.ok(sourceIds.length > 0);
  const final = await advanceJudgmentInvestigation(root, withSource, {
    response: responseFor(withSource, {
      questionId: 'q-custom-boundary',
      questionText: 'What boundary must remain stable when reusing the existing path?',
      status: 'answered',
      finding: 'The source excerpt keeps the existing path contract at the feature boundary.',
      questionEvidenceIds: sourceIds,
      observations: [{
        id: 'obs-boundary',
        kind: 'existing_mechanism_contract_compatible',
        value: true,
        rationale: 'The bounded source excerpt shows the existing boundary.',
        evidence_ids: sourceIds
      }],
      options: [groundedOption(sourceIds, 'q-custom-boundary')],
      recommendation: groundedRecommendation(sourceIds)
    }),
    collectEvidence: evidenceCollector(calls)
  });

  assert.equal(final.status, 'candidate_ready');
  assert.equal(final.advisory, true);
  assert.equal(final.blocking, false);
  assert.deepEqual(final.analysis?.options?.[0]?.tradeoffs, groundedOption(sourceIds, 'q-custom-boundary').tradeoffs);
  assert.deepEqual(buildJudgmentInvestigationContext(final).options?.[0]?.tradeoffs, groundedOption(sourceIds, 'q-custom-boundary').tradeoffs);
  assert.equal(Object.hasOwn(final.expert_input ?? {}, 'options'), false, 'expert input remains observation-focused');
  assert.deepEqual(final.recommendation?.evidence_ids, sourceIds);
});

test('DAG history remains acyclic across investigation rounds', async (t) => {
  const root = await makeFixture(t);
  const calls = [];
  const initial = await advanceJudgmentInvestigation(root, initialInput(), {
    collectEvidence: evidenceCollector(calls)
  });
  const roundOne = await advanceJudgmentInvestigation(root, initial, {
    response: responseFor(initial, { requests: [sourceRequest()] }),
    collectEvidence: evidenceCollector(calls)
  });
  const roundTwo = await advanceJudgmentInvestigation(root, roundOne, {
    response: responseFor(roundOne, {
      status: 'answered',
      finding: 'The bounded source evidence answers the current question.',
      questionEvidenceIds: evidenceIds(roundOne, 'source'),
      observations: [{
        id: 'obs-round-two',
        kind: 'implementation_present',
        value: true,
        rationale: 'Source evidence is available for this round.',
        evidence_ids: evidenceIds(roundOne, 'source')
      }]
    }),
    collectEvidence: evidenceCollector(calls)
  });

  assertAcyclic(initial.dag);
  assertAcyclic(roundOne.dag);
  assertAcyclic(roundTwo.dag);
  assert.equal(roundTwo.history.length >= roundOne.history.length, true);
  const historyRounds = roundTwo.history.map((entry) => entry.round).filter(Number.isInteger);
  assert.deepEqual(historyRounds, [...historyRounds].sort((a, b) => a - b));
});

test('a response with no questions cannot become ready by vacuity', async (t) => {
  const root = await makeFixture(t);
  const initial = await advanceJudgmentInvestigation(root, initialInput(), {
    collectEvidence: evidenceCollector([])
  });
  const emptyResponse = {
    context_id: initial.context_id,
    questions: [],
    observations: [],
    options: [],
    recommendation: null,
    unknowns: [],
    requests: []
  };
  const result = await advanceJudgmentInvestigation(root, initial, {
    response: emptyResponse,
    collectEvidence: evidenceCollector([])
  });

  assert.equal(result.status, 'needs_interpretation');
  assert.deepEqual(result.analysis?.questions, []);
  assert.deepEqual(result.expert_input?.observations ?? [], []);
});

test('requests with no questions cannot invent a question reference', async (t) => {
  const root = await makeFixture(t);
  const initial = await advanceJudgmentInvestigation(root, initialInput(), {
    collectEvidence: evidenceCollector([])
  });
  const response = {
    context_id: initial.context_id,
    questions: [],
    observations: [],
    options: [],
    recommendation: null,
    unknowns: [],
    requests: [sourceRequest('question-that-does-not-exist', 'req-orphaned-question')]
  };

  await assert.rejects(
    () => advanceJudgmentInvestigation(root, initial, {
      response,
      collectEvidence: evidenceCollector([])
    }),
    /question|unknown/i
  );
});

test('responses and results do not gain mutation side effects from orchestration', async (t) => {
  const root = await makeFixture(t);
  const calls = [];
  const initial = await advanceJudgmentInvestigation(root, initialInput(), {
    collectEvidence: evidenceCollector(calls)
  });
  const response = responseFor(initial, {
    questionText: 'Which source boundary is actually exercised?',
    requests: [sourceRequest()]
  });
  const responseBefore = structuredClone(response);
  const resultBefore = structuredClone(initial);
  await advanceJudgmentInvestigation(root, initial, {
    response,
    collectEvidence: evidenceCollector(calls)
  });

  assert.deepEqual(response, responseBefore);
  assert.deepEqual(initial, resultBefore);
  const stored = await readFile(path.join(root, 'src/feature.js'), 'utf8');
  assert.equal(stored, defaultSource());
});
