import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  SEMANTIC_CHECK_NAMES,
  validateSpec
} from '../src/spec-validator.js';
import { buildTraceability } from '../src/traceability.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = path.join(REPO_ROOT, 'test/fixtures/semantic-sufficiency-result-unrelated.json');

const ARCHITECTURE_FIELDS = {
  semantic_owner: 'The requesting user owns the meaning of the claim.',
  deterministic_owner: 'VibePro owns declaration shape and status consistency.',
  core_hypothesis: 'A result is useful only when it supports the requested claim.',
  strongest_counterexample: 'A present result can describe a different subject.',
  false_success_mode: 'Treating any present result as a resolved answer.',
  unknown_representation: 'null and unavailable remain explicit and are never coerced.'
};

const OPERATIONAL_DEFINITIONS = SEMANTIC_CHECK_NAMES.map((term) => ({
  term,
  definition: `The claim is ${term} only when the declaration provides an observable basis.`
}));

function evaluation(answer_status, checks = {}, supporting_record_ids = []) {
  return {
    answer_status,
    question_digest: 'Which saved record directly answers the requested claim?',
    derived_answer: 'The requested record directly supports the claim.',
    relevance_explanation: 'The selected record is about the requested subject and claim.',
    applicability_scope: 'The requesting user and the current request.',
    confidence: 0.9,
    conflict_check: 'clear',
    freshness_check: 'current',
    checks: Object.fromEntries(SEMANTIC_CHECK_NAMES.map((name) => [name, checks[name] ?? null])),
    supporting_record_ids
  };
}

function clause(overrides = {}) {
  return {
    id: 'S-533-1',
    type: 'scenario',
    statement: 'The answer must support the requested claim.',
    origin: { story_refs: [{ kind: 'acceptance_criteria', index: 0 }] },
    outcome_kind: 'internal_output',
    case_kind: 'positive',
    semantic_evaluation: evaluation(
      'resolved',
      Object.fromEntries(SEMANTIC_CHECK_NAMES.map((name) => [name, true])),
      ['result-only-001']
    ),
    ...overrides
  };
}

function spec(overrides = {}) {
  return {
    schema_version: '0.1.0',
    story_id: 'story-533-semantic-sufficiency',
    semantic_contract: {
      ...ARCHITECTURE_FIELDS,
      operational_definitions: OPERATIONAL_DEFINITIONS,
      unresolved_behavior: {
        action: 'ask_once',
        max_questions: 1,
        automatic_continuation: false
      }
    },
    clauses: [clause()],
    ...overrides
  };
}

test('legacy Specs remain valid while semantic assessment is explicitly unavailable', async () => {
  const result = await validateSpec(REPO_ROOT, {
    schema_version: '0.1.0',
    story_id: 'story-533-legacy',
    clauses: [
      {
        id: 'S-LEGACY-1',
        type: 'scenario',
        statement: 'A legacy clause remains deterministic.',
        origin: { story_refs: [{ kind: 'acceptance_criteria', index: 0 }] }
      }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.semantic_assessment.status, 'unavailable');
  assert.equal(result.semantic_assessment.answer_resolution, 'unavailable');
  assert.ok(result.warnings.some((warning) => warning.code === 'semantic_contract_missing'));
});

test('a present but unrelated result does not resolve a negative claim', async () => {
  const resultRecord = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
  assert.equal(resultRecord.result_exists, true);
  assert.equal(resultRecord.supports_requested_claim, false);

  const result = await validateSpec(REPO_ROOT, spec({
    clauses: [clause({
      origin: {
        story_refs: [{ kind: 'acceptance_criteria', index: 0 }],
        test_refs: [{
          file: 'test/semantic-sufficiency.test.js',
          case: 'a present but unrelated result does not resolve a negative claim'
        }]
      },
      outcome_kind: 'downstream_outcome',
      case_kind: 'negative',
      semantic_evaluation: evaluation('no_answer', {
        relevant: false,
        directly_answers: false,
        applicable: false,
        current: null,
        non_conflicting: null,
        unambiguous: null,
        sufficient: false
      }, [resultRecord.record_id])
    })]
  }));

  assert.equal(result.ok, true);
  assert.equal(result.semantic_assessment.status, 'available');
  assert.equal(result.semantic_assessment.answer_status, 'no_answer');
  assert.equal(result.semantic_assessment.answer_resolution, 'unresolved');
  assert.equal(result.semantic_assessment.clause_assessments[0].status, 'unresolved');
  assert.equal(result.semantic_assessment.clause_assessments[0].checks.current, null);
  assert.equal(result.semantic_assessment.outcome_coverage.downstream_outcome.status, 'unknown');
  assert.equal(result.warnings.some((warning) => warning.code === 'semantic_counterexample_missing'), false);
});

test('a negative label without a concrete test remains an unverified counterexample', async () => {
  const result = await validateSpec(REPO_ROOT, spec({
    clauses: [clause({
      case_kind: 'negative',
      semantic_evaluation: evaluation('no_answer', { sufficient: false })
    })]
  }));

  assert.equal(result.ok, true);
  assert.equal(result.semantic_assessment.counterexample.status, 'declared_unverified');
  assert.equal(result.semantic_assessment.counterexample.verified, false);
  assert.ok(result.warnings.some((warning) => warning.code === 'semantic_counterexample_missing'));
});

test('resolved positive declarations are accepted and only happy paths warn about a missing counterexample', async () => {
  const result = await validateSpec(REPO_ROOT, spec());

  assert.equal(result.ok, true);
  assert.equal(result.semantic_assessment.answer_status, 'resolved');
  assert.equal(result.semantic_assessment.answer_resolution, 'resolved');
  assert.equal(result.semantic_assessment.clause_assessments[0].status, 'resolved');
  assert.equal(result.semantic_assessment.outcome_coverage.internal_output.declared_count, 1);
  assert.equal(result.semantic_assessment.outcome_coverage.internal_output.answer_resolved_count, 1);
  assert.equal(result.semantic_assessment.outcome_coverage.status, 'partial');
  assert.ok(result.warnings.some((warning) => warning.code === 'semantic_counterexample_missing'));
});

test('resolved declarations fail closed when checks, evidence, or case kind contradict resolution', async () => {
  const missingOutcomeClause = clause();
  delete missingOutcomeClause.outcome_kind;
  const invalidCases = [
    ['semantic_resolved_checks', clause({
      semantic_evaluation: evaluation('resolved', { ...Object.fromEntries(SEMANTIC_CHECK_NAMES.map((name) => [name, true])), sufficient: null }, ['result-only-001'])
    })],
    ['semantic_resolved_evidence', clause({
      semantic_evaluation: evaluation('resolved', Object.fromEntries(SEMANTIC_CHECK_NAMES.map((name) => [name, true])))
    })],
    ['semantic_resolved_case_kind', clause({ case_kind: 'negative' })],
    ['semantic_resolved_outcome_kind', missingOutcomeClause],
    ['semantic_resolved_question_digest', clause({
      semantic_evaluation: {
        answer_status: 'resolved',
        checks: Object.fromEntries(SEMANTIC_CHECK_NAMES.map((name) => [name, true])),
        supporting_record_ids: ['result-only-001']
      }
    })]
  ];

  for (const [code, invalidClause] of invalidCases) {
    const result = await validateSpec(REPO_ROOT, spec({ clauses: [invalidClause] }));
    assert.equal(result.ok, false, code);
    assert.ok(result.errors.some((error) => error.code === code), code);
    assert.equal(result.warnings.some((warning) => warning.code === 'semantic_counterexample_missing'), false, code);
  }
});

test('recomputing supplied traceability clauses cannot retain a stale semantic aggregate', () => {
  const existing = buildTraceability(null, {
    storyId: 'story-533-semantic-sufficiency',
    source: 'first',
    lifecycle: 'unknown',
    acceptanceCriteria: [{ id: 'AC-1', semantic_assessment: {
      clause_id: 'S-1', status: 'resolved', answer_status: 'resolved',
      outcome_kind: 'internal_output', case_kind: 'positive', reason_codes: [], errors: [], warnings: []
    } }]
  });
  const updated = buildTraceability(existing, {
    storyId: 'story-533-semantic-sufficiency',
    source: 'second',
    lifecycle: 'unknown',
    acceptanceCriteria: [{ id: 'AC-1', semantic_assessment: {
      clause_id: 'S-1', status: 'unresolved', answer_status: 'no_answer',
      outcome_kind: 'downstream_outcome', case_kind: 'negative', reason_codes: [], errors: [], warnings: []
    } }]
  });

  assert.equal(updated.semantic_assessment.answer_resolution, 'unresolved');
  assert.equal(updated.semantic_assessment.automatic_continuation, false);
  assert.equal(updated.outcome_coverage.internal_output.declared_count, 0);
  assert.equal(updated.outcome_coverage.downstream_outcome.declared_count, 1);
});

test('unresolved answer statuses preserve unknown checks and remain valid', async () => {
  const cases = [
    ['ambiguous', 'ambiguous'],
    ['no_answer', 'negative'],
    ['conflicting', 'conflicting'],
    ['stale', 'stale'],
    ['unavailable', 'unavailable']
  ];

  for (const [answer_status, case_kind] of cases) {
    const result = await validateSpec(REPO_ROOT, spec({
      clauses: [clause({
        case_kind,
        semantic_evaluation: evaluation(answer_status, { current: null })
      })]
    }));
    assert.equal(result.ok, true, answer_status);
    assert.equal(result.semantic_assessment.answer_status, answer_status, answer_status);
    assert.equal(result.semantic_assessment.clause_assessments[0].checks.current, null, answer_status);
  }
});

test('traceability projects outcome kinds and keeps downstream/readback verification unknown', () => {
  const traceability = buildTraceability(null, {
    storyId: 'story-533-semantic-sufficiency',
    source: 'focused-test',
    lifecycle: 'unknown',
    acceptanceCriteria: [
      {
        id: 'AC-1',
        status: 'mapped',
        semantic_assessment: {
          clause_id: 'AC-1',
          status: 'resolved',
          answer_status: 'resolved',
          outcome_kind: 'internal_output',
          case_kind: 'positive',
          verification_status: 'verified',
          reason_codes: [],
          errors: [],
          warnings: []
        }
      },
      {
        id: 'AC-2',
        status: 'mapped',
        semantic_assessment: {
          clause_id: 'AC-2',
          status: 'unresolved',
          answer_status: 'no_answer',
          outcome_kind: 'downstream_outcome',
          case_kind: 'negative',
          verification_status: 'verified',
          reason_codes: [],
          errors: [],
          warnings: []
        }
      },
      {
        id: 'AC-3',
        status: 'mapped',
        semantic_assessment: {
          clause_id: 'AC-3',
          status: 'unresolved',
          answer_status: 'unavailable',
          outcome_kind: 'canonical_readback',
          case_kind: 'unavailable',
          verification_status: 'verified',
          reason_codes: [],
          errors: [],
          warnings: []
        }
      }
    ]
  });

  assert.equal(traceability.semantic_assessment.status, 'available');
  assert.equal(traceability.semantic_assessments.length, 3);
  assert.equal(traceability.outcome_coverage.internal_output.status, 'verified');
  assert.equal(traceability.outcome_coverage.downstream_outcome.status, 'unknown');
  assert.equal(traceability.outcome_coverage.canonical_readback.status, 'unknown');
  assert.equal(traceability.outcome_coverage.status, 'partial');
  assert.equal(traceability.coverage_summary.outcome_coverage.canonical_readback.status, 'unknown');
});
