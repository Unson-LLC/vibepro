const ARCHITECTURE_FIELDS = [
  'semantic_owner',
  'deterministic_owner',
  'core_hypothesis',
  'strongest_counterexample',
  'false_success_mode',
  'unknown_representation'
];

const REQUIRED_OPERATIONAL_TERMS = [
  'sufficient',
  'relevant',
  'directly_answers',
  'applicable',
  'current',
  'non_conflicting',
  'unambiguous'
];

export const SEMANTIC_OUTCOME_KINDS = [
  'internal_output',
  'downstream_outcome',
  'canonical_readback'
];
export const SEMANTIC_CASE_KINDS = [
  'positive',
  'negative',
  'ambiguous',
  'conflicting',
  'stale',
  'unavailable'
];
export const SEMANTIC_ANSWER_STATUSES = [
  'resolved',
  'ambiguous',
  'no_answer',
  'conflicting',
  'stale',
  'unavailable'
];
export const SEMANTIC_CHECK_NAMES = [
  'relevant',
  'directly_answers',
  'applicable',
  'current',
  'non_conflicting',
  'unambiguous',
  'sufficient'
];

const OUTCOME_SET = new Set(SEMANTIC_OUTCOME_KINDS);
const CASE_SET = new Set(SEMANTIC_CASE_KINDS);
const ANSWER_SET = new Set(SEMANTIC_ANSWER_STATUSES);
const DEFAULT_UNRESOLVED_BEHAVIOR = {
  action: 'ask_once',
  max_questions: 1,
  automatic_continuation: false
};

export function assessSemanticContract(spec = {}, options = {}) {
  const clauses = Array.isArray(spec?.clauses) ? spec.clauses : [];
  const hasContract = Object.prototype.hasOwnProperty.call(spec ?? {}, 'semantic_contract');
  const clauseAssessments = clauses.map((clause, index) => assessSemanticClause(clause, index));

  if (!hasContract) {
    return {
      ...createSemanticUnavailableAssessment(['semantic_contract_missing'], clauseAssessments),
      warnings: [{
        code: 'semantic_contract_missing',
        severity: 'warning',
        path: 'semantic_contract',
        message: 'semantic_contract is absent; semantic sufficiency and answer resolution are unavailable'
      }]
    };
  }

  const contractValidation = validateSemanticContractShape(spec.semantic_contract);
  const errors = [
    ...contractValidation.errors,
    ...clauseAssessments.flatMap((assessment) => assessment.errors)
  ];
  const warnings = clauseAssessments.flatMap((assessment) => assessment.warnings);
  const status = errors.length > 0 ? 'invalid' : 'available';
  const statuses = clauseAssessments
    .map((assessment) => assessment.answer_status)
    .filter((answerStatus) => ANSWER_SET.has(answerStatus));
  const uniqueStatuses = [...new Set(statuses)];
  const answerStatus = uniqueStatuses.length === 0
    ? 'unavailable'
    : uniqueStatuses.length === 1 ? uniqueStatuses[0] : 'mixed';
  const answerResolution = statuses.length === 0
    ? 'unavailable'
    : statuses.every((answerStatus) => answerStatus === 'resolved')
      ? 'resolved'
      : 'unresolved';
  const resolvedCases = clauseAssessments.filter((assessment) => (
    assessment.status === 'resolved' && assessment.answer_status === 'resolved'
  ));
  const hasDeclaredCounterexample = clauseAssessments.some((assessment) => (
    SEMANTIC_CASE_KINDS.includes(assessment.case_kind) && assessment.case_kind !== 'positive'
  ));
  const verifiedCounterexampleIndexes = new Set(options.verifiedCounterexampleIndexes ?? []);
  const hasVerifiedCounterexample = clauseAssessments.some((assessment) => (
    SEMANTIC_CASE_KINDS.includes(assessment.case_kind)
      && assessment.case_kind !== 'positive'
      && verifiedCounterexampleIndexes.has(assessment.index)
  ));
  const positiveOnly = clauseAssessments.length > 0
    && clauseAssessments.every((assessment) => assessment.case_kind === 'positive');
  const counterexampleStatus = hasVerifiedCounterexample
    ? 'verified'
    : hasDeclaredCounterexample
      ? 'declared_unverified'
    : positiveOnly && resolvedCases.length > 0 ? 'missing' : 'unavailable';

  if (status === 'available' && ['missing', 'declared_unverified'].includes(counterexampleStatus)) {
    warnings.push({
      code: 'semantic_counterexample_missing',
      severity: 'warning',
      path: 'semantic_contract.strongest_counterexample',
      message: counterexampleStatus === 'declared_unverified'
        ? 'the declared counterexample is not linked to a verifiable test file and case'
        : 'happy-path semantic resolution has no verified counterexample'
    });
  }

  const unresolvedBehavior = isRecord(spec.semantic_contract)
    && isRecord(spec.semantic_contract.unresolved_behavior)
    ? { ...spec.semantic_contract.unresolved_behavior }
    : { ...DEFAULT_UNRESOLVED_BEHAVIOR };
  const outcomeCoverage = summarizeSemanticOutcomeCoverage(clauseAssessments);

  return {
    status,
    semantic_contract_status: status,
    semantic_contract_present: true,
    answer_status: answerStatus,
    answer_resolution: status === 'invalid' ? 'unavailable' : answerResolution,
    automatic_continuation: status === 'available'
      && answerResolution === 'resolved'
      && clauseAssessments.every((assessment) => OUTCOME_SET.has(assessment.outcome_kind)),
    unresolved_behavior: unresolvedBehavior,
    counterexample: {
      status: counterexampleStatus,
      declared: hasDeclaredCounterexample,
      verified: hasVerifiedCounterexample,
      happy_path_resolutions: resolvedCases.map((assessment) => assessment.clause_id)
    },
    clause_assessments: clauseAssessments,
    outcome_coverage: outcomeCoverage,
    reason_codes: [...new Set([
      ...contractValidation.reason_codes,
      ...clauseAssessments.flatMap((assessment) => assessment.reason_codes)
    ])],
    errors,
    warnings
  };
}

export function assessSemanticClause(clause = {}, index = 0) {
  const locator = 'clauses[' + index + ']';
  const errors = [];
  const warnings = [];
  const outcomeDeclared = clause?.outcome_kind !== undefined;
  const caseDeclared = clause?.case_kind !== undefined;
  const outcomeKind = OUTCOME_SET.has(clause?.outcome_kind)
    ? clause.outcome_kind : 'unknown';
  const caseKind = CASE_SET.has(clause?.case_kind)
    ? clause.case_kind : 'unknown';

  if (outcomeDeclared && !OUTCOME_SET.has(clause?.outcome_kind)) {
    errors.push({
      code: 'semantic_outcome_kind',
      path: locator + '.outcome_kind',
      message: locator + '.outcome_kind must be one of ' + SEMANTIC_OUTCOME_KINDS.join('|')
    });
  }
  if (caseDeclared && !CASE_SET.has(clause?.case_kind)) {
    errors.push({
      code: 'semantic_case_kind',
      path: locator + '.case_kind',
      message: locator + '.case_kind must be one of ' + SEMANTIC_CASE_KINDS.join('|')
    });
  }

  const evaluation = clause?.semantic_evaluation;
  const evaluationDeclared = evaluation !== undefined;
  let answerStatus = 'unavailable';
  let checks = Object.fromEntries(SEMANTIC_CHECK_NAMES.map((name) => [name, null]));
  let supportingRecordIds = [];

  if (evaluationDeclared) {
    if (!isRecord(evaluation)) {
      errors.push({
        code: 'semantic_evaluation_shape',
        path: locator + '.semantic_evaluation',
        message: locator + '.semantic_evaluation must be an object'
      });
    } else {
      answerStatus = ANSWER_SET.has(evaluation.answer_status)
        ? evaluation.answer_status : 'unavailable';
      if (!ANSWER_SET.has(evaluation.answer_status)) {
        errors.push({
          code: 'semantic_answer_status',
          path: locator + '.semantic_evaluation.answer_status',
          message: locator + '.semantic_evaluation.answer_status must be one of ' + SEMANTIC_ANSWER_STATUSES.join('|')
        });
      }
      if (evaluation.checks !== undefined) {
        if (!isRecord(evaluation.checks)) {
          errors.push({
            code: 'semantic_checks_shape',
            path: locator + '.semantic_evaluation.checks',
            message: locator + '.semantic_evaluation.checks must be an object'
          });
        } else {
          checks = Object.fromEntries(SEMANTIC_CHECK_NAMES.map((name) => {
            const value = evaluation.checks[name];
            if (value !== undefined && value !== null && typeof value !== 'boolean') {
              errors.push({
                code: 'semantic_check_type',
                path: locator + '.semantic_evaluation.checks.' + name,
                message: name + ' must be true, false, or null'
              });
            }
            return [name, value === undefined ? null : value];
          }));
        }
      }
      if (evaluation.supporting_record_ids !== undefined) {
        if (!Array.isArray(evaluation.supporting_record_ids)) {
          errors.push({
            code: 'semantic_supporting_record_ids',
            path: locator + '.semantic_evaluation.supporting_record_ids',
            message: 'supporting_record_ids must be an array when present'
          });
        } else {
          supportingRecordIds = evaluation.supporting_record_ids;
          for (const [recordIndex, recordId] of supportingRecordIds.entries()) {
            if (typeof recordId !== 'string' || recordId.trim().length === 0) {
              errors.push({
                code: 'semantic_supporting_record_id_shape',
                path: locator + '.semantic_evaluation.supporting_record_ids[' + recordIndex + ']',
                message: 'supporting_record_ids must contain non-empty strings'
              });
            }
          }
        }
      }

      if (answerStatus === 'resolved') {
        const missingChecks = SEMANTIC_CHECK_NAMES.filter((name) => checks[name] !== true);
        if (missingChecks.length > 0) {
          errors.push({
            code: 'semantic_resolved_checks',
            path: locator + '.semantic_evaluation.checks',
            message: 'resolved requires all seven checks true: ' + missingChecks.join(', ')
          });
        }
        if (supportingRecordIds.length === 0) {
          errors.push({
            code: 'semantic_resolved_evidence',
            path: locator + '.semantic_evaluation.supporting_record_ids',
            message: 'resolved requires at least one supporting_record_id'
          });
        }
        if (caseKind !== 'positive') {
          errors.push({
            code: 'semantic_resolved_case_kind',
            path: locator + '.case_kind',
            message: 'resolved requires case_kind=positive'
          });
        }
        if (!OUTCOME_SET.has(outcomeKind)) {
          errors.push({
            code: 'semantic_resolved_outcome_kind',
            path: locator + '.outcome_kind',
            message: 'resolved requires a declared outcome_kind'
          });
        }
        validateResolvedEvaluation(evaluation, locator, errors);
      }
    }
  }

  const status = errors.length > 0
    ? 'invalid'
    : !evaluationDeclared || answerStatus === 'unavailable'
      ? 'unavailable'
      : answerStatus === 'resolved' ? 'resolved' : 'unresolved';
  const reasonCodes = [];
  if (!outcomeDeclared) reasonCodes.push('semantic_outcome_kind_unknown');
  if (!caseDeclared) reasonCodes.push('semantic_case_kind_unknown');
  if (!evaluationDeclared) reasonCodes.push('semantic_evaluation_unavailable');
  if (errors.length > 0) reasonCodes.push('semantic_declaration_invalid');
  if (answerStatus !== 'resolved' && ANSWER_SET.has(answerStatus)) {
    reasonCodes.push('semantic_answer_' + answerStatus);
  }

  return {
    index,
    clause_id: typeof clause?.id === 'string' ? clause.id : 'clause:' + (index + 1),
    status,
    outcome_kind: outcomeKind,
    case_kind: caseKind,
    answer_status: answerStatus,
    answer_resolution: answerStatus === 'resolved' ? 'resolved'
      : ANSWER_SET.has(answerStatus) ? 'unresolved' : 'unavailable',
    evaluation_declared: evaluationDeclared,
    checks,
    supporting_record_ids: supportingRecordIds,
    verification_status: 'unknown',
    reason_codes: [...new Set(reasonCodes)],
    errors,
    warnings
  };
}

export function validateSemanticContractShape(contract) {
  const errors = [];
  const reasonCodes = [];
  if (!isRecord(contract)) {
    return {
      errors: [{
        code: 'semantic_contract_shape',
        path: 'semantic_contract',
        message: 'semantic_contract must be an object when present'
      }],
      warnings: [],
      reason_codes: ['semantic_contract_invalid']
    };
  }

  for (const field of ARCHITECTURE_FIELDS) {
    if (typeof contract[field] !== 'string' || contract[field].trim().length === 0) {
      errors.push({
        code: 'semantic_contract_field',
        path: 'semantic_contract.' + field,
        message: 'semantic_contract.' + field + ' must be a non-empty string'
      });
    }
  }

  const definitions = contract.operational_definitions;
  if (!Array.isArray(definitions)) {
    errors.push({
      code: 'semantic_operational_definitions_shape',
      path: 'semantic_contract.operational_definitions',
      message: 'operational_definitions must define the seven semantic checks'
    });
  } else {
    const terms = new Set();
    for (const [index, definition] of definitions.entries()) {
      if (!isRecord(definition)
          || typeof definition.term !== 'string'
          || definition.term.trim().length === 0
          || typeof definition.definition !== 'string'
          || definition.definition.trim().length === 0) {
        errors.push({
          code: 'semantic_operational_definition',
          path: 'semantic_contract.operational_definitions[' + index + ']',
          message: 'each operational definition requires non-empty term and definition'
        });
        continue;
      }
      terms.add(definition.term);
    }
    for (const term of REQUIRED_OPERATIONAL_TERMS) {
      if (!terms.has(term)) {
        errors.push({
          code: 'semantic_operational_definition_missing',
          path: 'semantic_contract.operational_definitions',
          message: 'missing operational definition for ' + term
        });
      }
    }
  }

  if (contract.unresolved_behavior !== undefined) {
    const behavior = contract.unresolved_behavior;
    if (!isRecord(behavior)
        || behavior.action !== 'ask_once'
        || behavior.max_questions !== 1
        || behavior.automatic_continuation !== false) {
      errors.push({
        code: 'semantic_unresolved_behavior',
        path: 'semantic_contract.unresolved_behavior',
        message: 'unresolved_behavior must be { action: ask_once, max_questions: 1, automatic_continuation: false }'
      });
    }
  }

  if (errors.length > 0) reasonCodes.push('semantic_contract_invalid');
  return { errors, warnings: [], reason_codes: reasonCodes };
}

export function createSemanticUnavailableAssessment(
  reasonCodes = ['semantic_contract_missing'],
  clauseAssessments = []
) {
  return {
    status: 'unavailable',
    semantic_contract_status: 'missing',
    semantic_contract_present: false,
    answer_status: 'unavailable',
    answer_resolution: 'unavailable',
    automatic_continuation: false,
    unresolved_behavior: { ...DEFAULT_UNRESOLVED_BEHAVIOR },
    counterexample: {
      status: 'unavailable',
      declared: false,
      verified: false,
      happy_path_resolutions: []
    },
    clause_assessments: clauseAssessments,
    outcome_coverage: summarizeSemanticOutcomeCoverage(clauseAssessments),
    reason_codes: [...new Set(reasonCodes)],
    errors: [],
    warnings: []
  };
}

export function summarizeSemanticOutcomeCoverage(assessments = []) {
  const entries = Array.isArray(assessments)
    ? assessments.filter((assessment) => assessment && typeof assessment === 'object')
    : [];
  const summarizeKind = (kind) => {
    const matching = entries.filter((assessment) => assessment.outcome_kind === kind);
    const verificationValues = new Set(matching.map((assessment) => assessment.verification_status)
      .filter((value) => value && value !== 'unknown' && value !== 'unavailable'));
    const verificationStatus = kind === 'internal_output'
      ? verificationValues.has('verified') ? 'verified'
        : verificationValues.size > 0 ? 'partial' : 'unknown'
      : 'unknown';
    const status = matching.length === 0
      ? 'unknown'
      : matching.some((assessment) => assessment.status === 'invalid')
        ? 'invalid'
        : kind === 'internal_output' ? verificationStatus : 'unknown';
    return {
      status,
      declared_count: matching.length,
      answer_resolved_count: matching.filter((assessment) => assessment.answer_status === 'resolved').length,
      answer_unresolved_count: matching.filter((assessment) => (
        ANSWER_SET.has(assessment.answer_status) && assessment.answer_status !== 'resolved'
      )).length,
      invalid_count: matching.filter((assessment) => assessment.status === 'invalid').length,
      verification_status: verificationStatus,
      clause_ids: matching.map((assessment) => assessment.clause_id)
    };
  };

  const internalOutput = summarizeKind('internal_output');
  const downstreamOutcome = summarizeKind('downstream_outcome');
  const canonicalReadback = summarizeKind('canonical_readback');
  const unknown = summarizeKind('unknown');
  const groups = [internalOutput, downstreamOutcome, canonicalReadback, unknown];
  const status = entries.length === 0
    ? 'unknown'
    : groups.some((group) => group.status === 'invalid')
      ? 'invalid'
      : 'partial';
  return {
    status,
    internal_output: internalOutput,
    downstream_outcome: downstreamOutcome,
    canonical_readback: canonicalReadback,
    unknown
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateResolvedEvaluation(evaluation, locator, errors) {
  const requireText = (field) => {
    if (typeof evaluation[field] !== 'string' || evaluation[field].trim().length === 0) {
      errors.push({
        code: 'semantic_resolved_' + field,
        path: locator + '.semantic_evaluation.' + field,
        message: 'resolved requires a non-empty ' + field
      });
    }
  };
  for (const field of ['question_digest', 'relevance_explanation', 'applicability_scope']) {
    requireText(field);
  }
  if (!Number.isFinite(evaluation.confidence)
      || evaluation.confidence < 0
      || evaluation.confidence > 1) {
    errors.push({
      code: 'semantic_resolved_confidence',
      path: locator + '.semantic_evaluation.confidence',
      message: 'resolved requires finite confidence between 0 and 1'
    });
  }
  if (evaluation.conflict_check !== 'clear') {
    errors.push({
      code: 'semantic_resolved_conflict_check',
      path: locator + '.semantic_evaluation.conflict_check',
      message: 'resolved requires conflict_check=clear'
    });
  }
  if (evaluation.freshness_check !== 'current') {
    errors.push({
      code: 'semantic_resolved_freshness_check',
      path: locator + '.semantic_evaluation.freshness_check',
      message: 'resolved requires freshness_check=current'
    });
  }

  const hasDerivedAnswer = typeof evaluation.derived_answer === 'string'
    && evaluation.derived_answer.trim().length > 0;
  const choices = Array.isArray(evaluation.normalized_choices)
    ? evaluation.normalized_choices : [];
  const hasSelectedChoice = typeof evaluation.selected_choice === 'string'
    && choices.includes(evaluation.selected_choice);
  if (!hasDerivedAnswer && !hasSelectedChoice) {
    errors.push({
      code: 'semantic_resolved_answer',
      path: locator + '.semantic_evaluation',
      message: 'resolved requires derived_answer or selected_choice contained in normalized_choices'
    });
  }
}
