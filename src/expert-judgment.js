const EXPERT_JUDGMENT_SCHEMA_VERSION = '0.1.0';
const EXPERT_JUDGMENT_RULE_VERSION = '1';

const EVIDENCE_BOUNDARY =
  'source_refs は入力のまま保持し、参照先の存在や観測を証明するかどうかは検証しません。';

const STRUCTURAL_KINDS = Object.freeze([
  'repeated_local_fixes',
  'complexity_growing',
  'outcome_improving',
  'urgent_containment'
]);
const RUNTIME_KINDS = Object.freeze([
  'capability_claimed',
  'implementation_present',
  'intended_path_observed'
]);
const EVIDENCE_KINDS = Object.freeze([
  'verification_repeating',
  'material_unknown_open',
  'next_check_changes_decision'
]);

const ALL_OBSERVATION_KINDS = new Set([
  ...STRUCTURAL_KINDS,
  ...RUNTIME_KINDS,
  ...EVIDENCE_KINDS
]);

const CATALOG_SOURCE = [
  {
    id: 'structural-simplification',
    version: EXPERT_JUDGMENT_SCHEMA_VERSION,
    name: '構造の単純化',
    question: '局所修正の反復が、削除・統合・再設計との比較を必要とする状態か？',
    observation_kinds: STRUCTURAL_KINDS,
    observation_questions: {
      repeated_local_fixes: '同じ領域で局所修正が繰り返されているか？',
      complexity_growing: '実装の複雑性が増えているか？',
      outcome_improving: '意図した成果が改善しているか？',
      urgent_containment: '構造を比較する前に緊急の被害封じ込めが必要か？'
    },
    owner_principle: '局所修正の反復と複雑性の増加が成果を改善していないなら、構造の比較を優先する。',
    interpretation_status: 'candidate',
    rule_version: EXPERT_JUDGMENT_RULE_VERSION,
    provenance_ref: 'curation:structural-simplification@1',
    causal_model: '局所修正が共通構造を温存すると、例外と保守負担が累積することがある。',
    counterexamples: [
      '修正が実際に独立しており、共通構造が安定している。',
      '新しい抽象化が、観測された保守負担を上回る結合や移行リスクを生む。'
    ],
    hypotheses: [
      {
        id: 'structural-pressure',
        claim: '局所修正の反復と複雑性の増加は、構造上の圧力を示すことがある。',
        prediction: '単純化の選択肢を比較すると、別の局所修正より例外や保守負担が少ないことを確認できる。',
        counterexample: '次の局所修正が独立していて複雑性が増えず、共通化が結合を増やす。'
      }
    ]
  },
  {
    id: 'runtime-reachability',
    version: EXPERT_JUDGMENT_SCHEMA_VERSION,
    name: '実行経路への到達性',
    question: '実装された能力が、意図した実行経路に到達しているか？',
    observation_kinds: RUNTIME_KINDS,
    observation_questions: {
      capability_claimed: 'この能力が意図した振る舞いとして主張されているか？',
      implementation_present: '現在のコードにこの能力が実装されているか？',
      intended_path_observed: '実行時に意図した経路を観測できたか？'
    },
    owner_principle: '実装の存在と、意図した実行経路での効果を分けて確認する。',
    interpretation_status: 'candidate',
    rule_version: EXPERT_JUDGMENT_RULE_VERSION,
    provenance_ref: 'curation:runtime-reachability@1',
    causal_model: '実装があっても意図した呼び出し経路に到達しなければ、意図した効果は出ない。',
    counterexamples: [
      '観測した経路が有効な代替入口で、名前付きの経路は説明用にすぎない。',
      '文書化されたトリガーや設定が整うまで、能力を意図的に休止している。'
    ],
    hypotheses: [
      {
        id: 'unreached-capability',
        claim: '主張する能力と実際の提供範囲・実行経路には差異がある可能性がある。',
        prediction: '実装、呼び出し元、設定、提供範囲を追跡すると、どこで差異が生じているか区別できる。',
        counterexample: '意図した経路と提供範囲が一致しているか、現在の設定では能力を意図的に休止している。'
      }
    ]
  },
  {
    id: 'evidence-decision-value',
    version: EXPERT_JUDGMENT_SCHEMA_VERSION,
    name: '証拠と判断の価値',
    question: '次の確認が設計や採否の判断を変えるか？',
    observation_kinds: EVIDENCE_KINDS,
    observation_questions: {
      verification_repeating: '同じ確認が繰り返されているか？',
      material_unknown_open: '重大な未確認事項が残っているか？',
      next_check_changes_decision: '次の確認で判断が変わる可能性があるか？'
    },
    owner_principle: '追加の確認は、未解決の判断を変え得る場所に使う。',
    interpretation_status: 'candidate',
    rule_version: EXPERT_JUDGMENT_RULE_VERSION,
    provenance_ref: 'curation:evidence-decision-value@1',
    causal_model: '採否や設計を変えない確認の反復は、不確実性を減らさないまま遅延を増やすことがある。',
    counterexamples: [
      '独立した監査、安全上の義務、再現性の記録のために、確認の反復が必要である。',
      '判断を変えないように見える次の確認が、これまでモデル化していなかった重大な未確認事項を見つける。'
    ],
    hypotheses: [
      {
        id: 'decision-linked-verification',
        claim: '確認は、未解決の判断を変え得るときに価値が高い。',
        prediction: '判断に結びついた確認によって、重大な未確認事項が減るか選択肢が変わる。',
        counterexample: '確認の反復に独立した必須理由があるか、判断を変えないはずの確認が重大な未確認事項を見つける。'
      }
    ]
  }
];

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const EXPERT_JUDGMENT_CATALOG = deepFreeze(CATALOG_SOURCE);
export const EXPERT_JUDGMENT_SCHEMA = EXPERT_JUDGMENT_SCHEMA_VERSION;

export function suggestExpertJudgments(input) {
  const normalized = validateExpertJudgmentInput(input);
  const nodes = EXPERT_JUDGMENT_CATALOG.map((catalog) => buildNode(catalog, normalized));

  return {
    schema_version: EXPERT_JUDGMENT_SCHEMA_VERSION,
    case_id: normalized.case_id,
    advisory: true,
    blocking: false,
    profile_status: 'candidate',
    evidence_boundary: EVIDENCE_BOUNDARY,
    observations: normalized.observations.map((observation) => ({
      id: observation.id,
      kind: observation.kind,
      value: observation.value,
      source_refs: [...observation.source_refs]
    })),
    nodes
  };
}

export function validateExpertJudgmentInput(input) {
  assertPlainObject(input, 'input');
  if (input.schema_version !== EXPERT_JUDGMENT_SCHEMA_VERSION) {
    throw new Error(`対応していない expert judgment の schema_version です: ${String(input.schema_version)}`);
  }
  requireText(input.case_id, 'case_id');
  if (!Array.isArray(input.observations)) {
    throw new Error('observations は配列で指定してください');
  }

  const kinds = new Set();
  const observations = input.observations.map((observation, index) => {
    assertPlainObject(observation, `observations[${index}]`);
    requireText(observation.id, `observations[${index}].id`);
    if (!ALL_OBSERVATION_KINDS.has(observation.kind)) {
      throw new Error(`observations[${index}].kind は定義済みの種類で指定してください: ${[...ALL_OBSERVATION_KINDS].join(', ')}`);
    }
    if (kinds.has(observation.kind)) {
      throw new Error(`観測の kind が重複しています: ${observation.kind}`);
    }
    kinds.add(observation.kind);
    if (typeof observation.value !== 'boolean') {
      throw new Error(`observations[${index}].value は true または false で指定してください`);
    }

    let sourceRefs = [];
    if (observation.source_refs !== undefined && observation.source_refs !== null) {
      if (!Array.isArray(observation.source_refs)) {
        throw new Error(`observations[${index}].source_refs は文字列の配列で指定してください`);
      }
      sourceRefs = observation.source_refs.map((sourceRef, sourceIndex) => {
        if (typeof sourceRef !== 'string') {
          throw new Error(`observations[${index}].source_refs[${sourceIndex}] は文字列で指定してください`);
        }
        return sourceRef;
      }).filter((sourceRef) => sourceRef.trim().length > 0);
    }

    return {
      id: observation.id,
      kind: observation.kind,
      value: observation.value,
      source_refs: sourceRefs
    };
  });

  return {
    schema_version: EXPERT_JUDGMENT_SCHEMA_VERSION,
    case_id: input.case_id,
    observations,
    byKind: new Map(observations.map((observation) => [observation.kind, observation]))
  };
}

function buildNode(catalog, normalized) {
  const states = Object.fromEntries(catalog.observation_kinds.map((kind) => [kind, observationState(normalized.byKind.get(kind))]));
  const decision = catalog.id === 'structural-simplification'
    ? decideStructuralSimplification(states, catalog)
    : catalog.id === 'runtime-reachability'
      ? decideRuntimeReachability(states, catalog)
      : decideEvidenceDecisionValue(states, catalog);
  const evidenceRefs = unique(catalog.observation_kinds.flatMap((kind) => states[kind].source_refs));

  return {
    node_id: catalog.id,
    version: catalog.version,
    name: catalog.name,
    question: catalog.question,
    observation_kinds: [...catalog.observation_kinds],
    owner_principle: catalog.owner_principle,
    interpretation_status: catalog.interpretation_status,
    rule_version: catalog.rule_version,
    provenance_ref: catalog.provenance_ref,
    status: decision.status,
    finding: decision.finding,
    causal_model: catalog.causal_model,
    hypotheses: catalog.hypotheses.map((hypothesis) => ({ ...hypothesis })),
    counterexamples: [...catalog.counterexamples],
    options: decision.options,
    next_checks: normalizeNextChecks(catalog, decision),
    evidence_refs: evidenceRefs,
    unknowns: decision.unknowns,
    evidence_boundary: EVIDENCE_BOUNDARY,
    advisory: true,
    blocking: false
  };
}

function normalizeNextChecks(catalog, decision) {
  let checks = decision.next_checks;
  if (checks.length === 0 && decision.status === 'proposed') {
    checks = [hypothesisCheck(catalog)];
  }
  return checks.map((check) => {
    if (typeof check !== 'string') return { ...check };
    return {
      kind: check,
      question: catalog.observation_questions[check]
    };
  });
}

function hypothesisCheck(catalog) {
  const hypothesis = catalog.hypotheses[0];
  return {
    kind: 'hypothesis_check',
    question: 'この仮説の予測が観測に合うか、反証条件に当たらないかを確認する。',
    prediction: hypothesis.prediction,
    counterexample: hypothesis.counterexample
  };
}

function observationState(observation) {
  if (!observation || observation.source_refs.length === 0) {
    return { status: 'unknown', value: null, source_refs: [] };
  }
  return {
    status: 'known',
    value: observation.value,
    source_refs: [...observation.source_refs]
  };
}

function decideStructuralSimplification(states) {
  const repeated = states.repeated_local_fixes;
  const complexity = states.complexity_growing;
  const outcome = states.outcome_improving;
  const urgent = states.urgent_containment;
  const unknowns = unknownKinds(states);

  if (repeated.status === 'known' && repeated.value === false) {
    return notApplicable('局所修正の反復が観測されないため、構造の単純化は適用対象外です。', unknowns);
  }
  if (complexity.status === 'known' && complexity.value === false) {
    return notApplicable('複雑性の増加が観測されないため、構造の単純化は適用対象外です。', unknowns);
  }
  if (outcome.status === 'known' && outcome.value === true) {
    return notApplicable('意図した成果が改善しているため、これらの観測だけでは構造の単純化を提案しません。', unknowns);
  }

  const prerequisiteUnknowns = unknownKinds({
    repeated_local_fixes: repeated,
    complexity_growing: complexity,
    outcome_improving: outcome
  });
  if (prerequisiteUnknowns.length > 0) {
    return insufficient(unknowns, '構造上の圧力を判断する前提が十分に確認できていません。', prerequisiteUnknowns);
  }
  if (urgent.status === 'unknown') {
    return insufficient(unknowns, '緊急性が未確認のため、封じ込めと構造比較の順序を決められません。', ['urgent_containment']);
  }
  if (urgent.value === true) {
    return proposed(
      '緊急の影響を先に封じ込め、その後で追加修正と削除・統合・再設計を比較します。',
      [
        option('containment-first', '構造を変える前に現在の影響を封じ込める。'),
        option('structural-comparison-after-containment', '封じ込め後に、追加の局所修正と削除・統合・再設計を比較する。')
      ],
      unknowns,
      [{
        kind: 'post-containment-structural-comparison',
        question: '被害を封じ込めた後、局所修正と削除・統合・再設計の比較結果を確認する。'
      }]
    );
  }
  return proposed(
    '別の例外を追加する前に、もう一度局所修正する案と削除・統合・再設計を比較します。',
    [
      option('additional-local-fix', 'もう一度局所修正し、新たな例外や保守費用を記録する。'),
      option('simplification-comparison', '局所修正案と削除・統合・再設計を比較する。')
    ],
    unknowns
  );
}

function decideRuntimeReachability(states) {
  const claimed = states.capability_claimed;
  const implementation = states.implementation_present;
  const path = states.intended_path_observed;
  const unknowns = unknownKinds(states);

  if (implementation.status === 'known' && implementation.value === false
    && path.status === 'known' && path.value === true) {
    return insufficient(
      [...unknowns, 'runtime-scope-consistency'],
      '実装がないという観測と意図した経路の観測が矛盾しています。同じ能力と範囲を見ているか確認してください。',
      [{
        kind: 'runtime-scope-consistency',
        question: '実装の有無と実行経路が、同じ能力と範囲を対象にしているか確認する。'
      }]
    );
  }
  if (path.status === 'known' && path.value === true) {
    return notApplicable('意図した実行経路が観測されました。ただし、このノードはすべての場合の正しさを証明しません。', unknowns);
  }
  if (claimed.status === 'known' && claimed.value === false) {
    return notApplicable('この観測では能力が主張されていないため、実行経路の提案は適用対象外です。', unknowns);
  }
  if (claimed.status === 'unknown') {
    return insufficient(unknowns, '能力の主張が未確認のため、実装の有無から提案を決められません。', ['capability_claimed']);
  }
  if (implementation.status === 'known' && implementation.value === false) {
    return proposed(
      '能力を未実装または利用不能として扱い、要件と実装を比較します。',
      [
        option('requirements-implementation-comparison', '主張された要件と現在の実装境界を比較する。'),
        option('implement-or-remove-claim', '能力を実装するか、主張と期待する経路を見直す。')
      ],
      unknowns
    );
  }
  if (claimed.status === 'known' && claimed.value === true
    && implementation.status === 'known' && implementation.value === true
    && path.status === 'known' && path.value === false) {
    return proposed(
      '実装の存在と実効的な実行を分け、呼び出し元・トリガー・意図した経路を調べます。',
      [
        option('trace-callers-and-trigger', '呼び出し元、トリガー、設定、実行経路を追跡する。'),
        option('verify-observed-effect', '意図した経路を実行または計測し、観測した効果と主張を比較する。')
      ],
      unknowns
    );
  }
  if (unknowns.length > 0) {
    return insufficient(unknowns, '能力、実装、意図した実行経路がすべて確認できていません。');
  }
  return notApplicable('観測された事実からは、実行経路の懸念は選ばれません。', unknowns);
}

function decideEvidenceDecisionValue(states) {
  const repeating = states.verification_repeating;
  const material = states.material_unknown_open;
  const changes = states.next_check_changes_decision;
  const unknowns = unknownKinds(states);

  if (material.status === 'known' && material.value === true
    || changes.status === 'known' && changes.value === true) {
    return proposed(
      '未解決の判断に結びつく確認を優先し、関係しない作業は続けます。',
      [
        option('decision-linked-check', '重大な未確認事項を解消するか判断を変えられる確認を行う。'),
        option('continue-unblocked-work', '未解決の判断に依存しない作業を続ける。')
      ],
      unknowns
    );
  }
  if (repeating.status === 'known' && repeating.value === true
    && material.status === 'known' && material.value === false
    && changes.status === 'known' && changes.value === false) {
    return proposed(
      '次の確認で判断が変わる見込みがないため、現在の確認を終えて次の作業へ進みます。',
      [
        option('finish-and-move-on', '現在の確認結果を記録し、次の作業へ進む。'),
        option('bounded-exception-check', '新たに判断を変える理由が出た場合だけ、範囲を限定して追加確認する。')
      ],
      unknowns,
      [{
        kind: 'reopen-condition',
        question: '新たな重大な未確認事項や判断を変える根拠が出た場合だけ、確認を再開する。'
      }]
    );
  }
  if (repeating.status === 'known' && repeating.value === false
    && material.status === 'known' && material.value === false
    && changes.status === 'known' && changes.value === false) {
    return notApplicable('確認は繰り返されておらず、判断に結びつく重大な未確認事項もないため、適用対象外です。', unknowns);
  }

  if (unknowns.length > 0) {
    return insufficient(unknowns, '追加確認の価値を判断するための観測が足りません。');
  }
  return notApplicable('判断に結びつく確認の懸念は観測されません。', unknowns);
}

function unknownKinds(states) {
  return Object.entries(states)
    .filter(([, state]) => state.status === 'unknown')
    .map(([kind]) => kind);
}

function proposed(finding, options, unknowns = [], next_checks = []) {
  return { status: 'proposed', finding, options, unknowns, next_checks };
}

function insufficient(unknowns, finding, next_checks = unknowns) {
  return { status: 'insufficient', finding, options: [], unknowns, next_checks };
}

function notApplicable(finding, unknowns = []) {
  return { status: 'not_applicable', finding, options: [], unknowns, next_checks: [] };
}

function option(id, summary) {
  return { id, summary };
}

function unique(values) {
  return [...new Set(values)];
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} は空でない文字列で指定してください`);
  }
}

export function renderExpertJudgmentSummary(result) {
  const lines = [
    `専門判断の提案: ${result.case_id}`,
    `プロファイル: ${result.profile_status}`,
    `助言のみ: ${result.advisory}`,
    `ブロック: ${result.blocking}`
  ];
  for (const node of result.nodes) {
    lines.push(`- ${node.node_id}: ${node.status} — ${node.finding}`);
    if (node.unknowns.length > 0) lines.push(`  未確認: ${node.unknowns.join(', ')}`);
  }
  lines.push('最終判断は人または呼び出し元にあり、自動採用は行いません。', '');
  return `${lines.join('\n')}\n`;
}
